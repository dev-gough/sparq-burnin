/**
 * Parse factory wall-clock timestamps as Asia/Kolkata (Delhi) and convert to UTC.
 *
 * This is THE Delhi→UTC implementation for BOTH ingest transports: the HTTPS
 * API (src/lib/ingest/processPayload.ts) and the legacy CSV ingester
 * (scripts/ingest.ts) import from here. Do not fork this logic.
 */

/**
 * Regex accepted by parseTimestampFromDelhi. Exported so zod schemas can reject
 * malformed timestamps at parse time (→ 400) instead of throwing mid-insert (→ 500).
 */
export const DELHI_TIMESTAMP_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{3,}))?/

/** True if `parseTimestampFromDelhi` would accept this string (i.e. not throw). */
export function isParseableDelhiTimestamp(timestamp: string): boolean {
  return DELHI_TIMESTAMP_REGEX.test(timestamp)
}

export function parseTimestampFromDelhi(timestamp: string): Date {
  const match = timestamp.match(DELHI_TIMESTAMP_REGEX)
  if (!match) {
    throw new Error(`Invalid timestamp format: ${timestamp}`)
  }

  const [, year, month, day, hour, minute, second, milliseconds] = match

  // IST is UTC+05:30 year-round (no DST). Date.UTC normalizes out-of-range
  // components, so subtracting the offset here handles every minute/hour/day/
  // month/year borrow — equivalence with the old manual borrow ladder is
  // pinned by the exhaustive boundary sweep in tests/timestamps.test.ts.
  return new Date(
    Date.UTC(
      parseInt(year, 10),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10) - 5,
      parseInt(minute, 10) - 30,
      parseInt(second || '0', 10),
      parseInt((milliseconds || '0').slice(0, 3).padEnd(3, '0'), 10)
    )
  )
}

/** Failure time from station/results CSV: "YYYY-MM-DD_HH-MM-SS" or N/A */
export function parseFailureTime(value: string | null | undefined): string | null {
  if (!value || value.trim() === '' || value.trim().toUpperCase() === 'N/A') {
    return null
  }

  try {
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
