"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HEADER_BAR_CLASS, HEADER_TITLE_CLASS } from "@/components/dashboard/header-controls";
import { useTimezone } from "@/contexts/TimezoneContext";
import { VerdictBadge } from "@/components/ft3/verdict";
import type { Ft3Step, Ft3Verdict } from "@/lib/ft3";

interface Ft3Detail {
  id: number; serial: string; testTime: string; tester: string | null; verdict: string; failedStep: string | null;
  fpga: string | null; zigbee: string | null; sourceFile: string | null; uploadedBy: string | null; uploadedAt: string;
  steps: Ft3Step[]; problems: string[];
  attempts: { id: number; testTime: string; verdict: string; failedStep: string | null; tester: string | null }[];
  burnin: { id: number; start: string | null; end: string | null; status: string; firmware: string | null }[];
}

const factoryTime = (iso: string) => new Date(iso).toLocaleString("en-GB", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
}).replace(",", "") + " IST";

const stepTone = (result: Ft3Verdict) =>
  result === "PASS" ? "border-emerald-500/40 bg-emerald-500/5"
    : result === "FAIL" ? "border-rose-500 bg-rose-500/10 ring-1 ring-rose-500/40"
      : "border-dashed bg-muted/30 text-muted-foreground";

const cellTone = (result: Ft3Verdict) =>
  result === "PASS" ? "bg-emerald-500/10" : result === "FAIL" ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-muted/40 text-muted-foreground";

export default function Ft3DetailPage() {
  const { id } = useParams<{ id: string }>();
  const { formatInTimezone } = useTimezone();
  const [data, setData] = useState<Ft3Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    fetch(`/api/ft3/${id}`, { signal: controller.signal })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || "Unable to load FT3 result");
        setData(body);
      })
      .catch(err => { if (!controller.signal.aborted) setError((err as Error).message); });
    return () => controller.abort();
  }, [id]);

  return (
    <div className="ml-0 flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden md:ml-10 md:h-dvh">
      <header className={HEADER_BAR_CLASS}>
        <Button asChild variant="ghost" size="sm"><Link href="/ft3"><ArrowLeft className="size-4" />FT3 Results</Link></Button>
        <div className="flex min-w-0 items-center gap-2"><ClipboardCheck className="size-4 text-primary" /><h1 className={`${HEADER_TITLE_CLASS} font-mono`}>{data?.serial ?? "FT3 run"}</h1>{data && <VerdictBadge verdict={data.verdict} />}</div>
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full space-y-5 p-4 lg:space-y-6 lg:p-6">
          {error ? <div role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-6 text-sm">{error}</div>
            : !data ? <div role="status" aria-label="Loading FT3 result" className="space-y-5"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-96 rounded-xl" /></div>
              : <>
                {data.problems.length > 0 && <section role="alert" className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div><p className="font-semibold">This run no longer matches the FT3 format</p>
                    <p className="mt-1 text-muted-foreground">It was stored before the parser changed, so some subtests below may be shown incorrectly.</p>
                    <ul className="mt-2 list-disc pl-5 text-muted-foreground">{data.problems.map(p => <li key={p}>{p}</li>)}</ul></div>
                </section>}
                <section className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-5">
                  <Fact label="Test time" value={formatInTimezone(data.testTime)} detail={`Factory clock ${factoryTime(data.testTime)}`} />
                  <Fact label="Result" value={data.verdict === "FAIL" ? `Failed at ${data.failedStep ?? "an unrecorded step"}` : "All subtests passed"} />
                  <Fact label="Tester" value={data.tester ?? "—"} />
                  <Fact label="FPGA version" value={data.fpga ?? "—"} mono />
                  <Fact label="Zigbee version" value={data.zigbee ?? "—"} mono />
                </section>

                <section aria-label="Test sequence" className="rounded-xl border bg-card p-4 sm:p-5">
                  <h2 className="font-semibold">Test sequence</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Subtests run left to right. After a failure the rest are not run.</p>
                  <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">{data.steps.map((step, i) =>
                    <li key={step.key} className={`relative rounded-lg border p-3 ${stepTone(step.result)}`}>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span className="tabular-nums">{i + 1}</span><VerdictBadge verdict={step.result} /></div>
                      <div className="mt-2 text-sm font-semibold text-foreground">{step.label}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{step.description}</div>
                    </li>)}</ol>
                </section>

                <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
                  <div className="min-w-0 space-y-5">
                    {data.steps.filter(s => s.mppt).map(step => <section key={step.key} className="rounded-xl border bg-card p-4 sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">MPPT</h2><VerdictBadge verdict={step.result} /></div>
                      <p className="mt-1 text-xs text-muted-foreground">Each test condition is applied to all four PV channels. Cells show the result, voltage and current logged for that channel.</p>
                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full min-w-[36rem] border-separate border-spacing-1 text-sm">
                          <thead><tr className="text-xs text-muted-foreground"><th className="w-28 text-left font-medium">Condition</th>{[1, 2, 3, 4].map(c => <th key={c} className="font-medium">PV {c}</th>)}</tr></thead>
                          <tbody>{step.mppt!.map(row => <tr key={row.condition}>
                            <th className="text-left text-xs font-medium text-muted-foreground">Condition {row.condition}</th>
                            {row.cells.map(cell => <td key={cell.channel} className={`rounded-md px-3 py-2 text-center ${cellTone(cell.result)}`}>
                              <div className="text-xs font-medium">{cell.result === "PASS" ? "Pass" : cell.result === "FAIL" ? "Fail" : "Not run"}</div>
                              {(cell.voltage || cell.current) && <div className="mt-1 whitespace-nowrap font-mono text-xs tabular-nums">{cell.voltage ?? "—"} V · {cell.current ?? "—"} A</div>}
                            </td>)}
                          </tr>)}</tbody>
                        </table>
                      </div>
                    </section>)}

                    <div className="grid items-start gap-5 md:grid-cols-2">{data.steps.filter(s => s.readings.length).map(step => <section key={step.key} className="rounded-xl border bg-card p-4 sm:p-5">
                      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{step.label}</h2><VerdictBadge verdict={step.result} /></div>
                      <dl className="mt-3 divide-y text-sm">{step.readings.map(r => <div key={r.label} className="flex justify-between gap-4 py-2">
                        <dt className="text-muted-foreground">{r.label}</dt><dd className="font-mono tabular-nums">{r.value}{r.unit ? ` ${r.unit}` : ""}</dd>
                      </div>)}</dl>
                    </section>)}</div>

                  </div>

                  <aside className="min-w-0 space-y-5">
                    <section className="rounded-xl border bg-card p-4 sm:p-5">
                      <h2 className="font-semibold">Burn-in for this serial</h2>
                      {data.burnin.length ? <ul className="mt-3 space-y-2">{data.burnin.map(run => <li key={run.id}>
                        <Link href={`/test/${run.id}`} className="flex items-center gap-3 rounded-lg border px-3 py-2 text-sm hover:border-primary focus-visible:outline-2 focus-visible:outline-ring">
                          <span className={`w-16 font-semibold ${run.status === "PASS" ? "text-emerald-700 dark:text-emerald-400" : run.status === "FAIL" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground"}`}>{run.status}</span>
                          <span className="flex-1 text-xs"><span className="block">{run.start ? formatInTimezone(run.start) : "Start unknown"}</span><span className="text-muted-foreground">FW {run.firmware ?? "unknown"}</span></span>
                          <ArrowRight className="size-4 text-muted-foreground" />
                        </Link></li>)}</ul>
                        : <p className="mt-2 text-sm text-muted-foreground">No burn-in runs recorded for {data.serial} yet.</p>}
                    </section>
                    <section className="rounded-xl border bg-card p-4 sm:p-5">
                      <h2 className="font-semibold">FT3 runs for this serial</h2>
                      <ol className="mt-3 space-y-2">{data.attempts.map((a, i) => <li key={a.id}>
                        <Link href={`/ft3/${a.id}`} aria-current={a.id === data.id ? "page" : undefined}
                          className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm hover:border-primary focus-visible:outline-2 focus-visible:outline-ring ${a.id === data.id ? "border-primary bg-primary/5" : ""}`}>
                          <span className="w-6 text-xs text-muted-foreground tabular-nums">#{i + 1}</span>
                          <span className="flex-1 text-xs"><span className="block">{formatInTimezone(a.testTime)}</span><span className="text-muted-foreground">{a.failedStep ? `Failed at ${a.failedStep}` : a.tester ?? ""}</span></span>
                          <VerdictBadge verdict={a.verdict} />
                        </Link></li>)}</ol>
                    </section>
                    <p className="px-1 text-xs leading-relaxed text-muted-foreground">Uploaded {formatInTimezone(data.uploadedAt)}{data.uploadedBy ? ` by ${data.uploadedBy}` : ""}{data.sourceFile ? <> from <span className="break-all font-mono">{data.sourceFile}</span></> : null}.</p>
                  </aside>
                </div>
              </>}
        </div>
      </main>
    </div>
  );
}

function Fact({ label, value, detail, mono }: { label: string; value: string; detail?: string; mono?: boolean }) {
  return <div className="min-w-0"><div className="text-xs font-medium text-muted-foreground">{label}</div><div className={`mt-1 break-words text-sm font-semibold ${mono ? "font-mono" : ""}`}>{value}</div>{detail && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}</div>;
}
