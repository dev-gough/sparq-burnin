"use client";

import * as React from "react";
import {
  appendDashboardRangeParams,
  type DashboardRange,
} from "@/lib/dashboard-range";

/**
 * Fast EXISTS probe: does this period (and optional annotation filter)
 * contain any non-INVALID tests? Used to choose empty-state vs full dashboard
 * before mounting heavy chart/KPI fetches.
 */
export function usePeriodHasData(opts: {
  dashboardRange: DashboardRange;
  annotationFilter: string;
  requestEpoch: number;
  enabled?: boolean;
}): {
  /** null while the probe is in flight */
  hasData: boolean | null;
  probing: boolean;
} {
  const {
    dashboardRange,
    annotationFilter,
    requestEpoch,
    enabled = true,
  } = opts;

  const [hasData, setHasData] = React.useState<boolean | null>(null);
  const [probing, setProbing] = React.useState(true);

  const epochRef = React.useRef(requestEpoch);
  epochRef.current = requestEpoch;

  React.useEffect(() => {
    if (!enabled) {
      setProbing(true);
      return;
    }

    const abort = new AbortController();
    const epochAtStart = requestEpoch;

    // Keep previous hasData while probing (stale-while-revalidate) so the
    // dashboard shell does not unmount / re-animate mid-transition.
    setProbing(true);

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
        if (abort.signal.aborted || epochRef.current !== epochAtStart) return;

        if (!response.ok) {
          // Fail open: allow full dashboard load rather than false empty
          setHasData(true);
          return;
        }

        const json = (await response.json()) as { hasData?: boolean };
        if (abort.signal.aborted || epochRef.current !== epochAtStart) return;
        setHasData(Boolean(json.hasData));
      } catch (e) {
        if (abort.signal.aborted) return;
        console.error("has-data probe failed:", e);
        setHasData(true);
      } finally {
        if (!abort.signal.aborted && epochRef.current === epochAtStart) {
          setProbing(false);
        }
      }
    }

    probe();
    return () => abort.abort();
  }, [dashboardRange, annotationFilter, requestEpoch, enabled]);

  return { hasData, probing };
}
