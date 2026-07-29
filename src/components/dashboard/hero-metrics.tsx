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
  const display =
    isZero
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

/** Fixed-height slot so All (no PoP) and 90d (with PoP) cards match. */
function TrendSlot({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex min-h-5 items-center">
      {children ?? (
        <span className="text-sm text-muted-foreground/70">—</span>
      )}
    </div>
  );
}

/** Fixed caption stack so optional hint lines do not change card height. */
function CaptionSlot({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex min-h-10 flex-col justify-start gap-0.5 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
      <Card className="@container/card from-muted/20 to-card bg-gradient-to-t shadow-xs">
        <CardHeader className="gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-14 w-40 sm:h-16" />
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-10 w-52 max-w-full" />
        </CardHeader>
      </Card>
      <Card className="@container/card from-primary/5 to-card bg-gradient-to-t shadow-xs">
        <CardHeader className="gap-2">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-9 w-28 sm:h-10" />
          <Skeleton className="h-5 w-24" />
          <div className="min-h-10" />
        </CardHeader>
      </Card>
      <Card className="@container/card from-rose-500/5 to-card bg-gradient-to-t shadow-xs">
        <CardHeader className="gap-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-9 w-20 sm:h-10" />
          <Skeleton className="h-3 w-36" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-10 w-full max-w-[16rem]" />
        </CardHeader>
      </Card>
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
  const [initialLoading, setInitialLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState(false);

  const epochRef = React.useRef(requestEpoch);
  epochRef.current = requestEpoch;
  const hasDataRef = React.useRef(false);

  React.useEffect(() => {
    if (!enabled) {
      if (!hasDataRef.current) setInitialLoading(true);
      return;
    }

    const abort = new AbortController();
    const epochAtStart = requestEpoch;
    const isInitial = !hasDataRef.current;

    async function fetchStats() {
      try {
        if (isInitial) {
          setInitialLoading(true);
        } else {
          setRefreshing(true);
        }
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
          if (isInitial) {
            setError(true);
            setData(null);
          }
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
            failurePercentageOfTotal:
              json.failurePercentageOfTotal ?? null,
          });
        }
        hasDataRef.current = true;
      } catch (e) {
        if (abort.signal.aborted) return;
        console.error("Failed to fetch hero stats:", e);
        if (isInitial) {
          setError(true);
          setData(null);
        }
      } finally {
        if (!abort.signal.aborted && epochRef.current === epochAtStart) {
          setInitialLoading(false);
          setRefreshing(false);
        }
      }
    }

    fetchStats();
    return () => abort.abort();
  }, [dashboardRange, chartMode, annotationFilter, requestEpoch, enabled]);

  // First paint only — never tear down cards on period change
  if (initialLoading && !data) {
    return <HeroSkeleton />;
  }

  if ((error && !data) || !data?.current) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm text-muted-foreground">
        Could not load summary metrics. Check your connection and try changing
        the period.
      </div>
    );
  }

  const stats = data.current;
  const delta = data.delta;
  const annotationOn = Boolean(
    annotationFilter && annotationFilter !== "all",
  );
  const rateTint =
    stats.failureRate > 0
      ? "from-rose-500/10 to-card"
      : "from-emerald-500/10 to-card";
  const volumeLabel =
    chartMode === "recent" ? "Inverters tested" : "Tests run";
  const showPop = delta !== null && dashboardRange.kind !== "all";
  const soft = refreshing ? "opacity-55 transition-opacity duration-200" : "opacity-100 transition-opacity duration-200";

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
      {/* FAILURE RATE — hero */}
      <Card
        className={cn(
          "@container/card md:col-span-1 bg-gradient-to-t shadow-xs",
          rateTint,
        )}
      >
        <CardHeader className="gap-2">
          <CardDescription className="text-xs font-medium uppercase tracking-wide">
            Failure rate
          </CardDescription>
          <CardTitle
            className={cn(
              "text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl",
              soft,
            )}
          >
            {stats.failureRate.toFixed(1)}
            <span className="text-3xl text-muted-foreground">%</span>
          </CardTitle>
          <TrendSlot>
            {showPop && delta ? (
              <span className={soft}>
                <TrendBadge
                  value={delta.failureRatePp}
                  suffix=" pp"
                  goodWhenDown
                />
              </span>
            ) : dashboardRange.kind === "all" ? (
              <span className="text-sm text-muted-foreground">
                No prior period
              </span>
            ) : null}
          </TrendSlot>
          <CaptionSlot>
            {annotationOn && stats.failurePercentageOfTotal !== undefined && (
              <p className={soft}>
                {stats.failurePercentageOfTotal}% of all failures · tagged
                failures ÷ all tests
              </p>
            )}
            {chartMode === "recent" ? (
              <p className={soft}>
                One result per inverter in{" "}
                {dashboardRangeLabel(dashboardRange)}
              </p>
            ) : (
              <p className={soft}>
                All tests in {dashboardRangeLabel(dashboardRange)}
              </p>
            )}
          </CaptionSlot>
        </CardHeader>
      </Card>

      {/* Tests run */}
      <Card className="@container/card from-primary/5 to-card bg-gradient-to-t shadow-xs">
        <CardHeader className="gap-2">
          <CardDescription className="text-xs font-medium uppercase tracking-wide">
            {volumeLabel}
          </CardDescription>
          <CardTitle
            className={cn(
              "text-3xl font-semibold tabular-nums sm:text-4xl",
              soft,
            )}
          >
            {stats.total.toLocaleString()}
          </CardTitle>
          <TrendSlot>
            {showPop && delta ? (
              <span className={soft}>
                <TrendBadge value={delta.total} neutral />
              </span>
            ) : dashboardRange.kind === "all" ? (
              <span className="text-sm text-muted-foreground">
                No prior period
              </span>
            ) : null}
          </TrendSlot>
          <CaptionSlot>
            <p className={soft}>
              {chartMode === "recent"
                ? "Latest valid result per inverter"
                : "Every test in the selected period"}
            </p>
          </CaptionSlot>
        </CardHeader>
      </Card>

      {/* Failures — clickable */}
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
          >
            <CardTitle
              className={cn(
                "text-3xl font-semibold tabular-nums text-rose-600 transition-colors group-hover:underline dark:text-rose-400 sm:text-4xl",
                soft,
              )}
            >
              {stats.failed.toLocaleString()}
            </CardTitle>
            <span className="mt-1 block text-xs text-muted-foreground group-hover:text-foreground">
              Click to view in table ↓
            </span>
          </button>
          <TrendSlot>
            {showPop && delta ? (
              <span className={soft}>
                <TrendBadge value={delta.failed} goodWhenDown />
              </span>
            ) : dashboardRange.kind === "all" ? (
              <span className="text-sm text-muted-foreground">
                No prior period
              </span>
            ) : null}
          </TrendSlot>
          <CaptionSlot>
            <p className={soft}>
              Table shows FAIL rows in the linked date range
              {chartMode === "recent"
                ? "; counts may differ from hero (latest-per-inverter)"
                : ""}
              .
            </p>
          </CaptionSlot>
        </CardHeader>
      </Card>
    </div>
  );
}
