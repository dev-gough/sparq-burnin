import type { Client } from 'pg'
import { getPool } from '@/lib/db'
import { loadIngestConfig } from '@/lib/ingest/stations'

export interface StationTestStats {
  totalTests: number
  passCount: number
  failCount: number
  invalidCount: number
  retestCount: number
  otherCount: number
  uniqueSerials: number
  testsLast24h: number
  testsLast7d: number
  firstIngestAt: string | null
  lastIngestAt: string | null
}

export interface StationControlRow {
  stationId: string
  enabled: boolean
  reason: string | null
  updatedAt: string | null
  updatedBy: string | null
  revision: number
  /** Present in config.json ingest.stations */
  hasSecret: boolean
  lastIngestAt: string | null
  stats: StationTestStats
}

/**
 * Run `fn` with a client checked out of the shared pool (src/lib/db.ts).
 * The `(client: Client)` signature is kept for compatibility with existing
 * callers/mocks; PoolClient shares the ClientBase query surface with Client,
 * so the cast is safe for everything callers do (query()).
 */
export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const poolClient = await getPool().connect()
  try {
    const result = await fn(poolClient as unknown as Client)
    poolClient.release()
    return result
  } catch (err) {
    // Destroy the connection on error so a failure mid-statement can never
    // return a dirty client to the pool. Errors are rare; the churn is fine.
    poolClient.release(true)
    throw err
  }
}

/** Whether the station may run tests / ingest. No row → allowed (default true). */
export async function isStationEnabled(stationId: string): Promise<boolean> {
  return withClient(async (client) => {
    const r = await client.query(
      `SELECT enabled FROM StationControls WHERE station_id = $1`,
      [stationId]
    )
    if (r.rows.length === 0) return true
    return Boolean(r.rows[0].enabled)
  })
}

export async function getStationControl(
  stationId: string
): Promise<{
  stationId: string
  enabled: boolean
  reason: string | null
  updatedAt: string | null
  updatedBy: string | null
  revision: number
} | null> {
  return withClient(async (client) => {
    const r = await client.query(
      `SELECT station_id, enabled, reason, updated_at, updated_by, revision
       FROM StationControls WHERE station_id = $1`,
      [stationId]
    )
    if (r.rows.length === 0) {
      return {
        stationId,
        enabled: true,
        reason: null,
        updatedAt: null,
        updatedBy: null,
        revision: 0,
      }
    }
    const row = r.rows[0]
    return {
      stationId: row.station_id as string,
      enabled: Boolean(row.enabled),
      reason: (row.reason as string) ?? null,
      updatedAt: row.updated_at
        ? new Date(row.updated_at as string).toISOString()
        : null,
      updatedBy: (row.updated_by as string) ?? null,
      revision: Number(row.revision) || 0,
    }
  })
}

/**
 * Historical per-station aggregates scan all of Tests. They back the
 * /stations admin page (polled every 30 s per open tab), so they are cached
 * module-level with a short TTL: N tabs cost one grouped scan per TTL window
 * instead of one per-station LATERAL scan per request. Control rows
 * (enabled/reason/revision) are deliberately NOT cached — a toggle must be
 * visible on the very next read. Staleness bound on stats (including which
 * brand-new station ids appear) is STATION_STATS_TTL_MS, matching the page's
 * own poll interval.
 */
const STATION_STATS_TTL_MS = 30_000
let statsCache: {
  expiresAt: number
  byStation: Map<string, StationTestStats>
} | null = null

async function loadStatsByStation(
  client: Client
): Promise<Map<string, StationTestStats>> {
  const r = await client.query(`
    SELECT
      station_id,
      COUNT(*)::int AS total_tests,
      COUNT(*) FILTER (WHERE upper(overall_status) = 'PASS')::int AS pass_count,
      COUNT(*) FILTER (WHERE upper(overall_status) = 'FAIL')::int AS fail_count,
      COUNT(*) FILTER (WHERE upper(overall_status) = 'INVALID')::int AS invalid_count,
      COUNT(*) FILTER (WHERE upper(overall_status) = 'RETEST')::int AS retest_count,
      COUNT(*) FILTER (
        WHERE upper(COALESCE(overall_status, '')) NOT IN ('PASS', 'FAIL', 'INVALID', 'RETEST')
      )::int AS other_count,
      COUNT(DISTINCT inv_id)::int AS unique_serials,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS tests_last_24h,
      COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS tests_last_7d,
      MIN(created_at) AS first_ingest_at,
      MAX(created_at) AS last_ingest_at
    FROM Tests
    WHERE station_id IS NOT NULL AND station_id <> ''
    GROUP BY station_id
  `)
  const byStation = new Map<string, StationTestStats>()
  for (const row of r.rows) {
    byStation.set(row.station_id as string, {
      totalTests: Number(row.total_tests) || 0,
      passCount: Number(row.pass_count) || 0,
      failCount: Number(row.fail_count) || 0,
      invalidCount: Number(row.invalid_count) || 0,
      retestCount: Number(row.retest_count) || 0,
      otherCount: Number(row.other_count) || 0,
      uniqueSerials: Number(row.unique_serials) || 0,
      testsLast24h: Number(row.tests_last_24h) || 0,
      testsLast7d: Number(row.tests_last_7d) || 0,
      firstIngestAt: row.first_ingest_at
        ? new Date(row.first_ingest_at as string).toISOString()
        : null,
      lastIngestAt: row.last_ingest_at
        ? new Date(row.last_ingest_at as string).toISOString()
        : null,
    })
  }
  return byStation
}

const EMPTY_STATS: StationTestStats = {
  totalTests: 0,
  passCount: 0,
  failCount: 0,
  invalidCount: 0,
  retestCount: 0,
  otherCount: 0,
  uniqueSerials: 0,
  testsLast24h: 0,
  testsLast7d: 0,
  firstIngestAt: null,
  lastIngestAt: null,
}

export async function listStationControls(): Promise<StationControlRow[]> {
  return withClient(async (client) => {
    const ingest = loadIngestConfig()
    const configIds = Object.keys(ingest.stations)

    const now = Date.now()
    let statsByStation: Map<string, StationTestStats>
    if (statsCache && statsCache.expiresAt > now) {
      statsByStation = statsCache.byStation
    } else {
      statsByStation = await loadStatsByStation(client)
      statsCache = {
        expiresAt: now + STATION_STATS_TTL_MS,
        byStation: statsByStation,
      }
    }

    // Control rows are read fresh on every call (never cached).
    const controls = await client.query(
      `SELECT station_id, enabled, reason, updated_at, updated_by, revision
       FROM StationControls`
    )
    const controlByStation = new Map<
      string,
      (typeof controls.rows)[number]
    >()
    for (const row of controls.rows) {
      controlByStation.set(row.station_id as string, row)
    }

    // Station universe = config.json stations ∪ stations seen in Tests
    // (via the cached stats) ∪ StationControls rows; blank ids excluded.
    const ids = new Set<string>()
    for (const id of configIds) if (id) ids.add(id)
    for (const id of statsByStation.keys()) ids.add(id)
    for (const id of controlByStation.keys()) if (id) ids.add(id)

    return [...ids].sort().map((stationId) => {
      const c = controlByStation.get(stationId)
      const stats = statsByStation.get(stationId) ?? { ...EMPTY_STATS }
      return {
        stationId,
        enabled: c ? Boolean(c.enabled) : true,
        reason: c ? ((c.reason as string) ?? null) : null,
        updatedAt: c?.updated_at
          ? new Date(c.updated_at as string).toISOString()
          : null,
        updatedBy: c ? ((c.updated_by as string) ?? null) : null,
        revision: c ? Number(c.revision) || 0 : 0,
        hasSecret: Boolean(ingest.stations[stationId]?.secret),
        lastIngestAt: stats.lastIngestAt,
        stats,
      }
    })
  })
}

export async function setStationEnabled(params: {
  stationId: string
  enabled: boolean
  reason?: string | null
  updatedBy: string
}): Promise<{
  stationId: string
  enabled: boolean
  reason: string | null
  updatedAt: string
  updatedBy: string
  revision: number
}> {
  const reason =
    params.reason === undefined || params.reason === ''
      ? null
      : params.reason

  return withClient(async (client) => {
    const r = await client.query(
      `
      INSERT INTO StationControls (station_id, enabled, reason, updated_at, updated_by, revision)
      VALUES ($1, $2, $3, NOW(), $4, 1)
      ON CONFLICT (station_id) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        reason = EXCLUDED.reason,
        updated_at = NOW(),
        updated_by = EXCLUDED.updated_by,
        revision = StationControls.revision + 1
      RETURNING station_id, enabled, reason, updated_at, updated_by, revision
      `,
      [params.stationId, params.enabled, reason, params.updatedBy]
    )
    const row = r.rows[0]
    return {
      stationId: row.station_id as string,
      enabled: Boolean(row.enabled),
      reason: (row.reason as string) ?? null,
      updatedAt: new Date(row.updated_at as string).toISOString(),
      updatedBy: row.updated_by as string,
      revision: Number(row.revision) || 1,
    }
  })
}
