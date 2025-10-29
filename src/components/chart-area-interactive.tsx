"use client";

import * as React from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
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
  ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
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

const chartConfig = {
  tests: {
    label: "Tests",
  },
  passed: {
    label: "Passed",
    color: "hsl(142.1 76.2% 36.3%)",
  },
  failed: {
    label: "Failed",
    color: "hsl(346.8 77.2% 49.8%)",
  },
} satisfies ChartConfig;

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

  React.useEffect(() => {
    if (isMobile && timeRange === "90d") {
      onTimeRangeChange("30d");
    }
  }, [isMobile, timeRange, onTimeRangeChange]);

  React.useEffect(() => {
    const fetchTestStats = async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/test-stats?chartMode=${chartMode}`);
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
  }, [chartMode]);

  const filteredData = chartData.filter((item) => {
    // Early return for all time - no filtering
    if (timeRange === "all") {
      return true;
    }

    const date = new Date(item.date);
    const referenceDate = new Date();

    // Determine days to subtract based on time range
    let daysToSubtract: number;
    switch (timeRange) {
      case "7d":
        daysToSubtract = 7;
        break;
      case "30d":
        daysToSubtract = 30;
        break;
      case "90d":
        daysToSubtract = 90;
        break;
      default:
        // Fallback to 90 days for any unexpected value
        daysToSubtract = 90;
    }

    const startDate = new Date(referenceDate);
    startDate.setDate(startDate.getDate() - daysToSubtract);
    return date >= startDate;
  });

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
          <ChartContainer
            config={chartConfig}
            className="aspect-auto h-[250px] w-full"
          >
            <AreaChart
              data={filteredData}
              onClick={(data) => {
                if (data && data.activeLabel && onDateClick) {
                  onDateClick(data.activeLabel);
                }
              }}
            >
              <defs>
                <linearGradient id="fillPassed" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-passed)"
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-passed)"
                    stopOpacity={0.1}
                  />
                </linearGradient>
                <linearGradient id="fillFailed" x1="0" y1="0" x2="0" y2="1">
                  <stop
                    offset="5%"
                    stopColor="var(--color-failed)"
                    stopOpacity={0.8}
                  />
                  <stop
                    offset="95%"
                    stopColor="var(--color-failed)"
                    stopOpacity={0.1}
                  />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={true} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) => {
                  const date = new Date(value + "T00:00:00");
                  return date.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  });
                }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                label={{
                  value: "Number of Tests",
                  angle: -90,
                  position: "insideLeft",
                  style: { textAnchor: "middle" },
                }}
              />
              <ChartTooltip
                cursor={false}
                defaultIndex={isMobile ? -1 : 10}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) => {
                      return new Date(value + "T00:00:00").toLocaleDateString(
                        "en-US",
                        {
                          month: "short",
                          day: "numeric",
                        },
                      );
                    }}
                    indicator="dot"
                  />
                }
              />
              <Area
                dataKey="failed"
                type="natural"
                fill="url(#fillFailed)"
                stroke="var(--color-failed)"
                stackId="a"
              />
              <Area
                dataKey="passed"
                type="natural"
                fill="url(#fillPassed)"
                stroke="var(--color-passed)"
                stackId="a"
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
