"use client";

import * as React from "react";
import ReactECharts from "echarts-for-react";
import type {
  EChartsOption,
  TooltipComponentFormatterCallbackParams,
} from "echarts";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  type DashboardRange,
  allowedBucketsForRange,
  dashboardRangeLabel,
} from "@/lib/dashboard-range";
import {
  burninChartColors,
  chartEnterAnimation,
  chartSeriesDelay,
  formatBucketLabel,
  useCommittedChartOption,
  useCommittedSeriesKey,
  useSeriesRevealClass,
  type ChartBucket,
} from "@/lib/chart-theme";
import {
  fillContinuousDayBuckets,
  hasDayAxisGaps,
  shouldFillContinuousDays,
  volumeSeriesFromBuckets,
  type BucketStats,
} from "@/hooks/useBucketStats";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

/** Bucket total below this is treated as thin sample (opacity + tooltip cue). */
const LOW_SAMPLE_N = 10;
/** Failure rate at/above this (%) gets stronger point emphasis + bold rate row. */
const HIGH_RATE_PCT = 5;

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

const FAILED_SERIES_NAME = "Failed";

/**
 * Fail marker size from rate / low-n risk (B1).
 * Zero fails → 0 (hidden); high rate or thin sample → larger markers.
 */
function failSymbolSize(failed: number, total: number): number {
  if (failed <= 0) return 0;
  const rate = total > 0 ? (failed / total) * 100 : 0;
  let size = 7;
  if (rate >= HIGH_RATE_PCT) size += 3;
  if (total > 0 && total < LOW_SAMPLE_N) size += 2;
  if (rate >= HIGH_RATE_PCT * 2) size += 2; // very high rate (e.g. ≥10%)
  return Math.min(size, 14);
}

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
  // Sync read on first paint so theme doesn't flip option after mount
  // (notMerge redraw = second flash on empty→data).
  const [isDarkMode, setIsDarkMode] = React.useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );
  const chartRef = React.useRef<ReactECharts>(null);
  const isMobile = useIsMobile();
  const chartHeightPx = isMobile ? 360 : 320;

  React.useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    };
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Volume only: drop strip-only empty buckets (FULL OUTER JOIN zeros under annotation),
  // then fill calendar gaps on day bucket so Jul 8 → Jul 16 never looks adjacent.
  const chartData = React.useMemo(
    () =>
      fillContinuousDayBuckets(
        volumeSeriesFromBuckets(data),
        dashboardRange,
        bucket,
      ),
    [data, dashboardRange, bucket],
  );

  const continuousDays = shouldFillContinuousDays(dashboardRange, bucket);
  const activeDaysOnly =
    bucket === "day" &&
    !continuousDays &&
    hasDayAxisGaps(volumeSeriesFromBuckets(data));

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

    const maxFailed = chartData.reduce(
      (m, item) => Math.max(m, item.failed || 0),
      0,
    );
    // Integer right scale: at least 1, slight headroom so the top tick isn't flush
    const failAxisMax = Math.max(1, maxFailed === 0 ? 1 : Math.ceil(maxFailed * 1.15));
    // Soft / no pink wash when absolute fails are tiny (avoids 1–2 fails looking huge)
    const failAreaTopAlpha =
      maxFailed <= 0 ? 0 : maxFailed <= 3 ? 0.04 : maxFailed <= 8 ? 0.09 : 0.14;

    const passBarData = chartData.map((item) => {
      const total = (item.passed || 0) + (item.failed || 0);
      const lowSample = total > 0 && total < LOW_SAMPLE_N;
      return {
        value: item.passed,
        itemStyle: {
          opacity: lowSample ? 0.55 : 1,
          borderRadius: [5, 5, 0, 0] as [number, number, number, number],
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
      };
    });

    const failLineData = chartData.map((item) => {
      const total = (item.passed || 0) + (item.failed || 0);
      const failed = item.failed || 0;
      const rate = total > 0 ? (failed / total) * 100 : 0;
      const highRate = rate >= HIGH_RATE_PCT;
      return {
        value: failed,
        symbolSize: failSymbolSize(failed, total),
        itemStyle: {
          color: colors.failed.base,
          borderColor: isDarkMode ? "#18181b" : "#ffffff",
          borderWidth: highRate ? 3 : 2,
        },
      };
    });

    return {
      ...chartEnterAnimation,
      backgroundColor: "transparent",
      textStyle: {
        color: textColor,
        fontFamily: "var(--font-geist-sans), sans-serif",
      },
      grid: {
        left: isMobile ? 40 : 56,
        right: isMobile ? 40 : 56,
        bottom: isMobile ? 28 : 36,
        top: isMobile ? 36 : 44,
        containLabel: false,
      },
      // O42: legend pinned top-left of plot (avoids collision with tall bars)
      legend: {
        show: true,
        top: 0,
        left: 0,
        icon: "roundRect",
        itemWidth: isMobile ? 10 : 12,
        itemHeight: isMobile ? 10 : 12,
        itemGap: isMobile ? 12 : 20,
        textStyle: { color: textColor, fontSize: isMobile ? 11 : 12 },
        data: ["Passed", FAILED_SERIES_NAME],
      },
      xAxis: {
        type: "category",
        data: chartData.map((item) => item.date),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: mutedColor,
          margin: isMobile ? 8 : 12,
          interval: "auto",
          hideOverlap: true,
          fontSize: isMobile ? 10 : 12,
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
          axisLabel: {
            color: colors.passed.base,
            margin: isMobile ? 6 : 10,
            fontSize: isMobile ? 10 : 12,
          },
          splitLine: {
            lineStyle: { color: gridColor, type: "solid" as const },
          },
        },
        {
          type: "value",
          min: 0,
          max: failAxisMax,
          minInterval: 1,
          // Prefer integer ticks; do not force align with left (pass) scale
          alignTicks: false,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: {
            color: colors.failed.base,
            margin: isMobile ? 6 : 10,
            fontSize: isMobile ? 10 : 12,
            formatter: (v: number) => String(Math.round(v)),
          },
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
                  text: "No test activity in this range",
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
          // Series-level color so the legend stays green when per-bar itemStyle
          // only carries gradient/opacity (ECharts otherwise falls back to palette).
          color: colors.passed.base,
          data: passBarData,
          barMaxWidth: 36,
          // Paint bars left → right on enter (range / bucket change)
          animationDelay: (idx: number) => chartSeriesDelay(idx, 28),
          animationEasing: "cubicOut",
          emphasis: {
            itemStyle: {
              color: colors.passed.base,
              opacity: 1,
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
          color: colors.failed.base,
          data: failLineData,
          smooth: 0.3,
          symbol: "circle",
          // Default; per-point symbolSize on data objects overrides (0 when no fails)
          symbolSize: 7,
          showSymbol: true,
          showAllSymbol: true,
          z: 10,
          animationDelay: (idx: number) => chartSeriesDelay(idx, 24),
          animationEasing: "cubicOut",
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
          areaStyle:
            maxFailed <= 0
              ? undefined
              : {
                  color: {
                    type: "linear" as const,
                    x: 0,
                    y: 0,
                    x2: 0,
                    y2: 1,
                    colorStops: [
                      { offset: 0, color: colors.failed.soft(failAreaTopAlpha) },
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
            // Per-point objects expose { value }; plain numbers work as-is
            const raw = param.value;
            const num =
              typeof raw === "object" && raw !== null && "value" in (raw as object)
                ? Number((raw as { value: number }).value)
                : Number(raw);
            if (param.seriesName === "Passed") passed = num || 0;
            if (param.seriesName === FAILED_SERIES_NAME) failed = num || 0;
          });
          const total = passed + failed;
          const rateNum = total > 0 ? (failed / total) * 100 : 0;
          const rate = rateNum.toFixed(1);
          const lowSample = total > 0 && total < LOW_SAMPLE_N;
          const highRate = rateNum >= HIGH_RATE_PCT;

          const row = (
            dot: string,
            label: string,
            value: string,
            bold = false,
            valueColor?: string,
          ) =>
            `<div style="display:flex; align-items:center; gap:8px; margin:3px 0;">` +
            `${dot}<span style="flex:1; opacity:0.85;">${label}</span>` +
            `<span style="font-weight:${bold ? 700 : 600}; margin-left:16px; font-variant-numeric:tabular-nums;${valueColor ? ` color:${valueColor};` : ""}">${value}</span></div>`;

          const dot = (color: string) =>
            `<span style="display:inline-block; width:9px; height:9px; border-radius:3px; background:${color};"></span>`;
          const spacerDot = `<span style="display:inline-block; width:9px; height:9px;"></span>`;

          const lowSampleBadge = lowSample
            ? `<div style="margin:6px 0 2px; display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600; background:${isDarkMode ? "rgba(251,191,36,0.15)" : "rgba(245,158,11,0.12)"}; color:${isDarkMode ? "#fbbf24" : "#b45309"};">Low sample (n&lt;${LOW_SAMPLE_N})</div>`
            : "";

          // O21: drill affordance in tooltip
          const drillHint = onDateClick
            ? `<div style="margin-top:8px; font-size:11px; opacity:0.75;">Click to filter table to ${heading}</div>`
            : "";

          return (
            `<div style="min-width: 170px;">` +
            `<div style="font-weight:700; margin-bottom:6px;">${heading}</div>` +
            row(dot(colors.passed.base), "Passed", String(passed)) +
            row(dot(colors.failed.base), "Failed", String(failed)) +
            `<div style="border-top:1px solid ${isDarkMode ? "rgba(148,163,184,0.25)" : "rgba(100,116,139,0.2)"}; margin:6px 0;"></div>` +
            row(spacerDot, "Total tests", String(total)) +
            row(
              spacerDot,
              "Failure rate",
              `${rate}%`,
              true,
              highRate ? colors.failed.base : undefined,
            ) +
            lowSampleBadge +
            drillHint +
            `</div>`
          );
        },
      },
    };
  }, [chartData, isDarkMode, highlightDate, bucket, isMobile, onDateClick]);

  // Identity of the *derived* series (may be wrong while refreshing if bucket
  // flipped before the matching fetch landed — continuous day-fill of week data).
  const paintKey = React.useMemo(
    () => chartData.map((d) => `${d.date}:${d.passed}:${d.failed}`).join("|"),
    [chartData],
  );

  // Only advance the painted key when SWR data matches the current request
  // (not refreshing). Prevents Group-by flash: week→day fill of stale weeks.
  const committedPaintKey = useCommittedSeriesKey(paintKey, refreshing);

  // Hold the last painted option while refreshing — ignore paintKey churn from
  // applying the new bucket transform to the previous series.
  const displayOption = useCommittedChartOption(
    chartOption,
    committedPaintKey,
    refreshing,
  );

  // L→R clip wipe only when the committed series actually changes
  const revealRef = useSeriesRevealClass(committedPaintKey);

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

  // One short subtitle (O5); methodology lives in header help + Fails badge tooltip.
  const subtitle = [
    chartMode === "recent" ? "Latest per inverter" : "All tests",
    `per ${bucket}`,
    dashboardRangeLabel(dashboardRange),
    continuousDays
      ? "all calendar days"
      : activeDaysOnly
        ? "active test days only"
        : null,
    annotationFilter && annotationFilter !== "all" ? "annotation filter on" : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const allowedBuckets = React.useMemo(
    () => new Set(allowedBucketsForRange(dashboardRange)),
    [dashboardRange],
  );

  return (
    <Card className="@container/card">
      <CardHeader className="gap-3 !grid-cols-1">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>Test volume</CardTitle>
              <span
                className="inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] font-medium text-rose-600 dark:text-rose-400"
                title="Fails use the right Y-axis (counts). Hover a bar for failure rate — a short bar with a large fail marker is riskier than a tall bar with one fail."
              >
                Fails →
              </span>
            </div>
            {/* Mobile: wrap instead of mid-word truncate (O12) */}
            <CardDescription className="text-pretty sm:truncate">
              {subtitle}
              {onDateClick ? " · click a bar to filter the table" : ""}
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Group by
            </span>
            <ToggleGroup
              type="single"
              value={bucket}
              onValueChange={(value) => {
                if (value && allowedBuckets.has(value as ChartBucket)) {
                  onBucketChange(value as ChartBucket);
                }
              }}
              variant="outline"
              className="max-w-full flex-wrap *:data-[slot=toggle-group-item]:!px-2.5 *:data-[slot=toggle-group-item]:h-10 *:data-[slot=toggle-group-item]:min-h-10 sm:*:data-[slot=toggle-group-item]:!px-3"
            >
              {BUCKET_OPTIONS.map((option) => {
                const allowed = allowedBuckets.has(option.value);
                return (
                  <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    disabled={!allowed}
                    title={
                      allowed
                        ? undefined
                        : "Need a longer date range for this grouping"
                    }
                    className={cn(!allowed && "opacity-40")}
                  >
                    {option.label}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-2 pt-2 sm:px-6 sm:pt-3">
        {/*
          Keep a single mount for the plot: skeleton only on first load.
          Period changes update `option` in place (ECharts animates series).
        */}
        {loading && chartData.length === 0 ? (
          <div
            className="animate-pulse rounded-md bg-muted/40"
            style={{ height: chartHeightPx }}
            aria-hidden
          />
        ) : (
          <div
            ref={revealRef}
            className={
              // Reveal class is applied only by useSeriesRevealClass (once per
              // seriesKey). Do not put chart-reveal-ltr here — dual apply
              // restarted the wipe on every fresh mount.
              refreshing
                ? "opacity-90 transition-opacity duration-200"
                : "opacity-100"
            }
          >
            <ReactECharts
              ref={chartRef}
              option={displayOption}
              style={{
                height: chartHeightPx,
                width: "100%",
                cursor: onDateClick ? "pointer" : "default",
              }}
              opts={{ renderer: "canvas" }}
              onEvents={onEvents}
              // Replace series only when displayOption commits a new paintKey
              notMerge={true}
              lazyUpdate={true}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
