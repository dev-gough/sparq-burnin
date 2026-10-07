"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  IconDownload,
  IconFileZip,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { SidebarDrawer } from "@/components/sidebar-drawer";
import {
  HeaderPeriodControls, HeaderResultModeControls, HeaderRangeMeta,
  HEADER_BAR_CLASS, HEADER_TITLE_CLASS, HEADER_CONTROLS_CLASS,
} from "@/components/dashboard/header-controls";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import {
  type DashboardPill,
  type DashboardRange,
  exportTimeRange,
  tableDatesForPill,
} from "@/lib/dashboard-range";
import { cn } from "@/lib/utils";

const METRICS_HELP = (
  <div className="space-y-2 text-left text-xs leading-relaxed">
    <p>
      <span className="font-semibold">Latest</span> is the latest PASS or FAIL
      per inverter. <span className="font-semibold">All tests</span> counts
      every PASS and FAIL. Invalid and retest are left out of the summary and
      charts. The table can still list them.
    </p>
    <p>
      <span className="font-semibold">Prior period</span> is the equal-length
      window immediately before the selected range. Hover a trend for that
      comparison.
    </p>
    <p>
      <span className="font-semibold">Test volume</span> plots pass counts on
      the left axis and fail counts on the right. Passes are bars, and become
      a line once the range has more than 100 buckets. Fails stay a line on
      the right axis. Hover the plot for the failure rate.
    </p>
    <p>
      Period buttons, the custom range, charts, and date filters use{" "}
      <span className="font-semibold">UTC calendar days</span>. Table
      timestamps use the display timezone in the sidebar.
    </p>
    <p>
      Category and station filters apply to the summary, the charts, and the
      table. Latest / All tests is the same switch as One row per inverter.
      The failures number filters the table to FAIL.
    </p>
  </div>
);

interface DashboardHeaderProps {
  dashboardRange: DashboardRange;
  onPeriodPill: (kind: DashboardPill) => void;
  /** Hover/focus intent: warm chart series cache for a period pill. */
  onPeriodPillPrefetch?: (kind: DashboardPill) => void;
  onCustomRange: (from: string, to: string) => void;
  chartMode: string;
  onChartModeChange: (mode: string) => void;
  /**
   * When false, period controls show no selection (avoids flashing SSR default
   * 30d before localStorage prefs apply).
   */
  prefsReady?: boolean;
  /** Controlled custom date picker (e.g. empty-state “Custom range”). */
  customOpen?: boolean;
  onCustomOpenChange?: (open: boolean) => void;
  /** O31: last successful dashboard data paint (client clock). */
  dataAsOf?: Date | null;
}

export function DashboardHeader({
  dashboardRange,
  onPeriodPill,
  onPeriodPillPrefetch,
  onCustomRange,
  chartMode,
  onChartModeChange,
  prefsReady = true,
  customOpen: customOpenProp,
  onCustomOpenChange,
  dataAsOf = null,
}: DashboardHeaderProps) {
  const isMobile = useIsMobile();
  const [mobileActionsTarget, setMobileActionsTarget] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => {
    setMobileActionsTarget(document.getElementById("mobile-header-actions"));
  }, []);
  const [customOpenInternal, setCustomOpenInternal] = React.useState(false);
  const customOpen = customOpenProp ?? customOpenInternal;
  const setCustomOpen = onCustomOpenChange ?? setCustomOpenInternal;
  const customDates = dashboardRange.kind === "custom"
    ? dashboardRange
    : tableDatesForPill(dashboardRange.kind);
  const [isGeneratingReport, setIsGeneratingReport] = React.useState(false);
  const [isGeneratingFailedData, setIsGeneratingFailedData] =
    React.useState(false);

  const exportRange = exportTimeRange(dashboardRange);

  const generateReport = async () => {
    if (!exportRange) return;
    try {
      setIsGeneratingReport(true);
      const response = await fetch(
        `/api/test-report?timeRange=${exportRange}`,
      );
      if (!response.ok) {
        console.error("Failed to generate report");
        return;
      }
      const reportData = await response.json();
      const csvContent = buildReportCsv(reportData);
      const blob = new Blob([csvContent], {
        type: "text/csv;charset=utf-8;",
      });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute(
        "download",
        `test-report-${exportRange}-${new Date().toISOString().split("T")[0]}.csv`,
      );
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error generating report:", error);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const downloadFailedTestData = async () => {
    if (!exportRange) return;
    try {
      setIsGeneratingFailedData(true);
      const response = await fetch(
        `/api/failed-test-data?timeRange=${exportRange}`,
      );
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(
          "Failed to download failed test data:",
          errorData.error,
        );
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.setAttribute("href", url);
      link.setAttribute(
        "download",
        `failed-tests-${exportRange}-${new Date().toISOString().split("T")[0]}.zip`,
      );
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Error downloading failed test data:", error);
    } finally {
      setIsGeneratingFailedData(false);
    }
  };

  const headerActions = (
    <div className="dashboard-header-actions flex shrink-0 items-center gap-1.5 sm:gap-2">
      <SidebarDrawer
        title="Download"
        description="Export dashboard data"
        className="dashboard-export-drawer"
        trigger={
          <Button variant="outline" size="sm" className="h-10 gap-1.5 px-3" aria-label="Export">
            <IconDownload className="size-4" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        }
      >
        <div className="drawer-body space-y-3 p-4">
          <Button variant="outline" className="export-action h-auto min-h-14 w-full justify-start whitespace-normal py-3 text-left"
            disabled={!exportRange || isGeneratingReport} onClick={generateReport}>
            <IconDownload className="size-5" />
            {isGeneratingReport ? "Generating…" : "Test report (CSV)"}
          </Button>
          <Button variant="outline" className="export-action h-auto min-h-14 w-full justify-start whitespace-normal py-3 text-left"
            disabled={!exportRange || isGeneratingFailedData} onClick={downloadFailedTestData}>
            <IconFileZip className="size-5" />
            {isGeneratingFailedData ? "Downloading…" : "Failed test data (ZIP)"}
          </Button>
          <p className="export-disclosure text-xs leading-relaxed text-muted-foreground">
            {exportRange === null
              ? "Exports require 7d, 30d, 90d or All. Custom ranges are not supported."
              : "Exports use the selected time window. Annotation filters are not included."}
          </p>
        </div>
      </SidebarDrawer>
    </div>
  );

  return (
    <header className={cn(HEADER_BAR_CLASS, "dashboard-page-header")}>
      <div className="dashboard-header-title flex min-w-0 items-center gap-1.5">
        <h1 className={HEADER_TITLE_CLASS}>
          BurnIn Dashboard
        </h1>
        <InfoTooltip content={METRICS_HELP} side="bottom" />
      </div>

      {/* Period + result mode only — large touch targets (O12).
          Meta (dates / Updated) is intentionally NOT in this flex so
          justify-center cannot reflow when those strings mount. */}
      <div className={HEADER_CONTROLS_CLASS}>
        <HeaderPeriodControls
          period={dashboardRange.kind}
          from={customDates.from}
          to={customDates.to}
          onPeriodChange={(period) => onPeriodPill(period as DashboardPill)}
          onCustomRange={onCustomRange}
          onPeriodPrefetch={(period) => onPeriodPillPrefetch?.(period as DashboardPill)}
          ready={prefsReady}
          open={customOpen}
          onOpenChange={setCustomOpen}
        />
        <HeaderResultModeControls mode={chartMode} onModeChange={onChartModeChange} ready={prefsReady} />
      </div>

      <HeaderRangeMeta range={dashboardRange} updatedAt={dataAsOf} ready={prefsReady} />

      {isMobile && mobileActionsTarget ? createPortal(headerActions, mobileActionsTarget) : headerActions}
    </header>
  );
}

function buildReportCsv(reportData: {
  dateRange: { start: string; end: string };
  totals: {
    totalTests: number;
    totalPassed: number;
    totalFailed: number;
    totalInvalid: number;
    totalRetest?: number;
    overallPassRate: number;
    overallFailRate: number;
  };
  dailyData: Array<{
    date: string;
    total: number;
    passed: number;
    failed: number;
    invalid: number;
    retest?: number;
    passRate: number;
    failRate: number;
  }>;
}): string {
  let csv = "TEST REPORT SUMMARY\n";
  csv += `Date Range: ${reportData.dateRange.start} to ${reportData.dateRange.end}\n`;
  csv += `Total Tests: ${reportData.totals.totalTests}\n`;
  csv += `Total Passed: ${reportData.totals.totalPassed}\n`;
  csv += `Total Failed: ${reportData.totals.totalFailed}\n`;
  csv += `Total Invalid: ${reportData.totals.totalInvalid}\n`;
  csv += `Total Retest: ${reportData.totals.totalRetest ?? 0}\n`;
  csv += `Overall Pass Rate: ${reportData.totals.overallPassRate}%\n`;
  csv += `Overall Fail Rate: ${reportData.totals.overallFailRate}%\n\n`;
  csv += "DAILY BREAKDOWN\n";
  csv +=
    "Date,Total Tests,Passed,Failed,Invalid,Retest,Pass Rate (%),Fail Rate (%)\n";
  reportData.dailyData.forEach((day) => {
    csv +=
      [
        day.date,
        day.total,
        day.passed,
        day.failed,
        day.invalid,
        day.retest ?? 0,
        day.passRate,
        day.failRate,
      ].join(",") + "\n";
  });
  return csv;
}
