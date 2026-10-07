"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HEADER_PERIODS, HeaderPeriodControls } from "@/components/dashboard/header-controls";

type MobilePeriodControlsProps = React.ComponentProps<typeof HeaderPeriodControls> & {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
};

/** Fold the phone's date row into its selected pill without moving the page. */
export function MobilePeriodControls({ scrollContainerRef, ...props }: MobilePeriodControlsProps) {
  const [collapsed, setCollapsed] = React.useState(false);
  const collapsedRef = React.useRef(false);
  const expandedAt = React.useRef(0);
  const focusRow = React.useRef(false);
  const focusSummary = React.useRef(false);
  const foldAfterPicker = React.useRef(false);
  const summaryRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const panelId = React.useId();
  const { period, ready = true, open, onPeriodChange, onCustomRange } = props;
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
  // smoothly. Only these five small controls update during the transition.
  const measure = React.useCallback(() => {
    const group = panelRef.current?.querySelector<HTMLElement>(".header-period-controls");
    if (!group || !summaryRef.current) return;
    const row = group.getBoundingClientRect();
    const target = summaryRef.current.getBoundingClientRect();
    const positions = [...group.querySelectorAll<HTMLElement>(".header-period-button")].map((button) => ({
      button,
      x: target.left + target.width / 2 - row.left - button.offsetLeft - button.offsetWidth / 2,
      y: target.top + target.height / 2 - row.top - button.offsetTop - button.offsetHeight / 2,
      scale: target.width / button.offsetWidth,
    }));
    for (const { button, x, y, scale } of positions) {
      button.style.setProperty("--fold-x", `${x}px`);
      button.style.setProperty("--fold-y", `${y}px`);
      button.style.setProperty("--fold-scale", String(scale));
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
  }, [collapsed, period, ready, measure]);

  React.useEffect(() => {
    const group = panelRef.current?.querySelector(".header-period-controls");
    const observer = new ResizeObserver(measure);
    if (group) observer.observe(group);
    if (summaryRef.current) observer.observe(summaryRef.current);
    return () => observer.disconnect();
  }, [measure]);

  React.useEffect(() => {
    const scroll = scrollContainerRef.current;
    if (!scroll) return;
    const onScroll = () => {
      if (open || !ready) return;
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
  }, [changeCollapsed, open, ready, scrollContainerRef]);

  React.useEffect(() => {
    if (open) {
      expandedAt.current = scrollContainerRef.current?.scrollTop ?? 0;
      changeCollapsed(false);
    } else if (foldAfterPicker.current) {
      foldAfterPicker.current = false;
      if ((scrollContainerRef.current?.scrollTop ?? 0) > 4) changeCollapsed(true);
    }
  }, [changeCollapsed, open, scrollContainerRef]);

  const afterSelection = () => {
    if (open) foldAfterPicker.current = true;
    else if ((scrollContainerRef.current?.scrollTop ?? 0) > 4) changeCollapsed(true);
  };

  return (
    <>
      <Button ref={summaryRef} variant="default" size="sm"
        className="mobile-period-summary rounded-full bg-primary text-primary-foreground"
        data-collapsed={collapsed} aria-hidden={!collapsed} tabIndex={collapsed ? 0 : -1}
        aria-label={`Expand date filters, selected ${label}`} aria-controls={panelId}
        aria-expanded={!collapsed} disabled={!ready} title={label} onClick={expand}>
        <span>{shortLabel}</span><ChevronDown className="size-3" />
      </Button>
      <div ref={panelRef} id={panelId} className="mobile-period-panel mobile-header-controls"
        data-collapsed={collapsed} aria-hidden={collapsed} inert={collapsed}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !open && (scrollContainerRef.current?.scrollTop ?? 0) > 4) {
            event.preventDefault();
            changeCollapsed(true);
          }
        }}>
        <HeaderPeriodControls {...props}
          onPeriodChange={(value) => { onPeriodChange(value); afterSelection(); }}
          onCustomRange={(from, to) => { onCustomRange(from, to); afterSelection(); }} />
      </div>
    </>
  );
}
