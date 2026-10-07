/**
 * Bundle A pipeline signals for Control Center:
 * queue depth/age, ingest lock, source directory reachability.
 * Filesystem-only — works even when Postgres is down.
 */
import { promises as fs } from 'fs'
import path from 'path'
import { loadConfig } from './config'

export type HealthStatus = 'ok' | 'degraded' | 'down'

export interface QueueSnapshot {
  resultsCount: number
  testsCount: number
  /** Hours since oldest file mtime in either queue dir; null if empty */
  oldestAgeHours: number | null
  oldestPath?: string
  /** Hours since newest file mtime; null if empty */
  newestAgeHours: number | null
  error?: string
}

export interface LockSnapshot {
  locked: boolean
  /** Lock file exists but PID is dead or unreadable */
  stale: boolean
  pid?: number
  startedAt?: string
  ageSec: number | null
  path: string
}

export interface SourceSnapshot {
  name: string
  resultsOk: boolean
  dataOk: boolean
  ok: boolean
  resultsError?: string
  dataError?: string
}

export interface SourcesSnapshot {
  total: number
  reachable: number
  sources: SourceSnapshot[]
  missing: string[]
}

const CHECK_TIMEOUT_MS = 400
// Cloud FUSE listings can enumerate large directories even when reading one entry.
const SOURCE_CHECK_TIMEOUT_MS = 2500

class CheckTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new CheckTimeoutError(`timeout after ${ms}ms`)), ms)
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

async function readableDirectory(dir: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await withTimeout((async () => {
      const st = await fs.stat(dir)
      if (!st.isDirectory()) throw Object.assign(new Error(), { code: 'ENOTDIR' })
      // A FUSE mount can still have cached directory metadata after its cloud
      // credentials stop working. Read an entry to exercise directory listing.
      const handle = await fs.opendir(dir)
      try {
        await handle.read()
      } finally {
        await handle.close()
      }
    })(), SOURCE_CHECK_TIMEOUT_MS)
    return { ok: true }
  } catch (err) {
    if (err instanceof CheckTimeoutError) {
      return { ok: false, error: `directory read exceeded ${SOURCE_CHECK_TIMEOUT_MS}ms` }
    }
    const code = (err as NodeJS.ErrnoException).code
    // Report only known error codes, never arbitrary filesystem/backend text.
    const errors: Record<string, string> = {
      EIO: 'I/O error (EIO)', ENOENT: 'missing directory (ENOENT)',
      EACCES: 'permission denied (EACCES)', EPERM: 'permission denied (EPERM)',
      ENOTDIR: 'not a directory (ENOTDIR)', ENOTCONN: 'mount disconnected (ENOTCONN)',
    }
    return { ok: false, error: code ? errors[code] ?? 'directory unreadable' : 'directory read timed out or failed' }
  }
}

/** Count non-hidden files (not dirs) in a directory; 0 if missing. */
async function countFiles(dir: string): Promise<{
  count: number
  oldestMtimeMs: number | null
  newestMtimeMs: number | null
  oldestName?: string
}> {
  try {
    const entries = await withTimeout(fs.readdir(dir, { withFileTypes: true }), CHECK_TIMEOUT_MS)
    let count = 0
    let oldestMtimeMs: number | null = null
    let newestMtimeMs: number | null = null
    let oldestName: string | undefined

    // Cap stat work for huge queues — sample first 2000 names if needed
    const files = entries.filter((e) => e.isFile() && !e.name.startsWith('.'))
    const toStat = files.length > 2000 ? files.slice(0, 2000) : files
    count = files.length

    for (const ent of toStat) {
      try {
        const st = await fs.stat(path.join(dir, ent.name))
        const m = st.mtimeMs
        if (oldestMtimeMs == null || m < oldestMtimeMs) {
          oldestMtimeMs = m
          oldestName = ent.name
        }
        if (newestMtimeMs == null || m > newestMtimeMs) {
          newestMtimeMs = m
        }
      } catch {
        /* skip unreadable */
      }
    }

    return { count, oldestMtimeMs, newestMtimeMs, oldestName }
  } catch {
    return { count: 0, oldestMtimeMs: null, newestMtimeMs: null }
  }
}

export async function snapshotQueue(now = Date.now()): Promise<QueueSnapshot> {
  try {
    const config = loadConfig()
    const mainDir = config.paths.local.main_dir
    const resultsDir = path.join(mainDir, 'to_process', 'results')
    const testsDir = path.join(mainDir, 'to_process', 'tests')

    const [results, tests] = await Promise.all([
      countFiles(resultsDir),
      countFiles(testsDir),
    ])

    const newest = [results.newestMtimeMs, tests.newestMtimeMs].filter(
      (v): v is number => v != null
    )

    let oldestMtimeMs: number | null = null
    let oldestPath: string | undefined
    if (results.oldestMtimeMs != null && tests.oldestMtimeMs != null) {
      if (results.oldestMtimeMs <= tests.oldestMtimeMs) {
        oldestMtimeMs = results.oldestMtimeMs
        oldestPath = results.oldestName
          ? `results/${results.oldestName}`
          : undefined
      } else {
        oldestMtimeMs = tests.oldestMtimeMs
        oldestPath = tests.oldestName ? `tests/${tests.oldestName}` : undefined
      }
    } else if (results.oldestMtimeMs != null) {
      oldestMtimeMs = results.oldestMtimeMs
      oldestPath = results.oldestName
        ? `results/${results.oldestName}`
        : undefined
    } else if (tests.oldestMtimeMs != null) {
      oldestMtimeMs = tests.oldestMtimeMs
      oldestPath = tests.oldestName ? `tests/${tests.oldestName}` : undefined
    }

    const newestMtimeMs = newest.length ? Math.max(...newest) : null

    return {
      resultsCount: results.count,
      testsCount: tests.count,
      oldestAgeHours:
        oldestMtimeMs != null
          ? Math.round(((now - oldestMtimeMs) / 3_600_000) * 10) / 10
          : null,
      oldestPath,
      newestAgeHours:
        newestMtimeMs != null
          ? Math.round(((now - newestMtimeMs) / 3_600_000) * 10) / 10
          : null,
    }
  } catch (err) {
    return {
      resultsCount: 0,
      testsCount: 0,
      oldestAgeHours: null,
      newestAgeHours: null,
      error: err instanceof Error ? err.message : 'queue unreadable',
    }
  }
}

export async function snapshotLock(now = Date.now()): Promise<LockSnapshot> {
  const config = loadConfig()
  const lockPath = path.join(config.paths.local.main_dir, '.ingestion.lock')

  try {
    const raw = await withTimeout(fs.readFile(lockPath, 'utf-8'), CHECK_TIMEOUT_MS)
    let pid: number | undefined
    let startedAt: string | undefined
    try {
      const parsed = JSON.parse(raw) as { pid?: number; timestamp?: string }
      pid = typeof parsed.pid === 'number' ? parsed.pid : undefined
      startedAt =
        typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined
    } catch {
      /* corrupt lock */
    }

    const st = await fs.stat(lockPath)
    const ageSec = Math.max(0, Math.round((now - st.mtimeMs) / 1000))

    let alive = false
    if (pid != null && pid > 0) {
      try {
        // signal 0 — throws if process does not exist (or no permission)
        process.kill(pid, 0)
        alive = true
      } catch {
        alive = false
      }
    }

    const stale = !alive
    return {
      locked: true,
      stale,
      pid,
      startedAt,
      ageSec,
      path: lockPath,
    }
  } catch {
    return {
      locked: false,
      stale: false,
      ageSec: null,
      path: lockPath,
    }
  }
}

export async function snapshotSources(): Promise<SourcesSnapshot> {
  try {
    const config = loadConfig()
    const sources: SourceSnapshot[] = []

    for (const src of config.paths.source_directories ?? []) {
      const [results, data] = await Promise.all([
        readableDirectory(src.results_dir),
        readableDirectory(src.data_dir),
      ])
      sources.push({
        name: src.name,
        resultsOk: results.ok,
        dataOk: data.ok,
        ok: results.ok && data.ok,
        resultsError: results.error,
        dataError: data.error,
      })
    }

    const reachable = sources.filter((s) => s.ok).length
    const missing = sources
      .filter((s) => !s.ok)
      .map((s) => {
        const parts: string[] = []
        if (!s.resultsOk) parts.push(`results: ${s.resultsError}`)
        if (!s.dataOk) parts.push(`data: ${s.dataError}`)
        return `${s.name}(${parts.join('+')})`
      })

    return {
      total: sources.length,
      reachable,
      sources,
      missing,
    }
  } catch {
    return { total: 0, reachable: 0, sources: [], missing: ['config unreadable'] }
  }
}

/** Status rules for queue health. */
export function queueStatus(
  q: QueueSnapshot,
  checkIntervalSec: number
): { status: HealthStatus; detail: string } {
  if (q.error) {
    return { status: 'degraded', detail: q.error }
  }

  const total = q.resultsCount + q.testsCount
  if (total === 0) {
    return { status: 'ok', detail: 'queue empty' }
  }

  const intervalHours = checkIntervalSec / 3600
  const age = q.oldestAgeHours ?? 0

  // Orphan test pile with almost no results — classic stuck pairing / failed ingest
  if (q.testsCount >= 20 && q.resultsCount === 0) {
    return {
      status: 'degraded',
      detail: `${q.testsCount} orphan tests, 0 results`,
    }
  }
  if (q.testsCount >= 50 && q.testsCount > q.resultsCount * 10) {
    return {
      status: 'degraded',
      detail: `${q.testsCount} tests vs ${q.resultsCount} results (imbalance)`,
    }
  }

  // Backlog older than 2 check intervals (min 2h)
  const ageThresholdH = Math.max(2, intervalHours * 2)
  if (q.resultsCount > 0 && age >= ageThresholdH) {
    return {
      status: 'degraded',
      detail: `${q.resultsCount} results pending · oldest ${age}h`,
    }
  }

  // Very large pending results
  if (q.resultsCount >= 50) {
    return {
      status: 'degraded',
      detail: `${q.resultsCount} results queued`,
    }
  }

  if (q.resultsCount > 0) {
    return {
      status: 'ok',
      detail: `${q.resultsCount} results · ${q.testsCount} tests pending`,
    }
  }

  return {
    status: 'ok',
    detail: `${q.testsCount} tests in queue (no results)`,
  }
}

export function lockStatus(
  lock: LockSnapshot
): { status: HealthStatus; detail: string } {
  if (!lock.locked) {
    return { status: 'ok', detail: 'not running' }
  }
  if (lock.stale) {
    return {
      status: 'degraded',
      detail: `stale lock (pid ${lock.pid ?? '?'} dead, age ${lock.ageSec ?? '?'}s)`,
    }
  }
  const age = lock.ageSec != null ? `${Math.round(lock.ageSec / 60)}m` : '?'
  return {
    status: 'ok',
    detail: `running (pid ${lock.pid ?? '?'}, ${age})`,
  }
}

export function sourcesStatus(
  s: SourcesSnapshot
): { status: HealthStatus; detail: string } {
  if (s.total === 0) {
    return { status: 'degraded', detail: 'no sources configured' }
  }
  if (s.reachable === 0) {
    return {
      status: 'degraded',
      detail: `0/${s.total} sources reachable · unreadable ${s.missing.slice(0, 3).join(', ')} · check pCloud authorization and mount`,
    }
  }
  if (s.reachable < s.total) {
    return {
      status: 'degraded',
      detail: `${s.reachable}/${s.total} up · missing ${s.missing.slice(0, 3).join(', ')}`,
    }
  }
  return { status: 'ok', detail: `${s.reachable}/${s.total} sources reachable` }
}
