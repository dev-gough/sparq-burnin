/**
 * UI-only station hide (StationHidden): hide/unhide does not touch
 * enablement or credentials; hidden ids drop out of dashboard options.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { migrations } from '../scripts/migrate-db'

const ADMIN_EMAIL = 'admin@sparqsys.com'

class FakeHiddenDb {
  hidden = new Map<
    string,
    { station_id: string; hidden_at: string; hidden_by: string | null }
  >()
  credentials = new Map<string, { revoked_at: string | null }>()
  testStationIds: string[] = []

  async dispatch(
    sql: string,
    params: unknown[]
  ): Promise<{ rows: Record<string, unknown>[] }> {
    const s = sql.trim()

    if (s.startsWith('INSERT INTO StationHidden')) {
      expect(s).not.toMatch(/StationControls/i)
      expect(s).not.toMatch(/revision/i)
      const row = {
        station_id: String(params[0]),
        hidden_at: new Date().toISOString(),
        hidden_by: (params[1] as string | null) ?? null,
      }
      this.hidden.set(row.station_id, row)
      return { rows: [row] }
    }

    if (s.startsWith('DELETE FROM StationHidden')) {
      this.hidden.delete(String(params[0]))
      return { rows: [] }
    }

    if (s.includes('FROM StationHidden') && !s.includes('FROM Tests')) {
      return { rows: [...this.hidden.values()] }
    }

    if (s.includes('INSERT INTO StationControls')) {
      return {
        rows: [
          {
            station_id: params[0],
            enabled: params[1],
            reason: params[2],
            updated_at: new Date().toISOString(),
            updated_by: params[3],
            revision: 1,
          },
        ],
      }
    }

    if (s.includes('FROM StationControls')) {
      return { rows: [] }
    }

    if (s.includes('FROM StationCredentials')) {
      return {
        rows: [...this.credentials.entries()].map(([station_id, c]) => ({
          station_id,
          revoked_at: c.revoked_at,
        })),
      }
    }

    if (s.includes('FROM Tests') && s.includes('GROUP BY')) {
      return {
        rows: this.testStationIds.map((station_id) => ({
          station_id,
          total_tests: 0,
          pass_count: 0,
          fail_count: 0,
          invalid_count: 0,
          retest_count: 0,
          other_count: 0,
          unique_serials: 0,
          tests_last_24h: 0,
          tests_last_7d: 0,
          first_ingest_at: null,
          last_ingest_at: null,
        })),
      }
    }

    if (s.includes('FROM Tests') && s.includes('StationHidden')) {
      expect(s).toContain('NOT EXISTS')
      return {
        rows: this.testStationIds
          .filter((id) => !this.hidden.has(id))
          .map((station_id) => ({ station_id })),
      }
    }

    throw new Error(`FakeHiddenDb: unhandled SQL: ${s.slice(0, 120)}`)
  }
}

let db: FakeHiddenDb
let nowMs = 1_700_000_000_000

vi.mock('@/lib/auth-check', () => ({
  requireStationAdminAuth: async () => ({
    error: null,
    session: { user: { email: ADMIN_EMAIL } },
  }),
  requireAuth: async () => ({
    error: null,
    session: { user: { email: ADMIN_EMAIL } },
  }),
}))

vi.mock('@/lib/ingest/stations', () => ({
  loadIngestConfig: () => ({ stations: {} }),
}))

vi.mock('@/lib/db', () => ({
  getPool: () => ({
    connect: async () => ({
      query: (sql: string, params?: unknown[]) =>
        db.dispatch(sql, params ?? []),
      release: () => {},
    }),
    query: (sql: string, params?: unknown[]) =>
      db.dispatch(sql, params ?? []),
  }),
}))

vi.spyOn(Date, 'now').mockImplementation(() => nowMs)

import {
  listStationControls,
  setStationHidden,
} from '@/lib/stationControls'
import { PATCH } from '@/app/api/stations/[id]/route'
import { GET as listOptions } from '@/app/api/stations/options/route'

const patchRequest = (body: unknown): NextRequest =>
  new Request('https://dashboard.example/api/stations/x', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest

const props = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  db = new FakeHiddenDb()
  nowMs += 60_000
})

describe('migration 019 station_hidden', () => {
  const migration = migrations.find((m) => m.id === '019')

  it('is additive after 018 and creates StationHidden', () => {
    expect(migration).toBeDefined()
    const ids = migrations.map((m) => m.id)
    expect(ids.indexOf('019')).toBeGreaterThan(ids.indexOf('018'))
    const sql = migration!.sql
    expect(sql).toContain('CREATE TABLE StationHidden')
    expect(sql).toContain('station_id TEXT PRIMARY KEY')
    expect(sql).not.toMatch(/StationControls/i)
  })
})

describe('setStationHidden / listStationControls', () => {
  it('hide is a StationHidden upsert and shows up as hiddenAt on the list row', async () => {
    db.credentials.set('MFG-lab-laptop', { revoked_at: null })

    const listed = await listStationControls()
    expect(listed.find((s) => s.stationId === 'MFG-lab-laptop')?.hiddenAt).toBeNull()

    const hidden = await setStationHidden({
      stationId: 'MFG-lab-laptop',
      hidden: true,
      hiddenBy: ADMIN_EMAIL,
    })
    expect(hidden.hiddenAt).toBeTruthy()
    expect(hidden.hiddenBy).toBe(ADMIN_EMAIL)

    const after = await listStationControls()
    const row = after.find((s) => s.stationId === 'MFG-lab-laptop')
    expect(row?.hiddenAt).toBeTruthy()
    expect(row?.hasDbCredential).toBe(true)
    expect(row?.enabled).toBe(true)
  })

  it('unhide deletes the StationHidden row', async () => {
    db.credentials.set('MFG-lab-laptop', { revoked_at: null })
    await setStationHidden({
      stationId: 'MFG-lab-laptop',
      hidden: true,
      hiddenBy: ADMIN_EMAIL,
    })
    const unhidden = await setStationHidden({
      stationId: 'MFG-lab-laptop',
      hidden: false,
      hiddenBy: ADMIN_EMAIL,
    })
    expect(unhidden.hiddenAt).toBeNull()
    const listed = await listStationControls()
    expect(listed.find((s) => s.stationId === 'MFG-lab-laptop')?.hiddenAt).toBeNull()
  })
})

describe('PATCH /api/stations/[id] hidden', () => {
  it('hides via { hidden: true } without requiring enabled', async () => {
    const response = await PATCH(patchRequest({ hidden: true }), props('MFG-lab'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      stationId: 'MFG-lab',
      hiddenBy: ADMIN_EMAIL,
    })
    expect(body.hiddenAt).toBeTruthy()
    expect(db.hidden.has('MFG-lab')).toBe(true)
  })

  it('unhides via { hidden: false }', async () => {
    db.hidden.set('MFG-lab', {
      station_id: 'MFG-lab',
      hidden_at: new Date().toISOString(),
      hidden_by: ADMIN_EMAIL,
    })
    const response = await PATCH(patchRequest({ hidden: false }), props('MFG-lab'))
    expect(response.status).toBe(200)
    expect(db.hidden.has('MFG-lab')).toBe(false)
  })

  it('rejects a body with neither enabled nor hidden', async () => {
    const response = await PATCH(patchRequest({ reason: 'nope' }), props('MFG-lab'))
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'enabled or hidden must be a boolean',
    })
  })

  it('still accepts { enabled } without hidden', async () => {
    const response = await PATCH(
      patchRequest({ enabled: false, reason: 'maintenance' }),
      props('MFG-lab')
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.station).toMatchObject({
      stationId: 'MFG-lab',
      enabled: false,
      reason: 'maintenance',
    })
  })
})

describe('GET /api/stations/options', () => {
  it('omits hidden station ids', async () => {
    db.testStationIds = ['Line-1', 'MFG-lab']
    db.hidden.set('MFG-lab', {
      station_id: 'MFG-lab',
      hidden_at: new Date().toISOString(),
      hidden_by: ADMIN_EMAIL,
    })
    const response = await listOptions()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ stations: ['Line-1'] })
  })
})
