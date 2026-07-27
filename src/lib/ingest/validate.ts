import { parseTimestampFromDelhi } from './timestamps'
import type { IngestResult } from './schema'

/**
 * Result-row business rules shared by BOTH ingest transports:
 *  - the HTTPS JSON API (src/lib/ingest/processPayload.ts via applyResultValidation)
 *  - the legacy CSV ingester (scripts/ingest.ts via evaluateResultRow + selectBestResult)
 *
 * Do not fork this logic back into scripts/ingest.ts — the AC-header alias bug
 * on this branch came from exactly that kind of drift.
 */

export interface ValidatedResult {
  serialNumber: string
  startTime: string
  endTime: string
  /**
   * start/end parsed to UTC ISO strings ONCE during validation. Null when the
   * raw timestamp was unparseable (kept for defence-in-depth; the zod schema
   * already rejects such payloads with 400 before this runs). Downstream insert
   * code uses these and never re-parses the raw strings.
   */
  startTimeUtc: string | null
  endTimeUtc: string | null
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

/** Minimal result-row shape the shared rules need (both transports map into this). */
export interface ResultRowInput {
  serialNumber: string
  startTime: string | null | undefined
  endTime: string | null | undefined
  firmwareVersion?: string | null
  overallStatus: string
}

export interface ResultRowEvaluation {
  overallStatus: string
  invalidReason: string
  /** See the priority table on evaluateResultRow. */
  priority: number
  startTimeUtc: string | null
  endTimeUtc: string | null
  /**
   * Set when start/end were present but unparseable. The CSV transport rethrows
   * this (a bad results file fails the whole ingest run, matching legacy
   * behavior); the HTTPS transport never reaches this state because the zod
   * schema 400-rejects malformed timestamps first (kept as defence-in-depth:
   * the row is also marked INVALID / "Unparseable timestamps").
   */
  timestampParseError: Error | null
}

/**
 * MULTI-ROW PRIORITY-SELECTION RULE — single source of truth.
 *
 * A results file may contain multiple rows for one physical test (e.g. after a
 * RETEST). Each row gets a priority here, and selectBestResult() picks exactly
 * one row per file:
 *
 *   priority 4 — valid row
 *   priority 3 — INVALID (debug firmware version, or already INVALID in the
 *                source data with no more specific reason)
 *   priority 2 — duration < 2 hours
 *   priority 1 — start > end (invalid date range; lowest priority)
 *
 * Selection semantics (selectBestResult):
 *   - Single-row files are processed regardless of validity (even priority 1).
 *   - Multi-row: the highest-priority row wins; ties go to the FIRST row in
 *     file order (stable sort).
 *   - Multi-row where ALL rows are priority 1: the whole file is skipped.
 *
 * The station client (Zigbee_UART_Interface repo,
 * burnin/dashboard_ingest.py `_row_priority`) MIRRORS this rule client-side so
 * it uploads the same row the server would pick. One deliberate exception: the
 * debug-firmware demotion (priority 4 → 3 via
 * config.settings.debug_firmware_version) is applied SERVER-SIDE ONLY — the
 * station cannot see that config value, so the server stays the backstop.
 *
 * If you change these rules in ANY way, the station's `_row_priority()` must
 * change too — flag it in the cross-repo coordination sections of BOTH repos'
 * HTTPS_INGEST_POLISH_PLAN.md.
 *
 * The optional `log` callback receives the same operator-facing messages the
 * legacy CSV ingester has always printed (the HTTPS path passes none).
 */
export function evaluateResultRow(
  row: ResultRowInput,
  debugFirmwareVersion: string,
  log?: (message: string) => void
): ResultRowEvaluation {
  let overallStatus = row.overallStatus
  let invalidReason = ''
  let priority = 4 // Start with highest priority (valid)
  let startTimeUtc: string | null = null
  let endTimeUtc: string | null = null
  let timestampParseError: Error | null = null

  // Mark debug firmware version as INVALID (server-side only; see doc above).
  if (row.firmwareVersion === debugFirmwareVersion) {
    log?.(
      `Marking test with debug firmware version ${debugFirmwareVersion} as INVALID for inverter ${row.serialNumber}`
    )
    overallStatus = 'INVALID'
    invalidReason = 'Debug firmware version'
    priority = 3 // Medium priority - can be processed if no better options
  }

  if (row.startTime && row.endTime) {
    try {
      const start = parseTimestampFromDelhi(row.startTime)
      const end = parseTimestampFromDelhi(row.endTime)
      startTimeUtc = start.toISOString()
      endTimeUtc = end.toISOString()

      // Check if start time is after end time
      if (start > end) {
        log?.(
          `Marking test as INVALID due to start time (${row.startTime}) being after end time (${row.endTime}) for inverter ${row.serialNumber}`
        )
        overallStatus = 'INVALID'
        invalidReason = invalidReason
          ? `${invalidReason}, Invalid date range`
          : 'Invalid date range'
        priority = 1 // Lowest priority - only process if no other options
      } else {
        // Check if test duration is less than 2 hours
        const durationHours =
          (end.getTime() - start.getTime()) / (1000 * 60 * 60)
        if (durationHours < 2) {
          log?.(
            `Marking test as INVALID due to duration less than 2 hours (${durationHours.toFixed(2)} hours) for inverter ${row.serialNumber}`
          )
          overallStatus = 'INVALID'
          invalidReason = invalidReason
            ? `${invalidReason}, Duration less than 2 hours`
            : 'Duration less than 2 hours'
          // Only lower priority if not already lowered by date range issue
          if (priority > 2) {
            priority = 2 // Medium-low priority - acceptable if no date range issues
          }
        }
      }
    } catch (err) {
      timestampParseError = err instanceof Error ? err : new Error(String(err))
      overallStatus = 'INVALID'
      invalidReason = invalidReason
        ? `${invalidReason}, Unparseable timestamps`
        : 'Unparseable timestamps'
    }
  }

  // Row already INVALID in the source data with no specific rule fired
  if (overallStatus === 'INVALID' && priority === 4) {
    priority = 3
  }

  return {
    overallStatus,
    invalidReason,
    priority,
    startTimeUtc,
    endTimeUtc,
    timestampParseError,
  }
}

/** Row shape selectBestResult needs (priority from evaluateResultRow). */
export interface SelectableResultRow {
  serialNumber: string
  startTime: string | null | undefined
  priority: number
}

/**
 * Select the single result row to ingest from a (possibly multi-row) results
 * file. See the MULTI-ROW PRIORITY-SELECTION RULE doc on evaluateResultRow —
 * that comment is the authoritative description of these semantics, mirrored
 * by the station client. Returns null when nothing should be processed
 * (empty input, or a multi-row file where every row is priority 1).
 */
export function selectBestResult<T extends SelectableResultRow>(
  rows: T[],
  options: {
    /** Label used in the skip warning (the CSV path passes the file basename). */
    fileLabel?: string
    log?: (message: string) => void
    warn?: (message: string) => void
  } = {}
): T | null {
  const { fileLabel = 'input', log, warn } = options

  if (rows.length === 0) {
    return null
  }

  if (rows.length === 1) {
    // Single row: always process regardless of validity
    const selected = rows[0]
    log?.(
      `Single row found - processing regardless of validity (priority: ${selected.priority})`
    )
    return selected
  }

  // Multiple rows: select highest priority; stable sort keeps first-in-file
  // order on ties.
  const sorted = [...rows].sort((a, b) => b.priority - a.priority)
  const selected = sorted[0]

  const priorityGroups = {
    1: rows.filter(t => t.priority === 1).length,
    2: rows.filter(t => t.priority === 2).length,
    3: rows.filter(t => t.priority === 3).length,
    4: rows.filter(t => t.priority === 4).length,
  }

  log?.(
    `Multiple rows found - priority breakdown: P4(valid)=${priorityGroups[4]}, P3(debug/invalid)=${priorityGroups[3]}, P2(short)=${priorityGroups[2]}, P1(date-range)=${priorityGroups[1]}`
  )
  log?.(
    `Selected: ${selected.serialNumber} (${selected.startTime}) with priority ${selected.priority}`
  )

  if (selected.priority === 1 && priorityGroups[1] === rows.length) {
    warn?.(
      `⚠️  WARNING: All rows in ${fileLabel} have date range issues (start > end). Skipping file.`
    )
    return null
  }

  return selected
}

/**
 * Apply the shared business rules to a single HTTPS-payload result.
 * Always returns a processable result (HTTPS path is one payload = one test;
 * the multi-row selection already happened station-side — see
 * evaluateResultRow's rule doc).
 */
export function applyResultValidation(
  result: IngestResult,
  debugFirmwareVersion: string
): ValidatedResult {
  const evaluation = evaluateResultRow(
    {
      serialNumber: result.serialNumber,
      startTime: result.startTime,
      endTime: result.endTime,
      firmwareVersion: result.firmwareVersion ?? null,
      overallStatus: result.overallStatus,
    },
    debugFirmwareVersion
  )

  return {
    serialNumber: result.serialNumber,
    startTime: result.startTime,
    endTime: result.endTime,
    startTimeUtc: evaluation.startTimeUtc,
    endTimeUtc: evaluation.endTimeUtc,
    firmwareVersion: result.firmwareVersion ?? null,
    overallStatus: evaluation.overallStatus,
    acStatus: result.acStatus ?? null,
    ch1Status: result.ch1Status ?? null,
    ch2Status: result.ch2Status ?? null,
    ch3Status: result.ch3Status ?? null,
    ch4Status: result.ch4Status ?? null,
    statusFlags: result.statusFlags ?? null,
    failureDescription: result.failureDescription ?? null,
    failureTime: result.failureTime ?? null,
    invalidReason: evaluation.invalidReason,
  }
}
