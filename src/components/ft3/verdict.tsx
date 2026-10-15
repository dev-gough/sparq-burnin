const tone = (verdict: string) =>
  verdict === "PASS" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
    : verdict === "FAIL" ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
      : "bg-muted text-muted-foreground";

export function VerdictBadge({ verdict, className = "" }: { verdict: string; className?: string }) {
  const label = verdict === "PASS" ? "Pass" : verdict === "FAIL" ? "Fail" : verdict === "N/A" ? "Not run" : "Unknown";
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${tone(verdict)} ${className}`}>{label}</span>;
}

export function BurninStatus({ runs, latest }: { runs: number; latest: string | null }) {
  if (!runs) return <span className="text-xs text-muted-foreground">Not yet</span>;
  return <span className="text-xs"><span className={`font-medium ${latest === "PASS" ? "text-emerald-700 dark:text-emerald-400" : latest === "FAIL" ? "text-rose-600 dark:text-rose-400" : ""}`}>{latest ?? "—"}</span>
    <span className="text-muted-foreground"> · {runs} {runs === 1 ? "run" : "runs"}</span></span>;
}
