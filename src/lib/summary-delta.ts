/**
 * Summary compare delta helpers (shared by test-stats route + unit tests).
 * Kept out of the route module so Next.js does not treat them as Route exports.
 */

export interface SummaryStats {
  total: number;
  passed: number;
  failed: number;
  failureRate: number;
  failurePercentageOfTotal?: number;
}

export interface SummaryDelta {
  total: number;
  passed: number;
  failed: number;
  /** Percentage-point change in failure rate (1 decimal) */
  failureRatePp: number;
}

/** Raw failure rate % from counts (0 when total is 0). */
export function rawFailureRate(stats: SummaryStats): number {
  return stats.total > 0 ? (stats.failed / stats.total) * 100 : 0;
}

/**
 * Delta between current and previous summary windows.
 * failureRatePp is computed from raw counts (not already-rounded failureRate).
 */
export function buildSummaryDelta(
  current: SummaryStats,
  previous: SummaryStats,
): SummaryDelta {
  return {
    total: current.total - previous.total,
    passed: current.passed - previous.passed,
    failed: current.failed - previous.failed,
    failureRatePp:
      Math.round((rawFailureRate(current) - rawFailureRate(previous)) * 10) /
      10,
  };
}
