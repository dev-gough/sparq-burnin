import { describe, it, expect } from "vitest";
import {
  getCompareWindows,
  getCurrentWindow,
  buildWindowTimeFilter,
  previousAbsoluteWindow,
  inclusiveDayLength,
  parseYmdUtc,
  formatYmdUtc,
} from "@/lib/stats-windows";

describe("inclusiveDayLength / previousAbsoluteWindow", () => {
  it("counts inclusive calendar days", () => {
    expect(inclusiveDayLength("2024-01-11", "2024-01-20")).toBe(10);
    expect(inclusiveDayLength("2024-01-01", "2024-01-01")).toBe(1);
    expect(inclusiveDayLength("2024-02-28", "2024-03-01")).toBe(3); // leap year
  });

  it("computes equal-length prior window immediately before dateFrom", () => {
    // L=10: 2024-01-11..2024-01-20 → prior 2024-01-01..2024-01-10
    expect(previousAbsoluteWindow("2024-01-11", "2024-01-20")).toEqual({
      dateFrom: "2024-01-01",
      dateTo: "2024-01-10",
    });
  });

  it("handles single-day custom range", () => {
    expect(previousAbsoluteWindow("2024-06-15", "2024-06-15")).toEqual({
      dateFrom: "2024-06-14",
      dateTo: "2024-06-14",
    });
  });

  it("crosses month/year boundaries in UTC", () => {
    expect(previousAbsoluteWindow("2025-01-01", "2025-01-07")).toEqual({
      dateFrom: "2024-12-25",
      dateTo: "2024-12-31",
    });
  });
});

describe("parseYmdUtc / formatYmdUtc", () => {
  it("round-trips UTC midnight", () => {
    const d = parseYmdUtc("2024-07-04");
    expect(d.toISOString()).toBe("2024-07-04T00:00:00.000Z");
    expect(formatYmdUtc(d)).toBe("2024-07-04");
  });
});

describe("getCompareWindows", () => {
  it("returns null for all / missing range", () => {
    expect(
      getCompareWindows({ timeRange: "all", dateFrom: null, dateTo: null })
    ).toBeNull();
    expect(
      getCompareWindows({ timeRange: null, dateFrom: null, dateTo: null })
    ).toBeNull();
  });

  it("returns null for open-ended custom (only one bound)", () => {
    expect(
      getCompareWindows({
        timeRange: "30d",
        dateFrom: "2024-01-01",
        dateTo: null,
      })
    ).toBeNull();
    expect(
      getCompareWindows({
        timeRange: null,
        dateFrom: null,
        dateTo: "2024-01-31",
      })
    ).toBeNull();
  });

  it("builds 7d/30d/90d relative windows with half-open previous", () => {
    for (const [range, days] of [
      ["7d", 7],
      ["30d", 30],
      ["90d", 90],
    ] as const) {
      const w = getCompareWindows({
        timeRange: range,
        dateFrom: null,
        dateTo: null,
      });
      expect(w).not.toBeNull();
      expect(w!.current).toEqual({ type: "relative_open", days });
      expect(w!.previous).toEqual({
        type: "relative_half_open",
        startDaysAgo: days * 2,
        endDaysAgo: days,
      });
      expect(w!.labels).toEqual({
        current: `Last ${days} days`,
        previous: `Prior ${days} days`,
      });
    }
  });

  it("prefers custom dates over timeRange", () => {
    const w = getCompareWindows({
      timeRange: "30d",
      dateFrom: "2024-01-11",
      dateTo: "2024-01-20",
    });
    expect(w).not.toBeNull();
    expect(w!.current).toEqual({
      type: "absolute",
      dateFrom: "2024-01-11",
      dateTo: "2024-01-20",
    });
    expect(w!.previous).toEqual({
      type: "absolute",
      dateFrom: "2024-01-01",
      dateTo: "2024-01-10",
    });
    expect(w!.labels.current).toBe("2024-01-11 – 2024-01-20");
    expect(w!.labels.previous).toBe("2024-01-01 – 2024-01-10");
  });
});

describe("getCurrentWindow", () => {
  it("matches relative_open for fixed ranges", () => {
    expect(
      getCurrentWindow({ timeRange: "30d", dateFrom: null, dateTo: null })
    ).toEqual({ type: "relative_open", days: 30 });
  });

  it("returns none for all", () => {
    expect(
      getCurrentWindow({ timeRange: "all", dateFrom: null, dateTo: null })
    ).toEqual({ type: "none" });
  });

  it("returns absolute for custom dates", () => {
    expect(
      getCurrentWindow({
        timeRange: "7d",
        dateFrom: "2024-01-01",
        dateTo: "2024-01-15",
      })
    ).toEqual({
      type: "absolute",
      dateFrom: "2024-01-01",
      dateTo: "2024-01-15",
    });
  });
});

describe("buildWindowTimeFilter", () => {
  const col = "t.start_time_utc";

  it("relative_open uses CURRENT_DATE - N days", () => {
    const { sql, params } = buildWindowTimeFilter(
      { type: "relative_open", days: 30 },
      col,
      1
    );
    expect(sql).toBe(
      "t.start_time_utc >= CURRENT_DATE - INTERVAL '30 days'"
    );
    expect(params).toEqual([]);
  });

  it("relative_half_open is half-open previous window", () => {
    const { sql, params } = buildWindowTimeFilter(
      { type: "relative_half_open", startDaysAgo: 60, endDaysAgo: 30 },
      col,
      1
    );
    expect(sql).toBe(
      "t.start_time_utc >= CURRENT_DATE - INTERVAL '60 days' AND t.start_time_utc < CURRENT_DATE - INTERVAL '30 days'"
    );
    expect(params).toEqual([]);
  });

  it("absolute uses inclusive end predicate and params", () => {
    const { sql, params } = buildWindowTimeFilter(
      {
        type: "absolute",
        dateFrom: "2024-01-01",
        dateTo: "2024-01-31",
      },
      col,
      1
    );
    expect(sql).toBe(
      "t.start_time_utc >= $1::date AND t.start_time_utc <= $2::date + INTERVAL '1 day' - INTERVAL '1 second'"
    );
    expect(params).toEqual(["2024-01-01", "2024-01-31"]);
  });

  it("absolute with only dateFrom", () => {
    const { sql, params } = buildWindowTimeFilter(
      { type: "absolute", dateFrom: "2024-01-01", dateTo: null },
      col,
      3
    );
    expect(sql).toBe("t.start_time_utc >= $3::date");
    expect(params).toEqual(["2024-01-01"]);
  });

  it("none yields empty filter", () => {
    expect(
      buildWindowTimeFilter({ type: "none" }, col, 1)
    ).toEqual({ sql: "", params: [] });
  });
});
