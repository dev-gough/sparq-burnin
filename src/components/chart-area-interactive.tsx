"use client";

import * as React from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption, TooltipComponentFormatterCallbackParams } from "echarts";
import { IconDownload, IconFileZip } from "@tabler/icons-react";

import { useIsMobile } from "@/hooks/use-mobile";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import {
  burninChartColors,
  formatBucketLabel,
  defaultBucketForTimeRange,
  type ChartBucket,
} from "@/lib/chart-theme";

export const description = "Burnin Pass/Fail Results";

interface TestStats {
  date: string;
  passed: number;
  failed: number;
}

const BUCKET_OPTIONS: { value: ChartBucket; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

interface ChartAreaInteractiveProps {
  onDateClick?: (date: string) => void;
  chartMode: string;
  onChartModeChange: (mode: string) => void;
  timeRange: string;
  onTimeRangeChange: (range: string) => void;
  annotationFilter: string;
  dateFrom: string;
  dateTo: string;
  highlightDate?: string;
}

const FAILED_SERIES_NAME = "Failed (right scale)";

export function ChartAreaInteractive({
  onDateClick,
  chartMode,
  onChartModeChange,
  timeRange,
  onTimeRangeChange,
  annotationFilter,
  dateFrom,
  dateTo,
  highlightDate,
}: ChartAreaInteractiveProps) {
  const isMobile = useIsMobile();
  const [chartData, setChartData] = React.useState<TestStats[]>([]);
  const [bucket, setBucket] = React.useState<ChartBucket>(() =>
    defaultBucketForTimeRange(timeRange),
  );
  const [loading, setLoading] = React.useState(true);
  const [isGeneratingReport, setIsGeneratingReport] = React.useState(false);
  const [isGeneratingFailedData, setIsGeneratingFailedData] =
    React.useState(false);
  const [isDarkMode, setIsDarkMode] = React.useState(false);
  const chartRef = React.useRef<ReactECharts>(null);

  // Dark mode detection
  React.useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    };

    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });

    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (isMobile && timeRange === "90d") {
      onTimeRangeChange("30d");
    }
  }, [isMobile, timeRange, onTimeRangeChange]);

  // Smart bucket: re-apply defaults whenever timeRange changes (chart-local
  // control, parent, or mobile 90d→30d force). Manual bucket choice sticks
  // only until the next period change. all→month covers the >2y readability goal.
  React.useEffect(() => {
    setBucket(defaultBucketForTimeRange(timeRange));
  }, [timeRange]);

  const handleTimeRangeChange = React.useCallback(
    (range: string) => {
      onTimeRangeChange(range);
      // Bucket sync happens in the timeRange effect above.
    },
    [onTimeRangeChange],
  );

  React.useEffect(() => {
    const abortController = new AbortController();

    const fetchTestStats = async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams({
          chartMode,
          timeRange,
          annotation: annotationFilter,
          bucket,
        });
        if (dateFrom) params.append("dateFrom", dateFrom);
        if (dateTo) params.append("dateTo", dateTo);

        const response = await fetch(`/api/test-stats?${params}`, {
          signal: abortController.signal,
        });
        if (abortController.signal.aborted) return;

        if (response.ok) {
          const data = await response.json();
          if (abortController.signal.aborted) return;
          setChartData(data);
        } else {
          console.error("Failed to fetch test statistics");
          // Avoid showing stale series under a new bucket/period selection.
          setChartData([]);
        }
      } catch (error) {
        if (abortController.signal.aborted) return;
        console.error("Error fetching test statistics:", error);
        setChartData([]);
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchTestStats();
    return () => abortController.abort();
  }, [chartMode, timeRange, annotationFilter, dateFrom, dateTo, bucket]);

  const getTimeRangeDescription = () => {
    switch (timeRange) {
      case "all":
        return "all time";
      case "90d":
        return "the last 3 months";
      case "30d":
        return "the last 30 days";
      case "7d":
        return "the last 7 days";
      default:
        return "the last 3 months";
    }
  };

  const generateReport = async () => {
    try {
      setIsGeneratingReport(true);
      const response = await fetch(`/api/test-report?timeRange=${timeRange}`);

      if (response.ok) {
        const reportData = await response.json();

        // Generate CSV content
        const csvContent = generateCSVContent(reportData);

        // Create and download the file
        const blob = new Blob([csvContent], {
          type: "text/csv;charset=utf-8;",
        });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute(
          "download",
          `test-report-${timeRange}-${new Date().toISOString().split("T")[0]}.csv`,
        );
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        console.error("Failed to generate report");
      }
    } catch (error) {
      console.error("Error generating report:", error);
    } finally {
      setIsGeneratingReport(false);
    }
  };

  const generateCSVContent = (reportData: {
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
  }) => {
    const headers = [
      "Date",
      "Total Tests",
      "Passed",
      "Failed",
      "Invalid",
      "Pass Rate (%)",
      "Fail Rate (%)",
    ];

    // Add summary section
    let csvContent = "TEST REPORT SUMMARY\n";
    csvContent += `Date Range: ${reportData.dateRange.start} to ${reportData.dateRange.end}\n`;
    csvContent += `Total Tests: ${reportData.totals.totalTests}\n`;
    csvContent += `Total Passed: ${reportData.totals.totalPassed}\n`;
    csvContent += `Total Failed: ${reportData.totals.totalFailed}\n`;
    csvContent += `Total Invalid: ${reportData.totals.totalInvalid}\n`;
    csvContent += `Overall Pass Rate: ${reportData.totals.overallPassRate}%\n`;
    csvContent += `Overall Fail Rate: ${reportData.totals.overallFailRate}%\n\n`;

    // Add daily data section
    csvContent += "DAILY BREAKDOWN\n";
    csvContent += headers.join(",") + "\n";

    reportData.dailyData.forEach((day) => {
      const row = [
        day.date,
        day.total,
        day.passed,
        day.failed,
        day.invalid,
        day.passRate,
        day.failRate,
      ];
      csvContent += row.join(",") + "\n";
    });

    return csvContent;
  };

  const downloadFailedTestData = async () => {
    try {
      setIsGeneratingFailedData(true);
      const response = await fetch(
        `/api/failed-test-data?timeRange=${timeRange}`,
      );

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute(
          "download",
          `failed-tests-${timeRange}-${new Date().toISOString().split("T")[0]}.zip`,
        );
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
      } else {
        const errorData = await response.json();
        console.error("Failed to download failed test data:", errorData.error);
      }
    } catch (error) {
      console.error("Error downloading failed test data:", error);
    } finally {
      setIsGeneratingFailedData(false);
    }
  };

  // ECharts: passed = gradient bars (left axis), failed = red line (right axis)
  // so small failure counts stay readable next to large pass volumes.
  const chartOption: EChartsOption = React.useMemo(() => {
    const textColor = isDarkMode
      ? burninChartColors.text.dark
      : burninChartColors.text.light;
    const mutedColor = isDarkMode
      ? burninChartColors.muted.dark
      : burninChartColors.muted.light;
    const gridColor = isDarkMode
      ? burninChartColors.grid.dark
      : burninChartColors.grid.light;
    const colors = burninChartColors;

    return {
      backgroundColor: "transparent",
      textStyle: {
        color: textColor,
        fontFamily: "var(--font-geist-sans), sans-serif",
      },
      grid: {
        left: 56,
        right: 56,
        bottom: 36,
        top: 44,
        containLabel: false,
      },
      legend: {
        show: true,
        top: 0,
        right: 8,
        icon: "roundRect",
        itemWidth: 12,
        itemHeight: 12,
        itemGap: 20,
        textStyle: { color: textColor, fontSize: 12 },
        data: ["Passed", FAILED_SERIES_NAME],
      },
      xAxis: {
        type: "category",
        data: chartData.map((item) => item.date),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: mutedColor,
          margin: 12,
          interval: "auto",
          hideOverlap: true,
          formatter: (value: string) => formatBucketLabel(value, bucket),
        },
      },
      yAxis: [
        {
          type: "value",
          min: 0,
          minInterval: 1,
          alignTicks: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: colors.passed.base, margin: 10 },
          splitLine: {
            lineStyle: { color: gridColor, type: "solid" as const },
          },
        },
        {
          type: "value",
          min: 0,
          minInterval: 1,
          alignTicks: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: colors.failed.base, margin: 10 },
          splitLine: { show: false },
        },
      ],
      graphic:
        chartData.length === 0
          ? [
              {
                type: "text" as const,
                left: "center",
                top: "middle",
                style: {
                  text: "No tests in the selected range",
                  fontSize: 14,
                  fill: mutedColor,
                },
              },
            ]
          : [],
      series: [
        {
          name: "Passed",
          type: "bar" as const,
          yAxisIndex: 0,
          data: chartData.map((item) => item.passed),
          barMaxWidth: 36,
          itemStyle: {
            borderRadius: [5, 5, 0, 0],
            color: {
              type: "linear" as const,
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: colors.passed.top },
                { offset: 1, color: colors.passed.dark },
              ],
            },
          },
          emphasis: {
            itemStyle: {
              color: colors.passed.base,
            },
          },
          markLine: highlightDate
            ? {
                symbol: "none",
                lineStyle: {
                  color: "hsl(217.2 91.2% 59.8%)",
                  width: 2,
                  type: "solid" as const,
                },
                label: {
                  show: false,
                },
                data: [{ xAxis: highlightDate }],
                silent: true,
              }
            : undefined,
        },
        {
          name: FAILED_SERIES_NAME,
          type: "line" as const,
          yAxisIndex: 1,
          data: chartData.map((item) => item.failed),
          smooth: 0.3,
          symbol: "circle",
          symbolSize: 7,
          showSymbol: chartData.length <= 60,
          z: 10,
          lineStyle: {
            width: 2.5,
            color: colors.failed.base,
            shadowColor: colors.failed.soft(0.35),
            shadowBlur: 6,
            shadowOffsetY: 3,
          },
          itemStyle: {
            color: colors.failed.base,
            borderColor: isDarkMode ? "#18181b" : "#ffffff",
            borderWidth: 2,
          },
          areaStyle: {
            color: {
              type: "linear" as const,
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: colors.failed.soft(0.14) },
                { offset: 1, color: colors.failed.soft(0) },
              ],
            },
          },
        },
      ],
      tooltip: {
        trigger: "axis",
        axisPointer: {
          type: "shadow" as const,
          shadowStyle: {
            color: isDarkMode
              ? "rgba(148, 163, 184, 0.08)"
              : "rgba(100, 116, 139, 0.08)",
          },
        },
        backgroundColor: isDarkMode
          ? "rgba(24, 24, 27, 0.92)"
          : "rgba(255, 255, 255, 0.95)",
        borderColor: isDarkMode
          ? "rgba(148, 163, 184, 0.25)"
          : "rgba(100, 116, 139, 0.2)",
        borderWidth: 1,
        padding: [10, 14],
        extraCssText:
          "border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.15); backdrop-filter: blur(6px);",
        textStyle: { color: textColor },
        formatter: (params: TooltipComponentFormatterCallbackParams) => {
          if (!Array.isArray(params) || params.length === 0) return "";

          const dateValue = params[0].name as string;
          const heading = formatBucketLabel(dateValue, bucket, true);

          let passed = 0;
          let failed = 0;
          params.forEach((param) => {
            if (param.seriesName === "Passed") passed = Number(param.value) || 0;
            if (
              param.seriesName === FAILED_SERIES_NAME ||
              param.seriesName === "Failed"
            ) {
              failed = Number(param.value) || 0;
            }
          });
          const total = passed + failed;
          const rate = total > 0 ? ((failed / total) * 100).toFixed(1) : "0.0";

          const row = (
            dot: string,
            label: string,
            value: string,
            bold = false,
          ) =>
            `<div style="display:flex; align-items:center; gap:8px; margin:3px 0;">` +
            `${dot}<span style="flex:1; opacity:0.85;">${label}</span>` +
            `<span style="font-weight:${bold ? 700 : 600}; margin-left:16px; font-variant-numeric:tabular-nums;">${value}</span></div>`;

          const dot = (color: string) =>
            `<span style="display:inline-block; width:9px; height:9px; border-radius:3px; background:${color};"></span>`;
          const spacerDot = `<span style="display:inline-block; width:9px; height:9px;"></span>`;

          return (
            `<div style="min-width: 170px;">` +
            `<div style="font-weight:700; margin-bottom:6px;">${heading}</div>` +
            row(dot(colors.passed.base), "Passed", String(passed)) +
            row(dot(colors.failed.base), "Failed", String(failed)) +
            `<div style="border-top:1px solid ${isDarkMode ? "rgba(148,163,184,0.25)" : "rgba(100,116,139,0.2)"}; margin:6px 0;"></div>` +
            row(spacerDot, "Total tests", String(total)) +
            row(spacerDot, "Failure rate", `${rate}%`, true) +
            `</div>`
          );
        },
      },
    };
  }, [chartData, isDarkMode, highlightDate, bucket]);

  // Day click filters the table; non-day drill-down lands in PR5 via bucketRange.
  const onEvents = React.useMemo(
    () => ({
      click: (params: { componentType?: string; name?: string }) => {
        if (bucket !== "day") return;
        if (
          (params.componentType === "series" ||
            params.componentType === "xAxis") &&
          params.name &&
          onDateClick
        ) {
          onDateClick(params.name);
        }
      },
    }),
    [onDateClick, bucket],
  );

  const modeCaption =
    chartMode === "recent"
      ? "Each bar is the latest test per inverter in that period (an inverter can appear in more than one week/month)."
      : "Every test run in each period.";

  const annotationCaption =
    annotationFilter && annotationFilter !== "all"
      ? `Chart shows only tests tagged with the current annotation filter. Volume failure rate in the tooltip is among filtered tests.`
      : null;

  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Test Results</CardTitle>
          <span
            className="inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400"
            title="The red line uses an independent Y-axis so small failure counts stay visible next to large pass volumes"
          >
            Failed (right scale)
          </span>
        </div>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            {chartMode === "recent"
              ? "Most recent test per serial number"
              : "All test results"}{" "}
            per {bucket} for {getTimeRangeDescription()}
          </span>
          <span className="@[540px]/card:hidden">
            {chartMode === "recent" ? "Latest per S/N" : "All tests"} -{" "}
            {timeRange === "all"
              ? "All time"
              : timeRange === "90d"
                ? "Last 3 months"
                : timeRange === "30d"
                  ? "Last 30 days"
                  : "Last 7 days"}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {modeCaption}
          </span>
          {annotationCaption ? (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {annotationCaption}
            </span>
          ) : null}
        </CardDescription>
        <CardAction>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-2 @[900px]/card:flex-row @[900px]/card:items-center">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={generateReport}
                  disabled={isGeneratingReport || loading}
                  className="hidden @[640px]/card:flex"
                >
                  <IconDownload />
                  {isGeneratingReport ? "Generating..." : "Generate Report"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadFailedTestData}
                  disabled={isGeneratingFailedData || loading}
                  className="hidden @[640px]/card:flex"
                >
                  <IconFileZip />
                  {isGeneratingFailedData
                    ? "Downloading..."
                    : "Failed Test Data"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={generateReport}
                  disabled={isGeneratingReport || loading}
                  className="@[640px]/card:hidden"
                >
                  <IconDownload />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={downloadFailedTestData}
                  disabled={isGeneratingFailedData || loading}
                  className="@[640px]/card:hidden"
                >
                  <IconFileZip />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5">
                  <ToggleGroup
                    type="single"
                    value={chartMode}
                    onValueChange={(value) => {
                      // Prevent deselecting - only allow switching between options
                      if (value) onChartModeChange(value);
                    }}
                    variant="outline"
                    className="*:data-[slot=toggle-group-item]:!px-3"
                  >
                    <ToggleGroupItem value="all">All Tests</ToggleGroupItem>
                    <ToggleGroupItem value="recent">
                      Latest per S/N
                    </ToggleGroupItem>
                  </ToggleGroup>
                  <InfoTooltip
                    content={
                      <>
                        <strong>All Tests:</strong> Shows every test run.
                        <br />
                        <strong>Latest per S/N:</strong> Shows only the most
                        recent test for each serial number.
                      </>
                    }
                  />
                </div>
                <ToggleGroup
                  type="single"
                  value={timeRange}
                  onValueChange={(value) => {
                    // Prevent deselecting - only allow switching between options
                    if (value) handleTimeRangeChange(value);
                  }}
                  variant="outline"
                  className="hidden *:data-[slot=toggle-group-item]:!px-4 @[767px]/card:flex"
                >
                  <ToggleGroupItem value="all">All Time</ToggleGroupItem>
                  <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
                  <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
                  <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
                </ToggleGroup>
                <Select
                  value={timeRange}
                  onValueChange={handleTimeRangeChange}
                >
                  <SelectTrigger
                    className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
                    size="sm"
                    aria-label="Select a value"
                  >
                    <SelectValue placeholder="Last 3 months" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="all" className="rounded-lg">
                      All Time
                    </SelectItem>
                    <SelectItem value="90d" className="rounded-lg">
                      Last 3 months
                    </SelectItem>
                    <SelectItem value="30d" className="rounded-lg">
                      Last 30 days
                    </SelectItem>
                    <SelectItem value="7d" className="rounded-lg">
                      Last 7 days
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2">
              <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                Grouped by
              </span>
              <ToggleGroup
                type="single"
                value={bucket}
                onValueChange={(value) => {
                  if (value) setBucket(value as ChartBucket);
                }}
                variant="outline"
                size="sm"
                className="*:data-[slot=toggle-group-item]:!px-3"
              >
                {BUCKET_OPTIONS.map((option) => (
                  <ToggleGroupItem key={option.value} value={option.value}>
                    {option.label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-2 sm:px-6 sm:pt-3">
        {loading ? (
          <div className="flex items-center justify-center h-[320px]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <ReactECharts
            ref={chartRef}
            option={chartOption}
            style={{
              height: "320px",
              width: "100%",
              cursor: bucket === "day" ? "pointer" : "default",
            }}
            opts={{ renderer: "canvas" }}
            onEvents={onEvents}
            notMerge={true}
            lazyUpdate={true}
          />
        )}
      </CardContent>
    </Card>
  );
}
