import { parseTimestampFromDelhi } from './timestamps'
import type { IngestResult } from './schema'

export interface ValidatedResult {
  serialNumber: string
  startTime: string
  endTime: string
  firmwareVersion: string | null
  overallStatus: string
  acStatus: string | null
  ch1Status: string | null
  ch2Status: string | null
  ch3Status: string | null
  ch4Status: string | null
  statusFlags: string | null
  failureDescription: string | null
  failureTime: string | null
  invalidReason: string
}

/**
 * Apply the same business rules as scripts/ingest.ts for a single result row.
 * Always returns a processable result (HTTPS path is one payload = one test).
 */
export function applyResultValidation(
  result: IngestResult,
  debugFirmwareVersion: string
): ValidatedResult {
  let overallStatus = result.overallStatus
  let invalidReason = ''

  if (result.firmwareVersion === debugFirmwareVersion) {
    overallStatus = 'INVALID'
    invalidReason = 'Debug firmware version'
  }

  try {
    const start = parseTimestampFromDelhi(result.startTime)
    const end = parseTimestampFromDelhi(result.endTime)
    if (start > end) {
      overallStatus = 'INVALID'
      invalidReason = invalidReason
        ? `${invalidReason}, Invalid date range`
        : 'Invalid date range'
    } else {
      const durationHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60)
      if (durationHours < 2) {
        overallStatus = 'INVALID'
        invalidReason = invalidReason
          ? `${invalidReason}, Duration less than 2 hours`
          : 'Duration less than 2 hours'
      }
    }
  } catch {
    overallStatus = 'INVALID'
    invalidReason = invalidReason
      ? `${invalidReason}, Unparseable timestamps`
      : 'Unparseable timestamps'
  }

  return {
    serialNumber: result.serialNumber,
    startTime: result.startTime,
    endTime: result.endTime,
    firmwareVersion: result.firmwareVersion ?? null,
    overallStatus,
    acStatus: result.acStatus ?? null,
    ch1Status: result.ch1Status ?? null,
    ch2Status: result.ch2Status ?? null,
    ch3Status: result.ch3Status ?? null,
    ch4Status: result.ch4Status ?? null,
    statusFlags: result.statusFlags ?? null,
    failureDescription: result.failureDescription ?? null,
    failureTime: result.failureTime ?? null,
    invalidReason,
  }
}
