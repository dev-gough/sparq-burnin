/**
 * Bundle B — data freshness for Control Center.
 * Single short DB query: last activity + 24h ingest volume.
 */
import { Client } from 'pg'
import { getDatabaseConfig } from './config'

export type HealthStatus = 'ok' | 'degraded' | 'down'

export interface FreshnessSnapshot {
  ok: boolean
  error?: string
  totalTests: number | null
  /** ISO — max(start_time_utc) */
  lastStartAt: string | null
  /** ISO — max(created_at) — when a row was last written by ingest */
  lastIngestedAt: string | null
  ingested24h: number | null
  failed24h: number | null
  /**
   * FAIL tests with no TestAnnotations row (same as /api/todo/count).
   * Bundle C — human annotation backlog.
   */
  todoUnannotated: number | null
  latencyMs: number
}

const QUERY_TIMEOUT_MS = 800
const CONNECT_TIMEOUT_MS = 500

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

function toIso(v: unknown): string | null {
  if (v == null) return null
  if (v instanceof Date) return v.toISOString()
  if (typeof v === 'string') {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
  }
  return null
}

export async function snapshotFreshness(): Promise<FreshnessSnapshot> {
  const started = Date.now()
  const client = new Client({
    ...getDatabaseConfig(),
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  })

  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS + 100)
    // One round-trip — fine at ~7k rows; keep timeout tight for health.
    const result = await withTimeout(
      client.query(`
        SELECT
          COUNT(*)::int AS total,
          MAX(start_time_utc) AS last_start,
          MAX(created_at) AS last_created,
          COUNT(*) FILTER (
            WHERE created_at >= NOW() - INTERVAL '24 hours'
          )::int AS ingested_24h,
          COUNT(*) FILTER (
            WHERE created_at >= NOW() - INTERVAL '24 hours'
              AND overall_status = 'FAIL'
          )::int AS failed_24h,
          COUNT(*) FILTER (
            WHERE overall_status = 'FAIL'
              AND NOT EXISTS (
                SELECT 1
                FROM TestAnnotations ta
                WHERE ta.current_test_id = Tests.test_id
              )
          )::int AS todo_unannotated
        FROM Tests
      `),
      QUERY_TIMEOUT_MS
    )

    const row = result.rows[0] ?? {}
    return {
      ok: true,
      totalTests: typeof row.total === 'number' ? row.total : null,
      lastStartAt: toIso(row.last_start),
      lastIngestedAt: toIso(row.last_created),
      ingested24h:
        typeof row.ingested_24h === 'number' ? row.ingested_24h : null,
      failed24h: typeof row.failed_24h === 'number' ? row.failed_24h : null,
      todoUnannotated:
        typeof row.todo_unannotated === 'number' ? row.todo_unannotated : null,
      latencyMs: Date.now() - started,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'freshness query failed',
      totalTests: null,
      lastStartAt: null,
      lastIngestedAt: null,
      ingested24h: null,
      failed24h: null,
      todoUnannotated: null,
      latencyMs: Date.now() - started,
    }
  } finally {
    try {
      await client.end()
    } catch {
      /* ignore */
    }
  }
}

export function ageHours(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.round(((now - t) / 3_600_000) * 10) / 10
}

/**
 * Freshness is about flow, not quality.
 * Soft thresholds: >48h no new rows → degraded; empty table → degraded.
 */
export function freshnessStatus(
  snap: FreshnessSnapshot,
  opts?: { sourcesAllDown?: boolean }
): { status: HealthStatus; detail: string } {
  if (!snap.ok) {
    return {
      status: 'degraded',
      detail: snap.error || 'could not query Tests',
    }
  }

  if (snap.totalTests === 0 || snap.totalTests == null) {
    if (snap.totalTests === 0) {
      return { status: 'degraded', detail: 'Tests table empty' }
    }
    return { status: 'degraded', detail: 'no test count available' }
  }

  const hours = ageHours(snap.lastIngestedAt)
  if (hours == null) {
    return { status: 'degraded', detail: 'no created_at on tests' }
  }

  const in24 = snap.ingested24h ?? 0
  const ageLabel =
    hours < 1
      ? `${Math.round(hours * 60)}m ago`
      : hours < 48
        ? `${hours}h ago`
        : `${Math.round(hours / 24)}d ago`

  // Sources offline: still report age, but don't alarm as hard — factory feed may be intentionally cut.
  if (opts?.sourcesAllDown) {
    return {
      status: 'ok',
      detail: `last ingest ${ageLabel} · ${in24} in 24h · sources offline`,
    }
  }

  if (hours >= 48) {
    return {
      status: 'degraded',
      detail: `no new tests in ${ageLabel} · ${in24} in 24h`,
    }
  }

  if (in24 === 0 && hours >= 24) {
    return {
      status: 'degraded',
      detail: `0 ingested in 24h · last ${ageLabel}`,
    }
  }

  return {
    status: 'ok',
    detail: `last ${ageLabel} · ${in24} in 24h`,
  }
}

/**
 * Annotation todo backlog (FAIL with no annotation).
 * Soft thresholds — large backlogs need attention, empty is fine.
 */
export function todoStatus(
  count: number | null,
  queryOk: boolean,
  queryError?: string
): { status: HealthStatus; detail: string } {
  if (!queryOk || count == null) {
    return {
      status: 'degraded',
      detail: queryError || 'could not query annotation backlog',
    }
  }

  if (count === 0) {
    return { status: 'ok', detail: 'no unannotated fails' }
  }

  // Soft: growing queue is ops friction, not an outage.
  if (count >= 200) {
    return {
      status: 'degraded',
      detail: `${count.toLocaleString()} unannotated fails (large backlog)`,
    }
  }
  if (count >= 50) {
    return {
      status: 'degraded',
      detail: `${count.toLocaleString()} unannotated fails`,
    }
  }

  return {
    status: 'ok',
    detail: `${count.toLocaleString()} unannotated fail${count === 1 ? '' : 's'}`,
  }
}
