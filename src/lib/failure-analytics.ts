export interface FailureCause {
  name: string;
  count: number;
  group_name?: string;
  group_color?: string | null;
  percentage_all: number;
  percentage_failed: number;
}

export interface FailureTimelinePoint {
  date: string;
  [key: string]: string | number;
}

export interface FailureRatePoint {
  date: string;
  total: number;
  failed: number;
  passed: number;
  failureRate: number;
}

export interface FailureAnalyticsData {
  totalTests: number;
  totalFailedTests: number;
  untaggedFailed: number;
  /** Chronological decisive outcomes, P/F, with test_id breaking timestamp ties. */
  testOutcomes: string;
  categories: FailureCause[];
  groups: FailureCause[];
  categoryTimeline: FailureTimelinePoint[];
  groupTimeline: FailureTimelinePoint[];
  failureRateTimeline: FailureRatePoint[];
}

export type TimeGrouping = "daily" | "weekly" | "biweekly" | "monthly" | "quarterly";
export const TIME_GROUPINGS: TimeGrouping[] = ["daily", "weekly", "biweekly", "monthly", "quarterly"];

/** Aggregate counts in UTC, using a stable Monday anchor for fortnight buckets. */
export function groupFailureTimeline(timeline: FailureTimelinePoint[], grouping: TimeGrouping): FailureTimelinePoint[] {
  const grouped = new Map<string, FailureTimelinePoint>();
  for (const item of timeline) {
    const date = new Date(`${item.date}T00:00:00Z`);
    if (grouping === "weekly") {
      date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    } else if (grouping === "biweekly") {
      const anchor = Date.UTC(1970, 0, 5);
      const fortnight = 14 * 86_400_000;
      date.setTime(anchor + Math.floor((date.getTime() - anchor) / fortnight) * fortnight);
    } else if (grouping === "monthly") {
      date.setUTCDate(1);
    } else if (grouping === "quarterly") {
      date.setUTCDate(1);
      date.setUTCMonth(Math.floor(date.getUTCMonth() / 3) * 3);
    }
    const key = date.toISOString().slice(0, 10);
    const bucket = grouped.get(key) ?? { date: key };
    for (const [field, value] of Object.entries(item)) {
      if (field !== "date" && typeof value === "number") {
        bucket[field] = Number(bucket[field] ?? 0) + value;
      }
    }
    grouped.set(key, bucket);
  }
  return [...grouped.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** The average is weighted by test counts, not by the daily percentages. */
export function weightedFailureAverage(totals: number[], failures: number[], window: number): (number | null)[] {
  return totals.map((_, index) => {
    if (index < window - 1) return null;
    const total = totals.slice(index - window + 1, index + 1).reduce((sum, value) => sum + value, 0);
    const failed = failures.slice(index - window + 1, index + 1).reduce((sum, value) => sum + value, 0);
    return total > 0 ? failed / total * 100 : 0;
  });
}

export function formatFailureBucket(ymd: string, grouping: TimeGrouping): string {
  const date = new Date(`${ymd}T00:00:00Z`);
  if (grouping === "quarterly") return `Q${Math.floor(date.getUTCMonth() / 3) + 1} ${date.getUTCFullYear()}`;
  return date.toLocaleDateString(undefined, {
    month: "short", ...(grouping === "monthly" ? { year: "numeric" } : { day: "numeric" }), timeZone: "UTC",
  });
}

/** Test-sequence windows use complete samples; daily aggregates cannot substitute. */
export function rollingTestFailureRates(outcomes: string, window: number): [number, number][] {
  if (!Number.isInteger(window) || window < 1) return [];
  const points: [number, number][] = [];
  let failures = 0;
  for (let index = 0; index < outcomes.length; index++) {
    if (outcomes[index] === "F") failures++;
    if (index >= window && outcomes[index - window] === "F") failures--;
    if (index >= window - 1) points.push([index + 1, failures / window * 100]);
  }
  return points;
}
