"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobilePeriodControls } from "@/components/dashboard/mobile-period-controls";
import { cn } from "@/lib/utils";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type DashboardRange, tableDatesForPill } from "@/lib/dashboard-range";
import {
  HeaderPeriodControls, HeaderResultModeControls, HeaderRangeMeta,
  HEADER_BAR_CLASS, HEADER_TITLE_CLASS, HEADER_CONTROLS_CLASS, HEADER_TOGGLE_CLASS,
} from "@/components/dashboard/header-controls";

export type AnalyticsRange = DashboardRange;

export function FailureAnalyticsHeader({ range, onRangeChange, chartMode, onChartModeChange, percentageMode, onPercentageModeChange, ready, updatedAt, scrollContainerRef }: {
  range: AnalyticsRange;
  onRangeChange: (range: AnalyticsRange) => void;
  chartMode: string;
  onChartModeChange: (mode: string) => void;
  percentageMode: "all" | "failed";
  onPercentageModeChange: (mode: "all" | "failed") => void;
  ready: boolean;
  updatedAt: Date | null;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const isMobile = useIsMobile();
  const [mobileTarget, setMobileTarget] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => { setMobileTarget(document.getElementById("mobile-header-periods")); }, []);
  const mobilePeriods = isMobile && mobileTarget;
  const dates = range.kind === "custom" ? range : tableDatesForPill(range.kind);
  const periodProps = {
    period: range.kind,
    from: dates.from,
    to: dates.to,
    onPeriodChange: (period: string) => onRangeChange({ kind: period as Exclude<DashboardRange["kind"], "custom"> }),
    onCustomRange: (from: string, to: string) => onRangeChange({ kind: "custom", from, to }),
    ready,
  };
  return (
    <header data-mobile-periods={Boolean(mobilePeriods)} className={cn(HEADER_BAR_CLASS, "folding-page-header")}>

      <div className="folding-header-title flex min-w-0 items-center gap-1.5">
        <h1 className={HEADER_TITLE_CLASS}>Failure Analytics</h1>
        <InfoTooltip side="bottom" content={
          <div className="space-y-2 text-left text-xs leading-relaxed">
            <p><strong>Latest</strong> is the latest PASS or FAIL per inverter. <strong>All tests</strong> counts every PASS and FAIL. Invalid and retest are left out.</p>
            <p>Periods and custom ranges use UTC calendar days and are shared with the dashboard.</p>
            <p><strong>% of Failed</strong> and <strong>% of All</strong> change the denominator on the cause rankings. The counts do not change. One test can carry several annotations, so a share of failed tests can pass 100%.</p>
          </div>
        } />
      </div>
      <div className={HEADER_CONTROLS_CLASS}>
        {mobilePeriods
          ? createPortal(<MobilePeriodControls {...periodProps} mode={chartMode} onModeChange={onChartModeChange}
              percentageMode={percentageMode} onPercentageModeChange={onPercentageModeChange} scrollContainerRef={scrollContainerRef} />, mobilePeriods)
          : <HeaderPeriodControls {...periodProps} />}
        {!mobilePeriods && <>
        <HeaderResultModeControls mode={chartMode} onModeChange={onChartModeChange} ready={ready} />
        <ToggleGroup
          type="single"
          value={percentageMode}
          onValueChange={(value) => {
            if (value === "all" || value === "failed") onPercentageModeChange(value);
          }}
          variant="outline"
          aria-label="Cause ranking percentage"
        >
          <ToggleGroupItem value="failed" className={HEADER_TOGGLE_CLASS} title="Rank each cause as a share of failed tests">
            % of Failed
          </ToggleGroupItem>
          <ToggleGroupItem value="all" className={HEADER_TOGGLE_CLASS} title="Rank each cause as a share of all tests">
            % of All
          </ToggleGroupItem>
        </ToggleGroup>
        </>}
      </div>
      <HeaderRangeMeta range={range} updatedAt={updatedAt} ready={ready} />
    </header>
  );
}
