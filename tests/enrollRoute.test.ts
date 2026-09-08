/**
 * Route-level tests for POST /api/stations/v1/enroll.
 *
 * Scripted in-memory fake pg client (via the withClient mock), NOT a real
 * PostgreSQL. The fake simulates guarded credential upserts, the pending
 * partial unique index, the managed (token_id, enrollment_request_id)
 * unique index, the active-candidate unique index, and BEGIN/COMMIT/ROLLBACK
 * snapshots. Unrecognized SQL throws so new queries fail loudly.
 * Postgres index semantics are also pinned in
 * tests/managedProvisioningMigration.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

const TOKEN_ID = 'ab12cd34ef56'
const TOKEN_SECRET = 'test-enroll-token-secret'
const OTHER_TOKEN_ID = 'ffffffffffff'
const OTHER_TOKEN_SECRET = 'other-enroll-token-secret'
const STATION = 'MFG-LINE3PC-a4f2'
const SECRET_HEX = '9f2c5a1e8b7d4c3f6a0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1d0c9b8a'
const OTHER_SECRET_HEX = 'a'.repeat(64)
const REQUEST_ID = 'b'.repeat(32)
const OTHER_REQUEST_ID = 'c'.repeat(32)

const { allocatorState, ALLOCATED_ID } = vi.hoisted(() => {
  const allocatedId = 'MFG-2a444a63-f228-44a2-ae5c-cdf863c8f049'
  return {
    ALLOCATED_ID: allocatedId,
    allocatorState: {
      queue: [] as string[],
      fallback: allocatedId,
    },
  }
})

vi.mock('@/lib/allocateStationId', () => ({
  allocateStationId: () =>
    allocatorState.queue.shift() ?? allocatorState.fallback,
}))

interface TokenRow {
  token_secret: string
  expires_at: string
  max_uses: number | null
  uses: number
  revoked_at: string | null
}

interface EnrollmentRow {
  id: number
  station_id: string
  secret: string
  token_id: string
  status: string
  candidate_station_id: string | null
  enrollment_request_id: string | null
}

interface CredentialRow {
  secret: string
  revoked_at: string | null
  candidate_station_id: string | null
  enrollment_request_id: string | null
}

class FakeUniqueViolation extends Error {
  code = '23505'
  constraint: string
  constructor(constraint: string) {
    super(`duplicate key: ${constraint}`)
    this.constraint = constraint
  }
}

class FakeEnrollDb {
  tokens = new Map<string, TokenRow>()
  credentials = new Map<string, CredentialRow>()
  enrollments: EnrollmentRow[] = []
  nonces = new Set<string>()
  failWith: Error | null = null
  missEnrollmentLookupOnce = false
  nextEnrollmentId = 1
  private snapshot: {
    tokens: Map<string, TokenRow>
    credentials: Map<string, CredentialRow>
    enrollments: EnrollmentRow[]
    nextEnrollmentId: number
  } | null = null

  seedToken(overrides: Partial<TokenRow> = {}, tokenId = TOKEN_ID, secret = TOKEN_SECRET) {
    this.tokens.set(tokenId, {
      token_secret: secret,
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      max_uses: null,
      uses: 0,
      revoked_at: null,
      ...overrides,
    })
  }

  private cloneSnapshot() {
    return {
      tokens: new Map(
        [...this.tokens.entries()].map(([k, v]) => [k, { ...v }])
      ),
      credentials: new Map(
        [...this.credentials.entries()].map(([k, v]) => [k, { ...v }])
      ),
      enrollments: this.enrollments.map((e) => ({ ...e })),
      nextEnrollmentId: this.nextEnrollmentId,
    }
  }

  async dispatch(
    sql: string,
    params: (string | number | null)[]
  ): Promise<{ rows: Record<string, unknown>[] }> {
    if (this.failWith) throw this.failWith
    const s = sql.trim()

    if (/^BEGIN\b/i.test(s)) {
      this.snapshot = this.cloneSnapshot()
      return { rows: [] }
    }
    if (/^COMMIT\b/i.test(s)) {
      this.snapshot = null
      return { rows: [] }
    }
    if (/^ROLLBACK\b/i.test(s)) {
      if (this.snapshot) {
        this.tokens = this.snapshot.tokens
        this.credentials = this.snapshot.credentials
        this.enrollments = this.snapshot.enrollments
        this.nextEnrollmentId = this.snapshot.nextEnrollmentId
        this.snapshot = null
      }
      return { rows: [] }
    }

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

    if (s.includes('UPDATE EnrollmentTokens') && s.includes('SET uses')) {
      const t = this.tokens.get(params[0] as string)
      if (!t || t.revoked_at != null) return { rows: [] }
      if (new Date(t.expires_at).getTime() <= Date.now()) return { rows: [] }
      if (t.max_uses != null && t.uses >= t.max_uses) return { rows: [] }
      t.uses += 1
      return { rows: [{ uses: t.uses }] }
    }

    if (
      s.includes('FROM StationEnrollments') &&
      s.includes('enrollment_request_id = $2')
    ) {
      if (this.missEnrollmentLookupOnce) {
        this.missEnrollmentLookupOnce = false
        return { rows: [] }
      }
      const tokenId = params[0] as string
      const requestId = params[1] as string
      const row = this.enrollments.find(
        (e) =>
          e.token_id === tokenId && e.enrollment_request_id === requestId
      )
      return { rows: row ? [{ ...row }] : [] }
    }

    if (
      s.includes('FROM StationCredentials') &&
      s.includes('candidate_station_id')
    ) {
      const candidate = params[0] as string
      for (const [stationId, c] of this.credentials) {
        if (c.revoked_at == null && c.candidate_station_id === candidate) {
          return {
            rows: [
              {
                station_id: stationId,
                secret: c.secret,
                revoked_at: c.revoked_at,
              },
            ],
          }
        }
      }
      return { rows: [] }
    }

    if (s.includes('SELECT secret, revoked_at FROM StationCredentials')) {
      const c = this.credentials.get(params[0] as string)
      return { rows: c ? [{ ...c }] : [] }
    }

    if (s.startsWith('INSERT INTO StationCredentials')) {
      const stationId = params[0] as string
      const secret = params[1] as string
      const candidate = (params[5] as string | null) ?? stationId
      const requestId = (params[6] as string | null) ?? null
      const existing = this.credentials.get(stationId)
      const onConflict = s.includes('ON CONFLICT')

      if (onConflict) {
        if (existing && existing.revoked_at == null) {
          return { rows: [] }
        }
        this.credentials.set(stationId, {
          secret,
          revoked_at: null,
          candidate_station_id: candidate,
          enrollment_request_id: requestId,
        })
        return { rows: [{ station_id: stationId }] }
      }

      if (existing) {
        throw new FakeUniqueViolation('stationcredentials_pkey')
      }
      for (const [id, c] of this.credentials) {
        if (
          id !== stationId &&
          c.revoked_at == null &&
          c.candidate_station_id === candidate
        ) {
          throw new FakeUniqueViolation(
            'uq_stationcredentials_active_candidate'
          )
        }
      }
      this.credentials.set(stationId, {
        secret,
        revoked_at: null,
        candidate_station_id: candidate,
        enrollment_request_id: requestId,
      })
      return { rows: [{ station_id: stationId }] }
    }

    if (s.startsWith('INSERT INTO StationEnrollments')) {
      const stationId = params[0] as string
      const secret = params[1] as string
      const tokenId = params[2] as string
      const requestId = (params[5] as string | null) ?? null
      const candidate = (params[6] as string | null) ?? stationId
      const status = s.includes("'auto_approved'") ? 'auto_approved' : 'pending'

      if (
        requestId &&
        this.enrollments.some(
          (e) =>
            e.token_id === tokenId && e.enrollment_request_id === requestId
        )
      ) {
        throw new FakeUniqueViolation('uq_stationenrollments_token_request')
      }

      if (
        status === 'pending' &&
        this.enrollments.some(
          (e) => e.station_id === stationId && e.status === 'pending'
        )
      ) {
        if (s.includes('ON CONFLICT')) return { rows: [] }
        throw new FakeUniqueViolation('uq_stationenrollments_pending')
      }

      this.enrollments.push({
        id: this.nextEnrollmentId++,
        station_id: stationId,
        secret,
        token_id: tokenId,
        status,
        candidate_station_id: candidate,
        enrollment_request_id: requestId,
      })
      return { rows: [{ id: this.nextEnrollmentId - 1 }] }
    }

    throw new Error(`FakeEnrollDb: unhandled SQL: ${s.slice(0, 120)}`)
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

function managedBody(overrides: Record<string, unknown> = {}) {
  return enrollBody({ enrollmentRequestId: REQUEST_ID, ...overrides })
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
  const stationId =
    opts.stationIdHeader ??
    (typeof bodyObj === 'object' &&
    bodyObj !== null &&
    'stationId' in bodyObj
      ? String((bodyObj as { stationId: string }).stationId)
      : STATION)
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
  allocatorState.queue = []
  allocatorState.fallback = ALLOCATED_ID
})

describe('POST /api/stations/v1/enroll (legacy, no enrollmentRequestId)', () => {
  it('happy path: new station → 201 active, credential + audit row, uses bumped', async () => {
    const response = await POST(signedRequest(enrollBody()))
    expect(response.status).toBe(201)
    expect(await json(response)).toEqual({
      ok: true,
      stationId: STATION,
      status: 'active',
    })
    expect(db.credentials.get(STATION)).toMatchObject({
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
    db.credentials.set(STATION, {
      secret: SECRET_HEX,
      revoked_at: null,
      candidate_station_id: STATION,
      enrollment_request_id: null,
    })
    const response = await POST(signedRequest(enrollBody()))
    expect(response.status).toBe(201)
    expect(await json(response)).toMatchObject({ ok: true, status: 'active' })
    expect(db.enrollments).toHaveLength(0)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(0)
  })

  it('expired token → 401 auth, no rows', async () => {
    db.seedToken({ expires_at: new Date(Date.now() - 1000).toISOString() })
    const response = await POST(signedRequest(enrollBody()))
    expect(response.status).toBe(401)
    expect(await json(response)).toEqual({ error: 'auth' })
    expectNoRowsWritten()
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

  it('unknown extra body key → 400 (.strict)', async () => {
    const response = await POST(
      signedRequest(enrollBody({ extra: 'nope' }))
    )
    expect(response.status).toBe(400)
    expectNoRowsWritten()
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
    db.credentials.set(STATION, {
      secret: OTHER_SECRET_HEX,
      revoked_at: null,
      candidate_station_id: STATION,
      enrollment_request_id: null,
    })
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
    expect(db.credentials.get(STATION)?.secret).toBe(OTHER_SECRET_HEX)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(0)
  })

  it('pending idempotency: repeated 202-retries keep a single pending row', async () => {
    db.credentials.set(STATION, {
      secret: OTHER_SECRET_HEX,
      revoked_at: null,
      candidate_station_id: STATION,
      enrollment_request_id: null,
    })
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
    db.credentials.set(STATION, {
      secret: OTHER_SECRET_HEX,
      revoked_at: null,
      candidate_station_id: STATION,
      enrollment_request_id: null,
    })
    const queued = await POST(signedRequest(enrollBody()))
    expect(queued.status).toBe(202)

    db.credentials.set(STATION, {
      secret: SECRET_HEX,
      revoked_at: null,
      candidate_station_id: STATION,
      enrollment_request_id: null,
    })
    db.enrollments[0].status = 'approved'

    const retry = await POST(signedRequest(enrollBody()))
    expect(retry.status).toBe(201)
    expect(await json(retry)).toMatchObject({ ok: true, status: 'active' })
    expect(db.enrollments).toHaveLength(1)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(0)
  })

  it('revoked credential → re-enroll auto-approves with the new secret → 201', async () => {
    db.credentials.set(STATION, {
      secret: OTHER_SECRET_HEX,
      revoked_at: new Date().toISOString(),
      candidate_station_id: STATION,
      enrollment_request_id: null,
    })
    const response = await POST(signedRequest(enrollBody()))
    expect(response.status).toBe(201)
    expect(db.credentials.get(STATION)).toMatchObject({
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

describe('POST /api/stations/v1/enroll (managed enrollmentRequestId)', () => {
  it('new managed request → 201 with a server-generated ID different from the candidate', async () => {
    const response = await POST(signedRequest(managedBody()))
    expect(response.status).toBe(201)
    const body = await json(response)
    expect(body).toEqual({
      ok: true,
      stationId: ALLOCATED_ID,
      status: 'active',
    })
    expect(body.stationId).not.toBe(STATION)
    expect(JSON.stringify(body)).not.toContain(SECRET_HEX)
    expect(db.credentials.get(ALLOCATED_ID)).toMatchObject({
      secret: SECRET_HEX,
      revoked_at: null,
      candidate_station_id: STATION,
      enrollment_request_id: REQUEST_ID,
    })
    expect(db.credentials.has(STATION)).toBe(false)
    expect(db.enrollments).toEqual([
      expect.objectContaining({
        station_id: ALLOCATED_ID,
        candidate_station_id: STATION,
        enrollment_request_id: REQUEST_ID,
        secret: SECRET_HEX,
        status: 'auto_approved',
      }),
    ])
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(1)
  })

  it('lost-response retry returns the identical assigned ID and does not create rows or increment uses', async () => {
    const first = await POST(signedRequest(managedBody()))
    expect(first.status).toBe(201)
    const second = await POST(signedRequest(managedBody()))
    expect(second.status).toBe(201)
    expect(await json(second)).toEqual({
      ok: true,
      stationId: ALLOCATED_ID,
      status: 'active',
    })
    expect(db.credentials.size).toBe(1)
    expect(db.enrollments).toHaveLength(1)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(1)
  })

  it('retry after adopting the assigned ID is accepted', async () => {
    const first = await POST(signedRequest(managedBody()))
    expect(first.status).toBe(201)
    const retry = await POST(
      signedRequest(managedBody({ stationId: ALLOCATED_ID }))
    )
    expect(retry.status).toBe(201)
    expect(await json(retry)).toEqual({
      ok: true,
      stationId: ALLOCATED_ID,
      status: 'active',
    })
    expect(db.enrollments).toHaveLength(1)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(1)
  })

  it('same request ID with a different secret cannot mutate the original enrollment', async () => {
    await POST(signedRequest(managedBody()))
    const response = await POST(
      signedRequest(managedBody({ secret: OTHER_SECRET_HEX }))
    )
    expect(response.status).toBe(400)
    expect(await json(response)).toEqual({ error: 'enrollment_conflict' })
    expect(db.credentials.get(ALLOCATED_ID)?.secret).toBe(SECRET_HEX)
    expect(db.enrollments).toHaveLength(1)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(1)
  })

  it('same request ID with an unrelated candidate cannot mutate the original enrollment', async () => {
    await POST(signedRequest(managedBody()))
    const response = await POST(
      signedRequest(managedBody({ stationId: 'MFG-OTHERPC-0000' }))
    )
    expect(response.status).toBe(400)
    expect(await json(response)).toEqual({ error: 'enrollment_conflict' })
    expect(db.enrollments[0]?.station_id).toBe(ALLOCATED_ID)
  })

  it('same request ID with a different token cannot mutate the original enrollment', async () => {
    await POST(signedRequest(managedBody()))
    db.seedToken({}, OTHER_TOKEN_ID, OTHER_TOKEN_SECRET)
    const response = await POST(
      signedRequest(managedBody(), {
        tokenId: OTHER_TOKEN_ID,
        tokenSecret: OTHER_TOKEN_SECRET,
      })
    )
    expect(db.credentials.get(ALLOCATED_ID)?.secret).toBe(SECRET_HEX)
    expect(
      db.enrollments.filter((e) => e.token_id === TOKEN_ID)
    ).toHaveLength(1)
    expect(response.status).not.toBe(500)
    expect(JSON.stringify(await json(response))).not.toContain(SECRET_HEX)
  })

  it('existing pending request returns the same assigned ID and 202', async () => {
    db.credentials.set(ALLOCATED_ID, {
      secret: OTHER_SECRET_HEX,
      revoked_at: null,
      candidate_station_id: STATION,
      enrollment_request_id: 'd'.repeat(32),
    })
    const first = await POST(signedRequest(managedBody()))
    expect(first.status).toBe(202)
    expect(await json(first)).toEqual({
      ok: true,
      stationId: ALLOCATED_ID,
      status: 'pending',
    })
    const second = await POST(signedRequest(managedBody()))
    expect(second.status).toBe(202)
    expect(await json(second)).toEqual({
      ok: true,
      stationId: ALLOCATED_ID,
      status: 'pending',
    })
    expect(
      db.enrollments.filter((e) => e.status === 'pending')
    ).toHaveLength(1)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(0)
  })

  it('approved pending request returns the same assigned ID and 201', async () => {
    db.credentials.set(ALLOCATED_ID, {
      secret: OTHER_SECRET_HEX,
      revoked_at: null,
      candidate_station_id: STATION,
      enrollment_request_id: 'd'.repeat(32),
    })
    const queued = await POST(signedRequest(managedBody()))
    expect(queued.status).toBe(202)
    db.credentials.set(ALLOCATED_ID, {
      secret: SECRET_HEX,
      revoked_at: null,
      candidate_station_id: STATION,
      enrollment_request_id: REQUEST_ID,
    })
    db.enrollments[0].status = 'approved'

    const retry = await POST(signedRequest(managedBody()))
    expect(retry.status).toBe(201)
    expect(await json(retry)).toEqual({
      ok: true,
      stationId: ALLOCATED_ID,
      status: 'active',
    })
    expect(db.enrollments).toHaveLength(1)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(0)
  })

  it('rejected request returns enrollment_rejected and never requeues', async () => {
    db.credentials.set(ALLOCATED_ID, {
      secret: OTHER_SECRET_HEX,
      revoked_at: null,
      candidate_station_id: STATION,
      enrollment_request_id: 'd'.repeat(32),
    })
    const queued = await POST(signedRequest(managedBody()))
    expect(queued.status).toBe(202)
    db.enrollments[0].status = 'rejected'

    const retry = await POST(signedRequest(managedBody()))
    expect(retry.status).toBe(400)
    expect(await json(retry)).toEqual({ error: 'enrollment_rejected' })
    expect(
      db.enrollments.filter((e) => e.status === 'pending')
    ).toHaveLength(0)
    expect(db.enrollments).toHaveLength(1)
  })

  it('expired, revoked, or exhausted token rejects a genuinely new managed request', async () => {
    db.seedToken({ expires_at: new Date(Date.now() - 1000).toISOString() })
    const expired = await POST(signedRequest(managedBody()))
    expect(expired.status).toBe(401)
    expectNoRowsWritten()

    db = new FakeEnrollDb()
    db.seedToken({ revoked_at: new Date().toISOString() })
    const revoked = await POST(
      signedRequest(managedBody({ enrollmentRequestId: OTHER_REQUEST_ID }))
    )
    expect(revoked.status).toBe(401)

    db = new FakeEnrollDb()
    db.seedToken({ max_uses: 1, uses: 1 })
    const exhausted = await POST(
      signedRequest(managedBody({ enrollmentRequestId: 'd'.repeat(32) }))
    )
    expect(exhausted.status).toBe(401)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(1)
  })

  it('a previously persisted idempotent request still resolves after token expiry', async () => {
    const first = await POST(signedRequest(managedBody()))
    expect(first.status).toBe(201)
    db.seedToken({
      expires_at: new Date(Date.now() - 1000).toISOString(),
      uses: 1,
    })
    const retry = await POST(signedRequest(managedBody()))
    expect(retry.status).toBe(201)
    expect(await json(retry)).toEqual({
      ok: true,
      stationId: ALLOCATED_ID,
      status: 'active',
    })
    expect(db.enrollments).toHaveLength(1)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(1)
  })

  it('candidate collision / re-image creates one pending rotation against the prior assigned ID', async () => {
    db.credentials.set(ALLOCATED_ID, {
      secret: OTHER_SECRET_HEX,
      revoked_at: null,
      candidate_station_id: STATION,
      enrollment_request_id: 'd'.repeat(32),
    })
    const response = await POST(signedRequest(managedBody()))
    expect(response.status).toBe(202)
    expect(await json(response)).toEqual({
      ok: true,
      stationId: ALLOCATED_ID,
      status: 'pending',
    })
    expect(db.enrollments).toEqual([
      expect.objectContaining({
        station_id: ALLOCATED_ID,
        candidate_station_id: STATION,
        enrollment_request_id: REQUEST_ID,
        secret: SECRET_HEX,
        status: 'pending',
      }),
    ])
    expect(db.credentials.get(ALLOCATED_ID)?.secret).toBe(OTHER_SECRET_HEX)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(0)
  })

  it('revoked credential + new request ID mints a new opaque identity', async () => {
    db.credentials.set(ALLOCATED_ID, {
      secret: OTHER_SECRET_HEX,
      revoked_at: new Date().toISOString(),
      candidate_station_id: STATION,
      enrollment_request_id: 'd'.repeat(32),
    })
    const nextId = 'MFG-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
    allocatorState.fallback = nextId
    const response = await POST(signedRequest(managedBody()))
    expect(response.status).toBe(201)
    expect(await json(response)).toEqual({
      ok: true,
      stationId: nextId,
      status: 'active',
    })
    expect(db.credentials.get(ALLOCATED_ID)?.revoked_at).not.toBeNull()
    expect(db.credentials.get(nextId)).toMatchObject({
      secret: SECRET_HEX,
      revoked_at: null,
      candidate_station_id: STATION,
    })
  })

  it('unique-index collision on a duplicate first request converges on one assigned ID', async () => {
    const first = await POST(signedRequest(managedBody()))
    expect(first.status).toBe(201)
    allocatorState.queue = ['MFG-99999999-9999-4999-8999-999999999999']
    db.missEnrollmentLookupOnce = true
    const raced = await POST(signedRequest(managedBody()))
    expect(raced.status).toBe(201)
    expect(await json(raced)).toEqual({
      ok: true,
      stationId: ALLOCATED_ID,
      status: 'active',
    })
    expect(db.credentials.size).toBe(1)
    expect(db.enrollments).toHaveLength(1)
    expect(db.tokens.get(TOKEN_ID)?.uses).toBe(1)
  })

  it('malformed enrollmentRequestId → 400', async () => {
    const response = await POST(
      signedRequest(enrollBody({ enrollmentRequestId: 'not-32-hex' }))
    )
    expect(response.status).toBe(400)
    expectNoRowsWritten()
  })
})
