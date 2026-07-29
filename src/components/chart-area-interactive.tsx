"use client";

import * as React from "react";
import ReactECharts from "echarts-for-react";
import type {
  EChartsOption,
  TooltipComponentFormatterCallbackParams,
} from "echarts";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type DashboardRange,
  dashboardRangeLabel,
} from "@/lib/dashboard-range";
import {
  burninChartColors,
  formatBucketLabel,
  type ChartBucket,
} from "@/lib/chart-theme";
import {
  volumeSeriesFromBuckets,
  type BucketStats,
} from "@/hooks/useBucketStats";

export const description = "Burnin Pass/Fail Results";

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
  dashboardRange: DashboardRange;
  annotationFilter: string;
  highlightDate?: string;
  bucket: ChartBucket;
  onBucketChange: (bucket: ChartBucket) => void;
  /** Shared bucket stats from page. */
  data: BucketStats[];
  /** Initial load only — do not unmount chart on period refresh. */
  loading: boolean;
  /** Soft refetch with previous series still visible. */
  refreshing?: boolean;
}

const FAILED_SERIES_NAME = "Failed (right scale)";

export function ChartAreaInteractive({
  onDateClick,
  chartMode,
  dashboardRange,
  annotationFilter,
  highlightDate,
  bucket,
  onBucketChange,
  data,
  loading,
  refreshing = false,
}: ChartAreaInteractiveProps) {
  const [isDarkMode, setIsDarkMode] = React.useState(false);
  const chartRef = React.useRef<ReactECharts>(null);

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

  // Volume only: drop strip-only empty buckets (FULL OUTER JOIN zeros under annotation)
  const chartData = React.useMemo(
    () => volumeSeriesFromBuckets(data),
    [data],
  );

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
            if (param.seriesName === "Passed")
              passed = Number(param.value) || 0;
            if (
              param.seriesName === FAILED_SERIES_NAME ||
              param.seriesName === "Failed"
            ) {
              failed = Number(param.value) || 0;
            }
          });
          const total = passed + failed;
          const rate =
            total > 0 ? ((failed / total) * 100).toFixed(1) : "0.0";

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

  // Day and multi-day buckets both drill via onDateClick; page uses bucketRange()
  // for non-day spans (linked → promote dashboardRange; unlinked → table only).
  const onEvents = React.useMemo(
    () => ({
      click: (params: { componentType?: string; name?: string }) => {
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
    [onDateClick],
  );

  const modeCaption =
    chartMode === "recent"
      ? "Each bar is the latest test per inverter in that period (an inverter can appear in more than one week/month)."
      : "Every test run in each period.";

  const annotationCaption =
    annotationFilter && annotationFilter !== "all"
      ? "Chart shows only tests tagged with the current annotation filter. Failure rate at top uses tagged failures ÷ all tests."
      : null;

  return (
    <Card className="@container/card">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Test volume</CardTitle>
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
              ? "Latest result per inverter"
              : "All test results"}{" "}
            per {bucket} for {dashboardRangeLabel(dashboardRange)}
          </span>
          <span className="@[540px]/card:hidden">
            {chartMode === "recent" ? "Latest per inverter" : "All tests"} ·{" "}
            {dashboardRangeLabel(dashboardRange)}
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
          <div className="flex items-center justify-end gap-2">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Group by
            </span>
            <ToggleGroup
              type="single"
              value={bucket}
              onValueChange={(value) => {
                if (value) onBucketChange(value as ChartBucket);
              }}
              variant="outline"
              className="*:data-[slot=toggle-group-item]:!px-3 *:data-[slot=toggle-group-item]:h-10"
            >
              {BUCKET_OPTIONS.map((option) => (
                <ToggleGroupItem key={option.value} value={option.value}>
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-2 sm:px-6 sm:pt-3">
        {/*
          Keep a single mount for the plot: skeleton only on first load.
          Period changes update `option` in place (ECharts animates series).
        */}
        {loading && chartData.length === 0 ? (
          <div
            className="flex h-[320px] flex-col justify-end gap-2 rounded-md bg-muted/20 px-3 py-4"
            aria-hidden
          >
            <div className="flex flex-1 items-end gap-2">
              {Array.from({ length: 14 }).map((_, i) => (
                <div
                  key={i}
                  className="flex-1 animate-pulse rounded-t-md bg-muted"
                  style={{
                    height: `${35 + ((i * 23) % 55)}%`,
                    opacity: 0.5 + (i % 4) * 0.1,
                  }}
                />
              ))}
            </div>
            <div className="flex justify-between gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="h-2.5 flex-1 animate-pulse rounded bg-muted/80"
                />
              ))}
            </div>
          </div>
        ) : (
          <div
            className={
              refreshing
                ? "opacity-60 transition-opacity duration-200"
                : "opacity-100 transition-opacity duration-200"
            }
          >
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
              // Replace option data without remounting the chart instance/card
              notMerge={true}
              lazyUpdate={true}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
