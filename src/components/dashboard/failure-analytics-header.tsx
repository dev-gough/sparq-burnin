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
            <p><strong>Latest</strong> analyzes one result per inverter in the selected window. <strong>All tests</strong> includes every run.</p>
            <p>Periods and custom ranges use UTC calendar days and carry between the dashboard and failure analytics.</p>
            <p>Percentage options change pie chart labels and tooltips; slice sizes stay the same.</p>
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
          aria-label="Pie chart percentage"
        >
          <ToggleGroupItem value="failed" className={HEADER_TOGGLE_CLASS} title="Percentage of failed tests">
            % of Failed
          </ToggleGroupItem>
          <ToggleGroupItem value="all" className={HEADER_TOGGLE_CLASS} title="Percentage of all tests">
            % of All
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <HeaderRangeMeta range={range} updatedAt={updatedAt} ready={ready} />
    </header>
  );
}
