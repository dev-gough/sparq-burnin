/**
 * Unit tests for UTC bucketRange / formatBucketLabel / parseUtcDateOnly.
 * Weeks are Mon–Sun (Postgres DATE_TRUNC('week') ISO); month/quarter ends inclusive.
 */
import { describe, it, expect } from "vitest";
import {
  bucketRange,
  formatBucketLabel,
  parseUtcDateOnly,
  defaultBucketForTimeRange,
} from "@/lib/chart-theme";

describe("parseUtcDateOnly", () => {
  it("parses as UTC midnight, not local", () => {
    const d = parseUtcDateOnly("2024-06-15");
    expect(d.toISOString()).toBe("2024-06-15T00:00:00.000Z");
    expect(d.getUTCFullYear()).toBe(2024);
    expect(d.getUTCMonth()).toBe(5);
    expect(d.getUTCDate()).toBe(15);
  });
});

describe("bucketRange", () => {
  it("day is a single-day inclusive range", () => {
    expect(bucketRange("2024-03-15", "day")).toEqual({
      from: "2024-03-15",
      to: "2024-03-15",
    });
  });

  it("week is Monday–Sunday inclusive (DATE_TRUNC week start)", () => {
    // 2024-01-01 is a Monday
    expect(bucketRange("2024-01-01", "week")).toEqual({
      from: "2024-01-01",
      to: "2024-01-07",
    });
    // 2024-07-08 is a Monday
    expect(bucketRange("2024-07-08", "week")).toEqual({
      from: "2024-07-08",
      to: "2024-07-14",
    });
  });

  it("month uses inclusive calendar month end", () => {
    expect(bucketRange("2024-01-01", "month")).toEqual({
      from: "2024-01-01",
      to: "2024-01-31",
    });
    expect(bucketRange("2024-04-01", "month")).toEqual({
      from: "2024-04-01",
      to: "2024-04-30",
    });
  });

  it("month handles leap-year February", () => {
    expect(bucketRange("2024-02-01", "month")).toEqual({
      from: "2024-02-01",
      to: "2024-02-29",
    });
    expect(bucketRange("2023-02-01", "month")).toEqual({
      from: "2023-02-01",
      to: "2023-02-28",
    });
  });

  it("quarter spans three months inclusive", () => {
    expect(bucketRange("2024-01-01", "quarter")).toEqual({
      from: "2024-01-01",
      to: "2024-03-31",
    });
    expect(bucketRange("2024-04-01", "quarter")).toEqual({
      from: "2024-04-01",
      to: "2024-06-30",
    });
    expect(bucketRange("2024-07-01", "quarter")).toEqual({
      from: "2024-07-01",
      to: "2024-09-30",
    });
    expect(bucketRange("2024-10-01", "quarter")).toEqual({
      from: "2024-10-01",
      to: "2024-12-31",
    });
  });

  it("year is Jan 1 – Dec 31 inclusive", () => {
    expect(bucketRange("2024-01-01", "year")).toEqual({
      from: "2024-01-01",
      to: "2024-12-31",
    });
    expect(bucketRange("2020-01-01", "year")).toEqual({
      from: "2020-01-01",
      to: "2020-12-31",
    });
  });
});

describe("formatBucketLabel", () => {
  it("formats day labels in UTC", () => {
    // 2024-01-15 UTC — must not shift calendar day via local TZ
    expect(formatBucketLabel("2024-01-15", "day")).toMatch(/Jan\s+15/);
    expect(formatBucketLabel("2024-01-15", "day", true)).toMatch(/2024/);
  });

  it("formats week as start date / Week of …", () => {
    expect(formatBucketLabel("2024-01-01", "week")).toMatch(/Jan\s+1/);
    expect(formatBucketLabel("2024-01-01", "week", true)).toMatch(
      /Week of.*2024/,
    );
  });

  it("formats month short and long", () => {
    expect(formatBucketLabel("2024-03-01", "month")).toMatch(/Mar.*'24/);
    expect(formatBucketLabel("2024-03-01", "month", true)).toMatch(
      /March.*2024/,
    );
  });

  it("formats quarter and year", () => {
    expect(formatBucketLabel("2024-01-01", "quarter")).toBe("Q1 '24");
    expect(formatBucketLabel("2024-07-01", "quarter", true)).toBe("Q3 2024");
    expect(formatBucketLabel("2024-01-01", "year")).toBe("2024");
  });
});

describe("defaultBucketForTimeRange", () => {
  it("maps period to smart defaults", () => {
    expect(defaultBucketForTimeRange("7d")).toBe("day");
    expect(defaultBucketForTimeRange("30d")).toBe("day");
    expect(defaultBucketForTimeRange("90d")).toBe("week");
    expect(defaultBucketForTimeRange("all")).toBe("month");
  });
});
