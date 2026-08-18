/**
 * Route-level tests for POST /api/stations/v1/enroll (station auto-enrollment,
 * docs/STATION_ENROLLMENT_PLAN.md §3.2 / §6).
 *
 * Same honest scope as processPayload.test.ts: a scripted in-memory fake pg
 * client (via the withClient mock), NOT a real PostgreSQL. The fake simulates
 * the guarded credential upsert (ON CONFLICT ... WHERE revoked) and the
 * partial-unique pending index (one pending row per station_id); real-SQL
 * semantics are pinned by migration 017. The fake throws on unrecognized SQL
 * so new queries fail loudly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const TOKEN_ID = 'ab12cd34ef56'
const TOKEN_SECRET = 'test-enroll-token-secret'
const STATION = 'MFG-LINE3PC-a4f2'
const SECRET_HEX = '9f2c5a1e8b7d4c3f6a0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a'
const OTHER_SECRET_HEX = 'a'.repeat(64)

interface TokenRow {
  token_secret: string
  expires_at: string
  max_uses: number | null
  uses: number
  revoked_at: string | null
}

interface EnrollmentRow {
  station_id: string
  secret: string
  token_id: string
  status: string
}

class FakeEnrollDb {
  tokens = new Map<string, TokenRow>()
  credentials = new Map<string, { secret: string; revoked_at: string | null }>()
  enrollments: EnrollmentRow[] = []
  nonces = new Set<string>()
  failWith: Error | null = null

  seedToken(overrides: Partial<TokenRow> = {}) {
    this.tokens.set(TOKEN_ID, {
      token_secret: TOKEN_SECRET,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      max_uses: null,
      uses: 0,
      revoked_at: null,
      ...overrides,
    })
  }

  async dispatch(
    sql: string,
    params: (string | number | null)[]
  ): Promise<{ rows: Record<string, unknown>[] }> {
    if (this.failWith) throw this.failWith
    const s = sql.trim()

    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) return { rows: [] }

    if (s.startsWith('DELETE FROM IngestNonces')) return { rows: [] }

    if (s.includes('INSERT INTO IngestNonces')) {
      const key = params[0] as string
      if (this.nonces.has(key)) return { rows: [] }
      this.nonces.add(key)
      return { rows: [{ nonce: key }] }
    }

    if (s.includes('FROM EnrollmentTokens WHERE token_id')) {
      const t = this.tokens.get(params[0] as string)
      return { rows: t ? [{ ...t }] : [] }
    }

    if (s.startsWith('SELECT secret, revoked_at FROM StationCredentials')) {
      const c = this.credentials.get(params[0] as string)
      return { rows: c ? [{ ...c }] : [] }
    }

    if (s.startsWith('INSERT INTO StationCredentials')) {
      const stationId = params[0] as string
      const existing = this.credentials.get(stationId)
      if (existing && existing.revoked_at == null) {
        // ON CONFLICT DO UPDATE ... WHERE revoked_at IS NOT NULL → no-op
        return { rows: [] }
      }
      this.credentials.set(stationId, {
        secret: params[1] as string,
        revoked_at: null,
      })
      return { rows: [{ station_id: stationId }] }
    }

    if (s.startsWith('INSERT INTO StationEnrollments')) {
      const stationId = params[0] as string
      const status = s.includes("'auto_approved'") ? 'auto_approved' : 'pending'
      if (
        status === 'pending' &&
        this.enrollments.some(
          (e) => e.station_id === stationId && e.status === 'pending'
        )
      ) {
        // partial unique index uq_stationenrollments_pending → DO NOTHING
        return { rows: [] }
      }
      this.enrollments.push({
        station_id: stationId,
        secret: params[1] as string,
        token_id: params[2] as string,
        status,
      })
      return { rows: [] }
    }

    if (s.startsWith('UPDATE EnrollmentTokens SET uses')) {
      const t = this.tokens.get(params[0] as string)
      if (t) t.uses += 1
      return { rows: [] }
    }

    throw new Error(`FakeEnrollDb: unhandled SQL: ${s.slice(0, 80)}`)
  }
}

let db: FakeEnrollDb

vi.mock('@/lib/stationControls', () => ({
  withClient: async (fn: (client: unknown) => Promise<unknown>) =>
    fn({
      query: (sql: string, params?: unknown[]) =>
        db.dispatch(sql, (params ?? []) as never[]),
    }),
}))

import { POST } from '@/app/api/stations/v1/enroll/route'
import { signIngestRequest, sha256Hex } from '@/lib/ingestAuth'

let nonceCounter = 0

function enrollBody(overrides: Record<string, unknown> = {}) {
  return {
    stationId: STATION,
    secret: SECRET_HEX,
    fingerprint: {
      hostname: 'LINE3PC',
      machineId: 'd4be1a7c9e02',
      os: 'Windows-10',
      appVersion: '1.0.0',
    },
    ...overrides,
  }
}

function signedRequest(
  bodyObj: unknown,
  opts: {
    signature?: string
    stationIdHeader?: string
    tokenId?: string
    tokenSecret?: string
    nonce?: string
    rawBody?: Buffer
  } = {}
): NextRequest {
  const rawBody =
    opts.rawBody ?? Buffer.from(JSON.stringify(bodyObj), 'utf8')
  const stationId = opts.stationIdHeader ?? STATION
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = opts.nonce ?? `e${String(nonceCounter++).padStart(31, '0')}`
  const signature =
    opts.signature ??
    signIngestRequest(opts.tokenSecret ?? TOKEN_SECRET, {
      timestamp,
      nonce,
      method: 'POST',
      path: '/api/stations/v1/enroll',
      stationId,
      bodySha256Hex: sha256Hex(rawBody),
    })
  return new Request('https://dashboard.example/api/stations/v1/enroll', {
    method: 'POST',
    headers: {
      'x-station-id': stationId,
      'x-enroll-token-id': opts.tokenId ?? TOKEN_ID,
      'x-ingest-timestamp': timestamp,
      'x-ingest-nonce': nonce,
      'x-ingest-signature': signature,
      'x-forwarded-for': '10.1.2.3',
    },
    body: new Uint8Array(rawBody),
  }) as unknown as NextRequest
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

function expectNoRowsWritten() {
  expect(db.credentials.size).toBe(0)
  expect(db.enrollments).toHaveLength(0)
  expect(db.tokens.get(TOKEN_ID)?.uses ?? 0).toBe(0)
}

beforeEach(() => {
  db = new FakeEnrollDb()
  db.seedToken()
})

describe('POST /api/stations/v1/enroll', () => {
  it('happy path: new station → 201 active, credential + audit row, uses bumped', async () => {
    const response = await POST(signedRequest(enrollBody()))
    expect(response.status).toBe(201)
    expect(await json(response)).toEqual({
      ok: true,
      stationId: STATION,
      status: 'active',
    })
    expect(db.credentials.get(STATION)).toEqual({
      secret: SECRET_HEX,
      revoked_at: null,
    })
    expect(db.enrollments).toEqual([
      expect.objectContaining({
        station_id: STATION,
        secret: SECRET_HEX,
        token_id: TOKEN_ID,
        status: 'auto_approved',
      }),
    ])
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(1)
  })

  it('idempotent re-send (same active secret) → 201, no new rows, uses untouched', async () => {
    db.credentials.set(STATION, { secret: SECRET_HEX, revoked_at: null })
    const response = await POST(signedRequest(enrollBody()))
    expect(response.status).toBe(201)
    expect(await json(response)).toMatchObject({ ok: true, status: 'active' })
    expect(db.enrollments).toHaveLength(0)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(0)
  })

  it('expired token → 401 auth, no rows, nonce not consumed', async () => {
    db.seedToken({ expires_at: new Date(Date.now() - 1000).toISOString() })
    const response = await POST(signedRequest(enrollBody()))
    expect(response.status).toBe(401)
    expect(await json(response)).toEqual({ error: 'auth' })
    expectNoRowsWritten()
    expect(db.nonces.size).toBe(0)
  })

  it('revoked token → 401 auth, no rows', async () => {
    db.seedToken({ revoked_at: new Date().toISOString() })
    const response = await POST(signedRequest(enrollBody()))
    expect(response.status).toBe(401)
    expect(await json(response)).toEqual({ error: 'auth' })
    expectNoRowsWritten()
  })

  it('uses-exhausted token → 401 auth, no rows', async () => {
    db.seedToken({ max_uses: 2, uses: 2 })
    const response = await POST(signedRequest(enrollBody()))
    expect(response.status).toBe(401)
    expect(await json(response)).toEqual({ error: 'auth' })
    expect(db.credentials.size).toBe(0)
    expect(db.enrollments).toHaveLength(0)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(2)
  })

  it('unknown token id → 401 auth, no rows', async () => {
    const response = await POST(
      signedRequest(enrollBody(), { tokenId: 'nosuchtoken1' })
    )
    expect(response.status).toBe(401)
    expect(await json(response)).toEqual({ error: 'auth' })
    expectNoRowsWritten()
  })

  it('bad signature → 401 auth, no rows, nonce still claimable', async () => {
    const bad = await POST(
      signedRequest(enrollBody(), { signature: 'f'.repeat(64) })
    )
    expect(bad.status).toBe(401)
    expect(await json(bad)).toEqual({ error: 'auth' })
    expectNoRowsWritten()
    expect(db.nonces.size).toBe(0)

    const good = await POST(signedRequest(enrollBody()))
    expect(good.status).toBe(201)
  })

  it('replayed nonce → 401 auth on the second use', async () => {
    const nonce = 'abcdef0123456789abcdef0123456789'
    const first = await POST(signedRequest(enrollBody(), { nonce }))
    expect(first.status).toBe(201)
    const replay = await POST(signedRequest(enrollBody(), { nonce }))
    expect(replay.status).toBe(401)
    expect(await json(replay)).toEqual({ error: 'auth' })
    // No duplicate rows from the replay.
    expect(db.enrollments).toHaveLength(1)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(1)
  })

  it('body stationId ≠ X-Station-Id → 400, no rows', async () => {
    const response = await POST(
      signedRequest(enrollBody({ stationId: 'MFG-OTHERPC-0000' }), {
        stationIdHeader: STATION,
      })
    )
    expect(response.status).toBe(400)
    expect(db.credentials.size).toBe(0)
    expect(db.enrollments).toHaveLength(0)
  })

  it('malformed secret (not 64 lowercase hex) → 400', async () => {
    const response = await POST(
      signedRequest(enrollBody({ secret: 'F'.repeat(64) }))
    )
    expect(response.status).toBe(400)
    expect(db.credentials.size).toBe(0)
  })

  it('body over the 8 KB cap → 400 before any lookup', async () => {
    const response = await POST(
      signedRequest(null, { rawBody: Buffer.alloc(8 * 1024 + 1) })
    )
    expect(response.status).toBe(400)
    expectNoRowsWritten()
    expect(db.nonces.size).toBe(0)
  })

  it('conflict (active credential, different secret) → 202 pending row', async () => {
    db.credentials.set(STATION, { secret: OTHER_SECRET_HEX, revoked_at: null })
    const response = await POST(signedRequest(enrollBody()))
    expect(response.status).toBe(202)
    expect(await json(response)).toEqual({
      ok: true,
      stationId: STATION,
      status: 'pending',
    })
    expect(db.enrollments).toEqual([
      expect.objectContaining({
        station_id: STATION,
        secret: SECRET_HEX,
        status: 'pending',
      }),
    ])
    // Conflict does not touch the credential or the token counter.
    expect(db.credentials.get(STATION)?.secret).toBe(OTHER_SECRET_HEX)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(0)
  })

  it('pending idempotency: repeated 202-retries keep a single pending row', async () => {
    db.credentials.set(STATION, { secret: OTHER_SECRET_HEX, revoked_at: null })
    const first = await POST(signedRequest(enrollBody()))
    expect(first.status).toBe(202)
    const second = await POST(signedRequest(enrollBody()))
    expect(second.status).toBe(202)
    expect(
      db.enrollments.filter(
        (e) => e.station_id === STATION && e.status === 'pending'
      )
    ).toHaveLength(1)
  })

  it('approve-then-retry: once the admin upserts the credential, retry → 201', async () => {
    db.credentials.set(STATION, { secret: OTHER_SECRET_HEX, revoked_at: null })
    const queued = await POST(signedRequest(enrollBody()))
    expect(queued.status).toBe(202)

    // Admin approval (POST /api/stations/enrollments/[id]) upserts the
    // candidate secret into StationCredentials and marks the row approved.
    db.credentials.set(STATION, { secret: SECRET_HEX, revoked_at: null })
    db.enrollments[0].status = 'approved'

    const retry = await POST(signedRequest(enrollBody()))
    expect(retry.status).toBe(201)
    expect(await json(retry)).toMatchObject({ ok: true, status: 'active' })
    // Idempotency rule fired — no extra rows, no extra token use.
    expect(db.enrollments).toHaveLength(1)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(0)
  })

  it('revoked credential → re-enroll auto-approves with the new secret → 201', async () => {
    db.credentials.set(STATION, {
      secret: OTHER_SECRET_HEX,
      revoked_at: new Date().toISOString(),
    })
    const response = await POST(signedRequest(enrollBody()))
    expect(response.status).toBe(201)
    expect(db.credentials.get(STATION)).toEqual({
      secret: SECRET_HEX,
      revoked_at: null,
    })
    expect(db.enrollments[0]).toMatchObject({ status: 'auto_approved' })
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(1)
  })

  it('DB unreachable → 500 server_error (station treats as transient)', async () => {
    db.failWith = new Error('db down')
    const response = await POST(signedRequest(enrollBody()))
    expect(response.status).toBe(500)
    expect(await json(response)).toEqual({ error: 'server_error' })
  })
})
