import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { failureChartEmptyState } from "@/lib/failure-chart-state";
import { FailureChartPanel } from "@/components/dashboard/failure-chart-panel";

const recordedFailures = { totalTests: 706, totalFailedTests: 6 };

describe("failure analytics empty states", () => {
  it("distinguishes an empty test period from a period with passing tests", () => {
    const noTests = failureChartEmptyState({ hasData: false, totalTests: 0, totalFailedTests: 0, breakdown: "category" });
    const passingTests = failureChartEmptyState({ hasData: false, totalTests: 706, totalFailedTests: 0, breakdown: "category" });
    expect(noTests?.heading).toBe("No tests in this range");
    expect(passingTests?.heading).toBe("No failures in this range");
  });

  it.each(["category", "group"] as const)("does not claim there are no failures when %s annotations are missing", (breakdown) => {
    const emptyState = failureChartEmptyState({ ...recordedFailures, hasData: false, breakdown });
    expect(emptyState?.heading).not.toBe("No failures in this range");
    expect(emptyState?.description).toContain("Failed tests were recorded");
  });

  it("keeps a failure-rate chart with zero failed tests visible", () => {
    expect(failureChartEmptyState({ hasData: true, totalTests: 706, totalFailedTests: 0, breakdown: "rate" })).toBeNull();
  });

  it("uses a test-history message when no rate points are available", () => {
    expect(failureChartEmptyState({ ...recordedFailures, hasData: false, breakdown: "rate" })?.heading).toBe("No test history in this range");
  });

  it("replaces the empty panel with the chart when a period gains data, and removes the chart when it empties", () => {
    const renderPanel = (hasData: boolean) => renderToStaticMarkup(createElement(FailureChartPanel, {
      title: "Failures by Category",
      emptyState: failureChartEmptyState({ ...recordedFailures, hasData, breakdown: "category" }),
    }, createElement("div", { "data-chart": true }, "Populated chart")));
    const empty = renderPanel(false);
    expect(empty).toContain("No categorized failures in this range");
    expect(empty).not.toContain("data-chart");
    const populated = renderPanel(true);
    expect(populated).toContain("data-chart");
    expect(populated).not.toContain("No categorized failures");
    expect(populated).not.toContain('role="status"');
    expect(renderPanel(false)).not.toContain("data-chart");
  });
});
