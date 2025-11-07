"use client";

import * as React from "react";
import { ChartAreaInteractive } from "@/components/chart-area-interactive";
import { DataTable } from "@/components/data-table";
import { SectionCards } from "@/components/section-cards";
import { SiteHeader } from "@/components/site-header";

export default function Page() {
  const [selectedDate, setSelectedDate] = React.useState<string>("");
  const [chartMode, setChartMode] = React.useState("recent"); // 'all' or 'recent'
  const [timeRange, setTimeRange] = React.useState("90d");
  const [annotationFilter, setAnnotationFilter] = React.useState<string>("all");
  const [filterLinked, setFilterLinked] = React.useState(true);
  const [dateFromFilter, setDateFromFilter] = React.useState<string>("");
  const [dateToFilter, setDateToFilter] = React.useState<string>("");

  // Determine which filters to use for chart/cards
  const chartAnnotationFilter = filterLinked ? annotationFilter : "all";
  const chartDateFrom = filterLinked ? dateFromFilter : "";
  const chartDateTo = filterLinked ? dateToFilter : "";

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
