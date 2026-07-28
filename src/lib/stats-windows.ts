/**
 * UTC period-over-period window math for summary compare.
 *
 * Fixed ranges match the existing summary SQL pattern after `SET timezone = 'UTC'`:
 *   current:  start_time_utc >= CURRENT_DATE - N days
 *   previous: start_time_utc >= CURRENT_DATE - 2N days
 *         AND start_time_utc <  CURRENT_DATE - N days
 *
 * Custom ranges use equal calendar-day length immediately before dateFrom,
 * with the same inclusive end predicate as the summary API
 * (`dateTo + 1 day - 1 second`).
 *
 * Day counts for fixed ranges come from `getTimeRangeDays` in validation.ts
 * (single source of truth with chart/summary filters).
 */

import { getTimeRangeDays } from "./validation";

export type RelativeOpenWindow = {
  type: "relative_open";
  /** Days back from CURRENT_DATE (UTC); lower bound inclusive, upper open. */
  days: number;
};

export type RelativeHalfOpenWindow = {
  type: "relative_half_open";
  /** Inclusive lower bound: CURRENT_DATE - startDaysAgo */
  startDaysAgo: number;
  /** Exclusive upper bound: CURRENT_DATE - endDaysAgo */
  endDaysAgo: number;
};

export type AbsoluteWindow = {
  type: "absolute";
  /** Inclusive start date YYYY-MM-DD, or null for no lower bound */
  dateFrom: string | null;
  /** Inclusive end date YYYY-MM-DD, or null for no upper bound */
  dateTo: string | null;
};

export type NoneWindow = {
  type: "none";
};

export type StatsWindow =
  | RelativeOpenWindow
  | RelativeHalfOpenWindow
  | AbsoluteWindow
  | NoneWindow;

export interface CompareWindows {
  current: StatsWindow;
  previous: StatsWindow;
  labels: {
    current: string;
    previous: string;
  };
}

export interface GetCompareWindowsInput {
  /** Validated time range; null if absent/invalid */
  timeRange: "7d" | "30d" | "90d" | "all" | null;
  /** Validated YYYY-MM-DD or null */
  dateFrom: string | null;
  /** Validated YYYY-MM-DD or null */
  dateTo: string | null;
}

/**
 * Parse YYYY-MM-DD as UTC midnight.
 */
export function parseYmdUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Format a Date as YYYY-MM-DD in UTC.
 */
export function formatYmdUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Calendar-day length of an inclusive [dateFrom, dateTo] range.
 * L = (dateTo - dateFrom) + 1
 */
export function inclusiveDayLength(dateFrom: string, dateTo: string): number {
  const from = parseYmdUtc(dateFrom);
  const to = parseYmdUtc(dateTo);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
}

/**
 * Equal-length prior window immediately before an inclusive custom range.
 * previous.to = dateFrom - 1 day; previous.from = previous.to - (L - 1) days.
 *
 * Requires dateFrom <= dateTo (inclusive ordered YMD). Throws if L <= 0.
 */
export function previousAbsoluteWindow(
  dateFrom: string,
  dateTo: string
): { dateFrom: string; dateTo: string } {
  const L = inclusiveDayLength(dateFrom, dateTo);
  if (L <= 0) {
    throw new Error(
      `previousAbsoluteWindow requires dateFrom <= dateTo (got ${dateFrom}, ${dateTo})`
    );
  }
  const prevTo = parseYmdUtc(dateFrom);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo.getTime());
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (L - 1));
  return {
    dateFrom: formatYmdUtc(prevFrom),
    dateTo: formatYmdUtc(prevTo),
  };
}

/**
 * Resolve fixed-range day count from the shared validation whitelist.
 * Returns null for `all` / unknown.
 */
function fixedRangeDays(
  timeRange: GetCompareWindowsInput["timeRange"]
): number | null {
  if (!timeRange || timeRange === "all") return null;
  return getTimeRangeDays(timeRange);
}

/**
 * Compute current + previous windows for summary `compare=1`.
 * Returns null when period-over-period is not applicable (`all`, open-ended
 * custom, or no usable range).
 */
export function getCompareWindows(
  input: GetCompareWindowsInput
): CompareWindows | null {
  const { timeRange, dateFrom, dateTo } = input;

  // Custom dates take precedence (matches existing summary filter logic)
  if (dateFrom || dateTo) {
    // Equal-length prior window requires both ends
    if (!dateFrom || !dateTo) {
      return null;
    }

    const previous = previousAbsoluteWindow(dateFrom, dateTo);
    return {
      current: { type: "absolute", dateFrom, dateTo },
      previous: {
        type: "absolute",
        dateFrom: previous.dateFrom,
        dateTo: previous.dateTo,
      },
      labels: {
        current: `${dateFrom} – ${dateTo}`,
        previous: `${previous.dateFrom} – ${previous.dateTo}`,
      },
    };
  }

  const days = fixedRangeDays(timeRange);
  if (days !== null) {
    return {
      current: { type: "relative_open", days },
      previous: {
        type: "relative_half_open",
        startDaysAgo: days * 2,
        endDaysAgo: days,
      },
      labels: {
        current: `Last ${days} days`,
        previous: `Prior ${days} days`,
      },
    };
  }

  // timeRange=all, null, or unknown → no compare
  return null;
}

/**
 * Build a SQL time-filter clause (without leading AND) and bound params for a
 * StatsWindow. Uses the same predicates as the summary API.
 *
 * Fail-closed: invalid relative windows throw rather than emitting an empty
 * filter (which would silently become all-time). Trusted callers should only
 * pass windows from getCurrentWindow / getCompareWindows.
 *
 * @param window - Window descriptor from getCompareWindows / current filter
 * @param column - Timestamp column, e.g. `t.start_time_utc`
 * @param startParamIndex - Next 1-based `$N` placeholder index
 */
export function buildWindowTimeFilter(
  window: StatsWindow,
  column: string,
  startParamIndex: number
): { sql: string; params: string[] } {
  switch (window.type) {
    case "none":
      return { sql: "", params: [] };

    case "relative_open": {
      const days = Math.trunc(window.days);
      if (!Number.isFinite(days) || days <= 0) {
        throw new Error(
          `Invalid relative_open window: days must be a positive integer (got ${window.days})`
        );
      }
      return {
        sql: `${column} >= CURRENT_DATE - INTERVAL '${days} days'`,
        params: [],
      };
    }

    case "relative_half_open": {
      const startDays = Math.trunc(window.startDaysAgo);
      const endDays = Math.trunc(window.endDaysAgo);
      if (
        !Number.isFinite(startDays) ||
        !Number.isFinite(endDays) ||
        startDays <= 0 ||
        endDays < 0 ||
        startDays <= endDays
      ) {
        throw new Error(
          `Invalid relative_half_open window: need startDaysAgo > endDaysAgo >= 0 (got start=${window.startDaysAgo}, end=${window.endDaysAgo})`
        );
      }
      return {
        sql: `${column} >= CURRENT_DATE - INTERVAL '${startDays} days' AND ${column} < CURRENT_DATE - INTERVAL '${endDays} days'`,
        params: [],
      };
    }

    case "absolute": {
      const conditions: string[] = [];
      const params: string[] = [];
      let idx = startParamIndex;
      if (window.dateFrom) {
        params.push(window.dateFrom);
        conditions.push(`${column} >= $${idx}::date`);
        idx += 1;
      }
      if (window.dateTo) {
        params.push(window.dateTo);
        conditions.push(
          `${column} <= $${idx}::date + INTERVAL '1 day' - INTERVAL '1 second'`
        );
      }
      return { sql: conditions.join(" AND "), params };
    }

    default: {
      // Exhaustiveness
      const _exhaustive: never = window;
      void _exhaustive;
      throw new Error("Unreachable StatsWindow variant");
    }
  }
}

/**
 * Current (non-compare) summary window from the same inputs as the API.
 * Used so route and compare share one definition of "current".
 */
export function getCurrentWindow(input: GetCompareWindowsInput): StatsWindow {
  const { timeRange, dateFrom, dateTo } = input;

  if (dateFrom || dateTo) {
    return { type: "absolute", dateFrom, dateTo };
  }

  const days = fixedRangeDays(timeRange);
  if (days !== null) {
    return { type: "relative_open", days };
  }

  return { type: "none" };
}
