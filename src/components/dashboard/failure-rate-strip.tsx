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
import { useSettings } from "@/contexts/settings-context";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useFailureRatePrefs } from "@/hooks/useFailureRatePrefs";
import { useTestOutcomes } from "@/hooks/useTestOutcomes";
import { rollingTestFailureRates } from "@/lib/failure-analytics";

interface FailureRateStripProps {
  data: BucketStats[];
  loading: boolean;
  refreshing?: boolean;
  annotationFilter: string;
  bucket: ChartBucket;
  /** For empty-state copy (“No tests in the last 30 days”). */
  dashboardRange?: DashboardRange;
  chartMode: string;
  stationFilter: string;
  requestEpoch: number;
  enabled: boolean;
}

/** Shared plot height — skeleton, empty, and chart use this so layout never jumps. */
const FAILURE_RATE_STRIP_HEIGHT_PX = 156;
const TEST_WINDOWS = [10, 25, 50, 100, 250, 500, 1000, 2000];

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
  chartMode,
  stationFilter,
  requestEpoch,
  enabled,
}: FailureRateStripProps) {
  const { prefs, updatePrefs, ready: prefsReady, saveError } = useFailureRatePrefs();
  const byTests = prefs.view === "tests";
  const [retryEpoch, setRetryEpoch] = React.useState(0);
  const testHistory = useTestOutcomes({ dashboardRange, chartMode, annotationFilter, stationFilter,
    requestEpoch: requestEpoch + retryEpoch, enabled: enabled && prefsReady && byTests });
  const rollingPoints = React.useMemo(
    () => rollingTestFailureRates(testHistory.outcomes, prefs.window),
    [testHistory.outcomes, prefs.window],
  );
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

  const { settings } = useSettings();
  const hideEmptyChartDays = settings.hideEmptyChartDays;

  const fieldsMissing = annotationOn && !hasStripFields(data);

  // Align domain with volume chart: fill missing calendar days on day bucket
  // so both strip and volume share the same continuous axis (O9) — unless the
  // user opted to hide empty days (active-activity buckets only).
  const plotData = React.useMemo(() => {
    if (fieldsMissing) return [];
    if (hideEmptyChartDays) {
      return data.filter(
        (row) =>
          (row.passed || 0) + (row.failed || 0) > 0 ||
          (row.totalUnfiltered ?? 0) > 0,
      );
    }
    if (!dashboardRange) return data;
    return fillContinuousDayBuckets(data, dashboardRange, bucket);
  }, [data, dashboardRange, bucket, fieldsMissing, hideEmptyChartDays]);

  const continuousDays =
    !hideEmptyChartDays &&
    !!dashboardRange &&
    shouldFillContinuousDays(dashboardRange, bucket);

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

  const rollingYMax = niceRateMax(rollingPoints.reduce((max, point) => Math.max(max, point[1]), 0));
  const rollingOption: EChartsOption = React.useMemo(() => ({
    ...chartOption,
    animation: false,
    xAxis: {
      type: "value", min: prefs.window, max: Math.max(prefs.window + 1, testHistory.outcomes.length), minInterval: 1,
      axisLine: { show: false }, axisTick: { show: false }, splitLine: { show: false },
      axisLabel: { color: isDarkMode ? burninChartColors.muted.dark : burninChartColors.muted.light, fontSize: 11, hideOverlap: true },
    },
    yAxis: {
      ...chartOption.yAxis,
      max: rollingYMax,
      interval: rollingYMax / 2,
    },
    tooltip: {
      ...chartOption.tooltip,
      trigger: "axis", confine: true,
      formatter: (params: unknown) => {
        if (!Array.isArray(params) || !params.length) return "";
        const [index, rate] = (params[0] as { value: [number, number] }).value;
        return `<strong>Test ${index.toLocaleString()}</strong><br/>Tests ${(index - prefs.window + 1).toLocaleString()}–${index.toLocaleString()}<br/>${Math.round(rate * prefs.window / 100).toLocaleString()} ${annotationOn ? "matching failures" : "failed"} of ${prefs.window.toLocaleString()}<br/>Failure rate: <strong>${rate.toFixed(2)}%</strong>`;
      },
    },
    series: [{
      name: `Last ${prefs.window} tests`, type: "line", sampling: "lttb", data: rollingPoints,
      showSymbol: rollingPoints.length === 1, symbolSize: 5,
      itemStyle: { color: burninChartColors.failed.base }, lineStyle: { width: 2 }, areaStyle: { opacity: 0.06 },
    }],
  }), [chartOption, prefs.window, testHistory.outcomes.length, rollingPoints, rollingYMax, isDarkMode, annotationOn]);

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
  const showSkeleton = !prefsReady || (byTests ? !enabled || testHistory.loading : loading && !hasActivity && series.length < 2);
  const showEmpty = byTests ? !testHistory.loading && rollingPoints.length === 0 : !loading && !fieldsMissing && !hasActivity;
  const periodPhrase = dashboardRange
    ? dashboardRangeLabel(dashboardRange)
    : "this period";

  // Always keep the same card chrome so period changes never collapse the page.
  // Annotation-unavailable: still full height with a one-line note.
  const emptyMessage = byTests
    ? testHistory.error ? "Couldn’t load test history" : testHistory.outcomes.length === 0
      ? `No test activity in ${periodPhrase}`
      : `Not enough tests for a ${prefs.window.toLocaleString()}-test window`
    : fieldsMissing && !loading
    ? "Failure-rate trend unavailable for this annotation filter"
    : `No test activity in ${periodPhrase}`;

  return (
    <Card className="@container/card gap-0 overflow-hidden py-0 shadow-sm">
      <CardHeader className="grid shrink-0 grid-cols-2 grid-rows-1 items-center gap-2 space-y-0 px-4 pb-1 pt-2 @[48rem]/card:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        {/* O43/O44: Title Case section voice (match Test volume) */}
        <CardTitle className="order-1 text-sm font-semibold">
          {byTests ? "Failure rate by test count" : "Failure rate over time"}
        </CardTitle>
        <div className="order-3 col-span-2 flex items-center justify-center gap-2 justify-self-center @[48rem]/card:order-2 @[48rem]/card:col-span-1">
          <ToggleGroup type="single" value={prefs.view} disabled={!prefsReady} variant="outline" aria-label="Dashboard failure rate view"
            onValueChange={value => { if (value === "rate" || value === "tests") updatePrefs({ view: value }); }}>
            <ToggleGroupItem value="rate" className="h-7 px-2 text-[11px]">By date</ToggleGroupItem>
            <ToggleGroupItem value="tests" className="h-7 px-2 text-[11px]">By test count</ToggleGroupItem>
          </ToggleGroup>
          {byTests && (
            <Select value={String(prefs.window)} disabled={!prefsReady} onValueChange={value => updatePrefs({ window: Number(value) })}>
              <SelectTrigger className="h-7 w-[125px] py-0 text-[11px] data-[size=default]:h-7 data-[size=sm]:h-7" aria-label="Rolling test window"><SelectValue /></SelectTrigger>
              <SelectContent>
                {/* Preserve a previously saved slider value until another window is selected. */}
                {!TEST_WINDOWS.includes(prefs.window) && <SelectItem value={String(prefs.window)}>{prefs.window.toLocaleString()} tests</SelectItem>}
                {TEST_WINDOWS.map(value => <SelectItem key={value} value={String(value)}>{value.toLocaleString()} tests</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="order-2 flex min-w-0 items-center justify-end gap-1.5 text-right text-[11px] text-muted-foreground @[48rem]/card:order-3">
          {(byTests || annotationOn || continuousDays) && (
            <>
              <span>{byTests
                ? `${prefs.window.toLocaleString()}-test average${annotationOn ? " · Matching failures ÷ all tests" : ""}`
                : annotationOn ? "Matching failures ÷ all tests" : "All calendar days"}</span>
              {byTests && (
                <InfoTooltip content="Each point is failed tests divided by the last N PASS or FAIL outcomes, ordered chronologically within the selected period. Latest keeps one outcome per inverter. Invalid and retest are excluded. Annotation filters count matching failures over all selected tests. The line starts once a complete window is available." />
              )}
            </>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0 sm:px-4">
        {showSkeleton ? (
          <div
            className="animate-pulse rounded-md bg-muted/40"
            style={{ height: CHART_HEIGHT_PX }}
            aria-hidden
          />
        ) : showEmpty || (!byTests && fieldsMissing && !loading) ? (
          <div
            className="flex flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border/70 bg-muted/15 px-4"
            style={{ height: CHART_HEIGHT_PX }}
            role="status"
          >
            <p className="text-center text-sm font-medium text-muted-foreground">
              {emptyMessage}
            </p>
            {byTests && testHistory.error ? (
              <button type="button" className="text-xs text-primary underline" onClick={() => setRetryEpoch(value => value + 1)}>Try again</button>
            ) : (!fieldsMissing || byTests) && (
              <p className="text-center text-xs text-muted-foreground/80">
                {byTests && testHistory.outcomes.length > 0
                  ? `${testHistory.outcomes.length.toLocaleString()} tests in this period. Choose a smaller window or widen the period.`
                  : "Widen the period above if you expected data here"}
              </p>
            )}
          </div>
        ) : (
          <div
            ref={byTests ? undefined : revealRef}
            className={
              // Reveal owned by useSeriesRevealClass only (see chart-theme).
              !byTests && refreshing
                ? "opacity-60 transition-opacity duration-500 ease-out"
                : "opacity-100 transition-opacity duration-500 ease-out"
            }
          >
            <ReactECharts
              option={byTests ? rollingOption : displayOption}
              style={{ height: CHART_HEIGHT_PX, width: "100%" }}
              opts={{ renderer: "canvas" }}
              notMerge
              lazyUpdate
            />
          </div>
        )}
        {saveError && <p role="status" className="pt-1 text-[11px] text-muted-foreground">Couldn’t sync chart preferences with your account. Change the selection to try again.</p>}
      </CardContent>
    </Card>
  );
}
