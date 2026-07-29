"use client";

import * as React from "react";
import {
  appendDashboardRangeParams,
  type DashboardRange,
} from "@/lib/dashboard-range";
import type { ChartBucket } from "@/lib/chart-theme";

export interface BucketStats {
  date: string;
  passed: number;
  failed: number;
  totalUnfiltered?: number;
  failedFiltered?: number;
}

/**
 * Fetch bucketed pass/fail series for a chart surface.
 * Volume chart and failure-rate strip call this separately so "Group by"
 * on volume does not redraw the strip (different bucket args).
 *
 * Stale-while-revalidate: after the first successful load, `loading` stays
 * false while refetching so charts stay mounted and only series data updates.
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
  /** True while a refetch is in flight with previous data still shown. */
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

  const [data, setData] = React.useState<BucketStats[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState(false);
  const hasDataRef = React.useRef(false);

  const epochRef = React.useRef(requestEpoch);
  epochRef.current = requestEpoch;

  React.useEffect(() => {
    if (!enabled) {
      if (!hasDataRef.current) setLoading(true);
      return;
    }

    const abort = new AbortController();
    const epochAtStart = requestEpoch;
    const isInitial = !hasDataRef.current;

    async function fetchStats() {
      try {
        if (isInitial) {
          setLoading(true);
        } else {
          setRefreshing(true);
        }
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
        if (abort.signal.aborted || epochRef.current !== epochAtStart) return;

        if (!response.ok) {
          // Keep previous series on soft refresh so the chart does not collapse
          if (isInitial) setData([]);
          setError(true);
          return;
        }

        const json: BucketStats[] = await response.json();
        if (abort.signal.aborted || epochRef.current !== epochAtStart) return;
        const next = Array.isArray(json) ? json : [];
        setData(next);
        hasDataRef.current = true;
      } catch (e) {
        if (abort.signal.aborted) return;
        console.error("Error fetching bucket stats:", e);
        if (isInitial) setData([]);
        setError(true);
      } finally {
        if (!abort.signal.aborted && epochRef.current === epochAtStart) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    fetchStats();
    return () => abort.abort();
  }, [
    dashboardRange,
    chartMode,
    annotationFilter,
    bucket,
    requestEpoch,
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
