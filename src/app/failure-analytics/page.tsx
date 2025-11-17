"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ReactECharts from "echarts-for-react";
import { Skeleton } from "@/components/ui/skeleton";

interface FailureData {
  name: string;
  count: number;
  group_color?: string | null;
  percentage_all: number;
  percentage_failed: number;
}

interface TimelineData {
  date: string;
  [key: string]: string | number;
}

interface AnalyticsData {
  totalTests: number;
  totalFailedTests: number;
  categories: FailureData[];
  groups: FailureData[];
  categoryTimeline: TimelineData[];
  groupTimeline: TimelineData[];
}

type PercentageMode = "all" | "failed";

type TimeGrouping = "daily" | "weekly" | "biweekly" | "monthly" | "quarterly";

export default function FailureAnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refetching, setRefetching] = useState(false);
  const [percentageMode, setPercentageMode] = useState<PercentageMode>("failed");
  const [chartMode, setChartMode] = useState("recent"); // 'recent' or 'all'
  const [timeRange, setTimeRange] = useState("all");
  const [timeGrouping, setTimeGrouping] = useState<TimeGrouping>("daily");

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

    const grouped = new Map<string, Record<string, number>>();

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
          groupData[key] = (groupData[key] || 0) + (item[key] as number);
        }
      });
    });

    return Array.from(grouped.values()).sort((a, b) => a.date.localeCompare(b.date));
  };

  // Prepare pie chart data based on percentage mode
  const getCategoryPieData = () => {
    return data.categories.map(cat => ({
      name: cat.name,
      value: percentageMode === "all" ? cat.percentage_all : cat.percentage_failed,
    }));
  };

  const getGroupPieData = () => {
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
      title: { text: "Failures by Category Over Time", left: "center" },
      tooltip: {
        trigger: "axis",
        formatter: (params: any) => {
          const date = params[0]?.axisValue || "";
          const lines = [`<strong>${date}</strong>`];

          // Only show categories with non-zero values
          params.forEach((param: any) => {
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
      },
      grid: { left: "3%", right: "4%", bottom: "3%", top: 80, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: true,
        data: groupedData.map(d => d.date),
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
      title: { text: "Failures by Group Over Time", left: "center" },
      tooltip: {
        trigger: "axis",
        formatter: (params: any) => {
          const date = params[0]?.axisValue || "";
          const lines = [`<strong>${date}</strong>`];

          // Only show groups with non-zero values
          params.forEach((param: any) => {
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
      },
      grid: { left: "3%", right: "4%", bottom: "3%", top: 80, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: true,
        data: groupedData.map(d => d.date),
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

  const categoryPieOption = {
    title: { text: "Failures by Category", left: "center" },
    tooltip: {
      trigger: "item",
      formatter: "{a} <br/>{b}: {c}%",
    },
    legend: {
      orient: "vertical",
      left: "left",
      top: 30,
      type: "scroll",
    },
    series: [
      {
        name: percentageMode === "all" ? "% of All Tests" : "% of Failed Tests",
        type: "pie",
        radius: "50%",
        data: getCategoryPieData(),
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },
      },
    ],
  };

  const groupPieOption = {
    title: { text: "Failures by Group", left: "center" },
    tooltip: {
      trigger: "item",
      formatter: "{a} <br/>{b}: {c}%",
    },
    legend: {
      orient: "vertical",
      left: "left",
      top: 30,
    },
    series: [
      {
        name: percentageMode === "all" ? "% of All Tests" : "% of Failed Tests",
        type: "pie",
        radius: "50%",
        data: getGroupPieData(),
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
        },
      },
    ],
  };

  return (
    <div className="ml-10 px-6 py-6 space-y-6">
      {/* Header - Never re-renders */}
      <div className="flex items-center justify-between flex-wrap gap-6">
        <h1 className="text-3xl font-bold">Failure Analytics</h1>
        <div className="flex gap-6 items-center flex-wrap">
          {/* Chart Mode Toggle */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground min-w-[50px]">Mode</span>
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
            <span className="text-sm font-medium text-muted-foreground min-w-[80px]">Percentage</span>
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
          <Card className="p-6">
            <ReactECharts option={groupPieOption} style={{ height: "400px" }} />
          </Card>
        </div>

        {/* Timeline Charts */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">Timeline Analysis</h3>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Group by:</span>
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
          </div>
        </div>
      </div>
    </div>
  );
}
