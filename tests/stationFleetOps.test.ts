import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  row: {} as Record<string, unknown>,
  error: null as Error | null,
  sql: '',
  connected: false,
  ended: false,
}))

vi.mock('pg', () => ({
  Client: class {
    async connect() {
      state.connected = true
    }

    async query(sql: string) {
      state.sql = sql
      if (state.error) throw state.error
      return { rows: [state.row] }
    }

    async end() {
      state.ended = true
    }
  },
}))

vi.mock('@/lib/config', () => ({
  getDatabaseConfig: () => ({
    host: 'localhost',
    port: 5432,
    database: 'burnin_dashboard',
    user: 'postgres',
    password: 'test-only',
  }),
}))

import { snapshotStationFleet } from '@/lib/stationFleetOps'

beforeEach(() => {
  state.row = {}
  state.error = null
  state.sql = ''
  state.connected = false
  state.ended = false
})

describe('snapshotStationFleet', () => {
  it('returns aggregate fleet counts and per-station test counts', async () => {
    state.row = {
      total_stations: 5,
      active_stations: 4,
      revoked_stations: 1,
      reporting_stations: 2,
      active_without_tests: 2,
      total_station_tests: 17,
      pending_enrollments: 1,
      hidden_stations: 1,
      last_added_at: '2026-09-09T01:10:04.862Z',
      last_added_station_id: 'MFG-assigned-2',
      last_added_candidate_id: 'MFG-LINE2-abcd',
      reporting: [
        {
          stationId: 'MFG-assigned-1',
          candidateStationId: 'MFG-LINE1-1234',
          testCount: 12,
          lastTestAt: '2026-09-09T12:00:00.000Z',
          revoked: false,
        },
        {
          stationId: 'MFG-assigned-old',
          candidateStationId: null,
          testCount: 5,
          lastTestAt: null,
          revoked: true,
        },
      ],
    }

    const snapshot = await snapshotStationFleet()

    expect(snapshot).toMatchObject({
      ok: true,
      totalStations: 5,
      activeStations: 4,
      revokedStations: 1,
      reportingStations: 2,
      activeWithoutTests: 2,
      totalStationTests: 17,
      pendingEnrollments: 1,
      hiddenStations: 1,
      lastAddedAt: '2026-09-09T01:10:04.862Z',
      lastAddedStationId: 'MFG-assigned-2',
      lastAddedCandidateId: 'MFG-LINE2-abcd',
      reporting: [
        {
          stationId: 'MFG-assigned-1',
          candidateStationId: 'MFG-LINE1-1234',
          testCount: 12,
          lastTestAt: '2026-09-09T12:00:00.000Z',
          revoked: false,
        },
        {
          stationId: 'MFG-assigned-old',
          candidateStationId: null,
          testCount: 5,
          lastTestAt: null,
          revoked: true,
        },
      ],
    })
    expect(state.connected).toBe(true)
    expect(state.ended).toBe(true)
    expect(state.sql).toContain('FROM StationCredentials')
    expect(state.sql).toContain('FROM StationEnrollments')
    expect(state.sql).toContain('FROM StationHidden')
    expect(state.sql).not.toMatch(/secret|fingerprint|request_ip/i)
  })

  it('fails closed when station schema or query is unavailable', async () => {
    state.error = new Error('relation "stationhidden" does not exist')

    const snapshot = await snapshotStationFleet()

    expect(snapshot).toMatchObject({
      ok: false,
      error: 'relation "stationhidden" does not exist',
      totalStations: null,
      reporting: [],
    })
    expect(state.ended).toBe(true)
  })
})
