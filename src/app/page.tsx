"use client";

import * as React from "react";
import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { DataTable } from "@/components/data-table";
import { AnnotationInsights } from "@/components/dashboard/annotation-insights";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { FailureRateStrip } from "@/components/dashboard/failure-rate-strip";
import { HeroMetrics } from "@/components/dashboard/hero-metrics";
import {
  type DashboardPill,
  type DashboardRange,
  defaultBucketForDashboardRange,
  resolveLinkedInitState,
  tableDatesForPill,
} from "@/lib/dashboard-range";
import { bucketRange, type ChartBucket } from "@/lib/chart-theme";
import { useBucketStats } from "@/hooks/useBucketStats";

const FILTER_COOKIE_KEY = "burnin-data-table-filters";

const loadFiltersFromCookie = (): Record<string, unknown> => {
  try {
    if (typeof document === "undefined") return {};

    const cookies = document.cookie.split(";");
    const filterCookie = cookies.find((cookie) =>
      cookie.trim().startsWith(`${FILTER_COOKIE_KEY}=`),
    );

    if (!filterCookie) return {};

    const cookieValue = filterCookie.split("=")[1];
    const decodedValue = decodeURIComponent(cookieValue);
    return JSON.parse(decodedValue);
  } catch (error) {
    console.warn("Failed to load filters from cookie:", error);
    return {};
  }
};

function readLinkedInit() {
  const saved = loadFiltersFromCookie();
  return resolveLinkedInitState(
    (saved.dateFromFilter as string) || "",
    (saved.dateToFilter as string) || "",
    "30d",
  );
}

export default function Page() {
  // Linked default: init dashboard + table dates together so they never disagree
  const [init] = React.useState(readLinkedInit);

  const [dashboardRange, setDashboardRange] = React.useState<DashboardRange>(
    () => init.dashboardRange,
  );
  const [lastPill, setLastPill] = React.useState<DashboardPill>(
    () => init.lastPill,
  );
  const [selectedDate, setSelectedDate] = React.useState<string>("");
  const [chartMode, setChartMode] = React.useState("recent");
  const [bucket, setBucket] = React.useState<ChartBucket>(() =>
    defaultBucketForDashboardRange(init.dashboardRange),
  );
  const [filterLinked, setFilterLinked] = React.useState(true);
  const [requestEpoch, setRequestEpoch] = React.useState(0);

  const [annotationFilter, setAnnotationFilter] = React.useState<string>(() => {
    const saved = loadFiltersFromCookie();
    return (saved.annotationFilter as string) || "all";
  });

  const [statusFilter, setStatusFilter] = React.useState<string>(() => {
    const saved = loadFiltersFromCookie();
    return (saved.statusFilter as string) || "valid";
  });

  const [tableDateFrom, setTableDateFrom] = React.useState<string>(
    () => init.tableDateFrom,
  );
  const [tableDateTo, setTableDateTo] = React.useState<string>(
    () => init.tableDateTo,
  );
  /** True after unlinked multi-day chart drill (dashboard period unchanged). */
  const [bucketDrillUnlinked, setBucketDrillUnlinked] = React.useState(false);

  // Shared bucket series for volume chart + rate strip (one API call)
  const {
    data: bucketStats,
    loading: bucketLoading,
  } = useBucketStats({
    dashboardRange,
    chartMode,
    annotationFilter,
    bucket,
    requestEpoch,
  });

  const bumpEpoch = React.useCallback(() => {
    setRequestEpoch((e) => e + 1);
  }, []);

  const applySmartBucket = React.useCallback((range: DashboardRange) => {
    setBucket(defaultBucketForDashboardRange(range));
  }, []);

  const handlePeriodPill = React.useCallback(
    (kind: DashboardPill) => {
      setDashboardRange({ kind });
      setLastPill(kind);
      setSelectedDate("");
      setBucketDrillUnlinked(false);
      applySmartBucket({ kind });
      bumpEpoch();
      if (filterLinked) {
        const { from, to } = tableDatesForPill(kind);
        setTableDateFrom(from);
        setTableDateTo(to);
      }
    },
    [filterLinked, applySmartBucket, bumpEpoch],
  );

  const handleCustomRange = React.useCallback(
    (from: string, to: string) => {
      setDashboardRange({ kind: "custom", from, to });
      setSelectedDate("");
      setBucketDrillUnlinked(false);
      applySmartBucket({ kind: "custom", from, to });
      bumpEpoch();
      if (filterLinked) {
        setTableDateFrom(from);
        setTableDateTo(to);
      }
    },
    [filterLinked, applySmartBucket, bumpEpoch],
  );

  const tableDatesRef = React.useRef({ from: tableDateFrom, to: tableDateTo });
  React.useEffect(() => {
    tableDatesRef.current = { from: tableDateFrom, to: tableDateTo };
  }, [tableDateFrom, tableDateTo]);

  const promoteFromTableDates = React.useCallback(
    (from: string, to: string) => {
      if (!filterLinked) return;
      if (!from && !to) {
        setDashboardRange({ kind: lastPill });
        applySmartBucket({ kind: lastPill });
        bumpEpoch();
        return;
      }
      const start = from || to;
      const end = to || from;
      setDashboardRange({ kind: "custom", from: start, to: end });
      applySmartBucket({ kind: "custom", from: start, to: end });
      bumpEpoch();
    },
    [filterLinked, lastPill, applySmartBucket, bumpEpoch],
  );

  const handleTableDateFromChange = React.useCallback(
    (from: string) => {
      setSelectedDate("");
      setBucketDrillUnlinked(false);
      setTableDateFrom(from);
      tableDatesRef.current = { ...tableDatesRef.current, from };
      promoteFromTableDates(from, tableDatesRef.current.to);
    },
    [promoteFromTableDates],
  );

  const handleTableDateToChange = React.useCallback(
    (to: string) => {
      setSelectedDate("");
      setBucketDrillUnlinked(false);
      setTableDateTo(to);
      tableDatesRef.current = { ...tableDatesRef.current, to };
      promoteFromTableDates(tableDatesRef.current.from, to);
    },
    [promoteFromTableDates],
  );

  /**
   * Chart bar/point click:
   * - day: table dates only (selectedDate); never promote dashboard
   * - non-day: bucketRange() → table dates; if filterLinked also promote
   *   dashboardRange to that custom span (unlinked: table only)
   */
  const handleDateClick = React.useCallback(
    (date: string) => {
      if (bucket === "day") {
        setSelectedDate(date);
        setTableDateFrom(date);
        setTableDateTo(date);
        setBucketDrillUnlinked(false);
        return;
      }
      const { from, to } = bucketRange(date, bucket);
      setSelectedDate("");
      setTableDateFrom(from);
      setTableDateTo(to);
      if (filterLinked) {
        setBucketDrillUnlinked(false);
        setDashboardRange({ kind: "custom", from, to });
        applySmartBucket({ kind: "custom", from, to });
        bumpEpoch();
      } else {
        setBucketDrillUnlinked(true);
      }
    },
    [bucket, filterLinked, applySmartBucket, bumpEpoch],
  );

  const handleClearDateFilter = React.useCallback(() => {
    setSelectedDate("");
    setBucketDrillUnlinked(false);
    if (filterLinked) {
      if (dashboardRange.kind === "custom") {
        setDashboardRange({ kind: lastPill });
        applySmartBucket({ kind: lastPill });
        bumpEpoch();
        const { from, to } = tableDatesForPill(lastPill);
        setTableDateFrom(from);
        setTableDateTo(to);
      } else {
        const { from, to } = tableDatesForPill(dashboardRange.kind);
        setTableDateFrom(from);
        setTableDateTo(to);
      }
    } else {
      setTableDateFrom("");
      setTableDateTo("");
    }
  }, [filterLinked, dashboardRange, lastPill, applySmartBucket, bumpEpoch]);

  const handleBucketChange = React.useCallback((next: ChartBucket) => {
    setBucket(next);
    if (next !== "day") {
      setSelectedDate("");
    }
  }, []);

  const handleFailuresClick = React.useCallback(() => {
    setStatusFilter("FAIL");
    requestAnimationFrame(() => {
      document
        .getElementById("test-table")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  const isSingleDayFilter =
    tableDateFrom && tableDateTo && tableDateFrom === tableDateTo;
  const highlightDate =
    selectedDate || (isSingleDayFilter ? tableDateFrom : "");
  const dayDrillActive = Boolean(selectedDate);

  return (
    <div className="ml-10">
      <DashboardHeader
        dashboardRange={dashboardRange}
        onPeriodPill={handlePeriodPill}
        onCustomRange={handleCustomRange}
        chartMode={chartMode}
        onChartModeChange={setChartMode}
        filterLinked={filterLinked}
        onFilterLinkedChange={setFilterLinked}
      />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="mx-auto flex w-full flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6 4xl:gap-8 4xl:px-8 5xl:gap-10 5xl:px-12">
            {/* Day-drill chip: linked stays on, but table dates ≠ dashboard period */}
            {dayDrillActive && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">
                  Table: {selectedDate}
                </span>
                <span>· dashboard period unchanged</span>
                <button
                  type="button"
                  className="ml-auto text-primary underline-offset-2 hover:underline"
                  onClick={handleClearDateFilter}
                >
                  Clear day filter
                </button>
              </div>
            )}

            {/* Unlinked multi-day bucket drill: table dates only */}
            {!dayDrillActive &&
              bucketDrillUnlinked &&
              tableDateFrom &&
              tableDateTo && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Table: {tableDateFrom} – {tableDateTo}
                  </span>
                  <span>· dashboard period unchanged</span>
                  <button
                    type="button"
                    className="ml-auto text-primary underline-offset-2 hover:underline"
                    onClick={handleClearDateFilter}
                  >
                    Clear table dates
                  </button>
                </div>
              )}

            <HeroMetrics
              dashboardRange={dashboardRange}
              chartMode={chartMode}
              annotationFilter={annotationFilter}
              requestEpoch={requestEpoch}
              onFailuresClick={handleFailuresClick}
            />

            <FailureRateStrip
              data={bucketStats}
              loading={bucketLoading}
              annotationFilter={annotationFilter}
              bucket={bucket}
            />

            <ChartAreaInteractive
              onDateClick={handleDateClick}
              chartMode={chartMode}
              dashboardRange={dashboardRange}
              annotationFilter={annotationFilter}
              highlightDate={highlightDate}
              bucket={bucket}
              onBucketChange={handleBucketChange}
              data={bucketStats}
              loading={bucketLoading}
            />

            <AnnotationInsights
              dashboardRange={dashboardRange}
              chartMode={chartMode}
              annotationFilter={annotationFilter}
              onAnnotationFilterChange={setAnnotationFilter}
              requestEpoch={requestEpoch}
            />

            <DataTable
              onClearDateFilter={handleClearDateFilter}
              annotationFilter={annotationFilter}
              onAnnotationFilterChange={setAnnotationFilter}
              filterLinked={filterLinked}
              onFilterLinkedChange={setFilterLinked}
              dateFromFilter={tableDateFrom}
              onDateFromFilterChange={handleTableDateFromChange}
              dateToFilter={tableDateTo}
              onDateToFilterChange={handleTableDateToChange}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
