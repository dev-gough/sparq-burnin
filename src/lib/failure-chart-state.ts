export type FailureChartEmptyState = {
  heading: string;
  description: string;
};

/** Annotation charts can be empty even when failed tests were recorded. */
export function failureChartEmptyState({
  hasData,
  totalTests,
  totalFailedTests,
  breakdown,
}: {
  hasData: boolean;
  totalTests: number;
  totalFailedTests: number;
  breakdown: "category" | "group" | "rate";
}): FailureChartEmptyState | null {
  if (hasData) return null;
  if (totalTests === 0) {
    return {
      heading: "No tests in this range",
      description: "Choose a wider period or another custom date range to see test results.",
    };
  }
  if (breakdown === "rate") {
    return {
      heading: "No test history in this range",
      description: "There are no dated test results available to plot for this period.",
    };
  }
  if (totalFailedTests === 0) {
    return {
      heading: "No failures in this range",
      description: "Tests were recorded, but none failed in the selected period.",
    };
  }
  return {
    heading: breakdown === "category"
      ? "No categorized failures in this range"
      : "No grouped failures in this range",
    description: breakdown === "category"
      ? "Failed tests were recorded, but no failure category annotations are available for this view."
      : "Failed tests were recorded, but no failure group annotations are available for this view.",
  };
}
