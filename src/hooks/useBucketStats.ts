"use client";

import * as React from "react";
import {
  appendDashboardRangeParams,
  tableDatesForPill,
  type DashboardRange,
} from "@/lib/dashboard-range";
import type { ChartBucket } from "@/lib/chart-theme";
import {
  formatYmdUtc,
  inclusiveDayLength,
  parseYmdUtc,
} from "@/lib/stats-windows";

export interface BucketStats {
  date: string;
  passed: number;
  failed: number;
  totalUnfiltered?: number;
  failedFiltered?: number;
}

/** Stable identity for the in-flight / desired fetch. */
function buildRequestKey(opts: {
  dashboardRange: DashboardRange;
  chartMode: string;
  annotationFilter: string;
  bucket: ChartBucket;
  requestEpoch: number;
  enabled: boolean;
}): string {
  const { dashboardRange, chartMode, annotationFilter, bucket, requestEpoch, enabled } =
    opts;
  return JSON.stringify({
    enabled,
    chartMode,
    annotationFilter,
    bucket,
    requestEpoch,
    kind: dashboardRange.kind,
    from: dashboardRange.kind === "custom" ? dashboardRange.from : null,
    to: dashboardRange.kind === "custom" ? dashboardRange.to : null,
  });
}

/**
 * Fetch bucketed pass/fail series for a chart surface.
 * Volume chart and failure-rate strip call this separately so "Group by"
 * on volume does not redraw the strip (different bucket args).
 *
 * Stale-while-revalidate: after the first successful load, previous series
 * stay mounted while a new range/bucket is fetched.
 *
 * `refreshing` is derived synchronously (requestKey !== dataKey) so the
 * first render after a period pill flip already freezes the chart option —
 * no one-frame race where bucket changes re-animate the old series.
 */
export function useBucketStats(opts: {
  dashboardRange: DashboardRange;
  chartMode: string;
  annotationFilter: string;
  bucket: ChartBucket;
  requestEpoch: number;
  /** When false, skip fetch (e.g. until localStorage prefs hydrate). Default true. */
  enabled?: boolean;
}): {
  data: BucketStats[];
  /** True only on the initial load (no data yet). */
  loading: boolean;
  /** True while shown data belongs to a previous request key. */
  refreshing: boolean;
  error: boolean;
} {
  const {
    dashboardRange,
    chartMode,
    annotationFilter,
    bucket,
    requestEpoch,
    enabled = true,
  } = opts;

  const requestKey = React.useMemo(
    () =>
      buildRequestKey({
        dashboardRange,
        chartMode,
        annotationFilter,
        bucket,
        requestEpoch,
        enabled,
      }),
    [dashboardRange, chartMode, annotationFilter, bucket, requestEpoch, enabled],
  );

  const [data, setData] = React.useState<BucketStats[]>([]);
  /** Request key that `data` was loaded for; null until first successful load. */
  const [dataKey, setDataKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState(false);

  const requestKeyRef = React.useRef(requestKey);
  requestKeyRef.current = requestKey;
  const dataKeyRef = React.useRef(dataKey);
  dataKeyRef.current = dataKey;

  // Synchronous: true on the same render that range/bucket/epoch changes
  const loading = enabled && dataKey === null;
  const refreshing = enabled && dataKey !== null && dataKey !== requestKey;

  React.useEffect(() => {
    if (!enabled) return;

    const abort = new AbortController();
    const keyAtStart = requestKey;

    async function fetchStats() {
      try {
        setError(false);
        const params = new URLSearchParams({
          chartMode,
          annotation: annotationFilter,
          bucket,
        });
        appendDashboardRangeParams(params, dashboardRange);

        const response = await fetch(`/api/test-stats?${params}`, {
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        // A newer request superseded this one
        if (requestKeyRef.current !== keyAtStart) return;

        if (!response.ok) {
          setError(true);
          // Clear refreshing without wiping soft-refresh series
          setDataKey(keyAtStart);
          return;
        }

        const json: BucketStats[] = await response.json();
        if (abort.signal.aborted) return;
        if (requestKeyRef.current !== keyAtStart) return;

        const next = Array.isArray(json) ? json : [];
        setData(next);
        setDataKey(keyAtStart);
      } catch (e) {
        if (abort.signal.aborted) return;
        if (requestKeyRef.current !== keyAtStart) return;
        console.error("Error fetching bucket stats:", e);
        setError(true);
        // First load: clear series. Soft refresh: keep previous series.
        if (dataKeyRef.current === null) setData([]);
        setDataKey(keyAtStart);
      }
    }

    fetchStats();
    return () => abort.abort();
  }, [
    requestKey,
    dashboardRange,
    chartMode,
    annotationFilter,
    bucket,
    enabled,
  ]);

  return { data, loading, refreshing, error };
}

/** Volume series: drop strip-only empty buckets (passed+failed === 0). */
export function volumeSeriesFromBuckets(data: BucketStats[]): BucketStats[] {
  return data.filter((row) => (row.passed || 0) + (row.failed || 0) > 0);
}

/** True when every row has rank-then-tag strip fields (or empty series). */
export function hasStripFields(data: BucketStats[]): boolean {
  return (
    data.length === 0 ||
    data.every(
      (row) =>
        typeof row.totalUnfiltered === "number" &&
        typeof row.failedFiltered === "number",
    )
  );
}

/** Cap continuous day fill so all-time / long customs never explode the chart. */
const MAX_CONTINUOUS_DAY_FILL = 120;

/**
 * Inclusive YMD bounds for a bounded dashboard range (pills 7/30/90d or custom).
 * Returns null for all-time or open-ended custom (no continuous axis fill).
 */
export function continuousDayBounds(
  range: DashboardRange,
): { from: string; to: string } | null {
  if (range.kind === "all") return null;
  if (range.kind === "custom") {
    if (!range.from || !range.to || range.from > range.to) return null;
    return { from: range.from, to: range.to };
  }
  const span = tableDatesForPill(range.kind);
  if (!span.from || !span.to) return null;
  return { from: span.from, to: span.to };
}

/**
 * Whether we should fill every calendar day in the window (O9).
 * Day bucket + bounded executive windows only; long spans stay sparse/active-only.
 */
export function shouldFillContinuousDays(
  range: DashboardRange,
  bucket: ChartBucket,
): boolean {
  if (bucket !== "day") return false;
  const bounds = continuousDayBounds(range);
  if (!bounds) return false;
  const days = inclusiveDayLength(bounds.from, bounds.to);
  return days > 0 && days <= MAX_CONTINUOUS_DAY_FILL;
}

function normalizeBucketDate(date: string): string {
  // API returns DATE_TRUNC::date as YYYY-MM-DD (sometimes with time suffix)
  return date.slice(0, 10);
}

/**
 * Insert zero-volume days so day charts never silently jump (e.g. Jul 8 → Jul 16).
 * Preserves existing row fields (including strip totals). No-op when not day
 * or range is unbounded / too long.
 */
export function fillContinuousDayBuckets(
  data: BucketStats[],
  range: DashboardRange,
  bucket: ChartBucket,
): BucketStats[] {
  // Don't invent a full-zero domain during loading / truly empty series
  if (data.length === 0) return data;
  if (!shouldFillContinuousDays(range, bucket)) return data;
  const bounds = continuousDayBounds(range);
  if (!bounds) return data;

  const byDate = new Map<string, BucketStats>();
  for (const row of data) {
    byDate.set(normalizeBucketDate(row.date), {
      ...row,
      date: normalizeBucketDate(row.date),
    });
  }

  const out: BucketStats[] = [];
  const cur = parseYmdUtc(bounds.from);
  const end = parseYmdUtc(bounds.to);
  while (cur.getTime() <= end.getTime()) {
    const ymd = formatYmdUtc(cur);
    const existing = byDate.get(ymd);
    if (existing) {
      out.push(existing);
    } else {
      out.push({
        date: ymd,
        passed: 0,
        failed: 0,
        totalUnfiltered: 0,
        failedFiltered: 0,
      });
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * True when day-bucket data has calendar gaps (non-consecutive dates).
 * Used to label “Active test days only” when we do not continuous-fill.
 */
export function hasDayAxisGaps(data: BucketStats[]): boolean {
  if (data.length < 2) return false;
  const dates = data
    .map((r) => normalizeBucketDate(r.date))
    .sort();
  for (let i = 1; i < dates.length; i++) {
    const prev = parseYmdUtc(dates[i - 1]);
    const next = parseYmdUtc(dates[i]);
    const gapDays =
      Math.round((next.getTime() - prev.getTime()) / 86_400_000);
    if (gapDays > 1) return true;
  }
  return false;
}
