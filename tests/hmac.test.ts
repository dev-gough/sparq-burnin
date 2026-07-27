/**
 * HMAC contract tests against the shared golden vectors.
 *
 * tests/fixtures/hmac_golden_vectors.json is committed byte-identical in this
 * repo and Zigbee_UART_Interface (pinned there by
 * tests/test_dashboard_ingest.py). It is the drift alarm for the auth
 * contract: if a refactor of the canonical string breaks these, the station
 * and dashboard no longer agree.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import vectors from './fixtures/hmac_golden_vectors.json'

// In-memory stand-in for the IngestNonces table (migration 014).
const nonceStore = new Set<string>()
let failDb = false

vi.mock('@/lib/stationControls', () => ({
  withClient: async (fn: (client: unknown) => Promise<unknown>) => {
    if (failDb) throw new Error('db unreachable')
    const client = {
      query: async (sql: string, params: string[]) => {
        if (sql.startsWith('DELETE')) return { rows: [] }
        if (sql.includes('INSERT INTO IngestNonces')) {
          const key = params[0]
          if (nonceStore.has(key)) return { rows: [] }
          nonceStore.add(key)
          return { rows: [{ nonce: key }] }
        }
        throw new Error(`unexpected query: ${sql}`)
      },
    }
    return fn(client)
  },
}))

import {
  sha256Hex,
  buildIngestCanonical,
  signIngestRequest,
  verifyIngestRequest,
} from '@/lib/ingestAuth'

describe('golden vectors (shared with Zigbee_UART_Interface)', () => {
  for (const v of vectors.vectors) {
    it(`${v.name}: body hash and signature match`, () => {
      const bodySha = sha256Hex(Buffer.from(v.bodyUtf8, 'utf8'))
      expect(bodySha).toBe(v.bodySha256)
      const sig = signIngestRequest(v.secret, {
        timestamp: v.timestamp,
        nonce: v.nonce,
        method: v.method,
        path: v.path,
        stationId: v.stationId,
        bodySha256Hex: bodySha,
      })
      expect(sig).toBe(v.expectedSignature)
    })
  }

  it('canonical string layout is timestamp\\nnonce\\nMETHOD\\npath\\nstationId\\nbodySha', () => {
    const c = buildIngestCanonical({
      timestamp: 't',
      nonce: 'n',
      method: 'post',
      path: '/p',
      stationId: 's',
      bodySha256Hex: 'h',
    })
    expect(c).toBe('t\nn\nPOST\n/p\ns\nh')
  })
})

function requestFor(v: (typeof vectors.vectors)[number], overrides?: {
  signature?: string
  timestamp?: string
  nonce?: string
}) {
  const body = Buffer.from(v.bodyUtf8, 'utf8')
  const timestamp = overrides?.timestamp ?? v.timestamp
  const nonce = overrides?.nonce ?? v.nonce
  const signature =
    overrides?.signature ??
    signIngestRequest(v.secret, {
      timestamp,
      nonce,
      method: v.method,
      path: v.path,
      stationId: v.stationId,
      bodySha256Hex: sha256Hex(body),
    })
  const request = new Request(`https://dashboard.example${v.path}`, {
    method: v.method,
    headers: {
      'x-ingest-timestamp': timestamp,
      'x-ingest-nonce': nonce,
      'x-ingest-signature': signature,
    },
  })
  return { request, body }
}

const getStation = (id: string) =>
  id === 'BurnInTest-1' ? { secret: 'test-secret-1' } : undefined

describe('verifyIngestRequest', () => {
  const v = vectors.vectors[0] // post_ingest_simple, station BurnInTest-1

  beforeEach(() => {
    nonceStore.clear()
    failDb = false
    vi.useFakeTimers()
    vi.setSystemTime(Number(v.timestamp) * 1000)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts a correctly signed request', async () => {
    const { request, body } = requestFor(v)
    const result = await verifyIngestRequest({
      request,
      rawBody: body,
      stationIdHeader: v.stationId,
      getStation,
    })
    expect(result).toEqual({
      ok: true,
      stationId: v.stationId,
      bodySha256Hex: v.bodySha256,
    })
  })

  it('rejects a replayed nonce on the second use', async () => {
    const first = requestFor(v)
    await verifyIngestRequest({
      request: first.request,
      rawBody: first.body,
      stationIdHeader: v.stationId,
      getStation,
    })
    const second = requestFor(v)
    const result = await verifyIngestRequest({
      request: second.request,
      rawBody: second.body,
      stationIdHeader: v.stationId,
      getStation,
    })
    expect(result).toEqual({ ok: false, reason: 'replay' })
  })

  it('rejects timestamps outside the skew window', async () => {
    vi.setSystemTime((Number(v.timestamp) + 301) * 1000)
    const { request, body } = requestFor(v)
    const result = await verifyIngestRequest({
      request,
      rawBody: body,
      stationIdHeader: v.stationId,
      getStation,
      skewSec: 300,
    })
    expect(result).toEqual({ ok: false, reason: 'skew' })
  })

  it('rejects a bad signature without consuming the nonce', async () => {
    const bad = requestFor(v, { signature: 'f'.repeat(64) })
    const result = await verifyIngestRequest({
      request: bad.request,
      rawBody: bad.body,
      stationIdHeader: v.stationId,
      getStation,
    })
    expect(result).toEqual({ ok: false, reason: 'bad_signature' })
    expect(nonceStore.size).toBe(0)

    // The same nonce must still be claimable by the legitimate request.
    const good = requestFor(v)
    const ok = await verifyIngestRequest({
      request: good.request,
      rawBody: good.body,
      stationIdHeader: v.stationId,
      getStation,
    })
    expect(ok).toEqual({
      ok: true,
      stationId: v.stationId,
      bodySha256Hex: v.bodySha256,
    })
  })

  it('rejects an unknown station', async () => {
    const { request, body } = requestFor(v)
    const result = await verifyIngestRequest({
      request,
      rawBody: body,
      stationIdHeader: 'NoSuchStation',
      getStation,
    })
    expect(result).toEqual({ ok: false, reason: 'unknown_station' })
  })

  it('fails closed (throws) when the nonce store is unreachable', async () => {
    failDb = true
    const { request, body } = requestFor(v)
    await expect(
      verifyIngestRequest({
        request,
        rawBody: body,
        stationIdHeader: v.stationId,
        getStation,
      })
    ).rejects.toThrow()
  })
})
