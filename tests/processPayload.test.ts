/**
 * processIngestPayload flow tests (plan Phase 3, "processPayload integration").
 *
 * HONEST SCOPE: these run against a scripted in-memory fake pg client, NOT a
 * real PostgreSQL. A scratch DB was not safely reachable in this environment
 * (schema/migration scripts resolve their target from config.json, i.e. the
 * live DB), so per HANDOFF.md these tests verify the FLOW — dedup ordering,
 * transaction bracketing, 23505 race resolution, receipt writing, COPY
 * batching — while real-SQL semantics (tolerance intervals, index behavior,
 * COPY parsing) remain verified by inspection + the deployed migrations.
 * The fake throws on any SQL it does not recognize, so a new query in the
 * flow fails loudly here instead of being silently absorbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Writable } from 'stream'

const writeIngestStatus = vi.fn(async (..._args: unknown[]) => {})
vi.mock('@/lib/opsStatus', () => ({
  writeIngestStatus: (...args: unknown[]) => writeIngestStatus(...args),
}))

vi.mock('@/lib/config', () => ({
  loadConfig: () => ({ settings: { debug_firmware_version: '1.11.11' } }),
}))

interface TestRow {
  test_id: number
  inv_id: number
  start_ms: number | null
  idempotency_key: string | null
  overall_status: string
  source_file: string | null
}

class FakeDb {
  inverters = new Map<string, number>()
  tests: TestRow[] = []
  receipts = new Map<string, { test_id: number }>()
  copiedLines: string[] = []
  nextInvId = 1
  nextTestId = 100
  released = false
  destroyed = false
  failWith: Error | null = null
  /** Hook to mutate state mid-flow (e.g. simulate a concurrent committer). */
  onQuery: ((sql: string) => void) | null = null

  seedInverter(serial: string): number {
    const id = this.nextInvId++
    this.inverters.set(serial, id)
    return id
  }

  seedTest(row: Omit<TestRow, 'test_id'>): TestRow {
    const test = { test_id: this.nextTestId++, ...row }
    this.tests.push(test)
    return test
  }

  client() {
    return {
      query: (arg: unknown, params?: unknown[]): unknown => {
        if (typeof arg !== 'string') {
          // COPY FROM STDIN: hand back a sink; pipe() ends it → 'finish'.
          const chunks: Buffer[] = []
          const sink = new Writable({
            write: (chunk, _enc, cb) => {
              chunks.push(Buffer.from(chunk))
              cb()
            },
          })
          sink.on('finish', () => {
            this.copiedLines.push(
              ...Buffer.concat(chunks)
                .toString('utf8')
                .split('\n')
                .filter((l) => l.length > 0)
            )
          })
          return sink
        }
        this.onQuery?.(arg)
        return this.dispatch(arg, (params ?? []) as never[])
      },
      release: (destroy?: boolean) => {
        this.released = true
        this.destroyed = !!destroy
      },
    }
  }

  private async dispatch(
    sql: string,
    params: (string | number | null)[]
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number }> {
    if (this.failWith) throw this.failWith
    const s = sql.trim()

    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(s)) return { rows: [] }

    if (s.startsWith('INSERT INTO Inverters')) {
      const serial = params[0] as string
      if (this.inverters.has(serial)) return { rows: [] }
      const inv_id = this.nextInvId++
      this.inverters.set(serial, inv_id)
      return { rows: [{ inv_id }] }
    }

    if (s.startsWith('SELECT inv_id FROM Inverters')) {
      const inv = this.inverters.get(params[0] as string)
      return { rows: inv == null ? [] : [{ inv_id: inv }] }
    }

    if (s.includes('FROM IngestReceipts r')) {
      const receipt = this.receipts.get(params[0] as string)
      if (!receipt) return { rows: [] }
      const test = this.tests.find((t) => t.test_id === receipt.test_id)
      return {
        rows: [
          {
            test_id: receipt.test_id,
            overall_status: test?.overall_status ?? null,
          },
        ],
      }
    }

    if (s.includes('FROM Tests WHERE idempotency_key')) {
      const test = this.tests.find(
        (t) => t.idempotency_key === (params[0] as string)
      )
      return {
        rows: test
          ? [{ test_id: test.test_id, overall_status: test.overall_status }]
          : [],
      }
    }

    if (s.includes('ABS(EXTRACT(EPOCH')) {
      const invId = params[0] as number
      const targetMs = Date.parse(params[1] as string)
      const hit = this.tests
        .filter(
          (t) =>
            t.inv_id === invId &&
            t.start_ms != null &&
            Math.abs(t.start_ms - targetMs) < 1000
        )
        .sort((a, b) => a.test_id - b.test_id)[0]
      return {
        rows: hit
          ? [
              {
                test_id: hit.test_id,
                overall_status: hit.overall_status,
                source_file: hit.source_file,
              },
            ]
          : [],
      }
    }

    if (s.startsWith('INSERT INTO Tests')) {
      // Simulate the two unique indexes (idempotency key; migration 013's
      // partial (inv_id, start_time_utc) index — exact equality).
      const invId = params[0] as number
      const startUtc = params[2] as string
      const key = params[16] as string | null
      if (key != null && this.tests.some((t) => t.idempotency_key === key)) {
        const err = new Error('duplicate key') as Error & {
          code: string
          constraint: string
        }
        err.code = '23505'
        err.constraint = 'tests_idempotency_key_key'
        throw err
      }
      const startMs = Date.parse(startUtc)
      if (this.tests.some((t) => t.inv_id === invId && t.start_ms === startMs)) {
        const err = new Error('duplicate key') as Error & {
          code: string
          constraint: string
        }
        err.code = '23505'
        err.constraint = 'idx_tests_inv_start_time_utc'
        throw err
      }
      const test = this.seedTest({
        inv_id: invId,
        start_ms: startMs,
        idempotency_key: key,
        overall_status: params[5] as string,
        source_file: params[14] as string,
      })
      return { rows: [{ test_id: test.test_id }] }
    }

    if (s.startsWith('INSERT INTO IngestReceipts')) {
      this.receipts.set(params[0] as string, { test_id: params[2] as number })
      return { rows: [] }
    }

    if (s.startsWith('UPDATE TestAnnotations')) {
      return { rows: [], rowCount: 0 }
    }

    if (s.includes('reltuples')) {
      return { rows: [{ n: String(this.tests.length) }] }
    }

    throw new Error(`FakeDb: unhandled SQL: ${s.slice(0, 80)}`)
  }
}

let db: FakeDb

vi.mock('@/lib/db', () => ({
  getPool: () => ({ connect: async () => db.client() }),
}))

import { processIngestPayload } from '@/lib/ingest/processPayload'
import type { IngestPayload } from '@/lib/ingest/schema'

const BODY_HASH = 'a'.repeat(64)

function payload(overrides: Partial<IngestPayload> = {}): IngestPayload {
  return {
    schemaVersion: 1,
    stationId: 'BurnInTest-1',
    idempotencyKey: 'BurnInTest-1:107000123456:2025-06-15T09:00:00',
    result: {
      serialNumber: '107000123456',
      startTime: '2025-06-15T09:00:00', // 03:30:00Z
      endTime: '2025-06-16T09:00:00',
      firmwareVersion: '1.2.3',
      productNumber: null,
      criteriaProfile: null,
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
      { timestamp: '2025-06-15T09:01:00', vgrid: 240.1, status: 3 },
      { timestamp: '2025-06-15T09:02:00', vgrid: 240.2, status: 3 },
    ],
    ...overrides,
  }
}

const START_UTC_MS = Date.parse('2025-06-15T03:30:00.000Z')

beforeEach(() => {
  db = new FakeDb()
  writeIngestStatus.mockClear()
})

describe('processIngestPayload', () => {
  it('happy path: inserts test + samples, writes receipt, commits', async () => {
    const p = payload()
    const result = await processIngestPayload(p, BODY_HASH)

    expect(result).toMatchObject({
      ok: true,
      duplicate: false,
      overallStatus: 'PASS',
      stationId: 'BurnInTest-1',
    })
    const testId = (result as { testId: number }).testId
    expect(db.tests).toHaveLength(1)
    expect(db.tests[0].idempotency_key).toBe(p.idempotencyKey)
    expect(db.tests[0].source_file).toBe(`https:${p.idempotencyKey}`)
    expect(db.receipts.get(p.idempotencyKey)?.test_id).toBe(testId)
    // Both samples went through COPY, Delhi 09:01 → 03:31Z
    expect(db.copiedLines).toHaveLength(2)
    expect(db.copiedLines[0]).toContain(`${testId}\t2025-06-15T03:31:00.000Z`)
    expect(db.released).toBe(true)
    expect(db.destroyed).toBe(false)
    expect(writeIngestStatus).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, newTests: 1 })
    )
  })

  it('INVALID-but-stored: short-duration test is stored with INVALID status', async () => {
    const p = payload({
      result: { ...payload().result, endTime: '2025-06-15T10:00:00' },
    })
    const result = await processIngestPayload(p, BODY_HASH)
    expect(result).toMatchObject({
      ok: true,
      duplicate: false,
      overallStatus: 'INVALID',
    })
    expect(db.tests[0].overall_status).toBe('INVALID')
  })

  it('idempotent retry via receipt: returns duplicate, inserts nothing', async () => {
    const p = payload()
    const inv = db.seedInverter(p.result.serialNumber)
    const existing = db.seedTest({
      inv_id: inv,
      start_ms: START_UTC_MS,
      idempotency_key: p.idempotencyKey,
      overall_status: 'PASS',
      source_file: `https:${p.idempotencyKey}`,
    })
    db.receipts.set(p.idempotencyKey, { test_id: existing.test_id })

    const result = await processIngestPayload(p, BODY_HASH)
    expect(result).toMatchObject({
      ok: true,
      duplicate: true,
      testId: existing.test_id,
    })
    expect(db.tests).toHaveLength(1)
    expect(db.copiedLines).toHaveLength(0)
  })

  it('idempotent retry via Tests.idempotency_key when the receipt is missing', async () => {
    const p = payload()
    const inv = db.seedInverter(p.result.serialNumber)
    const existing = db.seedTest({
      inv_id: inv,
      start_ms: START_UTC_MS,
      idempotency_key: p.idempotencyKey,
      overall_status: 'FAIL',
      source_file: `https:${p.idempotencyKey}`,
    })

    const result = await processIngestPayload(p, BODY_HASH)
    expect(result).toMatchObject({
      ok: true,
      duplicate: true,
      testId: existing.test_id,
      overallStatus: 'FAIL',
    })
    expect(db.tests).toHaveLength(1)
  })

  it('cross-pipeline dedup: CSV row within 1 s wins; receipt maps the key to it', async () => {
    const p = payload()
    const inv = db.seedInverter(p.result.serialNumber)
    const csvTest = db.seedTest({
      inv_id: inv,
      start_ms: START_UTC_MS + 400, // sub-second drift
      idempotency_key: null,
      overall_status: 'PASS',
      source_file: 'BurnInTest-1_results_2025-06-15.csv',
    })

    const result = await processIngestPayload(p, BODY_HASH)
    expect(result).toMatchObject({
      ok: true,
      duplicate: true,
      testId: csvTest.test_id,
    })
    // Future retries with this key short-circuit on the receipt.
    expect(db.receipts.get(p.idempotencyKey)?.test_id).toBe(csvTest.test_id)
    expect(db.tests).toHaveLength(1)
    expect(db.copiedLines).toHaveLength(0)
  })

  it('23505 race: concurrent commit between dedup check and insert resolves to duplicate', async () => {
    const p = payload()
    let raced = false
    db.onQuery = (sql) => {
      // After our pre-insert dedup checks pass, a "concurrent" ingest commits
      // the same test just before our INSERT INTO Tests.
      if (!raced && sql.startsWith('BEGIN')) {
        raced = true
        const inv = db.seedInverter(p.result.serialNumber)
        db.seedTest({
          inv_id: inv,
          start_ms: START_UTC_MS,
          idempotency_key: p.idempotencyKey,
          overall_status: 'PASS',
          source_file: `https:${p.idempotencyKey}`,
        })
      }
    }

    const result = await processIngestPayload(p, BODY_HASH)
    expect(result).toMatchObject({ ok: true, duplicate: true })
    expect(db.tests).toHaveLength(1)
  })

  it('DB failure: returns server_error and destroys the pooled connection', async () => {
    db.failWith = new Error('connection reset')
    const result = await processIngestPayload(payload(), BODY_HASH)
    expect(result).toMatchObject({ ok: false, code: 'server_error' })
    expect(db.released).toBe(true)
    expect(db.destroyed).toBe(true)
    expect(writeIngestStatus).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    )
  })
})
