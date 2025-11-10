/**
 * Input validation utilities to prevent SQL injection and other attacks
 */

// Allowed time range values
const ALLOWED_TIME_RANGES = ['7d', '30d', '90d', 'all'] as const;
type TimeRange = typeof ALLOWED_TIME_RANGES[number];

// Allowed chart modes
const ALLOWED_CHART_MODES = ['recent', 'all'] as const;
type ChartMode = typeof ALLOWED_CHART_MODES[number];

// Allowed view types
const ALLOWED_VIEWS = ['summary', 'tests', 'firmware-versions', 'annotations'] as const;
type ViewType = typeof ALLOWED_VIEWS[number];

/**
 * Validates a date string in YYYY-MM-DD format
 * @param dateString - The date string to validate
 * @returns true if valid, false otherwise
 */
export function isValidDate(dateString: string): boolean {
  // Check format: YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(dateString)) {
    return false;
  }

  // Check if it's a valid date
  const date = new Date(dateString + 'T00:00:00Z');
  return !isNaN(date.getTime());
}

/**
 * Validates a time range parameter
 * @param timeRange - The time range to validate
 * @returns The validated time range or null if invalid
 */
export function validateTimeRange(timeRange: string | null): TimeRange | null {
  if (!timeRange) return null;
  return ALLOWED_TIME_RANGES.includes(timeRange as TimeRange) ? (timeRange as TimeRange) : null;
}

/**
 * Gets the number of days for a time range
 * @param timeRange - The time range
 * @returns The number of days, or null for 'all'
 */
export function getTimeRangeDays(timeRange: TimeRange): number | null {
  switch (timeRange) {
    case '7d':
      return 7;
    case '30d':
      return 30;
    case '90d':
      return 90;
    case 'all':
      return null;
  }
}

/**
 * Validates a chart mode parameter
 * @param chartMode - The chart mode to validate
 * @returns The validated chart mode or 'recent' as default
 */
export function validateChartMode(chartMode: string | null): ChartMode {
  if (!chartMode) return 'recent';
  return ALLOWED_CHART_MODES.includes(chartMode as ChartMode) ? (chartMode as ChartMode) : 'recent';
}

/**
 * Validates a view type parameter
 * @param view - The view type to validate
 * @returns The validated view type or null if invalid
 */
export function validateView(view: string | null): ViewType | null {
  if (!view) return null;
  return ALLOWED_VIEWS.includes(view as ViewType) ? (view as ViewType) : null;
}

/**
 * Sanitizes and validates date range parameters
 * @param dateFrom - Start date string
 * @param dateTo - End date string
 * @returns Validated dates or null values if invalid
 */
export function validateDateRange(
  dateFrom: string | null,
  dateTo: string | null
): { dateFrom: string | null; dateTo: string | null; error?: string } {
  let validatedDateFrom: string | null = null;
  let validatedDateTo: string | null = null;

  if (dateFrom) {
    if (!isValidDate(dateFrom)) {
      return { dateFrom: null, dateTo: null, error: 'Invalid dateFrom format. Use YYYY-MM-DD.' };
    }
    validatedDateFrom = dateFrom;
  }

  if (dateTo) {
    if (!isValidDate(dateTo)) {
      return { dateFrom: null, dateTo: null, error: 'Invalid dateTo format. Use YYYY-MM-DD.' };
    }
    validatedDateTo = dateTo;
  }

  // Check that dateFrom is not after dateTo
  if (validatedDateFrom && validatedDateTo) {
    const from = new Date(validatedDateFrom);
    const to = new Date(validatedDateTo);
    if (from > to) {
      return { dateFrom: null, dateTo: null, error: 'dateFrom cannot be after dateTo.' };
    }
  }

  return { dateFrom: validatedDateFrom, dateTo: validatedDateTo };
}
