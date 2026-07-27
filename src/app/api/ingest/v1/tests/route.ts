import { NextRequest, NextResponse } from 'next/server'
import { promisify } from 'util'
import zlib from 'zlib'

const gunzipAsync = promisify(zlib.gunzip)
import { verifyIngestRequest, sha256Hex } from '@/lib/ingestAuth'
import {
  getStation,
  ingestPayloadSchema,
  loadIngestConfig,
  processIngestPayload,
} from '@/lib/ingest'
import { isStationEnabled } from '@/lib/stationControls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
/** Allow long-running COPY for large sample payloads (seconds). */
export const maxDuration = 600

function errorJson(
  status: number,
  code: string,
  message: string
): NextResponse {
  return NextResponse.json({ ok: false, code, message }, { status })
}

export async function POST(request: NextRequest) {
  const ingestConfig = loadIngestConfig()
  const stationIdHeader = request.headers.get('x-station-id')?.trim() || ''

  let rawBody: Buffer
  try {
    const ab = await request.arrayBuffer()
    rawBody = Buffer.from(ab)
  } catch {
    return errorJson(400, 'invalid_schema', 'Failed to read request body')
  }

  if (rawBody.byteLength === 0) {
    return errorJson(400, 'invalid_schema', 'Empty body')
  }
  if (rawBody.byteLength > ingestConfig.maxBodyBytes) {
    return errorJson(
      400,
      'too_large',
      `Body exceeds maxBodyBytes (${ingestConfig.maxBodyBytes})`
    )
  }

  // HMAC identity only (config secret). Runtime enablement is StationControls.
  let earlyAuth
  try {
    earlyAuth = await verifyIngestRequest({
      request,
      rawBody,
      stationIdHeader,
      bodyStationId: undefined,
      getStation: (id) => {
        const s = getStation(id)
        if (!s) return undefined
        return { secret: s.secret }
      },
    })
  } catch (err) {
    // Nonce store unreachable — fail closed; station treats 500 as transient.
    console.error('ingest auth (nonce store) failed:', err)
    return errorJson(500, 'server_error', 'Failed to verify request')
  }
  if (!earlyAuth.ok) {
    if (earlyAuth.reason === 'station_mismatch') {
      return errorJson(400, 'station_mismatch', 'Station id mismatch')
    }
    return errorJson(401, 'auth', `Unauthorized (${earlyAuth.reason})`)
  }

  try {
    const allowed = await isStationEnabled(earlyAuth.stationId)
    if (!allowed) {
      return errorJson(
        403,
        'station_disabled',
        'Station is disabled (remote control)'
      )
    }
  } catch (err) {
    console.error('station enable check failed:', err)
    return errorJson(500, 'server_error', 'Failed to check station policy')
  }

  // Cap decompressed output to bound the gzip-bomb amplification factor.
  // maxBodyBytes only limits the compressed body; without an inflated-size cap a
  // malicious gzip could expand toward gigabytes and OOM the process. A legitimate
  // payload is <=maxSamples (500k) samples of ~40 numeric fields — well under
  // maxBodyBytes uncompressed — so 8x the compressed cap leaves ample headroom for
  // real traffic while keeping any single allocation bounded.
  const maxDecompressedBytes = ingestConfig.maxBodyBytes * 8

  let jsonText: string
  try {
    const encoding = (
      request.headers.get('content-encoding') || ''
    ).toLowerCase()
    if (encoding.includes('gzip') || rawBody[0] === 0x1f) {
      // Async gunzip so a large/slow inflate does not block the event loop;
      // maxOutputLength aborts (RangeError/ERR_BUFFER_TOO_LARGE) before allocating
      // past the cap.
      const inflated = await gunzipAsync(rawBody, {
        maxOutputLength: maxDecompressedBytes,
      })
      jsonText = inflated.toString('utf8')
    } else {
      // Allow uncompressed JSON for local testing
      jsonText = rawBody.toString('utf8')
    }
  } catch (err) {
    if (
      err instanceof RangeError ||
      (err as NodeJS.ErrnoException)?.code === 'ERR_BUFFER_TOO_LARGE'
    ) {
      return errorJson(
        400,
        'too_large',
        `Decompressed body exceeds cap (${maxDecompressedBytes} bytes)`
      )
    }
    return errorJson(400, 'invalid_schema', 'Failed to decompress gzip body')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch {
    return errorJson(400, 'invalid_schema', 'Body is not valid JSON')
  }

  const schemaResult = ingestPayloadSchema.safeParse(parsed)
  if (!schemaResult.success) {
    return errorJson(
      400,
      'invalid_schema',
      schemaResult.error.issues
        .slice(0, 5)
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')
    )
  }

  const payload = schemaResult.data

  if (payload.stationId !== earlyAuth.stationId) {
    return errorJson(
      400,
      'station_mismatch',
      'X-Station-Id does not match body stationId'
    )
  }

  if (payload.samples.length > ingestConfig.maxSamples) {
    return errorJson(
      400,
      'too_large',
      `samples length exceeds maxSamples (${ingestConfig.maxSamples})`
    )
  }

  const bodyHash = sha256Hex(rawBody)
  const result = await processIngestPayload(payload, bodyHash)

  if (!result.ok) {
    return errorJson(500, result.code, result.message)
  }

  return NextResponse.json({
    ok: true,
    testId: result.testId,
    idempotencyKey: result.idempotencyKey,
    duplicate: result.duplicate,
    overallStatus: result.overallStatus,
    stationId: result.stationId,
  })
}
