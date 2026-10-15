import { describe, expect, it } from "vitest";
import { ft3Buckets } from "@/components/ft3/ft3-trend-chart";

describe("ft3Buckets", () => {
  it("fills every UTC day in the period so quiet days show as gaps", () => {
    const { buckets, weekly } = ft3Buckets([{ day: "2026-10-03", passed: 2, failed: 1 }], "2026-10-01", "2026-10-04");
    expect(weekly).toBe(false);
    expect(buckets.map(b => [b.start, b.passed, b.failed])).toEqual([
      ["2026-10-01", 0, 0], ["2026-10-02", 0, 0], ["2026-10-03", 2, 1], ["2026-10-04", 0, 0],
    ]);
  });

  it("groups long periods into Monday-start weeks", () => {
    const { buckets, weekly } = ft3Buckets([
      { day: "2026-06-03", passed: 1, failed: 0 }, { day: "2026-06-07", passed: 2, failed: 1 }, { day: "2026-06-08", passed: 4, failed: 0 },
    ], "2026-06-01", "2026-10-15");
    expect(weekly).toBe(true);
    expect(buckets[0]).toMatchObject({ start: "2026-06-01", passed: 3, failed: 1 });
    expect(buckets[1]).toMatchObject({ start: "2026-06-08", passed: 4, failed: 0 });
  });

  it("starts all-time ranges at the first run", () => {
    const { buckets } = ft3Buckets([{ day: "2026-10-14", passed: 1, failed: 0 }], null, "2026-10-15");
    expect(buckets.map(b => b.start)).toEqual(["2026-10-14", "2026-10-15"]);
  });
});
