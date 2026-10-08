"use client";

import * as React from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { HEADER_PERIODS, HeaderPeriodControls, HeaderResultModeControls } from "@/components/dashboard/header-controls";

type MobilePeriodControlsProps = React.ComponentProps<typeof HeaderPeriodControls> & {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  mode: string;
  onModeChange: (mode: string) => void;
  percentageMode?: "all" | "failed";
  onPercentageModeChange?: (mode: "all" | "failed") => void;
};

/** Fold the phone's period and population controls into the fixed header. */
export function MobilePeriodControls({ scrollContainerRef, mode, onModeChange, percentageMode, onPercentageModeChange, ...props }: MobilePeriodControlsProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const collapsedRef = React.useRef(false);
  const expandedAt = React.useRef(0);
  const focusRow = React.useRef(false);
  const focusSummary = React.useRef(false);
  const foldAfterPicker = React.useRef(false);
  const summaryRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const panelId = React.useId();
  const [internalOpen, setInternalOpen] = React.useState(false);
  const [percentageOpen, setPercentageOpen] = React.useState(false);
  const { period, ready = true, onPeriodChange, onCustomRange } = props;
  const open = props.open ?? internalOpen;
  const setOpen = props.onOpenChange ?? setInternalOpen;
  const pickerOpen = open || percentageOpen;
  const pickerOpenRef = React.useRef(pickerOpen);
  pickerOpenRef.current = pickerOpen;
  const selected = HEADER_PERIODS.find((p) => p.value === period);
  const shortLabel = selected?.short ?? "Custom";
  const label = selected?.label ?? `Custom date range: ${props.from || "start"} to ${props.to || "today"}`;

  const changeCollapsed = React.useCallback((next: boolean) => {
    if (collapsedRef.current === next) return;
    if (next && panelRef.current?.contains(document.activeElement)) {
      (document.activeElement as HTMLElement).blur();
      focusSummary.current = true;
    }
    collapsedRef.current = next;
    setCollapsed(next);
  }, []);

  const expand = React.useCallback(() => {
    expandedAt.current = scrollContainerRef.current?.scrollTop ?? 0;
    focusRow.current = true;
    changeCollapsed(false);
  }, [changeCollapsed, scrollContainerRef]);

  // Measure the untransformed cells, so an interrupted animation can reverse
  // smoothly. Only these seven small controls update during the transition.
  const measure = React.useCallback(() => {
    if (!panelRef.current || !summaryRef.current) return;
    for (const [groupClass, targetClass, buttonClass, fontScale] of [
      [".header-period-controls", ".mobile-summary-period", ".header-period-button", 16 / 14],
      [".header-result-controls", ".mobile-summary-mode", ".mobile-mode-button", 1],
    ] as const) {
      const group = panelRef.current.querySelector<HTMLElement>(groupClass);
      const target = summaryRef.current.querySelector<HTMLElement>(targetClass)?.getBoundingClientRect();
      if (!group || !target) continue;
      const row = group.getBoundingClientRect();
      for (const button of group.querySelectorAll<HTMLElement>(buttonClass)) {
        const scaleX = target.width / button.offsetWidth;
        const scaleY = target.height / button.offsetHeight;
        button.style.setProperty("--fold-x", `${target.left + target.width / 2 - row.left - button.offsetLeft - button.offsetWidth / 2}px`);
        button.style.setProperty("--fold-y", `${target.top + target.height / 2 - row.top - button.offsetTop - button.offsetHeight / 2}px`);
        button.style.setProperty("--fold-scale", String(scaleX));
        button.style.setProperty("--fold-scale-y", String(scaleY));
        button.style.setProperty("--fold-label-x", String(fontScale / scaleX));
        button.style.setProperty("--fold-label-y", String(fontScale / scaleY));
      }
    }
  }, []);

  React.useLayoutEffect(() => {
    measure();
    if (collapsed && focusSummary.current) {
      focusSummary.current = false;
      summaryRef.current?.focus({ preventScroll: true });
    } else if (!collapsed && focusRow.current) {
      focusRow.current = false;
      panelRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
    }
  }, [collapsed, period, mode, ready, measure]);

  React.useEffect(() => {
    const observer = new ResizeObserver(measure);
    for (const group of panelRef.current?.querySelectorAll(".header-period-controls, .header-result-controls") ?? []) observer.observe(group);
    if (summaryRef.current) observer.observe(summaryRef.current);
    return () => observer.disconnect();
  }, [measure]);

  React.useEffect(() => {
    const scroll = scrollContainerRef.current;
    if (!scroll) return;
    const onScroll = () => {
      if (pickerOpen || !ready) return;
      if (scroll.scrollTop <= 4) {
        expandedAt.current = 0;
        changeCollapsed(false);
      } else if (scroll.scrollTop > Math.max(48, expandedAt.current + 28)) {
        changeCollapsed(true);
      }
    };
    onScroll();
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => scroll.removeEventListener("scroll", onScroll);
  }, [changeCollapsed, pickerOpen, ready, scrollContainerRef]);

  React.useEffect(() => {
    if (pickerOpen) {
      expandedAt.current = scrollContainerRef.current?.scrollTop ?? 0;
      changeCollapsed(false);
    } else if (foldAfterPicker.current) {
      foldAfterPicker.current = false;
      if ((scrollContainerRef.current?.scrollTop ?? 0) > 4) changeCollapsed(true);
    }
  }, [changeCollapsed, pickerOpen, scrollContainerRef]);

  const afterSelection = () => {
    if ((scrollContainerRef.current?.scrollTop ?? 0) > 4) focusSummary.current = true;
    // DateRangePicker commits its value after closing; use the current state
    // rather than the callback captured when the picker was open.
    if (pickerOpenRef.current) foldAfterPicker.current = true;
    else if ((scrollContainerRef.current?.scrollTop ?? 0) > 4) changeCollapsed(true);
  };

  return (
    <>
      {/* The transformed radio stays visible; this transparent button supplies
          its header tap target without a second painted pill to flicker. */}
      <Button ref={summaryRef} variant="default" size="sm"
        className="mobile-period-summary rounded-full bg-primary text-primary-foreground"
        data-collapsed={collapsed} aria-hidden={!collapsed} tabIndex={collapsed ? 0 : -1}
        aria-label={`Expand date filters, selected ${label}, ${mode === "all" ? "All tests" : "Latest"}${percentageMode ? `, percentage of ${percentageMode}` : ""}`} aria-controls={panelId}
        aria-expanded={!collapsed} disabled={!ready} title={label} onClick={expand}>
        <span className="mobile-summary-period">{shortLabel}</span>
        <span className="mobile-summary-mode">{mode === "all" ? "All tests" : "Latest"}</span>
      </Button>
      <div ref={panelRef} id={panelId} className="mobile-period-panel mobile-header-controls"
        data-collapsed={collapsed} aria-hidden={collapsed} inert={collapsed}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !pickerOpen && (scrollContainerRef.current?.scrollTop ?? 0) > 4) {
            event.preventDefault();
            changeCollapsed(true);
          }
        }}>
        <HeaderPeriodControls {...props} open={open} onOpenChange={setOpen}
          onPeriodChange={(value) => { onPeriodChange(value); afterSelection(); }}
          onCustomRange={(from, to) => { onCustomRange(from, to); afterSelection(); }} />
        <div className="mobile-population-row" data-percentage={Boolean(percentageMode)}>
          <HeaderResultModeControls mobileInline mode={mode} ready={ready}
            onModeChange={(value) => { onModeChange(value); afterSelection(); }} />
          {percentageMode && onPercentageModeChange && (
            <Select value={percentageMode} open={percentageOpen} onOpenChange={setPercentageOpen}
              disabled={!ready} onValueChange={(value) => {
                if (value === "all" || value === "failed") {
                  onPercentageModeChange(value);
                  afterSelection();
                }
              }}>
              <SelectTrigger className="mobile-percentage-trigger" aria-label="Cause ranking percentage"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="failed">% of Failed</SelectItem><SelectItem value="all">% of All</SelectItem></SelectContent>
            </Select>
          )}
        </div>
      </div>
    </>
  );
}
