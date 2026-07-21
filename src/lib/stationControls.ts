import { Client } from 'pg'
import { getDatabaseConfig } from '@/lib/config'
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

const emptyStats = (): StationTestStats => ({
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
})

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client(getDatabaseConfig())
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end().catch(() => undefined)
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

export async function listStationControls(): Promise<StationControlRow[]> {
  return withClient(async (client) => {
    const ingest = loadIngestConfig()
    const configIds = Object.keys(ingest.stations)

    const r = await client.query(
      `
      SELECT
        s.station_id,
        COALESCE(c.enabled, true) AS enabled,
        c.reason,
        c.updated_at,
        c.updated_by,
        COALESCE(c.revision, 0) AS revision,
        COALESCE(st.total_tests, 0)::int AS total_tests,
        COALESCE(st.pass_count, 0)::int AS pass_count,
        COALESCE(st.fail_count, 0)::int AS fail_count,
        COALESCE(st.invalid_count, 0)::int AS invalid_count,
        COALESCE(st.retest_count, 0)::int AS retest_count,
        COALESCE(st.other_count, 0)::int AS other_count,
        COALESCE(st.unique_serials, 0)::int AS unique_serials,
        COALESCE(st.tests_last_24h, 0)::int AS tests_last_24h,
        COALESCE(st.tests_last_7d, 0)::int AS tests_last_7d,
        st.first_ingest_at,
        st.last_ingest_at
      FROM (
        SELECT station_id FROM StationControls
        UNION
        SELECT DISTINCT station_id FROM Tests WHERE station_id IS NOT NULL
        UNION
        SELECT unnest($1::text[]) AS station_id
      ) s
      LEFT JOIN StationControls c ON c.station_id = s.station_id
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*)::int AS total_tests,
          COUNT(*) FILTER (WHERE upper(t.overall_status) = 'PASS')::int AS pass_count,
          COUNT(*) FILTER (WHERE upper(t.overall_status) = 'FAIL')::int AS fail_count,
          COUNT(*) FILTER (WHERE upper(t.overall_status) = 'INVALID')::int AS invalid_count,
          COUNT(*) FILTER (WHERE upper(t.overall_status) = 'RETEST')::int AS retest_count,
          COUNT(*) FILTER (
            WHERE upper(COALESCE(t.overall_status, '')) NOT IN ('PASS', 'FAIL', 'INVALID', 'RETEST')
          )::int AS other_count,
          COUNT(DISTINCT t.inv_id)::int AS unique_serials,
          COUNT(*) FILTER (WHERE t.created_at >= NOW() - INTERVAL '24 hours')::int AS tests_last_24h,
          COUNT(*) FILTER (WHERE t.created_at >= NOW() - INTERVAL '7 days')::int AS tests_last_7d,
          MIN(t.created_at) AS first_ingest_at,
          MAX(t.created_at) AS last_ingest_at
        FROM Tests t
        WHERE t.station_id = s.station_id
      ) st ON true
      WHERE s.station_id IS NOT NULL AND s.station_id <> ''
      ORDER BY s.station_id
    `,
      [configIds]
    )

    return r.rows.map((row) => {
      const lastIngestAt = row.last_ingest_at
        ? new Date(row.last_ingest_at as string).toISOString()
        : null
      const firstIngestAt = row.first_ingest_at
        ? new Date(row.first_ingest_at as string).toISOString()
        : null
      const stats: StationTestStats = {
        totalTests: Number(row.total_tests) || 0,
        passCount: Number(row.pass_count) || 0,
        failCount: Number(row.fail_count) || 0,
        invalidCount: Number(row.invalid_count) || 0,
        retestCount: Number(row.retest_count) || 0,
        otherCount: Number(row.other_count) || 0,
        uniqueSerials: Number(row.unique_serials) || 0,
        testsLast24h: Number(row.tests_last_24h) || 0,
        testsLast7d: Number(row.tests_last_7d) || 0,
        firstIngestAt,
        lastIngestAt,
      }
      return {
        stationId: row.station_id as string,
        enabled: Boolean(row.enabled),
        reason: (row.reason as string) ?? null,
        updatedAt: row.updated_at
          ? new Date(row.updated_at as string).toISOString()
          : null,
        updatedBy: (row.updated_by as string) ?? null,
        revision: Number(row.revision) || 0,
        hasSecret: Boolean(ingest.stations[row.station_id as string]?.secret),
        lastIngestAt,
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
