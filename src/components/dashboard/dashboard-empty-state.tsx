"use client";

import * as React from "react";
import { IconChartBarOff } from "@tabler/icons-react";

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
 * Ops-default copy (O8) — factual recovery path, not marketing wit.
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
      className="dashboard-empty-enter flex min-h-[calc(100dvh-7.5rem)] flex-col items-center justify-center px-4 py-10"
      role="status"
    >
      <div className="relative w-full max-w-lg rounded-2xl border bg-card px-8 py-12 text-center shadow-sm">
        <div className="relative mx-auto mb-5 flex size-16 items-center justify-center rounded-2xl border border-border bg-muted/40">
          <IconChartBarOff
            className="size-8 text-muted-foreground"
            stroke={1.5}
            aria-hidden
          />
        </div>

        <h2 className="relative text-xl font-semibold tracking-tight sm:text-2xl">
          No tests in this period
        </h2>
        <p className="relative mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          No inverter burn-in runs were found in{" "}
          <span className="font-medium text-foreground">{period}</span>.
        </p>

        <ul className="relative mx-auto mt-4 max-w-sm space-y-1.5 text-left text-sm text-muted-foreground">
          <li className="flex gap-2">
            <span className="text-muted-foreground/60" aria-hidden>
              ·
            </span>
            <span>The date window may be too short</span>
          </li>
          <li className="flex gap-2">
            <span className="text-muted-foreground/60" aria-hidden>
              ·
            </span>
            <span>The line may have been offline</span>
          </li>
          <li className="flex gap-2">
            <span className="text-muted-foreground/60" aria-hidden>
              ·
            </span>
            <span>Data may not have been ingested yet</span>
          </li>
        </ul>

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
                Custom range
              </Button>
            )}
          </div>
        )}

        <p className="relative mt-6 text-xs text-muted-foreground">
          Use the period controls above —{" "}
          <span className="font-medium text-foreground/80">All</span> usually
          has the full burn-in history.
        </p>
      </div>
    </div>
  );
}
