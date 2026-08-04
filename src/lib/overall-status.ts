/**
 * Canonical overall_status values for burn-in tests.
 * Station/CSV may send these; UI override and filters use the same set.
 * VARCHAR(10) on Tests.overall_status — keep strings ≤ 10 chars.
 */
export const OVERALL_STATUSES = ["PASS", "FAIL", "INVALID", "RETEST"] as const;

export type OverallStatus = (typeof OVERALL_STATUSES)[number];

/**
 * Statuses that are not decisive outcomes for pass/fail rates or
 * latest-per-S/N selection. RETEST will be replaced by a later PASS/FAIL;
 * INVALID is excluded for the same reason as before.
 *
 * All-tests table views still include these rows (client status filter owns
 * visibility). Hero cards, chart volume, and latest-per-S/N skip them.
 */
export const NON_OUTCOME_STATUSES = ["INVALID", "RETEST"] as const;

/**
 * SQL fragment for decisive outcomes only.
 * @param column Fully-qualified column, e.g. `t.overall_status` or bare `overall_status`
 */
export function outcomeStatusSql(column = "overall_status"): string {
  return `${column} NOT IN ('INVALID', 'RETEST')`
}

export function isOverallStatus(value: unknown): value is OverallStatus {
  return (
    typeof value === "string" &&
    (OVERALL_STATUSES as readonly string[]).includes(value)
  );
}

/** Human-readable labels for filters and UI. */
export const OVERALL_STATUS_LABELS: Record<OverallStatus, string> = {
  PASS: "Passed",
  FAIL: "Failed",
  INVALID: "Invalid",
  RETEST: "Retest",
};

/**
 * Badge visual treatment shared by table / detail / history.
 * PASS uses custom emerald classes in several places; others use variants.
 */
export function overallStatusBadgeVariant(
  status: string
): "default" | "destructive" | "secondary" | "outline" {
  switch (status) {
    case "PASS":
      return "default";
    case "FAIL":
      return "destructive";
    case "RETEST":
      return "outline";
    case "INVALID":
    default:
      return "secondary";
  }
}

/** Extra className for status badges (PASS green, RETEST blue/sky). */
export function overallStatusBadgeClassName(status: string): string {
  if (status === "PASS") {
    return "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950 border-transparent dark:bg-green-900/30 dark:text-green-400 dark:border-green-800";
  }
  if (status === "RETEST") {
    return "border-sky-600 bg-sky-50 text-sky-900 dark:border-sky-500 dark:bg-sky-950/50 dark:text-sky-200";
  }
  return "";
}
