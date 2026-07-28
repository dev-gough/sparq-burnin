/**
 * Behavior-pinning tests for the Delhi→UTC timestamp math.
 *
 * These lock the current manual borrow-ladder behavior BEFORE the planned
 * Date.UTC simplification (plan item 2.5): the simplification is only safe if
 * every case here — including the exhaustive sweep — still passes unchanged.
 */
import { describe, it, expect } from 'vitest'
import {
  parseTimestampFromDelhi,
  parseFailureTime,
  isParseableDelhiTimestamp,
} from '@/lib/ingest/timestamps'

describe('parseTimestampFromDelhi', () => {
  const cases: Array<[string, string]> = [
    // plain midday, no borrows
    ['2025-06-15T12:00:00', '2025-06-15T06:30:00.000Z'],
    // minute borrow only
    ['2025-06-15T12:15:00', '2025-06-15T06:45:00.000Z'],
    // hour borrow across midnight
    ['2025-06-15T05:00:00', '2025-06-14T23:30:00.000Z'],
    ['2025-06-15T00:00:00', '2025-06-14T18:30:00.000Z'],
    // day borrow across a month boundary (30-day month behind)
    ['2025-07-01T02:00:00', '2025-06-30T20:30:00.000Z'],
    // day borrow across a month boundary (31-day month behind)
    ['2025-08-01T02:00:00', '2025-07-31T20:30:00.000Z'],
    // year boundary
    ['2025-01-01T01:00:00', '2024-12-31T19:30:00.000Z'],
    // leap year: Mar 1 borrows into Feb 29
    ['2024-03-01T00:30:00', '2024-02-29T19:00:00.000Z'],
    // non-leap year: Mar 1 borrows into Feb 28
    ['2025-03-01T00:30:00', '2025-02-28T19:00:00.000Z'],
    // seconds optional
    ['2025-06-15T12:00', '2025-06-15T06:30:00.000Z'],
    // milliseconds preserved
    ['2025-06-15T12:00:00.123', '2025-06-15T06:30:00.123Z'],
    // >3 ms digits truncated to milliseconds
    ['2025-06-15T12:00:00.123456', '2025-06-15T06:30:00.123Z'],
    // exact IST offset boundary (05:30 → midnight UTC)
    ['2025-06-15T05:30:00', '2025-06-15T00:00:00.000Z'],
    ['2025-06-15T05:29:59', '2025-06-14T23:59:59.000Z'],
    // explicit offset is honored instead of the Delhi assumption:
    // lab station in EDT (UTC-4)
    ['2026-07-28T12:25:36-04:00', '2026-07-28T16:25:36.000Z'],
    // explicit IST offset ≡ the offset-less Delhi assumption
    ['2025-06-15T12:00:00+05:30', '2025-06-15T06:30:00.000Z'],
    // explicit UTC
    ['2025-06-15T12:00:00Z', '2025-06-15T12:00:00.000Z'],
    // negative offset borrowing across midnight
    ['2026-01-01T20:30:00-05:00', '2026-01-02T01:30:00.000Z'],
    // milliseconds + offset
    ['2026-07-28T12:25:36.123-04:00', '2026-07-28T16:25:36.123Z'],
    // seconds-less + offset
    ['2026-07-28T12:25-04:00', '2026-07-28T16:25:00.000Z'],
  ]

  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, () => {
      expect(parseTimestampFromDelhi(input).toISOString()).toBe(expected)
    })
  }

  it('throws on malformed input', () => {
    for (const bad of [
      '2025-06-15 12:00:00', // space, not T
      '15-06-2025T12:00:00',
      'garbage',
      '',
    ]) {
      expect(() => parseTimestampFromDelhi(bad)).toThrow()
      expect(isParseableDelhiTimestamp(bad)).toBe(false)
    }
  })

  it('matches Date.UTC normalization over an exhaustive boundary sweep', () => {
    // Every hour of the first/last two days of each month, 2023–2026
    // (covers leap/non-leap Feb, 30/31-day months, year boundaries).
    for (let year = 2023; year <= 2026; year++) {
      for (let month = 1; month <= 12; month++) {
        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
        for (const day of [1, 2, daysInMonth - 1, daysInMonth]) {
          for (let hour = 0; hour < 24; hour++) {
            const s = `${year}-${String(month).padStart(2, '0')}-${String(
              day
            ).padStart(2, '0')}T${String(hour).padStart(2, '0')}:17:42`
            const reference = new Date(
              Date.UTC(year, month - 1, day, hour - 5, 17 - 30, 42, 0)
            )
            expect(parseTimestampFromDelhi(s).getTime()).toBe(
              reference.getTime()
            )
          }
        }
      }
    }
  })
})

describe('parseFailureTime', () => {
  it('parses the station underscore format as Delhi wall clock', () => {
    expect(parseFailureTime('2025-06-15_12-00-00')).toBe(
      '2025-06-15T06:30:00.000Z'
    )
  })

  it('honors an explicit offset in ISO-form failure times', () => {
    expect(parseFailureTime('2026-07-28T12:25:36-04:00')).toBe(
      '2026-07-28T16:25:36.000Z'
    )
  })

  it('parses offset-less ISO-form failure times as Delhi wall clock', () => {
    expect(parseFailureTime('2025-06-15T12:00:00')).toBe(
      '2025-06-15T06:30:00.000Z'
    )
  })

  it('returns null for N/A, empty, and malformed values', () => {
    expect(parseFailureTime('N/A')).toBeNull()
    expect(parseFailureTime('')).toBeNull()
    expect(parseFailureTime(null)).toBeNull()
    expect(parseFailureTime(undefined)).toBeNull()
    expect(parseFailureTime('2025-06-15')).toBeNull()
    expect(parseFailureTime('not_a_time')).toBeNull()
  })
})
