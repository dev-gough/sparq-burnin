"use client";

import * as React from "react";
import { IconArrowDown, IconArrowUp, IconMinus } from "@tabler/icons-react";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  /** Skip fetch until parent cookie filters are ready. Default true. */
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

export function HeroMetrics({
  dashboardRange,
  chartMode,
  annotationFilter,
  requestEpoch,
  onFailuresClick,
  enabled = true,
}: HeroMetricsProps) {
  const [data, setData] = React.useState<CompareResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(false);

  const epochRef = React.useRef(requestEpoch);
  epochRef.current = requestEpoch;

  React.useEffect(() => {
    if (!enabled) {
      setLoading(true);
      return;
    }

    const abort = new AbortController();
    const epochAtStart = requestEpoch;

    async function fetchStats() {
      try {
        setLoading(true);
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
          setData(null);
          return;
        }

        const json = await response.json();
        if (abort.signal.aborted || epochRef.current !== epochAtStart) return;

        // Support flat (no compare) fallback shape
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
      } catch (e) {
        if (abort.signal.aborted) return;
        console.error("Failed to fetch hero stats:", e);
        setError(true);
        setData(null);
      } finally {
        if (!abort.signal.aborted && epochRef.current === epochAtStart) {
          setLoading(false);
        }
      }
    }

    fetchStats();
    return () => abort.abort();
  }, [dashboardRange, chartMode, annotationFilter, requestEpoch, enabled]);

  const stats = data?.current;
  const delta = data?.delta;
  const annotationOn = annotationFilter && annotationFilter !== "all";
  const rateTint =
    stats && stats.failureRate > 0
      ? "from-rose-500/10 to-card"
      : "from-emerald-500/10 to-card";

  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="@container/card animate-pulse">
            <CardHeader>
              <CardDescription>Loading…</CardDescription>
              <CardTitle className="text-4xl font-semibold tabular-nums">
                —
              </CardTitle>
            </CardHeader>
          </Card>
        ))}
      </div>
    );
  }

  if (error || !stats) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm text-muted-foreground">
        Could not load summary metrics. Check your connection and try changing
        the period.
      </div>
    );
  }

  const volumeLabel =
    chartMode === "recent" ? "Inverters tested" : "Tests run";
  const showPop = delta !== null && dashboardRange.kind !== "all";

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
          <CardTitle className="text-5xl font-semibold tabular-nums tracking-tight sm:text-6xl">
            {stats.failureRate.toFixed(1)}
            <span className="text-3xl text-muted-foreground">%</span>
          </CardTitle>
          {showPop && delta && (
            <TrendBadge
              value={delta.failureRatePp}
              suffix=" pp"
              goodWhenDown
            />
          )}
          {annotationOn && stats.failurePercentageOfTotal !== undefined && (
            <p className="text-xs text-muted-foreground">
              {stats.failurePercentageOfTotal}% of all failures · tagged
              failures ÷ all tests
            </p>
          )}
          {chartMode === "recent" && (
            <p className="text-xs text-muted-foreground">
              One result per inverter in {dashboardRangeLabel(dashboardRange)}
            </p>
          )}
        </CardHeader>
      </Card>

      {/* Tests run */}
      <Card className="@container/card from-primary/5 to-card bg-gradient-to-t shadow-xs">
        <CardHeader className="gap-2">
          <CardDescription className="text-xs font-medium uppercase tracking-wide">
            {volumeLabel}
          </CardDescription>
          <CardTitle className="text-3xl font-semibold tabular-nums sm:text-4xl">
            {stats.total.toLocaleString()}
          </CardTitle>
          {showPop && delta && (
            <TrendBadge value={delta.total} neutral />
          )}
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
            <CardTitle className="text-3xl font-semibold tabular-nums text-rose-600 transition-colors group-hover:underline dark:text-rose-400 sm:text-4xl">
              {stats.failed.toLocaleString()}
            </CardTitle>
            <span className="mt-1 block text-xs text-muted-foreground group-hover:text-foreground">
              Click to view in table ↓
            </span>
          </button>
          {showPop && delta && (
            <TrendBadge value={delta.failed} goodWhenDown />
          )}
          <p className="text-xs text-muted-foreground">
            Table shows FAIL rows in the linked date range
            {chartMode === "recent"
              ? "; counts may differ from hero (latest-per-inverter)"
              : ""}
            .
          </p>
        </CardHeader>
      </Card>
    </div>
  );
}
