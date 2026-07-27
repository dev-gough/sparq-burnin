import { createHmac, createHash, timingSafeEqual, randomBytes } from 'crypto'
import { withClient } from '@/lib/stationControls'

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
 */

const DEFAULT_SKEW_SEC = 300

export function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

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
  const canonical = buildIngestCanonical(params)
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex')
}

export function createIngestNonce(): string {
  return randomBytes(16).toString('hex')
}

export type IngestAuthFailure =
  | 'missing_headers'
  | 'bad_timestamp'
  | 'skew'
  | 'replay'
  | 'bad_signature'
  | 'unknown_station'
  | 'station_mismatch'

export type IngestAuthResult =
  | { ok: true; stationId: string }
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
  bodyStationId: string | undefined
  getStation: (stationId: string) => { secret: string } | undefined
  skewSec?: number
}): Promise<IngestAuthResult> {
  const stationId = params.stationIdHeader?.trim() || ''
  const timestamp = params.request.headers.get('x-ingest-timestamp')?.trim() || ''
  const nonce = params.request.headers.get('x-ingest-nonce')?.trim() || ''
  const signature = params.request.headers.get('x-ingest-signature')?.trim() || ''

  if (!stationId || !timestamp || !nonce || !signature) {
    return { ok: false, reason: 'missing_headers' }
  }

  if (params.bodyStationId != null && params.bodyStationId !== stationId) {
    return { ok: false, reason: 'station_mismatch' }
  }

  const station = params.getStation(stationId)
  if (!station) {
    return { ok: false, reason: 'unknown_station' }
  }

  if (!/^\d+$/.test(timestamp)) {
    return { ok: false, reason: 'bad_timestamp' }
  }

  const skewSec =
    params.skewSec ?? Number(process.env.INGEST_HMAC_SKEW_SEC || DEFAULT_SKEW_SEC)
  const ts = Number(timestamp)
  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - ts) > skewSec) {
    return { ok: false, reason: 'skew' }
  }

  // Verify the signature BEFORE touching the nonce store: only a request with a
  // valid signature may consume/record a nonce, so an unauthenticated caller
  // can never poison the store to lock out a legitimate (timestamp, nonce).
  const url = new URL(params.request.url)
  const bodySha256Hex = sha256Hex(params.rawBody)
  const expected = signIngestRequest(station.secret, {
    timestamp,
    nonce,
    method: params.request.method,
    path: url.pathname,
    stationId,
    bodySha256Hex,
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

  // Signature is valid — atomically claim the nonce. A DB error propagates so
  // the caller fails closed (500); we never accept an unverifiable nonce.
  const nonceKey = `${stationId}:${nonce}`
  const firstUse = await recordNonce(nonceKey, stationId, skewSec * 2)
  if (!firstUse) {
    return { ok: false, reason: 'replay' }
  }

  return { ok: true, stationId }
}
