"use client";

import * as React from "react";
import type { DashboardRange } from "@/lib/dashboard-range";

export function useTestOutcomes({ dashboardRange, chartMode, annotationFilter, stationFilter, requestEpoch, enabled }: {
  dashboardRange?: DashboardRange; chartMode: string; annotationFilter: string;
  stationFilter: string; requestEpoch: number; enabled: boolean;
}) {
  const params = new URLSearchParams({ view: "test-outcomes", chartMode, annotation: annotationFilter, station: stationFilter,
    timeRange: dashboardRange?.kind === "custom" ? "all" : dashboardRange?.kind ?? "all" });
  if (dashboardRange?.kind === "custom") {
    params.set("dateFrom", dashboardRange.from);
    params.set("dateTo", dashboardRange.to);
  }
  const query = params.toString();
  const key = `${query}:${requestEpoch}`;
  const [result, setResult] = React.useState<{ key: string; outcomes: string; error: boolean } | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    fetch(`/api/test-stats?${query}`, { signal: abort.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Failed to load test outcomes");
        const body = await response.json();
        if (typeof body.outcomes !== "string" || /[^PF]/.test(body.outcomes)) throw new Error("Invalid test outcomes");
        if (!abort.signal.aborted) setResult({ key, outcomes: body.outcomes, error: false });
      })
      .catch(() => {
        if (!abort.signal.aborted) setResult({ key, outcomes: "", error: true });
      });
    return () => abort.abort();
  }, [query, key, enabled]);
  const current = result?.key === key ? result : null;
  return { outcomes: current?.outcomes ?? "", loading: enabled && !current, error: current?.error ?? false };
}
