import { z } from 'zod'
import { DELHI_TIMESTAMP_REGEX } from './timestamps'

const nullableNumber = z.union([z.number(), z.null()]).optional()
const nullableInt = z.union([z.number().int(), z.null()]).optional()
const nullableString = z.union([z.string(), z.null()]).optional()

// A wall-clock timestamp that parseTimestampFromDelhi can consume without throwing.
// Enforced here so malformed timestamps yield a 400 invalid_schema at parse time
// rather than a mid-transaction 500 in dbInsert. An explicit Z/±hh:mm offset is
// honored; offset-less timestamps are assumed to be Delhi (IST) wall clock.
const delhiTimestamp = z
  .string()
  .min(1)
  .regex(
    DELHI_TIMESTAMP_REGEX,
    'Invalid timestamp format (expected YYYY-MM-DDThh:mm[:ss][.SSS][Z|±hh:mm])'
  )

// Optional free-string column bounded by its DB VARCHAR width.
const nullableStringMax = (max: number) =>
  z.union([z.string().max(max), z.null()]).optional()

export const sampleSchema = z
  .object({
    timestamp: delhiTimestamp,
    vgrid: nullableNumber,
    pgrid: nullableNumber,
    qgrid: nullableNumber,
    vpv1: nullableNumber,
    ppv1: nullableNumber,
    vpv2: nullableNumber,
    ppv2: nullableNumber,
    vpv3: nullableNumber,
    ppv3: nullableNumber,
    vpv4: nullableNumber,
    ppv4: nullableNumber,
    frequency: nullableNumber,
    vbus: nullableNumber,
    extstatus: nullableInt,
    status: nullableInt,
    temperature: nullableNumber,
    epv1: nullableNumber,
    epv2: nullableNumber,
    epv3: nullableNumber,
    epv4: nullableNumber,
    activeEnergy: nullableNumber,
    reactiveEnergy: nullableNumber,
    extstatusLatch: nullableInt,
    statusLatch: nullableInt,
    vgridInstLatch: nullableNumber,
    vntrlInstLatch: nullableNumber,
    igridInstLatch: nullableNumber,
    vbusInstLatch: nullableNumber,
    vpv1InstLatch: nullableNumber,
    ipv1InstLatch: nullableNumber,
    vpv2InstLatch: nullableNumber,
    ipv2InstLatch: nullableNumber,
    vpv3InstLatch: nullableNumber,
    ipv3InstLatch: nullableNumber,
    vpv4InstLatch: nullableNumber,
    ipv4InstLatch: nullableNumber,
    statusBits: nullableString,
  })
  .passthrough()

export const resultSchema = z.object({
  // Inverters.serial_number VARCHAR(50)
  serialNumber: z.string().min(1).max(50),
  // Tests.start_time/end_time TIMESTAMPTZ NOT NULL — legacy CSV path rejects the
  // whole file when these are unparseable, so reject here with 400 invalid_schema.
  startTime: delhiTimestamp,
  endTime: delhiTimestamp,
  // Tests.firmware_version VARCHAR(20)
  firmwareVersion: nullableStringMax(20),
  productNumber: nullableString,
  criteriaProfile: nullableString,
  // Tests.overall_status VARCHAR(10) NOT NULL
  overallStatus: z.string().min(1).max(10),
  // Tests.ac_status / chN_status VARCHAR(10)
  acStatus: nullableStringMax(10),
  ch1Status: nullableStringMax(10),
  ch2Status: nullableStringMax(10),
  ch3Status: nullableStringMax(10),
  ch4Status: nullableStringMax(10),
  // Tests.status_flags / failure_description are TEXT (unbounded)
  statusFlags: nullableString,
  failureTime: nullableString,
  failureDescription: nullableString,
  retestRecommended: nullableString,
})

export const ingestPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  stationId: z.string().min(1),
  // source_file is built as `https:${idempotencyKey}` and stored in
  // Tests.source_file VARCHAR(255), so cap the key at 255 - len('https:') = 249.
  idempotencyKey: z.string().min(1).max(249),
  submittedAt: z.string().optional(),
  runId: z.string().optional(),
  result: resultSchema,
  samples: z.array(sampleSchema),
})

export type IngestPayload = z.infer<typeof ingestPayloadSchema>
export type IngestSample = z.infer<typeof sampleSchema>
export type IngestResult = z.infer<typeof resultSchema>
