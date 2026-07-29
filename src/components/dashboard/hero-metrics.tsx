"use client";

import * as React from "react";
import { IconArrowDown, IconArrowUp, IconMinus } from "@tabler/icons-react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  appendDashboardRangeParams,
  type DashboardRange,
  dashboardRangeLabel,
} from "@/lib/dashboard-range";
import { cn } from "@/lib/utils";

interface SummaryStats {
  total: number;
  passed: number;
  failed: number;
  failureRate: number;
  failurePercentageOfTotal?: number;
}

interface SummaryDelta {
  total: number;
  passed: number;
  failed: number;
  failureRatePp: number;
}

interface CompareResponse {
  current: SummaryStats;
  previous: SummaryStats | null;
  delta: SummaryDelta | null;
  labels: { current: string; previous: string } | null;
  failurePercentageOfTotal: number | null;
}

interface HeroMetricsProps {
  dashboardRange: DashboardRange;
  chartMode: string;
  annotationFilter: string;
  requestEpoch: number;
  onFailuresClick: () => void;
  /** Skip fetch until parent localStorage prefs are ready. Default true. */
  enabled?: boolean;
}

function TrendBadge({
  value,
  suffix = "",
  goodWhenDown = false,
  neutral = false,
}: {
  value: number;
  suffix?: string;
  goodWhenDown?: boolean;
  neutral?: boolean;
}) {
  const isZero = value === 0;
  const isUp = value > 0;
  const isGood = neutral
    ? null
    : goodWhenDown
      ? value < 0
      : value > 0;

  const color = neutral
    ? "text-muted-foreground"
    : isZero
      ? "text-muted-foreground"
      : isGood
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-rose-600 dark:text-rose-400";

  const Icon = isZero ? IconMinus : isUp ? IconArrowUp : IconArrowDown;
  const display = isZero
    ? `0${suffix}`
    : `${isUp ? "+" : ""}${Number.isInteger(value) ? value : value.toFixed(1)}${suffix}`;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-sm font-medium tabular-nums",
        color,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {display}
      <span className="ml-1 font-normal text-muted-foreground">
        vs prior period
      </span>
    </span>
  );
}

/**
 * Fixed-height slots so skeleton → data does not change card height.
 * Heights match the largest type size used in each slot (leading-none titles).
 */
function TrendSlot({ children }: { children: React.ReactNode }) {
  // text-sm + icon ≈ 20px; keep exact so “—” / badge / skeleton share one box
  return (
    <div className="flex h-5 shrink-0 items-center overflow-hidden">
      {children}
    </div>
  );
}

function CaptionSlot({ children }: { children: React.ReactNode }) {
  // Two text-xs lines (+ gap) reserved always
  return (
    <div className="flex h-10 shrink-0 flex-col justify-start gap-0.5 overflow-hidden text-xs leading-5 text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * Number region: outer box height is locked to the real title line-box
 * (text-5xl/6xl or text-3xl/4xl with leading-none) so skeletons cannot be taller.
 */
function MetricValue({
  pending,
  variant,
  className,
  children,
}: {
  pending: boolean;
  variant: "hero" | "secondary";
  className?: string;
  children: React.ReactNode;
}) {
  // text-5xl=3rem, text-6xl=3.75rem; text-3xl=1.875rem, text-4xl=2.25rem
  const shell =
    variant === "hero"
      ? "flex h-12 shrink-0 items-center sm:h-[3.75rem]" // text-5xl / text-6xl
      : "flex h-[1.875rem] shrink-0 items-center sm:h-9"; // text-3xl / text-4xl
  const bar =
    variant === "hero"
      ? "h-10 w-32 sm:h-12 sm:w-36"
      : "h-7 w-24 sm:h-8 sm:w-28";

  return (
    <div className={shell}>
      {pending ? (
        <Skeleton className={cn("rounded-md", bar)} aria-hidden />
      ) : (
        <span className={cn("leading-none", className)}>{children}</span>
      )}
    </div>
  );
}

export function HeroMetrics({
  dashboardRange,
  chartMode,
  annotationFilter,
  requestEpoch,
  onFailuresClick,
  enabled = true,
}: HeroMetricsProps) {
  const [data, setData] = React.useState<CompareResponse | null>(null);
  const [pending, setPending] = React.useState(true);
  const [error, setError] = React.useState(false);

  const epochRef = React.useRef(requestEpoch);
  epochRef.current = requestEpoch;

  React.useEffect(() => {
    if (!enabled) {
      setPending(true);
      return;
    }

    const abort = new AbortController();
    const epochAtStart = requestEpoch;

    async function fetchStats() {
      try {
        // Numbers only enter loading state — card chrome stays mounted
        setPending(true);
        setError(false);
        const params = new URLSearchParams({
          view: "summary",
          compare: "1",
          chartMode,
          annotation: annotationFilter,
        });
        appendDashboardRangeParams(params, dashboardRange);

        const response = await fetch(`/api/test-stats?${params}`, {
          signal: abort.signal,
        });
        if (abort.signal.aborted || epochRef.current !== epochAtStart) return;

        if (!response.ok) {
          setError(true);
          return;
        }

        const json = await response.json();
        if (abort.signal.aborted || epochRef.current !== epochAtStart) return;

        if (json.current) {
          setData(json as CompareResponse);
        } else {
          setData({
            current: json as SummaryStats,
            previous: null,
            delta: null,
            labels: null,
            failurePercentageOfTotal: json.failurePercentageOfTotal ?? null,
          });
        }
      } catch (e) {
        if (abort.signal.aborted) return;
        console.error("Failed to fetch hero stats:", e);
        setError(true);
      } finally {
        if (!abort.signal.aborted && epochRef.current === epochAtStart) {
          setPending(false);
        }
      }
    }

    fetchStats();
    return () => abort.abort();
  }, [dashboardRange, chartMode, annotationFilter, requestEpoch, enabled]);

  const stats = data?.current ?? null;
  const delta = data?.delta ?? null;
  const annotationOn = Boolean(
    annotationFilter && annotationFilter !== "all",
  );
  const showPop = delta !== null && dashboardRange.kind !== "all";
  const periodLabel = dashboardRangeLabel(dashboardRange);

  // Static card shells — only metric values / dynamic phrase fragments update
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
      {/* FAILURE RATE */}
      <Card className="@container/card from-rose-500/5 to-card bg-gradient-to-t shadow-xs md:col-span-1">
        <CardHeader className="gap-2">
          <CardDescription className="text-xs font-medium uppercase tracking-wide">
            Failure rate
          </CardDescription>
          <CardTitle className="text-5xl font-semibold tabular-nums tracking-tight leading-none sm:text-6xl">
            <MetricValue
              pending={pending || !stats}
              variant="hero"
              className="tabular-nums"
            >
              {stats ? (
                <>
                  {stats.failureRate.toFixed(1)}
                  <span className="text-3xl text-muted-foreground">%</span>
                </>
              ) : null}
            </MetricValue>
          </CardTitle>
          <TrendSlot>
            {pending || !stats ? (
              <Skeleton className="h-4 w-32 shrink-0" />
            ) : showPop && delta ? (
              <TrendBadge
                value={delta.failureRatePp}
                suffix=" pp"
                goodWhenDown
              />
            ) : dashboardRange.kind === "all" ? (
              <span className="text-sm leading-5 text-muted-foreground">
                No prior period
              </span>
            ) : (
              <span className="text-sm leading-5 text-muted-foreground/70">
                —
              </span>
            )}
          </TrendSlot>
          <CaptionSlot>
            {/* Always two lines reserved: annotation line may be invisible */}
            <p className="h-5 truncate leading-5">
              {annotationOn ? (
                pending || stats?.failurePercentageOfTotal === undefined ? (
                  <Skeleton className="inline-block h-3 w-40 align-middle" />
                ) : (
                  <>
                    <span className="tabular-nums">
                      {stats.failurePercentageOfTotal}%
                    </span>
                    {" of all failures · tagged failures ÷ all tests"}
                  </>
                )
              ) : (
                <span className="invisible">placeholder</span>
              )}
            </p>
            <p className="h-5 truncate leading-5">
              {chartMode === "recent"
                ? "One result per inverter in "
                : "All tests in "}
              <span className="text-foreground/80">{periodLabel}</span>
            </p>
          </CaptionSlot>
        </CardHeader>
      </Card>

      {/* INVERTERS TESTED — label stays fixed; mode nuance lives in caption */}
      <Card className="@container/card from-primary/5 to-card bg-gradient-to-t shadow-xs">
        <CardHeader className="gap-2">
          <CardDescription className="text-xs font-medium uppercase tracking-wide">
            Inverters tested
          </CardDescription>
          <CardTitle className="text-3xl font-semibold tabular-nums leading-none sm:text-4xl">
            <MetricValue
              pending={pending || !stats}
              variant="secondary"
              className="tabular-nums"
            >
              {stats ? stats.total.toLocaleString() : null}
            </MetricValue>
          </CardTitle>
          <TrendSlot>
            {pending || !stats ? (
              <Skeleton className="h-4 w-28 shrink-0" />
            ) : showPop && delta ? (
              <TrendBadge value={delta.total} neutral />
            ) : dashboardRange.kind === "all" ? (
              <span className="text-sm leading-5 text-muted-foreground">
                No prior period
              </span>
            ) : (
              <span className="text-sm leading-5 text-muted-foreground/70">
                —
              </span>
            )}
          </TrendSlot>
          <CaptionSlot>
            <p className="h-5 truncate leading-5">
              {chartMode === "recent"
                ? "Latest valid result per inverter"
                : "Every test in the selected period"}
            </p>
            <p className="invisible h-5 leading-5">placeholder</p>
          </CaptionSlot>
        </CardHeader>
      </Card>

      {/* FAILURES */}
      <Card className="@container/card from-rose-500/5 to-card bg-gradient-to-t shadow-xs">
        <CardHeader className="gap-2">
          <CardDescription className="text-xs font-medium uppercase tracking-wide">
            Failures
          </CardDescription>
          <button
            type="button"
            onClick={onFailuresClick}
            className="group rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Filter table to FAIL and scroll to tests"
            disabled={pending || !stats}
          >
            <CardTitle className="text-3xl font-semibold tabular-nums leading-none text-rose-600 transition-colors group-hover:underline dark:text-rose-400 sm:text-4xl">
              <MetricValue
                pending={pending || !stats}
                variant="secondary"
                className="tabular-nums text-rose-600 dark:text-rose-400"
              >
                {stats ? stats.failed.toLocaleString() : null}
              </MetricValue>
            </CardTitle>
            <span className="mt-1 block h-5 text-xs leading-5 text-muted-foreground group-hover:text-foreground">
              Click to view in table ↓
            </span>
          </button>
          <TrendSlot>
            {pending || !stats ? (
              <Skeleton className="h-4 w-28 shrink-0" />
            ) : showPop && delta ? (
              <TrendBadge value={delta.failed} goodWhenDown />
            ) : dashboardRange.kind === "all" ? (
              <span className="text-sm leading-5 text-muted-foreground">
                No prior period
              </span>
            ) : (
              <span className="text-sm leading-5 text-muted-foreground/70">
                —
              </span>
            )}
          </TrendSlot>
          <CaptionSlot>
            <p className="h-5 truncate leading-5">
              Table shows FAIL rows in the linked date range
              {chartMode === "recent"
                ? "; counts may differ from hero (latest-per-inverter)"
                : ""}
              .
            </p>
            <p className="h-5 truncate leading-5">
              {error && !stats ? (
                <span className="text-destructive">Could not load metrics.</span>
              ) : (
                <span className="invisible">placeholder</span>
              )}
            </p>
          </CaptionSlot>
        </CardHeader>
      </Card>
    </div>
  );
}
