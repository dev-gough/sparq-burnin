"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import ReactECharts from "echarts-for-react";
import { ArrowLeft, ArrowUpRight, BarChart3, CheckCheck, CircleX, ClipboardList, Tags } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FailureChartPanel } from "@/components/dashboard/failure-chart-panel";
import { failureChartEmptyState } from "@/lib/failure-chart-state";
import {
  type FailureAnalyticsData, type FailureCause, type TimeGrouping,
  TIME_GROUPINGS, groupFailureTimeline, weightedFailureAverage, formatFailureBucket, rollingTestFailureRates,
} from "@/lib/failure-analytics";
import { type DashboardRange, dashboardRangeContextLabel, tableDatesForPill, todoHrefFromDashboardRange } from "@/lib/dashboard-range";
import { burninChartColors, burninSeriesPalette } from "@/lib/chart-theme";
import { cn } from "@/lib/utils";

const number = (value: number) => value.toLocaleString();
const percentage = (value: number) => `${value.toFixed(2)}%`;
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));
type TooltipPoint = { axisValue?: string; value: number | string | null; marker: string; seriesName: string };

function axisTooltip(dark: boolean, gridColor: string, textColor: string) {
  return {
    trigger: "axis" as const, confine: true,
    backgroundColor: dark ? "#18181b" : "#ffffff", borderColor: gridColor,
    textStyle: { color: textColor }, padding: [10, 14] as [number, number],
    extraCssText: "border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.15)",
  };
}

function timelineAxes(dates: string[], unit: string, grouping: TimeGrouping, muted: string, gridColor: string, isRate = false) {
  return {
    grid: { left: 16, right: 20, top: 48, bottom: 16, containLabel: true },
    xAxis: { type: "category" as const, data: dates, boundaryGap: !isRate, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: muted, hideOverlap: true, fontSize: 10, formatter: (value: string) => formatFailureBucket(value, grouping) } },
    yAxis: { type: "value" as const, min: 0, ...(isRate ? {} : { minInterval: 1 }), name: unit, nameTextStyle: { color: muted, fontSize: 10 }, axisLabel: { color: muted, fontSize: 10, ...(isRate ? { formatter: "{value}%" } : {}) }, splitLine: { lineStyle: { color: gridColor, type: "dashed" as const } } },
  };
}

function historyChartOption(rows: FailureCause[], timeline: FailureAnalyticsData["categoryTimeline"], colors: Map<string, string>, grouping: TimeGrouping, dark: boolean, text: string, muted: string, gridColor: string) {
  const buckets = groupFailureTimeline(timeline, grouping);
  return {
    animationDurationUpdate: 0,
    ...timelineAxes(buckets.map(point => point.date), "Annotations", grouping, muted, gridColor),
    grid: { left: 16, right: 20, top: 64, bottom: 16, containLabel: true },
    tooltip: { ...axisTooltip(dark, gridColor, text), formatter: (points: TooltipPoint[]) => [`<strong>${escapeHtml(points[0]?.axisValue ?? "")}</strong>`, ...points.filter(point => Number(point.value) > 0).map(point => `${point.marker} ${escapeHtml(point.seriesName)}: <strong>${number(Number(point.value))}</strong>`)].join("<br/>") },
    legend: { type: "scroll" as const, top: 4, left: 16, right: 16, textStyle: { color: muted, fontSize: 10 }, pageTextStyle: { color: muted }, pageIconColor: muted },
    series: rows.map(row => ({ name: row.name, type: "bar" as const, stack: "annotations", barMaxWidth: 32, data: buckets.map(point => Number(point[row.name] ?? 0)), emphasis: { focus: "series" as const }, itemStyle: { color: colors.get(row.name) } })),
  };
}

function SectionLabel({ number: index, title, description, children }: {
  number: string; title: string; description: string; children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border bg-card text-[11px] font-medium tabular-nums text-muted-foreground">{index}</span>
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Metric({ label, value, detail, icon, tone }: {
  label: string; value: string; detail: ReactNode; icon: ReactNode; tone?: string;
}) {
  return (
    <Card className="gap-3 p-4 shadow-none sm:p-5">
      <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>{label}</span><span aria-hidden>{icon}</span>
      </div>
      <p className={cn("text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl", tone)}>{value}</p>
      <div className="text-xs leading-relaxed text-muted-foreground">{detail}</div>
    </Card>
  );
}

function CauseRanking({ rows, percentageMode, selectedGroup, onGroupSelect, colors }: {
  rows: FailureCause[]; percentageMode: "all" | "failed";
  selectedGroup?: string | null; onGroupSelect?: (group: string) => void;
  colors: Map<string, string>;
}) {
  const maximum = Math.max(1, ...rows.map(row => row.count));
  return (
    <div className="max-h-[400px] overflow-y-auto overscroll-contain px-4 pb-2 sm:px-5">
      <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_4rem_5rem] gap-3 bg-card pb-3 pt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        <span>{onGroupSelect ? "Group" : "Category"}</span><span className="text-right">Count</span><span className="text-right">{percentageMode === "all" ? "% of all" : "% of failed"}</span>
      </div>
      {rows.map((row, index) => {
        const selected = selectedGroup === row.name;
        const color = colors.get(row.name) ?? burninSeriesPalette[index % burninSeriesPalette.length];
        const content = (
          <>
            <div className="min-w-0">
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-1 size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
                <span className="min-w-0 break-words text-xs font-medium leading-5">{row.name}</span>
                {onGroupSelect && <ArrowUpRight className="ml-auto mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
              </div>
              <div className="ml-4 mt-2 h-1.5 overflow-hidden rounded-full bg-muted/70">
                <div className="h-full rounded-full" style={{ width: `${row.count / maximum * 100}%`, backgroundColor: color }} />
              </div>
            </div>
            <span className="pt-0.5 text-right text-sm font-semibold tabular-nums">{number(row.count)}</span>
            <span className="pt-0.5 text-right text-xs tabular-nums text-muted-foreground">{percentage(percentageMode === "all" ? row.percentage_all : row.percentage_failed)}</span>
          </>
        );
        const rowClass = cn("grid w-full grid-cols-[minmax(0,1fr)_4rem_5rem] items-start gap-3 border-t px-1 py-3 text-left", selected && "rounded-md bg-primary/5 ring-1 ring-inset ring-primary/25");
        return onGroupSelect ? (
          <button key={row.name} type="button" onClick={() => onGroupSelect(row.name)} aria-pressed={selected} className={cn(rowClass, "rounded-md transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}>{content}</button>
        ) : <div key={`${row.group_name ?? ""}:${row.name}`} className={rowClass}>{content}</div>;
      })}
    </div>
  );
}

export function FailureAnalyticsContent({ data, range, chartMode, percentageMode, expandedGroup, onGroupChange }: {
  data: FailureAnalyticsData;
  range: DashboardRange;
  chartMode: string;
  percentageMode: "all" | "failed";
  expandedGroup: string | null;
  onGroupChange: (group: string | null) => void;
}) {
  const { resolvedTheme } = useTheme();
  const [grouping, setGrouping] = useState<TimeGrouping>("daily");
  const [rateView, setRateView] = useState("date");
  const [testWindow, setTestWindow] = useState(100);
  const dark = resolvedTheme === "dark";
  const text = dark ? burninChartColors.text.dark : burninChartColors.text.light;
  const muted = dark ? burninChartColors.muted.dark : burninChartColors.muted.light;
  const grid = dark ? burninChartColors.grid.dark : burninChartColors.grid.light;
  const failureRate = data.totalTests > 0 ? data.totalFailedTests / data.totalTests * 100 : 0;
  const tagged = data.totalFailedTests - data.untaggedFailed;
  const coverage = data.totalFailedTests > 0 ? tagged / data.totalFailedTests * 100 : null;
  const selectedDates = range.kind === "custom" ? range : tableDatesForPill(range.kind);
  const dateLabel = range.kind === "all" ? "All time · UTC" : `${selectedDates.from} – ${selectedDates.to} · UTC`;
  const groupColors = useMemo(() => new Map(data.groups.map((group, index) => [group.name, group.group_color || burninSeriesPalette[index % burninSeriesPalette.length]])), [data.groups]);
  const categoryColors = useMemo(() => new Map(data.categories.map((category, index) => [category.name, burninSeriesPalette[index % burninSeriesPalette.length]])), [data.categories]);
  const categories = useMemo(() => data.categories.filter(category => !expandedGroup || category.group_name === expandedGroup).sort((a, b) => b.count - a.count), [data.categories, expandedGroup]);
  const groups = useMemo(() => [...data.groups].sort((a, b) => b.count - a.count), [data.groups]);
  // These options stay referentially stable across a group drill. A new option
  // object makes echarts-for-react replace the series and replay the entrance animation.
  const ratePoints = useMemo(() => groupFailureTimeline(data.failureRateTimeline.map(point => ({ date: point.date, total: point.total, failed: point.failed, passed: point.passed })), grouping), [data.failureRateTimeline, grouping]);
  const totals = useMemo(() => ratePoints.map(point => Number(point.total)), [ratePoints]);
  const failedCounts = useMemo(() => ratePoints.map(point => Number(point.failed)), [ratePoints]);
  const rates = useMemo(() => totals.map((total, index) => total > 0 ? failedCounts[index] / total * 100 : 0), [totals, failedCounts]);
  const averageWindow = Math.min(7, Math.max(3, Math.floor(rates.length / 4)));
  const periodUnit = { daily: "day", weekly: "week", biweekly: "fortnight", monthly: "month", quarterly: "quarter" }[grouping];
  const empty = (breakdown: "category" | "group" | "rate", hasData: boolean) => failureChartEmptyState({ hasData, breakdown, totalTests: data.totalTests, totalFailedTests: data.totalFailedTests });
  const rateOption = useMemo(() => ({
    animationDurationUpdate: 0,
    ...timelineAxes(ratePoints.map(point => point.date), "Failure rate", grouping, muted, grid, true),
    tooltip: { ...axisTooltip(dark, grid, text), formatter: (points: TooltipPoint[]) => {
      const lines = [`<strong>${escapeHtml(points[0]?.axisValue ?? "")}</strong>`];
      // ECharts exposes missing line values as "-", including the average's warm-up period.
      points.forEach(point => { if (typeof point.value === "number" && Number.isFinite(point.value)) lines.push(`${point.marker} ${escapeHtml(point.seriesName)}: <strong>${percentage(point.value)}</strong>`); });
      return lines.join("<br/>");
    } },
    legend: { top: 4, right: 16, textStyle: { color: muted, fontSize: 10 } },
    series: [
      { name: "Failure rate", type: "line" as const, data: rates, symbol: "circle", symbolSize: 5, itemStyle: { color: burninChartColors.failed.base }, lineStyle: { width: 2 }, areaStyle: { opacity: 0.06 } },
      { name: `${averageWindow}-period moving average`, type: "line" as const, data: weightedFailureAverage(totals, failedCounts, averageWindow), symbol: "none", smooth: true, itemStyle: { color: burninChartColors.accent.indigo }, lineStyle: { width: 2, type: "dashed" as const } },
    ],
  }), [ratePoints, rates, totals, failedCounts, averageWindow, grouping, muted, grid, dark, text]);
  const rollingPoints = useMemo(() => rollingTestFailureRates(data.testOutcomes, testWindow), [data.testOutcomes, testWindow]);
  const rollingOption = useMemo(() => ({
    animation: false,
    animationDurationUpdate: 0,
    grid: { left: 16, right: 20, top: 32, bottom: 28, containLabel: true },
    tooltip: {
      ...axisTooltip(dark, grid, text), trigger: "axis" as const, axisPointer: { type: "line", snap: true },
      formatter: (points: { value: [number, number] }[]) => {
        const point = points[0];
        if (!point) return "";
        const [index, rate] = point.value;
        return `<strong>Test ${number(index)}</strong><br/>Tests ${number(index - testWindow + 1)}–${number(index)}<br/>${number(Math.round(rate * testWindow / 100))} failed of ${number(testWindow)}<br/>Failure rate: <strong>${percentage(rate)}</strong>`;
      },
    },
    xAxis: { type: "value" as const, min: testWindow, max: Math.max(testWindow + 1, data.testOutcomes.length), minInterval: 1, name: "Test sequence", nameLocation: "middle" as const, nameGap: 24, nameTextStyle: { color: muted, fontSize: 10 }, axisLabel: { color: muted, fontSize: 10 }, axisTick: { show: false }, axisLine: { show: false }, splitLine: { show: false } },
    yAxis: { type: "value" as const, min: 0, name: "Failure rate", nameTextStyle: { color: muted, fontSize: 10 }, axisLabel: { color: muted, fontSize: 10, formatter: "{value}%" }, splitLine: { lineStyle: { color: grid, type: "dashed" as const } } },
    series: [{ name: `Last ${testWindow} tests`, type: "line" as const, sampling: "lttb", data: rollingPoints, showSymbol: rollingPoints.length === 1, symbolSize: 5, itemStyle: { color: burninChartColors.failed.base }, lineStyle: { width: 2 }, areaStyle: { opacity: 0.06 } }],
  }), [dark, grid, text, muted, testWindow, data.testOutcomes.length, rollingPoints]);
  const rollingEmpty = data.totalTests === 0 ? empty("rate", false) : rollingPoints.length ? null : {
    heading: `Not enough tests for a ${number(testWindow)}-test window`,
    description: `This period has ${number(data.testOutcomes.length)} selected outcomes. Choose a smaller window or a wider date range.`,
  };
  const volumeOption = useMemo(() => ({
    animationDurationUpdate: 0,
    ...timelineAxes(ratePoints.map(point => point.date), "Tests", grouping, muted, grid),
    tooltip: { ...axisTooltip(dark, grid, text), formatter: (points: TooltipPoint[]) => {
      const total = points.reduce((sum, point) => sum + Number(point.value ?? 0), 0);
      return [`<strong>${escapeHtml(points[0]?.axisValue ?? "")}</strong>`, `Total: <strong>${number(total)}</strong>`, ...points.map(point => `${point.marker} ${escapeHtml(point.seriesName)}: <strong>${number(Number(point.value ?? 0))}</strong>`)].join("<br/>");
    } },
    legend: { top: 4, right: 16, textStyle: { color: muted, fontSize: 10 } },
    series: [
      { name: "Passed", type: "bar" as const, stack: "tests", barMaxWidth: 28, data: ratePoints.map(point => point.passed), itemStyle: { color: burninChartColors.passed.base, opacity: 0.65 } },
      { name: "Failed", type: "bar" as const, stack: "tests", barMaxWidth: 28, data: failedCounts, itemStyle: { color: burninChartColors.failed.base, borderRadius: [2, 2, 0, 0] } },
    ],
  }), [ratePoints, failedCounts, grouping, muted, grid, dark, text]);
  const categoryHistoryOption = useMemo(() => historyChartOption(categories, data.categoryTimeline, categoryColors, grouping, dark, text, muted, grid), [categories, data.categoryTimeline, categoryColors, grouping, dark, text, muted, grid]);
  const groupHistoryOption = useMemo(() => historyChartOption(groups, data.groupTimeline, groupColors, grouping, dark, text, muted, grid), [groups, data.groupTimeline, groupColors, grouping, dark, text, muted, grid]);
  const chart = (title: string, option: object, breakdown: "category" | "group" | "rate", hasData: boolean, height: number) => (
    <FailureChartPanel title={title} emptyState={empty(breakdown, hasData)} height={height} showTitle={false}>
      <ReactECharts option={option} replaceMerge={["series"]} style={{ height }} />
    </FailureChartPanel>
  );
  const cardHeading = (title: string, description: string, badge?: ReactNode) => (
    <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4 sm:px-5 sm:pt-5">
      <div><h3 className="text-sm font-semibold tracking-tight">{title}</h3><p className="mt-1 text-xs text-muted-foreground">{description}</p></div>
      {badge}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[1800px] space-y-7 px-4 py-5 lg:px-6 lg:py-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><p className="text-xs font-medium uppercase tracking-[0.15em] text-muted-foreground">Quality / failure analysis</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Failure overview</h2></div>
        <span className="rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">{dashboardRangeContextLabel(range)} · UTC</span>
      </div>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric label="Failure rate" value={data.totalTests ? percentage(failureRate) : "—"} detail={<><span className="block">{number(data.totalFailedTests)} failed of {number(data.totalTests)} tested</span><span className="mt-1 block text-[11px]">{dateLabel}</span></>} icon={<BarChart3 className="size-4" />} tone={!data.totalTests ? "text-muted-foreground" : data.totalFailedTests ? "text-rose-500" : "text-emerald-500"} />
        <Metric label={chartMode === "recent" ? "Unique inverters" : "Total tests"} value={number(data.totalTests)} detail={<span className="inline-flex items-center gap-1"><CheckCheck className="size-3 text-emerald-500" />{number(data.totalTests - data.totalFailedTests)} passed</span>} icon={<ClipboardList className="size-4" />} />
        <Metric label={chartMode === "recent" ? "Failed · latest per inverter" : "Failed tests"} value={number(data.totalFailedTests)} detail={chartMode === "recent" ? "Inverters whose latest PASS or FAIL is FAIL" : "Every FAIL in the period. Invalid and retest are left out."} icon={<CircleX className="size-4" />} tone={data.totalFailedTests ? "text-rose-500" : undefined} />
        <Metric label="Annotated failures" value={number(tagged)} detail={<><span className="block">{coverage === null ? "No failed tests to annotate" : `${coverage.toFixed(0)}% annotation coverage · ${number(data.totalFailedTests)} failures`}</span><span className="mt-1 block text-[11px]">Period total; each failed test counted once.</span>{data.untaggedFailed > 0 && <Link href={todoHrefFromDashboardRange(range)} className="mt-1 flex items-center gap-1 font-medium text-amber-500 hover:underline">{number(data.untaggedFailed)} untagged · review <ArrowUpRight className="size-3" /></Link>}</>} icon={<Tags className="size-4" />} tone={data.untaggedFailed ? "text-amber-500" : undefined} />
      </div>

      <section className="space-y-3" aria-label="Failure trend and test volume">
        <SectionLabel number="01" title="Failure trend" description="Read the rate alongside the number of tests behind it.">
          <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Group by</span><InfoTooltip content="UTC calendar buckets for the failure-rate, test-volume, and cause-history charts. The by-date moving average gives busier buckets more weight. By test count ignores this grouping." />
            <Select value={grouping} onValueChange={value => setGrouping(value as TimeGrouping)}><SelectTrigger className="h-8 w-[125px] text-xs" aria-label="Group timeline by"><SelectValue /></SelectTrigger><SelectContent>{TIME_GROUPINGS.map(value => <SelectItem key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</SelectItem>)}</SelectContent></Select>
          </div>
        </SectionLabel>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Card className="min-w-0 gap-3 overflow-hidden py-0 shadow-none">
            {cardHeading(rateView === "date" ? "Failure rate over time" : "Failure rate by test count", rateView === "date" ? "Actual rate and a volume-weighted moving average" : `Rolling ${number(testWindow)}-test window · outcomes ordered chronologically`,
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup type="single" value={rateView} onValueChange={value => { if (value) setRateView(value); }} variant="outline" aria-label="Failure rate x-axis">
                  <ToggleGroupItem value="date" className="h-7 px-2 text-[11px]">By date</ToggleGroupItem>
                  <ToggleGroupItem value="tests" className="h-7 px-2 text-[11px]">By test count</ToggleGroupItem>
                </ToggleGroup>
                {rateView === "tests" && <Select value={String(testWindow)} onValueChange={value => setTestWindow(Number(value))}><SelectTrigger className="h-7 w-[125px] text-[11px]" aria-label="Rolling test window"><SelectValue /></SelectTrigger><SelectContent>{[10, 25, 50, 100, 250, 500, 1000, 2000].map(value => <SelectItem key={value} value={String(value)}>{number(value)} tests</SelectItem>)}</SelectContent></Select>}
              </div>
            )}
            <p className="px-4 text-[11px] text-muted-foreground sm:px-5">Selected period: {dateLabel}</p>
            {rateView === "date" ? <>{chart("Failure rate over time", rateOption, "rate", ratePoints.length > 0, 280)}<div className="flex items-center gap-1.5 px-4 pb-4 text-[11px] leading-relaxed text-muted-foreground sm:px-5"><p><strong className="font-medium">{averageWindow}-period average:</strong> failed ÷ total tests across {averageWindow} {periodUnit}s with data.</p><InfoTooltip content={`Each point combines failed tests and total tests from the current ${periodUnit} and the previous ${averageWindow - 1} ${periodUnit}s with tests, then divides failures by total tests. Busier periods carry more weight; periods without tests are skipped. The line starts after ${averageWindow} periods with data. The window adjusts from 3 to 7 periods based on the available history.`} /></div></> : (
              <><FailureChartPanel title="Failure rate by test count" emptyState={rollingEmpty} height={254} showTitle={false}><ReactECharts option={rollingOption} replaceMerge={["series", "xAxis", "yAxis", "legend"]} style={{ height: 254 }} /></FailureChartPanel><p className="px-5 pb-3 text-[11px] text-muted-foreground">Tests are numbered within the selected period. {chartMode === "recent" ? "Latest keeps one PASS or FAIL per inverter." : "Each PASS or FAIL run counts once. Invalid and retest are left out."}</p></>
            )}
          </Card>
          <Card className="min-w-0 gap-3 overflow-hidden py-0 shadow-none">
            {cardHeading("Test volume", chartMode === "recent" ? "Latest outcomes by test date" : "Pass and fail counts by test date")}
            <div className="relative min-h-[280px] flex-1">
              <div className="absolute inset-0">
                <FailureChartPanel title="Test volume" emptyState={empty("rate", ratePoints.length > 0)} height={280} showTitle={false}>
                  <ReactECharts option={volumeOption} replaceMerge={["series"]} style={{ height: "100%" }} />
                </FailureChartPanel>
              </div>
            </div>
          </Card>
        </div>
      </section>

      <section className="space-y-3" aria-label="Failure cause breakdowns">
        <SectionLabel number="02" title="What’s driving the failures?" description="Ranked causes, with exact counts and the selected percentage denominator.">
          {expandedGroup && <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => onGroupChange(null)}><ArrowLeft className="size-3" />All groups</Button>}
        </SectionLabel>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <Card className="min-w-0 gap-3 overflow-hidden py-0 pb-3 shadow-none">
            {cardHeading("Failures by group", "Select a group to inspect its categories", <span className="rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">{groups.length} groups</span>)}
            <FailureChartPanel title="Failures by group" emptyState={empty("group", groups.length > 0)} height={280} showTitle={false}><CauseRanking rows={groups} percentageMode={percentageMode} selectedGroup={expandedGroup} onGroupSelect={group => onGroupChange(group === expandedGroup ? null : group)} colors={groupColors} /></FailureChartPanel>
          </Card>
          <Card className="min-w-0 gap-3 overflow-hidden py-0 pb-3 shadow-none">
            {cardHeading("Failures by category", expandedGroup ? `Showing ${expandedGroup}` : "All categories · highest count first", <span className="rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground">{categories.length} categories</span>)}
            <FailureChartPanel title="Failures by category" emptyState={empty("category", categories.length > 0)} height={280} showTitle={false}><CauseRanking rows={categories} percentageMode={percentageMode} colors={categoryColors} /></FailureChartPanel>
          </Card>
        </div>
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground"><InfoTooltip content="Each count is an annotation on a failed test. One test can carry several, including inside the same group, so the percentages do not have to add up to 100%. Free-text notes are included under Other in the group ranking. The category ranking uses the configured category names." /><span>Causes can overlap. Counts represent annotations; percentages use {percentageMode === "all" ? "all tests" : "failed tests"} as the denominator.</span></p>
      </section>

      <section className="space-y-3" aria-label="Timeline analysis">
        <SectionLabel number="03" title="Cause history" description="See when the categories and groups appeared. Both views use the grouping above." />
        <div className="grid gap-3 xl:grid-cols-2">
          <Card className="min-w-0 gap-3 overflow-hidden py-0 shadow-none">{cardHeading("Failures by category over time", expandedGroup ? `${expandedGroup} · stacked annotation counts` : "All categories · stacked annotation counts")}{chart("Failures by category over time", categoryHistoryOption, "category", categories.length > 0 && data.categoryTimeline.length > 0, 340)}</Card>
          <Card className="min-w-0 gap-3 overflow-hidden py-0 shadow-none">{cardHeading("Failures by group over time", "All groups · stacked annotation counts")}{chart("Failures by group over time", groupHistoryOption, "group", groups.length > 0 && data.groupTimeline.length > 0, 340)}</Card>
        </div>
      </section>
    </div>
  );
}
