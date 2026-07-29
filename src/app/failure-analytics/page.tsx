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
import { IconAlertTriangle, IconCircleX, IconClipboardList } from "@tabler/icons-react";
import { burninChartColors, burninSeriesPalette } from "@/lib/chart-theme";

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

const tooltipCss = "border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,0.15);";

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

  const isDark = resolvedTheme === "dark";
  const textColor = isDark ? burninChartColors.text.dark : burninChartColors.text.light;
  const mutedColor = isDark ? burninChartColors.muted.dark : burninChartColors.muted.light;
  const gridColor = isDark ? burninChartColors.grid.dark : burninChartColors.grid.light;
  const emptyChartGraphic = (message: string) => [
    {
      type: "text" as const,
      left: "center" as const,
      top: "middle" as const,
      style: { text: message, fontSize: 14, fill: mutedColor },
    },
  ];

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
    const isEmpty = categories.length === 0 || groupedData.length === 0;

    return {
      color: [...burninSeriesPalette],
      title: {
        text: "Failures by Category Over Time",
        left: "center",
        textStyle: { color: textColor },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "rgba(24, 24, 27, 0.92)" : "rgba(255, 255, 255, 0.95)",
        borderColor: isDark ? "rgba(148, 163, 184, 0.25)" : "rgba(100, 116, 139, 0.2)",
        padding: [10, 14],
        extraCssText: tooltipCss,
        textStyle: { color: textColor },
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
        textStyle: { color: textColor },
      },
      graphic: isEmpty ? emptyChartGraphic("No failures in this range") : [],
      grid: { left: "3%", right: "4%", bottom: "3%", top: 80, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: true,
        data: groupedData.map(d => formatDateLabel(d.date as string, timeGrouping)),
        axisLabel: {
          rotate: timeGrouping === "daily" ? 45 : 0,
          hideOverlap: true,
          color: mutedColor,
        },
      },
      yAxis: {
        type: "value",
        name: "Number of Incidents",
        nameTextStyle: { color: mutedColor },
        axisLabel: { color: mutedColor },
        splitLine: { lineStyle: { color: gridColor } },
      },
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
    const isEmpty = groups.length === 0 || groupedData.length === 0;

    // Create a color map from group names to colors
    const groupColorMap: Record<string, string> = {};
    data.groups.forEach(g => {
      if (g.group_color) {
        groupColorMap[g.name] = g.group_color;
      }
    });

    return {
      color: [...burninSeriesPalette],
      title: {
        text: "Failures by Group Over Time",
        left: "center",
        textStyle: { color: textColor },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "rgba(24, 24, 27, 0.92)" : "rgba(255, 255, 255, 0.95)",
        borderColor: isDark ? "rgba(148, 163, 184, 0.25)" : "rgba(100, 116, 139, 0.2)",
        padding: [10, 14],
        extraCssText: tooltipCss,
        textStyle: { color: textColor },
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
        textStyle: { color: textColor },
      },
      graphic: isEmpty ? emptyChartGraphic("No failures in this range") : [],
      grid: { left: "3%", right: "4%", bottom: "3%", top: 80, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: true,
        data: groupedData.map(d => formatDateLabel(d.date as string, timeGrouping)),
        axisLabel: {
          rotate: timeGrouping === "daily" ? 45 : 0,
          hideOverlap: true,
          color: mutedColor,
        },
      },
      yAxis: {
        type: "value",
        name: "Number of Incidents",
        nameTextStyle: { color: mutedColor },
        axisLabel: { color: mutedColor },
        splitLine: { lineStyle: { color: gridColor } },
      },
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
    const isEmpty = groupedData.length === 0;

    return {
      title: {
        text: "Failure Rate Over Time",
        left: "center",
        textStyle: { color: textColor },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: isDark ? "rgba(24, 24, 27, 0.92)" : "rgba(255, 255, 255, 0.95)",
        borderColor: isDark ? "rgba(148, 163, 184, 0.25)" : "rgba(100, 116, 139, 0.2)",
        padding: [10, 14],
        extraCssText: tooltipCss,
        textStyle: { color: textColor },
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
        textStyle: { color: textColor },
      },
      graphic: isEmpty ? emptyChartGraphic("No failures in this range") : [],
      grid: { left: "3%", right: "4%", bottom: "3%", top: 80, containLabel: true },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: groupedData.map(d => formatDateLabel(d.date as string, timeGrouping)),
        axisLabel: {
          rotate: timeGrouping === "daily" ? 45 : 0,
          hideOverlap: true,
          color: mutedColor,
        },
      },
      yAxis: {
        type: "value",
        name: "Failure Rate (%)",
        min: 0,
        // No fixed max: failure rates live in the low single digits and a
        // 0-100 scale flattened the trend into the x-axis
        nameTextStyle: { color: mutedColor },
        axisLabel: { color: mutedColor, formatter: "{value}%" },
        splitLine: { lineStyle: { color: gridColor } },
      },
      series: [
        {
          name: "Failure Rate",
          type: "line",
          data: failureRates,
          itemStyle: {
            color: burninChartColors.failed.base,
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
            color: burninChartColors.accent.indigo,
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

  const categoryPieData = getCategoryPieData();
  const categoryPieOption = {
    color: [...burninSeriesPalette],
    title: {
      text: "Failures by Category",
      left: "center",
      textStyle: { color: textColor },
    },
    tooltip: {
      trigger: "item",
      formatter: (params: { name: string; value: number; percent: number; seriesName: string }) => {
        return `${params.seriesName}<br/>${params.name}: ${params.value.toFixed(2)}%`;
      },
      backgroundColor: isDark ? "rgba(24, 24, 27, 0.92)" : "rgba(255, 255, 255, 0.95)",
      borderColor: isDark ? "rgba(148, 163, 184, 0.25)" : "rgba(100, 116, 139, 0.2)",
      padding: [10, 14],
      extraCssText: tooltipCss,
      textStyle: { color: textColor },
    },
    legend: {
      orient: "vertical",
      left: "left",
      top: 30,
      type: "scroll",
      textStyle: { color: textColor },
    },
    graphic: categoryPieData.length === 0 ? emptyChartGraphic("No failures in this range") : [],
    series: [
      {
        name: percentageMode === "all" ? "% of All Tests" : "% of Failed Tests",
        type: "pie",
        // Donut without per-slice labels: with ~20 categories the outward
        // labels overlap into noise — the legend and tooltip carry the names
        radius: ["42%", "68%"],
        center: ["58%", "55%"],
        itemStyle: {
          borderRadius: 4,
          borderColor: isDark ? "#18181b" : "#ffffff",
          borderWidth: 2,
        },
        data: categoryPieData,
        label: { show: false },
        labelLine: { show: false },
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
          // Keep labels off on hover — legend + tooltip identify slices;
          // unstyled emphasis labels flash poorly on dark slices
          label: { show: false },
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

  const groupPieData = getGroupPieData();
  // Fewer group slices keep labels; drill-down categories can grow large
  const hideGroupSliceLabels = groupPieData.length > 8;
  const groupPieOption = {
    color: [...burninSeriesPalette],
    title: {
      text: expandedGroup ? expandedGroup : "Failures by Group",
      left: "center",
      textStyle: { color: textColor },
    },
    tooltip: {
      trigger: "item",
      formatter: (params: { name: string; value: number; percent: number; seriesName: string }) => {
        return `${params.seriesName}<br/>${params.name}: ${params.value.toFixed(2)}%`;
      },
      backgroundColor: isDark ? "rgba(24, 24, 27, 0.92)" : "rgba(255, 255, 255, 0.95)",
      borderColor: isDark ? "rgba(148, 163, 184, 0.25)" : "rgba(100, 116, 139, 0.2)",
      padding: [10, 14],
      extraCssText: tooltipCss,
      textStyle: { color: textColor },
    },
    legend: {
      orient: "vertical",
      left: "left",
      top: 30,
      textStyle: { color: textColor },
    },
    graphic: groupPieData.length === 0 ? emptyChartGraphic("No failures in this range") : [],
    series: [
      {
        name: percentageMode === "all" ? "% of All Tests" : "% of Failed Tests",
        type: "pie",
        radius: ["42%", "68%"],
        center: ["55%", "55%"],
        itemStyle: {
          borderRadius: 4,
          borderColor: isDark ? "#18181b" : "#ffffff",
          borderWidth: 2,
        },
        data: groupPieData,
        label: hideGroupSliceLabels
          ? { show: false }
          : {
              color: textColor,
              formatter: "{b}\n{c}%",
              textShadowColor: "transparent",
              textShadowBlur: 0,
            },
        labelLine: hideGroupSliceLabels ? { show: false } : undefined,
        emphasis: {
          itemStyle: {
            shadowBlur: 10,
            shadowOffsetX: 0,
            shadowColor: "rgba(0, 0, 0, 0.5)",
          },
          label: hideGroupSliceLabels
            ? { show: false }
            : {
                show: true,
                fontSize: 14,
                fontWeight: "bold",
                color: textColor,
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
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <IconClipboardList className="size-4" />
              {chartMode === "recent" ? "Unique Inverters" : "Total Tests"}
            </p>
            <p className="text-3xl font-bold tabular-nums">{data.totalTests.toLocaleString()}</p>
          </div>
        </Card>
        <Card className="p-6">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <IconCircleX className="size-4 text-rose-500" />
              Failed {chartMode === "recent" ? "(Most Recent)" : ""}
            </p>
            <p className={`text-3xl font-bold tabular-nums ${data.totalFailedTests > 0 ? "text-rose-600 dark:text-rose-400" : ""}`}>
              {data.totalFailedTests.toLocaleString()}
            </p>
          </div>
        </Card>
        <Card className="p-6">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <IconAlertTriangle className="size-4 text-amber-500" />
              Failure Rate
            </p>
            <p className={`text-3xl font-bold tabular-nums ${data.totalFailedTests > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400"}`}>
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
