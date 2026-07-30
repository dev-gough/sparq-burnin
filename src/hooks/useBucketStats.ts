"use client";

import * as React from "react";
import {
  defaultBucketForDashboardRange,
  tableDatesForPill,
  type DashboardPill,
  type DashboardRange,
} from "@/lib/dashboard-range";
import type { ChartBucket } from "@/lib/chart-theme";
import {
  formatYmdUtc,
  inclusiveDayLength,
  parseYmdUtc,
} from "@/lib/stats-windows";
import {
  getCachedBucketStats,
  loadBucketStats,
  prefetchBucketStats,
  scheduleSiblingPillPrefetch,
  subscribeBucketStatsCache,
  type BucketStatsFetchKey,
  type BucketStatsRow,
} from "@/lib/bucket-stats-cache";

export type BucketStats = BucketStatsRow;

/** Stable identity for the desired series (not gated on `enabled`). */
function buildRequestKey(opts: {
  dashboardRange: DashboardRange;
  chartMode: string;
  annotationFilter: string;
  bucket: ChartBucket;
  requestEpoch: number;
}): string {
  const { dashboardRange, chartMode, annotationFilter, bucket, requestEpoch } =
    opts;
  return JSON.stringify({
    chartMode,
    annotationFilter,
    bucket,
    requestEpoch,
    kind: dashboardRange.kind,
    from: dashboardRange.kind === "custom" ? dashboardRange.from : null,
    to: dashboardRange.kind === "custom" ? dashboardRange.to : null,
  });
}

function toFetchKey(opts: {
  dashboardRange: DashboardRange;
  chartMode: string;
  annotationFilter: string;
  bucket: ChartBucket;
}): BucketStatsFetchKey {
  return {
    dashboardRange: opts.dashboardRange,
    chartMode: opts.chartMode,
    annotationFilter: opts.annotationFilter,
    bucket: opts.bucket,
  };
}

/**
 * Fetch bucketed pass/fail series for a chart surface.
 * Volume chart and failure-rate strip call this separately so "Group by"
 * on volume does not redraw the strip (different bucket args).
 *
 * Shared module cache + in-flight dedupe:
 * - strip + volume with the same key share one network call
 * - revisiting a cached key paints immediately (no soft-hold flash)
 * - after a successful load, other period pills are prefetched on idle
 *
 * Stale-while-revalidate: after the first successful load, previous series
 * stay mounted while a new uncached range/bucket is fetched.
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
  /**
   * When true, after a successful load warm the other executive pills
   * using the same bucket (volume chart). Default false.
   */
  prefetchSiblingPills?: boolean;
  /**
   * When true with prefetchSiblingPills, each sibling uses the strip's
   * smart default bucket for that pill (not the current bucket).
   */
  prefetchSmartBucketPerPill?: boolean;
}): {
  data: BucketStats[];
  /** True only on the initial load (no data yet). */
  loading: boolean;
  /** True while shown data belongs to a previous request key. */
  refreshing: boolean;
  error: boolean;
  /** Warm cache for a period pill (e.g. hover intent). */
  prefetchPill: (kind: DashboardPill) => void;
} {
  const {
    dashboardRange,
    chartMode,
    annotationFilter,
    bucket,
    requestEpoch,
    enabled = true,
    prefetchSiblingPills = false,
    prefetchSmartBucketPerPill = false,
  } = opts;

  const fetchKey = React.useMemo(
    () =>
      toFetchKey({
        dashboardRange,
        chartMode,
        annotationFilter,
        bucket,
      }),
    [dashboardRange, chartMode, annotationFilter, bucket],
  );

  const requestKey = React.useMemo(
    () =>
      buildRequestKey({
        dashboardRange,
        chartMode,
        annotationFilter,
        bucket,
        requestEpoch,
      }),
    [dashboardRange, chartMode, annotationFilter, bucket, requestEpoch],
  );

  /**
   * External cache via useSyncExternalStore:
   * - getServerSnapshot always null → SSR + hydration match
   * - after hydrate, client snapshot can be warm (instant period switches)
   * - cache writes notify subscribers so strip/volume stay in sync
   */
  const cachedFromStore = React.useSyncExternalStore(
    subscribeBucketStatsCache,
    () => (enabled ? (getCachedBucketStats(fetchKey) ?? null) : null),
    () => null,
  );

  const [data, setData] = React.useState<BucketStats[]>([]);
  /** Request key that `data` was loaded for; null until first successful load. */
  const [dataKey, setDataKey] = React.useState<string | null>(null);
  const [error, setError] = React.useState(false);

  const requestKeyRef = React.useRef(requestKey);
  requestKeyRef.current = requestKey;
  const dataKeyRef = React.useRef(dataKey);
  dataKeyRef.current = dataKey;

  // When the store has a hit for this key, mirror into local state so
  // requestKey / dataKey stay aligned for loading flags.
  React.useLayoutEffect(() => {
    if (!enabled || cachedFromStore === null) return;
    setData(cachedFromStore);
    setDataKey(requestKey);
    setError(false);
  }, [enabled, cachedFromStore, requestKey]);

  // Synchronous flags (same render as range/bucket/epoch changes).
  // Prefer store cache for the *current* fetch key so period flips skip
  // soft-hold when prefetched/cached (client-only; null during SSR/hydrate).
  const cacheHit = cachedFromStore !== null;
  const effectiveData = cacheHit ? cachedFromStore : data;
  const effectiveDataKey = cacheHit ? requestKey : dataKey;

  const hasSeries = effectiveData.length > 0;
  const keyMismatch =
    effectiveDataKey !== null && effectiveDataKey !== requestKey;
  const loading =
    enabled &&
    (effectiveDataKey === null || (keyMismatch && !hasSeries));
  const refreshing = keyMismatch && hasSeries;

  // When disabled with no series (confirmed empty / prefs), drop the stale
  // dataKey so the next enable is a clean first load.
  React.useEffect(() => {
    if (!enabled && !hasSeries && dataKey !== null) {
      setDataKey(null);
    }
  }, [enabled, hasSeries, dataKey]);

  React.useEffect(() => {
    if (!enabled) return;

    const keyAtStart = requestKey;
    let cancelled = false;
    let cancelPrefetch: (() => void) | undefined;

    async function fetchStats() {
      try {
        setError(false);
        // Cache-first; concurrent strip+volume callers share one in-flight fetch.
        const next = await loadBucketStats(fetchKey);
        if (cancelled) return;
        if (requestKeyRef.current !== keyAtStart) return;

        setData(next);
        setDataKey(keyAtStart);

        if (prefetchSiblingPills) {
          cancelPrefetch = scheduleSiblingPillPrefetch({
            currentRange: dashboardRange,
            chartMode,
            annotationFilter,
            bucket,
            useSmartBucketPerPill: prefetchSmartBucketPerPill,
          });
        }
      } catch (e) {
        if (cancelled) return;
        if (requestKeyRef.current !== keyAtStart) return;
        // Cache hit already painted — don't surface a background revalidate error
        if (getCachedBucketStats(fetchKey) !== undefined) {
          setDataKey(keyAtStart);
          return;
        }
        console.error("Error fetching bucket stats:", e);
        setError(true);
        if (dataKeyRef.current === null) setData([]);
        setDataKey(keyAtStart);
      }
    }

    void fetchStats();
    return () => {
      cancelled = true;
      cancelPrefetch?.();
    };
  }, [
    requestKey,
    fetchKey,
    dashboardRange,
    chartMode,
    annotationFilter,
    bucket,
    enabled,
    prefetchSiblingPills,
    prefetchSmartBucketPerPill,
  ]);

  const prefetchPill = React.useCallback(
    (kind: DashboardPill) => {
      const range: DashboardRange = { kind };
      const nextBucket = prefetchSmartBucketPerPill
        ? defaultBucketForDashboardRange(range)
        : bucket;
      prefetchBucketStats({
        dashboardRange: range,
        chartMode,
        annotationFilter,
        bucket: nextBucket,
      });
    },
    [chartMode, annotationFilter, bucket, prefetchSmartBucketPerPill],
  );

  return {
    data: effectiveData,
    loading,
    refreshing,
    error,
    prefetchPill,
  };
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
