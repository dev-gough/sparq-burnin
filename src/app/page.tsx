"use client";

import * as React from "react";
import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { DataTable } from "@/components/data-table";
import { SectionCards } from "@/components/section-cards";
import { SiteHeader } from "@/components/site-header";

const FILTER_COOKIE_KEY = "burnin-data-table-filters";

const loadFiltersFromCookie = () => {
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
  const [selectedDate, setSelectedDate] = React.useState<string>("");
  const [chartMode, setChartMode] = React.useState("recent"); // 'all' or 'recent'
  const [timeRange, setTimeRange] = React.useState("90d");

  // Initialize filters from cookies
  const [annotationFilter, setAnnotationFilter] = React.useState<string>(() => {
    const savedFilters = loadFiltersFromCookie();
    return savedFilters.annotationFilter || "all";
  });
  const [filterLinked, setFilterLinked] = React.useState(true);
  const [dateFromFilter, setDateFromFilter] = React.useState<string>(() => {
    const savedFilters = loadFiltersFromCookie();
    return savedFilters.dateFromFilter || "";
  });
  const [dateToFilter, setDateToFilter] = React.useState<string>(() => {
    const savedFilters = loadFiltersFromCookie();
    return savedFilters.dateToFilter || "";
  });

  // Determine which filters to use for chart/cards
  const chartAnnotationFilter = filterLinked ? annotationFilter : "all";

  // Special handling: if date range is a single day, show full chart with highlight
  const isSingleDayFilter = dateFromFilter && dateToFilter && dateFromFilter === dateToFilter;
  const chartDateFrom = filterLinked && !isSingleDayFilter ? dateFromFilter : "";
  const chartDateTo = filterLinked && !isSingleDayFilter ? dateToFilter : "";
  const highlightDate = filterLinked && isSingleDayFilter ? dateFromFilter : "";

  return (
    <div>
      <SiteHeader />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 4xl:gap-8 5xl:gap-10 mx-auto w-full px-4 lg:px-6 4xl:px-8 5xl:px-12">
            <SectionCards
              chartMode={chartMode}
              timeRange={timeRange}
              annotationFilter={chartAnnotationFilter}
              dateFrom={chartDateFrom}
              dateTo={chartDateTo}
            />
            <ChartAreaInteractive
              onDateClick={setSelectedDate}
              chartMode={chartMode}
              onChartModeChange={setChartMode}
              timeRange={timeRange}
              onTimeRangeChange={setTimeRange}
              annotationFilter={chartAnnotationFilter}
              dateFrom={chartDateFrom}
              dateTo={chartDateTo}
              highlightDate={highlightDate}
            />
            <DataTable
              selectedDate={selectedDate}
              onClearDateFilter={() => setSelectedDate("")}
              annotationFilter={annotationFilter}
              onAnnotationFilterChange={setAnnotationFilter}
              filterLinked={filterLinked}
              onFilterLinkedChange={setFilterLinked}
              dateFromFilter={dateFromFilter}
              onDateFromFilterChange={setDateFromFilter}
              dateToFilter={dateToFilter}
              onDateToFilterChange={setDateToFilter}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
