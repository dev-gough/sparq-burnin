import { createHmac, createHash, timingSafeEqual, randomBytes } from 'crypto'

/**
 * Shared HMAC request-verification core.
 *
 * Consumed by:
 *   - src/lib/ingestAuth.ts  (station → dashboard ingest; X-Ingest-* headers,
 *     DB-backed nonce store, async claim)
 *   - src/lib/opsAuth.ts     (ops endpoints; X-Ops-* headers, in-memory nonce
 *     store, sync claim)
 *
 * The two schemes differ only in header prefix, canonical-string fields, skew
 * default, and nonce storage — all parameterized here. Each caller supplies:
 *   - computeExpectedSignature: builds its own canonical string and signs it
 *     (the canonical formats are wire contracts and stay in the owning module)
 *   - claimNonce: atomically records a nonce, returning true on first use.
 *     May be sync (in-memory) or async (DB) — overloads keep the caller's
 *     sync/async signature intact.
 *
 * Check order (identical to both former implementations, and load-bearing):
 *   missing_headers → bad_timestamp → skew → bad_signature → replay.
 * The signature is verified BEFORE the nonce is claimed so an unauthenticated
 * caller can never poison the nonce store to lock out a legitimate
 * (timestamp, nonce) pair.
 */

export type HmacCoreFailure =
  | 'missing_headers'
  | 'bad_timestamp'
  | 'skew'
  | 'replay'
  | 'bad_signature'

export type HmacCoreResult = { ok: true } | { ok: false; reason: HmacCoreFailure }

export function sha256Hex(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex')
}

export function hmacSha256Hex(secret: string, canonical: string): string {
  return createHmac('sha256', secret).update(canonical, 'utf8').digest('hex')
}

export function randomHexNonce(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Read the `<prefix>-timestamp`, `<prefix>-nonce`, `<prefix>-signature`
 * headers (e.g. prefix 'x-ingest' or 'x-ops'), trimmed, '' when absent.
 */
export function readSignedHeaders(
  request: Request,
  prefix: string
): { timestamp: string; nonce: string; signature: string } {
  return {
    timestamp: request.headers.get(`${prefix}-timestamp`)?.trim() || '',
    nonce: request.headers.get(`${prefix}-nonce`)?.trim() || '',
    signature: request.headers.get(`${prefix}-signature`)?.trim() || '',
  }
}

interface HmacCoreParamsBase {
  timestamp: string
  nonce: string
  signature: string
  /** Max allowed |now - timestamp| in seconds. */
  skewSec: number
  /** Build the expected signature (hex) for this request's canonical string. */
  computeExpectedSignature: () => string
}

/** Sync nonce store (e.g. in-memory Map) — returns a sync result. */
export function verifyHmacCore(
  params: HmacCoreParamsBase & { claimNonce: (nonce: string) => boolean }
): HmacCoreResult
/** Async nonce store (e.g. IngestNonces table) — returns a Promise. A rejected
 *  claim (DB unreachable) propagates so callers FAIL CLOSED. */
export function verifyHmacCore(
  params: HmacCoreParamsBase & { claimNonce: (nonce: string) => Promise<boolean> }
): Promise<HmacCoreResult>
export function verifyHmacCore(
  params: HmacCoreParamsBase & {
    claimNonce: (nonce: string) => boolean | Promise<boolean>
  }
): HmacCoreResult | Promise<HmacCoreResult> {
  const { timestamp, nonce, signature } = params

  if (!timestamp || !nonce || !signature) {
    return { ok: false, reason: 'missing_headers' }
  }

  if (!/^\d+$/.test(timestamp)) {
    return { ok: false, reason: 'bad_timestamp' }
  }

  const ts = Number(timestamp)
  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - ts) > params.skewSec) {
    return { ok: false, reason: 'skew' }
  }

  const expected = params.computeExpectedSignature()
  try {
    const a = Buffer.from(expected, 'utf8')
    const b = Buffer.from(signature, 'utf8')
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, reason: 'bad_signature' }
    }
  } catch {
    return { ok: false, reason: 'bad_signature' }
  }

  // Signature valid — claim the nonce (first use wins, reuse is a replay).
  const claimed = params.claimNonce(nonce)
  if (typeof claimed === 'boolean') {
    return claimed ? { ok: true } : { ok: false, reason: 'replay' }
  }
  return claimed.then((first) =>
    first ? ({ ok: true } as const) : ({ ok: false, reason: 'replay' } as const)
  )
}
