"use client";

import * as React from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { burninChartColors } from "@/lib/chart-theme";
import { fillDayBuckets, formatUtcDay, utcDayMs } from "@/lib/day-buckets";
import type { YieldDay } from "@/lib/yield-retest";

// Validated pairs (dataviz validator, both surfaces, no warnings): brand
// maroon / darker brand gold for new units, cyan for repeat runs.
const NEW = { light: "#8c334d", dark: "#b88a00" };
const REPEAT = "#0891b2";
const KEYS = ["newUnits", "newPass", "repeatRuns", "hours", "repeatHours"] as const;

export function throughputBuckets(daily: YieldDay[], from: string | null, to: string) {
  return fillDayBuckets(daily, KEYS, from, to);
}

function useDarkMode() {
  const [dark, setDark] = React.useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  React.useEffect(() => {
    const check = () => setDark(document.documentElement.classList.contains("dark"));
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

const count = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

/** New units entering burn-in per day (or week) with repeat runs stacked on top. */
export function ThroughputChart({ daily, from, to, height = 300 }: { daily: YieldDay[]; from: string | null; to: string; height?: number }) {
  const dark = useDarkMode();
  const { buckets, weekly } = React.useMemo(() => throughputBuckets(daily, from, to), [daily, from, to]);
  const newColor = dark ? NEW.dark : NEW.light;
  const surface = dark ? burninChartColors.surface.dark : burninChartColors.surface.light;
  const muted = dark ? burninChartColors.muted.dark : burninChartColors.muted.light;
  const text = dark ? burninChartColors.text.dark : burninChartColors.text.light;
  const grid = dark ? burninChartColors.grid.dark : burninChartColors.grid.light;
  const average = buckets.length ? buckets.reduce((n, b) => n + b.newUnits, 0) / buckets.length : 0;

  const option = React.useMemo<EChartsOption>(() => {
    const bar = (value: number, top: boolean, color: string) => ({
      value: value || "-",
      itemStyle: { color, borderColor: surface, borderWidth: 1, borderRadius: top ? [4, 4, 0, 0] : 0 },
    });
    return {
      animationDuration: 400,
      grid: { left: 8, right: 8, top: 18, bottom: 4, containLabel: true },
      xAxis: {
        type: "category",
        data: buckets.map(b => b.start),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: grid } },
        axisLabel: {
          color: muted, fontSize: 11, hideOverlap: true, alignMinLabel: "left", alignMaxLabel: "right",
          formatter: (v: string) => formatUtcDay(utcDayMs(v), { month: "short", day: "numeric" }),
        },
      },
      yAxis: { type: "value", minInterval: 1, axisLabel: { color: muted, fontSize: 11 }, splitLine: { lineStyle: { color: grid } } },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: dark ? "rgba(148,163,184,0.08)" : "rgba(100,116,139,0.08)" } },
        backgroundColor: surface,
        borderColor: dark ? "rgba(148,163,184,0.25)" : "rgba(100,116,139,0.2)",
        textStyle: { color: text, fontSize: 12 },
        formatter: (params: unknown) => {
          const b = buckets[(params as { dataIndex: number }[])[0]?.dataIndex ?? 0];
          const runs = b.newUnits + b.repeatRuns;
          const row = (color: string, label: string, value: string) =>
            `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:2px;background:${color}"></span><span style="flex:1">${label}</span><b>${value}</b></div>`;
          const fpy = b.newUnits ? `${(b.newPass / b.newUnits * 100).toFixed(1)}% passed first time` : "No new units";
          return `<div style="min-width:180px"><div style="font-weight:600;margin-bottom:4px">${b.label}</div>` +
            row(newColor, "New units", count(b.newUnits)) + row(REPEAT, "Repeat runs", count(b.repeatRuns)) +
            `<div style="margin-top:4px;color:${muted}">${fpy}${runs ? ` · ${(b.repeatRuns / runs * 100).toFixed(1)}% of runs were repeats` : ""}</div></div>`;
        },
      },
      series: [
        {
          name: "New units", type: "bar", stack: "runs", barMaxWidth: 32,
          data: buckets.map(b => bar(b.newUnits, b.repeatRuns === 0, newColor)),
          markLine: average ? {
            silent: true, symbol: "none",
            lineStyle: { color: muted, type: "dashed", width: 1 },
            label: {
              color: text, fontSize: 11, position: "insideStartTop", backgroundColor: surface, padding: [2, 6], borderRadius: 4,
              formatter: `Average ${count(average)} new / ${weekly ? "week" : "day"}`,
            },
            data: [{ yAxis: average }],
          } : undefined,
        },
        { name: "Repeat runs", type: "bar", stack: "runs", barMaxWidth: 32, data: buckets.map(b => bar(b.repeatRuns, true, REPEAT)) },
      ],
    };
  }, [buckets, dark, surface, muted, text, grid, newColor, average, weekly]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground" aria-hidden="true">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: newColor }} />New units (first run)</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: REPEAT }} />Repeat runs</span>
        <span className="ml-auto">{weekly ? "Per week (UTC)" : "Per day (UTC)"}</span>
      </div>
      <ReactECharts option={option} style={{ height, width: "100%" }} opts={{ renderer: "canvas" }} notMerge lazyUpdate />
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <div className="mt-2 max-h-56 overflow-y-auto">
          <table className="w-full text-left tabular-nums">
            <thead className="text-muted-foreground"><tr>
              <th className="py-1 font-medium">{weekly ? "Week" : "Day"}</th><th className="py-1 text-right font-medium">New units</th>
              <th className="py-1 text-right font-medium">Passed first time</th><th className="py-1 text-right font-medium">Repeat runs</th>
            </tr></thead>
            <tbody>{buckets.filter(b => b.newUnits + b.repeatRuns).map(b => <tr key={b.start} className="border-t">
              <td className="py-1">{b.label}</td><td className="py-1 text-right">{count(b.newUnits)}</td>
              <td className="py-1 text-right">{count(b.newPass)}</td><td className="py-1 text-right">{count(b.repeatRuns)}</td>
            </tr>)}</tbody>
          </table>
          {!buckets.some(b => b.newUnits + b.repeatRuns) && <p className="py-2 text-muted-foreground">No burn-in runs in this period.</p>}
        </div>
      </details>
    </div>
  );
}
