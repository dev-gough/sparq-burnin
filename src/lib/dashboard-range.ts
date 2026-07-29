/**
 * Dashboard period model for the command-center layout.
 * Always drives hero, rate strip, volume chart, and summary compare.
 */

export type DashboardPill = "7d" | "30d" | "90d" | "all";

export type DashboardRange =
  | { kind: DashboardPill }
  | { kind: "custom"; from: string; to: string };

export function isPillRange(
  range: DashboardRange,
): range is { kind: DashboardPill } {
  return range.kind !== "custom";
}

/** UTC today as YYYY-MM-DD. */
export function utcTodayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

/** UTC calendar day N days before today as YYYY-MM-DD. */
export function utcDaysAgoYmd(days: number): string {
  const d = new Date();
  const utc = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - days),
  );
  return utc.toISOString().slice(0, 10);
}

/**
 * Table date span matching SQL `start_time_utc >= CURRENT_DATE - N days`
 * (inclusive open window ending today).
 */
export function tableDatesForPill(kind: DashboardPill): {
  from: string;
  to: string;
} {
  if (kind === "all") return { from: "", to: "" };
  const days = kind === "7d" ? 7 : kind === "30d" ? 30 : 90;
  return { from: utcDaysAgoYmd(days), to: utcTodayYmd() };
}

/** API query params derived solely from dashboardRange. */
export function dashboardRangeToApiParams(range: DashboardRange): {
  timeRange?: string;
  dateFrom?: string;
  dateTo?: string;
} {
  if (range.kind === "custom") {
    return { dateFrom: range.from, dateTo: range.to };
  }
  return { timeRange: range.kind };
}

/** Append dashboard range params onto URLSearchParams. */
export function appendDashboardRangeParams(
  params: URLSearchParams,
  range: DashboardRange,
): void {
  const p = dashboardRangeToApiParams(range);
  if (p.timeRange) params.set("timeRange", p.timeRange);
  if (p.dateFrom) params.set("dateFrom", p.dateFrom);
  if (p.dateTo) params.set("dateTo", p.dateTo);
}

/** Plain-language period label for captions. */
export function dashboardRangeLabel(range: DashboardRange): string {
  switch (range.kind) {
    case "7d":
      return "the last 7 days";
    case "30d":
      return "the last 30 days";
    case "90d":
      return "the last 3 months";
    case "all":
      return "all time";
    case "custom":
      return `${range.from} – ${range.to}`;
  }
}

/** Map dashboardRange to export timeRange (pills only; custom is null). */
export function exportTimeRange(
  range: DashboardRange,
): "7d" | "30d" | "90d" | "all" | null {
  if (range.kind === "custom") return null;
  return range.kind;
}

/**
 * Period-scoped link to /todo for the untagged-failures chip.
 * Rolling pills map to the same UTC YMD window as tableDatesForPill;
 * custom uses from/to; all-time links without dates (global list).
 */
export function todoHrefFromDashboardRange(range: DashboardRange): string {
  if (range.kind === "custom") {
    return `/todo?dateFrom=${encodeURIComponent(range.from)}&dateTo=${encodeURIComponent(range.to)}`;
  }
  if (range.kind === "all") {
    return "/todo";
  }
  const { from, to } = tableDatesForPill(range.kind);
  return `/todo?dateFrom=${encodeURIComponent(from)}&dateTo=${encodeURIComponent(to)}`;
}

/** Default bucket for a dashboard range (smart defaults). */
export function defaultBucketForDashboardRange(
  range: DashboardRange,
): "day" | "week" | "month" | "quarter" | "year" {
  if (range.kind === "custom") {
    // crude span-based default
    const from = new Date(range.from + "T00:00:00Z");
    const to = new Date(range.to + "T00:00:00Z");
    const days =
      Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days <= 45) return "day";
    if (days <= 180) return "week";
    if (days <= 800) return "month";
    return "quarter";
  }
  switch (range.kind) {
    case "all":
      return "month";
    case "90d":
      return "week";
    case "7d":
    case "30d":
    default:
      return "day";
  }
}

/**
 * Linked-mode init: keep dashboardRange and table dates aligned.
 *
 * - Both cookie dates present → promote dashboard to custom (same span)
 * - Otherwise → default pill period + matching table span (ignore partial cookie dates)
 *
 * filterLinked defaults true and is not cookie-persisted; this prevents hero
 * showing 30d while the table still has a stale cookie range.
 */
export function resolveLinkedInitState(
  cookieDateFrom: string,
  cookieDateTo: string,
  defaultPill: DashboardPill = "30d",
): {
  dashboardRange: DashboardRange;
  lastPill: DashboardPill;
  tableDateFrom: string;
  tableDateTo: string;
} {
  const from = (cookieDateFrom || "").trim();
  const to = (cookieDateTo || "").trim();

  if (from && to && from <= to) {
    return {
      dashboardRange: { kind: "custom", from, to },
      lastPill: defaultPill,
      tableDateFrom: from,
      tableDateTo: to,
    };
  }

  const span = tableDatesForPill(defaultPill);
  return {
    dashboardRange: { kind: defaultPill },
    lastPill: defaultPill,
    tableDateFrom: span.from,
    tableDateTo: span.to,
  };
}
