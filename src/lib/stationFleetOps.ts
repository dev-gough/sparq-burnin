/**
 * Station fleet snapshot for Control Center.
 *
 * This deliberately reports metadata and counts only. Enrollment secrets,
 * fingerprints, request IDs, and source IPs never leave the database.
 */
import { Client } from 'pg'
import { getDatabaseConfig } from './config'

export interface ReportingStation {
  stationId: string
  candidateStationId: string | null
  testCount: number
  lastTestAt: string | null
  revoked: boolean
}

export interface StationFleetSnapshot {
  ok: boolean
  error?: string
  totalStations: number | null
  activeStations: number | null
  revokedStations: number | null
  reportingStations: number | null
  activeWithoutTests: number | null
  totalStationTests: number | null
  pendingEnrollments: number | null
  hiddenStations: number | null
  lastAddedAt: string | null
  lastAddedStationId: string | null
  lastAddedCandidateId: string | null
  reporting: ReportingStation[]
  latencyMs: number
}

const QUERY_TIMEOUT_MS = 800
const CONNECT_TIMEOUT_MS = 500

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })
}

function toIso(value: unknown): string | null {
  if (value == null) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value !== 'string') return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function emptySnapshot(started: number, error: unknown): StationFleetSnapshot {
  return {
    ok: false,
    error: error instanceof Error ? error.message : 'station fleet query failed',
    totalStations: null,
    activeStations: null,
    revokedStations: null,
    reportingStations: null,
    activeWithoutTests: null,
    totalStationTests: null,
    pendingEnrollments: null,
    hiddenStations: null,
    lastAddedAt: null,
    lastAddedStationId: null,
    lastAddedCandidateId: null,
    reporting: [],
    latencyMs: Date.now() - started,
  }
}

export async function snapshotStationFleet(): Promise<StationFleetSnapshot> {
  const started = Date.now()
  const client = new Client({
    ...getDatabaseConfig(),
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  })

  try {
    await withTimeout(client.connect(), CONNECT_TIMEOUT_MS + 100)
    const result = await withTimeout(
      client.query(`
        WITH credential_tests AS (
          SELECT
            c.station_id,
            c.candidate_station_id,
            c.created_at,
            c.revoked_at,
            COUNT(t.test_id)::int AS test_count,
            MAX(t.created_at) AS last_test_at
          FROM StationCredentials c
          LEFT JOIN Tests t ON t.station_id = c.station_id
          GROUP BY
            c.station_id,
            c.candidate_station_id,
            c.created_at,
            c.revoked_at
        )
        SELECT
          COUNT(*)::int AS total_stations,
          COUNT(*) FILTER (WHERE revoked_at IS NULL)::int AS active_stations,
          COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked_stations,
          COUNT(*) FILTER (WHERE test_count > 0)::int AS reporting_stations,
          COUNT(*) FILTER (
            WHERE revoked_at IS NULL AND test_count = 0
          )::int AS active_without_tests,
          COALESCE(SUM(test_count), 0)::int AS total_station_tests,
          MAX(created_at) AS last_added_at,
          (ARRAY_AGG(station_id ORDER BY created_at DESC))[1]
            AS last_added_station_id,
          (ARRAY_AGG(candidate_station_id ORDER BY created_at DESC))[1]
            AS last_added_candidate_id,
          (SELECT COUNT(*)::int
             FROM StationEnrollments
            WHERE status = 'pending') AS pending_enrollments,
          (SELECT COUNT(*)::int FROM StationHidden) AS hidden_stations,
          COALESCE(
            JSON_AGG(
              JSON_BUILD_OBJECT(
                'stationId', station_id,
                'candidateStationId', candidate_station_id,
                'testCount', test_count,
                'lastTestAt', last_test_at,
                'revoked', revoked_at IS NOT NULL
              ) ORDER BY station_id
            ) FILTER (WHERE test_count > 0),
            '[]'::json
          ) AS reporting
        FROM credential_tests
      `),
      QUERY_TIMEOUT_MS
    )

    const row = result.rows[0] ?? {}
    const reportingRaw: unknown[] = Array.isArray(row.reporting)
      ? row.reporting
      : []
    const reporting = reportingRaw.flatMap((value): ReportingStation[] => {
      if (!value || typeof value !== 'object') return []
      const item = value as Record<string, unknown>
      const stationId = item.stationId
      const testCount = toCount(item.testCount)
      if (typeof stationId !== 'string' || testCount == null) return []
      return [
        {
          stationId,
          candidateStationId:
            typeof item.candidateStationId === 'string'
              ? item.candidateStationId
              : null,
          testCount,
          lastTestAt: toIso(item.lastTestAt),
          revoked: item.revoked === true,
        },
      ]
    })

    return {
      ok: true,
      totalStations: toCount(row.total_stations),
      activeStations: toCount(row.active_stations),
      revokedStations: toCount(row.revoked_stations),
      reportingStations: toCount(row.reporting_stations),
      activeWithoutTests: toCount(row.active_without_tests),
      totalStationTests: toCount(row.total_station_tests),
      pendingEnrollments: toCount(row.pending_enrollments),
      hiddenStations: toCount(row.hidden_stations),
      lastAddedAt: toIso(row.last_added_at),
      lastAddedStationId:
        typeof row.last_added_station_id === 'string'
          ? row.last_added_station_id
          : null,
      lastAddedCandidateId:
        typeof row.last_added_candidate_id === 'string'
          ? row.last_added_candidate_id
          : null,
      reporting,
      latencyMs: Date.now() - started,
    }
  } catch (error) {
    return emptySnapshot(started, error)
  } finally {
    try {
      await client.end()
    } catch {
      /* ignore */
    }
  }
}
