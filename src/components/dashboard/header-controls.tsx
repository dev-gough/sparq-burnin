"use client";

import { DateRangePicker } from "@/components/date-range-picker";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { dashboardRangeContextLabel, type DashboardRange } from "@/lib/dashboard-range";
import { cn } from "@/lib/utils";

export const HEADER_BAR_CLASS = "mobile-page-header z-20 flex min-h-14 shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background px-3 py-2 sm:px-4 lg:px-6";
export const HEADER_TITLE_CLASS = "truncate text-sm font-semibold tracking-tight sm:text-base lg:text-lg";
export const HEADER_CONTROLS_CLASS = "mobile-header-controls flex flex-1 flex-wrap items-center justify-end gap-2 sm:justify-center sm:gap-3";
export const HEADER_TOGGLE_CLASS = "h-10 min-h-10 px-3 text-sm focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";
const CUSTOM_TOGGLE_CLASS = "h-10 min-h-10 min-w-11 px-3 text-sm focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground";

export const HEADER_PERIODS = [
  { value: "7d", label: "7 days", short: "7d" },
  { value: "30d", label: "30 days", short: "30d" },
  { value: "90d", label: "90 days", short: "90d" },
  { value: "all", label: "All time", short: "All" },
];

export function HeaderPeriodControls({
  period,
  from,
  to,
  onPeriodChange,
  onCustomRange,
  onPeriodPrefetch,
  ready = true,
  open,
  onOpenChange,
  periods = HEADER_PERIODS,
}: {
  period: string;
  from: string;
  to: string;
  onPeriodChange: (period: string) => void;
  onCustomRange: (from: string, to: string) => void;
  onPeriodPrefetch?: (period: string) => void;
  ready?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  periods?: typeof HEADER_PERIODS;
}) {
  const custom = ready && period === "custom";
  return (
    <ToggleGroup
      type="single"
      value={ready ? period : ""}
      onValueChange={(value) => {
        if (value && value !== "custom") onPeriodChange(value);
      }}
      variant="outline"
      className={cn("header-period-controls flex", !ready && "pointer-events-none opacity-50")}
      aria-label="Period"
      aria-busy={!ready}
    >
      {periods.map((p) => (
        <ToggleGroupItem
          key={p.value}
          value={p.value}
          disabled={!ready}
          className={cn(HEADER_TOGGLE_CLASS, "header-period-button min-w-11")}
          aria-label={p.label}
          onPointerEnter={() => onPeriodPrefetch?.(p.value)}
          onFocus={() => onPeriodPrefetch?.(p.value)}
        >
          <span className="header-period-label">{p.short}</span>
        </ToggleGroupItem>
      ))}
      <DateRangePicker
        from={from}
        to={to}
        trigger={
          <ToggleGroupItem
            value="custom"
            data-selected={custom}
            disabled={!ready}
            className={cn(CUSTOM_TOGGLE_CLASS, "header-period-button")}
            aria-label="Custom date range"
          >
            <span className="header-period-label">Custom</span>
          </ToggleGroupItem>
        }
        active={custom}
        disabled={!ready}
        open={open}
        onOpenChange={onOpenChange}
        onRangeChange={(nextFrom, nextTo) => {
          if (!nextFrom && !nextTo) onPeriodChange("all");
          else onCustomRange(nextFrom, nextTo);
        }}
      />
    </ToggleGroup>
  );
}

export function HeaderResultModeControls({
  mode,
  onModeChange,
  ready = true,
}: {
  mode: string;
  onModeChange: (mode: string) => void;
  ready?: boolean;
}) {
  return (
    <>
      <ToggleGroup
        type="single"
        value={mode}
        onValueChange={(value) => { if (value) onModeChange(value); }}
        variant="outline"
        className={cn("hidden md:flex", !ready && "pointer-events-none opacity-50")}
        aria-label="Result mode"
      >
        <ToggleGroupItem value="recent" className={HEADER_TOGGLE_CLASS} title="Latest PASS or FAIL per inverter. Invalid and retest are skipped.">
          Latest
        </ToggleGroupItem>
        <ToggleGroupItem value="all" className={HEADER_TOGGLE_CLASS} title="Every PASS and FAIL. Invalid and retest are left out of the totals.">
          All tests
        </ToggleGroupItem>
      </ToggleGroup>
      <Select value={ready ? mode : undefined} onValueChange={onModeChange} disabled={!ready}>
        <SelectTrigger className="h-10 min-h-10 w-[6.75rem] md:hidden" aria-label="Result mode">
          <SelectValue placeholder="Mode…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="recent">Latest</SelectItem>
          <SelectItem value="all">All tests</SelectItem>
        </SelectContent>
      </Select>
    </>
  );
}

export function HeaderRangeMeta({ range, updatedAt, ready = true }: {
  range: DashboardRange;
  updatedAt: Date | null;
  ready?: boolean;
}) {
  const custom = ready && range.kind === "custom";
  const label = ready ? dashboardRangeContextLabel(range) ?? "—" : "—";
  const clock = updatedAt?.toLocaleTimeString(undefined, {
    hour: "2-digit", minute: "2-digit", hour12: true,
  }) ?? "––:–– ––";
  return (
    <div
      className={cn(
        "hidden shrink-0 items-center justify-end gap-2 text-xs tabular-nums text-muted-foreground lg:flex",
        custom ? "w-auto min-w-[15.5rem]" : "w-[15.5rem]",
      )}
      aria-live="polite"
    >
      <span
        className={cn(
          "whitespace-nowrap text-right",
          custom
            ? "rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 font-medium text-primary"
            : "min-w-0 max-w-[7.25rem] truncate",
        )}
        title="UTC calendar days"
      >
        {custom ? `${label} · UTC` : label}
      </span>
      <span className="w-[8.25rem] shrink-0 whitespace-nowrap text-right text-muted-foreground/80" title="Client time of last data update">
        Updated {clock}
      </span>
    </div>
  );
}
