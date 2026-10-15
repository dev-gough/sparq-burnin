"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { useTimezone } from "@/contexts/TimezoneContext";

interface Run { id: number; testTime: string; verdict: string; failedStep: string | null }

/** Latest FT3 result for a serial, linked to its run. Renders nothing when the unit has no FT3 runs. */
export function Ft3Chip({ serial }: { serial: string }) {
  const { formatInTimezone } = useTimezone();
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/ft3/serial/${encodeURIComponent(serial)}`, { signal: controller.signal })
      .then(r => (r.ok ? r.json() : { runs: [] }))
      .then(body => { if (!controller.signal.aborted) setRuns(body.runs); })
      .catch(() => {});
    return () => controller.abort();
  }, [serial]);
  const latest = runs?.[0];
  if (!latest) return null;
  const pass = latest.verdict === "PASS";
  return (
    <Link href={`/ft3/${latest.id}`} title={`Latest FT3 run ${formatInTimezone(latest.testTime)}`}
      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring ${pass ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-400" : "border-rose-500/40 text-rose-600 dark:text-rose-400"}`}>
      <ClipboardCheck className="size-3.5" />
      FT3 {pass ? "Pass" : `Fail at ${latest.failedStep ?? "unknown step"}`}
      {runs.length > 1 && <span className="font-normal text-muted-foreground">· {runs.length} runs</span>}
    </Link>
  );
}
