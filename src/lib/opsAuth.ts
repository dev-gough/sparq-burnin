import {
  hmacSha256Hex,
  randomHexNonce,
  readSignedHeaders,
  verifyHmacCore,
  type HmacCoreFailure,
} from '@/lib/hmacVerifyCore'

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
 *
 * Verification mechanics live in @/lib/hmacVerifyCore (shared with
 * ingestAuth).
 *
 * NONCE STORE DECISION (plan 2.2): ops replay protection deliberately stays
 * in-memory rather than moving to the DB-backed IngestNonces table:
 *   - ops endpoints are a low-volume operator tool behind a single shared
 *     secret with a tight skew window (60 s); losing the nonce set on process
 *     restart is bounded by that window.
 *   - the ops log endpoint is exactly what you want reachable when the DB is
 *     degraded — coupling its auth to Postgres would fail it closed at the
 *     worst time (ingest, by contrast, MUST fail closed on DB loss).
 *   - keeping the store sync keeps verifyOpsRequest's synchronous signature,
 *     so callers are untouched.
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

/** Record a nonce; true on first use, false on replay. */
function claimOpsNonce(nonce: string): boolean {
  pruneNonces()
  if (usedNonces.has(nonce)) return false
  usedNonces.set(nonce, { expiresAt: Date.now() + NONCE_TTL_MS })
  return true
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
  return hmacSha256Hex(secret, buildOpsCanonical(params))
}

export function createOpsNonce(): string {
  return randomHexNonce()
}

export type OpsAuthFailure = 'not_configured' | HmacCoreFailure

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

  const { timestamp, nonce, signature } = readSignedHeaders(request, 'x-ops')

  const skewSec =
    opts?.skewSec ?? Number(process.env.OPS_HMAC_SKEW_SEC || DEFAULT_SKEW_SEC)
  const url = new URL(request.url)

  return verifyHmacCore({
    timestamp,
    nonce,
    signature,
    skewSec,
    computeExpectedSignature: () =>
      signOpsRequest(secret, {
        timestamp,
        nonce,
        method: request.method,
        path: url.pathname,
        rawQuery: url.search.startsWith('?') ? url.search.slice(1) : url.search,
      }),
    claimNonce: claimOpsNonce,
  })
}

/** Soft 404 — never reveal whether the route exists or why auth failed. */
export function opsUnauthorizedResponse(): Response {
  return new Response(null, { status: 404 })
}
