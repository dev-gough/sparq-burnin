"use client";

import * as React from "react";
import {
  appendDashboardRangeParams,
  type DashboardRange,
} from "@/lib/dashboard-range";

function buildRequestKey(opts: {
  dashboardRange: DashboardRange;
  annotationFilter: string;
  requestEpoch: number;
  enabled: boolean;
}): string {
  const { dashboardRange, annotationFilter, requestEpoch, enabled } = opts;
  return JSON.stringify({
    enabled,
    annotationFilter,
    requestEpoch,
    kind: dashboardRange.kind,
    from: dashboardRange.kind === "custom" ? dashboardRange.from : null,
    to: dashboardRange.kind === "custom" ? dashboardRange.to : null,
  });
}

/**
 * Fast EXISTS probe: does this period (and optional annotation filter)
 * contain any non-INVALID tests? Used to choose empty-state vs full dashboard
 * before mounting heavy chart/KPI fetches.
 *
 * `hasData` is only definitive for the *current* request key:
 * - true / false — probe finished for this period
 * - null — initial load or period just changed (probe in flight)
 *
 * Returning null while the key is stale avoids flashing the previous empty
 * state when switching 7d (empty) → 30d (has data).
 */
export function usePeriodHasData(opts: {
  dashboardRange: DashboardRange;
  annotationFilter: string;
  requestEpoch: number;
  enabled?: boolean;
}): {
  /** null while the current period is unknown / probing */
  hasData: boolean | null;
  probing: boolean;
} {
  const {
    dashboardRange,
    annotationFilter,
    requestEpoch,
    enabled = true,
  } = opts;

  const requestKey = React.useMemo(
    () =>
      buildRequestKey({
        dashboardRange,
        annotationFilter,
        requestEpoch,
        enabled,
      }),
    [dashboardRange, annotationFilter, requestEpoch, enabled],
  );

  const [result, setResult] = React.useState<{
    key: string;
    hasData: boolean;
  } | null>(null);

  const requestKeyRef = React.useRef(requestKey);
  requestKeyRef.current = requestKey;

  // Synchronous: null as soon as period/annotation changes, not after useEffect
  const hasData =
    !enabled
      ? null
      : result && result.key === requestKey
        ? result.hasData
        : null;

  const probing = enabled && hasData === null;

  React.useEffect(() => {
    if (!enabled) return;

    const abort = new AbortController();
    const keyAtStart = requestKey;

    async function probe() {
      try {
        const params = new URLSearchParams({ view: "has-data" });
        appendDashboardRangeParams(params, dashboardRange);
        if (annotationFilter && annotationFilter !== "all") {
          params.set("annotation", annotationFilter);
        }

        const response = await fetch(`/api/test-stats?${params}`, {
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        if (requestKeyRef.current !== keyAtStart) return;

        if (!response.ok) {
          // Fail open: allow full dashboard load rather than false empty
          setResult({ key: keyAtStart, hasData: true });
          return;
        }

        const json = (await response.json()) as { hasData?: boolean };
        if (abort.signal.aborted) return;
        if (requestKeyRef.current !== keyAtStart) return;
        setResult({ key: keyAtStart, hasData: Boolean(json.hasData) });
      } catch (e) {
        if (abort.signal.aborted) return;
        if (requestKeyRef.current !== keyAtStart) return;
        console.error("has-data probe failed:", e);
        setResult({ key: keyAtStart, hasData: true });
      }
    }

    probe();
    return () => abort.abort();
  }, [requestKey, dashboardRange, annotationFilter, enabled]);

  return { hasData, probing };
}
