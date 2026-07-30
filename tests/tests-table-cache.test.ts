import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCachedTestsTable,
  resetTestsTableCacheForTests,
  setCachedTestsTable,
  testsTableCacheKey,
  testsTableCacheStats,
  TESTS_TABLE_CACHE_LIMITS,
  type TestsTableFetchKey,
  type TestsTableRow,
} from "@/lib/tests-table-cache";
import {
  buildTestsTableUrl,
  isBoundedTestsRange,
  loadTestsTable,
  TESTS_TABLE_BOUNDED_LIMIT,
} from "@/lib/tests-table-fetch";

function row(id: number): TestsTableRow {
  return {
    test_id: id,
    inv_id: id,
    serial_number: `S${id}`,
    firmware_version: "1.0",
    duration: 1000,
    non_zero_status_flags: 0,
    status: "PASS",
    failure_reason: null,
    start_time: "2026-07-01T00:00:00.000Z",
    annotations: null,
  };
}

const key = (over: Partial<TestsTableFetchKey> = {}): TestsTableFetchKey => ({
  latestOnly: false,
  annotationFilter: "all",
  dateFrom: "2026-07-01",
  dateTo: "2026-07-30",
  ...over,
});

describe("testsTableCacheKey / bounds", () => {
  it("isBounded for date range or fixed timeRange", () => {
    expect(isBoundedTestsRange(key())).toBe(true);
    expect(
      isBoundedTestsRange({
        dateFrom: "",
        dateTo: "",
        timeRange: "30d",
      }),
    ).toBe(true);
    expect(
      isBoundedTestsRange({
        dateFrom: "",
        dateTo: "",
        timeRange: "all",
      }),
    ).toBe(false);
  });

  it("buildTestsTableUrl includes range + page params", () => {
    const url = buildTestsTableUrl(key({ latestOnly: true }), 100, 0);
    expect(url).toContain("view=tests");
    expect(url).toContain("latestOnly=true");
    expect(url).toContain("dateFrom=2026-07-01");
    expect(url).toContain("dateTo=2026-07-30");
    expect(url).toContain("limit=100");
    expect(url).toContain("offset=0");
  });
});

describe("tests table cache caps", () => {
  beforeEach(() => {
    resetTestsTableCacheForTests();
  });

  afterEach(() => {
    resetTestsTableCacheForTests();
  });

  it("stores and returns a modest payload", () => {
    const k = key();
    const rows = [row(1), row(2)];
    expect(setCachedTestsTable(k, rows)).toBe(true);
    expect(getCachedTestsTable(k)).toEqual(rows);
  });

  it("refuses oversized single payloads", () => {
    const k = key();
    const big = Array.from(
      { length: TESTS_TABLE_CACHE_LIMITS.MAX_ROWS_PER_ENTRY + 1 },
      (_, i) => row(i + 1),
    );
    expect(setCachedTestsTable(k, big)).toBe(false);
    expect(getCachedTestsTable(k)).toBeUndefined();
  });

  it("evicts LRU when entry cap exceeded", () => {
    for (let i = 0; i < TESTS_TABLE_CACHE_LIMITS.MAX_ENTRIES; i++) {
      setCachedTestsTable(
        key({ dateFrom: `2026-0${i + 1}-01`, dateTo: `2026-0${i + 1}-28` }),
        [row(i)],
      );
    }
    expect(testsTableCacheStats().entries).toBe(
      TESTS_TABLE_CACHE_LIMITS.MAX_ENTRIES,
    );
    // Touch first key so it is not LRU
    const keep = key({ dateFrom: "2026-01-01", dateTo: "2026-01-28" });
    getCachedTestsTable(keep);

    setCachedTestsTable(
      key({ dateFrom: "2026-08-01", dateTo: "2026-08-28" }),
      [row(99)],
    );
    expect(testsTableCacheStats().entries).toBe(
      TESTS_TABLE_CACHE_LIMITS.MAX_ENTRIES,
    );
    // Oldest untouched among the initial set should be gone (2026-02…)
    expect(
      getCachedTestsTable(
        key({ dateFrom: "2026-02-01", dateTo: "2026-02-28" }),
      ),
    ).toBeUndefined();
    expect(getCachedTestsTable(keep)?.[0]?.test_id).toBe(0);
  });

  it("keys differ by latestOnly / annotation / dates", () => {
    const a = testsTableCacheKey(key());
    expect(testsTableCacheKey(key({ latestOnly: true }))).not.toBe(a);
    expect(
      testsTableCacheKey(key({ annotationFilter: "group:HW" })),
    ).not.toBe(a);
  });
});

describe("loadTestsTable", () => {
  beforeEach(() => {
    resetTestsTableCacheForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => {
          // return 3 rows for any page
          return [row(1), row(2), row(3)];
        },
        _url: url,
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetTestsTableCacheForTests();
  });

  it("bounded range uses a single request and caches", async () => {
    const k = key();
    const rows = await loadTestsTable(k);
    expect(rows).toHaveLength(3);
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain(`limit=${TESTS_TABLE_BOUNDED_LIMIT}`);
    expect(url).toContain("offset=0");
    // second call is cache-only
    await loadTestsTable(k);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
