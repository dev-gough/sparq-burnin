"use client";

import * as React from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { burninChartColors } from "@/lib/chart-theme";

// Pass/fail pair validated for deutan/protan separation on both chart
// surfaces (dataviz validator: ΔE 8.3, no contrast warnings).
const PASS = "#059669";
const FAIL = burninChartColors.failed.base;
const WEEKLY_AFTER_DAYS = 92;

interface Day { day: string; passed: number; failed: number }
interface Bucket { start: string; label: string; passed: number; failed: number }

const DAY_MS = 86_400_000;
const utcDay = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fmt = (ms: number, opts: Intl.DateTimeFormatOptions) =>
  new Date(ms).toLocaleDateString(undefined, { timeZone: "UTC", ...opts });

/** Continuous UTC days (or ISO weeks for long periods) so gaps read as "no runs". */
export function ft3Buckets(daily: Day[], from: string | null, to: string): { buckets: Bucket[]; weekly: boolean } {
  const first = from ?? daily[0]?.day ?? to;
  const start = utcDay(first);
  const end = Math.max(utcDay(to), start);
  const weekly = (end - start) / DAY_MS > WEEKLY_AFTER_DAYS;
  const byDay = new Map(daily.map(d => [d.day, d]));
  const buckets = new Map<number, Bucket>();
  for (let t = start; t <= end; t += DAY_MS) {
    // Weeks start on Monday (UTC).
    const key = weekly ? t - ((new Date(t).getUTCDay() + 6) % 7) * DAY_MS : t;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        start: new Date(key).toISOString().slice(0, 10),
        label: weekly ? `Week of ${fmt(key, { month: "short", day: "numeric", year: "numeric" })}` : fmt(key, { weekday: "short", month: "short", day: "numeric", year: "numeric" }),
        passed: 0, failed: 0,
      };
      buckets.set(key, bucket);
    }
    const d = byDay.get(new Date(t).toISOString().slice(0, 10));
    if (d) { bucket.passed += d.passed; bucket.failed += d.failed; }
  }
  return { buckets: [...buckets.values()], weekly };
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

export function Ft3TrendChart({ daily, from, to }: { daily: Day[]; from: string | null; to: string }) {
  const dark = useDarkMode();
  const { buckets, weekly } = React.useMemo(() => ft3Buckets(daily, from, to), [daily, from, to]);
  const surface = dark ? burninChartColors.surface.dark : burninChartColors.surface.light;
  const muted = dark ? burninChartColors.muted.dark : burninChartColors.muted.light;
  const text = dark ? burninChartColors.text.dark : burninChartColors.text.light;

  const option = React.useMemo<EChartsOption>(() => {
    // Round only the top of each stack: fail when present, otherwise pass.
    const bar = (value: number, top: boolean, color: string) => ({
      value: value || "-",
      itemStyle: { color, borderColor: surface, borderWidth: 1, borderRadius: top ? [4, 4, 0, 0] : 0 },
    });
    return {
      animationDuration: 400,
      grid: { left: 8, right: 8, top: 12, bottom: 4, containLabel: true },
      xAxis: {
        type: "category",
        data: buckets.map(b => b.start),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: dark ? burninChartColors.grid.dark : burninChartColors.grid.light } },
        axisLabel: {
          color: muted, fontSize: 11, hideOverlap: true, alignMinLabel: "left", alignMaxLabel: "right",
          formatter: (v: string) => fmt(utcDay(v), { month: "short", day: "numeric" }),
        },
      },
      yAxis: {
        type: "value", minInterval: 1,
        axisLabel: { color: muted, fontSize: 11 },
        splitLine: { lineStyle: { color: dark ? burninChartColors.grid.dark : burninChartColors.grid.light } },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: dark ? "rgba(148,163,184,0.08)" : "rgba(100,116,139,0.08)" } },
        backgroundColor: surface,
        borderColor: dark ? "rgba(148,163,184,0.25)" : "rgba(100,116,139,0.2)",
        textStyle: { color: text, fontSize: 12 },
        formatter: (params: unknown) => {
          const index = (params as { dataIndex: number }[])[0]?.dataIndex ?? 0;
          const b = buckets[index];
          const total = b.passed + b.failed;
          const rate = total ? `${(b.passed / total * 100).toFixed(1)}% passed` : "No runs";
          const row = (color: string, label: string, n: number) =>
            `<div style="display:flex;align-items:center;gap:8px"><span style="width:8px;height:8px;border-radius:2px;background:${color}"></span><span style="flex:1">${label}</span><b>${n}</b></div>`;
          return `<div style="min-width:150px"><div style="font-weight:600;margin-bottom:4px">${b.label}</div>` +
            row(PASS, "Passed", b.passed) + row(FAIL, "Failed", b.failed) +
            `<div style="margin-top:4px;color:${muted}">${rate}</div></div>`;
        },
      },
      series: [
        { name: "Passed", type: "bar", stack: "runs", barMaxWidth: 28, data: buckets.map(b => bar(b.passed, b.failed === 0, PASS)) },
        { name: "Failed", type: "bar", stack: "runs", barMaxWidth: 28, data: buckets.map(b => bar(b.failed, true, FAIL)) },
      ],
    };
  }, [buckets, dark, surface, muted, text]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground" aria-hidden="true">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: PASS }} />Passed</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: FAIL }} />Failed</span>
        <span className="ml-auto">{weekly ? "Runs per week (UTC)" : "Runs per day (UTC)"}</span>
      </div>
      <ReactECharts option={option} style={{ height: 260, width: "100%" }} opts={{ renderer: "canvas" }} notMerge lazyUpdate />
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show as table</summary>
        <div className="mt-2 max-h-48 overflow-y-auto">
          <table className="w-full text-left tabular-nums">
            <thead className="text-muted-foreground"><tr><th className="py-1 font-medium">{weekly ? "Week" : "Day"}</th><th className="py-1 text-right font-medium">Passed</th><th className="py-1 text-right font-medium">Failed</th></tr></thead>
            <tbody>{buckets.filter(b => b.passed + b.failed).map(b => <tr key={b.start} className="border-t"><td className="py-1">{b.label}</td><td className="py-1 text-right">{b.passed}</td><td className="py-1 text-right">{b.failed}</td></tr>)}</tbody>
          </table>
          {!buckets.some(b => b.passed + b.failed) && <p className="py-2 text-muted-foreground">No runs in this period.</p>}
        </div>
      </details>
    </div>
  );
}
