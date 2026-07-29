"use client";

import * as React from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  burninChartColors,
  formatBucketLabel,
  type ChartBucket,
} from "@/lib/chart-theme";
import {
  hasStripFields,
  type BucketStats,
} from "@/hooks/useBucketStats";

interface FailureRateStripProps {
  data: BucketStats[];
  loading: boolean;
  annotationFilter: string;
  bucket: ChartBucket;
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
  annotationFilter,
  bucket,
}: FailureRateStripProps) {
  const [isDarkMode, setIsDarkMode] = React.useState(false);
  const annotationOn = Boolean(
    annotationFilter && annotationFilter !== "all",
  );

  React.useEffect(() => {
    const check = () =>
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  const fieldsMissing = annotationOn && !hasStripFields(data);

  const series = React.useMemo(() => {
    if (fieldsMissing) return [];
    return data.map((row) => {
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
  }, [data, annotationOn, fieldsMissing]);

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

    return {
      backgroundColor: "transparent",
      textStyle: {
        color: textColor,
        fontFamily: "var(--font-geist-sans), sans-serif",
      },
      grid: {
        left: 44,
        right: 16,
        top: 12,
        bottom: 24,
        containLabel: false,
      },
      xAxis: {
        type: "category",
        data: series.map((s) => s.date),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: mutedColor,
          fontSize: 10,
          hideOverlap: true,
          formatter: (v: string) => formatBucketLabel(v, bucket),
        },
      },
      yAxis: {
        type: "value",
        min: 0,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: mutedColor,
          fontSize: 10,
          formatter: (v: number) => `${v}%`,
        },
        splitLine: {
          lineStyle: { color: gridColor, type: "dashed" as const },
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
          showSymbol: series.length <= 40,
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

  if (fieldsMissing) {
    return (
      <p className="px-1 text-xs text-muted-foreground">
        Failure-rate trend unavailable for this filter
      </p>
    );
  }

  if (!loading && series.length < 2) {
    return null;
  }

  return (
    <Card className="@container/card overflow-hidden">
      <CardHeader className="flex-row items-center justify-between space-y-0 px-4 py-2.5">
        <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Failure rate over time
        </CardTitle>
        {annotationOn && (
          <span className="text-[11px] text-muted-foreground">
            Tagged failures ÷ all tests (per period)
          </span>
        )}
      </CardHeader>
      <CardContent className="px-2 pb-2 pt-0 sm:px-4">
        {loading ? (
          <div className="flex h-[80px] items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : (
          <ReactECharts
            option={chartOption}
            style={{ height: "84px", width: "100%" }}
            opts={{ renderer: "canvas" }}
            notMerge
            lazyUpdate
          />
        )}
      </CardContent>
    </Card>
  );
}
