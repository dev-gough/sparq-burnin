"use client";

import * as React from "react";
import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { DataTable, DataTableSkeleton } from "@/components/data-table";
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
import {
  loadDashboardPrefs,
  patchDashboardPrefs,
  prefsFromDashboardState,
} from "@/lib/dashboard-prefs";
import { bucketRange, type ChartBucket } from "@/lib/chart-theme";
import { useBucketStats } from "@/hooks/useBucketStats";

/**
 * SSR-safe defaults (no localStorage). Prefs are applied once after mount
 * so server HTML and the first client render match (avoids hydration mismatches).
 */
const SSR_DEFAULT_PILL: DashboardPill = "30d";
const SSR_DEFAULT_RANGE: DashboardRange = { kind: SSR_DEFAULT_PILL };

const PILL_KINDS: DashboardPill[] = ["7d", "30d", "90d", "all"];

function isDashboardPill(value: unknown): value is DashboardPill {
  return (
    typeof value === "string" &&
    (PILL_KINDS as string[]).includes(value)
  );
}

export default function Page() {
  const [dashboardRange, setDashboardRange] =
    React.useState<DashboardRange>(SSR_DEFAULT_RANGE);
  const [lastPill, setLastPill] =
    React.useState<DashboardPill>(SSR_DEFAULT_PILL);
  const [selectedDate, setSelectedDate] = React.useState<string>("");
  const [chartMode, setChartMode] = React.useState("recent");
  const [bucket, setBucket] = React.useState<ChartBucket>(() =>
    defaultBucketForDashboardRange(SSR_DEFAULT_RANGE),
  );
  const [filterLinked, setFilterLinked] = React.useState(true);
  const [requestEpoch, setRequestEpoch] = React.useState(0);

  // Defaults match SSR; localStorage restore runs in useEffect below
  const [annotationFilter, setAnnotationFilter] = React.useState<string>("all");
  const [statusFilter, setStatusFilter] = React.useState<string>("valid");

  // Empty until mount so server/client first paint match; then pill span or prefs
  const [tableDateFrom, setTableDateFrom] = React.useState<string>("");
  const [tableDateTo, setTableDateTo] = React.useState<string>("");
  /** True after unlinked multi-day chart drill (dashboard period unchanged). */
  const [bucketDrillUnlinked, setBucketDrillUnlinked] = React.useState(false);
  /** False until localStorage prefs applied — gates stats fetch. */
  const [filtersReady, setFiltersReady] = React.useState(false);

  // Apply persisted filters after mount (client-only localStorage)
  React.useEffect(() => {
    const saved = loadDashboardPrefs();
    const linked = saved.filterLinked !== false; // default true

    let nextRange: DashboardRange;
    let nextLastPill: DashboardPill = isDashboardPill(saved.lastPill)
      ? saved.lastPill
      : SSR_DEFAULT_PILL;

    if (
      saved.period === "custom" &&
      saved.customFrom &&
      saved.customTo &&
      saved.customFrom <= saved.customTo
    ) {
      nextRange = {
        kind: "custom",
        from: saved.customFrom,
        to: saved.customTo,
      };
    } else if (isDashboardPill(saved.period)) {
      nextRange = { kind: saved.period };
      nextLastPill = saved.period;
    } else {
      const init = resolveLinkedInitState(
        saved.dateFromFilter || "",
        saved.dateToFilter || "",
        SSR_DEFAULT_PILL,
      );
      nextRange = init.dashboardRange;
      nextLastPill = init.lastPill;
    }

    setDashboardRange(nextRange);
    setLastPill(nextLastPill);
    setFilterLinked(linked);

    if (nextRange.kind === "custom") {
      setTableDateFrom(
        linked ? nextRange.from : saved.dateFromFilter || nextRange.from,
      );
      setTableDateTo(
        linked ? nextRange.to : saved.dateToFilter || nextRange.to,
      );
    } else if (linked) {
      const span = tableDatesForPill(nextRange.kind);
      setTableDateFrom(span.from);
      setTableDateTo(span.to);
    } else {
      setTableDateFrom(saved.dateFromFilter || "");
      setTableDateTo(saved.dateToFilter || "");
    }

    setBucket(
      saved.bucket &&
        ["day", "week", "month", "quarter", "year"].includes(saved.bucket)
        ? saved.bucket
        : defaultBucketForDashboardRange(nextRange),
    );
    setChartMode(
      saved.chartMode === "all" || saved.chartMode === "recent"
        ? saved.chartMode
        : "recent",
    );
    setAnnotationFilter(saved.annotationFilter || "all");
    setStatusFilter(saved.statusFilter || "valid");
    setFiltersReady(true);
  }, []);

  // Persist command-center + shared filters whenever they change (after hydrate)
  React.useEffect(() => {
    if (!filtersReady) return;
    patchDashboardPrefs(
      prefsFromDashboardState({
        dashboardRange,
        lastPill,
        chartMode,
        bucket,
        filterLinked,
        annotationFilter,
        statusFilter,
        tableDateFrom,
        tableDateTo,
      }),
    );
  }, [
    filtersReady,
    dashboardRange,
    lastPill,
    chartMode,
    bucket,
    filterLinked,
    annotationFilter,
    statusFilter,
    tableDateFrom,
    tableDateTo,
  ]);

  /**
   * Failure-rate strip uses period-based bucketing only (smart default).
   * Volume "Group by" must not refetch/redraw the strip.
   */
  const stripBucket = React.useMemo(
    () => defaultBucketForDashboardRange(dashboardRange),
    [dashboardRange],
  );

  const {
    data: stripStats,
    loading: stripLoading,
    refreshing: stripRefreshing,
  } = useBucketStats({
    dashboardRange,
    chartMode,
    annotationFilter,
    bucket: stripBucket,
    requestEpoch,
    enabled: filtersReady,
  });

  const {
    data: volumeStats,
    loading: volumeLoading,
    refreshing: volumeRefreshing,
  } = useBucketStats({
    dashboardRange,
    chartMode,
    annotationFilter,
    bucket,
    requestEpoch,
    enabled: filtersReady,
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
              enabled={filtersReady}
            />

            <FailureRateStrip
              data={stripStats}
              loading={stripLoading || !filtersReady}
              refreshing={stripRefreshing}
              annotationFilter={annotationFilter}
              bucket={stripBucket}
            />

            <ChartAreaInteractive
              onDateClick={handleDateClick}
              chartMode={chartMode}
              dashboardRange={dashboardRange}
              annotationFilter={annotationFilter}
              highlightDate={highlightDate}
              bucket={bucket}
              onBucketChange={handleBucketChange}
              data={volumeStats}
              loading={volumeLoading || !filtersReady}
              refreshing={volumeRefreshing}
            />

            <AnnotationInsights
              dashboardRange={dashboardRange}
              chartMode={chartMode}
              annotationFilter={annotationFilter}
              onAnnotationFilterChange={setAnnotationFilter}
              requestEpoch={requestEpoch}
              enabled={filtersReady}
            />

            {filtersReady ? (
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
            ) : (
              <DataTableSkeleton />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
