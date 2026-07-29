/**
 * Shared chart palette and UTC date helpers for the dashboard volume chart.
 * All date strings are API bucket starts (YYYY-MM-DD) interpreted as UTC.
 */

import type { ChartBucket } from "@/lib/validation";

export type { ChartBucket };

export const burninChartColors = {
  passed: { base: "#10b981", top: "#34d399", dark: "#059669" },
  failed: {
    base: "#f43f5e",
    soft: (alpha: number) => `rgba(244, 63, 94, ${alpha})`,
  },
  /** Neutral / activity accent (volume bars, MA lines) — not pass/fail */
  accent: { indigo: "#6366f1" },
  grid: {
    light: "rgba(100, 116, 139, 0.14)",
    dark: "rgba(148, 163, 184, 0.14)",
  },
  text: { light: "#4b5563", dark: "#d1d5db" },
  muted: { light: "#9ca3af", dark: "#6b7280" },
} as const;

/**
 * Multi-series categorical palette for pies / stacked timelines.
 * Intentionally omits failure-red (`failed.base`) so rose stays reserved
 * for failure-rate series on the same page.
 */
export const burninSeriesPalette = [
  "#6366f1",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#06b6d4",
  "#d946ef",
  "#84cc16",
  "#f97316",
  "#0ea5e9",
  "#a855f7",
  "#14b8a6",
  "#eab308",
  "#64748b",
] as const;

/** Parse API date as UTC calendar day (not local midnight). */
export function parseUtcDateOnly(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00Z");
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(d: Date, n: number): Date {
  const x = new Date(d.getTime());
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

function lastDayOfUtcMonth(year: number, month0: number): Date {
  // day 0 of next month = last day of month0
  return new Date(Date.UTC(year, month0 + 1, 0));
}

/**
 * Inclusive UTC date range for a bucket starting at dateStr (API bucket start).
 * Week = Monday–Sunday (Postgres DATE_TRUNC('week') ISO).
 */
export function bucketRange(
  dateStr: string,
  bucket: ChartBucket,
): { from: string; to: string } {
  const start = parseUtcDateOnly(dateStr);

  switch (bucket) {
    case "day":
      return { from: dateStr, to: dateStr };
    case "week": {
      // dateStr is Monday 00:00 UTC from DATE_TRUNC('week')
      return { from: toYmd(start), to: toYmd(addUtcDays(start, 6)) };
    }
    case "month": {
      const y = start.getUTCFullYear();
      const m = start.getUTCMonth();
      return { from: toYmd(start), to: toYmd(lastDayOfUtcMonth(y, m)) };
    }
    case "quarter": {
      const y = start.getUTCFullYear();
      const m = start.getUTCMonth(); // 0, 3, 6, 9
      return { from: toYmd(start), to: toYmd(lastDayOfUtcMonth(y, m + 2)) };
    }
    case "year": {
      const y = start.getUTCFullYear();
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
  }
}

/**
 * Human-readable axis / tooltip label for a bucket start date (UTC).
 * Never uses browser-local midnight for calendar components.
 */
export function formatBucketLabel(
  dateStr: string,
  bucket: ChartBucket,
  long = false,
): string {
  const d = parseUtcDateOnly(dateStr);
  const yy = String(d.getUTCFullYear()).slice(2);
  const utc = { timeZone: "UTC" as const };

  switch (bucket) {
    case "day":
      return d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        ...utc,
        ...(long ? { year: "numeric" } : {}),
      });
    case "week": {
      const start = d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        ...utc,
      });
      return long ? `Week of ${start}, ${d.getUTCFullYear()}` : start;
    }
    case "month":
      return long
        ? d.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
            ...utc,
          })
        : `${d.toLocaleDateString("en-US", { month: "short", ...utc })} '${yy}`;
    case "quarter": {
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      return long ? `Q${q} ${d.getUTCFullYear()}` : `Q${q} '${yy}`;
    }
    case "year":
      return String(d.getUTCFullYear());
  }
}

/** Default bucket granularity for a period control value. */
export function defaultBucketForTimeRange(timeRange: string): ChartBucket {
  switch (timeRange) {
    case "all":
      return "month";
    case "90d":
      return "week";
    case "7d":
    case "30d":
    default:
      return "day";
  }
}
