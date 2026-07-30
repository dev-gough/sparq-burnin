/**
 * Dashboard preferences:
 * - localStorage is the full client source of truth
 * - a small "boot" cookie mirrors command-center fields so SSR can paint the
 *   correct period/mode on first load (no 30d/Latest → All/All-tests flash)
 */

import type { ChartBucket } from "@/lib/chart-theme";
import type { DashboardPill, DashboardRange } from "@/lib/dashboard-range";
import {
  defaultBucketForDashboardRange,
  resolveLinkedInitState,
  tableDatesForPill,
} from "@/lib/dashboard-range";

export const DASHBOARD_PREFS_KEY = "burnin-dashboard-prefs";
/** Compact cookie mirrored from localStorage for SSR-correct first paint. */
export const DASHBOARD_BOOT_COOKIE = "burnin-dashboard-boot";
/** Legacy cookie key — migrated once into localStorage then cleared. */
export const LEGACY_FILTER_COOKIE_KEY = "burnin-data-table-filters";

const PILL_KINDS: DashboardPill[] = ["7d", "30d", "90d", "all"];
const BUCKET_KINDS: ChartBucket[] = ["day", "week", "month", "quarter", "year"];

export const SSR_DEFAULT_PILL: DashboardPill = "30d";
export const SSR_DEFAULT_RANGE: DashboardRange = { kind: SSR_DEFAULT_PILL };

function isDashboardPill(value: unknown): value is DashboardPill {
  return typeof value === "string" && (PILL_KINDS as string[]).includes(value);
}

function isChartBucket(value: unknown): value is ChartBucket {
  return typeof value === "string" && (BUCKET_KINDS as string[]).includes(value);
}

export type DashboardPrefs = {
  // Table filters
  serialSearch?: string;
  statusFilter?: string;
  firmwareFilter?: string;
  annotationFilter?: string;
  dateFromFilter?: string;
  dateToFilter?: string;
  latestOnly?: boolean;
  // Dashboard command-center
  /** Pill period or "custom". */
  period?: DashboardPill | "custom";
  customFrom?: string;
  customTo?: string;
  lastPill?: DashboardPill;
  chartMode?: "all" | "recent" | string;
  bucket?: ChartBucket;
  filterLinked?: boolean;
};

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/** Read legacy cookie blob (table filters only). */
function loadLegacyCookiePrefs(): Partial<DashboardPrefs> {
  try {
    if (typeof document === "undefined") return {};
    const cookies = document.cookie.split(";");
    const filterCookie = cookies.find((cookie) =>
      cookie.trim().startsWith(`${LEGACY_FILTER_COOKIE_KEY}=`),
    );
    if (!filterCookie) return {};
    const cookieValue = filterCookie.split("=")[1];
    if (!cookieValue) return {};
    const parsed = JSON.parse(decodeURIComponent(cookieValue)) as Record<
      string,
      unknown
    >;
    return {
      serialSearch: typeof parsed.serialSearch === "string" ? parsed.serialSearch : undefined,
      statusFilter: typeof parsed.statusFilter === "string" ? parsed.statusFilter : undefined,
      firmwareFilter:
        typeof parsed.firmwareFilter === "string" ? parsed.firmwareFilter : undefined,
      annotationFilter:
        typeof parsed.annotationFilter === "string" ? parsed.annotationFilter : undefined,
      dateFromFilter:
        typeof parsed.dateFromFilter === "string" ? parsed.dateFromFilter : undefined,
      dateToFilter:
        typeof parsed.dateToFilter === "string" ? parsed.dateToFilter : undefined,
      latestOnly: typeof parsed.latestOnly === "boolean" ? parsed.latestOnly : undefined,
    };
  } catch {
    return {};
  }
}

function clearLegacyCookie(): void {
  try {
    if (typeof document === "undefined") return;
    document.cookie = `${LEGACY_FILTER_COOKIE_KEY}=; path=/; max-age=0`;
  } catch {
    // ignore
  }
}

/** Load prefs from localStorage; one-time migrate from legacy cookie if empty. */
export function loadDashboardPrefs(): Partial<DashboardPrefs> {
  if (!isBrowser()) return {};

  try {
    const raw = localStorage.getItem(DASHBOARD_PREFS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
      return parsed && typeof parsed === "object" ? parsed : {};
    }

    // First visit after switch: lift old cookie prefs into localStorage
    const legacy = loadLegacyCookiePrefs();
    if (Object.keys(legacy).length > 0) {
      saveDashboardPrefs(legacy);
      clearLegacyCookie();
      return legacy;
    }
  } catch (error) {
    console.warn("Failed to load dashboard prefs from localStorage:", error);
  }
  return {};
}

/** Fields safe/useful to put in the SSR boot cookie (keep small). */
export function pickBootPrefs(prefs: Partial<DashboardPrefs>): Partial<DashboardPrefs> {
  const boot: Partial<DashboardPrefs> = {};
  if (prefs.period !== undefined) boot.period = prefs.period;
  if (prefs.customFrom !== undefined) boot.customFrom = prefs.customFrom;
  if (prefs.customTo !== undefined) boot.customTo = prefs.customTo;
  if (prefs.lastPill !== undefined) boot.lastPill = prefs.lastPill;
  if (prefs.chartMode !== undefined) boot.chartMode = prefs.chartMode;
  if (prefs.bucket !== undefined) boot.bucket = prefs.bucket;
  if (prefs.filterLinked !== undefined) boot.filterLinked = prefs.filterLinked;
  if (prefs.annotationFilter !== undefined) {
    boot.annotationFilter = prefs.annotationFilter;
  }
  if (prefs.statusFilter !== undefined) boot.statusFilter = prefs.statusFilter;
  if (prefs.dateFromFilter !== undefined) boot.dateFromFilter = prefs.dateFromFilter;
  if (prefs.dateToFilter !== undefined) boot.dateToFilter = prefs.dateToFilter;
  return boot;
}

/** Write/refresh the SSR boot cookie from a prefs snapshot (client only). */
export function writeDashboardBootCookie(prefs: Partial<DashboardPrefs>): void {
  if (typeof document === "undefined") return;
  try {
    const boot = pickBootPrefs(prefs);
    const value = encodeURIComponent(JSON.stringify(boot));
    // 1 year; SameSite=Lax so it rides normal navigations. Not HttpOnly —
    // written from the client to mirror localStorage.
    document.cookie = `${DASHBOARD_BOOT_COOKIE}=${value}; path=/; max-age=31536000; SameSite=Lax`;
  } catch (error) {
    console.warn("Failed to write dashboard boot cookie:", error);
  }
}

/** Parse the SSR boot cookie value (server or client). */
export function parseDashboardBootCookie(
  raw: string | undefined | null,
): Partial<DashboardPrefs> {
  if (!raw) return {};
  try {
    const decoded = decodeURIComponent(raw);
    const parsed = JSON.parse(decoded) as Partial<DashboardPrefs>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    try {
      const parsed = JSON.parse(raw) as Partial<DashboardPrefs>;
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
}

/** True when boot prefs carry enough to select period + mode on first paint. */
export function hasDashboardBootPrefs(prefs: Partial<DashboardPrefs>): boolean {
  return (
    isDashboardPill(prefs.period) ||
    prefs.period === "custom" ||
    prefs.chartMode === "all" ||
    prefs.chartMode === "recent"
  );
}

/**
 * Resolve full command-center initial state from a prefs blob (cookie boot
 * and/or localStorage). Pure — safe for SSR and client.
 */
export function resolveDashboardInitState(
  saved: Partial<DashboardPrefs> = {},
): {
  dashboardRange: DashboardRange;
  lastPill: DashboardPill;
  chartMode: "all" | "recent";
  bucket: ChartBucket;
  filterLinked: boolean;
  annotationFilter: string;
  statusFilter: string;
  tableDateFrom: string;
  tableDateTo: string;
} {
  const linked = saved.filterLinked !== false; // default true
  let nextRange: DashboardRange;
  let nextLastPill: DashboardPill = isDashboardPill(saved.lastPill)
    ? saved.lastPill
    : SSR_DEFAULT_PILL;

  if (
    saved.period === "custom" &&
    saved.customFrom &&
    saved.customTo &&
    saved.customFrom <= saved.customTo
  ) {
    nextRange = {
      kind: "custom",
      from: saved.customFrom,
      to: saved.customTo,
    };
  } else if (isDashboardPill(saved.period)) {
    nextRange = { kind: saved.period };
    nextLastPill = saved.period;
  } else {
    const init = resolveLinkedInitState(
      saved.dateFromFilter || "",
      saved.dateToFilter || "",
      SSR_DEFAULT_PILL,
    );
    nextRange = init.dashboardRange;
    nextLastPill = init.lastPill;
  }

  let tableDateFrom = "";
  let tableDateTo = "";
  if (nextRange.kind === "custom") {
    tableDateFrom = linked
      ? nextRange.from
      : saved.dateFromFilter || nextRange.from;
    tableDateTo = linked ? nextRange.to : saved.dateToFilter || nextRange.to;
  } else if (linked) {
    const span = tableDatesForPill(nextRange.kind);
    tableDateFrom = span.from;
    tableDateTo = span.to;
  } else {
    tableDateFrom = saved.dateFromFilter || "";
    tableDateTo = saved.dateToFilter || "";
  }

  const bucket: ChartBucket = isChartBucket(saved.bucket)
    ? saved.bucket
    : defaultBucketForDashboardRange(nextRange);

  const chartMode: "all" | "recent" =
    saved.chartMode === "all" || saved.chartMode === "recent"
      ? saved.chartMode
      : "recent";

  return {
    dashboardRange: nextRange,
    lastPill: nextLastPill,
    chartMode,
    bucket,
    filterLinked: linked,
    annotationFilter: saved.annotationFilter || "all",
    statusFilter: saved.statusFilter || "valid",
    tableDateFrom,
    tableDateTo,
  };
}

/** Replace entire prefs object in localStorage (+ mirror boot cookie). */
export function saveDashboardPrefs(prefs: Partial<DashboardPrefs>): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(DASHBOARD_PREFS_KEY, JSON.stringify(prefs));
    writeDashboardBootCookie(prefs);
  } catch (error) {
    console.warn("Failed to save dashboard prefs to localStorage:", error);
  }
}

/**
 * Merge patch into existing prefs and save.
 * Keys set to `undefined` are removed (so switching off custom period
 * clears customFrom/customTo instead of leaving stale values).
 */
export function patchDashboardPrefs(patch: Partial<DashboardPrefs>): void {
  if (!isBrowser()) return;
  const current = loadDashboardPrefs();
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete merged[key];
    } else {
      merged[key] = value;
    }
  }
  saveDashboardPrefs(merged as Partial<DashboardPrefs>);
}

/** Snapshot of command-center fields to persist. */
export function prefsFromDashboardState(state: {
  dashboardRange: DashboardRange;
  lastPill: DashboardPill;
  chartMode: string;
  bucket: ChartBucket;
  filterLinked: boolean;
  annotationFilter: string;
  statusFilter: string;
  tableDateFrom: string;
  tableDateTo: string;
}): Partial<DashboardPrefs> {
  const { dashboardRange } = state;
  // Table Latest only is the same switch as header Result mode.
  const latestOnly = state.chartMode === "recent";
  if (dashboardRange.kind === "custom") {
    return {
      period: "custom",
      customFrom: dashboardRange.from,
      customTo: dashboardRange.to,
      lastPill: state.lastPill,
      chartMode: state.chartMode,
      latestOnly,
      bucket: state.bucket,
      filterLinked: state.filterLinked,
      annotationFilter: state.annotationFilter,
      statusFilter: state.statusFilter,
      dateFromFilter: state.tableDateFrom,
      dateToFilter: state.tableDateTo,
    };
  }
  return {
    period: dashboardRange.kind,
    lastPill: state.lastPill,
    customFrom: undefined,
    customTo: undefined,
    chartMode: state.chartMode,
    latestOnly,
    bucket: state.bucket,
    filterLinked: state.filterLinked,
    annotationFilter: state.annotationFilter,
    statusFilter: state.statusFilter,
    dateFromFilter: state.tableDateFrom,
    dateToFilter: state.tableDateTo,
  };
}
