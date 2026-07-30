/**
 * Shared chart palette and UTC date helpers for the dashboard volume chart.
 * All date strings are API bucket starts (YYYY-MM-DD) interpreted as UTC.
 */

import * as React from "react";
import type { ChartBucket } from "@/lib/validation";

export type { ChartBucket };

/**
 * Enter animation for dashboard charts.
 * - Fresh mount / data change: cascade left → right via series `animationDelay`
 * - Update morphs disabled so range switches never “wonk” between series shapes
 * Pair with `.chart-reveal-ltr` clip wipe on the host for a clean repaint.
 */
export const chartEnterAnimation = {
  animation: true,
  animationThreshold: 8000,
  animationDuration: 650,
  animationEasing: "cubicOut" as const,
  /** Disable morph between old/new series — remount + L→R wipe instead */
  animationDurationUpdate: 0,
  animationEasingUpdate: "linear" as const,
};

/** Stagger series points/bars so they paint left → right. */
export function chartSeriesDelay(
  idx: number,
  stepMs = 26,
  capMs = 450,
): number {
  return Math.min(idx * stepMs, capMs);
}

/**
 * Freeze the ECharts option while a soft refetch is in flight.
 *
 * Period pills / Group-by change `bucket` and range immediately while SWR still
 * shows the previous series. Re-deriving chart data with the *new* bucket
 * (e.g. continuous day-fill of week aggregates) mutates `seriesKey` before the
 * matching fetch lands — that used to commit a wrong intermediate chart.
 *
 * Rules:
 * - **refreshing** → always keep last committed option (ignore seriesKey churn)
 * - seriesKey change while idle → commit full option (enter animation OK)
 * - same series + idle → soft commit with animation disabled (theme / highlight)
 */
export function useCommittedChartOption<T extends object>(
  option: T,
  seriesKey: string,
  refreshing: boolean,
): T {
  const committedKeyRef = React.useRef(seriesKey);
  const committedOptionRef = React.useRef(option);

  // Hold last good paint for the whole soft-refetch window — even when
  // seriesKey changes because transforms (bucket fill, labels) run on stale data.
  if (refreshing) {
    return committedOptionRef.current;
  }

  if (seriesKey !== committedKeyRef.current) {
    committedKeyRef.current = seriesKey;
    committedOptionRef.current = option;
  } else {
    committedOptionRef.current = {
      ...option,
      // Soft updates must not re-trigger series enter (blank flash)
      animation: false,
      animationDuration: 0,
      animationDurationUpdate: 0,
    } as T;
  }

  return committedOptionRef.current;
}

/**
 * Stabilize a paint/series key across soft refetches.
 * While `refreshing`, returns the last committed key so CSS reveals / dependent
 * effects do not fire on intermediate transforms of stale data.
 */
export function useCommittedSeriesKey(
  seriesKey: string,
  refreshing: boolean,
): string {
  const committedRef = React.useRef(seriesKey);
  if (!refreshing) {
    committedRef.current = seriesKey;
  }
  return committedRef.current;
}

/**
 * Apply a one-shot CSS enter class (e.g. chart-reveal-ltr) when `seriesKey`
 * changes, without remounting children.
 *
 * The reveal class must be owned ONLY here — do not also put it on the host
 * `className`. Dual application (static class + this effect) ran the wipe
 * twice on empty→data mounts: first paint had the class, then layoutEffect
 * removed/re-added it and restarted the animation (flash + second redraw).
 */
export function useSeriesRevealClass(
  seriesKey: string,
  className = "chart-reveal-ltr",
): React.RefObject<HTMLDivElement | null> {
  const ref = React.useRef<HTMLDivElement | null>(null);
  /** null until first non-empty key so the initial series gets one reveal. */
  const prevKeyRef = React.useRef<string | null>(null);

  React.useLayoutEffect(() => {
    if (!seriesKey) return;
    if (prevKeyRef.current === seriesKey) return;
    prevKeyRef.current = seriesKey;
    const el = ref.current;
    if (!el) return;
    el.classList.remove(className);
    // Force reflow so the next add restarts the animation
    void el.offsetWidth;
    el.classList.add(className);
  }, [seriesKey, className]);

  return ref;
}

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
    // O29: slightly brighter gridlines in dark mode for readability
    dark: "rgba(148, 163, 184, 0.22)",
  },
  text: { light: "#4b5563", dark: "#e5e7eb" },
  muted: { light: "#9ca3af", dark: "#9ca3af" },
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
