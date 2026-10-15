"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Factory, Hourglass, RotateCcw, ShieldCheck, Target, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { HeaderPeriodControls, HeaderRangeMeta, HEADER_BAR_CLASS, HEADER_CONTROLS_CLASS, HEADER_TITLE_CLASS } from "@/components/dashboard/header-controls";
import { appendDashboardRangeParams, tableDatesForPill, dashboardRangeLabel, type DashboardRange } from "@/lib/dashboard-range";
import { loadDashboardPrefs, resolveDashboardInitState } from "@/lib/dashboard-prefs";
import { yieldPercent, type YieldData, type YieldFirstResult, type YieldScope } from "@/lib/yield-retest";
import { utcDayMs } from "@/lib/day-buckets";
import { useTimezone } from "@/contexts/TimezoneContext";
import { ThroughputChart } from "@/components/yield/throughput-chart";

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 1 });
const whole = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });
const duration = (hours: number | null) => hours === null ? "—" : hours < 48 ? `${number(hours)} h` : `${number(hours / 24)} days`;
const outcomes = [
  { key: "passed", label: "Passed first time", color: "bg-emerald-500", scope: "passed" },
  { key: "recovered", label: "Passed after repeat", color: "bg-primary", scope: "recovered" },
  { key: "unresolved", label: "Latest result failed", color: "bg-rose-500", scope: "unresolved" },
  { key: "pending", label: "No decisive result", color: "bg-amber-500", scope: "pending" },
] as const;
const scopes: { value: YieldScope; label: string }[] = [
  { value: "held", label: "Held up" }, { value: "repeat", label: "Repeat testing" }, { value: "recovered", label: "Passed after repeat" },
  { value: "unresolved", label: "Latest failed" }, { value: "pending", label: "Awaiting result" }, { value: "passed", label: "First pass · still passing" }, { value: "all", label: "All units" },
];
const REASONS: Record<string, { label: string; note: string }> = {
  PASS: { label: "Passed, then run again", note: "The first run already passed" },
  RETEST: { label: "Marked RETEST", note: "First run flagged to be repeated" },
  FAIL: { label: "Failed first run", note: "First run failed" },
  INVALID: { label: "Invalid first run", note: "First run was not a valid test" },
};

export default function YieldRetestPage() {
  const [range, setRange] = useState<DashboardRange>({ kind: "30d" });
  const [ready, setReady] = useState(false);
  const [snapshot, setSnapshot] = useState<{ data: YieldData; range: DashboardRange; listKey: string } | null>(null);
  const data = snapshot?.data ?? null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const [scope, setScope] = useState<YieldScope>("held");
  const [firstResult, setFirstResult] = useState<YieldFirstResult | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [serial, setSerial] = useState("");
  const { formatInTimezone } = useTimezone();
  const rangeKey = JSON.stringify(range);
  const listKey = JSON.stringify({ scope, page, serial, firstResult });
  const periodChanged = snapshot !== null && JSON.stringify(snapshot.range) !== rangeKey;
  const listChanged = snapshot !== null && snapshot.listKey !== listKey;
  const updating = loading || (!error && (periodChanged || listChanged));
  const paginationBlocked = updating || periodChanged || listChanged;
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
    if (firstResult) params.set("first", firstResult);
    appendDashboardRangeParams(params, range);
    fetch(`/api/yield-retest?${params}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Unable to load yield data");
        const result: YieldData = await response.json();
        if (!controller.signal.aborted) setSnapshot({ data: result, range, listKey });
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range, ready, scope, page, serial, firstResult, retry, listKey]);
  const changeRange = (next: DashboardRange) => { setRange(next); setPage(1); };
  const changeScope = (next: YieldScope) => { setScope(next); setFirstResult(null); setPage(1); };
  const showUnits = (next: YieldScope, first: YieldFirstResult | null = null) => {
    changeScope(next);
    setFirstResult(first);
    document.querySelector("[data-yield-units]")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const dates = range.kind === "custom" ? range : tableDatesForPill(range.kind);
  const summary = data?.summary;
  const loadedLabel = snapshot ? dashboardRangeLabel(snapshot.range) : dashboardRangeLabel(range);

  // Production rate: units entering burn-in per calendar day of the period.
  const periodDays = data?.period.from ? Math.max(1, Math.round((utcDayMs(data.period.to) - utcDayMs(data.period.from)) / 86_400_000) + 1) : null;
  const perDay = summary && periodDays ? summary.units / periodDays : null;
  const previous = data?.previous;
  const runs = data?.daily.reduce((t, d) => ({ all: t.all + d.newUnits + d.repeatRuns, repeat: t.repeat + d.repeatRuns, repeatHours: t.repeatHours + d.repeatHours }), { all: 0, repeat: 0, repeatHours: 0 });
  const fpyChange = summary && previous?.units ? (summary.firstPass / Math.max(1, summary.units) - previous.firstPass / previous.units) * 100 : null;
  const reasons = data?.repeatReasons ?? [];
  const repeatedUnits = reasons.reduce((n, r) => n + r.units, 0);
  const maxReason = Math.max(1, ...reasons.map(r => r.units));
  const passedAgain = reasons.find(r => r.status === "PASS")?.units ?? 0;

  return (
    <div className="yield-home ml-0 flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden md:ml-10 md:h-dvh">
      <header className={`${HEADER_BAR_CLASS} yield-header`}>
        <div className="flex min-w-0 items-center gap-2"><RotateCcw className="size-4 text-primary" /><h1 className={HEADER_TITLE_CLASS}>Yield & Retest</h1></div>
        <div className={HEADER_CONTROLS_CLASS}>
          <HeaderPeriodControls period={range.kind} from={dates.from} to={dates.to} ready={ready}
            onPeriodChange={kind => changeRange({ kind: kind as "7d" | "30d" | "90d" | "all" })}
            onCustomRange={(from, to) => changeRange({ kind: "custom", from, to })} />
        </div>
        <HeaderRangeMeta range={range} updatedAt={data ? new Date(data.asOf) : null} ready={ready} />
      </header>
      <main className="flex-1 overflow-y-auto" aria-busy={loading && (!data || periodChanged)}>
        <div className="yield-content mx-auto w-full space-y-5 p-4 lg:space-y-6 lg:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Burn-in throughput and yield</h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">How many units are entering burn-in, how many pass, and where repeat testing slows them down. Units belong to the UTC day of their first recorded run.</p></div>
            <Button variant="outline" size="sm" disabled={loading} onClick={() => setRetry(n => n + 1)}>Refresh</Button>
          </div>
          {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <p>Couldn’t {data ? "update" : "load"} this view. {snapshot ? `Showing the last loaded results for ${dashboardRangeLabel(snapshot.range)}${listChanged ? ", with the previous unit list" : ""}.` : "Please try again."}</p>
            <Button variant="outline" onClick={() => setRetry(n => n + 1)}>Try again</Button>
          </div>}
          {!data && loading ? <div role="status" aria-label="Loading yield and retest" className="space-y-5"><Skeleton className="h-96 rounded-xl" /><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map(n => <Skeleton key={n} className="h-36 rounded-xl" />)}</div><Skeleton className="h-72 rounded-xl" /></div>
            : data && summary ? <>
              {/* Announced only to assistive tech: a visible banner here shifted the whole page. */}
              <p role="status" className="sr-only">{snapshot && periodChanged && !error ? `Updating the period… Showing ${dashboardRangeLabel(snapshot.range)} until the new results arrive.` : ""}</p>
              <div data-yield-overview className={`space-y-5 transition-opacity duration-150 lg:space-y-6 ${periodChanged && !error ? "opacity-60" : ""}`}>
                <section className="rounded-xl border bg-card p-4 sm:p-5" aria-labelledby="yield-throughput">
                  <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
                    <div>
                      <h3 id="yield-throughput" className="flex items-center gap-2 text-sm font-medium text-muted-foreground"><Factory className="size-4 text-primary" />Units entering burn-in</h3>
                      <p className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="text-4xl font-semibold tracking-tight tabular-nums">{whole(summary.units)}</span>
                        <span className="text-sm text-muted-foreground">units in {loadedLabel}</span>
                      </p>
                    </div>
                    <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
                      {perDay !== null && <div><dt className="text-xs text-muted-foreground">Average per day</dt><dd className="text-lg font-semibold tabular-nums">{whole(perDay)}</dd></div>}
                      {previous && <div><dt className="text-xs text-muted-foreground">Previous period</dt><dd className="text-lg font-semibold tabular-nums">{whole(previous.units)}</dd></div>}
                      {runs && <div><dt className="text-xs text-muted-foreground">All runs incl. repeats</dt><dd className="text-lg font-semibold tabular-nums">{whole(runs.all)}</dd></div>}
                    </dl>
                  </div>
                  {summary.units ? <div className="mt-4"><ThroughputChart daily={data.daily} from={data.period.from} to={data.period.to} /></div>
                    : <div className="mt-6 rounded-lg border border-dashed p-8 text-center"><h3 className="font-semibold">No units entered burn-in in this period</h3><p className="mt-2 text-sm text-muted-foreground">Existing units tested again during this period belong to their original entry period.</p><Button className="mt-4" variant="outline" onClick={() => changeRange({ kind: "all" })}>Show all time</Button></div>}
                </section>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <Metric icon={<Target className="size-4" />} label="First-pass yield" value={yieldPercent(summary.firstPass, summary.units)}
                    detail={`${whole(summary.firstPass)} of ${whole(summary.units)} units passed their first run`}
                    note={fpyChange !== null ? `${fpyChange >= 0 ? "+" : "−"}${Math.abs(fpyChange).toFixed(1)} pts vs previous period` : undefined} />
                  <Metric icon={<ShieldCheck className="size-4" />} label="Units cleared" value={yieldPercent(summary.latestPass, summary.units)}
                    detail={`${whole(summary.latestPass)} units have a passing result, ${whole(summary.recovered)} of them after a repeat`} />
                  <Metric icon={<RotateCcw className="size-4" />} label="Test capacity on repeats" value={runs?.all ? yieldPercent(runs.repeat, runs.all) : "—"}
                    detail={`${whole(runs?.repeat ?? 0)} repeat runs · ${whole(runs?.repeatHours ?? 0)} h of test time in this period`} />
                  <Metric icon={<Hourglass className="size-4" />} label="Units held up" value={whole(data.clearing.heldUp)} tone={data.clearing.heldUp ? "warn" : undefined}
                    detail={data.clearing.heldUp ? `No passing result yet · typically ${duration(data.clearing.heldUpMedianAgeHours)} since their first run` : "Every unit has a passing result"}
                    action={data.clearing.heldUp ? { label: "List held-up units", onClick: () => showUnits("held") } : undefined} />
                </div>

                {summary.units > 0 && <div className="grid gap-5 lg:grid-cols-3">
                  <section className="rounded-xl border bg-card p-4 sm:p-5">
                    <h3 className="font-semibold">Why units ran again</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{whole(repeatedUnits)} units ({yieldPercent(repeatedUnits, summary.units)}) needed more than one run, by their first result. Select one to list those units.</p>
                    {passedAgain > 0 && <p className="mt-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-sm"><span className="font-semibold">{whole(passedAgain)} units had already passed</span> before they were run again. Those runs use test capacity without changing the result.</p>}
                    <ul className="mt-3 space-y-0.5">{reasons.map(r => {
                      const active = scope === "repeat" && firstResult === r.status;
                      return <li key={r.status}>
                        <button type="button" aria-pressed={active} onClick={() => showUnits("repeat", r.status as YieldFirstResult)}
                          className={`w-full rounded-lg px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-ring hover:bg-muted ${active ? "bg-muted ring-1 ring-cyan-600/50" : ""}`}>
                          <span className="mb-1 flex items-center justify-between gap-2 text-sm"><span>{REASONS[r.status]?.label ?? r.status}</span><span className="flex items-center gap-2 font-medium tabular-nums">{whole(r.units)} <span className="font-normal text-muted-foreground">· {yieldPercent(r.units, repeatedUnits)}</span><ArrowRight className="size-3 text-muted-foreground" /></span></span>
                          <span className="block h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-cyan-600" style={{ width: `${r.units / maxReason * 100}%` }} /></span>
                        </button>
                      </li>;
                    })}</ul>
                    {!reasons.length && <p className="mt-4 text-sm text-muted-foreground">No unit needed a second run.</p>}
                  </section>
                  <section className="rounded-xl border bg-card p-4 sm:p-5">
                    <h3 className="font-semibold">Time to a passing result</h3>
                    <p className="mt-1 text-xs text-muted-foreground">From a unit’s first run to the end of its first passing run.</p>
                    <dl className="mt-4 space-y-4">
                      <ClearTime label="Passed first time" value={duration(data.clearing.firstPassMedianHours)} detail="median, essentially one test run" />
                      <ClearTime label="Passed after a repeat" value={duration(data.clearing.recoveredMedianHours)} emphasis
                        detail={data.clearing.recoveredUnits ? `median of ${whole(data.clearing.recoveredUnits)} units · 90% within ${duration(data.clearing.recoveredP90Hours)}` : "no units in this period"} />
                      <ClearTime label="Still without a pass" value={duration(data.clearing.heldUpMedianAgeHours)}
                        detail={data.clearing.heldUp ? `median wait so far for ${whole(data.clearing.heldUp)} held-up units` : "no units waiting"} />
                    </dl>
                  </section>
                  <section className="rounded-xl border bg-card p-4 sm:p-5">
                    <h3 className="font-semibold">Where this period’s units stand now</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Latest PASS / FAIL decides; INVALID and RETEST do not replace it.</p>
                    <div className="my-4 flex h-3 overflow-hidden rounded-full bg-muted" aria-hidden="true">{outcomes.map(o => {
                      const count = o.key === "passed" ? summary.latestPass - summary.recovered : summary[o.key];
                      return <div key={o.key} className={o.color} style={{ width: `${count / summary.units * 100}%` }} />;
                    })}</div>
                    <div className="space-y-0.5">{outcomes.map(o => {
                      const count = o.key === "passed" ? summary.latestPass - summary.recovered : summary[o.key];
                      return <button key={o.key} onClick={() => showUnits(o.scope)} className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                        <span className={`size-2 shrink-0 rounded-full ${o.color}`} /><span className="flex-1">{o.label}{o.key === "passed" ? " · still passing" : ""}</span><span className="font-medium tabular-nums">{whole(count)}</span><span className="w-14 text-right text-muted-foreground tabular-nums">{yieldPercent(count, summary.units)}</span><ArrowRight className="size-3 text-muted-foreground" />
                      </button>;
                    })}</div>
                  </section>
                </div>}
              </div>

              {summary.units > 0 && <section data-yield-units className="scroll-mt-4 overflow-hidden rounded-xl border bg-card" aria-busy={updating}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:px-5">
                  <div><h3 className="font-semibold">Follow the unit</h3><p className="mt-1 text-xs text-muted-foreground">Most repeat-test hours first. Expand a unit to open its recorded runs.</p></div>
                  <label className="sr-only" htmlFor="yield-serial">Search serial number</label><Input id="yield-serial" placeholder="Search serial number…" className="w-full sm:w-60" value={search} onChange={event => setSearch(event.target.value)} />
                  <div className="flex w-full flex-wrap items-center gap-1" aria-label="Unit filter">{scopes.map(item => <Button key={item.value} variant={scope === item.value && !firstResult ? "default" : "ghost"} size="sm" aria-pressed={scope === item.value && !firstResult} onClick={() => changeScope(item.value)}>{item.label}</Button>)}
                    {firstResult && <Button size="sm" onClick={() => changeScope("repeat")} aria-label={`Clear filter: ${REASONS[firstResult]?.label ?? firstResult}`}>{REASONS[firstResult]?.label ?? firstResult}<X className="size-3.5" /></Button>}</div>
                </div>
                <div role="status" aria-live="polite" className="flex min-h-9 items-center border-b px-4 text-xs text-muted-foreground sm:px-5">{loading ? "Updating unit results…" : error ? "Showing the last loaded unit results." : `${number(data.matchingUnits)} matching units`}</div>
                <div className="hidden grid-cols-[minmax(10rem,1.2fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_5rem_7rem_1.5rem] gap-3 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground md:grid sm:px-5" aria-hidden="true">
                  <span>Serial</span><span>First run</span><span>Outcome</span><span className="text-right">Runs</span><span className="text-right">Repeat hours</span><span />
                </div>
                <div className={`divide-y transition-opacity duration-150 ${updating && !error ? "pointer-events-none opacity-60" : ""}`} inert={updating && !error}>{data.units.map(unit => <details key={unit.serial} className="group">
                  <summary className="grid cursor-pointer list-none grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring sm:px-5 md:grid-cols-[minmax(10rem,1.2fr)_minmax(9rem,1fr)_minmax(9rem,1fr)_5rem_7rem_1.5rem]">
                    <span className="break-all font-mono text-sm font-semibold">{unit.serial}</span>
                    <span className="hidden text-xs text-muted-foreground md:block">{formatInTimezone(unit.firstDate)}</span>
                    <span><OutcomeBadge outcome={unit.outcome} /></span>
                    <span className="text-xs tabular-nums md:text-right md:text-sm">{unit.attempts} {unit.attempts === 1 ? "run" : "runs"}</span>
                    <span className="text-right text-xs text-muted-foreground tabular-nums md:text-sm">{number(unit.repeatHours)} h{unit.missingDurations ? " + unknown" : ""}</span>
                    <ArrowRight className="hidden size-4 text-muted-foreground transition-transform group-open:rotate-90 md:block" />
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
                  <div className="flex gap-2"><Button variant="outline" size="sm" disabled={paginationBlocked || page <= 1} onClick={() => setPage(n => n - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={paginationBlocked || page * data.pageSize >= data.matchingUnits} onClick={() => setPage(n => n + 1)}>Next</Button></div>
                </div>
              </section>}
              <details className="rounded-xl border bg-card p-4 text-sm">
                <summary className="cursor-pointer font-medium">How to read these numbers</summary>
                <div className="mt-3 max-w-4xl space-y-2 text-xs leading-relaxed text-muted-foreground">
                  <p>Units entering burn-in counts each unit once, on the UTC day of its first recorded run. The chart adds repeat runs (a unit’s second and later runs) on the day they started, so a bar’s full height is all burn-in runs that day.</p>
                  <p>First-pass yield = units whose first run is PASS ÷ units entering in the period. INVALID and RETEST count as runs, not failures; {number(summary.firstNondecisive)} units began with one of those results. Units cleared uses each unit’s latest PASS or FAIL, through the latest data.</p>
                  <p>Test capacity on repeats = repeat runs ÷ all runs started in the period. Units held up have no passing result yet: their latest decisive result is FAIL, or they have no PASS or FAIL at all. Time to a passing result runs from the start of the first run to the end of the first passing run.</p>
                  <p>History is limited to data we have ingested. Missing earlier runs can make a repeat appear to be a first attempt, and the previous period may be incomplete when it falls before ingest began. Verdict overrides affect these results. Recent units have had less time to complete repeat testing, so compare them with care.</p>
                  <p>Loaded {formatInTimezone(data.asOf)}. Dashboard station and annotation filters do not apply to this view.</p>
                </div>
              </details>
            </> : null}
        </div>
      </main>
    </div>
  );
}

function Metric({ label, value, detail, icon, note, tone, action }: {
  label: string; value: string; detail: string; icon: React.ReactNode; note?: string; tone?: "warn";
  action?: { label: string; onClick: () => void };
}) {
  return <section className={`flex flex-col rounded-xl border bg-card p-4 sm:p-5 ${tone === "warn" ? "border-amber-500/40" : ""}`}>
    <div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">{label}<span className={tone === "warn" ? "text-amber-600 dark:text-amber-400" : "text-primary"}>{icon}</span></div>
    <div className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
    <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p>
    {note && <p className="mt-1 text-xs font-medium text-muted-foreground">{note}</p>}
    {action && <button type="button" onClick={action.onClick} className="mt-auto flex items-center gap-1 self-start pt-3 text-xs font-medium text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring">{action.label}<ArrowRight className="size-3" /></button>}
  </section>;
}

function ClearTime({ label, value, detail, emphasis }: { label: string; value: string; detail: string; emphasis?: boolean }) {
  return <div className="flex items-baseline justify-between gap-4 border-b pb-3 last:border-0 last:pb-0">
    <div><dt className="text-sm">{label}</dt><dd className="mt-0.5 text-xs text-muted-foreground">{detail}</dd></div>
    <dd className={`shrink-0 font-semibold tabular-nums ${emphasis ? "text-2xl" : "text-lg"}`}>{value}</dd>
  </div>;
}

function OutcomeBadge({ outcome }: { outcome: "passed" | "recovered" | "unresolved" | "pending" }) {
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${outcome === "unresolved" ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : outcome === "pending" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"}`}>{outcomes.find(o => o.key === outcome)?.label}</span>;
}
