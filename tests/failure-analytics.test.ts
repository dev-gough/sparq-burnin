import { describe, expect, it } from "vitest";
import { groupFailureTimeline, weightedFailureAverage, formatFailureBucket, rollingTestFailureRates } from "@/lib/failure-analytics";

describe("failure analytics aggregation", () => {
  it("preserves every count when rolling daily data into weekly buckets across a year boundary", () => {
    const grouped = groupFailureTimeline([
      { date: "2025-12-31", total: 100, passed: 99, failed: 1 },
      { date: "2026-01-01", total: 10, passed: 8, failed: 2 },
      { date: "2026-01-05", total: 20, passed: 20, failed: 0 },
    ], "weekly");
    expect(grouped).toEqual([
      { date: "2025-12-29", total: 110, passed: 107, failed: 3 },
      { date: "2026-01-05", total: 20, passed: 20, failed: 0 },
    ]);
  });
  it("weights the moving average by volume rather than averaging percentages", () => {
    const average = weightedFailureAverage([100, 10, 1000], [1, 5, 0], 3);
    expect(average.slice(0, 2)).toEqual([null, null]);
    expect(average[2]).toBeCloseTo(6 / 1110 * 100);
  });
  it("keeps fortnight buckets stable across years", () => {
    const grouped = groupFailureTimeline([{ date: "2025-12-31", faults: 2 }, { date: "2026-01-01", faults: 3 }], "biweekly");
    expect(grouped).toHaveLength(1);
    expect(grouped[0].faults).toBe(5);
    expect(new Date(`${grouped[0].date}T00:00:00Z`).getUTCDay()).toBe(1);
  });
  it("sorts daily data without mutating the supplied points", () => {
    const points = [{ date: "2026-01-02", faults: 1 }, { date: "2026-01-01", faults: 2 }];
    const grouped = groupFailureTimeline(points, "daily");
    expect(grouped.map(point => point.date)).toEqual(["2026-01-01", "2026-01-02"]);
    expect(points[0].date).toBe("2026-01-02");
  });
  it("uses UTC for month and quarter labels", () => {
    expect(formatFailureBucket("2026-01-01", "quarterly")).toBe("Q1 2026");
    expect(formatFailureBucket("2026-10-01", "quarterly")).toBe("Q4 2026");
  });
});


describe("test-count sliding windows", () => {
  it("uses the exact trailing test outcomes, dropping the oldest outcome each time", () => {
    const points = rollingTestFailureRates("PFPFFP", 3);
    expect(points.map(point => point[0])).toEqual([3, 4, 5, 6]);
    expect(points[0][1]).toBeCloseTo(100 / 3);
    points.slice(1).forEach(point => expect(point[1]).toBeCloseTo(200 / 3));
  });
  it("does not invent smaller samples before the complete window is available", () => {
    expect(rollingTestFailureRates("PPF", 100)).toEqual([]);
    const points = rollingTestFailureRates("PPF", 3);
    expect(points).toHaveLength(1);
    expect(points[0][0]).toBe(3);
    expect(points[0][1]).toBeCloseTo(100 / 3);
  });
  it("shows a zero failure rate for complete passing windows", () => {
    expect(rollingTestFailureRates("PPPP", 2)).toEqual([[2, 0], [3, 0], [4, 0]]);
  });
  it.each([1000, 2000])("supports a %i-test window without changing its sample size", (window) => {
    const points = rollingTestFailureRates("F" + "P".repeat(window - 1) + "F", window);
    expect(points.map(point => point[0])).toEqual([window, window + 1]);
    points.forEach(point => expect(point[1]).toBeCloseTo(100 / window));
  });
  it("handles empty and invalid windows", () => {
    expect(rollingTestFailureRates("", 100)).toEqual([]);
    expect(rollingTestFailureRates("PP", 0)).toEqual([]);
    expect(rollingTestFailureRates("PP", 1.5)).toEqual([]);
  });
});
