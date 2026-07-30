"use client";

import * as React from "react";
import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { DataTable, DataTableSkeleton } from "@/components/data-table";
import { AnnotationInsights } from "@/components/dashboard/annotation-insights";
import { DashboardEmptyState } from "@/components/dashboard/dashboard-empty-state";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { FailureRateStrip } from "@/components/dashboard/failure-rate-strip";
import { HeroMetrics } from "@/components/dashboard/hero-metrics";
import {
  type DashboardPill,
  type DashboardRange,
  allowedBucketsForRange,
  defaultBucketForDashboardRange,
  tableDatesForPill,
} from "@/lib/dashboard-range";
import {
  type DashboardPrefs,
  hasDashboardBootPrefs,
  loadDashboardPrefs,
  patchDashboardPrefs,
  prefsFromDashboardState,
  resolveDashboardInitState,
  saveDashboardPrefs,
  writeDashboardBootCookie,
} from "@/lib/dashboard-prefs";
import { bucketRange, type ChartBucket } from "@/lib/chart-theme";
import { useBucketStats } from "@/hooks/useBucketStats";
import { usePeriodHasData } from "@/hooks/usePeriodHasData";
import { prefetchSummaryPill } from "@/lib/summary-stats-cache";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export type DashboardHomeProps = {
  /**
   * Prefs mirrored from the boot cookie (server-read). Same object is used
   * for the first client render so SSR HTML already shows All / All tests etc.
   */
  boot?: Partial<DashboardPrefs>;
};

export function DashboardHome({ boot = {} }: DashboardHomeProps) {
  // Capture boot-derived state once. localStorage remains source of truth and
  // is reconciled in layoutEffect (also seeds the cookie for users who only
  // had localStorage before this change).
  const [initial] = React.useState(() => resolveDashboardInitState(boot));
  const bootReady = hasDashboardBootPrefs(boot);

  const [dashboardRange, setDashboardRange] =
    React.useState<DashboardRange>(initial.dashboardRange);
  const [lastPill, setLastPill] = React.useState<DashboardPill>(
    initial.lastPill,
  );
  const [selectedDate, setSelectedDate] = React.useState<string>("");
  const [chartMode, setChartMode] = React.useState<"all" | "recent">(
    initial.chartMode,
  );
  const [bucket, setBucket] = React.useState<ChartBucket>(initial.bucket);
  const [filterLinked, setFilterLinked] = React.useState(initial.filterLinked);
  const [requestEpoch, setRequestEpoch] = React.useState(0);

  const [annotationFilter, setAnnotationFilter] = React.useState<string>(
    initial.annotationFilter,
  );
  const [statusFilter, setStatusFilter] = React.useState<string>(
    initial.statusFilter,
  );

  const [tableDateFrom, setTableDateFrom] = React.useState<string>(
    initial.tableDateFrom,
  );
  const [tableDateTo, setTableDateTo] = React.useState<string>(
    initial.tableDateTo,
  );
  /** True after unlinked multi-day chart drill (dashboard period unchanged). */
  const [bucketDrillUnlinked, setBucketDrillUnlinked] = React.useState(false);
  /**
   * When the boot cookie already carries period/mode, we can paint + fetch
   * immediately. Otherwise wait for the localStorage reconcile below.
   */
  const [filtersReady, setFiltersReady] = React.useState(bootReady);
  /** Controlled More sheet (empty-state Custom range, etc.). */
  const [moreOpen, setMoreOpen] = React.useState(false);
  /** O31: last time volume/strip data finished loading for the current view. */
  const [dataAsOf, setDataAsOf] = React.useState<Date | null>(null);

  // Reconcile with localStorage (source of truth) before paint. When boot
  // already matched, this is a no-visual-op and only refreshes the cookie.
  React.useLayoutEffect(() => {
    const saved = loadDashboardPrefs();
    if (Object.keys(saved).length > 0) {
      const next = resolveDashboardInitState(saved);
      setDashboardRange(next.dashboardRange);
      setLastPill(next.lastPill);
      setFilterLinked(next.filterLinked);
      setTableDateFrom(next.tableDateFrom);
      setTableDateTo(next.tableDateTo);
      setBucket(next.bucket);
      setChartMode(next.chartMode);
      setAnnotationFilter(next.annotationFilter);
      setStatusFilter(next.statusFilter);
      // Keep boot cookie in sync (migrates users who only had localStorage).
      writeDashboardBootCookie(saved);
    } else if (bootReady) {
      // Cookie existed but localStorage empty (cleared / private mode edge) —
      // seed localStorage from boot so subsequent visits stay consistent.
      saveDashboardPrefs(boot);
    }
    setFiltersReady(true);
  }, [boot, bootReady]);

  // Persist command-center + shared filters whenever they change (after ready)
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
   * Fast EXISTS probe before mounting heavy KPI/chart fetches.
   * Gates empty-state vs skeleton/content path.
   */
  const { hasData } = usePeriodHasData({
    dashboardRange,
    annotationFilter,
    requestEpoch,
    enabled: filtersReady,
  });

  /**
   * Load charts unless the period is *confirmed* empty.
   * While hasData is null (probe in flight), keep fetches enabled so range
   * switches start the new series immediately and never unfreeze charts into
   * a continuous-filled stale paint (see useBucketStats `refreshing`).
   */
  const loadDashboardData = filtersReady && hasData !== false;

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
    prefetchPill: prefetchStripPill,
  } = useBucketStats({
    dashboardRange,
    chartMode,
    annotationFilter,
    bucket: stripBucket,
    requestEpoch,
    enabled: loadDashboardData,
    // Warm other pills with per-range smart buckets (strip defaults).
    prefetchSiblingPills: true,
    prefetchSmartBucketPerPill: true,
  });

  const {
    data: volumeStats,
    loading: volumeLoading,
    refreshing: volumeRefreshing,
    prefetchPill: prefetchVolumePill,
  } = useBucketStats({
    dashboardRange,
    chartMode,
    annotationFilter,
    bucket,
    requestEpoch,
    enabled: loadDashboardData,
    // Warm other pills with the current volume Group-by bucket.
    prefetchSiblingPills: true,
  });

  /** Hover intent: warm summary + strip + volume for a period pill. */
  const handlePeriodPillPrefetch = React.useCallback(
    (kind: DashboardPill) => {
      prefetchSummaryPill(kind, { chartMode, annotationFilter });
      prefetchStripPill(kind);
      prefetchVolumePill(kind);
    },
    [
      chartMode,
      annotationFilter,
      prefetchStripPill,
      prefetchVolumePill,
    ],
  );

  const bumpEpoch = React.useCallback(() => {
    setRequestEpoch((e) => e + 1);
  }, []);

  // Volume "Group by" is user-controlled only (persisted). Do not auto-switch
  // bucket when the period pill / custom range changes — that forced Day→Week
  // etc. and made range changes feel jumpy. (Failure-rate strip still uses a
  // period-based smart bucket via stripBucket below.)

  const handlePeriodPill = React.useCallback(
    (kind: DashboardPill) => {
      setDashboardRange({ kind });
      setLastPill(kind);
      setSelectedDate("");
      setBucketDrillUnlinked(false);
      bumpEpoch();
      if (filterLinked) {
        const { from, to } = tableDatesForPill(kind);
        setTableDateFrom(from);
        setTableDateTo(to);
      }
    },
    [filterLinked, bumpEpoch],
  );

  const handleCustomRange = React.useCallback(
    (from: string, to: string) => {
      setDashboardRange({ kind: "custom", from, to });
      setSelectedDate("");
      setBucketDrillUnlinked(false);
      bumpEpoch();
      if (filterLinked) {
        setTableDateFrom(from);
        setTableDateTo(to);
      }
    },
    [filterLinked, bumpEpoch],
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
        bumpEpoch();
        return;
      }
      const start = from || to;
      const end = to || from;
      setDashboardRange({ kind: "custom", from: start, to: end });
      bumpEpoch();
    },
    [filterLinked, lastPill, bumpEpoch],
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
        bumpEpoch();
      } else {
        setBucketDrillUnlinked(true);
      }
    },
    [bucket, filterLinked, bumpEpoch],
  );

  const handleClearDateFilter = React.useCallback(() => {
    setSelectedDate("");
    setBucketDrillUnlinked(false);
    if (filterLinked) {
      if (dashboardRange.kind === "custom") {
        setDashboardRange({ kind: lastPill });
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
  }, [filterLinked, dashboardRange, lastPill, bumpEpoch]);

  const handleBucketChange = React.useCallback((next: ChartBucket) => {
    setBucket(next);
    if (next !== "day") {
      setSelectedDate("");
    }
  }, []);

  // If period shrinks and current Group-by is invalid (e.g. Year on 7d),
  // clamp to the coarsest still-allowed option — not a full smart default.
  React.useEffect(() => {
    const allowed = allowedBucketsForRange(dashboardRange);
    if (!allowed.includes(bucket)) {
      setBucket(allowed[0] ?? "day");
    }
  }, [dashboardRange, bucket]);

  const [tableFilterAnnouncement, setTableFilterAnnouncement] =
    React.useState("");

  const handleFailuresClick = React.useCallback(() => {
    setStatusFilter("FAIL");
    setTableFilterAnnouncement("Table filtered to FAIL rows");
    toast.message("Showing FAIL rows in the table", {
      description: "Status filter set to FAIL",
      duration: 2500,
    });
    // Hash for shareability / deep link after scroll
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.hash = "test-table";
      window.history.replaceState(null, "", url.toString());
    }
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

  // Stamp "Updated …" when dashboard data settles (not mid soft-refresh).
  React.useEffect(() => {
    if (!loadDashboardData) return;
    if (stripRefreshing || volumeRefreshing) return;
    if (stripLoading || volumeLoading) return;
    setDataAsOf(new Date());
  }, [
    loadDashboardData,
    stripRefreshing,
    volumeRefreshing,
    stripLoading,
    volumeLoading,
    stripStats,
    volumeStats,
    requestEpoch,
  ]);

  // Empty only when the *current* period is confirmed empty.
  // While probing a new period hasData is null → skeleton shell (not a
  // re-flash of the previous empty state when leaving 7d → 30d).
  const showEmpty = filtersReady && hasData === false;
  const showDashboardShell = !showEmpty;

  // One-shot enter animation for the main shell (not on every soft period update)
  const shellAnimatedRef = React.useRef(false);
  const [shellEnterClass, setShellEnterClass] = React.useState(
    "dashboard-skeleton-enter",
  );
  React.useEffect(() => {
    if (showDashboardShell && !shellAnimatedRef.current) {
      shellAnimatedRef.current = true;
      setShellEnterClass("dashboard-skeleton-enter");
      const t = window.setTimeout(() => setShellEnterClass(""), 200);
      return () => window.clearTimeout(t);
    }
    if (showEmpty) {
      // Allow a fresh shell fade if we leave empty → populated later
      shellAnimatedRef.current = false;
    }
  }, [showDashboardShell, showEmpty]);

  return (
    <div className="ml-10 flex min-h-dvh flex-col">
      <DashboardHeader
        dashboardRange={dashboardRange}
        onPeriodPill={handlePeriodPill}
        onPeriodPillPrefetch={handlePeriodPillPrefetch}
        onCustomRange={handleCustomRange}
        chartMode={chartMode}
        onChartModeChange={(mode) => {
          if (mode === "all" || mode === "recent") setChartMode(mode);
        }}
        filterLinked={filterLinked}
        onFilterLinkedChange={setFilterLinked}
        prefsReady={filtersReady}
        moreOpen={moreOpen}
        onMoreOpenChange={setMoreOpen}
        dataAsOf={dataAsOf}
      />
      {/* Screen-reader announcement when Failures CTA filters the table (O13) */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic>
        {tableFilterAnnouncement}
      </div>
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          {showEmpty && (
            <DashboardEmptyState
              // No period key — remounting re-ran the enter animation and
              // flashed empty when switching periods before the probe resolved.
              dashboardRange={dashboardRange}
              onShowAllTime={
                dashboardRange.kind !== "all"
                  ? () => handlePeriodPill("all")
                  : undefined
              }
              onWidenRange={() => setMoreOpen(true)}
            />
          )}

          {showDashboardShell && (
            <div
              className={cn(
                "mx-auto flex w-full flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6 4xl:gap-8 4xl:px-8 5xl:gap-10 5xl:px-12",
                shellEnterClass,
              )}
            >
              {/* O21: dismissible chart-drill filter chips */}
              {dayDrillActive && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Filtered to {selectedDate}
                  </span>
                  <span className="hidden sm:inline">· table dates</span>
                  <button
                    type="button"
                    className="ml-auto rounded-md px-2 py-1 font-medium text-primary underline-offset-2 hover:bg-primary/10 hover:underline"
                    onClick={handleClearDateFilter}
                  >
                    Clear
                  </button>
                </div>
              )}

              {!dayDrillActive &&
                bucketDrillUnlinked &&
                tableDateFrom &&
                tableDateTo && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Filtered to {tableDateFrom}
                      {tableDateFrom !== tableDateTo
                        ? ` – ${tableDateTo}`
                        : ""}
                    </span>
                    <span className="hidden sm:inline">
                      · dashboard period unchanged
                    </span>
                    <button
                      type="button"
                      className="ml-auto rounded-md px-2 py-1 font-medium text-primary underline-offset-2 hover:bg-primary/10 hover:underline"
                      onClick={handleClearDateFilter}
                    >
                      Clear
                    </button>
                  </div>
                )}

              <HeroMetrics
                dashboardRange={dashboardRange}
                chartMode={chartMode}
                annotationFilter={annotationFilter}
                requestEpoch={requestEpoch}
                onFailuresClick={handleFailuresClick}
                enabled={loadDashboardData}
              />

              <FailureRateStrip
                data={stripStats}
                loading={stripLoading || !loadDashboardData}
                refreshing={stripRefreshing}
                annotationFilter={annotationFilter}
                bucket={stripBucket}
                dashboardRange={dashboardRange}
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
                loading={volumeLoading || !loadDashboardData}
                refreshing={volumeRefreshing}
              />

              <AnnotationInsights
                dashboardRange={dashboardRange}
                chartMode={chartMode}
                annotationFilter={annotationFilter}
                onAnnotationFilterChange={setAnnotationFilter}
                requestEpoch={requestEpoch}
                enabled={loadDashboardData}
              />

              {loadDashboardData ? (
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
          )}
        </div>
      </div>
    </div>
  );
}
