import { withClient } from '@/lib/stationControls'
import {
  hmacSha256Hex,
  randomHexNonce,
  readSignedHeaders,
  sha256Hex,
  verifyHmacCore,
  type HmacCoreFailure,
} from '@/lib/hmacVerifyCore'

/**
 * HMAC auth for station → dashboard ingest POSTs.
 *
 * Headers:
 *   X-Station-Id
 *   X-Ingest-Timestamp  (unix seconds)
 *   X-Ingest-Nonce
 *   X-Ingest-Signature  hex(HMAC-SHA256(secret, canonical))
 *
 * Canonical (UTF-8):
 *   `${timestamp}\n${nonce}\nPOST\n/api/ingest/v1/tests\n${stationId}\n${sha256_hex(rawBody)}`
 *
 * The canonical format is a wire contract shared with the station repo —
 * pinned by tests/fixtures/hmac_golden_vectors.json (byte-identical in both
 * repos). Verification mechanics live in @/lib/hmacVerifyCore.
 */

const DEFAULT_SKEW_SEC = 300

export { sha256Hex }

export function buildIngestCanonical(params: {
  timestamp: string
  nonce: string
  method: string
  path: string
  stationId: string
  bodySha256Hex: string
}): string {
  return [
    params.timestamp,
    params.nonce,
    params.method.toUpperCase(),
    params.path,
    params.stationId,
    params.bodySha256Hex,
  ].join('\n')
}

export function signIngestRequest(
  secret: string,
  params: {
    timestamp: string
    nonce: string
    method: string
    path: string
    stationId: string
    bodySha256Hex: string
  }
): string {
  return hmacSha256Hex(secret, buildIngestCanonical(params))
}

export function createIngestNonce(): string {
  return randomHexNonce()
}

export type IngestAuthFailure = HmacCoreFailure | 'unknown_station'

export type IngestAuthResult =
  | { ok: true; stationId: string; bodySha256Hex: string }
  | { ok: false; reason: IngestAuthFailure }

/**
 * Atomically record a nonce and detect replay via the shared IngestNonces table.
 * Returns true on first use (row inserted), false on replay (ON CONFLICT hit).
 * Opportunistically prunes rows older than the TTL so the table stays tiny
 * without a cron. Throws if the DB is unreachable — callers must FAIL CLOSED.
 *
 * The nonce key is namespaced by station id so two stations can never collide,
 * matching the prior in-memory `${stationId}:${nonce}` key.
 */
async function recordNonce(
  nonceKey: string,
  stationId: string,
  ttlSec: number
): Promise<boolean> {
  return withClient(async (client) => {
    // Prune expired nonces first (cheap; index on seen_at). TTL = 2x skew window.
    await client.query(
      `DELETE FROM IngestNonces WHERE seen_at < NOW() - ($1 || ' seconds')::interval`,
      [String(ttlSec)]
    )
    const r = await client.query(
      `INSERT INTO IngestNonces (nonce, station_id)
       VALUES ($1, $2)
       ON CONFLICT (nonce) DO NOTHING
       RETURNING nonce`,
      [nonceKey, stationId]
    )
    return r.rows.length > 0
  })
}

export async function verifyIngestRequest(params: {
  request: Request
  rawBody: Buffer
  stationIdHeader: string
  getStation: (stationId: string) => { secret: string } | undefined
  skewSec?: number
}): Promise<IngestAuthResult> {
  const stationId = params.stationIdHeader?.trim() || ''
  const { timestamp, nonce, signature } = readSignedHeaders(
    params.request,
    'x-ingest'
  )

  // Station id is part of the required header set — checked here (with the
  // core's trio) so a missing station id reports missing_headers, not
  // unknown_station.
  if (!stationId || !timestamp || !nonce || !signature) {
    return { ok: false, reason: 'missing_headers' }
  }

  const station = params.getStation(stationId)
  if (!station) {
    return { ok: false, reason: 'unknown_station' }
  }

  const skewSec =
    params.skewSec ?? Number(process.env.INGEST_HMAC_SKEW_SEC || DEFAULT_SKEW_SEC)
  const url = new URL(params.request.url)

  // Body hash is computed lazily inside the signature callback (requests
  // rejected on skew never pay for it) and captured so callers can reuse it
  // (e.g. as the ingest payload hash) instead of re-hashing the raw body.
  let bodySha256Hex = ''

  // Core verifies the signature BEFORE touching the nonce store: only a request
  // with a valid signature may consume/record a nonce. A DB error from
  // recordNonce propagates so the caller fails closed (500); we never accept an
  // unverifiable nonce.
  const result = await verifyHmacCore({
    timestamp,
    nonce,
    signature,
    skewSec,
    computeExpectedSignature: () => {
      bodySha256Hex = sha256Hex(params.rawBody)
      return signIngestRequest(station.secret, {
        timestamp,
        nonce,
        method: params.request.method,
        path: url.pathname,
        stationId,
        bodySha256Hex,
      })
    },
    claimNonce: (n) => recordNonce(`${stationId}:${n}`, stationId, skewSec * 2),
  })

  if (!result.ok) {
    return { ok: false, reason: result.reason }
  }
  return { ok: true, stationId, bodySha256Hex }
}
