"use client";

import * as React from "react";
import {
  IconDownload,
  IconFileZip,
  IconMoon,
  IconSettings,
  IconSun,
} from "@tabler/icons-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HeaderPeriodControls, HeaderResultModeControls, HeaderRangeMeta,
  HEADER_BAR_CLASS, HEADER_TITLE_CLASS, HEADER_CONTROLS_CLASS,
} from "@/components/dashboard/header-controls";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
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
      <span className="font-semibold">Latest</span> = one result per inverter
      in the window (hero + charts).{" "}
      <span className="font-semibold">All tests</span> = every run counts.
    </p>
    <p>
      <span className="font-semibold">Prior period</span> is the equal-length
      window immediately before the selected range. Hover a trend for dates.
    </p>
    <p>
      <span className="font-semibold">Test volume</span> uses dual axes: green
      bars = pass count (left); red = fail count (right). Hover for failure
      rate and low-sample cues.
    </p>
    <p>
      <span className="font-semibold">Timezones:</span> period pills, custom
      range, charts, and date filters use{" "}
      <span className="font-semibold">UTC calendar days</span>. Table row
      timestamps use your selected display timezone (sidebar).
    </p>
    <p>
      Annotation filters apply to hero, charts, and table. Result mode (Latest /
      All tests) also drives the table’s Latest only toggle so FAIL counts match
      the summary cards. Failures → filters the table to Status = FAIL.
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
  filterLinked: boolean;
  onFilterLinkedChange: (linked: boolean) => void;
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
  filterLinked,
  onFilterLinkedChange,
  prefsReady = true,
  customOpen: customOpenProp,
  onCustomOpenChange,
  dataAsOf = null,
}: DashboardHeaderProps) {
  const [customOpenInternal, setCustomOpenInternal] = React.useState(false);
  const customOpen = customOpenProp ?? customOpenInternal;
  const setCustomOpen = onCustomOpenChange ?? setCustomOpenInternal;
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [themeMounted, setThemeMounted] = React.useState(false);
  React.useEffect(() => setThemeMounted(true), []);
  const customDates = dashboardRange.kind === "custom"
    ? dashboardRange
    : tableDatesForPill(dashboardRange.kind);
  const [isGeneratingReport, setIsGeneratingReport] = React.useState(false);
  const [isGeneratingFailedData, setIsGeneratingFailedData] =
    React.useState(false);

  const exportRange = exportTimeRange(dashboardRange);
  // Always show export limitation note (APIs are timeRange-only; ignore annotation)
  const showExportLimitation = true;

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

  return (
    <header className={HEADER_BAR_CLASS}>
      <div className="flex min-w-0 items-center gap-1.5">
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

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        {/* More sheet */}
        <Sheet>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-10 min-h-10 gap-1.5 px-2.5 sm:px-3"
              aria-label="More options"
            >
              <IconSettings className="size-4" />
              <span className="hidden sm:inline">More</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Dashboard options</SheetTitle>
              <SheetDescription>
                Advanced controls for the command center. Period pills stay
                on the header for quick access.
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-6 px-4 pb-6">
              {/* Chart mode (also on header — kept here for advanced copy) */}
              <div className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Result mode
                </Label>
                <ToggleGroup
                  type="single"
                  value={chartMode}
                  onValueChange={(value) => {
                    if (value) onChartModeChange(value);
                  }}
                  variant="outline"
                  className="w-full justify-start"
                >
                  <ToggleGroupItem value="recent" className="h-10 flex-1">
                    Latest per inverter
                  </ToggleGroupItem>
                  <ToggleGroupItem value="all" className="h-10 flex-1">
                    All tests
                  </ToggleGroupItem>
                </ToggleGroup>
                <p className="text-xs text-muted-foreground">
                  Same control as the header. Latest = one result per inverter;
                  All tests = every run.
                </p>
              </div>

              {/* O23: Theme — also in sidebar; surfaced here for discoverability */}
              <div className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Appearance
                </Label>
                <ToggleGroup
                  type="single"
                  value={
                    themeMounted
                      ? theme === "system"
                        ? "system"
                        : resolvedTheme === "dark"
                          ? "dark"
                          : "light"
                      : undefined
                  }
                  onValueChange={(value) => {
                    if (value) setTheme(value);
                  }}
                  variant="outline"
                  className="w-full justify-start"
                  aria-label="Color theme"
                >
                  <ToggleGroupItem value="light" className="h-10 min-h-10 flex-1 gap-1.5">
                    <IconSun className="size-4" />
                    Light
                  </ToggleGroupItem>
                  <ToggleGroupItem value="dark" className="h-10 min-h-10 flex-1 gap-1.5">
                    <IconMoon className="size-4" />
                    Dark
                  </ToggleGroupItem>
                  <ToggleGroupItem value="system" className="h-10 min-h-10 flex-1">
                    System
                  </ToggleGroupItem>
                </ToggleGroup>
              </div>

              {/* Date link toggle */}
              <div className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Table date sync
                </Label>
                <button
                  type="button"
                  role="switch"
                  aria-checked={filterLinked}
                  onClick={() => onFilterLinkedChange(!filterLinked)}
                  className={cn(
                    "flex h-11 w-full items-center justify-between rounded-lg border px-3 text-sm transition-colors",
                    filterLinked
                      ? "border-primary/40 bg-primary/10"
                      : "border-border bg-background",
                  )}
                >
                  <span>Link table dates to dashboard period</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      filterLinked
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {filterLinked ? "On" : "Off"}
                  </span>
                </button>
                <p className="text-xs text-muted-foreground">
                  When on, period pills update table dates and table date edits
                  promote the dashboard to a custom range. Annotation filters
                  always apply to both regardless of this setting.
                </p>
              </div>

              {/* Export disclosure */}
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Export limitation</p>
                <p className="mt-1">
                  Exports use the standard time window only (7d / 30d / 90d /
                  all). Custom date ranges and annotation filters are not
                  applied by the export endpoints.
                </p>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {/* Export menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-10 gap-1.5 px-3"
              aria-label="Export"
            >
              <IconDownload className="size-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Export data</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={!exportRange || isGeneratingReport}
              onClick={generateReport}
              title={
                exportRange === null
                  ? "Exports require a pill period (7d / 30d / 90d / All), not a custom range"
                  : undefined
              }
            >
              <IconDownload className="mr-2 size-4" />
              {isGeneratingReport ? "Generating…" : "Test report (CSV)"}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!exportRange || isGeneratingFailedData}
              onClick={downloadFailedTestData}
              title={
                exportRange === null
                  ? "Exports require a pill period (7d / 30d / 90d / All), not a custom range"
                  : undefined
              }
            >
              <IconFileZip className="mr-2 size-4" />
              {isGeneratingFailedData
                ? "Downloading…"
                : "Failed test data (ZIP)"}
            </DropdownMenuItem>
            {showExportLimitation && (
              <>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  {exportRange === null
                    ? "Export disabled for custom ranges. Choose 7d, 30d, 90d, or All."
                    : "Exports use the pill time window only and ignore annotation filters."}
                </div>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
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
