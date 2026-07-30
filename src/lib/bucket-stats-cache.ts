/**
 * Shared client cache + in-flight dedupe for bucketed test-stats series.
 *
 * Used by failure-over-time strip and volume chart so:
 * - identical concurrent requests share one network call
 * - revisiting a period/mode/annotation/bucket key paints from cache
 * - sibling period pills can be prefetched after the first load
 */

import {
  appendDashboardRangeParams,
  defaultBucketForDashboardRange,
  type DashboardPill,
  type DashboardRange,
} from "@/lib/dashboard-range";
import type { ChartBucket } from "@/lib/chart-theme";

export interface BucketStatsRow {
  date: string;
  passed: number;
  failed: number;
  totalUnfiltered?: number;
  failedFiltered?: number;
}

export type BucketStatsFetchKey = {
  dashboardRange: DashboardRange;
  chartMode: string;
  annotationFilter: string;
  bucket: ChartBucket;
};

const PERIOD_PILLS: DashboardPill[] = ["7d", "30d", "90d", "all"];

const cache = new Map<string, BucketStatsRow[]>();
const inflight = new Map<string, Promise<BucketStatsRow[]>>();

/** Listeners for useSyncExternalStore — notified on any cache mutation. */
const listeners = new Set<() => void>();

function emitCacheChange(): void {
  for (const listener of listeners) listener();
}

/**
 * Subscribe to cache writes (for useSyncExternalStore).
 * Any set/invalidate notifies all subscribers; hooks re-read their key.
 */
export function subscribeBucketStatsCache(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

/** Stable cache key (no requestEpoch — epoch is for subscriber identity only). */
export function bucketStatsCacheKey(key: BucketStatsFetchKey): string {
  const { dashboardRange, chartMode, annotationFilter, bucket } = key;
  return JSON.stringify({
    chartMode,
    annotationFilter,
    bucket,
    kind: dashboardRange.kind,
    from: dashboardRange.kind === "custom" ? dashboardRange.from : null,
    to: dashboardRange.kind === "custom" ? dashboardRange.to : null,
  });
}

export function getCachedBucketStats(
  key: BucketStatsFetchKey,
): BucketStatsRow[] | undefined {
  return cache.get(bucketStatsCacheKey(key));
}

export function setCachedBucketStats(
  key: BucketStatsFetchKey,
  data: BucketStatsRow[],
): void {
  cache.set(bucketStatsCacheKey(key), data);
  emitCacheChange();
}

/** Drop all cached series (e.g. hard refresh). In-flight promises still settle into cache. */
export function invalidateBucketStatsCache(): void {
  cache.clear();
  emitCacheChange();
}

/** Test helper: wipe cache + in-flight map. */
export function resetBucketStatsCacheForTests(): void {
  cache.clear();
  inflight.clear();
  emitCacheChange();
}

function buildStatsUrl(key: BucketStatsFetchKey): string {
  const params = new URLSearchParams({
    chartMode: key.chartMode,
    annotation: key.annotationFilter,
    bucket: key.bucket,
  });
  appendDashboardRangeParams(params, key.dashboardRange);
  return `/api/test-stats?${params}`;
}

async function fetchBucketStatsNetwork(
  key: BucketStatsFetchKey,
): Promise<BucketStatsRow[]> {
  const response = await fetch(buildStatsUrl(key));
  if (!response.ok) {
    throw new Error(`bucket stats HTTP ${response.status}`);
  }
  const json: unknown = await response.json();
  return Array.isArray(json) ? (json as BucketStatsRow[]) : [];
}

/**
 * Load bucket series: cache hit → resolve immediately; concurrent callers
 * share one in-flight promise; miss → network then cache.
 *
 * No AbortSignal on the shared fetch — subscribers drop stale results via
 * their own request-key checks after await (aborting would cancel siblings).
 */
export function loadBucketStats(
  key: BucketStatsFetchKey,
  opts?: { force?: boolean },
): Promise<BucketStatsRow[]> {
  const ck = bucketStatsCacheKey(key);
  const force = opts?.force === true;

  if (!force) {
    const hit = cache.get(ck);
    if (hit !== undefined) return Promise.resolve(hit);
    const pending = inflight.get(ck);
    if (pending) return pending;
  }

  const promise = fetchBucketStatsNetwork(key)
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

/** Fire-and-forget warm of one key (no-op if already cached or in flight). */
export function prefetchBucketStats(key: BucketStatsFetchKey): void {
  const ck = bucketStatsCacheKey(key);
  if (cache.has(ck) || inflight.has(ck)) return;
  void loadBucketStats(key).catch(() => {
    // Prefetch failures are silent; live requests will surface errors.
  });
}

/**
 * Warm the other executive period pills for the current chart filters.
 *
 * - Volume path: same user-selected `bucket` on every pill
 * - Strip path: per-pill smart default via `useSmartBucketPerPill`
 */
export function prefetchSiblingPillBucketStats(opts: {
  currentRange: DashboardRange;
  chartMode: string;
  annotationFilter: string;
  /** Bucket used for the current request (fallback when not smart-per-pill). */
  bucket: ChartBucket;
  /**
   * When true, each sibling uses `defaultBucketForDashboardRange(pill)`
   * (failure-rate strip). When false, every sibling uses `bucket` (volume).
   */
  useSmartBucketPerPill?: boolean;
}): void {
  const {
    currentRange,
    chartMode,
    annotationFilter,
    bucket,
    useSmartBucketPerPill = false,
  } = opts;

  for (const kind of PERIOD_PILLS) {
    const range: DashboardRange = { kind };
    const nextBucket = useSmartBucketPerPill
      ? defaultBucketForDashboardRange(range)
      : bucket;

    // Skip the exact key already loaded for the current view
    if (
      currentRange.kind === kind &&
      (useSmartBucketPerPill
        ? nextBucket === defaultBucketForDashboardRange(currentRange)
        : nextBucket === bucket)
    ) {
      continue;
    }

    prefetchBucketStats({
      dashboardRange: range,
      chartMode,
      annotationFilter,
      bucket: nextBucket,
    });
  }
}

/** Schedule sibling prefetch after paint (idle when available). */
export function scheduleSiblingPillPrefetch(
  opts: Parameters<typeof prefetchSiblingPillBucketStats>[0],
): () => void {
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    prefetchSiblingPillBucketStats(opts);
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
