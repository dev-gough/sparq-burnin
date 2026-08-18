/**
 * resolveStationSecret (docs/STATION_ENROLLMENT_PLAN.md §3.3):
 * DB-first (StationCredentials), config.json/env fallback, revoked skipped,
 * DB errors propagate (auth callers fail closed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const CONFIG_STATION = 'LabBurnIn-1'
const CONFIG_SECRET = 'config-secret'

vi.mock('@/lib/config', () => ({
  loadConfig: () => ({
    ingest: {
      stations: { [CONFIG_STATION]: { secret: CONFIG_SECRET } },
    },
  }),
}))

// Fake StationCredentials store. The query under test filters revoked rows in
// SQL (`revoked_at IS NULL`); the fake honors that filter so the test pins
// that revoked rows never resolve from the DB path.
const credentials = new Map<string, { secret: string; revoked: boolean }>()
let failDb = false

vi.mock('@/lib/db', () => ({
  getPool: () => ({
    query: async (sql: string, params: string[]) => {
      if (failDb) throw new Error('db unreachable')
      if (!sql.includes('FROM StationCredentials')) {
        throw new Error(`unexpected query: ${sql}`)
      }
      expect(sql).toContain('revoked_at IS NULL')
      const c = credentials.get(params[0])
      if (!c || c.revoked) return { rows: [] }
      return { rows: [{ secret: c.secret }] }
    },
  }),
}))

import { resolveStationSecret } from '@/lib/ingest/stations'

beforeEach(() => {
  credentials.clear()
  failDb = false
  delete process.env.INGEST_STATIONS_JSON
})

describe('resolveStationSecret', () => {
  it('DB credential wins over a config entry for the same station', async () => {
    credentials.set(CONFIG_STATION, { secret: 'db-secret', revoked: false })
    await expect(resolveStationSecret(CONFIG_STATION)).resolves.toEqual({
      secret: 'db-secret',
    })
  })

  it('falls back to config.json when there is no DB credential', async () => {
    await expect(resolveStationSecret(CONFIG_STATION)).resolves.toEqual({
      secret: CONFIG_SECRET,
    })
  })

  it('resolves a DB-only (auto-enrolled) station absent from config', async () => {
    credentials.set('MFG-LINE3PC-a4f2', { secret: 'enrolled', revoked: false })
    await expect(resolveStationSecret('MFG-LINE3PC-a4f2')).resolves.toEqual({
      secret: 'enrolled',
    })
  })

  it('skips a revoked DB credential (config fallback still applies)', async () => {
    credentials.set(CONFIG_STATION, { secret: 'db-secret', revoked: true })
    await expect(resolveStationSecret(CONFIG_STATION)).resolves.toEqual({
      secret: CONFIG_SECRET,
    })
  })

  it('revoked DB credential with no config entry → undefined (auth denies)', async () => {
    credentials.set('MFG-LINE3PC-a4f2', { secret: 'enrolled', revoked: true })
    await expect(
      resolveStationSecret('MFG-LINE3PC-a4f2')
    ).resolves.toBeUndefined()
  })

  it('unknown everywhere → undefined', async () => {
    await expect(resolveStationSecret('NoSuchStation')).resolves.toBeUndefined()
  })

  it('DB error propagates so HMAC callers fail closed', async () => {
    failDb = true
    await expect(resolveStationSecret(CONFIG_STATION)).rejects.toThrow(
      'db unreachable'
    )
  })
})
