/**
 * Size-capped in-memory cache for dashboard test-table payloads.
 *
 * Deliberately conservative: session memory only (not localStorage), few keys,
 * hard row caps so a wide all-time dump never balloons the tab.
 */

export type TestsTableRow = {
  test_id: number;
  inv_id: number;
  serial_number: string;
  firmware_version: string;
  duration: number;
  non_zero_status_flags: number;
  status: string;
  failure_reason: string | null;
  start_time: string;
  annotations: string | null;
};

export type TestsTableFetchKey = {
  latestOnly: boolean;
  annotationFilter: string;
  dateFrom: string;
  dateTo: string;
  /** Optional timeRange when dates empty (e.g. "all") — part of key for clarity */
  timeRange?: string;
};

/** Max distinct filter keys retained. */
const MAX_ENTRIES = 6;
/** Do not cache a single payload larger than this (rows). */
const MAX_ROWS_PER_ENTRY = 2000;
/** Soft cap on sum of cached rows; evict LRU until under. */
const MAX_TOTAL_ROWS = 5000;

type CacheEntry = {
  rows: TestsTableRow[];
  /** Monotonic touch for LRU. */
  touched: number;
};

const cache = new Map<string, CacheEntry>();
let touchSeq = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function subscribeTestsTableCache(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function testsTableCacheKey(key: TestsTableFetchKey): string {
  return JSON.stringify({
    latestOnly: key.latestOnly,
    annotation: key.annotationFilter || "all",
    dateFrom: key.dateFrom || "",
    dateTo: key.dateTo || "",
    timeRange: key.timeRange || "",
  });
}

function totalCachedRows(): number {
  let n = 0;
  for (const e of cache.values()) n += e.rows.length;
  return n;
}

function evictOldest(): boolean {
  let oldestKey: string | null = null;
  let oldestTouch = Infinity;
  for (const [k, e] of cache) {
    if (e.touched < oldestTouch) {
      oldestTouch = e.touched;
      oldestKey = k;
    }
  }
  if (!oldestKey) return false;
  cache.delete(oldestKey);
  return true;
}

export function getCachedTestsTable(
  key: TestsTableFetchKey,
): TestsTableRow[] | undefined {
  const ck = testsTableCacheKey(key);
  const hit = cache.get(ck);
  if (!hit) return undefined;
  hit.touched = ++touchSeq;
  return hit.rows;
}

/**
 * Store rows if under per-entry cap. Evicts LRU entries to respect
 * MAX_ENTRIES / MAX_TOTAL_ROWS. Oversized payloads are not cached.
 */
export function setCachedTestsTable(
  key: TestsTableFetchKey,
  rows: TestsTableRow[],
): boolean {
  if (rows.length > MAX_ROWS_PER_ENTRY) {
    return false;
  }
  if (rows.length > MAX_TOTAL_ROWS) {
    return false;
  }
  const ck = testsTableCacheKey(key);
  // Replace existing without double-counting toward budget
  if (cache.has(ck)) {
    cache.delete(ck);
  }
  while (
    cache.size > 0 &&
    (cache.size >= MAX_ENTRIES ||
      totalCachedRows() + rows.length > MAX_TOTAL_ROWS)
  ) {
    if (!evictOldest()) break;
  }
  if (totalCachedRows() + rows.length > MAX_TOTAL_ROWS) {
    return false;
  }

  cache.set(ck, { rows, touched: ++touchSeq });
  emit();
  return true;
}

export function invalidateTestsTableCache(): void {
  cache.clear();
  emit();
}

export function resetTestsTableCacheForTests(): void {
  cache.clear();
  touchSeq = 0;
  emit();
}

/** Test/diagnostics */
export function testsTableCacheStats(): {
  entries: number;
  totalRows: number;
} {
  return { entries: cache.size, totalRows: totalCachedRows() };
}

export const TESTS_TABLE_CACHE_LIMITS = {
  MAX_ENTRIES,
  MAX_ROWS_PER_ENTRY,
  MAX_TOTAL_ROWS,
} as const;
