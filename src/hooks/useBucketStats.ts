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
 * Single shared fetch for volume chart + failure-rate strip
 * (same range/mode/annotation/bucket — avoid double chart-query load).
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
  loading: boolean;
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
  const [error, setError] = React.useState(false);

  // Ref tracks latest epoch so post-await checks can detect stale responses
  const epochRef = React.useRef(requestEpoch);
  epochRef.current = requestEpoch;

  React.useEffect(() => {
    if (!enabled) {
      setLoading(true);
      return;
    }

    const abort = new AbortController();
    const epochAtStart = requestEpoch;

    async function fetchStats() {
      try {
        setLoading(true);
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
          setData([]);
          setError(true);
          return;
        }

        const json: BucketStats[] = await response.json();
        if (abort.signal.aborted || epochRef.current !== epochAtStart) return;
        setData(Array.isArray(json) ? json : []);
      } catch (e) {
        if (abort.signal.aborted) return;
        console.error("Error fetching bucket stats:", e);
        setData([]);
        setError(true);
      } finally {
        if (!abort.signal.aborted && epochRef.current === epochAtStart) {
          setLoading(false);
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

  return { data, loading, error };
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
