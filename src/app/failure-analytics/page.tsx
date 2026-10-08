"use client";

import { useEffect, useRef, useState } from "react";
import { FailureAnalyticsHeader, type AnalyticsRange } from "@/components/dashboard/failure-analytics-header";
import { tableDatesForPill } from "@/lib/dashboard-range";
import { loadDashboardPrefs, patchDashboardPrefs, resolveDashboardInitState } from "@/lib/dashboard-prefs";
import { FailureAnalyticsContent, FailureAnalyticsSkeleton } from "@/components/dashboard/failure-analytics-content";
import type { FailureAnalyticsData } from "@/lib/failure-analytics";
import { Button } from "@/components/ui/button";

type PercentageMode = "all" | "failed";

export default function FailureAnalyticsPage() {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<FailureAnalyticsData | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [requestEpoch, setRequestEpoch] = useState(0);
  const [dataAsOf, setDataAsOf] = useState<Date | null>(null);
  const [percentageMode, setPercentageMode] = useState<PercentageMode>("failed");
  const [chartMode, setChartMode] = useState("recent"); // 'recent' or 'all'
  const [range, setRange] = useState<AnalyticsRange>({ kind: "all" });
  const [rangeReady, setRangeReady] = useState(false);

  useEffect(() => {
    const saved = loadDashboardPrefs();
    if (Object.keys(saved).length) setRange(resolveDashboardInitState(saved).dashboardRange);
    setRangeReady(true);
  }, []);

  const changeRange = (next: typeof range) => {
    setRange(next);
    setExpandedGroup(null);
    // The dashboard shares these preferences and mirrors them to its boot cookie.
    const shared = next;
    const dates = shared.kind === "custom" ? shared : tableDatesForPill(shared.kind);
    patchDashboardPrefs({
      period: shared.kind,
      customFrom: shared.kind === "custom" ? shared.from : "",
      customTo: shared.kind === "custom" ? shared.to : "",
      ...(shared.kind !== "custom" ? { lastPill: shared.kind } : {}),
      dateFromFilter: dates.from,
      dateToFilter: dates.to,
    });
  };
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  useEffect(() => {
    if (!rangeReady) return;
    const abort = new AbortController();
    const fetchData = async () => {
      setFetchError(false);
      // Only show full loading skeleton on initial load
      if (data === null) {
        setInitialLoading(true);
      } else {
        setRefetching(true);
      }

      try {
        const params = new URLSearchParams({
          chartMode,
          timeRange: range.kind === "custom" ? "all" : range.kind,
        });
        if (range.kind === "custom") {
          params.set("dateFrom", range.from);
          params.set("dateTo", range.to);
        }
        const response = await fetch(`/api/failure-analytics?${params}`, { signal: abort.signal });
        if (!response.ok) throw new Error("Failed to load failure analytics");
        const result: FailureAnalyticsData = await response.json();
        if (!abort.signal.aborted) {
          setData(result);
          setDataAsOf(new Date());
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          setFetchError(true);
          console.error("Error fetching failure analytics:", error);
        }
      } finally {
        if (!abort.signal.aborted) {
          setInitialLoading(false);
          setRefetching(false);
        }
      }
    };

    fetchData();
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartMode, range, rangeReady, requestEpoch]);

  const header = (
    <FailureAnalyticsHeader
      scrollContainerRef={scrollContainerRef}
      range={range}
      onRangeChange={changeRange}
      chartMode={chartMode}
      onChartModeChange={(mode) => {
        setChartMode(mode);
        setExpandedGroup(null);
      }}
      percentageMode={percentageMode}
      onPercentageModeChange={setPercentageMode}
      ready={rangeReady}
      updatedAt={dataAsOf}
    />
  );

  return (
    <div ref={scrollContainerRef} className="failure-analytics-home ml-0 md:ml-10 flex h-[calc(100dvh-3.5rem)] md:h-dvh flex-col overflow-hidden">
      {header}
      <div className="failure-analytics-scroll flex-1 overflow-y-auto" aria-busy={initialLoading || refetching}>
        {fetchError && (
          <div role="alert" className="mx-4 mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm lg:mx-6">
            <p>{data ? "Couldn’t refresh this period. Showing the last loaded results." : "Couldn’t load failure analytics."}</p>
            <Button variant="outline" size="sm" onClick={() => setRequestEpoch(epoch => epoch + 1)}>Try again</Button>
          </div>
        )}
        {initialLoading ? (
          <FailureAnalyticsSkeleton range={range} chartMode={chartMode} percentageMode={percentageMode} />
        ) : data ? (
          <div className={`transition-opacity duration-200 ${refetching ? "pointer-events-none opacity-50" : "opacity-100"}`}>
            <FailureAnalyticsContent data={data} range={range} chartMode={chartMode} percentageMode={percentageMode} expandedGroup={expandedGroup} onGroupChange={setExpandedGroup} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
