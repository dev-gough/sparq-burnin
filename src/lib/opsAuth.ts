import { createHmac, timingSafeEqual, randomBytes } from 'crypto'

/**
 * HMAC request auth for ops endpoints (log fetch, etc.)
 *
 * Client sends:
 *   X-Ops-Timestamp: <unix seconds>
 *   X-Ops-Nonce: <unique string>
 *   X-Ops-Signature: hex(HMAC-SHA256(secret, canonical))
 *
 * Canonical string (UTF-8):
 *   `${timestamp}\n${nonce}\n${method}\n${path}\n${rawQuery}`
 *
 * path is pathname only (e.g. /api/ops/logs). rawQuery is the query
 * string without leading `?` (empty string if none), sorted is NOT required —
 * client must sign the exact query it sends.
 */

const DEFAULT_SKEW_SEC = 60
const NONCE_TTL_MS = 2 * 60 * 1000 // keep nonces a bit longer than skew

type NonceEntry = { expiresAt: number }

const usedNonces = new Map<string, NonceEntry>()

function pruneNonces(now = Date.now()) {
  for (const [k, v] of usedNonces) {
    if (v.expiresAt <= now) usedNonces.delete(k)
  }
}

export function getOpsHmacSecret(): string | undefined {
  const s = process.env.OPS_HMAC_SECRET?.trim()
  return s || undefined
}

export function buildOpsCanonical(params: {
  timestamp: string
  nonce: string
  method: string
  path: string
  rawQuery: string
}): string {
  return [
    params.timestamp,
    params.nonce,
    params.method.toUpperCase(),
    params.path,
    params.rawQuery || '',
  ].join('\n')
}

export function signOpsRequest(
  secret: string,
  params: {
    timestamp: string
    nonce: string
    method: string
    path: string
    rawQuery: string
  }
): string {
  const canonical = buildOpsCanonical(params)
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex')
}

export function createOpsNonce(): string {
  return randomBytes(16).toString('hex')
}

export type OpsAuthFailure =
  | 'not_configured'
  | 'missing_headers'
  | 'bad_timestamp'
  | 'skew'
  | 'replay'
  | 'bad_signature'

export type OpsAuthResult =
  | { ok: true }
  | { ok: false; reason: OpsAuthFailure }

/**
 * Verify HMAC headers. On any failure, callers should respond with 404
 * (do not advertise the endpoint).
 */
export function verifyOpsRequest(
  request: Request,
  opts?: { skewSec?: number }
): OpsAuthResult {
  const secret = getOpsHmacSecret()
  if (!secret) {
    return { ok: false, reason: 'not_configured' }
  }

  const timestamp = request.headers.get('x-ops-timestamp')?.trim() || ''
  const nonce = request.headers.get('x-ops-nonce')?.trim() || ''
  const signature = request.headers.get('x-ops-signature')?.trim() || ''

  if (!timestamp || !nonce || !signature) {
    return { ok: false, reason: 'missing_headers' }
  }

  if (!/^\d+$/.test(timestamp)) {
    return { ok: false, reason: 'bad_timestamp' }
  }

  const skewSec = opts?.skewSec ?? Number(process.env.OPS_HMAC_SKEW_SEC || DEFAULT_SKEW_SEC)
  const ts = Number(timestamp)
  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - ts) > skewSec) {
    return { ok: false, reason: 'skew' }
  }

  pruneNonces()
  if (usedNonces.has(nonce)) {
    return { ok: false, reason: 'replay' }
  }

  const url = new URL(request.url)
  const expected = signOpsRequest(secret, {
    timestamp,
    nonce,
    method: request.method,
    path: url.pathname,
    rawQuery: url.search.startsWith('?') ? url.search.slice(1) : url.search,
  })

  try {
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(signature, 'utf8')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'bad_signature' }
    }
  } catch {
    return { ok: false, reason: 'bad_signature' }
  }

  usedNonces.set(nonce, { expiresAt: Date.now() + NONCE_TTL_MS })
  return { ok: true }
}

/** Soft 404 — never reveal whether the route exists or why auth failed. */
export function opsUnauthorizedResponse(): Response {
  return new Response(null, { status: 404 })
}
