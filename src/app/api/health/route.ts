import { NextResponse } from 'next/server'
import { Client } from 'pg'
import { promises as fs } from 'fs'
import path from 'path'
import { getDatabaseConfig, loadConfig } from '@/lib/config'
import { logAppEvent } from '@/lib/appLogger'
import {
  INGEST_STATUS_FILE,
  WATCHDOG_STATUS_FILE,
  readJsonStatus,
  secondsUntil,
  type IngestStatus,
  type WatchdogStatus,
} from '@/lib/opsStatus'
import {
  lockStatus,
  queueStatus,
  snapshotLock,
  snapshotQueue,
  snapshotSources,
  sourcesStatus,
} from '@/lib/pipelineOps'
import {
  ageHours,
  freshnessStatus,
  snapshotFreshness,
  todoStatus,
  type FreshnessSnapshot,
} from '@/lib/freshnessOps'
import {
  capacityStatus,
  formatBytes,
  snapshotCapacity,
  type CapacitySnapshot,
} from '@/lib/capacityOps'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type HealthStatus = 'ok' | 'degraded' | 'down'

interface HealthCheck {
  name: string
  status: HealthStatus
  latencyMs?: number
  detail?: string
  critical?: boolean
}

interface HealthMetric {
  id: string
  label: string
  value: number | string
  unit?: string
  status?: HealthStatus
  updatedAt?: string
  detail?: string
}

interface HealthEvent {
  id: string
  label: string
  status: HealthStatus
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  summary?: string
}

const SERVICE_NAME = 'mfg-datavis'
const CHECK_TIMEOUT_MS = 500

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        reject(e)
      }
    )
  })
}

async function checkDatabase(): Promise<HealthCheck> {
  const started = Date.now()
  const client = new Client({
    ...getDatabaseConfig(),
    connectionTimeoutMillis: CHECK_TIMEOUT_MS,
  })
  try {
    await withTimeout(client.connect(), CHECK_TIMEOUT_MS + 100)
    const result = await withTimeout(
      client.query('SELECT 1 AS ok'),
      CHECK_TIMEOUT_MS
    )
    const ok = result.rows?.[0]?.ok === 1
    return {
      name: 'database',
      status: ok ? 'ok' : 'down',
      latencyMs: Date.now() - started,
      detail: ok ? 'SELECT 1 ok' : 'unexpected query result',
      critical: true,
    }
  } catch (err) {
    return {
      name: 'database',
      status: 'down',
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : 'unreachable',
      critical: true,
    }
  } finally {
    try {
      await client.end()
    } catch {
      /* ignore */
    }
  }
}

function checkAuthConfig(): HealthCheck {
  const started = Date.now()
  const skip = process.env.SKIP_AUTH === 'true'
  if (skip) {
    return {
      name: 'auth_config',
      status: 'degraded',
      latencyMs: Date.now() - started,
      detail: 'SKIP_AUTH=true (dev mode)',
      critical: false,
    }
  }
  const secret = Boolean(process.env.NEXTAUTH_SECRET)
  const azure =
    Boolean(process.env.AZURE_AD_CLIENT_ID) &&
    Boolean(process.env.AZURE_AD_CLIENT_SECRET) &&
    Boolean(process.env.AZURE_AD_TENANT_ID)
  const ok = secret && azure
  return {
    name: 'auth_config',
    status: ok ? 'ok' : 'degraded',
    latencyMs: Date.now() - started,
    detail: ok
      ? 'NextAuth + Azure AD env present'
      : 'missing NEXTAUTH_SECRET or Azure AD env',
    critical: false,
  }
}

async function checkDataDirs(): Promise<HealthCheck> {
  const started = Date.now()
  try {
    const config = loadConfig()
    const dirs = [
      config.paths.local.main_dir,
      config.paths.local.dashboard_dir,
      config.paths.local.log_dir,
    ].filter(Boolean)

    const missing: string[] = []
    for (const d of dirs) {
      try {
        await withTimeout(fs.access(d), CHECK_TIMEOUT_MS)
      } catch {
        missing.push(d)
      }
    }

    if (missing.length === 0) {
      return {
        name: 'data_dirs',
        status: 'ok',
        latencyMs: Date.now() - started,
        detail: `${dirs.length} local paths ok`,
        critical: false,
      }
    }
    return {
      name: 'data_dirs',
      status: 'degraded',
      latencyMs: Date.now() - started,
      detail: `missing: ${missing.map((p) => path.basename(p)).join(', ')}`,
      critical: false,
    }
  } catch (err) {
    return {
      name: 'data_dirs',
      status: 'degraded',
      latencyMs: Date.now() - started,
      detail: err instanceof Error ? err.message : 'config unreadable',
      critical: false,
    }
  }
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return s > 0 ? `${m}m ${s}s` : `${m}m`
  }
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

async function buildIngestOps(
  freshness: FreshnessSnapshot | null
): Promise<{
  check: HealthCheck
  metrics: HealthMetric[]
  events: HealthEvent[]
}> {
  const started = Date.now()
  const metrics: HealthMetric[] = []
  const events: HealthEvent[] = []

  let checkIntervalSec = 3600
  try {
    checkIntervalSec = loadConfig().settings.check_interval || 3600
  } catch {
    /* use default */
  }

  const [watchdog, ingest] = await Promise.all([
    readJsonStatus<WatchdogStatus>(WATCHDOG_STATUS_FILE),
    readJsonStatus<IngestStatus>(INGEST_STATUS_FILE),
  ])

  if (watchdog?.checkIntervalSec) {
    checkIntervalSec = watchdog.checkIntervalSec
  }

  const liveTotal = freshness?.ok ? freshness.totalTests : null
  const totalTests =
    liveTotal ??
    (ingest?.totalTests != null ? ingest.totalTests : null)

  // --- Next cycle countdown ---
  const nextCycleAt = watchdog?.nextCycleAt
  const secs = secondsUntil(nextCycleAt)
  if (nextCycleAt && secs != null) {
    metrics.push({
      id: 'ingest.next_cycle_at',
      label: 'Next cycle',
      value: nextCycleAt,
      unit: 'iso',
      status: 'ok',
      updatedAt: watchdog?.updatedAt,
      detail: `every ${formatDuration(checkIntervalSec)}`,
    })
    metrics.push({
      id: 'ingest.next_in_sec',
      label: 'Next check in',
      value: secs,
      unit: 'seconds',
      status: 'ok',
      updatedAt: watchdog?.updatedAt,
      detail: formatDuration(secs),
    })
  } else {
    metrics.push({
      id: 'ingest.next_in_sec',
      label: 'Next check in',
      value: '—',
      unit: 'text',
      status: 'degraded',
      detail: 'watchdog has not reported yet',
    })
  }

  metrics.push({
    id: 'ingest.check_interval_sec',
    label: 'Check interval',
    value: checkIntervalSec,
    unit: 'seconds',
    status: 'ok',
    detail: formatDuration(checkIntervalSec),
  })

  // --- Last run ---
  if (ingest) {
    metrics.push({
      id: 'ingest.last_new_tests',
      label: 'Last run · new tests',
      value: ingest.newTests,
      unit: 'count',
      status: ingest.success ? 'ok' : 'down',
      updatedAt: ingest.finishedAt || ingest.updatedAt,
    })
    metrics.push({
      id: 'ingest.last_duration_ms',
      label: 'Last run duration',
      value: ingest.durationMs,
      unit: 'ms',
      status: ingest.success ? 'ok' : 'degraded',
      updatedAt: ingest.finishedAt || ingest.updatedAt,
    })
  }

  if (totalTests != null) {
    metrics.push({
      id: 'ingest.total_tests',
      label: 'Total tests',
      value: totalTests,
      unit: 'count',
      status: 'ok',
      updatedAt: new Date().toISOString(),
      detail: liveTotal != null ? 'live DB count' : 'from last ingest',
    })
  }

  if (ingest) {
    const parts = [
      `${ingest.newTests} new`,
      totalTests != null ? `${totalTests.toLocaleString()} total` : null,
      ingest.durationMs != null
        ? `${(ingest.durationMs / 1000).toFixed(1)}s`
        : null,
    ].filter(Boolean)

    events.push({
      id: 'ingest.run',
      label: 'Last ingest',
      status: ingest.success ? 'ok' : 'down',
      startedAt: ingest.startedAt,
      finishedAt: ingest.finishedAt,
      durationMs: ingest.durationMs,
      summary: ingest.success
        ? parts.join(' · ')
        : ingest.error || 'ingestion failed',
    })
  }

  // --- Check status ---
  let status: HealthStatus = 'ok'
  let detail = 'no ingest history yet'

  if (!watchdog) {
    status = 'degraded'
    detail = 'watchdog status missing (is the watchdog running?)'
  } else {
    const updatedMs = new Date(watchdog.updatedAt).getTime()
    const staleMs = (checkIntervalSec * 2 + 300) * 1000
    if (!Number.isNaN(updatedMs) && Date.now() - updatedMs > staleMs) {
      status = 'degraded'
      detail = `watchdog status stale (${formatDuration(Math.round((Date.now() - updatedMs) / 1000))} ago)`
    } else if (watchdog.lastIngestTriggered && watchdog.lastIngestSuccess === false) {
      status = 'degraded'
      detail = 'last triggered ingest failed'
    } else if (ingest && !ingest.success) {
      status = 'degraded'
      detail = `last ingest failed: ${ingest.error || 'unknown'}`
    } else if (ingest) {
      detail = `next ${secs != null ? formatDuration(secs) : '—'} · last ${ingest.newTests} new`
      if (totalTests != null) detail += ` / ${totalTests.toLocaleString()} total`
    } else if (secs != null) {
      detail = `next check in ${formatDuration(secs)}`
    } else {
      detail = 'watchdog running, no ingest runs recorded'
    }
  }

  return {
    check: {
      name: 'ingest',
      status,
      latencyMs: Date.now() - started,
      detail,
      critical: false,
    },
    metrics,
    events,
  }
}

/**
 * Bundle A — queue depth/age, ingest lock, source mounts.
 * Filesystem-only; safe when DB is down.
 */
async function buildPipelineOps(checkIntervalSec: number): Promise<{
  checks: HealthCheck[]
  metrics: HealthMetric[]
}> {
  const started = Date.now()
  const [queue, lock, sources] = await Promise.all([
    snapshotQueue(),
    snapshotLock(),
    snapshotSources(),
  ])

  const q = queueStatus(queue, checkIntervalSec)
  const l = lockStatus(lock)
  const s = sourcesStatus(sources)
  const latencyMs = Date.now() - started

  const checks: HealthCheck[] = [
    {
      name: 'queue',
      status: q.status,
      latencyMs,
      detail: q.detail,
      critical: false,
    },
    {
      name: 'ingest_lock',
      status: l.status,
      latencyMs,
      detail: l.detail,
      critical: false,
    },
    {
      name: 'sources',
      status: s.status,
      latencyMs,
      detail: s.detail,
      critical: false,
    },
  ]

  const metrics: HealthMetric[] = [
    {
      id: 'queue.results',
      label: 'Queue · results',
      value: queue.resultsCount,
      unit: 'count',
      status: q.status,
      detail:
        queue.resultsCount > 0
          ? 'pending ingest'
          : 'empty',
    },
    {
      id: 'queue.tests',
      label: 'Queue · tests',
      value: queue.testsCount,
      unit: 'count',
      status:
        queue.testsCount >= 20 &&
        (queue.resultsCount === 0 ||
          queue.testsCount > queue.resultsCount * 10)
          ? 'degraded'
          : 'ok',
      detail:
        queue.testsCount >= 20 && queue.resultsCount === 0
          ? 'orphan pile'
          : queue.testsCount >= 50 &&
              queue.testsCount > queue.resultsCount * 10
            ? 'imbalance vs results'
            : queue.testsCount > 0
              ? 'pending pairing'
              : 'empty',
    },
    {
      id: 'queue.age_hours',
      label: 'Queue · oldest',
      value: queue.oldestAgeHours ?? '—',
      unit: queue.oldestAgeHours != null ? 'hours' : 'text',
      status: q.status,
      detail: queue.oldestPath
        ? queue.oldestPath.length > 40
          ? `${queue.oldestPath.slice(0, 40)}…`
          : queue.oldestPath
        : queue.resultsCount + queue.testsCount === 0
          ? 'no pending files'
          : undefined,
    },
    {
      id: 'ingest.running',
      label: 'Ingest running',
      value: lock.locked && !lock.stale ? 'yes' : lock.stale ? 'stale lock' : 'no',
      unit: 'text',
      status: l.status,
      detail: l.detail,
    },
    {
      id: 'sources.reachable',
      label: 'Sources up',
      value: sources.total > 0 ? `${sources.reachable}/${sources.total}` : '0/0',
      unit: 'text',
      status: s.status,
      detail:
        sources.missing.length > 0
          ? sources.missing.slice(0, 4).join(', ')
          : 'all mounts ok',
    },
  ]

  if (lock.locked && lock.ageSec != null) {
    metrics.push({
      id: 'ingest.lock_age_sec',
      label: 'Lock age',
      value: lock.ageSec,
      unit: 'seconds',
      status: l.status,
      detail: lock.pid != null ? `pid ${lock.pid}` : undefined,
    })
  }

  return { checks, metrics }
}

/**
 * Bundle B — last DB write + 24h ingest volume (flow, not quality summary).
 */
function buildFreshnessOps(
  snap: FreshnessSnapshot,
  opts?: { sourcesAllDown?: boolean }
): {
  check: HealthCheck
  metrics: HealthMetric[]
} {
  const fs = freshnessStatus(snap, opts)
  const metrics: HealthMetric[] = []

  if (snap.lastIngestedAt) {
    metrics.push({
      id: 'tests.last_ingested_at',
      label: 'Last DB write',
      value: snap.lastIngestedAt,
      unit: 'iso',
      status: fs.status,
      detail: fs.detail,
    })
  }

  if (snap.lastStartAt) {
    const startAge = ageHours(snap.lastStartAt)
    metrics.push({
      id: 'tests.last_start_at',
      label: 'Newest test start',
      value: snap.lastStartAt,
      unit: 'iso',
      status: 'ok',
      detail:
        startAge != null
          ? startAge < 48
            ? `${startAge}h ago`
            : `${Math.round(startAge / 24)}d ago`
          : undefined,
    })
  }

  if (snap.ingested24h != null) {
    metrics.push({
      id: 'tests.ingested_24h',
      label: 'Ingested (24h)',
      value: snap.ingested24h,
      unit: 'count',
      status: fs.status,
      detail: 'rows created in last 24h',
    })
  }

  // Fail count is secondary context for volume, not a quality dashboard.
  if (snap.failed24h != null) {
    metrics.push({
      id: 'tests.failed_24h',
      label: 'Failed (24h)',
      value: snap.failed24h,
      unit: 'count',
      status: 'ok',
      detail: 'of rows created in last 24h',
    })
  }

  if (snap.totalTests != null) {
    // Prefer live total under freshness id if ingest total also present —
    // ingest.total_tests may still be emitted from last-run file.
    metrics.push({
      id: 'tests.total',
      label: 'Total tests',
      value: snap.totalTests,
      unit: 'count',
      status: 'ok',
      detail: 'live DB count',
    })
  }

  return {
    check: {
      name: 'freshness',
      status: fs.status,
      latencyMs: snap.latencyMs,
      detail: fs.detail,
      critical: false,
    },
    metrics,
  }
}

/**
 * Bundle C — unannotated FAIL backlog (matches /api/todo/count).
 */
function buildTodoOps(snap: FreshnessSnapshot): {
  check: HealthCheck
  metrics: HealthMetric[]
} {
  const ts = todoStatus(snap.todoUnannotated, snap.ok, snap.error)
  const metrics: HealthMetric[] = []

  if (snap.todoUnannotated != null) {
    metrics.push({
      id: 'todo.unannotated_fails',
      label: 'Todo · unannotated fails',
      value: snap.todoUnannotated,
      unit: 'count',
      status: ts.status,
      detail: ts.detail,
    })
  }

  return {
    check: {
      name: 'todo',
      status: ts.status,
      latencyMs: snap.latencyMs,
      detail: ts.detail,
      critical: false,
    },
    metrics,
  }
}

/**
 * Bundle D — free disk, data/log dir sizes, Postgres size.
 */
function buildCapacityOps(snap: CapacitySnapshot): {
  check: HealthCheck
  metrics: HealthMetric[]
} {
  const cs = capacityStatus(snap)
  const metrics: HealthMetric[] = []
  const nowIso = new Date().toISOString()

  if (snap.freeBytes != null) {
    metrics.push({
      id: 'disk.free_bytes',
      label: 'Disk free',
      value: snap.freeBytes,
      unit: 'bytes',
      status: cs.status,
      updatedAt: nowIso,
      detail: formatBytes(snap.freeBytes),
    })
  }

  if (snap.freeRatio != null) {
    metrics.push({
      id: 'disk.free_ratio',
      label: 'Disk free %',
      value: Math.round(snap.freeRatio * 1000) / 10,
      unit: 'percent',
      status: cs.status,
      detail:
        snap.totalBytes != null
          ? `of ${formatBytes(snap.totalBytes)} volume`
          : undefined,
    })
  }

  if (snap.toProcessBytes != null) {
    metrics.push({
      id: 'disk.to_process_bytes',
      label: 'Dir · to_process',
      value: snap.toProcessBytes,
      unit: 'bytes',
      status: 'ok',
      detail: formatBytes(snap.toProcessBytes),
    })
  }

  if (snap.processedBytes != null) {
    metrics.push({
      id: 'disk.processed_bytes',
      label: 'Dir · processed',
      value: snap.processedBytes,
      unit: 'bytes',
      status: 'ok',
      detail: formatBytes(snap.processedBytes),
    })
  }

  if (snap.logBytes != null) {
    metrics.push({
      id: 'disk.log_bytes',
      label: 'Dir · logs',
      value: snap.logBytes,
      unit: 'bytes',
      status:
        snap.logBytes > 2 * 1024 ** 3
          ? 'degraded'
          : 'ok',
      detail: formatBytes(snap.logBytes),
    })
  }

  if (snap.dbSizeBytes != null) {
    metrics.push({
      id: 'db.size_bytes',
      label: 'Database size',
      value: snap.dbSizeBytes,
      unit: 'bytes',
      status: 'ok',
      detail: formatBytes(snap.dbSizeBytes),
    })
  }

  return {
    check: {
      name: 'capacity',
      status: cs.status,
      latencyMs: snap.latencyMs,
      detail: cs.detail + (snap.cached ? ' · sizes cached' : ''),
      critical: false,
    },
    metrics,
  }
}

function rollupStatus(checks: HealthCheck[]): HealthStatus {
  let worst: HealthStatus = 'ok'
  for (const c of checks) {
    const critical = c.critical !== false
    if (critical && c.status === 'down') return 'down'
    if (critical && c.status === 'degraded') worst = 'degraded'
    if (!critical && (c.status === 'down' || c.status === 'degraded')) {
      if (worst === 'ok') worst = 'degraded'
    }
  }
  return worst
}

/**
 * Control Center health contract — see sparq-toolbox
 * docs/control-center/HEALTH_CONTRACT.md
 */
export async function GET(request: Request) {
  const expected = process.env.HEALTH_TOKEN?.trim()
  if (expected) {
    const token = request.headers.get('x-health-token')
    if (token !== expected) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let checkIntervalSec = 3600
  try {
    checkIntervalSec = loadConfig().settings.check_interval || 3600
  } catch {
    /* default */
  }

  // Freshness first so ingest ops can reuse totalTests without a second query.
  // Capacity runs in parallel (dir sizes cached ~5 min).
  const [database, dataDirs, pipelineOps, freshnessSnap, capacitySnap] =
    await Promise.all([
      checkDatabase(),
      checkDataDirs(),
      buildPipelineOps(checkIntervalSec),
      snapshotFreshness(),
      snapshotCapacity(),
    ])

  const sourcesCheck = pipelineOps.checks.find((c) => c.name === 'sources')
  const sourcesAllDown =
    sourcesCheck?.status === 'degraded' &&
    (sourcesCheck.detail?.startsWith('0/') ?? false)

  const freshnessOps = buildFreshnessOps(freshnessSnap, { sourcesAllDown })
  const todoOps = buildTodoOps(freshnessSnap)
  const capacityOps = buildCapacityOps(capacitySnap)
  const ingestOps = await buildIngestOps(freshnessSnap)

  // Prefer live tests.total over file-based ingest.total_tests when both present
  const ingestMetrics = ingestOps.metrics.filter((m) => {
    if (m.id === 'ingest.total_tests' && freshnessSnap.ok && freshnessSnap.totalTests != null) {
      return false
    }
    return true
  })

  const checks: HealthCheck[] = [
    { name: 'http', status: 'ok', latencyMs: 1, critical: true },
    database,
    checkAuthConfig(),
    dataDirs,
    ingestOps.check,
    ...pipelineOps.checks,
    freshnessOps.check,
    todoOps.check,
    capacityOps.check,
  ]

  // Deep-link to the in-app todo queue when base URL is known
  const dashboardBase =
    process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || undefined
  const todoLink = dashboardBase
    ? `${dashboardBase.replace(/\/$/, '')}/todo`
    : undefined

  const status = rollupStatus(checks)
  const body = {
    status,
    service: SERVICE_NAME,
    version: process.env.APP_VERSION || process.env.npm_package_version || '0.7.0',
    uptimeSec: Math.floor(process.uptime()),
    checkedAt: new Date().toISOString(),
    checks,
    metrics: [
      ...pipelineOps.metrics,
      ...freshnessOps.metrics,
      ...todoOps.metrics,
      ...capacityOps.metrics,
      ...ingestMetrics,
    ],
    events: ingestOps.events,
    links: {
      dashboard: dashboardBase,
      // Optional extension — Control Center may ignore unknown link keys
      ...(todoLink ? { todo: todoLink } : {}),
    },
  }

  if (status !== 'ok') {
    try {
      logAppEvent('HEALTH_NOT_OK', {
        status,
        checks: checks.map((c) => `${c.name}:${c.status}`),
      })
    } catch {
      /* ignore */
    }
  }

  return NextResponse.json(body, {
    status: status === 'down' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store' },
  })
}
