"use client";

import * as React from "react";
import Link from "next/link";
import { IconAlertTriangle, IconTag } from "@tabler/icons-react";

import { ChevronDown, Check } from "lucide-react";
import { useExclusiveMenus } from "@/components/dashboard/exclusive-menus";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  appendDashboardRangeParams,
  todoHrefFromDashboardRange,
  type DashboardRange,
  dashboardRangeLabel,
} from "@/lib/dashboard-range";
import { cn } from "@/lib/utils";
import { useStationAliases } from "@/hooks/useStationAliases";

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
  /** Station id scope or "all" — same population rules as hero/charts/table. */
  stationFilter?: string;
  requestEpoch: number;
  /** Skip fetch until parent localStorage prefs are ready. Default true. */
  enabled?: boolean;
}

/** Merge rows that share a display name (e.g. legacy API NULL vs 'Other' groups). */
function dedupeByName(groups: InsightGroup[]): InsightGroup[] {
  const map = new Map<string, InsightGroup>();
  for (const g of groups) {
    const prev = map.get(g.name);
    if (!prev) {
      map.set(g.name, { ...g });
    } else {
      map.set(g.name, {
        name: g.name,
        count: prev.count + g.count,
        percentageOfFailed: prev.percentageOfFailed + g.percentageOfFailed,
      });
    }
  }
  return Array.from(map.values());
}

/** Dedupe option chips by option text (filter value); keep highest-count row's group label. */
function dedupeByOption(options: InsightOption[]): InsightOption[] {
  const map = new Map<string, InsightOption>();
  for (const o of options) {
    const prev = map.get(o.name);
    if (!prev || o.count > prev.count) {
      map.set(o.name, {
        ...o,
        count: (prev?.count ?? 0) + o.count,
        percentageOfFailed:
          (prev?.percentageOfFailed ?? 0) + o.percentageOfFailed,
      });
    } else {
      map.set(o.name, {
        ...prev,
        count: prev.count + o.count,
        percentageOfFailed: prev.percentageOfFailed + o.percentageOfFailed,
      });
    }
  }
  return Array.from(map.values());
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
 *
 * Empty / untagged-only states (O7): clear CTA, no footnote clutter.
 */
export function AnnotationInsights({
  dashboardRange,
  chartMode,
  annotationFilter,
  onAnnotationFilterChange,
  stationFilter = "all",
  requestEpoch,
  enabled = true,
}: AnnotationInsightsProps) {
  const { displayName } = useStationAliases();
  const menus = useExclusiveMenus();
  const menuPrefix = React.useId();
  const [data, setData] = React.useState<AnnotationSummary | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const hasDataRef = React.useRef(false);

  const epochRef = React.useRef(requestEpoch);
  epochRef.current = requestEpoch;

  React.useEffect(() => {
    if (!enabled) {
      if (!hasDataRef.current) setLoading(true);
      return;
    }

    const abort = new AbortController();
    const epochAtStart = requestEpoch;
    const isInitial = !hasDataRef.current;

    async function fetchSummary() {
      try {
        if (isInitial) setLoading(true);
        else setRefreshing(true);
        const params = new URLSearchParams({
          view: "annotation-summary",
          chartMode,
          limit: "8",
        });
        if (stationFilter && stationFilter !== "all") {
          params.set("station", stationFilter);
        }
        appendDashboardRangeParams(params, dashboardRange);

        const response = await fetch(`/api/test-stats?${params}`, {
          signal: abort.signal,
        });
        if (abort.signal.aborted || epochRef.current !== epochAtStart) return;

        if (!response.ok) {
          if (isInitial) setData(null);
          return;
        }

        const json = (await response.json()) as AnnotationSummary;
        if (abort.signal.aborted || epochRef.current !== epochAtStart) return;
        setData(json);
        hasDataRef.current = true;
      } catch (e) {
        if (abort.signal.aborted) return;
        console.error("Error fetching annotation summary:", e);
        if (isInitial) setData(null);
      } finally {
        if (!abort.signal.aborted && epochRef.current === epochAtStart) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    fetchSummary();
    return () => abort.abort();
  }, [dashboardRange, chartMode, stationFilter, requestEpoch, enabled]);

  const todoHref = todoHrefFromSummary(data, dashboardRange);

  const toggleFilter = (value: string) => {
    if (annotationFilter === value) {
      onAnnotationFilterChange("all");
    } else {
      onAnnotationFilterChange(value);
    }
  };

  const noFailures =
    !loading &&
    data &&
    data.totalFailed === 0 &&
    data.groups.length === 0 &&
    data.options.length === 0;

  const groups = data ? dedupeByName(data.groups) : [];
  const options = data ? dedupeByOption(data.options) : [];
  const hasTags = groups.length > 0 || options.length > 0;
  /** Fails exist but nothing is tagged — primary action is open /todo. */
  const untaggedOnly =
    !loading &&
    data &&
    data.totalFailed > 0 &&
    !hasTags &&
    data.untaggedFailed > 0;

  const tagCountTitle = (count: number, pct: number) =>
    `${count} annotation tag${count === 1 ? "" : "s"} across failed tests (${pct}% of ${data?.totalFailed ?? 0} failures)`;

  // min-h-8 (≥32px) for touch targets (O12); O47 focus ring
  const chipBase =
    "inline-flex min-h-8 items-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-medium leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:py-1";

  const mobileGroups = data && hasTags ? (
    <div className="mobile-cause-row flex min-w-0 items-center gap-2 md:hidden">
      <span className="shrink-0 text-xs font-semibold">Causes</span>
      <div className="mobile-cause-groups flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
        {groups.map(group => {
          const groupOptions = options.filter(option => option.group_name === group.name);
          const value = `group:${group.name}`;
          const active = annotationFilter === value;
          const childActive = groupOptions.some(option => annotationFilter === option.name);
          const id = `${menuPrefix}:group:${group.name}`;
          return (
            <div key={group.name} className={cn("flex shrink-0 overflow-hidden rounded-md border",
              active || childActive ? "border-primary bg-primary/10" : "border-border bg-muted/30")}>
              <button type="button" onClick={() => toggleFilter(value)} aria-pressed={active}
                aria-label={`Filter all ${group.name} causes`} title={tagCountTitle(group.count, group.percentageOfFailed)}
                className={cn("min-h-11 px-2 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  active && "bg-primary text-primary-foreground")}>
                {group.name}<span className="ml-1 opacity-70">{group.count}</span>
              </button>
              <DropdownMenu modal={false} open={menus.active === id} onOpenChange={open => menus.setOpen(id, open)}>
                <DropdownMenuTrigger asChild>
                  <button type="button" aria-label={`Choose a ${group.name} cause`}
                    className="flex min-h-11 w-8 items-center justify-center border-l focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
                    <ChevronDown className="size-3" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent data-exclusive-menu={id} onCloseAutoFocus={menus.onCloseAutoFocus} align="start" className="exclusive-menu-content max-w-[calc(100vw-24px)]">
                  <DropdownMenuLabel>{group.name}</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => onAnnotationFilterChange(value)}>
                    <Check className={cn("size-3", !active && "invisible")} />All {group.name} causes
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {groupOptions.map(option => (
                    <DropdownMenuItem key={option.name} onSelect={() => onAnnotationFilterChange(option.name)}>
                      <Check className={cn("size-3", annotationFilter !== option.name && "invisible")} />
                      <span className="min-w-0 flex-1 whitespace-normal">{option.name}</span>
                      <span className="text-xs text-muted-foreground">{option.count}</span>
                    </DropdownMenuItem>
                  ))}
                  {groupOptions.length === 0 && <DropdownMenuItem disabled>No individual causes in this period</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
      </div>
      <DropdownMenu modal={false} open={menus.active === `${menuPrefix}:coverage`}
        onOpenChange={open => menus.setOpen(`${menuPrefix}:coverage`, open)}>
        <DropdownMenuTrigger asChild>
          <button type="button" aria-label={`Tagging coverage: ${data.untaggedFailed} untagged failures`}
            className="flex size-11 shrink-0 items-center justify-center rounded-md border border-amber-500/40 text-amber-600 dark:text-amber-300">
            <IconTag className="size-4" /><ChevronDown className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent data-exclusive-menu={`${menuPrefix}:coverage`} onCloseAutoFocus={menus.onCloseAutoFocus} align="end" className="exclusive-menu-content">
          <DropdownMenuLabel>Tagging coverage</DropdownMenuLabel>
          <DropdownMenuItem asChild><Link href={todoHref}>Untagged {data.untaggedFailed} / {data.totalFailed}</Link></DropdownMenuItem>
          <DropdownMenuItem onSelect={() => toggleFilter("tagged")}>Tagged failures {data.totalFailed - data.untaggedFailed}</DropdownMenuItem>
          {annotationFilter !== "all" && <DropdownMenuItem onSelect={() => onAnnotationFilterChange("all")}>Clear cause filter</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  ) : null;

  return (
    <Card className="failure-causes-card @container/card" data-compact={Boolean(data && hasTags)} aria-label="Failure causes">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 px-6 py-2">
        <CardTitle className="text-sm font-semibold">Failure causes</CardTitle>
        <span className="text-[11px] text-muted-foreground">
          {dashboardRangeLabel(dashboardRange)}
          {chartMode === "recent" ? " · latest" : ""}
          {stationFilter !== "all" ? ` · ${displayName(stationFilter)}` : ""}
        </span>
      </CardHeader>
      <CardContent className="px-6 pb-3 pt-0">
        {loading && !data ? (
          <div className="flex flex-col gap-1.5" aria-hidden>
            <div className="h-8 w-full animate-pulse rounded-md bg-muted" />
          </div>
        ) : noFailures ? (
          <p className="py-1 text-sm leading-5 text-muted-foreground" role="status">
            No failed tests in this period.
          </p>
        ) : untaggedOnly && data ? (
          <div
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2.5",
              refreshing && "opacity-55",
            )}
            role="status"
          >
            <div className="flex min-w-0 items-start gap-2">
              <IconAlertTriangle
                className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
                aria-hidden
              />
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {data.untaggedFailed} untagged failure
                  {data.untaggedFailed === 1 ? "" : "s"}
                </p>
                <p className="text-xs text-muted-foreground">
                  No cause tags yet for this period
                </p>
              </div>
            </div>
            <Button asChild size="sm" className="h-9 shrink-0 gap-1.5">
              <Link href={todoHref}>
                <IconTag className="size-3.5" aria-hidden />
                Tag {data.untaggedFailed} fail
                {data.untaggedFailed === 1 ? "" : "s"}
              </Link>
            </Button>
          </div>
        ) : data ? (
          <>
          {mobileGroups}
          <div
            className={cn(
              "hidden md:flex flex-col gap-1.5 transition-opacity duration-200",
              refreshing && "opacity-55",
            )}
          >
            {groups.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-0.5 w-12 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Groups
                </span>
                {groups.map((g) => {
                  const value = `group:${g.name}`;
                  const active = annotationFilter === value;
                  return (
                    <button
                      key={`group:${g.name}`}
                      type="button"
                      onClick={() => toggleFilter(value)}
                      title={tagCountTitle(g.count, g.percentageOfFailed)}
                      className={cn(
                        chipBase,
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/80 bg-muted/50 text-foreground hover:bg-muted",
                      )}
                    >
                      <span className="max-w-[11rem] truncate">{g.name}</span>
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

            {options.length > 0 && (
              <div className="flex flex-wrap items-center gap-1">
                <span className="mr-0.5 w-12 shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Causes
                </span>
                {options.map((o) => {
                  const active = annotationFilter === o.name;
                  return (
                    <button
                      key={`option:${o.group_name}:${o.name}`}
                      type="button"
                      onClick={() => toggleFilter(o.name)}
                      title={`${o.group_name} · ${tagCountTitle(o.count, o.percentageOfFailed)}`}
                      className={cn(
                        chipBase,
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border/80 bg-background text-foreground hover:bg-muted",
                      )}
                    >
                      <span className="max-w-[11rem] truncate">{o.name}</span>
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

            {/* Annotation coverage: review untagged failures or filter to tagged tests. */}
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <Link
                href={todoHref}
                className={cn(
                  chipBase,
                  data.untaggedFailed > 0
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-800 hover:bg-amber-500/15 dark:text-amber-300"
                    : "border-border/80 bg-muted/30 text-muted-foreground hover:bg-muted",
                )}
                title="Open unannotated failures for this period"
              >
                <IconAlertTriangle className="size-3 shrink-0" />
                <span>
                  Untagged
                  <span className="ml-1 tabular-nums font-semibold">
                    {data.untaggedFailed}
                  </span>
                  {data.totalFailed > 0 && (
                    <span className="font-normal opacity-70">
                      {" "}
                      / {data.totalFailed}
                    </span>
                  )}
                </span>
              </Link>
              <button
                type="button"
                className={cn(chipBase, annotationFilter === "tagged"
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-border/80 bg-muted/30 text-muted-foreground hover:bg-muted")}
                aria-pressed={annotationFilter === "tagged"}
                title="Failed tests that have an annotation. Click filters the dashboard to every test with one, including passes."
                onClick={() => toggleFilter("tagged")}
              >
                <IconTag className="size-3 shrink-0" />
                <span>Tagged failures <span className="ml-1 tabular-nums font-semibold">{data.totalFailed - data.untaggedFailed}</span></span>
              </button>
            </div>
          </div>
          </>
        ) : (
          <p className="py-1 text-sm text-muted-foreground" role="status">
            Could not load failure causes.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
