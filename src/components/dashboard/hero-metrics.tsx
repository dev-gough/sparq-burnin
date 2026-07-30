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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { RollingNumber } from "@/components/dashboard/rolling-number";
import {
  type DashboardRange,
  dashboardRangeLabel,
} from "@/lib/dashboard-range";
import {
  getCachedSummaryStats,
  loadSummaryStats,
  scheduleSiblingPillSummaryPrefetch,
  subscribeSummaryStatsCache,
  type SummaryCompareResponse,
  type SummaryStatsFetchKey,
} from "@/lib/summary-stats-cache";
import { cn } from "@/lib/utils";

interface HeroMetricsProps {
  dashboardRange: DashboardRange;
  chartMode: string;
  annotationFilter: string;
  requestEpoch: number;
  onFailuresClick: () => void;
  /** Skip fetch until parent localStorage prefs are ready. Default true. */
  enabled?: boolean;
}

/** Format signed integer deltas with locale grouping (e.g. −1,948). */
function formatSignedInt(n: number): string {
  const abs = Math.abs(Math.round(n)).toLocaleString();
  if (n === 0) return "0";
  return n > 0 ? `+${abs}` : `−${abs}`;
}

/**
 * Prior-period delta badge.
 * Visible: absolute delta (+ optional % of prior). Tooltip: full prior window.
 * Fixed-height TrendSlot — keep this compact (no multi-line copy).
 */
function TrendBadge({
  value,
  suffix = "",
  goodWhenDown = false,
  neutral = false,
  priorLabel = null,
  priorAbsolute = null,
}: {
  value: number;
  /** Unit suffix after the absolute delta, e.g. `" pts"` for rate. */
  suffix?: string;
  goodWhenDown?: boolean;
  neutral?: boolean;
  /** Human prior window, e.g. "Prior 30 days" or "2024-01-01 – 2024-01-10". */
  priorLabel?: string | null;
  /**
   * Prior absolute for % change on count deltas.
   * When non-zero: show `(±N%)`. Rate (pts) skips this — pp is already a difference.
   */
  priorAbsolute?: number | null;
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

  // Count deltas: integer + optional % of prior. Rate: one decimal + " pts".
  const isRate = suffix.trim() === "pts";
  let display: string;
  if (isZero) {
    display = isRate ? `0${suffix}` : "0";
  } else if (isRate) {
    const mag = Math.abs(value).toFixed(1);
    display = `${isUp ? "+" : "−"}${mag}${suffix}`;
  } else {
    display = formatSignedInt(value);
    if (
      priorAbsolute != null &&
      priorAbsolute !== 0 &&
      Number.isFinite(priorAbsolute)
    ) {
      const pct = (value / priorAbsolute) * 100;
      const pctAbs = Math.abs(pct);
      const pctStr = pctAbs >= 1 ? pctAbs.toFixed(0) : pctAbs.toFixed(1);
      const pctSigned =
        pct > 0 ? `+${pctStr}` : pct < 0 ? `−${pctStr}` : pctStr;
      display = `${display} (${pctSigned}%)`;
    }
  }

  const vsLabel = priorLabel?.trim() ? `vs ${priorLabel}` : "vs prior period";
  const tooltipDetail = isRate
    ? `${vsLabel} · percentage points`
    : vsLabel;

  // O19: not color-only — icon + explicit aria-label with direction/quality
  const directionWord = isZero ? "unchanged" : isUp ? "up" : "down";
  const qualityWord =
    isGood === null || isZero
      ? ""
      : isGood
        ? ", improvement"
        : ", worsening";
  const ariaLabel = `${display} ${vsLabel}${qualityWord} (${directionWord})`;

  const badge = (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-0.5 truncate text-sm font-medium tabular-nums",
        color,
      )}
      title={tooltipDetail}
      aria-label={ariaLabel}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="truncate" aria-hidden>
        {display}
      </span>
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        {tooltipDetail}
      </TooltipContent>
    </Tooltip>
  );
}

/** O18: mild semantic tint for elevated failure rate (+ non-color cue). */
const RATE_WARN_PCT = 2;
const RATE_ALERT_PCT = 5;

function failureRateTone(rate: number | null | undefined): {
  valueClass: string;
  cue: string | null;
} {
  if (rate == null || !Number.isFinite(rate)) {
    return { valueClass: "", cue: null };
  }
  if (rate >= RATE_ALERT_PCT) {
    return {
      valueClass: "text-rose-600 dark:text-rose-400",
      cue: "Elevated",
    };
  }
  if (rate >= RATE_WARN_PCT) {
    return {
      valueClass: "text-amber-600 dark:text-amber-400",
      cue: "Watch",
    };
  }
  return { valueClass: "", cue: null };
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

/** Single caption line (O5/O12) — wrap on mobile, truncate only on wider cards. */
function CaptionSlot({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-5 shrink-0 items-start overflow-hidden text-xs leading-5 text-muted-foreground sm:items-center">
      {children}
    </div>
  );
}

const formatRate = (n: number) => n.toFixed(1);
/** Round first so continuous odometer ticks never render fractional totals. */
const formatInt = (n: number) => Math.round(n).toLocaleString();

export function HeroMetrics({
  dashboardRange,
  chartMode,
  annotationFilter,
  requestEpoch,
  onFailuresClick,
  enabled = true,
}: HeroMetricsProps) {
  const fetchKey = React.useMemo<SummaryStatsFetchKey>(
    () => ({
      dashboardRange,
      chartMode,
      annotationFilter,
    }),
    [dashboardRange, chartMode, annotationFilter],
  );

  /**
   * External cache: null during SSR/hydration; warm after client paint so
   * period switches roll the odometer immediately without a network wait.
   */
  const cachedFromStore = React.useSyncExternalStore(
    subscribeSummaryStatsCache,
    () => (enabled ? (getCachedSummaryStats(fetchKey) ?? null) : null),
    () => null,
  );

  const [data, setData] = React.useState<SummaryCompareResponse | null>(null);
  /** True only until the first successful payload (zeros → enter odometer). */
  const [pending, setPending] = React.useState(true);
  const [error, setError] = React.useState(false);
  const hasDataRef = React.useRef(false);

  const requestIdentity = React.useMemo(
    () =>
      JSON.stringify({
        chartMode,
        annotationFilter,
        requestEpoch,
        kind: dashboardRange.kind,
        from: dashboardRange.kind === "custom" ? dashboardRange.from : null,
        to: dashboardRange.kind === "custom" ? dashboardRange.to : null,
      }),
    [dashboardRange, chartMode, annotationFilter, requestEpoch],
  );
  const identityRef = React.useRef(requestIdentity);
  identityRef.current = requestIdentity;

  // Mirror store hits into local state (aligns odometer + pending flags).
  React.useLayoutEffect(() => {
    if (!enabled || cachedFromStore === null) return;
    setData(cachedFromStore);
    setPending(false);
    setError(false);
    hasDataRef.current = true;
  }, [enabled, cachedFromStore]);

  React.useEffect(() => {
    if (!enabled) {
      if (!hasDataRef.current) setPending(true);
      return;
    }

    const identityAtStart = requestIdentity;
    const isInitial = !hasDataRef.current && cachedFromStore === null;
    let cancelled = false;
    let cancelPrefetch: (() => void) | undefined;

    async function fetchStats() {
      try {
        // Initial load: odometer holds on 0. Later range changes / cache hits:
        // keep last numbers and roll when the new payload is applied.
        if (isInitial) setPending(true);
        setError(false);

        const next = await loadSummaryStats(fetchKey);
        if (cancelled || identityRef.current !== identityAtStart) return;

        setData(next);
        hasDataRef.current = true;

        cancelPrefetch = scheduleSiblingPillSummaryPrefetch({
          currentRange: dashboardRange,
          chartMode,
          annotationFilter,
        });
      } catch (e) {
        if (cancelled || identityRef.current !== identityAtStart) return;
        // Store already painted a hit — don't surface a background error
        if (getCachedSummaryStats(fetchKey) !== undefined) {
          setPending(false);
          return;
        }
        console.error("Failed to fetch hero stats:", e);
        setError(true);
      } finally {
        if (!cancelled && identityRef.current === identityAtStart) {
          setPending(false);
        }
      }
    }

    void fetchStats();
    return () => {
      cancelled = true;
      cancelPrefetch?.();
    };
  }, [
    fetchKey,
    dashboardRange,
    chartMode,
    annotationFilter,
    requestIdentity,
    enabled,
    // intentionally not depending on cachedFromStore — load still fills cache
  ]);

  // Prefer store for the current key so a prefetched pill paints on the same
  // render as the period change (then layoutEffect aligns local state).
  const effective = cachedFromStore ?? data;
  const stats = effective?.current ?? null;
  const delta = effective?.delta ?? null;
  const priorLabel = effective?.labels?.previous ?? null;
  // Odometer: zeros only on first paint; later swaps pass the live value so
  // RollingNumber can roll previous → next without re-inserting 0.
  const metricsPending = pending && !stats;
  const annotationOn = Boolean(
    annotationFilter && annotationFilter !== "all",
  );
  const isAllTime = dashboardRange.kind === "all";
  const showPop = delta !== null && !isAllTime;
  const periodLabel = dashboardRangeLabel(dashboardRange);
  const failedCount = stats?.failed ?? null;
  const rateTone = failureRateTone(
    metricsPending ? null : stats?.failureRate,
  );

  // Static card shells — only metric values / dynamic phrase fragments update
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:gap-6">
      {/* FAILURE RATE */}
      <Card
        className={cn(
          "@container/card to-card bg-gradient-to-t shadow-xs md:col-span-1",
          rateTone.cue === "Elevated"
            ? "from-rose-500/10"
            : rateTone.cue === "Watch"
              ? "from-amber-500/10"
              : "from-rose-500/5",
        )}
      >
        <CardHeader className="gap-2">
          <CardDescription className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide">
            Failure rate
            {rateTone.cue && !metricsPending && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold normal-case tracking-normal",
                  rateTone.cue === "Elevated"
                    ? "bg-rose-500/15 text-rose-700 dark:text-rose-300"
                    : "bg-amber-500/15 text-amber-800 dark:text-amber-300",
                )}
              >
                {rateTone.cue}
              </span>
            )}
          </CardDescription>
          <CardTitle
            className={cn(
              "text-5xl font-semibold tabular-nums tracking-tight leading-none sm:text-6xl",
              rateTone.valueClass,
            )}
          >
            <RollingNumber
              value={stats ? stats.failureRate : null}
              pending={metricsPending}
              format={formatRate}
              variant="hero"
              className={rateTone.valueClass || undefined}
              suffix={
                <span
                  className={cn(
                    "text-3xl",
                    rateTone.valueClass || "text-muted-foreground",
                  )}
                >
                  %
                </span>
              }
            />
          </CardTitle>
          <TrendSlot>
            {metricsPending ? (
              <span className="text-sm leading-5 text-muted-foreground/70">
                —
              </span>
            ) : showPop && delta ? (
              <TrendBadge
                value={delta.failureRatePp}
                suffix=" pts"
                goodWhenDown
                priorLabel={priorLabel}
              />
            ) : (
              <span className="text-sm leading-5 text-muted-foreground/70">
                —
              </span>
            )}
          </TrendSlot>
          <CaptionSlot>
            {annotationOn ? (
              metricsPending ||
              stats?.failurePercentageOfTotal === undefined ? (
                <span className="truncate tabular-nums text-muted-foreground/70">
                  —% of all failures
                </span>
              ) : (
                <span className="truncate">
                  <span className="tabular-nums">
                    {stats.failurePercentageOfTotal}%
                  </span>
                  {" of all failures"}
                </span>
              )
            ) : (
              <span className="text-pretty sm:truncate">
                {chartMode === "recent" ? "Latest · " : "All tests · "}
                <span className="text-foreground/80">{periodLabel}</span>
              </span>
            )}
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
            <RollingNumber
              value={stats ? stats.total : null}
              pending={metricsPending}
              format={formatInt}
              variant="secondary"
            />
          </CardTitle>
          <TrendSlot>
            {metricsPending ? (
              <span className="text-sm leading-5 text-muted-foreground/70">
                —
              </span>
            ) : showPop && delta ? (
              <TrendBadge
                value={delta.total}
                neutral
                priorLabel={priorLabel}
                priorAbsolute={data?.previous?.total ?? null}
              />
            ) : (
              <span className="text-sm leading-5 text-muted-foreground/70">
                —
              </span>
            )}
          </TrendSlot>
          <CaptionSlot>
            <span className="text-pretty sm:truncate">
              {chartMode === "recent"
                ? "Latest per inverter"
                : "Every test in period"}
            </span>
          </CaptionSlot>
        </CardHeader>
      </Card>

      {/* FAILURES — whole value is a table filter CTA (O13) */}
      <Card
        className={cn(
          "@container/card from-rose-500/5 to-card bg-gradient-to-t shadow-xs transition-colors",
          !metricsPending && "hover:border-rose-500/30",
        )}
      >
        <CardHeader className="gap-2">
          <CardDescription className="text-xs font-medium uppercase tracking-wide">
            Failures
          </CardDescription>
          <button
            type="button"
            onClick={onFailuresClick}
            className="group -mx-1 cursor-pointer rounded-md px-1 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed"
            title="Filter table to FAIL and scroll to tests"
            disabled={metricsPending}
            aria-label={
              failedCount != null && !metricsPending
                ? `View ${failedCount} failures in the table`
                : "View failures in the table"
            }
          >
            <CardTitle className="text-3xl font-semibold tabular-nums leading-none text-rose-600 transition-colors group-hover:underline dark:text-rose-400 sm:text-4xl">
              <RollingNumber
                value={stats ? stats.failed : null}
                pending={metricsPending}
                format={formatInt}
                variant="secondary"
                className="text-rose-600 dark:text-rose-400"
              />
            </CardTitle>
            <span className="mt-1 flex h-5 items-center text-xs font-medium leading-5 text-rose-600/80 underline-offset-2 group-hover:text-rose-600 group-hover:underline dark:text-rose-400/80 dark:group-hover:text-rose-400">
              {failedCount != null && !metricsPending
                ? `View ${formatInt(failedCount)} fails`
                : "View fails"}
            </span>
          </button>
          <TrendSlot>
            {metricsPending ? (
              <span className="text-sm leading-5 text-muted-foreground/70">
                —
              </span>
            ) : showPop && delta ? (
              <TrendBadge
                value={delta.failed}
                goodWhenDown
                priorLabel={priorLabel}
                priorAbsolute={data?.previous?.failed ?? null}
              />
            ) : (
              <span className="text-sm leading-5 text-muted-foreground/70">
                —
              </span>
            )}
          </TrendSlot>
          <CaptionSlot>
            {error && !stats ? (
              <span className="text-destructive">Could not load metrics.</span>
            ) : (
              <span className="text-pretty sm:truncate">
                {chartMode === "recent"
                  ? "Table may list more rows"
                  : "FAIL rows in period"}
              </span>
            )}
          </CaptionSlot>
        </CardHeader>
      </Card>

      {/* O16: single all-time compare note (not thrice).
          Always reserve one text-xs line so charts never shift when:
          - switching to/from all-time
          - soft-refresh toggles metricsPending
          Content is invisible (not unmounted) when not all-time. */}
      <div className="min-h-5 md:col-span-3" role={isAllTime ? "note" : undefined}>
        <p
          className={cn(
            "text-xs leading-5 text-muted-foreground",
            !isAllTime && "invisible",
          )}
        >
          All-time view has no prior-period comparison.
        </p>
      </div>
    </div>
  );
}
