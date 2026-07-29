/**
 * Client-side dashboard preferences (localStorage).
 * Read only after mount to avoid SSR hydration mismatches.
 */

import type { ChartBucket } from "@/lib/chart-theme";
import type { DashboardPill, DashboardRange } from "@/lib/dashboard-range";

export const DASHBOARD_PREFS_KEY = "burnin-dashboard-prefs";
/** Legacy cookie key — migrated once into localStorage then cleared. */
export const LEGACY_FILTER_COOKIE_KEY = "burnin-data-table-filters";

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

/** Replace entire prefs object in localStorage. */
export function saveDashboardPrefs(prefs: Partial<DashboardPrefs>): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(DASHBOARD_PREFS_KEY, JSON.stringify(prefs));
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
  if (dashboardRange.kind === "custom") {
    return {
      period: "custom",
      customFrom: dashboardRange.from,
      customTo: dashboardRange.to,
      lastPill: state.lastPill,
      chartMode: state.chartMode,
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
    bucket: state.bucket,
    filterLinked: state.filterLinked,
    annotationFilter: state.annotationFilter,
    statusFilter: state.statusFilter,
    dateFromFilter: state.tableDateFrom,
    dateToFilter: state.tableDateTo,
  };
}
