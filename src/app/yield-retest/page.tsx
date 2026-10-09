"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, CheckCheck, Clock3, RotateCcw, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { HeaderPeriodControls, HEADER_BAR_CLASS, HEADER_TITLE_CLASS } from "@/components/dashboard/header-controls";
import { appendDashboardRangeParams, tableDatesForPill, type DashboardRange } from "@/lib/dashboard-range";
import { loadDashboardPrefs, resolveDashboardInitState } from "@/lib/dashboard-prefs";
import { yieldPercent, type YieldData, type YieldScope } from "@/lib/yield-retest";
import { useTimezone } from "@/contexts/TimezoneContext";

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const outcomes = [
  { key: "passed", label: "Passed first time", color: "bg-emerald-500", scope: "passed" },
  { key: "recovered", label: "Passed after repeat", color: "bg-primary", scope: "recovered" },
  { key: "unresolved", label: "Latest result failed", color: "bg-rose-500", scope: "unresolved" },
  { key: "pending", label: "No decisive result", color: "bg-amber-500", scope: "pending" },
] as const;
const scopes: { value: YieldScope; label: string }[] = [
  { value: "repeat", label: "Repeat testing" }, { value: "recovered", label: "Passed after repeat" },
  { value: "unresolved", label: "Latest failed" }, { value: "pending", label: "Awaiting result" }, { value: "passed", label: "First pass · still passing" }, { value: "all", label: "All units" },
];

export default function YieldRetestPage() {
  const [range, setRange] = useState<DashboardRange>({ kind: "30d" });
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<YieldData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [scope, setScope] = useState<YieldScope>("repeat");
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [serial, setSerial] = useState("");
  const { formatInTimezone } = useTimezone();
  useEffect(() => {
    setRange(resolveDashboardInitState(loadDashboardPrefs()).dashboardRange);
    setReady(true);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { setSerial(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    const params = new URLSearchParams({ scope, page: String(page), serial });
    appendDashboardRangeParams(params, range);
    fetch(`/api/yield-retest?${params}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Unable to load yield data");
        const result: YieldData = await response.json();
        if (!controller.signal.aborted) setData(result);
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range, ready, scope, page, serial, retry]);
  const changeRange = (next: DashboardRange) => { setRange(next); setPage(1); };
  const changeScope = (next: YieldScope) => { setScope(next); setPage(1); };
  const dates = range.kind === "custom" ? range : tableDatesForPill(range.kind);
  const summary = data?.summary;

  return (
    <div className="yield-home ml-0 flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden md:ml-10 md:h-dvh">
      <header className={`${HEADER_BAR_CLASS} yield-header`}>
        <div className="flex min-w-0 items-center gap-2"><RotateCcw className="size-4 text-primary" /><h1 className={HEADER_TITLE_CLASS}>Yield & Retest</h1></div>
        <div className="min-w-0 sm:ml-auto">
          <HeaderPeriodControls period={range.kind} from={dates.from} to={dates.to} ready={ready}
            onPeriodChange={kind => changeRange({ kind: kind as "7d" | "30d" | "90d" | "all" })}
            onCustomRange={(from, to) => changeRange({ kind: "custom", from, to })} />
        </div>
      </header>
      <main className="flex-1 overflow-y-auto" aria-busy={loading}>
        <div className="mx-auto w-full max-w-[1600px] space-y-5 p-4 lg:space-y-6 lg:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-xl font-semibold tracking-tight sm:text-2xl">What does it take to get a unit through burn-in?</h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">Units are grouped by their first recorded attempt in the selected UTC period. Follow-up results include all later recorded runs, through the latest data.</p></div>
            <Button variant="outline" size="sm" disabled={loading} onClick={() => setRetry(n => n + 1)}>Refresh</Button>
          </div>
          {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <p>Couldn’t load this view. {data ? "The previous results are hidden to avoid mixing periods." : "Please try again."}</p>
            <Button variant="outline" onClick={() => setRetry(n => n + 1)}>Try again</Button>
          </div>}
          {loading ? <div role="status" aria-label="Loading yield and retest" className="space-y-5"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map(n => <Skeleton key={n} className="h-40 rounded-xl" />)}</div><Skeleton className="h-64 rounded-xl" /><Skeleton className="h-80 rounded-xl" /></div>
            : !error && data && summary ? <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric icon={<Target className="size-4" />} label="First-pass yield" value={yieldPercent(summary.firstPass, summary.units)} detail={`${number(summary.firstPass)} of ${number(summary.units)} units passed their first recorded attempt`} />
                <Metric icon={<CheckCheck className="size-4" />} label="Latest-result yield" value={yieldPercent(summary.latestPass, summary.units)} detail={`${number(summary.recovered)} units passed after a first attempt that did not pass`} />
                <Metric icon={<RotateCcw className="size-4" />} label="Units tested again" value={yieldPercent(summary.repeated, summary.units)} detail={`${number(summary.repeated)} units · ${number(summary.repeatRuns)} extra runs`} />
                <Metric icon={<Clock3 className="size-4" />} label="Repeat-test hours" value={`${number(summary.repeatHours)} h`} detail={`Recorded test duration after each unit’s first attempt${summary.missingDurations ? ` · ${number(summary.missingDurations)} durations unavailable` : ""}`} />
              </div>
              {!summary.units ? <div className="rounded-xl border bg-card p-8 text-center"><h3 className="font-semibold">No units entered burn-in in this period</h3><p className="mt-2 text-sm text-muted-foreground">Existing units tested again during this period belong to their original entry period.</p><Button className="mt-4" variant="outline" onClick={() => changeRange({ kind: "all" })}>Show all time</Button></div> : <>
                <div className="grid gap-5 lg:grid-cols-2">
                  <section className="rounded-xl border bg-card p-4 sm:p-5">
                    <h3 className="font-semibold">Where those units stand now</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Latest PASS / FAIL determines the result; INVALID and RETEST do not replace it.</p>
                    <div className="my-5 flex h-4 overflow-hidden rounded-full bg-muted" aria-hidden="true">{outcomes.map(o => {
                      const count = o.key === "passed" ? summary.latestPass - summary.recovered : summary[o.key];
                      return <div key={o.key} className={o.color} style={{ width: `${count / summary.units * 100}%` }} />;
                    })}</div>
                    <div className="space-y-1">{outcomes.map(o => {
                      const count = o.key === "passed" ? summary.latestPass - summary.recovered : summary[o.key];
                      return <button key={o.key} onClick={() => changeScope(o.scope)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                        <span className={`size-2 shrink-0 rounded-full ${o.color}`} /><span className="flex-1">{o.label}{o.key === "passed" ? " · still passing" : ""}</span><span className="font-medium tabular-nums">{number(count)}</span><span className="w-16 text-right text-muted-foreground tabular-nums">{yieldPercent(count, summary.units)}</span><ArrowRight className="size-3 text-muted-foreground" />
                      </button>;
                    })}</div>
                  </section>
                  <section className="rounded-xl border bg-card p-4 sm:p-5">
                    <h3 className="font-semibold">Yield by entry month</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Compare the same units at entry and at their latest decisive result.</p>
                    <div className="mt-3 flex gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-primary" />First pass</span><span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" />Latest result</span></div>
                    <div className="mt-4 max-h-64 space-y-4 overflow-y-auto pr-1">{data.timeline.map(month => <div key={month.month}>
                      <div className="mb-1 flex justify-between text-xs"><span className="font-medium">{new Date(`${month.month}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" })}</span><span className="text-muted-foreground">{number(month.units)} units</span></div>
                      <RateBar label="First pass" count={month.firstPass} total={month.units} color="bg-primary" />
                      <RateBar label="Latest result" count={month.latestPass} total={month.units} color="bg-emerald-500" />
                    </div>)}</div>
                  </section>
                </div>
                <section className="overflow-hidden rounded-xl border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:p-5">
                    <div><h3 className="font-semibold">Follow the unit</h3><p className="mt-1 text-xs text-muted-foreground">Largest repeat-test hours first. Expand a unit to open its recorded runs.</p></div>
                    <label className="sr-only" htmlFor="yield-serial">Search serial number</label><Input id="yield-serial" placeholder="Search serial number…" className="w-full sm:w-60" value={search} onChange={event => setSearch(event.target.value)} />
                    <div className="flex w-full flex-wrap gap-1" aria-label="Unit filter">{scopes.map(item => <Button key={item.value} variant={scope === item.value ? "default" : "ghost"} size="sm" aria-pressed={scope === item.value} onClick={() => changeScope(item.value)}>{item.label}</Button>)}</div>
                  </div>
                  <div className="divide-y">{data.units.map(unit => <details key={unit.serial} className="group">
                    <summary className="flex min-h-20 cursor-pointer list-none flex-wrap items-center gap-3 p-4 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring sm:px-5">
                      <div className="min-w-0 flex-1 basis-40"><div className="break-all font-mono text-sm font-semibold">{unit.serial}</div><div className="mt-1 text-xs text-muted-foreground">Entered {formatInTimezone(unit.firstDate)}</div></div>
                      <span className={`rounded-md px-2 py-1 text-xs font-medium ${unit.outcome === "unresolved" ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : unit.outcome === "pending" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"}`}>{outcomes.find(o => o.key === unit.outcome)?.label}</span>
                      <div className="text-right text-xs tabular-nums"><div className="font-medium">{unit.attempts} {unit.attempts === 1 ? "run" : "runs"}</div><div className="mt-1 text-muted-foreground">{number(unit.repeatHours)} h repeat{unit.missingDurations ? " + unknown" : ""}</div></div>
                      <ArrowRight className="size-4 text-muted-foreground transition-transform group-open:rotate-90" />
                    </summary>
                    <div className="bg-muted/20 px-4 pb-4 pt-2 sm:px-5">
                      {unit.attempts > 100 && <p className="mb-2 text-xs text-muted-foreground">Showing the latest 100 of {unit.attempts} runs.</p>}
                      <ol className="flex flex-wrap gap-2">{unit.history.map((run, index) => <li key={run.id} className="flex min-w-0 items-center gap-2">
                        {index > 0 && <ArrowRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
                        <Link href={`/test/${run.id}`} className="min-w-0 rounded-lg border bg-card px-3 py-2 text-xs hover:border-primary focus-visible:outline-2 focus-visible:outline-ring">
                          <span className={`font-semibold ${run.status === "FAIL" ? "text-rose-600 dark:text-rose-400" : run.status === "PASS" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>{run.status}</span>
                          <span className="ml-2 text-muted-foreground">{run.hours === null ? "Duration unknown" : `${number(run.hours)} h`}</span>
                          <div className="mt-1">{formatInTimezone(run.start)}</div><div className="mt-1 max-w-64 break-all text-muted-foreground">FW {run.firmware || "unknown"} · {run.station || "Station unknown"}</div>
                        </Link>
                      </li>)}</ol>
                    </div>
                  </details>)}</div>
                  {!data.units.length && <p className="p-6 text-sm text-muted-foreground">No units match this filter.</p>}
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs text-muted-foreground">
                    <span>{number(data.matchingUnits)} matching units · Page {data.page} of {Math.max(1, Math.ceil(data.matchingUnits / data.pageSize))}</span>
                    <div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(n => n - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={page * data.pageSize >= data.matchingUnits} onClick={() => setPage(n => n + 1)}>Next</Button></div>
                  </div>
                </section>
              </>}
              <details className="rounded-xl border bg-card p-4 text-sm">
                <summary className="cursor-pointer font-medium">How to read these numbers</summary>
                <div className="mt-3 max-w-4xl space-y-2 text-xs leading-relaxed text-muted-foreground">
                  <p>First-pass yield = units whose first recorded attempt is PASS ÷ all units entering this cohort. INVALID and RETEST count as attempts, not failures; {number(summary.firstNondecisive)} units began with one of those results. Latest-result yield uses the latest PASS or FAIL, with units awaiting any decisive result retained in the denominator.</p>
                  <p>Passed after repeat means the first attempt did not pass and the latest decisive result is PASS. It describes recorded outcomes, not proof of a repair. A unit that passed first and later failed appears under latest failed.</p>
                  <p>Repeat-test hours sum valid run durations after the first recorded attempt, including INVALID and RETEST. They are cumulative unit test hours, not station occupancy, labor hours, or cost. Missing or negative durations are excluded and reported.</p>
                  <p>History is limited to data we have ingested. Missing earlier runs can make a repeat appear to be a first attempt. Verdict overrides affect these results. Recent cohorts have had less time to complete repeat testing, so compare them with care.</p>
                  <p>Loaded {formatInTimezone(data.asOf)}. Dashboard station and annotation filters do not apply to this view.</p>
                </div>
              </details>
            </> : null}
        </div>
      </main>
    </div>
  );
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) {
  return <section className="rounded-xl border bg-card p-4 sm:p-5"><div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">{label}<span className="text-primary">{icon}</span></div><div className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p></section>;
}
function RateBar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  return <div className="flex items-center gap-2" aria-label={`${label}: ${yieldPercent(count, total)}, ${count} of ${total} units`}><div className="my-1 h-2 flex-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${color}`} style={{ width: `${total ? count / total * 100 : 0}%` }} /></div><span className="w-14 text-right text-xs tabular-nums">{yieldPercent(count, total)}</span></div>;
}
