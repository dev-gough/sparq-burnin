"use client";

import * as React from "react";
import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { DataTable } from "@/components/data-table";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { FailureRateStrip } from "@/components/dashboard/failure-rate-strip";
import { HeroMetrics } from "@/components/dashboard/hero-metrics";
import {
  type DashboardPill,
  type DashboardRange,
  defaultBucketForDashboardRange,
  tableDatesForPill,
} from "@/lib/dashboard-range";
import type { ChartBucket } from "@/lib/chart-theme";

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

export default function Page() {
  // --- Command-center state (split dashboard vs table dates) ---
  const [dashboardRange, setDashboardRange] = React.useState<DashboardRange>({
    kind: "30d",
  });
  /** Last non-custom pill — used when linked clear reverts custom. */
  const [lastPill, setLastPill] = React.useState<DashboardPill>("30d");
  const [selectedDate, setSelectedDate] = React.useState<string>("");
  const [chartMode, setChartMode] = React.useState("recent");
  const [bucket, setBucket] = React.useState<ChartBucket>(() =>
    defaultBucketForDashboardRange({ kind: "30d" }),
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

  const [tableDateFrom, setTableDateFrom] = React.useState<string>(() => {
    const saved = loadFiltersFromCookie();
    // Prefer cookie; if empty and we default to 30d linked, seed table to 30d span
    const fromCookie = (saved.dateFromFilter as string) || "";
    if (fromCookie) return fromCookie;
    return tableDatesForPill("30d").from;
  });
  const [tableDateTo, setTableDateTo] = React.useState<string>(() => {
    const saved = loadFiltersFromCookie();
    const toCookie = (saved.dateToFilter as string) || "";
    if (toCookie) return toCookie;
    return tableDatesForPill("30d").to;
  });

  const bumpEpoch = React.useCallback(() => {
    setRequestEpoch((e) => e + 1);
  }, []);

  // Smart bucket when dashboard period changes
  const applySmartBucket = React.useCallback((range: DashboardRange) => {
    setBucket(defaultBucketForDashboardRange(range));
  }, []);

  /** Period pill (7d/30d/90d/all). */
  const handlePeriodPill = React.useCallback(
    (kind: DashboardPill) => {
      setDashboardRange({ kind });
      setLastPill(kind);
      setSelectedDate("");
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

  /** Custom range from More sheet. */
  const handleCustomRange = React.useCallback(
    (from: string, to: string) => {
      setDashboardRange({ kind: "custom", from, to });
      setSelectedDate("");
      applySmartBucket({ kind: "custom", from, to });
      bumpEpoch();
      if (filterLinked) {
        setTableDateFrom(from);
        setTableDateTo(to);
      }
    },
    [filterLinked, applySmartBucket, bumpEpoch],
  );

  // Keep latest table dates in a ref so paired from/to edits never go stale
  const tableDatesRef = React.useRef({ from: tableDateFrom, to: tableDateTo });
  React.useEffect(() => {
    tableDatesRef.current = { from: tableDateFrom, to: tableDateTo };
  }, [tableDateFrom, tableDateTo]);

  /**
   * Table date edits (user). When linked → promote dashboard to custom.
   * Clearing both dates while linked reverts to lastPill.
   */
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
      setTableDateFrom(from);
      tableDatesRef.current = { ...tableDatesRef.current, from };
      promoteFromTableDates(from, tableDatesRef.current.to);
    },
    [promoteFromTableDates],
  );

  const handleTableDateToChange = React.useCallback(
    (to: string) => {
      setSelectedDate("");
      setTableDateTo(to);
      tableDatesRef.current = { ...tableDatesRef.current, to };
      promoteFromTableDates(tableDatesRef.current.from, to);
    },
    [promoteFromTableDates],
  );

  /** Chart day click: set selectedDate + table dates; never promote dashboard. */
  const handleDateClick = React.useCallback((date: string) => {
    setSelectedDate(date);
    setTableDateFrom(date);
    setTableDateTo(date);
  }, []);

  const handleClearDateFilter = React.useCallback(() => {
    setSelectedDate("");
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
  }, [
    filterLinked,
    dashboardRange,
    lastPill,
    applySmartBucket,
    bumpEpoch,
  ]);

  const handleBucketChange = React.useCallback((next: ChartBucket) => {
    setBucket(next);
    if (next !== "day") {
      setSelectedDate("");
    }
  }, []);

  /** Failures hero: filter table to FAIL + scroll. */
  const handleFailuresClick = React.useCallback(() => {
    setStatusFilter("FAIL");
    // Cookie is written by DataTable's save effect when statusFilter prop changes
    requestAnimationFrame(() => {
      document
        .getElementById("test-table")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  // Single-day highlight for chart when table is filtered to one day
  const isSingleDayFilter =
    tableDateFrom && tableDateTo && tableDateFrom === tableDateTo;
  const highlightDate =
    selectedDate || (isSingleDayFilter ? tableDateFrom : "");

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
            {/* HERO */}
            <HeroMetrics
              dashboardRange={dashboardRange}
              chartMode={chartMode}
              annotationFilter={annotationFilter}
              requestEpoch={requestEpoch}
              onFailuresClick={handleFailuresClick}
            />

            {/* Failure-rate strip (required) */}
            <FailureRateStrip
              dashboardRange={dashboardRange}
              chartMode={chartMode}
              annotationFilter={annotationFilter}
              bucket={bucket}
              requestEpoch={requestEpoch}
            />

            {/* Volume chart */}
            <ChartAreaInteractive
              onDateClick={handleDateClick}
              chartMode={chartMode}
              dashboardRange={dashboardRange}
              annotationFilter={annotationFilter}
              highlightDate={highlightDate}
              bucket={bucket}
              onBucketChange={handleBucketChange}
              requestEpoch={requestEpoch}
            />

            {/* Test table */}
            <DataTable
              selectedDate={selectedDate}
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
