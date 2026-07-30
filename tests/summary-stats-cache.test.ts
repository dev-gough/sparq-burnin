import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCachedSummaryStats,
  loadSummaryStats,
  prefetchSiblingPillSummaryStats,
  prefetchSummaryStats,
  resetSummaryStatsCacheForTests,
  setCachedSummaryStats,
  summaryStatsCacheKey,
  type SummaryStatsFetchKey,
} from "@/lib/summary-stats-cache";

const baseKey = (
  over: Partial<SummaryStatsFetchKey> = {},
): SummaryStatsFetchKey => ({
  dashboardRange: { kind: "30d" },
  chartMode: "recent",
  annotationFilter: "all",
  ...over,
});

const sampleEnvelope = {
  current: { total: 100, passed: 95, failed: 5, failureRate: 5 },
  previous: { total: 80, passed: 76, failed: 4, failureRate: 5 },
  delta: { total: 20, passed: 19, failed: 1, failureRatePp: 0 },
  labels: { current: "Last 30 days", previous: "Prior 30 days" },
  failurePercentageOfTotal: null,
};

describe("summaryStatsCacheKey", () => {
  it("differs by range / mode / annotation", () => {
    const base = summaryStatsCacheKey(baseKey());
    expect(
      summaryStatsCacheKey(baseKey({ dashboardRange: { kind: "7d" } })),
    ).not.toBe(base);
    expect(summaryStatsCacheKey(baseKey({ chartMode: "all" }))).not.toBe(base);
    expect(
      summaryStatsCacheKey(baseKey({ annotationFilter: "group:HW" })),
    ).not.toBe(base);
  });
});

describe("loadSummaryStats cache + dedupe", () => {
  beforeEach(() => {
    resetSummaryStatsCacheForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => sampleEnvelope,
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetSummaryStatsCacheForTests();
  });

  it("fetches once and serves cache on second call", async () => {
    const key = baseKey();
    const a = await loadSummaryStats(key);
    const b = await loadSummaryStats(key);
    expect(a.current.total).toBe(100);
    expect(b).toEqual(a);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent callers", async () => {
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
    const p1 = loadSummaryStats(key);
    const p2 = loadSummaryStats(key);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolveJson(sampleEnvelope);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1.current.failed).toBe(5);
    expect(r2).toEqual(r1);
  });

  it("normalizes flat summary responses into compare envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          total: 10,
          passed: 9,
          failed: 1,
          failureRate: 10,
        }),
      })),
    );
    const res = await loadSummaryStats(baseKey());
    expect(res.current.total).toBe(10);
    expect(res.previous).toBeNull();
    expect(res.delta).toBeNull();
  });

  it("builds compare=1 summary URL", async () => {
    await loadSummaryStats(
      baseKey({
        chartMode: "all",
        annotationFilter: "group:Other",
        dashboardRange: { kind: "90d" },
      }),
    );
    const url = String(vi.mocked(fetch).mock.calls[0][0]);
    expect(url).toContain("view=summary");
    expect(url).toContain("compare=1");
    expect(url).toContain("chartMode=all");
    expect(url).toContain("timeRange=90d");
    expect(url).toContain("annotation=group%3AOther");
  });

  it("force refreshes past a cache hit", async () => {
    const key = baseKey();
    setCachedSummaryStats(key, {
      ...sampleEnvelope,
      current: { total: 1, passed: 1, failed: 0, failureRate: 0 },
    });
    const next = await loadSummaryStats(key, { force: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(next.current.total).toBe(100);
  });
});

describe("prefetchSiblingPillSummaryStats", () => {
  beforeEach(() => {
    resetSummaryStatsCacheForTests();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => sampleEnvelope,
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetSummaryStatsCacheForTests();
  });

  it("prefetches other pills only", async () => {
    prefetchSiblingPillSummaryStats({
      currentRange: { kind: "30d" },
      chartMode: "recent",
      annotationFilter: "all",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    const urls = vi.mocked(fetch).mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("timeRange=7d"))).toBe(true);
    expect(urls.some((u) => u.includes("timeRange=90d"))).toBe(true);
    expect(urls.some((u) => u.includes("timeRange=all"))).toBe(true);
    expect(urls.every((u) => u.includes("view=summary"))).toBe(true);
    expect(urls.some((u) => u.includes("timeRange=30d"))).toBe(false);
    await Promise.all(vi.mocked(fetch).mock.results.map((r) => r.value));
  });

  it("prefetchSummaryStats is a no-op when cached", () => {
    const key = baseKey({ dashboardRange: { kind: "7d" } });
    setCachedSummaryStats(key, sampleEnvelope);
    prefetchSummaryStats(key);
    expect(fetch).not.toHaveBeenCalled();
    expect(getCachedSummaryStats(key)?.current.total).toBe(100);
  });
});
