/**
 * Route-level tests for POST /api/ingest/v1/tests (plan Phase 3):
 * gzip bomb → 400 too_large, oversized compressed body → 400 too_large,
 * plus the surrounding error contract the station's retry policy depends on.
 *
 * Contract reminder (docs/HANDOFF.md): the station treats any 4xx except
 * 401/403/408/429 as permanent — these tests pin which conditions produce
 * which status so a retryable condition can never silently become a 4xx.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { gzipSync } from 'zlib'
import type { NextRequest } from 'next/server'

const STATION = 'BurnInTest-1'
const SECRET = 'test-secret-1'
const MAX_BODY = 2048
const MAX_SAMPLES = 3

const processMock = vi.fn()
vi.mock('@/lib/ingest', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>()
  return {
    ...original,
    loadIngestConfig: () => ({
      maxBodyBytes: MAX_BODY,
      maxSamples: MAX_SAMPLES,
      stations: { [STATION]: { secret: SECRET } },
    }),
    getStation: (id: string) =>
      id === STATION ? { secret: SECRET } : undefined,
    processIngestPayload: (...args: unknown[]) => processMock(...args),
  }
})

let stationEnabled = true
const nonceStore = new Set<string>()
vi.mock('@/lib/stationControls', () => ({
  withClient: async (fn: (client: unknown) => Promise<unknown>) =>
    fn({
      query: async (sql: string, params: string[]) => {
        if (sql.startsWith('DELETE')) return { rows: [] }
        if (nonceStore.has(params[0])) return { rows: [] }
        nonceStore.add(params[0])
        return { rows: [{ nonce: params[0] }] }
      },
    }),
  isStationEnabled: async () => stationEnabled,
}))

import { POST } from '@/app/api/ingest/v1/tests/route'
import { signIngestRequest, sha256Hex } from '@/lib/ingestAuth'

let nonceCounter = 0

function signedRequest(
  rawBody: Buffer,
  opts: { signature?: string; stationId?: string } = {}
): NextRequest {
  const stationId = opts.stationId ?? STATION
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = `n${String(nonceCounter++).padStart(31, '0')}`
  const signature =
    opts.signature ??
    signIngestRequest(SECRET, {
      timestamp,
      nonce,
      method: 'POST',
      path: '/api/ingest/v1/tests',
      stationId,
      bodySha256Hex: sha256Hex(rawBody),
    })
  return new Request('https://dashboard.example/api/ingest/v1/tests', {
    method: 'POST',
    headers: {
      'x-station-id': stationId,
      'x-ingest-timestamp': timestamp,
      'x-ingest-nonce': nonce,
      'x-ingest-signature': signature,
      'content-encoding': 'gzip',
    },
    body: new Uint8Array(rawBody),
  }) as unknown as NextRequest
}

function validPayload() {
  return {
    schemaVersion: 1,
    stationId: STATION,
    idempotencyKey: 'k1',
    result: {
      serialNumber: '107000123456',
      startTime: '2025-06-15T09:00:00',
      endTime: '2025-06-16T09:00:00',
      overallStatus: 'PASS',
    },
    samples: [{ timestamp: '2025-06-15T09:01:00', vgrid: 240.1 }],
  }
}

const gz = (value: unknown) => gzipSync(Buffer.from(JSON.stringify(value)))

async function body(response: Response) {
  return (await response.json()) as { ok: boolean; code?: string; message?: string }
}

beforeEach(() => {
  processMock.mockReset()
  stationEnabled = true
})

describe('POST /api/ingest/v1/tests', () => {
  it('oversized compressed body → 400 too_large (before auth)', async () => {
    const response = await POST(signedRequest(Buffer.alloc(MAX_BODY + 1)))
    expect(response.status).toBe(400)
    expect(await body(response)).toMatchObject({ code: 'too_large' })
  })

  it('gzip bomb → 400 too_large without inflating past the cap', async () => {
    // ~64 KiB of spaces compresses to well under MAX_BODY, but inflates past
    // the 8× cap (16 KiB) → must reject as too_large, not attempt full inflate.
    const bomb = gzipSync(Buffer.alloc(64 * 1024, 0x20))
    expect(bomb.byteLength).toBeLessThan(MAX_BODY)
    const response = await POST(signedRequest(bomb))
    expect(response.status).toBe(400)
    const json = await body(response)
    expect(json.code).toBe('too_large')
    expect(json.message).toContain('Decompressed body exceeds cap')
    expect(processMock).not.toHaveBeenCalled()
  })

  it('corrupt gzip → 400 invalid_schema', async () => {
    const corrupt = Buffer.concat([
      Buffer.from([0x1f, 0x8b]),
      Buffer.from('definitely not a deflate stream'),
    ])
    const response = await POST(signedRequest(corrupt))
    expect(response.status).toBe(400)
    expect(await body(response)).toMatchObject({ code: 'invalid_schema' })
  })

  it('valid gzip of non-JSON → 400 invalid_schema', async () => {
    const response = await POST(
      signedRequest(gzipSync(Buffer.from('hello world')))
    )
    expect(response.status).toBe(400)
    const json = await body(response)
    expect(json.code).toBe('invalid_schema')
    expect(json.message).toBe('Body is not valid JSON')
  })

  it('samples over maxSamples → 400 too_large (pre-zod short-circuit)', async () => {
    const payload = validPayload()
    payload.samples = Array.from({ length: MAX_SAMPLES + 1 }, () => ({
      timestamp: '2025-06-15T09:01:00',
      vgrid: 1,
    }))
    const response = await POST(signedRequest(gz(payload)))
    expect(response.status).toBe(400)
    const json = await body(response)
    expect(json.code).toBe('too_large')
    expect(json.message).toContain('maxSamples')
  })

  it('schema violation → 400 invalid_schema with the offending path', async () => {
    const payload = { ...validPayload(), runId: null }
    const response = await POST(signedRequest(gz(payload)))
    expect(response.status).toBe(400)
    const json = await body(response)
    expect(json.code).toBe('invalid_schema')
    expect(json.message).toContain('runId')
    expect(processMock).not.toHaveBeenCalled()
  })

  it('body stationId ≠ header station → 400 station_mismatch', async () => {
    const payload = { ...validPayload(), stationId: 'BurnInTest-2' }
    const response = await POST(signedRequest(gz(payload)))
    expect(response.status).toBe(400)
    expect(await body(response)).toMatchObject({ code: 'station_mismatch' })
  })

  it('bad signature → 401 auth', async () => {
    const response = await POST(
      signedRequest(gz(validPayload()), { signature: 'f'.repeat(64) })
    )
    expect(response.status).toBe(401)
    expect(await body(response)).toMatchObject({ code: 'auth' })
  })

  it('disabled station still ingests (enablement gates test STARTS, not data)', async () => {
    // Ratified 2026-07-28: StationControls "disabled" stops the station from
    // starting new tests (via the policy endpoint); data the software already
    // produced is always accepted. Rejecting here would turn an admin toggle
    // into silent data loss once the outbox retention lapses.
    stationEnabled = false
    processMock.mockResolvedValue({
      ok: true,
      testId: 9,
      idempotencyKey: 'k1',
      duplicate: false,
      overallStatus: 'PASS',
      stationId: STATION,
    })
    const response = await POST(signedRequest(gz(validPayload())))
    expect(response.status).toBe(200)
    expect(processMock).toHaveBeenCalledTimes(1)
  })

  it('happy path: 200, and processIngestPayload gets the verified body hash', async () => {
    processMock.mockResolvedValue({
      ok: true,
      testId: 7,
      idempotencyKey: 'k1',
      duplicate: false,
      overallStatus: 'PASS',
      stationId: STATION,
    })
    const raw = gz(validPayload())
    const response = await POST(signedRequest(raw))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      ok: true,
      testId: 7,
      duplicate: false,
    })
    expect(processMock).toHaveBeenCalledTimes(1)
    const [payloadArg, hashArg] = processMock.mock.calls[0]
    expect((payloadArg as { idempotencyKey: string }).idempotencyKey).toBe('k1')
    // The hash handed to processing is the hash of the RAW (gzipped) body —
    // the exact bytes the signature covered.
    expect(hashArg).toBe(sha256Hex(raw))
  })

  it('processing failure → 500 server_error (transient class for the client)', async () => {
    processMock.mockResolvedValue({
      ok: false,
      code: 'server_error',
      message: 'db down',
    })
    const response = await POST(signedRequest(gz(validPayload())))
    expect(response.status).toBe(500)
    expect(await body(response)).toMatchObject({ code: 'server_error' })
  })
})
