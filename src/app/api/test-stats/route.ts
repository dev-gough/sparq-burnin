import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { getDatabaseConfig } from '@/lib/config';
import { requireAuth } from '@/lib/auth-check';
import {
  validateDateRange,
  validateTimeRange,
  validateChartMode,
  getTimeRangeDays,
  validateBucket,
} from '@/lib/validation';
import {
  getCompareWindows,
  getCurrentWindow,
  buildWindowTimeFilter,
  type StatsWindow,
} from '@/lib/stats-windows';
import {
  buildSummaryDelta,
  type SummaryDelta,
  type SummaryStats,
} from '@/lib/summary-delta';

interface TestStats {
  date: string;
  passed: number;
  failed: number;
  /**
   * Rank-then-tag strip fields (PR4):
   * totalUnfiltered = unfiltered bucket population (latest per serial per bucket when recent)
   * failedFiltered  = FAILs in that population matching annotation (all FAILs when annotation=all)
   * stripRate = failedFiltered / totalUnfiltered
   */
  totalUnfiltered: number;
  failedFiltered: number;
}

interface SummaryCompareResponse {
  chartMode: string;
  timeRange: string | null;
  annotation: string;
  current: SummaryStats;
  previous: SummaryStats | null;
  delta: SummaryDelta | null;
  labels: { current: string; previous: string } | null;
  /** Top-level mirror of current.failurePercentageOfTotal when annotation filter active */
  failurePercentageOfTotal: number | null;
}

interface TestRecord {
  test_id: number;
  inv_id: number;
  serial_number: string;
  firmware_version: string;
  duration: number;
  non_zero_status_flags: number;
  status: string;
  failure_reason: string | null;
  start_time: string;
  annotations: string | null;
}

/**
 * Synthetic group label from COALESCE(aqo.group_name, 'Other') in
 * annotation-summary / failure-analytics. Free-text annotations (no quick
 * option) and options with NULL group_name both roll up here — filter must
 * use LEFT JOIN + null-check, not INNER JOIN equality to 'Other'.
 */
const UNGROUPED_ANNOTATION_LABEL = "Other";

/**
 * EXISTS fragment for group: filter on a test-id expression.
 * Returns whether the caller must bind `groupName` as $paramIndex.
 */
function annotationGroupExistsSql(
  testIdExpr: string,
  groupName: string,
  paramIndex: number
): { sql: string; usesParam: boolean } {
  if (groupName === UNGROUPED_ANNOTATION_LABEL) {
    return {
      sql: `EXISTS (
        SELECT 1 FROM TestAnnotations ta
        LEFT JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
        WHERE ta.current_test_id = ${testIdExpr}
          AND (aqo.option_text IS NULL OR aqo.group_name IS NULL)
      )`,
      usesParam: false,
    };
  }
  return {
    sql: `EXISTS (
      SELECT 1 FROM TestAnnotations ta
      JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
      WHERE ta.current_test_id = ${testIdExpr}
        AND aqo.group_name = $${paramIndex}
    )`,
    usesParam: true,
  };
}

/**
 * Query summary stats for one time window.
 * Preserves annotation split semantics: total/passed unfiltered, failed filtered,
 * failureRate = filtered failures / all tests.
 */
async function querySummaryStats(
  client: Client,
  opts: {
    chartMode: string;
    window: StatsWindow;
    annotationFilter: string | null;
    isGroupFilter: boolean;
    filterValue: string | null;
  }
): Promise<SummaryStats> {
  const { chartMode, window, annotationFilter, isGroupFilter, filterValue } = opts;

  const { sql: windowSql, params: timeParams } = buildWindowTimeFilter(
    window,
    "t.start_time_utc",
    1
  );
  const timeFilter = windowSql ? `AND ${windowSql}` : "";

  const annotationActive =
    !!annotationFilter && annotationFilter !== "all";

  let summaryAnnotationFilterClause = "";
  /** When true, bind filterValue after timeParams for the annotation EXISTS. */
  let annotationUsesParam = false;
  if (annotationActive) {
    const annotationParamIndex = timeParams.length + 1;
    if (isGroupFilter && filterValue) {
      const groupExists = annotationGroupExistsSql(
        "t.test_id",
        filterValue,
        annotationParamIndex
      );
      summaryAnnotationFilterClause = `
            AND ${groupExists.sql}`;
      annotationUsesParam = groupExists.usesParam;
    } else {
      summaryAnnotationFilterClause = `
            AND EXISTS (
              SELECT 1 FROM TestAnnotations ta
              WHERE ta.current_test_id = t.test_id
              AND ta.annotation_text = $${annotationParamIndex}
            )`;
      annotationUsesParam = true;
    }
  }

  let total: number;
  let passed: number;
  let failed: number;
  let totalFailed: number | undefined;

  if (annotationActive) {
    // Query 1: total, passed, and ALL failed WITHOUT annotation filter
    let totalPassedQuery: string;
    if (chartMode === "recent") {
      totalPassedQuery = `
            WITH latest_tests AS (
              SELECT t.*, i.serial_number,
                ROW_NUMBER() OVER (
                  PARTITION BY i.serial_number
                  ORDER BY t.start_time_utc DESC
                ) as rn
              FROM Tests t
              JOIN Inverters i ON t.inv_id = i.inv_id
              WHERE t.overall_status != 'INVALID' ${timeFilter}
            )
            SELECT
              COUNT(*) as total,
              COUNT(CASE WHEN overall_status = 'PASS' THEN 1 END) as passed,
              COUNT(CASE WHEN overall_status = 'FAIL' THEN 1 END) as total_failed
            FROM latest_tests
            WHERE rn = 1
          `;
    } else {
      totalPassedQuery = `
            SELECT
              COUNT(*) as total,
              COUNT(CASE WHEN overall_status = 'PASS' THEN 1 END) as passed,
              COUNT(CASE WHEN overall_status = 'FAIL' THEN 1 END) as total_failed
            FROM Tests t
            JOIN Inverters i ON t.inv_id = i.inv_id
            WHERE t.overall_status != 'INVALID' ${timeFilter}
          `;
    }

    const totalPassedResult =
      timeParams.length > 0
        ? await client.query(totalPassedQuery, timeParams)
        : await client.query(totalPassedQuery);

    total = parseInt(totalPassedResult.rows[0].total) || 0;
    passed = parseInt(totalPassedResult.rows[0].passed) || 0;
    totalFailed = parseInt(totalPassedResult.rows[0].total_failed) || 0;

    // Query 2: failed count WITH annotation filter
    let failedQuery: string;
    if (chartMode === "recent") {
      failedQuery = `
            WITH latest_tests AS (
              SELECT t.test_id, t.overall_status, i.serial_number,
                ROW_NUMBER() OVER (
                  PARTITION BY i.serial_number
                  ORDER BY t.start_time_utc DESC
                ) as rn
              FROM Tests t
              JOIN Inverters i ON t.inv_id = i.inv_id
              WHERE t.overall_status != 'INVALID' ${timeFilter}
            )
            SELECT
              COUNT(CASE WHEN overall_status = 'FAIL' THEN 1 END) as failed
            FROM latest_tests
            WHERE rn = 1
              ${summaryAnnotationFilterClause.replace("t.test_id", "latest_tests.test_id")}
          `;
    } else {
      failedQuery = `
            SELECT
              COUNT(CASE WHEN overall_status = 'FAIL' THEN 1 END) as failed
            FROM Tests t
            JOIN Inverters i ON t.inv_id = i.inv_id
            WHERE t.overall_status != 'INVALID' ${timeFilter} ${summaryAnnotationFilterClause}
          `;
    }

    const failedParams = annotationUsesParam
      ? [...timeParams, filterValue!]
      : [...timeParams];
    const failedResult =
      failedParams.length > 0
        ? await client.query(failedQuery, failedParams)
        : await client.query(failedQuery);
    failed = parseInt(failedResult.rows[0].failed) || 0;
  } else {
    let summaryQuery: string;
    if (chartMode === "recent") {
      summaryQuery = `
            WITH latest_tests AS (
              SELECT t.*, i.serial_number,
                ROW_NUMBER() OVER (
                  PARTITION BY i.serial_number
                  ORDER BY t.start_time_utc DESC
                ) as rn
              FROM Tests t
              JOIN Inverters i ON t.inv_id = i.inv_id
              WHERE t.overall_status != 'INVALID' ${timeFilter}
            )
            SELECT
              COUNT(*) as total,
              COUNT(CASE WHEN overall_status = 'PASS' THEN 1 END) as passed,
              COUNT(CASE WHEN overall_status = 'FAIL' THEN 1 END) as failed
            FROM latest_tests
            WHERE rn = 1
          `;
    } else {
      summaryQuery = `
            SELECT
              COUNT(*) as total,
              COUNT(CASE WHEN overall_status = 'PASS' THEN 1 END) as passed,
              COUNT(CASE WHEN overall_status = 'FAIL' THEN 1 END) as failed
            FROM Tests t
            JOIN Inverters i ON t.inv_id = i.inv_id
            WHERE t.overall_status != 'INVALID' ${timeFilter}
          `;
    }

    const summaryResult =
      timeParams.length > 0
        ? await client.query(summaryQuery, timeParams)
        : await client.query(summaryQuery);
    const row = summaryResult.rows[0];

    total = parseInt(row.total) || 0;
    passed = parseInt(row.passed) || 0;
    failed = parseInt(row.failed) || 0;
  }

  const failureRate = total > 0 ? (failed / total) * 100 : 0;

  const summaryStats: SummaryStats = {
    total,
    passed,
    failed,
    failureRate: Math.round(failureRate * 100) / 100,
  };

  if (totalFailed !== undefined && totalFailed > 0) {
    const failurePercentageOfTotal = (failed / totalFailed) * 100;
    summaryStats.failurePercentageOfTotal =
      Math.round(failurePercentageOfTotal * 100) / 100;
  }

  return summaryStats;
}

export async function GET(request: NextRequest) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();
    // Set the session timezone to UTC to prevent local timezone interpretation
    await client.query("SET timezone = 'UTC'");

    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view");

    if (view === "summary") {
      // Get summary statistics
      const summaryChartMode = validateChartMode(searchParams.get("chartMode"));
      const summaryTimeRange = searchParams.get("timeRange");
      const summaryAnnotationFilter = searchParams.get("annotation");
      const rawSummaryDateFrom = searchParams.get("dateFrom");
      const rawSummaryDateTo = searchParams.get("dateTo");
      const wantCompare = searchParams.get("compare") === "1";

      // Validate date inputs
      const { dateFrom: summaryDateFrom, dateTo: summaryDateTo, error: dateError } = validateDateRange(
        rawSummaryDateFrom,
        rawSummaryDateTo
      );
      if (dateError) {
        return NextResponse.json({ error: dateError }, { status: 400 });
      }

      // Validate time range
      const validatedTimeRange = validateTimeRange(summaryTimeRange);

      // Check if filtering by group or individual annotation
      const isSummaryGroupFilter = summaryAnnotationFilter?.startsWith("group:") ?? false;
      const summaryFilterValue = isSummaryGroupFilter && summaryAnnotationFilter ? summaryAnnotationFilter.substring(6) : summaryAnnotationFilter;

      const windowInput = {
        timeRange: validatedTimeRange,
        dateFrom: summaryDateFrom,
        dateTo: summaryDateTo,
      };

      const currentWindow = getCurrentWindow(windowInput);
      const compareWindows = wantCompare ? getCompareWindows(windowInput) : null;

      const queryOpts = {
        chartMode: summaryChartMode,
        annotationFilter: summaryAnnotationFilter,
        isGroupFilter: isSummaryGroupFilter,
        filterValue: summaryFilterValue,
      };

      let currentStats: SummaryStats;
      let previous: SummaryStats | null = null;
      let delta: SummaryDelta | null = null;
      let labels: { current: string; previous: string } | null = null;

      if (wantCompare && compareWindows) {
        // Parallel current + previous on separate clients — pg Client does not
        // allow concurrent queries on one connection.
        const prevClient = new Client(getDatabaseConfig());
        try {
          await prevClient.connect();
          await prevClient.query("SET timezone = 'UTC'");
          const [cur, prev] = await Promise.all([
            querySummaryStats(client, { ...queryOpts, window: currentWindow }),
            querySummaryStats(prevClient, {
              ...queryOpts,
              window: compareWindows.previous,
            }),
          ]);
          currentStats = cur;
          previous = prev;
          delta = buildSummaryDelta(cur, prev);
          labels = compareWindows.labels;
        } finally {
          await prevClient.end();
        }
      } else {
        currentStats = await querySummaryStats(client, {
          ...queryOpts,
          window: currentWindow,
        });
      }

      // Backward-compatible flat response when compare is not requested
      if (!wantCompare) {
        return NextResponse.json(currentStats);
      }

      const annotationLabel =
        summaryAnnotationFilter && summaryAnnotationFilter !== ""
          ? summaryAnnotationFilter
          : "all";

      const compareResponse: SummaryCompareResponse = {
        chartMode: summaryChartMode,
        timeRange: validatedTimeRange,
        annotation: annotationLabel,
        current: currentStats,
        previous,
        delta,
        labels,
        failurePercentageOfTotal:
          currentStats.failurePercentageOfTotal ?? null,
      };

      return NextResponse.json(compareResponse);
    }

    if (view === "tests") {
      // Get detailed test records for the data table
      const latestOnly = searchParams.get("latestOnly") === "true";
      const annotationFilter = searchParams.get("annotation");

      // Pagination parameters for progressive loading
      const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!) : 10000;
      const offset = searchParams.get("offset") ? parseInt(searchParams.get("offset")!) : 0;

      // Check if filtering by group or individual annotation
      const isGroupFilter = annotationFilter?.startsWith("group:") ?? false;
      const filterValue = isGroupFilter && annotationFilter ? annotationFilter.substring(6) : annotationFilter;
      const annotationActive =
        !!annotationFilter && annotationFilter !== "all";

      // Other group uses LEFT JOIN null-check (no bind param); named groups/options use $1
      const testsAnnotationUsesParam =
        annotationActive &&
        !(isGroupFilter && filterValue === UNGROUPED_ANNOTATION_LABEL);

      // Param layout: [filterValue?] limit offset
      const limitParamIdx = testsAnnotationUsesParam ? 2 : 1;
      const offsetParamIdx = limitParamIdx + 1;
      const testsQueryParams: (string | number)[] = [];
      if (testsAnnotationUsesParam) {
        testsQueryParams.push(filterValue!);
      }
      testsQueryParams.push(limit, offset);

      let testsQuery: string;
      if (latestOnly) {
        let annSql = "";
        if (annotationActive) {
          if (isGroupFilter && filterValue) {
            const g = annotationGroupExistsSql("lt.test_id", filterValue, 1);
            annSql = `\n            AND ${g.sql}`;
          } else {
            annSql = `
            AND EXISTS (
              SELECT 1 FROM TestAnnotations ta2
              WHERE ta2.current_test_id = lt.test_id
              AND ta2.annotation_text = $1
            )`;
          }
        }
        // Show only the most recent valid test per serial number (excluding INVALID)
        testsQuery = `
          WITH latest_tests AS (
            SELECT
              t.test_id,
              t.inv_id,
              i.serial_number,
              t.firmware_version,
              EXTRACT(EPOCH FROM (t.end_time - t.start_time)) * 1000 as duration,
              (
                CASE WHEN t.ac_status IS NOT NULL AND t.ac_status != '' THEN 1 ELSE 0 END +
                CASE WHEN t.ch1_status IS NOT NULL AND t.ch1_status != '' THEN 1 ELSE 0 END +
                CASE WHEN t.ch2_status IS NOT NULL AND t.ch2_status != '' THEN 1 ELSE 0 END +
                CASE WHEN t.ch3_status IS NOT NULL AND t.ch3_status != '' THEN 1 ELSE 0 END +
                CASE WHEN t.ch4_status IS NOT NULL AND t.ch4_status != '' THEN 1 ELSE 0 END
              ) as non_zero_status_flags,
              t.overall_status as status,
              t.failure_description as failure_reason,
              t.start_time_utc as start_time,
              ROW_NUMBER() OVER (
                PARTITION BY i.serial_number
                ORDER BY t.start_time_utc DESC
              ) as rn
            FROM Tests t
            JOIN Inverters i ON t.inv_id = i.inv_id
            WHERE t.overall_status != 'INVALID'
          )
          SELECT
            lt.test_id, lt.inv_id, lt.serial_number, lt.firmware_version, lt.duration,
            lt.non_zero_status_flags, lt.status, lt.failure_reason, lt.start_time,
            STRING_AGG(
              DISTINCT
              CASE
                WHEN aqo.group_name = 'Setup Issue' THEN 'Setup Issue - ' || ta.annotation_text
                ELSE ta.annotation_text
              END,
              '; '
              ORDER BY
                CASE
                  WHEN aqo.group_name = 'Setup Issue' THEN 'Setup Issue - ' || ta.annotation_text
                  ELSE ta.annotation_text
                END
            ) as annotations
          FROM latest_tests lt
          LEFT JOIN TestAnnotations ta ON lt.test_id = ta.current_test_id
          LEFT JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
          WHERE lt.rn = 1
            ${annSql}
          GROUP BY lt.test_id, lt.inv_id, lt.serial_number, lt.firmware_version,
                   lt.duration, lt.non_zero_status_flags, lt.status, lt.failure_reason, lt.start_time
          ORDER BY lt.start_time DESC
          LIMIT $${limitParamIdx}
          OFFSET $${offsetParamIdx}
        `;
      } else {
        let annWhere = "";
        if (annotationActive) {
          if (isGroupFilter && filterValue) {
            const g = annotationGroupExistsSql("t.test_id", filterValue, 1);
            annWhere = `\n          WHERE ${g.sql}`;
          } else {
            annWhere = `
          WHERE EXISTS (
            SELECT 1 FROM TestAnnotations ta2
            WHERE ta2.current_test_id = t.test_id
            AND ta2.annotation_text = $1
          )`;
          }
        }
        // Show all tests
        testsQuery = `
          SELECT
            t.test_id,
            t.inv_id,
            i.serial_number,
            t.firmware_version,
            EXTRACT(EPOCH FROM (t.end_time - t.start_time)) * 1000 as duration,
            (
              CASE WHEN t.ac_status IS NOT NULL AND t.ac_status != '' THEN 1 ELSE 0 END +
              CASE WHEN t.ch1_status IS NOT NULL AND t.ch1_status != '' THEN 1 ELSE 0 END +
              CASE WHEN t.ch2_status IS NOT NULL AND t.ch2_status != '' THEN 1 ELSE 0 END +
              CASE WHEN t.ch3_status IS NOT NULL AND t.ch3_status != '' THEN 1 ELSE 0 END +
              CASE WHEN t.ch4_status IS NOT NULL AND t.ch4_status != '' THEN 1 ELSE 0 END
            ) as non_zero_status_flags,
            t.overall_status as status,
            t.failure_description as failure_reason,
            t.start_time_utc as start_time,
            STRING_AGG(
              DISTINCT
              CASE
                WHEN aqo.group_name = 'Setup Issue' THEN 'Setup Issue - ' || ta.annotation_text
                ELSE ta.annotation_text
              END,
              '; '
              ORDER BY
                CASE
                  WHEN aqo.group_name = 'Setup Issue' THEN 'Setup Issue - ' || ta.annotation_text
                  ELSE ta.annotation_text
                END
            ) as annotations
          FROM Tests t
          JOIN Inverters i ON t.inv_id = i.inv_id
          LEFT JOIN TestAnnotations ta ON t.test_id = ta.current_test_id
          LEFT JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
          ${annWhere}
          GROUP BY t.test_id, t.inv_id, i.serial_number, t.firmware_version,
                   t.overall_status, t.failure_description, t.start_time_utc, t.end_time,
                   t.ac_status, t.ch1_status, t.ch2_status, t.ch3_status, t.ch4_status
          ORDER BY t.start_time_utc DESC
          LIMIT $${limitParamIdx}
          OFFSET $${offsetParamIdx}
        `;
      }

      const result = await client.query(testsQuery, testsQueryParams);

      const tests: TestRecord[] = result.rows.map((row) => ({
        test_id: row.test_id,
        inv_id: row.inv_id,
        serial_number: row.serial_number || "Unknown",
        firmware_version: row.firmware_version || "Unknown",
        duration: Math.round(row.duration) || 0,
        non_zero_status_flags: row.non_zero_status_flags || 0,
        status: row.status || "UNKNOWN",
        failure_reason: row.failure_reason || null,
        start_time: row.start_time ? row.start_time.toISOString() : "",
        annotations: row.annotations || null,
      }));

      return NextResponse.json(tests);
    }

    if (view === "firmware-versions") {
      // Get unique firmware versions
      const firmwareQuery = `
        SELECT DISTINCT firmware_version
        FROM Tests
        WHERE firmware_version IS NOT NULL AND firmware_version != ''
        ORDER BY firmware_version DESC
      `;
      const result = await client.query(firmwareQuery);
      const versions = result.rows.map((row) => row.firmware_version);
      return NextResponse.json(versions);
    }

    if (view === "annotations") {
      // Get unique annotation texts
      const annotationsQuery = `
        SELECT DISTINCT annotation_text
        FROM TestAnnotations
        WHERE annotation_text IS NOT NULL AND annotation_text != ''
        ORDER BY annotation_text ASC
      `;
      const result = await client.query(annotationsQuery);
      const annotations = result.rows.map((row) => row.annotation_text);
      return NextResponse.json(annotations);
    }

    /**
     * Extremely cheap existence probe for empty-period UI gating.
     * Single EXISTS on Tests (+ optional annotation) with the same time window
     * as summary — no aggregation, no compare, no bucketing.
     */
    if (view === "has-data") {
      const rawTimeRange = searchParams.get("timeRange");
      const rawDateFrom = searchParams.get("dateFrom");
      const rawDateTo = searchParams.get("dateTo");
      const annotationFilter = searchParams.get("annotation");

      const { dateFrom, dateTo, error: dateError } = validateDateRange(
        rawDateFrom,
        rawDateTo,
      );
      if (dateError) {
        return NextResponse.json({ error: dateError }, { status: 400 });
      }

      const validatedTimeRange = validateTimeRange(rawTimeRange);
      const window = getCurrentWindow({
        timeRange: validatedTimeRange,
        dateFrom,
        dateTo,
      });

      const { sql: windowSql, params: timeParams } = buildWindowTimeFilter(
        window,
        "t.start_time_utc",
        1,
      );
      const timeFilter = windowSql ? `AND ${windowSql}` : "";

      const isGroupFilter = annotationFilter?.startsWith("group:") ?? false;
      const filterValue =
        isGroupFilter && annotationFilter
          ? annotationFilter.substring(6)
          : annotationFilter;
      const annotationActive =
        !!annotationFilter && annotationFilter !== "all";

      let annotationSql = "";
      const queryParams: string[] = [...timeParams];
      if (annotationActive) {
        const paramIndex = queryParams.length + 1;
        if (isGroupFilter && filterValue) {
          const g = annotationGroupExistsSql(
            "t.test_id",
            filterValue,
            paramIndex,
          );
          annotationSql = `AND ${g.sql}`;
          if (g.usesParam) queryParams.push(filterValue);
        } else if (filterValue) {
          annotationSql = `AND EXISTS (
            SELECT 1 FROM TestAnnotations ta
            WHERE ta.current_test_id = t.test_id
              AND ta.annotation_text = $${paramIndex}
          )`;
          queryParams.push(filterValue);
        }
      }

      // EXISTS short-circuits — typically sub-ms with the time index / sequential scan stop
      const probe = `
        SELECT EXISTS (
          SELECT 1
          FROM Tests t
          WHERE t.overall_status != 'INVALID'
            ${timeFilter}
            ${annotationSql}
          LIMIT 1
        ) AS has_data
      `;
      const result = await client.query(probe, queryParams);
      const hasData = Boolean(result.rows[0]?.has_data);

      return NextResponse.json({
        hasData,
        timeRange: validatedTimeRange,
        annotation:
          annotationFilter && annotationFilter !== ""
            ? annotationFilter
            : "all",
      });
    }

    /**
     * Lightweight top causes + untagged failed count for the command-center insights strip.
     * Same time / chartMode population rules as summary. Does NOT use failure-analytics timelines.
     */
    if (view === "annotation-summary") {
      const chartMode = validateChartMode(searchParams.get("chartMode"));
      const rawTimeRange = searchParams.get("timeRange");
      const rawDateFrom = searchParams.get("dateFrom");
      const rawDateTo = searchParams.get("dateTo");
      const limitParam = parseInt(searchParams.get("limit") || "5", 10);
      const limit =
        Number.isFinite(limitParam) && limitParam > 0
          ? Math.min(limitParam, 20)
          : 5;

      const { dateFrom, dateTo, error: dateError } = validateDateRange(
        rawDateFrom,
        rawDateTo
      );
      if (dateError) {
        return NextResponse.json({ error: dateError }, { status: 400 });
      }

      const validatedTimeRange = validateTimeRange(rawTimeRange);
      const window = getCurrentWindow({
        timeRange: validatedTimeRange,
        dateFrom,
        dateTo,
      });

      const { sql: windowSql, params: timeParams } = buildWindowTimeFilter(
        window,
        "t.start_time_utc",
        1
      );
      const timeFilter = windowSql ? `AND ${windowSql}` : "";

      // Same population as summary: latest-per-serial when recent, else all valid tests
      let baseTestsCte: string;
      if (chartMode === "recent") {
        baseTestsCte = `
          latest_tests AS (
            SELECT t.*, i.serial_number,
              ROW_NUMBER() OVER (
                PARTITION BY i.serial_number
                ORDER BY t.start_time_utc DESC
              ) as rn
            FROM Tests t
            JOIN Inverters i ON t.inv_id = i.inv_id
            WHERE t.overall_status != 'INVALID' ${timeFilter}
          ),
          base_tests AS (
            SELECT * FROM latest_tests WHERE rn = 1
          )`;
      } else {
        baseTestsCte = `
          base_tests AS (
            SELECT t.*, i.serial_number
            FROM Tests t
            JOIN Inverters i ON t.inv_id = i.inv_id
            WHERE t.overall_status != 'INVALID' ${timeFilter}
          )`;
      }

      // Inclusive YMD window matching SQL (client may use for /todo href)
      let rangeFrom: string | null = null;
      let rangeTo: string | null = null;
      if (window.type === "absolute") {
        rangeFrom = window.dateFrom;
        rangeTo = window.dateTo;
      } else if (window.type === "relative_open") {
        const rangeResult = await client.query(
          `SELECT
             TO_CHAR(CURRENT_DATE - $1::int, 'YYYY-MM-DD') AS range_from,
             TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') AS range_to`,
          [window.days]
        );
        rangeFrom = rangeResult.rows[0]?.range_from ?? null;
        rangeTo = rangeResult.rows[0]?.range_to ?? null;
      }

      // Total failed + untagged failed in population
      const countsResult = await client.query(
        `
        WITH ${baseTestsCte}
        SELECT
          COUNT(*) FILTER (WHERE overall_status = 'FAIL') AS total_failed,
          COUNT(*) FILTER (
            WHERE overall_status = 'FAIL'
              AND NOT EXISTS (
                SELECT 1 FROM TestAnnotations ta
                WHERE ta.current_test_id = base_tests.test_id
              )
          ) AS untagged_failed
        FROM base_tests
        `,
        timeParams
      );

      const totalFailed = parseInt(countsResult.rows[0]?.total_failed ?? "0", 10);
      const untaggedFailed = parseInt(
        countsResult.rows[0]?.untagged_failed ?? "0",
        10
      );

      // Top annotation groups among failed tests (count annotation rows, match failure-analytics)
      // GROUP BY the coalesced label — otherwise NULL group_name and a real group
      // named 'Other' both appear as name='Other' and break React keys / double-count chips.
      const groupsResult = await client.query(
        `
        WITH ${baseTestsCte}
        SELECT
          COALESCE(aqo.group_name, 'Other') AS name,
          COUNT(*)::int AS count
        FROM TestAnnotations ta
        LEFT JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
        JOIN base_tests t ON ta.current_test_id = t.test_id
        WHERE t.overall_status = 'FAIL'
          AND ta.current_test_id IS NOT NULL
        GROUP BY COALESCE(aqo.group_name, 'Other')
        ORDER BY count DESC
        LIMIT $${timeParams.length + 1}
        `,
        [...timeParams, limit]
      );

      // Top quick-option texts among failed tests
      const optionsResult = await client.query(
        `
        WITH ${baseTestsCte}
        SELECT
          aqo.option_text AS name,
          COALESCE(aqo.group_name, 'Other') AS group_name,
          COUNT(*)::int AS count
        FROM TestAnnotations ta
        JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
        JOIN base_tests t ON ta.current_test_id = t.test_id
        WHERE t.overall_status = 'FAIL'
          AND ta.current_test_id IS NOT NULL
        GROUP BY aqo.option_text, aqo.group_name
        ORDER BY count DESC
        LIMIT $${timeParams.length + 1}
        `,
        [...timeParams, limit]
      );

      const pct = (count: number) =>
        totalFailed > 0
          ? Math.round((count / totalFailed) * 1000) / 10
          : 0;

      const groups = groupsResult.rows.map((row) => ({
        name: row.name as string,
        count: parseInt(String(row.count), 10),
        percentageOfFailed: pct(parseInt(String(row.count), 10)),
      }));

      const options = optionsResult.rows.map((row) => ({
        name: row.name as string,
        group_name: row.group_name as string,
        count: parseInt(String(row.count), 10),
        percentageOfFailed: pct(parseInt(String(row.count), 10)),
      }));

      return NextResponse.json({
        groups,
        options,
        untaggedFailed,
        totalFailed,
        range: { from: rangeFrom, to: rangeTo },
      });
    }

    // Default: return bucketed statistics (daily by default)
    const chartMode = searchParams.get("chartMode") || "all"; // 'all' or 'recent'
    const bucket = validateBucket(searchParams.get("bucket")); // day/week/month/quarter/year
    const rawTimeRange = searchParams.get("timeRange");
    const chartAnnotationFilter = searchParams.get("annotation");
    const rawDateFrom = searchParams.get("dateFrom");
    const rawDateTo = searchParams.get("dateTo");

    // Validate date inputs
    const { dateFrom, dateTo, error: chartDateError } = validateDateRange(rawDateFrom, rawDateTo);
    if (chartDateError) {
      return NextResponse.json({ error: chartDateError }, { status: 400 });
    }

    // Validate time range
    const validatedChartTimeRange = validateTimeRange(rawTimeRange);

    // Check if filtering by group or individual annotation
    const isGroupFilter = chartAnnotationFilter?.startsWith("group:") ?? false;
    const filterValue = isGroupFilter && chartAnnotationFilter ? chartAnnotationFilter.substring(6) : chartAnnotationFilter;

    // Build time filter based on custom dates or timeRange parameter
    let timeFilter = "";
    const chartTimeParams: string[] = [];
    if (dateFrom || dateTo) {
      // Custom date range takes precedence
      const conditions = [];
      if (dateFrom) {
        chartTimeParams.push(dateFrom);
        conditions.push(`t.start_time_utc >= $${chartTimeParams.length}::date`);
      }
      if (dateTo) {
        chartTimeParams.push(dateTo);
        conditions.push(`t.start_time_utc <= $${chartTimeParams.length}::date + INTERVAL '1 day' - INTERVAL '1 second'`);
      }
      timeFilter = conditions.join(' AND ') + ' AND';
    } else if (validatedChartTimeRange && validatedChartTimeRange !== "all") {
      // Use predefined time range if no custom dates
      const days = getTimeRangeDays(validatedChartTimeRange);
      if (days !== null) {
        timeFilter = `t.start_time_utc >= CURRENT_DATE - INTERVAL '${days} days' AND`;
      }
    }

    // Annotation match for volume prefilter (legacy) and strip rank-then-tag EXISTS
    const annotationActive =
      !!chartAnnotationFilter && chartAnnotationFilter !== "all";

    // Build annotation filter for volume series (prefilter — legacy path)
    // group:Other → free-text / null-group (no bind param); else $paramIndex
    let annotationFilter = "";
    let chartAnnotationUsesParam = false;
    if (annotationActive) {
      const chartAnnotationParamIndex = chartTimeParams.length + 1;
      if (isGroupFilter && filterValue) {
        const g = annotationGroupExistsSql(
          "t.test_id",
          filterValue,
          chartAnnotationParamIndex
        );
        annotationFilter = `
          AND ${g.sql}`;
        chartAnnotationUsesParam = g.usesParam;
      } else {
        annotationFilter = `
          AND EXISTS (
            SELECT 1 FROM TestAnnotations ta
            WHERE ta.current_test_id = t.test_id
            AND ta.annotation_text = $${chartAnnotationParamIndex}
          )`;
        chartAnnotationUsesParam = true;
      }
    }

    // EXISTS clause for rank-then-tag failedFiltered (applied AFTER rank, on test_id).
    // Uses same param index as volume annotation when active (when usesParam).
    let stripTagExists = "TRUE"; // annotation=all → all FAILs count
    if (annotationActive) {
      const stripAnnIdx = chartTimeParams.length + 1;
      if (isGroupFilter && filterValue) {
        const g = annotationGroupExistsSql(
          "bl.test_id",
          filterValue,
          stripAnnIdx
        );
        stripTagExists = g.sql;
      } else {
        stripTagExists = `EXISTS (
          SELECT 1 FROM TestAnnotations ta
          WHERE ta.current_test_id = bl.test_id
            AND ta.annotation_text = $${stripAnnIdx}
        )`;
      }
    }

    // Bucket expression — `bucket` is whitelisted by validateBucket, safe to interpolate
    const bucketExpr = `DATE_TRUNC('${bucket}', t.start_time_utc)::date`;

    /**
     * Combined volume + strip query.
     * - volume: may annotation-prefilter before rank (legacy)
     * - strip (rank-then-tag A): unfiltered rank/population, then tag FAIL for failedFiltered
     * Join on test_date so buckets present in either side appear.
     */
    let query: string;
    if (chartMode === "recent") {
      query = `
        WITH volume_ranked AS (
          SELECT
            ${bucketExpr} AS test_date,
            t.overall_status,
            ROW_NUMBER() OVER (
              PARTITION BY i.serial_number, ${bucketExpr}
              ORDER BY t.start_time_utc DESC
            ) AS rn
          FROM Tests t
          JOIN Inverters i ON t.inv_id = i.inv_id
          WHERE ${timeFilter}
            t.overall_status != 'INVALID'
            ${annotationFilter}
        ),
        volume AS (
          SELECT
            test_date,
            COUNT(CASE WHEN overall_status = 'PASS' THEN 1 END) AS passed,
            COUNT(CASE WHEN overall_status = 'FAIL' THEN 1 END) AS failed
          FROM volume_ranked
          WHERE rn = 1
          GROUP BY test_date
        ),
        strip_ranked AS (
          SELECT
            ${bucketExpr} AS test_date,
            t.test_id,
            t.overall_status,
            ROW_NUMBER() OVER (
              PARTITION BY i.serial_number, ${bucketExpr}
              ORDER BY t.start_time_utc DESC
            ) AS rn
          FROM Tests t
          JOIN Inverters i ON t.inv_id = i.inv_id
          WHERE ${timeFilter}
            t.overall_status != 'INVALID'
            -- intentionally NO annotation filter (rank-then-tag)
        ),
        strip AS (
          SELECT
            bl.test_date,
            COUNT(*) AS total_unfiltered,
            COUNT(*) FILTER (
              WHERE bl.overall_status = 'FAIL'
                AND (${stripTagExists})
            ) AS failed_filtered
          FROM strip_ranked bl
          WHERE bl.rn = 1
          GROUP BY bl.test_date
        )
        SELECT
          to_char(COALESCE(v.test_date, s.test_date), 'YYYY-MM-DD') AS test_date,
          COALESCE(v.passed, 0) AS passed,
          COALESCE(v.failed, 0) AS failed,
          COALESCE(s.total_unfiltered, 0) AS total_unfiltered,
          COALESCE(s.failed_filtered, 0) AS failed_filtered
        FROM volume v
        FULL OUTER JOIN strip s ON v.test_date = s.test_date
        ORDER BY COALESCE(v.test_date, s.test_date) ASC
      `;
    } else {
      // All-tests mode: no per-serial rank; strip population = all valid tests in bucket
      query = `
        WITH volume AS (
          SELECT
            ${bucketExpr} AS test_date,
            COUNT(CASE WHEN t.overall_status = 'PASS' THEN 1 END) AS passed,
            COUNT(CASE WHEN t.overall_status = 'FAIL' THEN 1 END) AS failed
          FROM Tests t
          WHERE ${timeFilter}
            t.overall_status != 'INVALID'
            ${annotationFilter}
          GROUP BY ${bucketExpr}
        ),
        strip_base AS (
          SELECT
            ${bucketExpr} AS test_date,
            t.test_id,
            t.overall_status
          FROM Tests t
          WHERE ${timeFilter}
            t.overall_status != 'INVALID'
            -- intentionally NO annotation filter (rank-then-tag)
        ),
        strip AS (
          SELECT
            bl.test_date,
            COUNT(*) AS total_unfiltered,
            COUNT(*) FILTER (
              WHERE bl.overall_status = 'FAIL'
                AND (${stripTagExists})
            ) AS failed_filtered
          FROM strip_base bl
          GROUP BY bl.test_date
        )
        SELECT
          to_char(COALESCE(v.test_date, s.test_date), 'YYYY-MM-DD') AS test_date,
          COALESCE(v.passed, 0) AS passed,
          COALESCE(v.failed, 0) AS failed,
          COALESCE(s.total_unfiltered, 0) AS total_unfiltered,
          COALESCE(s.failed_filtered, 0) AS failed_filtered
        FROM volume v
        FULL OUTER JOIN strip s ON v.test_date = s.test_date
        ORDER BY COALESCE(v.test_date, s.test_date) ASC
      `;
    }

    // Build final params array combining time and annotation filters
    const chartParams = [...chartTimeParams];
    if (annotationActive && chartAnnotationUsesParam) {
      chartParams.push(filterValue!);
    }

    const result = chartParams.length > 0
      ? await client.query(query, chartParams)
      : await client.query(query);

    const stats: TestStats[] = result.rows.map((row) => ({
      date: row.test_date,
      passed: parseInt(row.passed) || 0,
      failed: parseInt(row.failed) || 0,
      totalUnfiltered: parseInt(row.total_unfiltered) || 0,
      failedFiltered: parseInt(row.failed_filtered) || 0,
    }));

    return NextResponse.json(stats);
  } catch (error) {
    console.error("Database error:", error);
    return NextResponse.json(
      { error: "Failed to fetch test statistics" },
      { status: 500 },
    );
  } finally {
    await client.end();
  }
}
