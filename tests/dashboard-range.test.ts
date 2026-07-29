import { describe, expect, it, vi, afterEach } from "vitest";
import {
  dashboardRangeToApiParams,
  defaultBucketForDashboardRange,
  exportTimeRange,
  resolveLinkedInitState,
  tableDatesForPill,
  todoHrefFromDashboardRange,
  utcDaysAgoYmd,
  utcTodayYmd,
} from "@/lib/dashboard-range";
import {
  hasStripFields,
  volumeSeriesFromBuckets,
  type BucketStats,
} from "@/hooks/useBucketStats";

describe("tableDatesForPill", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns empty span for all", () => {
    expect(tableDatesForPill("all")).toEqual({ from: "", to: "" });
  });

  it("returns N-day UTC window ending today for 7d/30d/90d", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T15:00:00Z"));
    expect(tableDatesForPill("7d")).toEqual({
      from: "2026-07-21",
      to: "2026-07-28",
    });
    expect(tableDatesForPill("30d")).toEqual({
      from: "2026-06-28",
      to: "2026-07-28",
    });
    expect(tableDatesForPill("90d")).toEqual({
      from: "2026-04-29",
      to: "2026-07-28",
    });
  });
});

describe("dashboardRangeToApiParams", () => {
  it("maps pill kinds to timeRange", () => {
    expect(dashboardRangeToApiParams({ kind: "30d" })).toEqual({
      timeRange: "30d",
    });
    expect(dashboardRangeToApiParams({ kind: "all" })).toEqual({
      timeRange: "all",
    });
  });

  it("maps custom to dateFrom/dateTo", () => {
    expect(
      dashboardRangeToApiParams({
        kind: "custom",
        from: "2026-01-01",
        to: "2026-01-31",
      }),
    ).toEqual({ dateFrom: "2026-01-01", dateTo: "2026-01-31" });
  });
});

describe("todoHrefFromDashboardRange", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses custom from/to", () => {
    expect(
      todoHrefFromDashboardRange({
        kind: "custom",
        from: "2026-01-01",
        to: "2026-01-31",
      }),
    ).toBe("/todo?dateFrom=2026-01-01&dateTo=2026-01-31");
  });

  it("all-time has no query params", () => {
    expect(todoHrefFromDashboardRange({ kind: "all" })).toBe("/todo");
  });

  it("rolling pills map to UTC window ending today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T15:00:00Z"));
    expect(todoHrefFromDashboardRange({ kind: "30d" })).toBe(
      "/todo?dateFrom=2026-06-28&dateTo=2026-07-28",
    );
    expect(todoHrefFromDashboardRange({ kind: "7d" })).toBe(
      "/todo?dateFrom=2026-07-21&dateTo=2026-07-28",
    );
  });
});

describe("defaultBucketForDashboardRange", () => {
  it("uses day for 7d/30d, week for 90d, month for all", () => {
    expect(defaultBucketForDashboardRange({ kind: "7d" })).toBe("day");
    expect(defaultBucketForDashboardRange({ kind: "30d" })).toBe("day");
    expect(defaultBucketForDashboardRange({ kind: "90d" })).toBe("week");
    expect(defaultBucketForDashboardRange({ kind: "all" })).toBe("month");
  });

  it("picks grain by custom span length", () => {
    expect(
      defaultBucketForDashboardRange({
        kind: "custom",
        from: "2026-07-01",
        to: "2026-07-10",
      }),
    ).toBe("day");
    expect(
      defaultBucketForDashboardRange({
        kind: "custom",
        from: "2026-01-01",
        to: "2026-05-01",
      }),
    ).toBe("week");
  });
});

describe("exportTimeRange", () => {
  it("returns null for custom, pill kind otherwise", () => {
    expect(exportTimeRange({ kind: "custom", from: "a", to: "b" })).toBeNull();
    expect(exportTimeRange({ kind: "7d" })).toBe("7d");
  });
});

describe("resolveLinkedInitState", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("promotes cookie dates to custom when both present", () => {
    const state = resolveLinkedInitState("2026-01-01", "2026-01-15");
    expect(state.dashboardRange).toEqual({
      kind: "custom",
      from: "2026-01-01",
      to: "2026-01-15",
    });
    expect(state.tableDateFrom).toBe("2026-01-01");
    expect(state.tableDateTo).toBe("2026-01-15");
    expect(state.lastPill).toBe("30d");
  });

  it("uses default pill span when cookie empty", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T12:00:00Z"));
    const state = resolveLinkedInitState("", "");
    expect(state.dashboardRange).toEqual({ kind: "30d" });
    expect(state.tableDateFrom).toBe(utcDaysAgoYmd(30));
    expect(state.tableDateTo).toBe(utcTodayYmd());
  });

  it("ignores partial cookie dates (from only)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T12:00:00Z"));
    const state = resolveLinkedInitState("2026-01-01", "");
    expect(state.dashboardRange).toEqual({ kind: "30d" });
    expect(state.tableDateFrom).toBe(tableDatesForPill("30d").from);
  });
});

describe("volumeSeriesFromBuckets / hasStripFields", () => {
  const mixed: BucketStats[] = [
    {
      date: "2026-07-01",
      passed: 10,
      failed: 1,
      totalUnfiltered: 12,
      failedFiltered: 1,
    },
    {
      date: "2026-07-02",
      passed: 0,
      failed: 0,
      totalUnfiltered: 5,
      failedFiltered: 0,
    },
  ];

  it("filters strip-only zero volume buckets", () => {
    expect(volumeSeriesFromBuckets(mixed)).toHaveLength(1);
    expect(volumeSeriesFromBuckets(mixed)[0].date).toBe("2026-07-01");
  });

  it("detects strip fields presence", () => {
    expect(hasStripFields(mixed)).toBe(true);
    expect(
      hasStripFields([{ date: "x", passed: 1, failed: 0 }]),
    ).toBe(false);
    expect(hasStripFields([])).toBe(true);
  });
});
