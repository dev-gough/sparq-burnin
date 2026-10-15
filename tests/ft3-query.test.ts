import { describe, expect, it } from "vitest";
import { buildFt3ListQuery } from "@/lib/ft3-query";

const build = (q: string) => buildFt3ListQuery(new URLSearchParams(q));

describe("buildFt3ListQuery", () => {
  it("rejects invalid filters before building SQL", () => {
    expect(() => build("verdict=maybe")).toThrow(/verdict/);
    expect(() => build("page=0")).toThrow(/page/);
    expect(() => build("dateFrom=2026-02-30")).toThrow();
    expect(() => build(`serial=${"1".repeat(51)}`)).toThrow(/too long/);
    expect(() => build("verdict=other")).toThrow(/verdict/);
    expect(() => build("step=Coffee")).toThrow(/step/);
  });

  it("binds the search and verdict instead of interpolating them", () => {
    const { sql, values } = build("serial=1908_26%&verdict=FAIL&page=2");
    expect(values).toEqual(["%1908\\_26\\%%", "FAIL", 50, 50, 2]);
    expect(sql).not.toContain("1908");
  });

  it("filters runs by the subtest that failed", () => {
    const { sql, values } = build("step=MPPT");
    expect(values[0]).toBe("MPPT");
    expect(sql).toContain("failed_step = $1");
  });

  it("filters the period on UTC test days", () => {
    const { values, sql } = build("dateFrom=2026-10-01&dateTo=2026-10-15");
    expect(values.slice(0, 2)).toEqual(["2026-10-01", "2026-10-15"]);
    expect(sql).toContain("(test_time_utc AT TIME ZONE 'UTC') >= $1::date");
  });
});
