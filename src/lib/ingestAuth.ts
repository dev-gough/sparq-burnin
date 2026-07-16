import { createHmac, createHash, timingSafeEqual, randomBytes } from 'crypto'

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
const NONCE_TTL_MS = 5 * 60 * 1000

type NonceEntry = { expiresAt: number }
const usedNonces = new Map<string, NonceEntry>()

function pruneNonces(now = Date.now()) {
  for (const [k, v] of usedNonces) {
    if (v.expiresAt <= now) usedNonces.delete(k)
  }
}

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
  | 'station_disabled'
  | 'station_mismatch'

export type IngestAuthResult =
  | { ok: true; stationId: string }
  | { ok: false; reason: IngestAuthFailure }

export function verifyIngestRequest(params: {
  request: Request
  rawBody: Buffer
  stationIdHeader: string
  bodyStationId: string | undefined
  getStation: (stationId: string) => { secret: string; enabled: boolean } | undefined
  skewSec?: number
}): IngestAuthResult {
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
  if (!station.enabled) {
    return { ok: false, reason: 'station_disabled' }
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

  pruneNonces()
  const nonceKey = `${stationId}:${nonce}`
  if (usedNonces.has(nonceKey)) {
    return { ok: false, reason: 'replay' }
  }

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

  usedNonces.set(nonceKey, { expiresAt: Date.now() + NONCE_TTL_MS })
  return { ok: true, stationId }
}
