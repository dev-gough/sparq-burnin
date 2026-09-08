/**
 * Admin surface for station enrollment (docs/STATION_ENROLLMENT_PLAN.md §3.4):
 * enrollment approval queue, bootstrap token mint/list/revoke, credential
 * revoke. Fake pg client (processPayload.test.ts style); requireStationAdminAuth
 * is mocked to an allowed session (the gate itself is covered by its own
 * module and the middleware pinning test).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const ADMIN_EMAIL = 'admin@sparqsys.com'
let denyAuth = false

vi.mock('@/lib/auth-check', () => ({
  requireStationAdminAuth: async () =>
    denyAuth
      ? {
          error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
          session: null,
        }
      : { error: null, session: { user: { email: ADMIN_EMAIL } } },
}))

interface EnrollmentRow {
  id: number
  station_id: string
  secret: string
  token_id: string | null
  fingerprint: Record<string, string> | null
  request_ip: string | null
  status: string
  requested_at: string
  decided_at: string | null
  decided_by: string | null
  candidate_station_id: string | null
  enrollment_request_id: string | null
}

class FakeAdminDb {
  enrollments: EnrollmentRow[] = []
  credentials = new Map<
    string,
    {
      secret: string
      revoked_at: string | null
      candidate_station_id: string | null
      enrollment_request_id: string | null
    }
  >()
  tokens = new Map<
    string,
    {
      token_secret: string
      label: string
      created_by: string
      created_at: string
      expires_at: string
      max_uses: number | null
      uses: number
      revoked_at: string | null
    }
  >()
  nextEnrollmentId = 1

  seedPending(
    stationId: string,
    secret: string,
    extras: Partial<EnrollmentRow> = {}
  ): EnrollmentRow {
    const row: EnrollmentRow = {
      id: this.nextEnrollmentId++,
      station_id: stationId,
      secret,
      token_id: 'tok111111111',
      fingerprint: {
        hostname: 'LINE3PC',
        machineId: 'd4be1a7c9e02',
        appVersion: '1.2.3',
      },
      request_ip: '10.1.2.3',
      status: 'pending',
      requested_at: new Date().toISOString(),
      decided_at: null,
      decided_by: null,
      candidate_station_id: extras.candidate_station_id ?? stationId,
      enrollment_request_id: extras.enrollment_request_id ?? 'b'.repeat(32),
      ...extras,
    }
    this.enrollments.push(row)
    return row
  }

  async dispatch(
    sql: string,
    params: (string | number | null)[]
  ): Promise<{ rows: Record<string, unknown>[] }> {
    const s = sql.trim()

    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) return { rows: [] }

    if (s.includes('FROM StationEnrollments') && s.includes('FOR UPDATE')) {
      const row = this.enrollments.find(
        (e) => e.id === params[0] && e.status === 'pending'
      )
      return { rows: row ? [{ ...row }] : [] }
    }

    if (s.includes('FROM StationEnrollments')) {
      // List query — pending first, no secret column selected.
      expect(s).not.toContain('secret')
      return {
        rows: this.enrollments.map((e) => ({
          id: e.id,
          station_id: e.station_id,
          candidate_station_id: e.candidate_station_id,
          enrollment_request_id: e.enrollment_request_id,
          token_id: e.token_id,
          token_label: e.token_id
            ? this.tokens.get(e.token_id)?.label ?? null
            : null,
          fingerprint: e.fingerprint,
          request_ip: e.request_ip,
          status: e.status,
          requested_at: e.requested_at,
          decided_at: e.decided_at,
          decided_by: e.decided_by,
        })),
      }
    }

    if (s.startsWith('UPDATE StationEnrollments')) {
      const row = this.enrollments.find((e) => e.id === params[0])
      if (row) {
        row.status = params[1] as string
        row.decided_at = new Date().toISOString()
        row.decided_by = params[2] as string
      }
      return { rows: [] }
    }

    if (s.startsWith('INSERT INTO StationCredentials')) {
      // Approval upsert is unconditional (no revoked guard).
      expect(s).not.toContain('WHERE StationCredentials.revoked_at')
      this.credentials.set(params[0] as string, {
        secret: params[1] as string,
        revoked_at: null,
        candidate_station_id: (params[5] as string | null) ?? null,
        enrollment_request_id: (params[6] as string | null) ?? null,
      })
      return { rows: [] }
    }

    if (s.startsWith('UPDATE StationCredentials')) {
      const c = this.credentials.get(params[0] as string)
      if (!c || c.revoked_at != null) return { rows: [] }
      c.revoked_at = new Date().toISOString()
      return { rows: [{ station_id: params[0] }] }
    }

    if (s.startsWith('INSERT INTO EnrollmentTokens')) {
      const row = {
        token_id: params[0] as string,
        token_secret: params[1] as string,
        label: params[2] as string,
        created_by: params[3] as string,
        created_at: new Date().toISOString(),
        expires_at: params[4] as string,
        max_uses: params[5] as number | null,
        uses: 0,
        revoked_at: null,
      }
      this.tokens.set(row.token_id, row)
      // RETURNING list excludes token_secret.
      const { token_secret: _secret, ...rest } = row
      return { rows: [rest] }
    }

    if (s.startsWith('UPDATE EnrollmentTokens')) {
      const t = this.tokens.get(params[0] as string)
      if (!t || t.revoked_at != null) return { rows: [] }
      t.revoked_at = new Date().toISOString()
      return { rows: [{ token_id: params[0] }] }
    }

    if (s.includes('FROM EnrollmentTokens')) {
      expect(s).not.toContain('token_secret')
      return {
        rows: [...this.tokens.values()].map(
          ({ token_secret: _secret, ...rest }) => ({ ...rest })
        ),
      }
    }

    throw new Error(`FakeAdminDb: unhandled SQL: ${s.slice(0, 80)}`)
  }
}

let db: FakeAdminDb

vi.mock('@/lib/stationControls', () => ({
  withClient: async (fn: (client: unknown) => Promise<unknown>) =>
    fn({
      query: (sql: string, params?: unknown[]) =>
        db.dispatch(sql, (params ?? []) as never[]),
    }),
}))

import { GET as listEnrollments } from '@/app/api/stations/enrollments/route'
import { POST as decideEnrollment } from '@/app/api/stations/enrollments/[id]/route'
import {
  GET as listTokens,
  POST as mintToken,
} from '@/app/api/stations/tokens/route'
import { DELETE as revokeToken } from '@/app/api/stations/tokens/[id]/route'
import { DELETE as revokeCredential } from '@/app/api/stations/credentials/[id]/route'

const jsonRequest = (body: unknown): NextRequest =>
  new Request('https://dashboard.example/api/stations/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as NextRequest

const bareRequest = (): NextRequest =>
  new Request('https://dashboard.example/api/stations/x', {
    method: 'DELETE',
  }) as unknown as NextRequest

const props = (id: string | number) => ({
  params: Promise.resolve({ id: String(id) }),
})

beforeEach(() => {
  db = new FakeAdminDb()
  denyAuth = false
})

describe('GET /api/stations/enrollments', () => {
  it('lists enrollment requests without candidate secrets', async () => {
    db.seedPending('MFG-LINE3PC-a4f2', 'a'.repeat(64), {
      candidate_station_id: 'MFG-LINE3PC-a4f2',
      enrollment_request_id: 'b'.repeat(32),
    })
    const response = await listEnrollments()
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      enrollments: Record<string, unknown>[]
    }
    expect(body.enrollments).toHaveLength(1)
    expect(body.enrollments[0]).toMatchObject({
      stationId: 'MFG-LINE3PC-a4f2',
      candidateStationId: 'MFG-LINE3PC-a4f2',
      enrollmentRequestId: 'b'.repeat(32),
      status: 'pending',
      requestIp: '10.1.2.3',
      fingerprint: { hostname: 'LINE3PC' },
    })
    expect(JSON.stringify(body)).not.toContain('a'.repeat(64))
    expect(JSON.stringify(body)).not.toContain('token_secret')
  })

  it('propagates the admin auth gate', async () => {
    denyAuth = true
    const response = await listEnrollments()
    expect(response.status).toBe(403)
  })
})

describe('POST /api/stations/enrollments/[id]', () => {
  it('approve upserts the credential and marks the row approved', async () => {
    const assigned = 'MFG-2a444a63-f228-44a2-ae5c-cdf863c8f049'
    const row = db.seedPending(assigned, 'b'.repeat(64), {
      candidate_station_id: 'MFG-LINE3PC-a4f2',
      enrollment_request_id: 'c'.repeat(32),
    })
    const response = await decideEnrollment(
      jsonRequest({ action: 'approve' }),
      props(row.id)
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      ok: true,
      stationId: assigned,
      status: 'approved',
    })
    expect(JSON.stringify(body)).not.toContain('b'.repeat(64))
    expect(db.credentials.get(assigned)).toEqual({
      secret: 'b'.repeat(64),
      revoked_at: null,
      candidate_station_id: 'MFG-LINE3PC-a4f2',
      enrollment_request_id: 'c'.repeat(32),
    })
    expect(db.enrollments[0]).toMatchObject({
      status: 'approved',
      decided_by: ADMIN_EMAIL,
    })
  })

  it('reject marks the row rejected without touching credentials', async () => {
    const row = db.seedPending('MFG-LINE3PC-a4f2', 'b'.repeat(64))
    const response = await decideEnrollment(
      jsonRequest({ action: 'reject' }),
      props(row.id)
    )
    expect(response.status).toBe(200)
    expect(db.credentials.size).toBe(0)
    expect(db.enrollments[0]).toMatchObject({ status: 'rejected' })
    expect(JSON.stringify(await response.json())).not.toContain('b'.repeat(64))
  })

  it('already-decided or unknown id → 404', async () => {
    const row = db.seedPending('MFG-LINE3PC-a4f2', 'b'.repeat(64))
    row.status = 'approved'
    const decided = await decideEnrollment(
      jsonRequest({ action: 'approve' }),
      props(row.id)
    )
    expect(decided.status).toBe(404)
    const unknown = await decideEnrollment(
      jsonRequest({ action: 'approve' }),
      props(999)
    )
    expect(unknown.status).toBe(404)
  })

  it('invalid action → 400', async () => {
    const row = db.seedPending('MFG-LINE3PC-a4f2', 'b'.repeat(64))
    const response = await decideEnrollment(
      jsonRequest({ action: 'destroy' }),
      props(row.id)
    )
    expect(response.status).toBe(400)
  })
})

describe('bootstrap tokens', () => {
  it('mint returns the full <id>.<secret> exactly once; GET never exposes it', async () => {
    const minted = await mintToken(
      jsonRequest({ label: 'MFG shipment 2026-09', expiresInDays: 30 })
    )
    expect(minted.status).toBe(201)
    const body = (await minted.json()) as {
      bootstrapToken: string
      token: Record<string, unknown>
    }
    expect(body.bootstrapToken).toMatch(/^[0-9a-f]{12}\.[0-9a-f]{64}$/)
    const [id, secret] = body.bootstrapToken.split('.')
    expect(body.token).toMatchObject({
      tokenId: id,
      label: 'MFG shipment 2026-09',
      createdBy: ADMIN_EMAIL,
      uses: 0,
      revokedAt: null,
    })
    expect(JSON.stringify(body.token)).not.toContain(secret)
    expect(db.tokens.get(id)?.token_secret).toBe(secret)

    const listed = await listTokens()
    expect(listed.status).toBe(200)
    const listBody = await listed.json()
    expect(JSON.stringify(listBody)).not.toContain(secret)
    expect(listBody.tokens[0]).toMatchObject({ tokenId: id })
  })

  it('mint validates label and expiry', async () => {
    expect(
      (await mintToken(jsonRequest({ label: '', expiresInDays: 30 }))).status
    ).toBe(400)
    expect(
      (await mintToken(jsonRequest({ label: 'x', expiresInDays: 0 }))).status
    ).toBe(400)
    expect(
      (
        await mintToken(
          jsonRequest({ label: 'x', expiresInDays: 30, maxUses: -1 })
        )
      ).status
    ).toBe(400)
  })

  it('DELETE revokes once; second revoke → 404', async () => {
    const minted = await mintToken(
      jsonRequest({ label: 'lab', expiresInDays: 7 })
    )
    const { bootstrapToken } = (await minted.json()) as {
      bootstrapToken: string
    }
    const id = bootstrapToken.split('.')[0]

    const first = await revokeToken(bareRequest(), props(id))
    expect(first.status).toBe(200)
    expect(db.tokens.get(id)?.revoked_at).not.toBeNull()

    const second = await revokeToken(bareRequest(), props(id))
    expect(second.status).toBe(404)
  })
})

describe('DELETE /api/stations/credentials/[id]', () => {
  it('soft-revokes an active credential', async () => {
    db.credentials.set('MFG-LINE3PC-a4f2', {
      secret: 'c'.repeat(64),
      revoked_at: null,
      candidate_station_id: 'MFG-LINE3PC-a4f2',
      enrollment_request_id: null,
    })
    const response = await revokeCredential(
      bareRequest(),
      props('MFG-LINE3PC-a4f2')
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      stationId: 'MFG-LINE3PC-a4f2',
    })
    expect(db.credentials.get('MFG-LINE3PC-a4f2')?.revoked_at).not.toBeNull()
  })

  it('missing or already-revoked credential → 404', async () => {
    const response = await revokeCredential(bareRequest(), props('NoSuch'))
    expect(response.status).toBe(404)
  })

  it('propagates the admin auth gate', async () => {
    denyAuth = true
    const response = await revokeCredential(
      bareRequest(),
      props('MFG-LINE3PC-a4f2')
    )
    expect(response.status).toBe(403)
  })
})
