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
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
            <SectionCards chartMode={chartMode} timeRange={timeRange} />
            <div className="px-4 lg:px-6">
              <ChartAreaInteractive
                onDateClick={setSelectedDate}
                chartMode={chartMode}
                onChartModeChange={setChartMode}
                timeRange={timeRange}
                onTimeRangeChange={setTimeRange}
              />
            </div>
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
