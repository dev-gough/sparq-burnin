"use client";

import { IconSettings } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { Label } from "@/components/ui/label";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type DashboardRange, tableDatesForPill, utcDaysAgoYmd, utcTodayYmd } from "@/lib/dashboard-range";
import {
  HeaderPeriodControls, HeaderResultModeControls, HeaderRangeMeta,
  HEADER_BAR_CLASS, HEADER_TITLE_CLASS, HEADER_CONTROLS_CLASS, HEADER_TOGGLE_CLASS,
} from "@/components/dashboard/header-controls";

export type AnalyticsRange = DashboardRange | { kind: "180d" } | { kind: "365d" };

export function FailureAnalyticsHeader({ range, onRangeChange, chartMode, onChartModeChange, percentageMode, onPercentageModeChange, ready, updatedAt }: {
  range: AnalyticsRange;
  onRangeChange: (range: AnalyticsRange) => void;
  chartMode: string;
  onChartModeChange: (mode: string) => void;
  percentageMode: "all" | "failed";
  onPercentageModeChange: (mode: "all" | "failed") => void;
  ready: boolean;
  updatedAt: Date | null;
}) {
  const sharedRange: DashboardRange = range.kind === "180d" || range.kind === "365d"
    ? { kind: "custom", from: utcDaysAgoYmd(range.kind === "180d" ? 180 : 365), to: utcTodayYmd() }
    : range;
  const dates = sharedRange.kind === "custom" ? sharedRange : tableDatesForPill(sharedRange.kind);
  return (
    <header className={HEADER_BAR_CLASS}>
      <div className="flex min-w-0 items-center gap-1.5">
        <h1 className={HEADER_TITLE_CLASS}>Failure Analytics</h1>
        <InfoTooltip side="bottom" content={
          <div className="space-y-2 text-left text-xs leading-relaxed">
            <p><strong>Latest</strong> analyzes one result per inverter in the selected window. <strong>All tests</strong> includes every run.</p>
            <p>Periods and custom ranges use UTC calendar days and carry between the dashboard and failure analytics.</p>
            <p>Percentage options in More change pie chart labels and tooltips; slice sizes stay the same.</p>
          </div>
        } />
      </div>
      <div className={HEADER_CONTROLS_CLASS}>
        <HeaderPeriodControls
          period={sharedRange.kind}
          from={dates.from}
          to={dates.to}
          onPeriodChange={(period) => onRangeChange({ kind: period as Exclude<DashboardRange["kind"], "custom"> })}
          onCustomRange={(from, to) => onRangeChange({ kind: "custom", from, to })}
          ready={ready}
        />
        <HeaderResultModeControls mode={chartMode} onModeChange={onChartModeChange} ready={ready} />
      </div>
      <HeaderRangeMeta range={sharedRange} updatedAt={updatedAt} ready={ready} />
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="h-10 min-h-10 gap-1.5 px-2.5 sm:px-3" aria-label="More options">
              <IconSettings className="size-4" />
              <span className="hidden sm:inline">More</span>
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-md">
            <SheetHeader>
              <SheetTitle>Failure analytics options</SheetTitle>
              <SheetDescription>Adjust pie chart percentages or choose a longer period.</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-6 px-4 pb-6">
              <div className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Percentage</Label>
                <ToggleGroup type="single" value={percentageMode} onValueChange={(value) => { if (value === "all" || value === "failed") onPercentageModeChange(value); }} variant="outline" aria-label="Pie chart percentage" className="w-full justify-start">
                  <ToggleGroupItem value="failed" className={HEADER_TOGGLE_CLASS}>% of Failed</ToggleGroupItem>
                  <ToggleGroupItem value="all" className={HEADER_TOGGLE_CLASS}>% of All</ToggleGroupItem>
                </ToggleGroup>
                <p className="text-xs text-muted-foreground">Changes pie chart labels and tooltips. % of Failed uses failed tests as the denominator; % of All uses all tests. Slice sizes stay the same.</p>
              </div>
              <div className="space-y-2">
                <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Longer periods</Label>
                <div className="flex flex-wrap gap-2">
                  <SheetClose asChild>
                    <Button variant="outline" className="h-10 min-h-10" disabled={!ready} onClick={() => onRangeChange({ kind: "180d" })}>Last 6 months</Button>
                  </SheetClose>
                  <SheetClose asChild>
                    <Button variant="outline" className="h-10 min-h-10" disabled={!ready} onClick={() => onRangeChange({ kind: "365d" })}>Last year</Button>
                  </SheetClose>
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
