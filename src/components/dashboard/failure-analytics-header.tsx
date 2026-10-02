"use client";

import { InfoTooltip } from "@/components/ui/info-tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { type DashboardRange, tableDatesForPill } from "@/lib/dashboard-range";
import {
  HeaderPeriodControls, HeaderResultModeControls, HeaderRangeMeta,
  HEADER_BAR_CLASS, HEADER_TITLE_CLASS, HEADER_CONTROLS_CLASS, HEADER_TOGGLE_CLASS,
} from "@/components/dashboard/header-controls";

export type AnalyticsRange = DashboardRange;

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
  const dates = range.kind === "custom" ? range : tableDatesForPill(range.kind);
  return (
    <header className={HEADER_BAR_CLASS}>
      <div className="flex min-w-0 items-center gap-1.5">
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
        <HeaderPeriodControls
          period={range.kind}
          from={dates.from}
          to={dates.to}
          onPeriodChange={(period) => onRangeChange({ kind: period as Exclude<DashboardRange["kind"], "custom"> })}
          onCustomRange={(from, to) => onRangeChange({ kind: "custom", from, to })}
          ready={ready}
        />
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
      </div>
      <HeaderRangeMeta range={range} updatedAt={updatedAt} ready={ready} />
    </header>
  );
}
