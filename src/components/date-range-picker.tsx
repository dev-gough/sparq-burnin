"use client";

import * as React from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CalendarRange,
  Sparkles,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { utcDaysAgoYmd, utcTodayYmd } from "@/lib/dashboard-range";

/* ─── UTC calendar helpers (YYYY-MM-DD) ─────────────────────────────── */

function parseYmd(ymd: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return { y: +m[1], m: +m[2] - 1, d: +m[3] };
}

function toYmd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function formatShort(ymd: string): string {
  const p = parseYmd(ymd);
  if (!p) return ymd;
  const dt = new Date(Date.UTC(p.y, p.m, p.d));
  try {
    return dt.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return ymd;
  }
}

function formatMonthTitle(y: number, m: number): string {
  const dt = new Date(Date.UTC(y, m, 1));
  try {
    return dt.toLocaleDateString(undefined, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return `${m + 1}/${y}`;
  }
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** Monday=0 … Sunday=6 for a UTC date (ISO-ish week start). */
function weekdayMon0(y: number, m: number, d: number): number {
  const dow = new Date(Date.UTC(y, m, d)).getUTCDay(); // 0=Sun
  return (dow + 6) % 7;
}

function cmpYmd(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function addMonths(y: number, m: number, delta: number): { y: number; m: number } {
  const idx = y * 12 + m + delta;
  return { y: Math.floor(idx / 12), m: ((idx % 12) + 12) % 12 };
}

type Cell =
  | { kind: "empty"; key: string }
  | { kind: "day"; key: string; ymd: string; day: number };

/** Always 6 weeks (42 cells) so month height / nav chevrons never jump. */
const WEEKS_PER_MONTH = 6;
const CELLS_PER_MONTH = 7 * WEEKS_PER_MONTH;

function buildMonthGrid(y: number, m: number): Cell[] {
  const cells: Cell[] = [];
  const lead = weekdayMon0(y, m, 1);
  const dim = daysInMonth(y, m);
  for (let i = 0; i < lead; i++) {
    cells.push({ kind: "empty", key: `e-${y}-${m}-${i}` });
  }
  for (let d = 1; d <= dim; d++) {
    const ymd = toYmd(y, m, d);
    cells.push({ kind: "day", key: ymd, ymd, day: d });
  }
  while (cells.length < CELLS_PER_MONTH) {
    cells.push({ kind: "empty", key: `t-${y}-${m}-${cells.length}` });
  }
  return cells;
}

/* ─── Quick presets ─────────────────────────────────────────────────── */

const PRESETS = [
  { id: "7d", label: "7 days", get: () => ({ from: utcDaysAgoYmd(7), to: utcTodayYmd() }) },
  { id: "30d", label: "30 days", get: () => ({ from: utcDaysAgoYmd(30), to: utcTodayYmd() }) },
  { id: "90d", label: "90 days", get: () => ({ from: utcDaysAgoYmd(90), to: utcTodayYmd() }) },
  { id: "all", label: "All time", get: () => ({ from: "", to: "" }) },
] as const;

/* ─── Component ─────────────────────────────────────────────────────── */

export type DateRangePickerProps = {
  from: string;
  to: string;
  /** Called with both ends atomically (prefer over separate from/to handlers). */
  onRangeChange: (from: string, to: string) => void;
  className?: string;
  /** Optional class for the trigger button. */
  triggerClassName?: string;
};

export function DateRangePicker({
  from,
  to,
  onRangeChange,
  className,
  triggerClassName,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);

  const today = utcTodayYmd();
  // Prefer showing the range start month so dual-month view can include both ends.
  const initialCursor = React.useMemo(() => {
    const p = parseYmd(from || to || today);
    if (p) return { y: p.y, m: p.m };
    const n = new Date();
    return { y: n.getUTCFullYear(), m: n.getUTCMonth() };
  }, [from, to, today]);

  const [cursor, setCursor] = React.useState(initialCursor);
  const [slideDir, setSlideDir] = React.useState<"left" | "right" | null>(null);
  // Draft selection while picking a custom range (before second click).
  const [draftStart, setDraftStart] = React.useState<string | null>(null);
  const [hoverDay, setHoverDay] = React.useState<string | null>(null);
  /** Brief “Applied” beat before close so the page update doesn’t fire mid-click. */
  const [settling, setSettling] = React.useState(false);
  const [pendingRange, setPendingRange] = React.useState<{
    from: string;
    to: string;
  } | null>(null);
  const settleTimers = React.useRef<number[]>([]);

  const clearSettleTimers = React.useCallback(() => {
    for (const id of settleTimers.current) window.clearTimeout(id);
    settleTimers.current = [];
  }, []);

  React.useEffect(() => () => clearSettleTimers(), [clearSettleTimers]);

  // Sync month view when opened with a new committed range.
  React.useEffect(() => {
    if (!open) return;
    if (settling) return; // don’t reset mid “Applied” animation
    setCursor(initialCursor);
    setDraftStart(null);
    setHoverDay(null);
    setSlideDir(null);
    setPendingRange(null);
    setSettling(false);
  }, [open, initialCursor, settling]);

  const committedFrom = from || "";
  const committedTo = to || "";
  const hasRange = Boolean(committedFrom || committedTo);

  // While settling, paint the range the user just chose (before parent props catch up).
  const displayFrom = pendingRange ? pendingRange.from : committedFrom;
  const displayTo = pendingRange ? pendingRange.to : committedTo;

  // Normalize preview range for highlighting
  const preview =
    settling && pendingRange
      ? pendingRange.from && pendingRange.to
        ? {
            a:
              cmpYmd(pendingRange.from, pendingRange.to) <= 0
                ? pendingRange.from
                : pendingRange.to,
            b:
              cmpYmd(pendingRange.from, pendingRange.to) <= 0
                ? pendingRange.to
                : pendingRange.from,
          }
        : pendingRange.from
          ? { a: pendingRange.from, b: pendingRange.from }
          : pendingRange.to
            ? { a: pendingRange.to, b: pendingRange.to }
            : null
      : draftStart && hoverDay
        ? cmpYmd(draftStart, hoverDay) <= 0
          ? { a: draftStart, b: hoverDay }
          : { a: hoverDay, b: draftStart }
        : draftStart
          ? { a: draftStart, b: draftStart }
          : committedFrom && committedTo
            ? {
                a:
                  cmpYmd(committedFrom, committedTo) <= 0
                    ? committedFrom
                    : committedTo,
                b:
                  cmpYmd(committedFrom, committedTo) <= 0
                    ? committedTo
                    : committedFrom,
              }
            : committedFrom
              ? { a: committedFrom, b: committedFrom }
              : committedTo
                ? { a: committedTo, b: committedTo }
                : null;

  const goMonth = (delta: number) => {
    if (settling) return;
    setSlideDir(delta > 0 ? "left" : "right");
    setCursor((c) => addMonths(c.y, c.m, delta));
  };

  /**
   * Confirm → brief settle → close popover → then notify parent.
   * Closing first avoids the “page shot” of charts/table updating under an open panel.
   */
  const applyRange = (nextFrom: string, nextTo: string) => {
    if (settling) return;
    let f = nextFrom;
    let t = nextTo;
    if (f && t && cmpYmd(f, t) > 0) {
      const tmp = f;
      f = t;
      t = tmp;
    }
    clearSettleTimers();
    setDraftStart(null);
    setHoverDay(null);
    setPendingRange({ from: f, to: t });
    setSettling(true);

    // Close after a short “Applied” beat (lets Radix run exit animation cleanly).
    settleTimers.current.push(
      window.setTimeout(() => {
        setOpen(false);
      }, 280),
    );
    // Push range to parent after close starts — SWR updates feel calmer.
    settleTimers.current.push(
      window.setTimeout(() => {
        onRangeChange(f, t);
        setSettling(false);
        setPendingRange(null);
      }, 420),
    );
  };

  const onDayClick = (ymd: string) => {
    if (settling) return;
    if (!draftStart) {
      setDraftStart(ymd);
      setHoverDay(ymd);
      return;
    }
    // Second click completes the range.
    applyRange(draftStart, ymd);
  };

  const onOpenChange = (next: boolean) => {
    if (settling && !next) {
      // Allow close during settle; keep timers running for parent update.
      setOpen(false);
      return;
    }
    if (settling && next) return;
    setOpen(next);
  };

  const activePreset = PRESETS.find((p) => {
    const r = p.get();
    return r.from === displayFrom && r.to === displayTo;
  })?.id;

  const rangeLabel = (f: string, t: string, empty = "Any date") => {
    if (!f && !t) return empty;
    if (f && t && f === t) return formatShort(f);
    if (f && t) return `${formatShort(f)} – ${formatShort(t)}`;
    if (f) return `From ${formatShort(f)}`;
    return `Until ${formatShort(t)}`;
  };

  const triggerLabel = rangeLabel(
    pendingRange?.from ?? committedFrom,
    pendingRange?.to ?? committedTo,
  );
  const panelLabel = settling
    ? rangeLabel(displayFrom, displayTo, "All time")
    : draftStart
      ? `${formatShort(draftStart)}${
          hoverDay && hoverDay !== draftStart
            ? ` → ${formatShort(hoverDay)}`
            : " → …"
        }`
      : rangeLabel(committedFrom, committedTo, "All time");

  const leftMonth = cursor;
  const rightMonth = addMonths(cursor.y, cursor.m, 1);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            // h-9 matches SelectTrigger default so the filter row aligns
            "group relative flex h-9 min-h-9 w-full min-w-0 items-center gap-2 overflow-hidden rounded-md border border-input bg-background px-3 text-left text-sm shadow-xs transition-[border-color,box-shadow,background-color,transform] duration-300 outline-none",
            "hover:bg-muted/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            open && "border-ring ring-[3px] ring-ring/40",
            (hasRange || pendingRange) && "border-primary/30 bg-primary/5",
            settling && "border-primary/50 bg-primary/10",
            triggerClassName,
            className,
          )}
          aria-label={`Date range: ${triggerLabel} (UTC)`}
        >
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md transition-all duration-300",
              hasRange || pendingRange
                ? "bg-primary/15 text-primary"
                : "bg-muted text-muted-foreground group-hover:text-foreground",
              settling && "bg-primary text-primary-foreground scale-105",
            )}
          >
            {settling ? (
              <Check className="size-3.5" strokeWidth={2.5} />
            ) : (
              <CalendarRange className="size-3.5" />
            )}
          </span>
          <span className="min-w-0 flex-1 truncate font-medium tabular-nums tracking-tight transition-opacity duration-300">
            {triggerLabel}
          </span>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
            UTC
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className={cn(
          "w-[min(100vw-1.5rem,36rem)] overflow-hidden p-0 transition-[box-shadow] duration-300",
          settling && "ring-2 ring-primary/30",
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (settling) e.preventDefault();
        }}
        onEscapeKeyDown={(e) => {
          if (settling) e.preventDefault();
        }}
      >
        {/* Ambient header */}
        <div className="relative border-b bg-gradient-to-br from-primary/10 via-muted/40 to-transparent px-4 pt-3.5 pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold tracking-tight">
                {settling ? "Range applied" : "Date range"}
              </p>
              <p className="text-xs text-muted-foreground">
                {settling
                  ? "Updating the dashboard…"
                  : draftStart
                    ? "Click an end date — or the same day for a single day"
                    : "One click for presets · two clicks on the calendar"}
              </p>
            </div>
            <div
              className={cn(
                "rounded-lg border px-2.5 py-1.5 text-right transition-all duration-300",
                settling
                  ? "border-primary bg-primary text-primary-foreground shadow-md scale-[1.02]"
                  : draftStart
                    ? "border-primary/40 bg-primary/10 shadow-sm"
                    : "border-border/60 bg-background/60",
              )}
            >
              <p
                className={cn(
                  "text-[10px] font-medium tracking-wide uppercase",
                  settling
                    ? "text-primary-foreground/80"
                    : "text-muted-foreground",
                )}
              >
                {settling ? (
                  <span className="inline-flex items-center gap-1">
                    <Check className="size-3" strokeWidth={2.5} />
                    Applied
                  </span>
                ) : draftStart ? (
                  "Selecting"
                ) : (
                  "Current"
                )}
              </p>
              <p className="text-xs font-semibold tabular-nums">{panelLabel}</p>
            </div>
          </div>

          {/* Presets */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const active = activePreset === p.id && !draftStart && !settling;
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={settling}
                  onClick={() => {
                    const r = p.get();
                    applyRange(r.from, r.to);
                  }}
                  className={cn(
                    "h-8 rounded-full border px-3 text-xs font-medium transition-all duration-200",
                    "disabled:pointer-events-none disabled:opacity-60",
                    active
                      ? "border-primary bg-primary text-primary-foreground shadow-sm scale-[1.02]"
                      : "border-border/80 bg-background/80 text-foreground hover:border-primary/40 hover:bg-primary/5",
                  )}
                >
                  {p.id === "all" ? (
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="size-3 opacity-70" />
                      {p.label}
                    </span>
                  ) : (
                    p.label
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Month navigation + dual calendars */}
        <div className="relative px-2 pt-2 pb-1 sm:px-3">
          <div className="absolute top-2 right-2 left-2 z-[1] flex items-center justify-between sm:left-3 sm:right-3">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-full bg-background/80 backdrop-blur-sm"
              onClick={() => goMonth(-1)}
              aria-label="Previous month"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 rounded-full bg-background/80 backdrop-blur-sm"
              onClick={() => goMonth(1)}
              aria-label="Next month"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>

          <div
            key={`${leftMonth.y}-${leftMonth.m}`}
            className={cn(
              "grid gap-5 pt-1 pb-2 sm:grid-cols-2",
              slideDir === "left" &&
                "animate-in fade-in-0 slide-in-from-right-4 duration-300",
              slideDir === "right" &&
                "animate-in fade-in-0 slide-in-from-left-4 duration-300",
              !slideDir && "animate-in fade-in-0 duration-200",
            )}
          >
            <MonthGrid
              y={leftMonth.y}
              m={leftMonth.m}
              title={formatMonthTitle(leftMonth.y, leftMonth.m)}
              preview={preview}
              draftStart={draftStart}
              today={today}
              onDayClick={onDayClick}
              onDayHover={settling ? () => {} : setHoverDay}
              disabled={settling}
            />
            <MonthGrid
              className="hidden sm:block"
              y={rightMonth.y}
              m={rightMonth.m}
              title={formatMonthTitle(rightMonth.y, rightMonth.m)}
              preview={preview}
              draftStart={draftStart}
              today={today}
              onDayClick={onDayClick}
              onDayHover={settling ? () => {} : setHoverDay}
              disabled={settling}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t bg-muted/30 px-3 py-2.5">
          <button
            type="button"
            disabled={settling}
            className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            onClick={() => {
              setDraftStart(null);
              setHoverDay(null);
              applyRange("", "");
            }}
          >
            Clear dates
          </button>
          <div className="flex items-center gap-2">
            {draftStart && !settling && (
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => {
                  setDraftStart(null);
                  setHoverDay(null);
                }}
              >
                Cancel pick
              </button>
            )}
            <Button
              type="button"
              size="sm"
              variant={draftStart && !settling ? "default" : "secondary"}
              className="h-8 rounded-full px-3 text-xs"
              disabled={!draftStart || settling}
              onClick={() => {
                if (draftStart) applyRange(draftStart, draftStart);
              }}
            >
              Use single day
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function MonthGrid({
  y,
  m,
  title,
  preview,
  draftStart,
  today,
  onDayClick,
  onDayHover,
  disabled = false,
  className,
}: {
  y: number;
  m: number;
  title: string;
  preview: { a: string; b: string } | null;
  draftStart: string | null;
  today: string;
  onDayClick: (ymd: string) => void;
  onDayHover: (ymd: string | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const cells = React.useMemo(() => buildMonthGrid(y, m), [y, m]);
  const weekdays = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
  const dim = daysInMonth(y, m);

  return (
    <div className={cn("select-none", className)}>
      <p className="mb-2 h-8 text-center text-sm font-semibold tracking-tight">
        {title}
      </p>
      <div className="mb-1 grid grid-cols-7">
        {weekdays.map((w) => (
          <div
            key={w}
            className="flex h-7 items-center justify-center text-[10px] font-semibold tracking-wider text-muted-foreground uppercase"
          >
            {w}
          </div>
        ))}
      </div>
      <div
        className="grid grid-cols-7"
        onMouseLeave={() => onDayHover(null)}
      >
        {cells.map((cell) => {
          if (cell.kind === "empty") {
            return <div key={cell.key} className="h-9" />;
          }
          const { ymd, day } = cell;
          const isToday = ymd === today;
          const inRange = Boolean(
            preview &&
              cmpYmd(ymd, preview.a) >= 0 &&
              cmpYmd(ymd, preview.b) <= 0,
          );
          const isStart = Boolean(preview && ymd === preview.a);
          const isEnd = Boolean(preview && ymd === preview.b);
          // Soft edge when range continues past this month’s boundary
          const isSoftStart =
            inRange &&
            !isStart &&
            day === 1 &&
            preview !== null &&
            cmpYmd(preview.a, ymd) < 0;
          const isSoftEnd =
            inRange &&
            !isEnd &&
            day === dim &&
            preview !== null &&
            cmpYmd(preview.b, ymd) > 0;
          const isEndpoint = isStart || isEnd;
          const isSingle = isStart && isEnd;
          const isDraftAnchor = draftStart === ymd;
          const showBar = inRange && !isSingle;

          return (
            <div
              key={cell.key}
              className={cn(
                "relative flex h-9 items-center justify-center",
                showBar && "before:absolute before:inset-y-1 before:left-0 before:right-0 before:bg-primary/20",
                showBar && (isStart || isSoftStart) && "before:left-1 before:rounded-l-full",
                showBar && (isEnd || isSoftEnd) && "before:right-1 before:rounded-r-full",
              )}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => onDayClick(ymd)}
                onMouseEnter={() => onDayHover(ymd)}
                className={cn(
                  "relative z-[1] flex size-8 items-center justify-center rounded-full text-sm tabular-nums transition-all duration-150",
                  "hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "disabled:pointer-events-none",
                  !isEndpoint &&
                    !isToday &&
                    "text-foreground hover:bg-muted/80",
                  isToday &&
                    !isEndpoint &&
                    "font-semibold text-primary ring-1 ring-primary/50 ring-offset-1 ring-offset-popover",
                  isEndpoint &&
                    "bg-primary font-semibold text-primary-foreground shadow-md shadow-primary/30 scale-105",
                  isDraftAnchor &&
                    !isEnd &&
                    "ring-2 ring-primary ring-offset-2 ring-offset-popover",
                )}
              >
                {day}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
