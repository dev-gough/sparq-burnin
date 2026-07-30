/**
 * Shared client cache + in-flight dedupe for hero summary compare payloads.
 *
 * Mirrors bucket-stats-cache so period pills feel instant for the first-paint
 * KPI cards as well as the charts.
 */

import {
  appendDashboardRangeParams,
  type DashboardPill,
  type DashboardRange,
} from "@/lib/dashboard-range";
import type { SummaryDelta, SummaryStats } from "@/lib/summary-delta";

/** Compare envelope returned by `/api/test-stats?view=summary&compare=1`. */
export type SummaryCompareResponse = {
  current: SummaryStats;
  previous: SummaryStats | null;
  delta: SummaryDelta | null;
  labels: { current: string; previous: string } | null;
  failurePercentageOfTotal: number | null;
  /** Echo fields from API when present (not required for UI). */
  chartMode?: string;
  timeRange?: string | null;
  annotation?: string;
};

export type SummaryStatsFetchKey = {
  dashboardRange: DashboardRange;
  chartMode: string;
  annotationFilter: string;
};

const PERIOD_PILLS: DashboardPill[] = ["7d", "30d", "90d", "all"];

const cache = new Map<string, SummaryCompareResponse>();
const inflight = new Map<string, Promise<SummaryCompareResponse>>();
const listeners = new Set<() => void>();

function emitCacheChange(): void {
  for (const listener of listeners) listener();
}

export function subscribeSummaryStatsCache(
  onStoreChange: () => void,
): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function summaryStatsCacheKey(key: SummaryStatsFetchKey): string {
  const { dashboardRange, chartMode, annotationFilter } = key;
  return JSON.stringify({
    chartMode,
    annotationFilter,
    kind: dashboardRange.kind,
    from: dashboardRange.kind === "custom" ? dashboardRange.from : null,
    to: dashboardRange.kind === "custom" ? dashboardRange.to : null,
  });
}

export function getCachedSummaryStats(
  key: SummaryStatsFetchKey,
): SummaryCompareResponse | undefined {
  return cache.get(summaryStatsCacheKey(key));
}

export function setCachedSummaryStats(
  key: SummaryStatsFetchKey,
  data: SummaryCompareResponse,
): void {
  cache.set(summaryStatsCacheKey(key), data);
  emitCacheChange();
}

export function invalidateSummaryStatsCache(): void {
  cache.clear();
  emitCacheChange();
}

/** Test helper. */
export function resetSummaryStatsCacheForTests(): void {
  cache.clear();
  inflight.clear();
  emitCacheChange();
}

function buildSummaryUrl(key: SummaryStatsFetchKey): string {
  const params = new URLSearchParams({
    view: "summary",
    compare: "1",
    chartMode: key.chartMode,
    annotation: key.annotationFilter,
  });
  appendDashboardRangeParams(params, key.dashboardRange);
  return `/api/test-stats?${params}`;
}

function normalizeSummaryJson(json: unknown): SummaryCompareResponse {
  if (!json || typeof json !== "object") {
    return {
      current: { total: 0, passed: 0, failed: 0, failureRate: 0 },
      previous: null,
      delta: null,
      labels: null,
      failurePercentageOfTotal: null,
    };
  }
  const obj = json as Record<string, unknown>;
  if (obj.current && typeof obj.current === "object") {
    const cur = obj.current as SummaryStats;
    return {
      current: cur,
      previous: (obj.previous as SummaryStats | null) ?? null,
      delta: (obj.delta as SummaryDelta | null) ?? null,
      labels:
        (obj.labels as { current: string; previous: string } | null) ?? null,
      failurePercentageOfTotal:
        (obj.failurePercentageOfTotal as number | null) ??
        cur.failurePercentageOfTotal ??
        null,
      chartMode: obj.chartMode as string | undefined,
      timeRange: (obj.timeRange as string | null | undefined) ?? null,
      annotation: obj.annotation as string | undefined,
    };
  }
  // Flat SummaryStats (compare off) — normalize to envelope
  const flat = obj as unknown as SummaryStats;
  return {
    current: {
      total: flat.total ?? 0,
      passed: flat.passed ?? 0,
      failed: flat.failed ?? 0,
      failureRate: flat.failureRate ?? 0,
      failurePercentageOfTotal: flat.failurePercentageOfTotal,
    },
    previous: null,
    delta: null,
    labels: null,
    failurePercentageOfTotal: flat.failurePercentageOfTotal ?? null,
  };
}

async function fetchSummaryNetwork(
  key: SummaryStatsFetchKey,
): Promise<SummaryCompareResponse> {
  const response = await fetch(buildSummaryUrl(key));
  if (!response.ok) {
    throw new Error(`summary stats HTTP ${response.status}`);
  }
  const json: unknown = await response.json();
  return normalizeSummaryJson(json);
}

/**
 * Load summary compare: cache hit → resolve immediately; concurrent callers
 * share one in-flight promise; miss → network then cache.
 */
export function loadSummaryStats(
  key: SummaryStatsFetchKey,
  opts?: { force?: boolean },
): Promise<SummaryCompareResponse> {
  const ck = summaryStatsCacheKey(key);
  const force = opts?.force === true;

  if (!force) {
    const hit = cache.get(ck);
    if (hit !== undefined) return Promise.resolve(hit);
    const pending = inflight.get(ck);
    if (pending) return pending;
  }

  const promise = fetchSummaryNetwork(key)
    .then((data) => {
      cache.set(ck, data);
      emitCacheChange();
      return data;
    })
    .finally(() => {
      if (inflight.get(ck) === promise) inflight.delete(ck);
    });

  inflight.set(ck, promise);
  return promise;
}

export function prefetchSummaryStats(key: SummaryStatsFetchKey): void {
  const ck = summaryStatsCacheKey(key);
  if (cache.has(ck) || inflight.has(ck)) return;
  void loadSummaryStats(key).catch(() => {
    // Prefetch failures are silent
  });
}

/** Warm other executive period pills for the current chart filters. */
export function prefetchSiblingPillSummaryStats(opts: {
  currentRange: DashboardRange;
  chartMode: string;
  annotationFilter: string;
}): void {
  const { currentRange, chartMode, annotationFilter } = opts;

  for (const kind of PERIOD_PILLS) {
    if (currentRange.kind === kind) continue;
    prefetchSummaryStats({
      dashboardRange: { kind },
      chartMode,
      annotationFilter,
    });
  }
}

export function scheduleSiblingPillSummaryPrefetch(
  opts: Parameters<typeof prefetchSiblingPillSummaryStats>[0],
): () => void {
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    prefetchSiblingPillSummaryStats(opts);
  };

  let idleId: number | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  if (typeof requestIdleCallback === "function") {
    idleId = requestIdleCallback(run, { timeout: 1500 });
  } else {
    timeoutId = setTimeout(run, 200);
  }

  return () => {
    cancelled = true;
    if (idleId !== undefined && typeof cancelIdleCallback === "function") {
      cancelIdleCallback(idleId);
    }
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  };
}

/** Hover/focus intent for one period pill. */
export function prefetchSummaryPill(
  kind: DashboardPill,
  opts: { chartMode: string; annotationFilter: string },
): void {
  prefetchSummaryStats({
    dashboardRange: { kind },
    chartMode: opts.chartMode,
    annotationFilter: opts.annotationFilter,
  });
}
