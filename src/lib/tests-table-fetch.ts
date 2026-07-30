/**
 * Shared load helpers for the dashboard test table (network + caps).
 */

import {
  getCachedTestsTable,
  setCachedTestsTable,
  type TestsTableFetchKey,
  type TestsTableRow,
} from "@/lib/tests-table-cache";

/**
 * Bounded ranges: one shot up to this many rows (covers typical 7d–90d).
 * Unbounded (all-time / no dates): smaller first page then progressive.
 */
export const TESTS_TABLE_BOUNDED_LIMIT = 2500;
export const TESTS_TABLE_UNBOUNDED_FIRST = 500;
export const TESTS_TABLE_BATCH = 1000;

/** Quiet cancel when React effect cleanup aborts in-flight table loads. */
export function isAbortError(error: unknown): boolean {
  if (error == null || typeof error !== "object") return false;
  const e = error as { name?: string; message?: string };
  return (
    e.name === "AbortError" ||
    (typeof e.message === "string" &&
      e.message.includes("signal is aborted"))
  );
}

export function isBoundedTestsRange(key: Pick<
  TestsTableFetchKey,
  "dateFrom" | "dateTo" | "timeRange"
>): boolean {
  if (key.dateFrom || key.dateTo) return true;
  if (key.timeRange && key.timeRange !== "all" && key.timeRange !== "") {
    return true;
  }
  return false;
}

export function buildTestsTableUrl(
  key: TestsTableFetchKey,
  limit: number,
  offset: number,
): string {
  const params = new URLSearchParams({ view: "tests" });
  if (key.latestOnly) params.set("latestOnly", "true");
  if (key.annotationFilter && key.annotationFilter !== "all") {
    params.set("annotation", key.annotationFilter);
  }
  if (key.dateFrom) params.set("dateFrom", key.dateFrom);
  if (key.dateTo) params.set("dateTo", key.dateTo);
  if (key.timeRange && !key.dateFrom && !key.dateTo) {
    params.set("timeRange", key.timeRange);
  }
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return `/api/test-stats?${params}`;
}

async function fetchPage(
  key: TestsTableFetchKey,
  limit: number,
  offset: number,
  signal?: AbortSignal,
): Promise<TestsTableRow[]> {
  if (signal?.aborted) return [];
  try {
    const response = await fetch(buildTestsTableUrl(key, limit, offset), {
      signal,
    });
    if (signal?.aborted) return [];
    if (!response.ok) {
      throw new Error(`tests table HTTP ${response.status}`);
    }
    const json: unknown = await response.json();
    return Array.isArray(json) ? (json as TestsTableRow[]) : [];
  } catch (error) {
    // Effect cleanup aborts are expected — do not surface as runtime errors.
    if (signal?.aborted || isAbortError(error)) return [];
    throw error;
  }
}

/**
 * Load full table payload for a filter key.
 * - Cache hit → immediate
 * - Bounded range → single request (up to BOUNDED_LIMIT)
 * - Unbounded → first page then batches until short page
 *
 * Does not cache oversized final arrays (setCachedTestsTable enforces caps).
 */
export async function loadTestsTable(
  key: TestsTableFetchKey,
  opts?: { signal?: AbortSignal; force?: boolean },
): Promise<TestsTableRow[]> {
  if (!opts?.force) {
    const hit = getCachedTestsTable(key);
    if (hit) return hit;
  }

  const signal = opts?.signal;
  const bounded = isBoundedTestsRange(key);

  if (bounded) {
    const rows = await fetchPage(key, TESTS_TABLE_BOUNDED_LIMIT, 0, signal);
    setCachedTestsTable(key, rows);
    return rows;
  }

  // All-time / open range: progressive, then cache only if under cap
  const first = await fetchPage(
    key,
    TESTS_TABLE_UNBOUNDED_FIRST,
    0,
    signal,
  );
  let all = first;
  if (first.length === TESTS_TABLE_UNBOUNDED_FIRST) {
    let offset = first.length;
    for (;;) {
      if (signal?.aborted) break;
      const batch = await fetchPage(
        key,
        TESTS_TABLE_BATCH,
        offset,
        signal,
      );
      if (batch.length === 0) break;
      all = all.concat(batch);
      offset += batch.length;
      if (batch.length < TESTS_TABLE_BATCH) break;
      // Safety: stop progressive before multi‑10k browser freezes
      if (all.length >= 10000) break;
    }
  }

  setCachedTestsTable(key, all);
  return all;
}

/**
 * Progressive load with onChunk callback (for UI that wants first paint
 * before the full unbounded download finishes). Cache written at end.
 */
export async function loadTestsTableProgressive(
  key: TestsTableFetchKey,
  opts: {
    signal?: AbortSignal;
    force?: boolean;
    onChunk: (rows: TestsTableRow[], done: boolean) => void;
  },
): Promise<void> {
  if (!opts.force) {
    const hit = getCachedTestsTable(key);
    if (hit) {
      opts.onChunk(hit, true);
      return;
    }
  }

  const signal = opts.signal;
  const bounded = isBoundedTestsRange(key);

  if (bounded) {
    const rows = await fetchPage(key, TESTS_TABLE_BOUNDED_LIMIT, 0, signal);
    // fetchPage returns [] on abort — never treat that as a real empty window
    if (signal?.aborted) return;
    setCachedTestsTable(key, rows);
    opts.onChunk(rows, true);
    return;
  }

  const first = await fetchPage(
    key,
    TESTS_TABLE_UNBOUNDED_FIRST,
    0,
    signal,
  );
  if (signal?.aborted) return;
  let all = first;
  opts.onChunk(all, first.length < TESTS_TABLE_UNBOUNDED_FIRST);

  if (first.length < TESTS_TABLE_UNBOUNDED_FIRST) {
    setCachedTestsTable(key, all);
    return;
  }

  let offset = first.length;
  for (;;) {
    if (signal?.aborted) return;
    const batch = await fetchPage(key, TESTS_TABLE_BATCH, offset, signal);
    if (signal?.aborted) return;
    if (batch.length === 0) {
      setCachedTestsTable(key, all);
      opts.onChunk(all, true);
      return;
    }
    all = all.concat(batch);
    offset += batch.length;
    const done =
      batch.length < TESTS_TABLE_BATCH || all.length >= 10000;
    opts.onChunk(all, done);
    if (done) {
      setCachedTestsTable(key, all);
      return;
    }
  }
}
