"use client";

import * as React from "react";
import { IconFlame, IconTemperature } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  dashboardRangeLabel,
  type DashboardRange,
} from "@/lib/dashboard-range";

interface DashboardEmptyStateProps {
  dashboardRange: DashboardRange;
  /** Jump to all-time when the current window is empty. */
  onShowAllTime?: () => void;
  /** Open custom range / more (optional). */
  onWidenRange?: () => void;
}

/**
 * Full remaining-viewport empty state when the selected period has no tests.
 * Keeps the dashboard to roughly one view height (header + this panel).
 */
export function DashboardEmptyState({
  dashboardRange,
  onShowAllTime,
  onWidenRange,
}: DashboardEmptyStateProps) {
  const period = dashboardRangeLabel(dashboardRange);
  const canWiden =
    dashboardRange.kind !== "all" && typeof onShowAllTime === "function";

  return (
    <div
      className="flex min-h-[calc(100dvh-7.5rem)] flex-col items-center justify-center px-4 py-10"
      role="status"
    >
      <div className="relative w-full max-w-lg rounded-2xl border bg-card px-8 py-12 text-center shadow-sm">
        {/* Soft glow — “oven cooling” */}
        <div
          className="pointer-events-none absolute inset-x-12 top-8 h-24 rounded-full bg-rose-500/10 blur-2xl dark:bg-rose-500/15"
          aria-hidden
        />

        <div className="relative mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl border border-rose-500/20 bg-gradient-to-b from-rose-500/15 to-transparent">
          <IconFlame
            className="size-8 text-rose-500/80 dark:text-rose-400/90"
            stroke={1.5}
            aria-hidden
          />
          <IconTemperature
            className="absolute -right-1 -bottom-1 size-5 text-muted-foreground/70"
            stroke={1.5}
            aria-hidden
          />
        </div>

        <h2 className="relative text-xl font-semibold tracking-tight sm:text-2xl">
          Burn-in chamber is quiet
        </h2>
        <p className="relative mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          No inverter runs showed up in{" "}
          <span className="font-medium text-foreground">{period}</span>.
          Either the line was offline, the window is too tight, or every unit
          is still warming up somewhere else.
        </p>

        <p className="relative mt-4 font-mono text-[11px] tracking-wide text-muted-foreground/80 uppercase">
          0 tests · 0° of drama
        </p>

        {(canWiden || onWidenRange) && (
          <div className="relative mt-8 flex flex-wrap items-center justify-center gap-2">
            {canWiden && (
              <Button type="button" onClick={onShowAllTime} className="h-10">
                Show all time
              </Button>
            )}
            {onWidenRange && (
              <Button
                type="button"
                variant="outline"
                onClick={onWidenRange}
                className="h-10"
              >
                Pick another range
              </Button>
            )}
          </div>
        )}

        <p className="relative mt-6 text-xs text-muted-foreground">
          Tip: use the period pills above —{" "}
          <span className="font-medium text-foreground/80">All</span> usually
          has the full burn-in history.
        </p>
      </div>
    </div>
  );
}
