"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ReactECharts from "echarts-for-react";
import { Skeleton } from "@/components/ui/skeleton";
import { InfoTooltip } from "@/components/ui/info-tooltip";

interface FailureData {
  name: string;
  count: number;
  group_name?: string;
  group_color?: string | null;
  percentage_all: number;
  percentage_failed: number;
}

interface TimelineData {
  date: string;
  [key: string]: string | number;
}

interface FailureRateData {
  date: string;
  total: number;
  failed: number;
  passed: number;
  failureRate: number;
}

interface AnalyticsData {
  totalTests: number;
  totalFailedTests: number;
  categories: FailureData[];
  groups: FailureData[];
  categoryTimeline: TimelineData[];
  groupTimeline: TimelineData[];
  failureRateTimeline: FailureRateData[];
}

type PercentageMode = "all" | "failed";

type TimeGrouping = "daily" | "weekly" | "biweekly" | "monthly" | "quarterly";

export default function FailureAnalyticsPage() {
  const { resolvedTheme } = useTheme();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [percentageMode, setPercentageMode] = useState<PercentageMode>("failed");
  const [chartMode, setChartMode] = useState("recent"); // 'recent' or 'all'
  const [timeRange, setTimeRange] = useState("all");
  const [timeGrouping, setTimeGrouping] = useState<TimeGrouping>("daily");
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      // Only show full loading skeleton on initial load
      if (data === null) {
        setInitialLoading(true);
      } else {
        setRefetching(true);
      }

      try {
        const params = new URLSearchParams({
          chartMode,
          timeRange,
        });
        const response = await fetch(`/api/failure-analytics?${params}`);
        const result = await response.json();
        setData(result);
      } catch (error) {
        console.error("Error fetching failure analytics:", error);
      } finally {
        setInitialLoading(false);
        setRefetching(false);
      }
    };

    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartMode, timeRange]);

  // Determine available grouping options based on time range
  const getAvailableGroupings = (): TimeGrouping[] => {
    switch (timeRange) {
      case "90d": // Last 3mo
        return ["daily", "weekly", "biweekly", "monthly"];
      case "180d": // Last 6mo
        return ["daily", "weekly", "biweekly", "monthly", "quarterly"];
      case "365d": // Last year
        return ["daily", "weekly", "biweekly", "monthly", "quarterly"];
      case "all": // All time
        return ["daily", "weekly", "biweekly", "monthly", "quarterly"];
      default:
        return ["daily"];
    }
  };

  const availableGroupings = getAvailableGroupings();

  // Ensure current grouping is valid for the selected time range
  useEffect(() => {
    if (!availableGroupings.includes(timeGrouping)) {
      setTimeGrouping(availableGroupings[0]);
    }
  }, [timeRange, availableGroupings, timeGrouping]);

  if (initialLoading) {
    return (
      <div className="ml-10 px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold">Failure Analytics</h1>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-96" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="ml-10 px-6 py-6">
        <p>Failed to load failure analytics data.</p>
      </div>
    );
  }

  // Helper function to group data by time period
  const groupDataByTime = (timeline: TimelineData[], grouping: TimeGrouping): TimelineData[] => {
    if (grouping === "daily") return timeline;

    const grouped = new Map<string, Record<string, string | number>>();

    timeline.forEach(item => {
      const date = new Date(item.date);
      let groupKey: string;

      switch (grouping) {
        case "weekly":
          // Get start of week (Monday)
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay() + (date.getDay() === 0 ? -6 : 1));
          groupKey = weekStart.toISOString().split('T')[0];
          break;
        case "biweekly":
          // Get week number and divide by 2
          const weekNum = Math.floor((date.getTime() - new Date(date.getFullYear(), 0, 1).getTime()) / (7 * 24 * 60 * 60 * 1000));
          const biweekNum = Math.floor(weekNum / 2);
          const biweekStart = new Date(date.getFullYear(), 0, 1 + biweekNum * 14);
          groupKey = biweekStart.toISOString().split('T')[0];
          break;
        case "monthly":
          groupKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
          break;
        case "quarterly":
          const quarter = Math.floor(date.getMonth() / 3);
          groupKey = `${date.getFullYear()}-${String(quarter * 3 + 1).padStart(2, '0')}-01`;
          break;
        default:
          groupKey = item.date;
      }

      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, { date: groupKey });
      }

      const groupData = grouped.get(groupKey)!;
      Object.keys(item).forEach(key => {
        if (key !== 'date') {
          const currentValue = typeof groupData[key] === 'number' ? groupData[key] : 0;
          groupData[key] = currentValue + (item[key] as number);
        }
      });
    });

    return Array.from(grouped.values()).sort((a, b) => (a.date as string).localeCompare(b.date as string)) as TimelineData[];
  };

  // Helper function to format date labels based on grouping
  const formatDateLabel = (dateStr: string, grouping: TimeGrouping): string => {
    const date = new Date(dateStr);

    switch (grouping) {
      case "monthly":
        // Format as "Jan 2024"
        return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      case "quarterly":
        // Format as "Q1 2024"
        const quarter = Math.floor(date.getMonth() / 3) + 1;
        return `Q${quarter} ${date.getFullYear()}`;
      default:
        return dateStr;
    }
  };

  // Prepare pie chart data based on percentage mode
  const getCategoryPieData = () => {
    return data.categories.map(cat => ({
      name: cat.name,
      value: percentageMode === "all" ? cat.percentage_all : cat.percentage_failed,
    }));
  };

  const getGroupPieData = () => {
    // If a group is expanded, show categories within that group
    if (expandedGroup) {
      const categoriesInGroup = data.categories.filter(cat => cat.group_name === expandedGroup);
      return categoriesInGroup.map(cat => ({
        name: cat.name,
        value: percentageMode === "all" ? cat.percentage_all : cat.percentage_failed,
      }));
    }

    // Otherwise show top-level groups
    return data.groups.map(group => ({
      name: group.name,
      value: percentageMode === "all" ? group.percentage_all : group.percentage_failed,
      itemStyle: group.group_color ? { color: group.group_color } : undefined,
    }));
  };

  // Prepare timeline chart data
  const getCategoryTimelineOption = () => {
    const categories = Array.from(new Set(data.categories.map(c => c.name)));
    const groupedData = groupDataByTime(data.categoryTimeline, timeGrouping);

    return {
      title: {
        text: "Failures by Category Over Time",
        left: "center",
        textStyle: {
          color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
        },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: resolvedTheme === "dark" ? "rgba(30, 30, 30, 0.95)" : "rgba(255, 255, 255, 0.95)",
        borderColor: resolvedTheme === "dark" ? "#4b5563" : "#e5e7eb",
        textStyle: {
          color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
        },
        formatter: (params: Array<{ axisValue?: string; value: number; marker: string; seriesName: string }>) => {
          const date = params[0]?.axisValue || "";
          const lines = [`<strong>${date}</strong>`];

          // Only show categories with non-zero values
          params.forEach((param) => {
            if (param.value > 0) {
              lines.push(
                `${param.marker} ${param.seriesName}: <strong>${param.value}</strong>`
              );
            }
          });

          return lines.join("<br/>");
        },
      },
      legend: {
        data: categories,
        top: 30,
        type: "scroll",
        textStyle: {
          color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
        },
      },
      grid: { left: "3%", right: "4%", bottom: "3%", top: 80, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: true,
        data: groupedData.map(d => formatDateLabel(d.date as string, timeGrouping)),
        axisLabel: {
          rotate: timeGrouping === "daily" ? 45 : 0,
        },
      },
      yAxis: { type: "value", name: "Number of Incidents" },
      series: categories.map(category => ({
        name: category,
        type: "bar",
        data: groupedData.map(d => d[category] || 0),
        stack: "total",
      })),
    };
  };

  const getGroupTimelineOption = () => {
    const groups = Array.from(new Set(data.groups.map(g => g.name)));
    const groupedData = groupDataByTime(data.groupTimeline, timeGrouping);

    // Create a color map from group names to colors
    const groupColorMap: Record<string, string> = {};
    data.groups.forEach(g => {
      if (g.group_color) {
        groupColorMap[g.name] = g.group_color;
      }
    });

    return {
      title: {
        text: "Failures by Group Over Time",
        left: "center",
        textStyle: {
          color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
        },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: resolvedTheme === "dark" ? "rgba(30, 30, 30, 0.95)" : "rgba(255, 255, 255, 0.95)",
        borderColor: resolvedTheme === "dark" ? "#4b5563" : "#e5e7eb",
        textStyle: {
          color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
        },
        formatter: (params: Array<{ axisValue?: string; value: number; marker: string; seriesName: string }>) => {
          const date = params[0]?.axisValue || "";
          const lines = [`<strong>${date}</strong>`];

          // Only show groups with non-zero values
          params.forEach((param) => {
            if (param.value > 0) {
              lines.push(
                `${param.marker} ${param.seriesName}: <strong>${param.value}</strong>`
              );
            }
          });

          return lines.join("<br/>");
        },
      },
      legend: {
        data: groups,
        top: 30,
        textStyle: {
          color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
        },
      },
      grid: { left: "3%", right: "4%", bottom: "3%", top: 80, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: true,
        data: groupedData.map(d => formatDateLabel(d.date as string, timeGrouping)),
        axisLabel: {
          rotate: timeGrouping === "daily" ? 45 : 0,
        },
      },
      yAxis: { type: "value", name: "Number of Incidents" },
      series: groups.map(group => ({
        name: group,
        type: "bar",
        data: groupedData.map(d => d[group] || 0),
        stack: "total",
        itemStyle: groupColorMap[group] ? { color: groupColorMap[group] } : undefined,
      })),
    };
  };

  // Helper function to calculate moving average from raw counts
  const calculateMovingAverageFromCounts = (
    totals: number[],
    failures: number[],
    windowSize: number
  ): (number | null)[] => {
    const result: (number | null)[] = [];
    for (let i = 0; i < totals.length; i++) {
      if (i < windowSize - 1) {
        result.push(null);
      } else {
        const totalSum = totals.slice(i - windowSize + 1, i + 1).reduce((a, b) => a + b, 0);
        const failureSum = failures.slice(i - windowSize + 1, i + 1).reduce((a, b) => a + b, 0);
        result.push(totalSum > 0 ? (failureSum / totalSum) * 100 : 0);
      }
    }
    return result;
  };

  const getFailureRateTimelineOption = () => {
    const groupedData = groupDataByTime(
      data.failureRateTimeline.map(d => ({
        date: d.date,
        total: d.total,
        failed: d.failed,
        passed: d.passed,
      })),
      timeGrouping
    );

    // Extract totals and failures for moving average calculation
    const totals = groupedData.map(d => d.total as number);
    const failures = groupedData.map(d => d.failed as number);

    // Calculate failure rate for grouped data
    const failureRates = groupedData.map(d => {
      const total = d.total as number;
      const failed = d.failed as number;
      return total > 0 ? (failed / total) * 100 : 0;
    });

    // Calculate 7-period moving average (or fewer if less data available)
    const windowSize = Math.min(7, Math.max(3, Math.floor(failureRates.length / 4)));
    const movingAvg = calculateMovingAverageFromCounts(totals, failures, windowSize);

    return {
      title: {
        text: "Failure Rate Over Time",
        left: "center",
        textStyle: {
          color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
        },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: resolvedTheme === "dark" ? "rgba(30, 30, 30, 0.95)" : "rgba(255, 255, 255, 0.95)",
        borderColor: resolvedTheme === "dark" ? "#4b5563" : "#e5e7eb",
        textStyle: {
          color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
        },
        formatter: (params: Array<{ axisValue?: string; value: number; marker: string; seriesName: string }>) => {
          const date = params[0]?.axisValue || "";
          const lines = [`<strong>${date}</strong>`];

          params.forEach((param) => {
            if (param.value !== null && param.value !== undefined) {
              lines.push(
                `${param.marker} ${param.seriesName}: <strong>${param.value.toFixed(2)}%</strong>`
              );
            }
          });

          return lines.join("<br/>");
        },
      },
      legend: {
        data: ["Failure Rate", `${windowSize}-Period Moving Average`],
        top: 30,
        textStyle: {
          color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
        },
      },
      grid: { left: "3%", right: "4%", bottom: "3%", top: 80, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: groupedData.map(d => formatDateLabel(d.date as string, timeGrouping)),
        axisLabel: {
          rotate: timeGrouping === "daily" ? 45 : 0,
        },
      },
      yAxis: {
        type: "value",
        name: "Failure Rate (%)",
        min: 0,
        max: 100,
      },
      series: [
        {
          name: "Failure Rate",
          type: "line",
          data: failureRates,
          itemStyle: {
            color: "#ef4444",
          },
          lineStyle: {
            width: 2,
            opacity: 0.6,
          },
          symbol: "circle",
          symbolSize: 6,
        },
        {
          name: `${windowSize}-Period Moving Average`,
          type: "line",
          data: movingAvg,
          itemStyle: {
            color: "#3b82f6",
          },
          lineStyle: {
            width: 3,
          },
          symbol: "none",
          smooth: true,
        },
      ],
    };
  };

  const categoryPieOption = {
    title: {
      text: "Failures by Category",
      left: "center",
      textStyle: {
        color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
      },
    },
    tooltip: {
      trigger: "item",
      formatter: (params: { name: string; value: number; percent: number; seriesName: string }) => {
        return `${params.seriesName}<br/>${params.name}: ${params.value.toFixed(2)}%`;
      },
      backgroundColor: resolvedTheme === "dark" ? "rgba(30, 30, 30, 0.95)" : "rgba(255, 255, 255, 0.95)",
      borderColor: resolvedTheme === "dark" ? "#4b5563" : "#e5e7eb",
      textStyle: {
        color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
      },
    },
    legend: {
      orient: "vertical",
      left: "left",
      top: 30,
      type: "scroll",
      textStyle: {
        color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
      },
    },
    series: [
      {
        name: percentageMode === "all" ? "% of All Tests" : "% of Failed Tests",
        type: "pie",
        radius: "50%",
        data: getCategoryPieData(),
        label: {
          color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
          textShadowColor: "transparent",
          textShadowBlur: 0,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
          label: {
            show: true,
            fontSize: 14,
            fontWeight: "bold",
          },
        },
      },
    ],
  };

  const handleGroupChartClick = (params: { componentType?: string; name?: string }) => {
    if (!expandedGroup && params.componentType === 'series' && params.name) {
      // User clicked on a group slice - expand it
      setExpandedGroup(params.name);
    }
  };

  const handleGroupBackClick = () => {
    setExpandedGroup(null);
  };

  const groupPieOption = {
    title: {
      text: expandedGroup ? expandedGroup : "Failures by Group",
      left: "center",
      textStyle: {
        color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
      },
    },
    tooltip: {
      trigger: "item",
      formatter: (params: { name: string; value: number; percent: number; seriesName: string }) => {
        return `${params.seriesName}<br/>${params.name}: ${params.value.toFixed(2)}%`;
      },
      backgroundColor: resolvedTheme === "dark" ? "rgba(30, 30, 30, 0.95)" : "rgba(255, 255, 255, 0.95)",
      borderColor: resolvedTheme === "dark" ? "#4b5563" : "#e5e7eb",
      textStyle: {
        color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
      },
    },
    legend: {
      orient: "vertical",
      left: "left",
      top: 30,
      textStyle: {
        color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
      },
    },
    series: [
      {
        name: percentageMode === "all" ? "% of All Tests" : "% of Failed Tests",
        type: "pie",
        radius: "50%",
        data: getGroupPieData(),
        label: {
          color: resolvedTheme === "dark" ? "#e5e7eb" : "#374151",
          textShadowColor: "transparent",
          textShadowBlur: 0,
        },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
          label: {
            show: true,
            fontSize: 14,
            fontWeight: "bold",
          },
        },
      },
    ],
  };

  return (
    <div className="ml-10 px-6 py-6 space-y-6">
      {/* Header - Never re-renders */}
      <div className="sticky top-0 z-10 bg-background pb-4 -mx-6 px-6 pt-6 -mt-6 flex items-center justify-between flex-wrap gap-6 shadow-sm">
        <h1 className="text-3xl font-bold">Failure Analytics</h1>
        <div className="flex gap-6 items-center flex-wrap">
          {/* Chart Mode Toggle */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-muted-foreground min-w-[50px]">Mode</span>
              <InfoTooltip content={
                <>
                  <strong>Latest per S/N:</strong> Analyzes only the most recent test for each serial number.
                  <br />
                  <strong>All Tests:</strong> Includes every test run in the analysis.
                </>
              } side="bottom" />
            </div>
            <ToggleGroup
              type="single"
              value={chartMode}
              onValueChange={(value) => value && setChartMode(value)}
              className="gap-1 bg-muted/50 p-1 rounded-lg"
            >
              <ToggleGroupItem
                value="recent"
                className="data-[state=on]:bg-background data-[state=on]:shadow-sm hover:bg-muted transition-all px-4 py-2"
              >
                Latest per S/N
              </ToggleGroupItem>
              <ToggleGroupItem
                value="all"
                className="data-[state=on]:bg-background data-[state=on]:shadow-sm hover:bg-muted transition-all px-4 py-2"
              >
                All Tests
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* Time Range Toggle */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground min-w-[50px]">Period</span>
            <ToggleGroup
              type="single"
              value={timeRange}
              onValueChange={(value) => value && setTimeRange(value)}
              className="gap-1 bg-muted/50 p-1 rounded-lg"
            >
              <ToggleGroupItem
                value="all"
                className="data-[state=on]:bg-background data-[state=on]:shadow-sm hover:bg-muted transition-all px-3 py-2"
              >
                All time
              </ToggleGroupItem>
              <ToggleGroupItem
                value="90d"
                className="data-[state=on]:bg-background data-[state=on]:shadow-sm hover:bg-muted transition-all px-3 py-2"
              >
                Last 3mo
              </ToggleGroupItem>
              <ToggleGroupItem
                value="180d"
                className="data-[state=on]:bg-background data-[state=on]:shadow-sm hover:bg-muted transition-all px-3 py-2"
              >
                Last 6mo
              </ToggleGroupItem>
              <ToggleGroupItem
                value="365d"
                className="data-[state=on]:bg-background data-[state=on]:shadow-sm hover:bg-muted transition-all px-3 py-2"
              >
                Last year
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          {/* Percentage Mode Toggle */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-muted-foreground min-w-[80px]">Percentage</span>
              <InfoTooltip content={
                <>
                  <strong>Affects pie chart labels/tooltips only.</strong>
                  <br /><br />
                  Changes the percentage values shown, but not the visual slice sizes (relative proportions remain the same).
                  <br /><br />
                  <strong>% of Failed:</strong> Shows each category as a percentage of all failed tests.
                  <br />
                  <strong>% of All:</strong> Shows each category as a percentage of all tests (passed + failed).
                </>
              } side="bottom" />
            </div>
            <div className="flex gap-1 bg-muted/50 p-1 rounded-lg">
              <Button
                variant={percentageMode === "failed" ? "default" : "ghost"}
                size="sm"
                onClick={() => setPercentageMode("failed")}
                className={percentageMode === "failed" ? "shadow-sm" : "hover:bg-muted"}
              >
                % of Failed
              </Button>
              <Button
                variant={percentageMode === "all" ? "default" : "ghost"}
                size="sm"
                onClick={() => setPercentageMode("all")}
                className={percentageMode === "all" ? "shadow-sm" : "hover:bg-muted"}
              >
                % of All
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content area with transition */}
      <div className={`transition-opacity duration-300 ${refetching ? "opacity-50" : "opacity-100"}`}>
        {/* Stats Cards */}
        <div className="grid gap-6 md:grid-cols-3 mb-6">
        <Card className="p-6">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {chartMode === "recent" ? "Unique Inverters" : "Total Tests"}
            </p>
            <p className="text-3xl font-bold">{data.totalTests.toLocaleString()}</p>
          </div>
        </Card>
        <Card className="p-6">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Failed {chartMode === "recent" ? "(Most Recent)" : ""}
            </p>
            <p className="text-3xl font-bold">{data.totalFailedTests.toLocaleString()}</p>
          </div>
        </Card>
        <Card className="p-6">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Failure Rate</p>
            <p className="text-3xl font-bold">
              {data.totalTests > 0
                ? ((data.totalFailedTests / data.totalTests) * 100).toFixed(1)
                : 0}%
            </p>
          </div>
        </Card>
        </div>

        {/* Pie Charts */}
        <div className="grid gap-6 md:grid-cols-2 mb-6">
          <Card className="p-6">
            <ReactECharts option={categoryPieOption} style={{ height: "400px" }} />
          </Card>
          <Card className="p-6 relative">
            {expandedGroup && (
              <button
                onClick={handleGroupBackClick}
                className="absolute top-4 right-4 text-sm text-primary hover:underline z-10"
              >
                ← Back to Groups
              </button>
            )}
            <ReactECharts
              option={groupPieOption}
              style={{ height: "400px" }}
              onEvents={{
                click: handleGroupChartClick,
              }}
            />
            {!expandedGroup && (
              <p className="text-xs text-muted-foreground text-center mt-2">
                Click a slice to view categories
              </p>
            )}
          </Card>
        </div>

        {/* Timeline Charts */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Timeline Analysis</h3>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-muted-foreground">Group by:</span>
                <InfoTooltip content="Groups test data by time period. Daily shows each day separately. Weekly, biweekly, monthly, and quarterly combine data into larger time buckets for easier trend analysis." side="left" />
              </div>
              <Select value={timeGrouping} onValueChange={(value) => setTimeGrouping(value as TimeGrouping)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableGroupings.map((grouping) => (
                    <SelectItem key={grouping} value={grouping}>
                      {grouping.charAt(0).toUpperCase() + grouping.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-6 md:grid-cols-1">
            <Card className="p-6">
              <ReactECharts option={getCategoryTimelineOption()} style={{ height: "400px" }} />
            </Card>
            <Card className="p-6">
              <ReactECharts option={getGroupTimelineOption()} style={{ height: "400px" }} />
            </Card>
            <Card className="p-6">
              <ReactECharts option={getFailureRateTimelineOption()} style={{ height: "400px" }} />
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
