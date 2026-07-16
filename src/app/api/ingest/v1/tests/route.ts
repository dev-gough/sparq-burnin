import { NextRequest, NextResponse } from 'next/server'
import { gunzipSync } from 'zlib'
import { verifyIngestRequest, sha256Hex } from '@/lib/ingestAuth'
import {
  getStation,
  ingestPayloadSchema,
  loadIngestConfig,
  processIngestPayload,
} from '@/lib/ingest'

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

  // Auth needs body hash of wire bytes; body stationId checked after parse.
  // First pass: verify with header station only (body station checked later).
  const earlyAuth = verifyIngestRequest({
    request,
    rawBody,
    stationIdHeader,
    bodyStationId: undefined,
    getStation,
  })
  if (!earlyAuth.ok) {
    if (earlyAuth.reason === 'station_disabled') {
      return errorJson(403, 'station_disabled', 'Station ingest is disabled')
    }
    if (earlyAuth.reason === 'station_mismatch') {
      return errorJson(400, 'station_mismatch', 'Station id mismatch')
    }
    return errorJson(401, 'auth', `Unauthorized (${earlyAuth.reason})`)
  }

  let jsonText: string
  try {
    const encoding = (
      request.headers.get('content-encoding') || ''
    ).toLowerCase()
    if (encoding.includes('gzip') || rawBody[0] === 0x1f) {
      jsonText = gunzipSync(rawBody).toString('utf8')
    } else {
      // Allow uncompressed JSON for local testing
      jsonText = rawBody.toString('utf8')
    }
  } catch {
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
