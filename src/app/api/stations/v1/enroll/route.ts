import { NextRequest, NextResponse } from 'next/server'
import { verifyEnrollRequest } from '@/lib/ingestAuth'
import { withClient } from '@/lib/stationControls'
import {
  enrollBodySchema,
  runLegacyEnrollment,
  runManagedEnrollment,
  tokenLifecycleOutcome,
  type EnrollmentTokenRow,
} from '@/lib/stationEnroll'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/stations/v1/enroll — station auto-enrollment.
 *
 * Bodies with `enrollmentRequestId` take the managed path: the server
 * allocates an opaque station ID and keys retries on
 * (token_id, enrollmentRequestId). Bodies without it keep the legacy
 * candidate-as-ID path.
 *
 * HMAC is verified before any enrollment state is revealed. Idempotent
 * retries of an already-created managed enrollment still resolve after
 * the bootstrap token expires, is revoked, or hits max_uses.
 */

const MAX_BODY_BYTES = 8 * 1024

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
  candidateStationId?: string
  enrollmentRequestId?: string | null
  tokenId: string
  ip: string | null
  outcome: string
}) {
  const candidate = params.candidateStationId
    ? ` candidate_id=${params.candidateStationId}`
    : ''
  const requestId =
    params.enrollmentRequestId != null && params.enrollmentRequestId !== ''
      ? ` request_id=${params.enrollmentRequestId}`
      : ''
  console.log(
    `[enroll] station_id=${params.stationId}${candidate}${requestId} token_id=${
      params.tokenId
    } ip=${params.ip ?? '-'} outcome=${params.outcome}`
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
    logDecision({
      stationId: stationIdHeader,
      tokenId: '-',
      ip,
      outcome: 'auth_missing_token_id',
    })
    return authError()
  }

  // Include revoked/expired/exhausted rows — HMAC still needs the secret so
  // a lost-response retry can resolve after the token's lifecycle ends.
  let token: EnrollmentTokenRow | undefined
  try {
    token = await withClient(async (client) => {
      const r = await client.query(
        `SELECT token_secret, expires_at, max_uses, uses, revoked_at
         FROM EnrollmentTokens WHERE token_id = $1`,
        [tokenId]
      )
      return r.rows[0] as EnrollmentTokenRow | undefined
    })
  } catch (err) {
    console.error('enroll token lookup failed:', err)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }

  if (!token) {
    logDecision({
      stationId: stationIdHeader,
      tokenId,
      ip,
      outcome: 'auth_unknown_token',
    })
    return authError()
  }

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
    console.error('enroll auth (nonce store) failed:', err)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
  if (!auth.ok) {
    logDecision({
      stationId: stationIdHeader,
      tokenId,
      ip,
      outcome: `auth_${auth.reason}`,
    })
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

  try {
    if (body.enrollmentRequestId) {
      const decision = await runManagedEnrollment({
        tokenId,
        token,
        body,
        ip,
      })
      if (decision.kind === 'auth') {
        logDecision({
          stationId: body.stationId,
          candidateStationId: body.stationId,
          enrollmentRequestId: body.enrollmentRequestId,
          tokenId,
          ip,
          outcome: decision.outcome,
        })
        return authError()
      }
      if (decision.kind === 'reject') {
        logDecision({
          stationId: body.stationId,
          candidateStationId: body.stationId,
          enrollmentRequestId: body.enrollmentRequestId,
          tokenId,
          ip,
          outcome: decision.outcome,
        })
        return NextResponse.json({ error: decision.error }, { status: 400 })
      }
      logDecision({
        stationId: decision.stationId,
        candidateStationId: decision.candidateStationId,
        enrollmentRequestId: decision.enrollmentRequestId,
        tokenId,
        ip,
        outcome: decision.outcome,
      })
      return NextResponse.json(
        { ok: true, stationId: decision.stationId, status: decision.status },
        { status: decision.http }
      )
    }

    const dead = tokenLifecycleOutcome(token)
    if (dead) {
      logDecision({
        stationId: body.stationId,
        tokenId,
        ip,
        outcome: dead,
      })
      return authError()
    }

    const decision = await runLegacyEnrollment({
      tokenId,
      token,
      body,
      ip,
    })
    if (decision.kind !== 'ok') {
      logDecision({
        stationId: body.stationId,
        tokenId,
        ip,
        outcome: decision.outcome,
      })
      return authError()
    }
    logDecision({
      stationId: decision.stationId,
      candidateStationId: decision.candidateStationId,
      tokenId,
      ip,
      outcome: decision.outcome,
    })
    return NextResponse.json(
      { ok: true, stationId: decision.stationId, status: decision.status },
      { status: decision.http }
    )
  } catch (err) {
    console.error('enroll decision failed:', err)
    return NextResponse.json({ error: 'server_error' }, { status: 500 })
  }
}
