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
 */

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

const FIXED_RANGE_DAYS: Record<"7d" | "30d" | "90d", number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

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
 */
export function previousAbsoluteWindow(
  dateFrom: string,
  dateTo: string
): { dateFrom: string; dateTo: string } {
  const L = inclusiveDayLength(dateFrom, dateTo);
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

  if (timeRange && timeRange !== "all" && timeRange in FIXED_RANGE_DAYS) {
    const days = FIXED_RANGE_DAYS[timeRange as "7d" | "30d" | "90d"];
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
      // days is always from FIXED_RANGE_DAYS whitelist when produced by getCompareWindows
      const days = Math.trunc(window.days);
      if (!Number.isFinite(days) || days <= 0) {
        return { sql: "", params: [] };
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
        return { sql: "", params: [] };
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
      return { sql: "", params: [] };
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

  if (timeRange && timeRange !== "all" && timeRange in FIXED_RANGE_DAYS) {
    return {
      type: "relative_open",
      days: FIXED_RANGE_DAYS[timeRange as "7d" | "30d" | "90d"],
    };
  }

  return { type: "none" };
}
