import { Client } from 'pg'
import { getDatabaseConfig, loadConfig } from '@/lib/config'
import { sha256Hex } from '@/lib/ingestAuth'
import { writeIngestStatus } from '@/lib/opsStatus'
import type { IngestPayload } from './schema'
import { applyResultValidation } from './validate'
import {
  ensureInverter,
  findCompletedReceipt,
  findExistingTestByInvStart,
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

      // Cross-pipeline dedup: the same physical test may already exist from the
      // legacy CSV ingester (which dedups by filename, not idempotency key).
      // Guard on (inv_id, start_time_utc) with the annotation-relink tolerance.
      if (validated.startTimeUtc) {
        const crossExisting = await findExistingTestByInvStart(
          client,
          invId,
          validated.startTimeUtc
        )
        if (crossExisting) {
          // Record the receipt so subsequent retries with this key short-circuit
          // on the idempotency lookup and map to the existing (CSV) test row.
          await writeCompletedReceipt(client, {
            idempotencyKey: payload.idempotencyKey,
            stationId: payload.stationId,
            testId: crossExisting.testId,
            payloadHash: rawBodyHash,
          })
          await client.query('COMMIT')
          return {
            ok: true,
            testId: crossExisting.testId,
            idempotencyKey: payload.idempotencyKey,
            duplicate: true,
            overallStatus: crossExisting.overallStatus,
            stationId: payload.stationId,
          }
        }
      }

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

      if (validated.startTimeUtc) {
        try {
          await relinkAnnotationsForTest(
            client,
            validated.serialNumber,
            validated.startTimeUtc
          )
        } catch (e) {
          console.warn('Annotation relink failed (non-fatal):', e)
        }
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
      // A concurrent insert can race us to a unique violation (23505) on either
      // the idempotency-key index or the (inv_id, start_time_utc) index added by
      // migration 013. Both mean "someone else committed the same test" — resolve
      // to the winning row and report a duplicate.
      const pgCode = (err as { code?: string })?.code
      const constraint = (err as { constraint?: string })?.constraint
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
        // Violation of the cross-pipeline (inv_id, start_time_utc) index: the
        // winning row has a different (or null) idempotency key, so fall back to
        // the inv_id/start_time lookup. Match by constraint name, but also try
        // this path defensively when the key lookups above found nothing.
        if (
          constraint === 'idx_tests_inv_start_time_utc' ||
          validated.startTimeUtc
        ) {
          try {
            const inv = await client.query(
              `SELECT inv_id FROM Inverters WHERE serial_number = $1`,
              [validated.serialNumber]
            )
            if (inv.rows.length > 0 && validated.startTimeUtc) {
              const crossExisting = await findExistingTestByInvStart(
                client,
                inv.rows[0].inv_id as number,
                validated.startTimeUtc
              )
              if (crossExisting) {
                return {
                  ok: true,
                  testId: crossExisting.testId,
                  idempotencyKey: payload.idempotencyKey,
                  duplicate: true,
                  overallStatus: crossExisting.overallStatus,
                  stationId: payload.stationId,
                }
              }
            }
          } catch {
            /* fall through to rethrow */
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
