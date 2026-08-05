/**
 * Schema tests for the HTTPS ingest payload (plan Phase 3).
 *
 * Contract notes: any 4xx except 401/403/408/429 is terminal
 * for the station — a payload rejected here is dropped client-side. These
 * tests pin exactly what we reject so that boundary can't drift accidentally.
 */
import { describe, it, expect } from 'vitest'
import { ingestPayloadSchema, sampleSchema } from '@/lib/ingest/schema'

function validPayload() {
  return {
    schemaVersion: 1,
    stationId: 'BurnInTest-1',
    idempotencyKey: 'BurnInTest-1:107000123456:2025-06-15T09:00:00',
    submittedAt: '2025-06-16T09:05:00',
    runId: 'run-42',
    result: {
      serialNumber: '107000123456',
      startTime: '2025-06-15T09:00:00',
      endTime: '2025-06-16T09:00:00',
      firmwareVersion: '1.2.3',
      productNumber: 'P-100',
      criteriaProfile: 'default',
      overallStatus: 'PASS',
      acStatus: 'PASS',
      ch1Status: 'PASS',
      ch2Status: 'PASS',
      ch3Status: null,
      ch4Status: null,
      statusFlags: null,
      failureTime: null,
      failureDescription: null,
      retestRecommended: null,
    },
    samples: [
      {
        timestamp: '2025-06-15T09:01:00',
        vgrid: 239.9,
        pgrid: 512.2,
        qgrid: null,
        temperature: 41.5,
        status: 3,
        statusBits: '0b101',
      },
    ],
  }
}

describe('ingestPayloadSchema', () => {
  it('accepts a realistic station payload', () => {
    expect(ingestPayloadSchema.safeParse(validPayload()).success).toBe(true)
  })

  it('accepts an omitted runId but rejects runId: null', () => {
    const omitted = validPayload() as Record<string, unknown>
    delete omitted.runId
    expect(ingestPayloadSchema.safeParse(omitted).success).toBe(true)

    const withNull = { ...validPayload(), runId: null }
    expect(ingestPayloadSchema.safeParse(withNull).success).toBe(false)
  })

  it('rejects overlong bounded fields (DB column widths)', () => {
    const overlong: Array<Record<string, unknown>> = [
      { ...validPayload(), idempotencyKey: 'k'.repeat(250) },
      {
        ...validPayload(),
        result: { ...validPayload().result, firmwareVersion: 'v'.repeat(21) },
      },
      {
        ...validPayload(),
        result: { ...validPayload().result, overallStatus: 's'.repeat(11) },
      },
      {
        ...validPayload(),
        result: { ...validPayload().result, acStatus: 's'.repeat(11) },
      },
      {
        ...validPayload(),
        result: { ...validPayload().result, serialNumber: '9'.repeat(51) },
      },
    ]
    for (const payload of overlong) {
      expect(ingestPayloadSchema.safeParse(payload).success).toBe(false)
    }
    // ...and the boundary lengths pass
    const atLimit = {
      ...validPayload(),
      idempotencyKey: 'k'.repeat(249),
      result: {
        ...validPayload().result,
        firmwareVersion: 'v'.repeat(20),
        overallStatus: 's'.repeat(10),
        serialNumber: '9'.repeat(50),
      },
    }
    expect(ingestPayloadSchema.safeParse(atLimit).success).toBe(true)
  })

  it('rejects malformed result timestamps (T separator required)', () => {
    const spacey = {
      ...validPayload(),
      result: { ...validPayload().result, startTime: '2025-06-15 09:00:00' },
    }
    expect(ingestPayloadSchema.safeParse(spacey).success).toBe(false)
  })

  it('rejects a malformed sample timestamp and names the sample index', () => {
    const payload = validPayload()
    payload.samples[0].timestamp = '15/06/2025 09:01'
    const result = ingestPayloadSchema.safeParse(payload)
    expect(result.success).toBe(false)
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'))
      expect(paths).toContain('samples.0.timestamp')
    }
  })

  it('accepts seconds-less and millisecond sample timestamps', () => {
    for (const ts of ['2025-06-15T09:01', '2025-06-15T09:01:00.123']) {
      const sample = { ...validPayload().samples[0], timestamp: ts }
      expect(sampleSchema.safeParse(sample).success).toBe(true)
    }
  })

  it('accepts offset-suffixed timestamps (non-IST stations attach local offset)', () => {
    for (const ts of [
      '2026-07-28T12:25:36-04:00',
      '2026-07-28T12:25:36+05:30',
      '2026-07-28T12:25:36Z',
      '2026-07-28T12:25:36.123-04:00',
    ]) {
      const sample = { ...validPayload().samples[0], timestamp: ts }
      expect(sampleSchema.safeParse(sample).success).toBe(true)
      const payload = {
        ...validPayload(),
        result: { ...validPayload().result, startTime: ts, endTime: ts },
      }
      expect(ingestPayloadSchema.safeParse(payload).success).toBe(true)
    }
  })

  it('passes through unknown sample keys (forward compatibility)', () => {
    const sample = { ...validPayload().samples[0], futureField: 1.23 }
    const parsed = sampleSchema.safeParse(sample)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect((parsed.data as Record<string, unknown>).futureField).toBe(1.23)
    }
  })
})
