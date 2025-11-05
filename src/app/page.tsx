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

  return (
    <div>
      <SiteHeader />
      <div className="flex flex-1 flex-col">
        <div className="@container/main flex flex-1 flex-col gap-2">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 4xl:gap-8 5xl:gap-10 mx-auto w-full px-4 lg:px-6 4xl:px-8 5xl:px-12">
            <SectionCards chartMode={chartMode} timeRange={timeRange} />
            <ChartAreaInteractive
              onDateClick={setSelectedDate}
              chartMode={chartMode}
              onChartModeChange={setChartMode}
              timeRange={timeRange}
              onTimeRangeChange={setTimeRange}
            />
            <DataTable
              selectedDate={selectedDate}
              onClearDateFilter={() => setSelectedDate("")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
