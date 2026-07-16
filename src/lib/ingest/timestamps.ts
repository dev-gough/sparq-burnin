/**
 * Parse factory wall-clock timestamps as Asia/Kolkata (Delhi) and convert to UTC.
 * Matches scripts/ingest.ts behaviour for v1 of the HTTPS ingest API.
 */

export function parseTimestampFromDelhi(timestamp: string): Date {
  const match = timestamp.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{3,}))?/
  )
  if (!match) {
    throw new Error(`Invalid timestamp format: ${timestamp}`)
  }

  const [, year, month, day, hour, minute, second, milliseconds] = match

  const delhiHour = parseInt(hour, 10)
  const delhiMinute = parseInt(minute, 10)
  const delhiSecond = parseInt(second || '0', 10)
  const delhiMs = parseInt((milliseconds || '0').slice(0, 3).padEnd(3, '0'), 10)

  let utcHour = delhiHour - 5
  let utcMinute = delhiMinute - 30
  let utcDay = parseInt(day, 10)
  let utcMonth = parseInt(month, 10)
  let utcYear = parseInt(year, 10)

  if (utcMinute < 0) {
    utcMinute += 60
    utcHour -= 1
  }

  if (utcHour < 0) {
    utcHour += 24
    utcDay -= 1
    if (utcDay < 1) {
      utcMonth -= 1
      if (utcMonth < 1) {
        utcMonth = 12
        utcYear -= 1
      }
      const daysInMonth = new Date(utcYear, utcMonth, 0).getDate()
      utcDay = daysInMonth
    }
  }

  return new Date(
    Date.UTC(utcYear, utcMonth - 1, utcDay, utcHour, utcMinute, delhiSecond, delhiMs)
  )
}

/** Failure time from station: "YYYY-MM-DD_HH-MM-SS" or N/A */
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

/** Truncate ISO-ish start time to seconds for idempotency key helpers. */
export function truncateToSeconds(isoLike: string): string {
  const m = isoLike.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/)
  return m ? m[1] : isoLike
}
