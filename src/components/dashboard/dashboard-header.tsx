"use client";

import * as React from "react";
import {
  IconDownload,
  IconFileZip,
  IconSettings,
} from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type DashboardPill,
  type DashboardRange,
  exportTimeRange,
} from "@/lib/dashboard-range";
import { cn } from "@/lib/utils";

const PERIOD_PILLS: { value: DashboardPill; label: string; short: string }[] = [
  { value: "7d", label: "7 days", short: "7d" },
  { value: "30d", label: "30 days", short: "30d" },
  { value: "90d", label: "3 months", short: "90d" },
  { value: "all", label: "All time", short: "All" },
];

interface DashboardHeaderProps {
  dashboardRange: DashboardRange;
  onPeriodPill: (kind: DashboardPill) => void;
  onCustomRange: (from: string, to: string) => void;
  chartMode: string;
  onChartModeChange: (mode: string) => void;
  filterLinked: boolean;
  onFilterLinkedChange: (linked: boolean) => void;
}

export function DashboardHeader({
  dashboardRange,
  onPeriodPill,
  onCustomRange,
  chartMode,
  onChartModeChange,
  filterLinked,
  onFilterLinkedChange,
}: DashboardHeaderProps) {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [customFrom, setCustomFrom] = React.useState(
    dashboardRange.kind === "custom" ? dashboardRange.from : "",
  );
  const [customTo, setCustomTo] = React.useState(
    dashboardRange.kind === "custom" ? dashboardRange.to : "",
  );
  const [isGeneratingReport, setIsGeneratingReport] = React.useState(false);
  const [isGeneratingFailedData, setIsGeneratingFailedData] =
    React.useState(false);

  React.useEffect(() => {
    if (dashboardRange.kind === "custom") {
      setCustomFrom(dashboardRange.from);
      setCustomTo(dashboardRange.to);
    }
  }, [dashboardRange]);

  const activePill =
    dashboardRange.kind === "custom" ? null : dashboardRange.kind;
  const isCustom = dashboardRange.kind === "custom";
  const exportRange = exportTimeRange(dashboardRange);
  // Always show export limitation note (APIs are timeRange-only; ignore annotation)
  const showExportLimitation = true;

  const applyCustom = () => {
    if (!customFrom || !customTo) return;
    if (customFrom > customTo) return;
    onCustomRange(customFrom, customTo);
    setMoreOpen(false);
  };

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
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2 lg:px-6">
      <h1 className="text-base font-semibold tracking-tight sm:text-lg">
        Burn-in Command Center
      </h1>

      {/* Period pills — large touch targets */}
      <div className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:justify-center">
        <ToggleGroup
          type="single"
          value={activePill ?? ""}
          onValueChange={(value) => {
            if (value) onPeriodPill(value as DashboardPill);
          }}
          variant="outline"
          className="hidden sm:flex"
        >
          {PERIOD_PILLS.map((p) => (
            <ToggleGroupItem
              key={p.value}
              value={p.value}
              className="h-10 min-w-[3.25rem] px-3 text-sm data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              aria-label={p.label}
            >
              {p.short}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {/* Mobile: select instead of pills */}
        <Select
          value={isCustom ? "custom" : (activePill ?? "30d")}
          onValueChange={(value) => {
            if (value === "custom") {
              setMoreOpen(true);
              return;
            }
            onPeriodPill(value as DashboardPill);
          }}
        >
          <SelectTrigger
            className="h-10 w-[9.5rem] sm:hidden"
            aria-label="Select period"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_PILLS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
            <SelectItem value="custom">Custom…</SelectItem>
          </SelectContent>
        </Select>

        {isCustom && (
          <span className="hidden rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary sm:inline-flex">
            Custom {dashboardRange.from} → {dashboardRange.to}
          </span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* More sheet */}
        <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
          <SheetTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-10 gap-1.5 px-3"
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
              {/* Chart mode */}
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
                  {chartMode === "recent"
                    ? "One result per inverter in the selected window (hero) or per chart period (volume)."
                    : "Every test run counts."}
                </p>
              </div>

              {/* Custom dates */}
              <div className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Custom date range (UTC)
                </Label>
                <div className="flex flex-wrap gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="dash-from" className="text-xs">
                      From
                    </Label>
                    <Input
                      id="dash-from"
                      type="date"
                      value={customFrom}
                      onChange={(e) => setCustomFrom(e.target.value)}
                      className="h-10 w-40"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="dash-to" className="text-xs">
                      To
                    </Label>
                    <Input
                      id="dash-to"
                      type="date"
                      value={customTo}
                      onChange={(e) => setCustomTo(e.target.value)}
                      className="h-10 w-40"
                    />
                  </div>
                </div>
                <Button
                  className="h-10"
                  onClick={applyCustom}
                  disabled={!customFrom || !customTo || customFrom > customTo}
                >
                  Apply custom range
                </Button>
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
            >
              <IconDownload className="mr-2 size-4" />
              {isGeneratingReport ? "Generating…" : "Test report (CSV)"}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!exportRange || isGeneratingFailedData}
              onClick={downloadFailedTestData}
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
                    ? "Custom ranges are not supported by export APIs. Choose 7d, 30d, 90d, or All."
                    : "Exports ignore annotation filters and use the pill time window only."}
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
    overallPassRate: number;
    overallFailRate: number;
  };
  dailyData: Array<{
    date: string;
    total: number;
    passed: number;
    failed: number;
    invalid: number;
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
  csv += `Overall Pass Rate: ${reportData.totals.overallPassRate}%\n`;
  csv += `Overall Fail Rate: ${reportData.totals.overallFailRate}%\n\n`;
  csv += "DAILY BREAKDOWN\n";
  csv +=
    "Date,Total Tests,Passed,Failed,Invalid,Pass Rate (%),Fail Rate (%)\n";
  reportData.dailyData.forEach((day) => {
    csv +=
      [
        day.date,
        day.total,
        day.passed,
        day.failed,
        day.invalid,
        day.passRate,
        day.failRate,
      ].join(",") + "\n";
  });
  return csv;
}
