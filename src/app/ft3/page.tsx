"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, CopyCheck, FileUp, Loader2, Repeat, Upload, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { HeaderPeriodControls, HeaderRangeMeta, HEADER_BAR_CLASS, HEADER_CONTROLS_CLASS, HEADER_TITLE_CLASS } from "@/components/dashboard/header-controls";
import { appendDashboardRangeParams, tableDatesForPill, dashboardRangeLabel, type DashboardRange } from "@/lib/dashboard-range";
import { loadDashboardPrefs, resolveDashboardInitState } from "@/lib/dashboard-prefs";
import { yieldPercent } from "@/lib/yield-retest";
import { FT3_STEPS } from "@/lib/ft3";
import type { Ft3ListData, Ft3VerdictFilter } from "@/lib/ft3-query";
import type { Ft3QuarantinedFile } from "@/lib/ft3Ops";
import type { Ft3UploadFileResult } from "@/app/api/ft3/upload/route";
import { useTimezone } from "@/contexts/TimezoneContext";
import { VerdictBadge, BurninStatus } from "@/components/ft3/verdict";
import { Ft3TrendChart } from "@/components/ft3/ft3-trend-chart";

const number = (value: number) => value.toLocaleString();
const verdicts: { value: Ft3VerdictFilter; label: string }[] = [
  { value: "all", label: "All runs" }, { value: "FAIL", label: "Failed" }, { value: "PASS", label: "Passed" },
];
const UPLOAD_BATCH = 25;

export default function Ft3Page() {
  const router = useRouter();
  const { formatInTimezone } = useTimezone();
  const [range, setRange] = useState<DashboardRange>({ kind: "30d" });
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Ft3ListData | null>(null);
  const [loadedRange, setLoadedRange] = useState<DashboardRange | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [verdict, setVerdict] = useState<Ft3VerdictFilter>("all");
  const [step, setStep] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [serial, setSerial] = useState("");

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
    const params = new URLSearchParams({ verdict, page: String(page), serial });
    if (step) params.set("step", step);
    appendDashboardRangeParams(params, range);
    fetch(`/api/ft3?${params}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Unable to load FT3 results");
        const result: Ft3ListData = await response.json();
        if (!controller.signal.aborted) { setData(result); setLoadedRange(range); }
      })
      .catch(() => { if (!controller.signal.aborted) setError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [range, ready, verdict, step, page, serial, reload]);

  const changeRange = (next: DashboardRange) => { setRange(next); setPage(1); };
  const filterStep = (next: string | null) => { setStep(next); setVerdict(next ? "FAIL" : "all"); setPage(1); };
  const changeVerdict = (next: Ft3VerdictFilter) => { setVerdict(next); if (next !== "FAIL") setStep(null); setPage(1); };
  const dates = range.kind === "custom" ? range : tableDatesForPill(range.kind);
  const summary = data?.summary;
  const stepCounts = new Map(data?.failuresByStep.map(s => [s.step, s.count]));
  const failureSteps = FT3_STEPS.map(s => ({ step: s.label, count: stepCounts.get(s.label) ?? 0 }));
  const maxStepCount = Math.max(1, ...failureSteps.map(s => s.count));
  const periodLabel = dashboardRangeLabel(loadedRange ?? range);

  return (
    <div className="ml-0 flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden md:ml-10 md:h-dvh">
      <header className={HEADER_BAR_CLASS}>
        <div className="flex min-w-0 items-center gap-2"><ClipboardCheck className="size-4 text-primary" /><h1 className={HEADER_TITLE_CLASS}>FT3 Results</h1></div>
        <div className={HEADER_CONTROLS_CLASS}>
          <HeaderPeriodControls period={range.kind} from={dates.from} to={dates.to} ready={ready}
            onPeriodChange={kind => changeRange({ kind: kind as "7d" | "30d" | "90d" | "all" })}
            onCustomRange={(from, to) => changeRange({ kind: "custom", from, to })} />
        </div>
        <HeaderRangeMeta range={range} updatedAt={data ? new Date(data.asOf) : null} ready={ready} />
      </header>
      <main className="flex-1 overflow-y-auto" aria-busy={loading}>
        <div className="mx-auto w-full space-y-5 p-4 lg:space-y-6 lg:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">Functional test results</h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground">FT3 runs seven subtests in order and stops at the first failure. Results arrive from the FT3 pCloud folder or by upload. Periods use UTC days of the test time.</p>
            </div>
            <Button variant="outline" size="sm" disabled={loading} onClick={() => setReload(n => n + 1)}>Refresh</Button>
          </div>

          <ProblemFiles reload={reload} />
          <UploadPanel onUploaded={() => setReload(n => n + 1)} />

          {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <p>Couldn’t {data ? "update" : "load"} FT3 results.{data ? ` Showing the last loaded results for ${periodLabel}.` : ""}</p>
            <Button variant="outline" onClick={() => setReload(n => n + 1)}>Try again</Button>
          </div>}

          {!data && loading ? <div role="status" aria-label="Loading FT3 results" className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map(n => <Skeleton key={n} className="h-36 rounded-xl" />)}</div>
            <Skeleton className="h-72 rounded-xl" />
            <Skeleton className="h-80 rounded-xl" />
          </div> : data && summary ? <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric icon={<CheckCircle2 className="size-4" />} label="Run pass rate" value={yieldPercent(summary.passed, summary.runs)} detail={`${number(summary.passed)} of ${number(summary.runs)} runs passed in ${periodLabel}`} />
              <Metric icon={<XCircle className="size-4" />} label="Failed runs" value={number(summary.failed)}
                detail={data.failuresByStep[0] ? `Most stopped at ${data.failuresByStep[0].step} (${number(data.failuresByStep[0].count)})` : "No failed runs in this period"} />
              <Metric icon={<CopyCheck className="size-4" />} label="Units passing now" value={yieldPercent(summary.unitsLatestPass, summary.units)} detail={`${number(summary.unitsLatestPass)} of ${number(summary.units)} units passed their latest run in this period`} />
              <Metric icon={<Repeat className="size-4" />} label="Units tested again" value={number(summary.unitsRetested)} detail={`Units with more than one FT3 run in this period`} />
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
              <section className="min-w-0 rounded-xl border bg-card p-4 sm:p-5">
                <h3 className="font-semibold">Runs over time</h3>
                <p className="mb-3 mt-1 text-xs text-muted-foreground">Passed and failed runs in {periodLabel}. Hover a bar for the pass rate.</p>
                <Ft3TrendChart daily={data.daily} from={data.period.from} to={data.period.to} />
              </section>
              <section className="rounded-xl border bg-card p-4 sm:p-5">
                <h3 className="font-semibold">Where runs stop</h3>
                <p className="mt-1 text-xs text-muted-foreground">Failed runs by the subtest that failed, in test order. Select one to list those runs.</p>
                <ol className="mt-3 space-y-1">{failureSteps.map((s, i) => {
                  const active = step === s.step;
                  return <li key={s.step}>
                    <button type="button" disabled={!s.count && !active} aria-pressed={active} onClick={() => filterStep(active ? null : s.step)}
                      className={`w-full rounded-lg px-2 py-1.5 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring enabled:hover:bg-muted disabled:cursor-default ${active ? "bg-muted ring-1 ring-rose-500/50" : ""}`}>
                      <span className="mb-1 flex justify-between gap-2"><span><span className="mr-2 text-muted-foreground tabular-nums">{i + 1}</span>{s.step}</span><span className="font-medium tabular-nums">{number(s.count)}</span></span>
                      <span className="block h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-rose-500" style={{ width: `${s.count / maxStepCount * 100}%` }} /></span>
                    </button>
                  </li>;
                })}</ol>
              </section>
            </div>

            <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4 sm:p-5">
                <div><h3 className="font-semibold">Runs</h3><p className="mt-1 text-xs text-muted-foreground">Newest first. Open a run to see each subtest.</p></div>
                <label className="sr-only" htmlFor="ft3-serial">Search serial number</label>
                <Input id="ft3-serial" placeholder="Search serial number…" className="w-full sm:w-60" value={search} onChange={e => setSearch(e.target.value)} />
                <div className="flex w-full flex-wrap items-center gap-1" aria-label="Run filter">
                  {verdicts.map(v => <Button key={v.value} variant={verdict === v.value && !step ? "default" : "ghost"} size="sm" aria-pressed={verdict === v.value && !step} onClick={() => changeVerdict(v.value)}>{v.label}</Button>)}
                  {step && <Button size="sm" onClick={() => filterStep(null)} aria-label={`Clear filter: failed at ${step}`}>Failed at {step}<X className="size-3.5" /></Button>}
                </div>
              </div>
              <div role="status" aria-live="polite" className="flex min-h-9 items-center border-b px-4 text-xs text-muted-foreground sm:px-5">{loading ? "Updating runs…" : `${number(data.matching)} matching runs`}</div>
              <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
                <table className="w-full min-w-[56rem] text-sm">
                  <thead className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <tr><th className="px-4 py-2 font-medium">Test time</th><th className="px-4 py-2 font-medium">Serial</th><th className="px-4 py-2 font-medium">Verdict</th><th className="px-4 py-2 font-medium">Failed at</th><th className="px-4 py-2 font-medium">Tester</th><th className="px-4 py-2 font-medium">FPGA</th><th className="px-4 py-2 font-medium">Zigbee</th><th className="px-4 py-2 font-medium">Burn-in</th><th className="w-10 px-4 py-2"><span className="sr-only">Open</span></th></tr>
                  </thead>
                  <tbody className="divide-y">{data.rows.map(row =>
                    <tr key={row.id} className="group cursor-pointer hover:bg-muted/40" onClick={() => router.push(`/ft3/${row.id}`)}>
                      <td className="whitespace-nowrap px-4 py-3 tabular-nums">{formatInTimezone(row.testTime)}</td>
                      <td className="px-4 py-3"><Link href={`/ft3/${row.id}`} className="font-mono font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={e => e.stopPropagation()}>{row.serial}</Link>
                        {row.attempts > 1 && <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">{row.attempts} runs</span>}</td>
                      <td className="px-4 py-3"><VerdictBadge verdict={row.verdict} /></td>
                      <td className="px-4 py-3">{row.failedStep ?? <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-4 py-3">{row.tester ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{row.fpga ?? "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs">{row.zigbee ?? "—"}</td>
                      <td className="px-4 py-3"><BurninStatus runs={row.burninRuns} latest={row.burninLatest} /></td>
                      <td className="px-4 py-3"><ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" /></td>
                    </tr>)}</tbody>
                </table>
                {!data.rows.length && <div className="p-8 text-center">
                  <p className="font-medium">{summary.runs ? "No runs match these filters" : "No FT3 runs in this period"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{summary.runs ? "Clear the search or choose another filter." : "New results appear once the FT3 pCloud folder syncs, or upload CSV files above."}</p>
                  {!summary.runs && range.kind !== "all" && <Button className="mt-4" variant="outline" onClick={() => changeRange({ kind: "all" })}>Show all time</Button>}
                </div>}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs text-muted-foreground">
                <span>{number(data.matching)} matching runs · Page {data.page} of {Math.max(1, Math.ceil(data.matching / data.pageSize))}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => setPage(n => n - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={loading || page * data.pageSize >= data.matching} onClick={() => setPage(n => n + 1)}>Next</Button>
                </div>
              </div>
            </section>
          </> : null}
        </div>
      </main>
    </div>
  );
}

function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon: React.ReactNode }) {
  return <section className="rounded-xl border bg-card p-4 sm:p-5"><div className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">{label}<span className="text-primary">{icon}</span></div><div className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p></section>;
}

function ProblemList({ files }: { files: { name: string; problems: string[]; detail?: string }[] }) {
  return <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border bg-background/60 text-xs">{files.map(f =>
    <li key={f.name} className="px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3"><span className="break-all font-mono font-medium">{f.name}</span>{f.detail && <span className="text-muted-foreground">{f.detail}</span>}</div>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">{f.problems.map(p => <li key={p} className="break-words">{p}</li>)}</ul>
    </li>)}</ul>;
}

/** pCloud files the strict parser rejected. They wait in quarantine until the parser is updated. */
function ProblemFiles({ reload }: { reload: number }) {
  const { formatInTimezone } = useTimezone();
  const [problems, setProblems] = useState<{ quarantined: number; files: Ft3QuarantinedFile[] } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/ft3/problems", { signal: controller.signal })
      .then(r => r.ok ? r.json() : null)
      .then(body => { if (!controller.signal.aborted) setProblems(body); })
      .catch(() => {});
    return () => controller.abort();
  }, [reload]);
  if (!problems?.quarantined) return null;
  const n = problems.quarantined;
  return (
    <section role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{number(n)} FT3 {n === 1 ? "file" : "files"} from pCloud could not be read</h3>
          <p className="mt-1 text-sm text-muted-foreground">These results are not shown on this page. The file format has probably changed: update the FT3 parser, then run <code className="rounded bg-muted px-1 py-0.5 text-xs">npm run ingest:ft3 -- --retry-quarantine</code> on the server.</p>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium">Show what was wrong{n > problems.files.length ? ` (newest ${problems.files.length})` : ""}</summary>
            <div className="mt-2"><ProblemList files={problems.files.map(f => ({ ...f, detail: `Quarantined ${formatInTimezone(f.quarantinedAt)}` }))} /></div>
          </details>
        </div>
      </div>
    </section>
  );
}

function UploadPanel({ onUploaded }: { onUploaded: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<Ft3UploadFileResult[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const busy = progress !== null;

  // Send in batches so a large drop shows progress and one failed request
  // does not lose the whole selection.
  const upload = useCallback(async (list: FileList | File[]) => {
    const files = Array.from(list);
    if (!files.length) return;
    setFailure(null);
    setResults(null);
    setProgress({ done: 0, total: files.length });
    const all: Ft3UploadFileResult[] = [];
    try {
      for (let i = 0; i < files.length; i += UPLOAD_BATCH) {
        const form = new FormData();
        files.slice(i, i + UPLOAD_BATCH).forEach(f => form.append("files", f));
        const response = await fetch("/api/ft3/upload", { method: "POST", body: form });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Upload failed");
        all.push(...body.results);
        setProgress({ done: Math.min(i + UPLOAD_BATCH, files.length), total: files.length });
      }
    } catch (err) {
      setFailure(`${(err as Error).message}. ${all.length ? `${all.length} of ${files.length} files were processed before it stopped.` : "No files were processed."}`);
    } finally {
      setResults(all.length ? all : null);
      setProgress(null);
      if (all.some(r => r.added)) onUploaded();
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [onUploaded]);

  const added = results?.filter(r => r.status === "added") ?? [];
  const duplicates = results?.filter(r => r.status === "duplicate") ?? [];
  const errors = results?.filter(r => r.status === "error") ?? [];

  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <div
        onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); if (!busy) upload(e.dataTransfer.files); }}
        className={`flex flex-col items-start gap-4 rounded-lg border-2 border-dashed p-4 transition-colors sm:flex-row sm:items-center ${dragging ? "border-primary bg-primary/5" : "border-border"}`}
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">{busy ? <Loader2 className="size-5 animate-spin" /> : <FileUp className="size-5" />}</div>
        <div className="w-full min-w-0 flex-1">
          <h3 className="font-semibold">Upload FT3 results</h3>
          {progress ? <div className="mt-1.5" role="status">
            <p className="text-xs text-muted-foreground">Uploading {number(progress.done)} of {number(progress.total)} files…</p>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progress.done / progress.total * 100}%` }} /></div>
          </div>
            : <p className="mt-0.5 text-xs text-muted-foreground">Drop <span className="break-all font-mono">FT3_&lt;serial&gt;_&lt;time&gt;.csv</span> files here, as many as you like. Runs already stored are skipped. Files that don’t match the FT3 format are rejected with the reason.</p>}
        </div>
        <input ref={inputRef} type="file" accept=".csv,text/csv" multiple className="hidden" onChange={e => e.target.files && upload(e.target.files)} />
        <Button className="w-full sm:w-auto" disabled={busy} onClick={() => inputRef.current?.click()}><Upload className="size-4" />{busy ? "Uploading…" : "Choose files"}</Button>
      </div>
      {failure && <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-rose-600 dark:text-rose-400"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{failure}</p>}
      {results && <div className="mt-3 space-y-2" role="status">
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span className="font-medium text-emerald-700 dark:text-emerald-400">{number(added.length)} added</span>
          <span className="text-muted-foreground">{number(duplicates.length)} already stored</span>
          <span className={errors.length ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground"}>{number(errors.length)} rejected</span>
        </p>
        {errors.length > 0 && <ProblemList files={errors.map(r => ({ name: r.file, problems: r.problems ?? [r.error ?? "Could not save this file"] }))} />}
        {!errors.length && results.length <= 10 && <ul className="space-y-1 text-xs">{results.map(r =>
          <li key={r.file} className="flex flex-wrap gap-x-2"><span className={r.status === "added" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}>{r.status === "added" ? "Added" : "Already stored"}</span><span className="break-all font-mono">{r.file}</span></li>)}</ul>}
      </div>}
    </section>
  );
}
