import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyEnrollRequest } from '@/lib/ingestAuth'
import { withClient } from '@/lib/stationControls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/stations/v1/enroll — station auto-enrollment
 * (docs/STATION_ENROLLMENT_PLAN.md §2/§3.2).
 *
 * Public route (PUBLIC_PREFIXES covers /api/stations/v1/). HMAC-signed exactly
 * like ingest, but the key is a bootstrap token secret looked up via
 * X-Enroll-Token-Id; X-Station-Id carries the *candidate* station id.
 *
 * Decision (the idempotency rule the whole flow keys off):
 *   - active credential with the same secret        → 201 (no rows written)
 *   - no credential, or only a revoked one          → insert credential +
 *     auto_approved audit row, bump token uses      → 201
 *   - active credential with a different secret     → upsert pending queue row
 *     (one per station_id via partial unique index) → 202
 *
 * Any token failure (unknown/revoked/expired/exhausted/bad signature/replay/
 * skew) → 401 {"error":"auth"} with NO rows written.
 */

/** Enrollment bodies are tiny JSON — hard cap well below any legitimate size. */
const MAX_BODY_BYTES = 8 * 1024

const enrollBodySchema = z.object({
  stationId: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  secret: z.string().regex(/^[0-9a-f]{64}$/),
  fingerprint: z
    .object({
      hostname: z.string().optional(),
      machineId: z.string().optional(),
      os: z.string().optional(),
      appVersion: z.string().optional(),
    })
    .optional(),
})

interface TokenRow {
  token_secret: string
  expires_at: string | Date
  max_uses: number | null
  uses: number
  revoked_at: string | Date | null
}

function clientIp(request: NextRequest): string | null {
  const fwd = request.headers.get('x-forwarded-for')
  if (fwd) {
    const first = fwd.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || null
}

function logDecision(params: {
  stationId: string
  tokenId: string
  ip: string | null
  outcome: string
}) {
  // This endpoint is the audit surface — every decision is logged.
  console.log(
    `[enroll] station_id=${params.stationId} token_id=${params.tokenId} ip=${
      params.ip ?? '-'
    } outcome=${params.outcome}`
  )
}

function authError(): NextResponse {
  return NextResponse.json({ error: 'auth' }, { status: 401 })
}

export async function POST(request: NextRequest) {
  const stationIdHeader = request.headers.get('x-station-id')?.trim() || ''
  const tokenId = request.headers.get('x-enroll-token-id')?.trim() || ''
  const ip = clientIp(request)

  let rawBody: Buffer
  try {
    const ab = await request.arrayBuffer()
    rawBody = Buffer.from(ab)
  } catch {
    return NextResponse.json(
      { error: 'Failed to read request body' },
      { status: 400 }
    )
  }

  if (rawBody.byteLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: `Body exceeds ${MAX_BODY_BYTES} bytes` },
      { status: 400 }
    )
  }

  if (!tokenId) {
    logDecision({ stationId: stationIdHeader, tokenId: '-', ip, outcome: 'auth_missing_token_id' })
    return authError()
  }

  // Bootstrap token lookup — the secret half is the HMAC key. Reject before
  // signature verification so a revoked/expired token can never consume a
  // nonce or touch any other table.
  let token: TokenRow | undefined
  try {
    token = await withClient(async (client) => {
      const r = await client.query(
        `SELECT token_secret, expires_at, max_uses, uses, revoked_at
         FROM EnrollmentTokens WHERE token_id = $1`,
        [tokenId]
      )
      return r.rows[0] as TokenRow | undefined
    })
  } catch (err) {
    console.error('enroll token lookup failed:', err)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }

  if (!token) {
    logDecision({ stationId: stationIdHeader, tokenId, ip, outcome: 'auth_unknown_token' })
    return authError()
  }
  if (token.revoked_at != null) {
    logDecision({ stationId: stationIdHeader, tokenId, ip, outcome: 'auth_token_revoked' })
    return authError()
  }
  if (new Date(token.expires_at).getTime() <= Date.now()) {
    logDecision({ stationId: stationIdHeader, tokenId, ip, outcome: 'auth_token_expired' })
    return authError()
  }
  if (token.max_uses != null && token.uses >= token.max_uses) {
    logDecision({ stationId: stationIdHeader, tokenId, ip, outcome: 'auth_token_uses_exhausted' })
    return authError()
  }

  // Signature + skew + nonce replay (nonce key `enroll:<token_id>:<nonce>`).
  let auth
  try {
    auth = await verifyEnrollRequest({
      request,
      rawBody,
      stationIdHeader,
      tokenId,
      tokenSecret: token.token_secret,
    })
  } catch (err) {
    // Nonce store unreachable — fail closed; station treats 500 as transient.
    console.error('enroll auth (nonce store) failed:', err)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
  if (!auth.ok) {
    logDecision({ stationId: stationIdHeader, tokenId, ip, outcome: `auth_${auth.reason}` })
    return authError()
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody.toString('utf8'))
  } catch {
    return NextResponse.json({ error: 'Body is not valid JSON' }, { status: 400 })
  }

  const schemaResult = enrollBodySchema.safeParse(parsed)
  if (!schemaResult.success) {
    return NextResponse.json(
      {
        error: schemaResult.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      },
      { status: 400 }
    )
  }
  const body = schemaResult.data

  if (body.stationId !== auth.stationId) {
    return NextResponse.json(
      { error: 'X-Station-Id does not match body stationId' },
      { status: 400 }
    )
  }

  const stationId = body.stationId
  const fingerprintJson = body.fingerprint
    ? JSON.stringify(body.fingerprint)
    : null

  let decision: { status: 'active' | 'pending'; outcome: string }
  try {
    decision = await withClient(async (client) => {
      const existing = await client.query(
        `SELECT secret, revoked_at FROM StationCredentials WHERE station_id = $1`,
        [stationId]
      )
      let cred = existing.rows[0] as
        | { secret: string; revoked_at: string | Date | null }
        | undefined

      // Idempotency rule: active credential with the same secret → 201,
      // always (missed ack, mid-enroll reboot, post-approval retry).
      if (cred && cred.revoked_at == null && cred.secret === body.secret) {
        return { status: 'active' as const, outcome: 'idempotent' }
      }

      if (!cred || cred.revoked_at != null) {
        // No credential (or only a revoked one) → auto-approve. The guarded
        // upsert only overwrites REVOKED rows; if a concurrent enrollment
        // just activated a credential, zero rows come back and we fall
        // through to the conflict path below.
        try {
          await client.query('BEGIN')
          const upsert = await client.query(
            `INSERT INTO StationCredentials
               (station_id, secret, token_id, fingerprint, enrolled_ip)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (station_id) DO UPDATE SET
               secret = EXCLUDED.secret,
               token_id = EXCLUDED.token_id,
               fingerprint = EXCLUDED.fingerprint,
               enrolled_ip = EXCLUDED.enrolled_ip,
               updated_at = NOW(),
               revoked_at = NULL
             WHERE StationCredentials.revoked_at IS NOT NULL
             RETURNING station_id`,
            [stationId, body.secret, tokenId, fingerprintJson, ip]
          )
          if (upsert.rows.length > 0) {
            await client.query(
              `INSERT INTO StationEnrollments
                 (station_id, secret, token_id, fingerprint, request_ip, status, decided_at, decided_by)
               VALUES ($1, $2, $3, $4, $5, 'auto_approved', NOW(), 'auto')`,
              [stationId, body.secret, tokenId, fingerprintJson, ip]
            )
            await client.query(
              `UPDATE EnrollmentTokens SET uses = uses + 1 WHERE token_id = $1`,
              [tokenId]
            )
            await client.query('COMMIT')
            return { status: 'active' as const, outcome: 'auto_approved' }
          }
          await client.query('ROLLBACK')
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {})
          throw err
        }

        // Raced: re-read so a concurrently-enrolled identical secret still
        // converges on 201 instead of queueing a pointless pending row.
        const reread = await client.query(
          `SELECT secret, revoked_at FROM StationCredentials WHERE station_id = $1`,
          [stationId]
        )
        cred = reread.rows[0] as typeof cred
        if (cred && cred.revoked_at == null && cred.secret === body.secret) {
          return { status: 'active' as const, outcome: 'idempotent' }
        }
      }

      // Active credential with a DIFFERENT secret → pending-approval queue.
      // Partial unique index keeps this idempotent: one pending row per
      // station_id, repeated retries still answer 202.
      await client.query(
        `INSERT INTO StationEnrollments
           (station_id, secret, token_id, fingerprint, request_ip, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT (station_id) WHERE status = 'pending' DO NOTHING`,
        [stationId, body.secret, tokenId, fingerprintJson, ip]
      )
      return { status: 'pending' as const, outcome: 'conflict_pending' }
    })
  } catch (err) {
    console.error('enroll decision failed:', err)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }

  logDecision({ stationId, tokenId, ip, outcome: decision.outcome })

  return NextResponse.json(
    { ok: true, stationId, status: decision.status },
    { status: decision.status === 'active' ? 201 : 202 }
  )
}
