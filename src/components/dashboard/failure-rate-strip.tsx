"use client";

import * as React from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  hasStripFields,
  shouldFillContinuousDays,
  type BucketStats,
} from "@/hooks/useBucketStats";
import {
  dashboardRangeLabel,
  type DashboardRange,
} from "@/lib/dashboard-range";

interface FailureRateStripProps {
  data: BucketStats[];
  loading: boolean;
  refreshing?: boolean;
  annotationFilter: string;
  bucket: ChartBucket;
  /** For empty-state copy (“No tests in the last 30 days”). */
  dashboardRange?: DashboardRange;
}

/** Shared plot height — skeleton, empty, and chart use this so layout never jumps. */
export const FAILURE_RATE_STRIP_HEIGHT_PX = 156;

/**
 * Nice upper bound for a 0–max percentage axis with room above the peak rate.
 * Uses percentage-friendly steps (5, 10, 15, …) instead of pure 1-2-5 decades
 * so modest peaks (e.g. ~20%) land on 25, not leap to 50.
 */
function niceRateMax(peak: number): number {
  // Empty / invalid → readable floor (not 0–1%)
  if (!Number.isFinite(peak) || peak <= 0) return 5;

  // Headroom, never tighter than 5% when there is any data
  const padded = Math.max(peak * 1.2, 5);
  // Cap at 100 — rates are percentages
  if (padded >= 100) return 100;

  // Prefer steps that keep mid-tick (yMax/2) readable on a short strip
  const STEPS = [5, 10, 15, 20, 25, 30, 40, 50, 75, 100] as const;
  for (const step of STEPS) {
    if (padded <= step) return step;
  }
  return 100;
}

/** Compact y-axis labels: "0", "2.5%", "5%" — avoid long trailing zeros. */
function formatRateAxisLabel(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return "0";
  const rounded =
    v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
  const text =
    Number.isInteger(rounded) || Math.abs(rounded - Math.round(rounded)) < 1e-9
      ? String(Math.round(rounded))
      : rounded.toFixed(1);
  return `${text}%`;
}

/**
 * Compact failure-rate-over-time strip.
 * Uses totalUnfiltered / failedFiltered (rank-then-tag).
 * NEVER derives rate from volume when annotation ≠ all.
 * Hides when <2 buckets or strip fields missing under annotation filter.
 */
export function FailureRateStrip({
  data,
  loading,
  refreshing = false,
  annotationFilter,
  bucket,
  dashboardRange,
}: FailureRateStripProps) {
  // Sync read on first paint — avoids notMerge theme flip after first draw.
  const [isDarkMode, setIsDarkMode] = React.useState(
    () =>
      typeof document !== "undefined" &&
      document.documentElement.classList.contains("dark"),
  );
  const annotationOn = Boolean(
    annotationFilter && annotationFilter !== "all",
  );

  React.useEffect(() => {
    const check = () =>
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const fieldsMissing = annotationOn && !hasStripFields(data);

  // Align domain with volume chart: fill missing calendar days on day bucket
  // so both strip and volume share the same continuous axis (O9).
  const plotData = React.useMemo(() => {
    if (fieldsMissing) return [];
    if (!dashboardRange) return data;
    return fillContinuousDayBuckets(data, dashboardRange, bucket);
  }, [data, dashboardRange, bucket, fieldsMissing]);

  const continuousDays =
    !!dashboardRange && shouldFillContinuousDays(dashboardRange, bucket);

  const series = React.useMemo(() => {
    if (fieldsMissing) return [];
    return plotData.map((row) => {
      let rate = 0;
      if (
        typeof row.totalUnfiltered === "number" &&
        typeof row.failedFiltered === "number"
      ) {
        rate =
          row.totalUnfiltered > 0
            ? (row.failedFiltered / row.totalUnfiltered) * 100
            : 0;
      } else if (!annotationOn) {
        const total = row.passed + row.failed;
        rate = total > 0 ? (row.failed / total) * 100 : 0;
      }
      return {
        date: row.date,
        rate: Math.round(rate * 100) / 100,
      };
    });
  }, [plotData, annotationOn, fieldsMissing]);

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
    const fail = burninChartColors.failed.base;

    const maxRate = series.reduce((m, s) => Math.max(m, s.rate), 0);
    // Headroom + nice upper bound so 3 ticks (0 / mid / max) stay readable
    const yMax = niceRateMax(maxRate);

    return {
      ...chartEnterAnimation,
      backgroundColor: "transparent",
      textStyle: {
        color: textColor,
        fontFamily: "var(--font-geist-sans), sans-serif",
      },
      // containLabel gives y-labels room; tight top/bottom so plot fills the card
      grid: {
        left: 4,
        right: 10,
        top: 6,
        bottom: 2,
        containLabel: true,
      },

      xAxis: {
        type: "category",
        data: series.map((s) => s.date),
        boundaryGap: false,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: mutedColor,
          fontSize: 11,
          margin: 10,
          hideOverlap: true,
          formatter: (v: string) => formatBucketLabel(v, bucket),
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: yMax,
        // Exactly 3 ticks: 0, mid, max — avoids stacked labels on a short strip
        interval: yMax / 2,
        splitNumber: 2,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: mutedColor,
          fontSize: 11,
          fontWeight: 500,
          margin: 12,
          // Tabular-ish alignment for mixed "0" / "2.5%" / "5%"
          align: "right",
          formatter: (v: number) => formatRateAxisLabel(v),
        },
        splitLine: {
          show: true,
          lineStyle: {
            color: gridColor,
            type: "dashed" as const,
            opacity: 0.65,
            width: 1,
          },
        },
      },
      series: [
        {
          name: "Failure rate",
          type: "line" as const,
          data: series.map((s) => s.rate),
          smooth: 0.35,
          symbol: "circle",
          symbolSize: 5,
          // Markers on sparse / short series so modest movement stays visible
          showSymbol: series.length <= 30,
          animationDelay: (idx: number) => chartSeriesDelay(idx, 24),
          animationEasing: "cubicOut",
          lineStyle: {
            width: 2,
            color: fail,
          },
          itemStyle: {
            color: fail,
            borderColor: isDarkMode ? "#18181b" : "#ffffff",
            borderWidth: 1.5,
          },
          areaStyle: {
            color: {
              type: "linear" as const,
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: burninChartColors.failed.soft(0.18) },
                { offset: 1, color: burninChartColors.failed.soft(0) },
              ],
            },
          },
        },
      ],
      tooltip: {
        trigger: "axis",
        backgroundColor: isDarkMode
          ? "rgba(24, 24, 27, 0.92)"
          : "rgba(255, 255, 255, 0.95)",
        borderColor: isDarkMode
          ? "rgba(148, 163, 184, 0.25)"
          : "rgba(100, 116, 139, 0.2)",
        borderWidth: 1,
        padding: [8, 12],
        textStyle: { color: textColor, fontSize: 12 },
        formatter: (params: unknown) => {
          if (!Array.isArray(params) || params.length === 0) return "";
          const p = params[0] as { name: string; value: number };
          const heading = formatBucketLabel(p.name, bucket, true);
          return (
            `<div style="min-width:120px">` +
            `<div style="font-weight:600;margin-bottom:4px">${heading}</div>` +
            `<div>Failure rate <strong>${Number(p.value).toFixed(1)}%</strong></div>` +
            `</div>`
          );
        },
      },
    };
  }, [series, isDarkMode, bucket]);

  // Derived series key — may thrash while refreshing if range/bucket changed.
  const paintKey = React.useMemo(
    () => series.map((s) => `${s.date}:${s.rate}`).join("|"),
    [series],
  );

  // Only advance paint identity when data matches the current request.
  const committedPaintKey = useCommittedSeriesKey(paintKey, refreshing);

  // Freeze option while refreshing so period/bucket flips don't paint a
  // transformed stale series before the new fetch lands.
  const displayOption = useCommittedChartOption(
    chartOption,
    committedPaintKey,
    refreshing,
  );

  const revealRef = useSeriesRevealClass(committedPaintKey);

  const CHART_HEIGHT_PX = FAILURE_RATE_STRIP_HEIGHT_PX;
  // After continuous fill, length can be large with all zeros — empty means
  // no real activity in the unfilled source data.
  const hasActivity = data.some(
    (row) =>
      (row.passed || 0) + (row.failed || 0) > 0 ||
      (row.totalUnfiltered ?? 0) > 0,
  );
  const showSkeleton = loading && !hasActivity && series.length < 2;
  const showEmpty = !loading && !fieldsMissing && !hasActivity;
  const periodPhrase = dashboardRange
    ? dashboardRangeLabel(dashboardRange)
    : "this period";

  // Always keep the same card chrome so period changes never collapse the page.
  // Annotation-unavailable: still full height with a one-line note.
  const emptyMessage = fieldsMissing && !loading
    ? "Failure-rate trend unavailable for this annotation filter"
    : `No test activity in ${periodPhrase}`;

  return (
    <Card className="@container/card gap-0 overflow-hidden py-0 shadow-sm">
      <CardHeader className="flex shrink-0 flex-row items-center justify-between gap-0 space-y-0 px-4 pb-1 pt-2">
        {/* O43/O44: Title Case section voice (match Test volume) */}
        <CardTitle className="text-sm font-semibold">
          Failure rate over time
        </CardTitle>
        {(annotationOn || continuousDays) && (
          <span className="text-[11px] text-muted-foreground">
            {annotationOn
              ? "Tagged failures ÷ all tests"
              : "All calendar days"}
          </span>
        )}
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0 sm:px-4">
        {showSkeleton ? (
          <div
            className="animate-pulse rounded-md bg-muted/40"
            style={{ height: CHART_HEIGHT_PX }}
            aria-hidden
          />
        ) : showEmpty || (fieldsMissing && !loading) ? (
          <div
            className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border/70 bg-muted/15 px-4"
            style={{ height: CHART_HEIGHT_PX }}
            role="status"
          >
            <p className="text-center text-sm font-medium text-muted-foreground">
              {emptyMessage}
            </p>
            {!fieldsMissing && (
              <p className="text-center text-xs text-muted-foreground/80">
                Widen the period above if you expected data here
              </p>
            )}
          </div>
        ) : (
          <div
            ref={revealRef}
            className={
              // Reveal owned by useSeriesRevealClass only (see chart-theme).
              refreshing
                ? "opacity-90 transition-opacity duration-200"
                : "opacity-100"
            }
          >
            <ReactECharts
              option={displayOption}
              style={{ height: CHART_HEIGHT_PX, width: "100%" }}
              opts={{ renderer: "canvas" }}
              notMerge
              lazyUpdate
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
