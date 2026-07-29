import { describe, it, expect } from "vitest";
import {
  fillContinuousDayBuckets,
  hasDayAxisGaps,
  shouldFillContinuousDays,
  type BucketStats,
} from "@/hooks/useBucketStats";

const sample: BucketStats[] = [
  { date: "2026-07-03", passed: 48, failed: 0 },
  { date: "2026-07-04", passed: 45, failed: 2 },
  { date: "2026-07-08", passed: 90, failed: 1 },
];

describe("shouldFillContinuousDays", () => {
  it("fills day bucket for 30d", () => {
    expect(shouldFillContinuousDays({ kind: "30d" }, "day")).toBe(true);
  });

  it("does not fill week/month or all-time", () => {
    expect(shouldFillContinuousDays({ kind: "30d" }, "week")).toBe(false);
    expect(shouldFillContinuousDays({ kind: "all" }, "day")).toBe(false);
  });
});

describe("fillContinuousDayBuckets", () => {
  it("returns empty input unchanged", () => {
    expect(
      fillContinuousDayBuckets([], { kind: "30d" }, "day"),
    ).toEqual([]);
  });

  it("fills gaps for custom day range", () => {
    const filled = fillContinuousDayBuckets(
      sample,
      { kind: "custom", from: "2026-07-03", to: "2026-07-08" },
      "day",
    );
    expect(filled).toHaveLength(6); // 3..8 inclusive
    expect(filled.map((r) => r.date)).toEqual([
      "2026-07-03",
      "2026-07-04",
      "2026-07-05",
      "2026-07-06",
      "2026-07-07",
      "2026-07-08",
    ]);
    // Gap day is zero
    expect(filled[2]).toMatchObject({
      date: "2026-07-05",
      passed: 0,
      failed: 0,
    });
    // Existing day preserved
    expect(filled[1].failed).toBe(2);
  });

  it("no-ops for week bucket", () => {
    expect(
      fillContinuousDayBuckets(sample, { kind: "30d" }, "week"),
    ).toEqual(sample);
  });
});

describe("hasDayAxisGaps", () => {
  it("detects non-consecutive days", () => {
    expect(hasDayAxisGaps(sample)).toBe(true);
  });

  it("false for consecutive", () => {
    expect(
      hasDayAxisGaps([
        { date: "2026-07-01", passed: 1, failed: 0 },
        { date: "2026-07-02", passed: 1, failed: 0 },
      ]),
    ).toBe(false);
  });
});
