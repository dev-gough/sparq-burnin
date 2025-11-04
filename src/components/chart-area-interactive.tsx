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

export const description = "Burnin Daily Pass/Fail Results";

interface TestStats {
  date: string;
  passed: number;
  failed: number;
}

interface ChartAreaInteractiveProps {
  onDateClick?: (date: string) => void;
  chartMode: string;
  onChartModeChange: (mode: string) => void;
  timeRange: string;
  onTimeRangeChange: (range: string) => void;
}

const chartColors = {
  passed: "hsl(142.1 76.2% 36.3%)",
  failed: "hsl(346.8 77.2% 49.8%)",
  passedWithAlpha: (alpha: number) => `hsla(142.1, 76.2%, 36.3%, ${alpha})`,
  failedWithAlpha: (alpha: number) => `hsla(346.8, 77.2%, 49.8%, ${alpha})`,
};

export function ChartAreaInteractive({
  onDateClick,
  chartMode,
  onChartModeChange,
  timeRange,
  onTimeRangeChange,
}: ChartAreaInteractiveProps) {
  const isMobile = useIsMobile();
  const [chartData, setChartData] = React.useState<TestStats[]>([]);
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

  React.useEffect(() => {
    const fetchTestStats = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/test-stats?chartMode=${chartMode}&timeRange=${timeRange}`);
        if (response.ok) {
          const data = await response.json();
          setChartData(data);
        } else {
          console.error("Failed to fetch test statistics");
        }
      } catch (error) {
        console.error("Error fetching test statistics:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchTestStats();
  }, [chartMode, timeRange]);

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
        // You could add a toast notification here
      }
    } catch (error) {
      console.error("Error downloading failed test data:", error);
    } finally {
      setIsGeneratingFailedData(false);
    }
  };

  // ECharts configuration
  const chartOption: EChartsOption = React.useMemo(() => {
    const textColor = isDarkMode ? "#e5e7eb" : "#374151";
    const gridColor = isDarkMode ? "#374151" : "#e5e7eb";
    const backgroundColor = isDarkMode ? "rgba(17, 24, 39, 0.8)" : "rgba(255, 255, 255, 0.9)";

    return {
      backgroundColor: "transparent",
      textStyle: { color: textColor },
      grid: {
        left: 80,
        right: 50,
        bottom: 50,
        top: 30,
        containLabel: false,
      },
      xAxis: {
        type: "category",
        data: chartData.map((item) => item.date),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: textColor,
          margin: 8,
          interval: "auto",
          formatter: (value: string) => {
            const date = new Date(value + "T00:00:00");
            return date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
          },
        },
      },
      yAxis: {
        type: "value",
        name: "Number of Tests",
        nameLocation: "middle",
        nameGap: 60,
        nameTextStyle: {
          color: textColor,
          fontSize: 12,
        },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: textColor,
          margin: 8,
        },
        splitLine: {
          lineStyle: {
            color: gridColor,
            type: "solid",
          },
        },
      },
      series: [
        {
          name: "Failed",
          type: "line",
          stack: "total",
          data: chartData.map((item) => item.failed),
          smooth: true,
          showSymbol: false,
          lineStyle: {
            width: 2,
            color: chartColors.failed,
          },
          itemStyle: {
            color: chartColors.failed,
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: chartColors.failedWithAlpha(0.8) },
                { offset: 1, color: chartColors.failedWithAlpha(0.1) },
              ],
            },
          },
          emphasis: {
            focus: "none",
            lineStyle: {
              width: 2,
              color: chartColors.failed,
            },
            areaStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: chartColors.failedWithAlpha(0.8) },
                  { offset: 1, color: chartColors.failedWithAlpha(0.1) },
                ],
              },
            },
          },
        },
        {
          name: "Passed",
          type: "line",
          stack: "total",
          data: chartData.map((item) => item.passed),
          smooth: true,
          showSymbol: false,
          lineStyle: {
            width: 2,
            color: chartColors.passed,
          },
          itemStyle: {
            color: chartColors.passed,
          },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: chartColors.passedWithAlpha(0.8) },
                { offset: 1, color: chartColors.passedWithAlpha(0.1) },
              ],
            },
          },
          emphasis: {
            focus: "none",
            lineStyle: {
              width: 2,
              color: chartColors.passed,
            },
            areaStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: chartColors.passedWithAlpha(0.8) },
                  { offset: 1, color: chartColors.passedWithAlpha(0.1) },
                ],
              },
            },
          },
        },
      ],
      tooltip: {
        trigger: "axis",
        backgroundColor: backgroundColor,
        borderColor: gridColor,
        borderWidth: 1,
        textStyle: { color: textColor },
        formatter: (params: TooltipComponentFormatterCallbackParams) => {
          if (!Array.isArray(params) || params.length === 0) return "";

          const dateValue = params[0].name;
          const date = new Date(dateValue + "T00:00:00");
          const formattedDate = date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });

          let html = `<div style="padding: 4px;"><div style="font-weight: 600; margin-bottom: 4px;">${formattedDate}</div>`;

          // Reverse to show Passed first, then Failed
          [...params].reverse().forEach((param) => {
            html += `<div style="display: flex; align-items: center; margin: 2px 0;">`;
            html += `<span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background-color: ${param.color}; margin-right: 6px;"></span>`;
            html += `<span style="flex: 1;">${param.seriesName}:</span>`;
            html += `<span style="font-weight: 600; margin-left: 12px;">${param.value}</span>`;
            html += `</div>`;
          });

          html += `</div>`;
          return html;
        },
      },
      legend: {
        show: false,
      },
    };
  }, [chartData, isDarkMode]);

  // Handle chart click for date selection
  const onEvents = React.useMemo(() => ({
    click: (params: { componentType?: string; name?: string }) => {
      if (params.componentType === "series" && params.name && onDateClick) {
        onDateClick(params.name);
      }
    },
  }), [onDateClick]);

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Test Results</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            {chartMode === "recent"
              ? "Most recent test per serial number"
              : "All test results"}{" "}
            for {getTimeRangeDescription()}
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
        </CardDescription>
        <CardAction>
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
                {isGeneratingFailedData ? "Downloading..." : "Failed Test Data"}
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
              <ToggleGroup
                type="single"
                value={chartMode}
                onValueChange={onChartModeChange}
                variant="outline"
                className="*:data-[slot=toggle-group-item]:!px-3"
              >
                <ToggleGroupItem value="all">All Tests</ToggleGroupItem>
                <ToggleGroupItem value="recent">Latest per S/N</ToggleGroupItem>
              </ToggleGroup>
              <ToggleGroup
                type="single"
                value={timeRange}
                onValueChange={onTimeRangeChange}
                variant="outline"
                className="hidden *:data-[slot=toggle-group-item]:!px-4 @[767px]/card:flex"
              >
                <ToggleGroupItem value="all">All Time</ToggleGroupItem>
                <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
                <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
                <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
              </ToggleGroup>
              <Select value={timeRange} onValueChange={onTimeRangeChange}>
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
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {loading ? (
          <div className="flex items-center justify-center h-[250px]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : (
          <ReactECharts
            ref={chartRef}
            option={chartOption}
            style={{ height: "250px", width: "100%", cursor: "pointer" }}
            opts={{ renderer: "canvas" }}
            onEvents={onEvents}
            notMerge={false}
            lazyUpdate={true}
          />
        )}
      </CardContent>
    </Card>
  );
}
