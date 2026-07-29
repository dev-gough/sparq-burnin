"use client";

import * as React from "react";
import Link from "next/link";
import { IconTag, IconAlertTriangle } from "@tabler/icons-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  appendDashboardRangeParams,
  todoHrefFromDashboardRange,
  type DashboardRange,
  dashboardRangeLabel,
} from "@/lib/dashboard-range";
import { cn } from "@/lib/utils";

interface InsightGroup {
  name: string;
  count: number;
  percentageOfFailed: number;
}

interface InsightOption {
  name: string;
  group_name: string;
  count: number;
  percentageOfFailed: number;
}

interface AnnotationSummary {
  groups: InsightGroup[];
  options: InsightOption[];
  untaggedFailed: number;
  totalFailed: number;
  range: { from: string | null; to: string | null };
}

interface AnnotationInsightsProps {
  dashboardRange: DashboardRange;
  chartMode: string;
  annotationFilter: string;
  onAnnotationFilterChange: (filter: string) => void;
  requestEpoch: number;
  /** Skip fetch until parent cookie filters are ready. Default true. */
  enabled?: boolean;
}

/** Prefer API range (SQL window) for /todo; fall back to client dashboard helper. */
function todoHrefFromSummary(
  data: AnnotationSummary | null,
  dashboardRange: DashboardRange,
): string {
  if (data?.range) {
    const { from, to } = data.range;
    if (from && to) {
      return `/todo?dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`;
    }
    // Open/all-time window → global list
    if (!from && !to) {
      return "/todo";
    }
    if (from && !to) {
      return `/todo?dateFrom=${encodeURIComponent(from)}`;
    }
    if (!from && to) {
      return `/todo?dateTo=${encodeURIComponent(to)}`;
    }
  }
  return todoHrefFromDashboardRange(dashboardRange);
}

/**
 * Compact top-causes strip for the command center.
 * Chips set annotationFilter (always applied to dashboard + table).
 * Untagged chip navigates to period-scoped /todo.
 */
export function AnnotationInsights({
  dashboardRange,
  chartMode,
  annotationFilter,
  onAnnotationFilterChange,
  requestEpoch,
  enabled = true,
}: AnnotationInsightsProps) {
  const [data, setData] = React.useState<AnnotationSummary | null>(null);
  const [loading, setLoading] = React.useState(true);

  const epochRef = React.useRef(requestEpoch);
  epochRef.current = requestEpoch;

  React.useEffect(() => {
    if (!enabled) {
      setLoading(true);
      return;
    }

    const abort = new AbortController();
    const epochAtStart = requestEpoch;

    async function fetchSummary() {
      try {
        setLoading(true);
        const params = new URLSearchParams({
          view: "annotation-summary",
          chartMode,
          limit: "5",
        });
        appendDashboardRangeParams(params, dashboardRange);

        const response = await fetch(`/api/test-stats?${params}`, {
          signal: abort.signal,
        });
        if (abort.signal.aborted || epochRef.current !== epochAtStart) return;

        if (!response.ok) {
          setData(null);
          return;
        }

        const json = (await response.json()) as AnnotationSummary;
        if (abort.signal.aborted || epochRef.current !== epochAtStart) return;
        setData(json);
      } catch (e) {
        if (abort.signal.aborted) return;
        console.error("Error fetching annotation summary:", e);
        setData(null);
      } finally {
        if (!abort.signal.aborted && epochRef.current === epochAtStart) {
          setLoading(false);
        }
      }
    }

    fetchSummary();
    return () => abort.abort();
  }, [dashboardRange, chartMode, requestEpoch, enabled]);

  const todoHref = todoHrefFromSummary(data, dashboardRange);

  const toggleFilter = (value: string) => {
    if (annotationFilter === value) {
      onAnnotationFilterChange("all");
    } else {
      onAnnotationFilterChange(value);
    }
  };

  const empty =
    !loading &&
    data &&
    data.totalFailed === 0 &&
    data.groups.length === 0 &&
    data.options.length === 0;

  const tagCountTitle = (count: number, pct: number) =>
    `${count} annotation tag${count === 1 ? "" : "s"} across failed tests (${pct}% of ${data?.totalFailed ?? 0} failures)`;

  return (
    <Card className="@container/card">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold">
            Failure causes
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            Top tags in {dashboardRangeLabel(dashboardRange)}
            {chartMode === "recent" ? " · latest per inverter" : ""}
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {loading && !data ? (
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-8 w-28 animate-pulse rounded-full bg-muted"
              />
            ))}
          </div>
        ) : empty ? (
          <p className="text-sm text-muted-foreground">
            No failed tests in this period.
          </p>
        ) : data ? (
          <div className="flex flex-col gap-3">
            {/* Group chips */}
            {data.groups.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Groups
                </span>
                {data.groups.map((g) => {
                  const value = `group:${g.name}`;
                  const active = annotationFilter === value;
                  return (
                    <button
                      key={g.name}
                      type="button"
                      onClick={() => toggleFilter(value)}
                      title={tagCountTitle(g.count, g.percentageOfFailed)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-muted/40 text-foreground hover:bg-muted",
                      )}
                    >
                      <IconTag className="size-3.5 shrink-0 opacity-70" />
                      <span className="max-w-[14rem] truncate">{g.name}</span>
                      <span
                        className={cn(
                          "tabular-nums",
                          active
                            ? "text-primary-foreground/80"
                            : "text-muted-foreground",
                        )}
                      >
                        {g.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Option chips */}
            {data.options.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Causes
                </span>
                {data.options.map((o) => {
                  const active = annotationFilter === o.name;
                  return (
                    <button
                      key={`${o.group_name}:${o.name}`}
                      type="button"
                      onClick={() => toggleFilter(o.name)}
                      title={`${o.group_name} · ${tagCountTitle(o.count, o.percentageOfFailed)}`}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-foreground hover:bg-muted",
                      )}
                    >
                      <span className="max-w-[12rem] truncate">{o.name}</span>
                      <span
                        className={cn(
                          "tabular-nums",
                          active
                            ? "text-primary-foreground/80"
                            : "text-muted-foreground",
                        )}
                      >
                        {o.count}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Untagged → period-scoped todo */}
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={todoHref}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                    data.untaggedFailed > 0
                      ? "border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-300"
                      : "border-border bg-muted/30 text-muted-foreground hover:bg-muted",
                  )}
                  title={
                    chartMode === "recent"
                      ? "Count is latest-per-inverter in this period; todo list includes all unannotated fails in the date range"
                      : "Open unannotated failures for this period"
                  }
                >
                  <IconAlertTriangle className="size-3.5 shrink-0" />
                  <span>
                    Untagged failures
                    <span className="ml-1.5 tabular-nums font-semibold">
                      {data.untaggedFailed}
                    </span>
                  </span>
                  {dashboardRange.kind !== "all" && (
                    <span className="text-[10px] font-normal opacity-75">
                      in this period
                    </span>
                  )}
                </Link>
                {data.totalFailed > 0 && (
                  <span className="text-xs text-muted-foreground">
                    of {data.totalFailed} failed
                  </span>
                )}
              </div>
              {chartMode === "recent" && (
                <p className="text-[11px] text-muted-foreground">
                  Count: latest per inverter · list may include older runs
                </p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Could not load failure causes.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
