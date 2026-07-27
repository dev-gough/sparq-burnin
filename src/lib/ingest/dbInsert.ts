import type { Client } from 'pg'
import { Readable } from 'stream'
import copyFrom from 'pg-copy-streams'
import {
  parseFailureTime,
  parseTimestampFromDelhi,
} from './timestamps'
import type { IngestSample } from './schema'
import type { ValidatedResult } from './validate'

function numOrNull(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '\\N'
  return String(v)
}

function intOrNull(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '\\N'
  return String(Math.trunc(v))
}

function strOrNull(v: string | null | undefined): string {
  if (v === null || v === undefined || v === '') return '\\N'
  // Escape COPY text specials
  return v
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
}

export async function ensureInverter(
  client: Client,
  serialNumber: string
): Promise<number> {
  const insert = await client.query(
    `INSERT INTO Inverters (serial_number)
     VALUES ($1)
     ON CONFLICT (serial_number) DO NOTHING
     RETURNING inv_id`,
    [serialNumber]
  )
  if (insert.rows.length > 0) {
    return insert.rows[0].inv_id as number
  }
  const select = await client.query(
    'SELECT inv_id FROM Inverters WHERE serial_number = $1',
    [serialNumber]
  )
  return select.rows[0].inv_id as number
}

export async function findCompletedReceipt(
  client: Client,
  idempotencyKey: string
): Promise<{ testId: number; overallStatus: string } | null> {
  const result = await client.query(
    `SELECT r.test_id, t.overall_status
     FROM IngestReceipts r
     LEFT JOIN Tests t ON t.test_id = r.test_id
     WHERE r.idempotency_key = $1 AND r.status = 'completed' AND r.test_id IS NOT NULL`,
    [idempotencyKey]
  )
  if (result.rows.length === 0) return null
  return {
    testId: result.rows[0].test_id as number,
    overallStatus: (result.rows[0].overall_status as string) || 'UNKNOWN',
  }
}

/**
 * Cross-pipeline duplicate guard. During the migration window a station may
 * deliver the same physical test via BOTH the legacy CSV path (dedups by
 * source_file filename) and the HTTPS path (dedups by idempotency key), so
 * neither path's own dedup catches the other. Guard on (inv_id, start_time_utc)
 * with a 1-second tolerance, mirroring the annotation-relink/restore dedup
 * convention (see src/app/api/annotations/restore/route.ts). Exact-match would
 * normally suffice because both paths run the same Delhi->UTC parser, but the
 * tolerance absorbs sub-second drift (e.g. filename rounded to the minute).
 */
export async function findExistingTestByInvStart(
  client: Client,
  invId: number,
  startTimeUtc: string
): Promise<{
  testId: number
  overallStatus: string
  sourceFile: string | null
} | null> {
  const result = await client.query(
    `SELECT test_id, overall_status, source_file
     FROM Tests
     WHERE inv_id = $1
       AND start_time_utc IS NOT NULL
       AND ABS(EXTRACT(EPOCH FROM (start_time_utc - $2::timestamptz))) < 1
     ORDER BY test_id ASC
     LIMIT 1`,
    [invId, startTimeUtc]
  )
  if (result.rows.length === 0) return null
  return {
    testId: result.rows[0].test_id as number,
    overallStatus: (result.rows[0].overall_status as string) || 'UNKNOWN',
    sourceFile: (result.rows[0].source_file as string | null) ?? null,
  }
}

/**
 * Insert one Tests row. Shared by both transports: the HTTPS path passes its
 * stationId/idempotencyKey, the legacy CSV path passes null for both (those
 * columns are HTTPS-only bookkeeping and stay NULL for CSV-ingested tests).
 */
export async function insertTest(
  client: Client,
  params: {
    invId: number
    validated: ValidatedResult
    stationId: string | null
    idempotencyKey: string | null
    sourceFile: string
  }
): Promise<number> {
  // Timestamps were parsed once during validation; never re-parse raw strings
  // here (that path used to throw → 500). The zod schema rejects unparseable
  // timestamps with 400 before we ever reach this insert, so these are non-null.
  const { startTimeUtc, endTimeUtc } = params.validated
  if (startTimeUtc === null || endTimeUtc === null) {
    throw new Error(
      'insertTest called with unparsed timestamps (should be rejected upstream)'
    )
  }

  const query = `
    INSERT INTO Tests (
      inv_id, start_time, start_time_utc, end_time, firmware_version, overall_status,
      ac_status, ch1_status, ch2_status, ch3_status, ch4_status,
      status_flags, failure_description, failure_time, source_file,
      station_id, idempotency_key
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
    RETURNING test_id
  `

  const values = [
    params.invId,
    startTimeUtc,
    startTimeUtc,
    endTimeUtc,
    params.validated.firmwareVersion,
    params.validated.overallStatus,
    params.validated.acStatus,
    params.validated.ch1Status,
    params.validated.ch2Status,
    params.validated.ch3Status,
    params.validated.ch4Status,
    params.validated.statusFlags,
    params.validated.failureDescription,
    parseFailureTime(params.validated.failureTime),
    params.sourceFile,
    params.stationId,
    params.idempotencyKey,
  ]

  const result = await client.query(query, values)
  return result.rows[0].test_id as number
}

/**
 * Bulk-insert TestData rows via PostgreSQL COPY (5-10x faster than INSERT).
 * This is the single 41-column COPY implementation for BOTH transports — the
 * legacy CSV ingester maps its parsed CSV rows into IngestSample and calls
 * this too. The column list below must stay in sync with the TestData schema;
 * change it here and nowhere else.
 */
export async function insertSamplesCopy(
  client: Client,
  testId: number,
  samples: IngestSample[],
  sourceFile: string
): Promise<void> {
  if (samples.length === 0) return

  const batchSize = 1000
  for (let i = 0; i < samples.length; i += batchSize) {
    const batch = samples.slice(i, i + batchSize)
    const lines: string[] = []

    for (const row of batch) {
      const timestampUtc = parseTimestampFromDelhi(row.timestamp).toISOString()
      const rowData = [
        testId,
        timestampUtc,
        timestampUtc,
        numOrNull(row.vgrid ?? null),
        numOrNull(row.pgrid ?? null),
        numOrNull(row.qgrid ?? null),
        numOrNull(row.vpv1 ?? null),
        numOrNull(row.ppv1 ?? null),
        numOrNull(row.vpv2 ?? null),
        numOrNull(row.ppv2 ?? null),
        numOrNull(row.vpv3 ?? null),
        numOrNull(row.ppv3 ?? null),
        numOrNull(row.vpv4 ?? null),
        numOrNull(row.ppv4 ?? null),
        numOrNull(row.frequency ?? null),
        numOrNull(row.vbus ?? null),
        intOrNull(row.extstatus ?? null),
        intOrNull(row.status ?? null),
        numOrNull(row.temperature ?? null),
        numOrNull(row.epv1 ?? null),
        numOrNull(row.epv2 ?? null),
        numOrNull(row.epv3 ?? null),
        numOrNull(row.epv4 ?? null),
        numOrNull(row.activeEnergy ?? null),
        numOrNull(row.reactiveEnergy ?? null),
        intOrNull(row.extstatusLatch ?? null),
        intOrNull(row.statusLatch ?? null),
        numOrNull(row.vgridInstLatch ?? null),
        numOrNull(row.vntrlInstLatch ?? null),
        numOrNull(row.igridInstLatch ?? null),
        numOrNull(row.vbusInstLatch ?? null),
        numOrNull(row.vpv1InstLatch ?? null),
        numOrNull(row.ipv1InstLatch ?? null),
        numOrNull(row.vpv2InstLatch ?? null),
        numOrNull(row.ipv2InstLatch ?? null),
        numOrNull(row.vpv3InstLatch ?? null),
        numOrNull(row.ipv3InstLatch ?? null),
        numOrNull(row.vpv4InstLatch ?? null),
        numOrNull(row.ipv4InstLatch ?? null),
        strOrNull(row.statusBits ?? null),
        sourceFile,
      ]
      lines.push(rowData.join('\t'))
    }

    const dataStream = Readable.from(lines.join('\n') + '\n')
    const copyQuery = `
      COPY TestData (
        test_id, timestamp, timestamp_utc, vgrid, pgrid, qgrid, vpv1, ppv1, vpv2, ppv2,
        vpv3, ppv3, vpv4, ppv4, frequency, vbus, extstatus, status,
        temperature, epv1, epv2, epv3, epv4, active_energy, reactive_energy,
        extstatus_latch, status_latch, vgrid_inst_latch, vntrl_inst_latch,
        igrid_inst_latch, vbus_inst_latch, vpv1_inst_latch, ipv1_inst_latch,
        vpv2_inst_latch, ipv2_inst_latch, vpv3_inst_latch, ipv3_inst_latch,
        vpv4_inst_latch, ipv4_inst_latch, status_bits, source_file
      ) FROM STDIN WITH (FORMAT text, NULL '\\N', DELIMITER E'\\t')
    `

    const stream = client.query(copyFrom.from(copyQuery))
    dataStream.pipe(stream)

    await new Promise<void>((resolve, reject) => {
      stream.on('finish', resolve)
      stream.on('error', reject)
      dataStream.on('error', reject)
    })
  }
}

export async function writeCompletedReceipt(
  client: Client,
  params: {
    idempotencyKey: string
    stationId: string
    testId: number
    payloadHash: string
  }
): Promise<void> {
  await client.query(
    `INSERT INTO IngestReceipts (
      idempotency_key, station_id, test_id, payload_hash, status, completed_at
    ) VALUES ($1, $2, $3, $4, 'completed', NOW())
    ON CONFLICT (idempotency_key) DO UPDATE SET
      test_id = EXCLUDED.test_id,
      payload_hash = EXCLUDED.payload_hash,
      status = 'completed',
      completed_at = NOW(),
      error = NULL`,
    [
      params.idempotencyKey,
      params.stationId,
      params.testId,
      params.payloadHash,
    ]
  )
}

/**
 * Global annotation relink: point TestAnnotations at freshly-inserted Tests
 * rows matched by (serial_number, start_time). Used by the CSV ingester after
 * a full run (annotations survive reprocess via ON DELETE SET NULL and are
 * re-linked here). Returns the number of annotations re-linked.
 */
export async function relinkAllAnnotations(client: Client): Promise<number> {
  const result = await client.query(
    `UPDATE TestAnnotations
     SET
       current_test_id = t.test_id,
       updated_at = CURRENT_TIMESTAMP
     FROM Tests t
     INNER JOIN Inverters i ON t.inv_id = i.inv_id
     WHERE
       TestAnnotations.serial_number = i.serial_number
       AND TestAnnotations.start_time = t.start_time_utc
       AND TestAnnotations.current_test_id IS NULL`
  )
  return result.rowCount ?? 0
}

/**
 * Per-test variant of relinkAllAnnotations used by the HTTPS path right after
 * inserting a single test (same matching rule, narrowed to one serial/start).
 */
export async function relinkAnnotationsForTest(
  client: Client,
  serialNumber: string,
  startTimeUtc: string
): Promise<void> {
  await client.query(
    `UPDATE TestAnnotations
     SET
       current_test_id = t.test_id,
       updated_at = CURRENT_TIMESTAMP
     FROM Tests t
     INNER JOIN Inverters i ON t.inv_id = i.inv_id
     WHERE
       TestAnnotations.serial_number = i.serial_number
       AND TestAnnotations.start_time = t.start_time_utc
       AND TestAnnotations.serial_number = $1
       AND t.start_time_utc = $2::timestamptz
       AND TestAnnotations.current_test_id IS NULL`,
    [serialNumber, startTimeUtc]
  )
}
