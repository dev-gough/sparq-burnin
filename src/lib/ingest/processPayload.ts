import { Client } from 'pg'
import { getDatabaseConfig, loadConfig } from '@/lib/config'
import { sha256Hex } from '@/lib/ingestAuth'
import { writeIngestStatus } from '@/lib/opsStatus'
import type { IngestPayload } from './schema'
import { applyResultValidation } from './validate'
import { parseTimestampFromDelhi } from './timestamps'
import {
  ensureInverter,
  findCompletedReceipt,
  insertSamplesCopy,
  insertTest,
  relinkAnnotationsForTest,
  writeCompletedReceipt,
} from './dbInsert'

export interface ProcessSuccess {
  ok: true
  testId: number
  idempotencyKey: string
  duplicate: boolean
  overallStatus: string
  stationId: string
}

export interface ProcessFailure {
  ok: false
  code: 'server_error'
  message: string
}

export async function processIngestPayload(
  payload: IngestPayload,
  rawBodyHash: string
): Promise<ProcessSuccess | ProcessFailure> {
  const startedMs = Date.now()
  const startedAt = new Date().toISOString()
  const client = new Client(getDatabaseConfig())

  try {
    await client.connect()

    const existing = await findCompletedReceipt(client, payload.idempotencyKey)
    if (existing) {
      return {
        ok: true,
        testId: existing.testId,
        idempotencyKey: payload.idempotencyKey,
        duplicate: true,
        overallStatus: existing.overallStatus,
        stationId: payload.stationId,
      }
    }

    // Also check Tests.idempotency_key for race-safe short-circuit
    const byKey = await client.query(
      `SELECT test_id, overall_status FROM Tests WHERE idempotency_key = $1`,
      [payload.idempotencyKey]
    )
    if (byKey.rows.length > 0) {
      return {
        ok: true,
        testId: byKey.rows[0].test_id as number,
        idempotencyKey: payload.idempotencyKey,
        duplicate: true,
        overallStatus: byKey.rows[0].overall_status as string,
        stationId: payload.stationId,
      }
    }

    const debugFw =
      loadConfig().settings.debug_firmware_version || '1.11.11'
    const validated = applyResultValidation(payload.result, debugFw)
    const sourceFile = `https:${payload.idempotencyKey}`

    await client.query('BEGIN')
    try {
      const invId = await ensureInverter(client, validated.serialNumber)
      const testId = await insertTest(client, {
        invId,
        validated,
        stationId: payload.stationId,
        idempotencyKey: payload.idempotencyKey,
        sourceFile,
      })
      await insertSamplesCopy(client, testId, payload.samples, sourceFile)
      await writeCompletedReceipt(client, {
        idempotencyKey: payload.idempotencyKey,
        stationId: payload.stationId,
        testId,
        payloadHash: rawBodyHash,
      })

      try {
        const startUtc = parseTimestampFromDelhi(validated.startTime).toISOString()
        await relinkAnnotationsForTest(client, validated.serialNumber, startUtc)
      } catch (e) {
        console.warn('Annotation relink failed (non-fatal):', e)
      }

      await client.query('COMMIT')

      try {
        const total = await client.query(
          'SELECT COUNT(*)::int AS n FROM Tests'
        )
        await writeIngestStatus({
          startedAt,
          finishedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
          success: true,
          newTests: 1,
          totalTests: total.rows[0]?.n ?? null,
          exactMatches: 1,
          closestMatches: 0,
          unmatched: 0,
          error: null,
        })
      } catch {
        /* ops status is best-effort */
      }

      return {
        ok: true,
        testId,
        idempotencyKey: payload.idempotencyKey,
        duplicate: false,
        overallStatus: validated.overallStatus,
        stationId: payload.stationId,
      }
    } catch (err) {
      await client.query('ROLLBACK')
      // Concurrent insert with same idempotency key
      const pgCode = (err as { code?: string })?.code
      if (pgCode === '23505') {
        const again = await findCompletedReceipt(client, payload.idempotencyKey)
        if (again) {
          return {
            ok: true,
            testId: again.testId,
            idempotencyKey: payload.idempotencyKey,
            duplicate: true,
            overallStatus: again.overallStatus,
            stationId: payload.stationId,
          }
        }
        const byKey = await client.query(
          `SELECT test_id, overall_status FROM Tests WHERE idempotency_key = $1`,
          [payload.idempotencyKey]
        )
        if (byKey.rows.length > 0) {
          return {
            ok: true,
            testId: byKey.rows[0].test_id as number,
            idempotencyKey: payload.idempotencyKey,
            duplicate: true,
            overallStatus: byKey.rows[0].overall_status as string,
            stationId: payload.stationId,
          }
        }
      }
      throw err
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('processIngestPayload failed:', err)
    try {
      await writeIngestStatus({
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedMs,
        success: false,
        newTests: 0,
        totalTests: null,
        error: message,
      })
    } catch {
      /* ignore */
    }
    return { ok: false, code: 'server_error', message }
  } finally {
    await client.end().catch(() => undefined)
  }
}

export function hashBody(buf: Buffer): string {
  return sha256Hex(buf)
}
