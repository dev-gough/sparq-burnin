import { describe, it, expect } from 'vitest'
import { migrations } from '../scripts/migrate-db'

describe('migration 018 managed_station_provisioning', () => {
  const migration = migrations.find((m) => m.id === '018')

  it('is additive after 017 and does not edit 017', () => {
    expect(migration).toBeDefined()
    const ids = migrations.map((m) => m.id)
    expect(ids.indexOf('018')).toBeGreaterThan(ids.indexOf('017'))
    const prior = migrations.find((m) => m.id === '017')
    expect(prior?.sql ?? '').not.toContain('enrollment_request_id')
  })

  it('adds nullable request/candidate columns (legacy rows stay valid)', () => {
    const sql = migration!.sql
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS enrollment_request_id TEXT')
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS candidate_station_id TEXT')
    expect(sql).not.toMatch(
      /enrollment_request_id\s+TEXT\s+NOT NULL/i
    )
    expect(sql).not.toMatch(/candidate_station_id\s+TEXT\s+NOT NULL/i)
  })

  it('pins the idempotency unique index and active-candidate unique index', () => {
    const sql = migration!.sql
    expect(sql).toContain('uq_stationenrollments_token_request')
    expect(sql).toMatch(
      /UNIQUE INDEX IF NOT EXISTS uq_stationenrollments_token_request[\s\S]*\(token_id, enrollment_request_id\)[\s\S]*WHERE enrollment_request_id IS NOT NULL/
    )
    expect(sql).toContain('uq_stationcredentials_active_candidate')
    expect(sql).toMatch(
      /UNIQUE INDEX IF NOT EXISTS uq_stationcredentials_active_candidate[\s\S]*\(candidate_station_id\)[\s\S]*WHERE revoked_at IS NULL AND candidate_station_id IS NOT NULL/
    )
    expect(sql).toMatch(
      /enrollment_request_id IS NULL[\s\S]*OR enrollment_request_id ~ '\^\[0-9a-f\]\{32\}\$'/
    )
  })
})
