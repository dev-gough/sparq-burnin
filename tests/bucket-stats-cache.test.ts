import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bucketStatsCacheKey,
  getCachedBucketStats,
  loadBucketStats,
  prefetchBucketStats,
  prefetchSiblingPillBucketStats,
  resetBucketStatsCacheForTests,
  setCachedBucketStats,
  type BucketStatsFetchKey,
} from "@/lib/bucket-stats-cache";

const baseKey = (over: Partial<BucketStatsFetchKey> = {}): BucketStatsFetchKey => ({
  dashboardRange: { kind: "30d" },
  chartMode: "recent",
  annotationFilter: "all",
  bucket: "day",
  ...over,
});

describe("bucketStatsCacheKey", () => {
  it("ignores object identity and matches equivalent ranges", () => {
    const a = bucketStatsCacheKey(baseKey());
    const b = bucketStatsCacheKey(baseKey());
    expect(a).toBe(b);
  });

  it("differs by time range / bucket / mode / annotation", () => {
    const base = bucketStatsCacheKey(baseKey());
    expect(bucketStatsCacheKey(baseKey({ dashboardRange: { kind: "7d" } }))).not.toBe(
      base,
    );
    expect(bucketStatsCacheKey(baseKey({ bucket: "week" }))).not.toBe(base);
    expect(bucketStatsCacheKey(baseKey({ chartMode: "all" }))).not.toBe(base);
    expect(
      bucketStatsCacheKey(baseKey({ annotationFilter: "group:Other" })),
    ).not.toBe(base);
  });

  it("includes custom from/to", () => {
    const a = bucketStatsCacheKey(
      baseKey({
        dashboardRange: { kind: "custom", from: "2026-01-01", to: "2026-01-31" },
      }),
    );
    const b = bucketStatsCacheKey(
      baseKey({
        dashboardRange: { kind: "custom", from: "2026-01-01", to: "2026-02-01" },
      }),
    );
    expect(a).not.toBe(b);
  });
});

describe("loadBucketStats cache + dedupe", () => {
  beforeEach(() => {
    resetBucketStatsCacheForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => [
          { date: "2026-07-01", passed: 10, failed: 1, totalUnfiltered: 11, failedFiltered: 1 },
        ],
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetBucketStatsCacheForTests();
  });

  it("fetches once and returns cached data on second call", async () => {
    const key = baseKey();
    const a = await loadBucketStats(key);
    const b = await loadBucketStats(key);
    expect(a).toEqual(b);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(getCachedBucketStats(key)?.[0]?.passed).toBe(10);
  });

  it("dedupes concurrent callers (strip + volume same key)", async () => {
    let resolveJson!: (v: unknown) => void;
    const jsonPromise = new Promise((r) => {
      resolveJson = r;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: () => jsonPromise,
      })),
    );

    const key = baseKey();
    const p1 = loadBucketStats(key);
    const p2 = loadBucketStats(key);
    expect(fetch).toHaveBeenCalledTimes(1);

    resolveJson([
      { date: "2026-07-01", passed: 3, failed: 0, totalUnfiltered: 3, failedFiltered: 0 },
    ]);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
    expect(r1[0].passed).toBe(3);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("force bypasses cache and refreshes entry", async () => {
    const key = baseKey();
    setCachedBucketStats(key, [
      { date: "2026-07-01", passed: 1, failed: 0 },
    ]);
    const next = await loadBucketStats(key, { force: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(next[0].passed).toBe(10);
    expect(getCachedBucketStats(key)?.[0]?.passed).toBe(10);
  });

  it("builds expected query string", async () => {
    await loadBucketStats(
      baseKey({
        chartMode: "all",
        annotationFilter: "group:HW",
        bucket: "week",
        dashboardRange: { kind: "90d" },
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain("/api/test-stats?");
    expect(url).toContain("chartMode=all");
    expect(url).toContain("annotation=group%3AHW");
    expect(url).toContain("bucket=week");
    expect(url).toContain("timeRange=90d");
  });
});

describe("prefetchSiblingPillBucketStats", () => {
  beforeEach(() => {
    resetBucketStatsCacheForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => [
          {
            date: "2026-07-01",
            passed: 1,
            failed: 0,
            totalUnfiltered: 1,
            failedFiltered: 0,
            _url: url,
          },
        ],
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetBucketStatsCacheForTests();
  });

  it("prefetches other pills with the same volume bucket", async () => {
    prefetchSiblingPillBucketStats({
      currentRange: { kind: "30d" },
      chartMode: "recent",
      annotationFilter: "all",
      bucket: "day",
    });
    // 7d, 90d, all — not 30d
    expect(fetch).toHaveBeenCalledTimes(3);
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("timeRange=7d"))).toBe(true);
    expect(urls.some((u) => u.includes("timeRange=90d"))).toBe(true);
    expect(urls.some((u) => u.includes("timeRange=all"))).toBe(true);
    expect(urls.every((u) => u.includes("bucket=day"))).toBe(true);
    expect(urls.some((u) => u.includes("timeRange=30d"))).toBe(false);

    // let inflight settle
    await Promise.all(vi.mocked(fetch).mock.results.map((r) => r.value));
  });

  it("uses smart default bucket per pill for strip path", async () => {
    prefetchSiblingPillBucketStats({
      currentRange: { kind: "30d" },
      chartMode: "recent",
      annotationFilter: "all",
      bucket: "day",
      useSmartBucketPerPill: true,
    });
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    // 90d default = week, all default = month, 7d default = day
    expect(urls.find((u) => u.includes("timeRange=90d"))).toContain("bucket=week");
    expect(urls.find((u) => u.includes("timeRange=all"))).toContain("bucket=month");
    expect(urls.find((u) => u.includes("timeRange=7d"))).toContain("bucket=day");
    await Promise.all(vi.mocked(fetch).mock.results.map((r) => r.value));
  });

  it("prefetchBucketStats is a no-op when already cached", async () => {
    const key = baseKey({ dashboardRange: { kind: "7d" } });
    setCachedBucketStats(key, [{ date: "2026-07-01", passed: 2, failed: 0 }]);
    prefetchBucketStats(key);
    expect(fetch).not.toHaveBeenCalled();
  });
});
