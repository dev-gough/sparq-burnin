/**
 * Parse ingest wall-clock timestamps and convert to UTC.
 *
 * Offset-less timestamps are interpreted as Asia/Kolkata (Delhi) — the legacy
 * pCloud CSVs carry Delhi factory wall clock with no zone marker. A timestamp
 * carrying an explicit `Z` or `±hh:mm` suffix is honored instead: station
 * clients outside IST (e.g. the lab station in America/Toronto) attach their
 * local UTC offset so their wall clock isn't misread as Delhi time.
 *
 * This is THE wall-clock→UTC implementation for BOTH ingest transports: the
 * HTTPS API (src/lib/ingest/processPayload.ts) and the legacy CSV ingester
 * (scripts/ingest.ts) import from here. Do not fork this logic.
 */

/**
 * Regex accepted by parseTimestampFromDelhi. Exported so zod schemas can reject
 * malformed timestamps at parse time (→ 400) instead of throwing mid-insert (→ 500).
 */
export const DELHI_TIMESTAMP_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{3,}))?(Z|[+-]\d{2}:\d{2})?/

const DELHI_OFFSET_MINUTES = 5 * 60 + 30

function offsetToMinutes(offset: string | undefined): number {
  if (!offset) return DELHI_OFFSET_MINUTES
  if (offset === 'Z') return 0
  const sign = offset.startsWith('-') ? -1 : 1
  const hours = parseInt(offset.slice(1, 3), 10)
  const minutes = parseInt(offset.slice(4, 6), 10)
  return sign * (hours * 60 + minutes)
}

/** True if `parseTimestampFromDelhi` would accept this string (i.e. not throw). */
export function isParseableDelhiTimestamp(timestamp: string): boolean {
  return DELHI_TIMESTAMP_REGEX.test(timestamp)
}

export function parseTimestampFromDelhi(timestamp: string): Date {
  const match = timestamp.match(DELHI_TIMESTAMP_REGEX)
  if (!match) {
    throw new Error(`Invalid timestamp format: ${timestamp}`)
  }

  const [, year, month, day, hour, minute, second, milliseconds, offset] = match

  // Explicit Z/±hh:mm is honored; otherwise assume IST (UTC+05:30 year-round,
  // no DST). Date.UTC normalizes out-of-range components, so subtracting the
  // offset from the minutes handles every minute/hour/day/month/year borrow —
  // equivalence with the old manual borrow ladder is pinned by the exhaustive
  // boundary sweep in tests/timestamps.test.ts.
  return new Date(
    Date.UTC(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(minute, 10) - offsetToMinutes(offset),
      parseInt(second || '0', 10),
      parseInt((milliseconds || '0').slice(0, 3).padEnd(3, '0'), 10)
    )
  )
}

/**
 * Failure time from station/results CSV: "YYYY-MM-DD_HH-MM-SS" or N/A.
 * Offset-aware station clients instead send ISO "YYYY-MM-DDTHH:MM:SS±hh:mm" —
 * anything with a T separator goes through parseTimestampFromDelhi directly
 * (which honors the offset, Delhi fallback when absent).
 */
export function parseFailureTime(value: string | null | undefined): string | null {
  if (!value || value.trim() === '' || value.trim().toUpperCase() === 'N/A') {
    return null
  }

  try {
    if (value.includes('T')) {
      return parseTimestampFromDelhi(value.trim()).toISOString()
    }
    const parts = value.split('_')
    if (parts.length !== 2) {
      return null
    }
    const datePart = parts[0]
    const timePart = parts[1].replace(/-/g, ':')
    const delhiTimestamp = `${datePart}T${timePart}`
    return parseTimestampFromDelhi(delhiTimestamp).toISOString()
  } catch {
    return null
  }
}
