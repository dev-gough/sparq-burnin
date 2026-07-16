import { z } from 'zod'

const nullableNumber = z.union([z.number(), z.null()]).optional()
const nullableInt = z.union([z.number().int(), z.null()]).optional()
const nullableString = z.union([z.string(), z.null()]).optional()

export const sampleSchema = z
  .object({
    timestamp: z.string().min(1),
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
  serialNumber: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  firmwareVersion: nullableString,
  productNumber: nullableString,
  criteriaProfile: nullableString,
  overallStatus: z.string().min(1),
  acStatus: nullableString,
  ch1Status: nullableString,
  ch2Status: nullableString,
  ch3Status: nullableString,
  ch4Status: nullableString,
  statusFlags: nullableString,
  failureTime: nullableString,
  failureDescription: nullableString,
  retestRecommended: nullableString,
})

export const ingestPayloadSchema = z.object({
  schemaVersion: z.literal(1),
  stationId: z.string().min(1),
  idempotencyKey: z.string().min(1).max(512),
  submittedAt: z.string().optional(),
  runId: z.string().optional(),
  result: resultSchema,
  samples: z.array(sampleSchema),
})

export type IngestPayload = z.infer<typeof ingestPayloadSchema>
export type IngestSample = z.infer<typeof sampleSchema>
export type IngestResult = z.infer<typeof resultSchema>
