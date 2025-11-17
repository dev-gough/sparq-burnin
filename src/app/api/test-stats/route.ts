import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { getDatabaseConfig } from '@/lib/config';
import { requireAuth } from '@/lib/auth-check';
import { validateDateRange, validateTimeRange, getTimeRangeDays } from '@/lib/validation';

interface TestStats {
  date: string;
  passed: number;
  failed: number;
}

interface SummaryStats {
  total: number;
  passed: number;
  failed: number;
  failureRate: number;
  failurePercentageOfTotal?: number; // Only present when annotation filter is active - % of total failures
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
      const summaryChartMode = searchParams.get("chartMode") || "recent"; // Default to 'recent' for summary
      const summaryTimeRange = searchParams.get("timeRange");
      const summaryAnnotationFilter = searchParams.get("annotation");
      const rawSummaryDateFrom = searchParams.get("dateFrom");
      const rawSummaryDateTo = searchParams.get("dateTo");

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

      let summaryQuery: string;
      let timeFilter = "";
      const timeParams: string[] = [];

      // Build time filter based on custom dates or timeRange parameter
      if (summaryDateFrom || summaryDateTo) {
        // Custom date range takes precedence
        const conditions = [];
        if (summaryDateFrom) {
          timeParams.push(summaryDateFrom);
          conditions.push(`t.start_time_utc >= $${timeParams.length}::date`);
        }
        if (summaryDateTo) {
          timeParams.push(summaryDateTo);
          conditions.push(`t.start_time_utc <= $${timeParams.length}::date + INTERVAL '1 day' - INTERVAL '1 second'`);
        }
        timeFilter = 'AND ' + conditions.join(' AND ');
      } else if (validatedTimeRange && validatedTimeRange !== "all") {
        // Use predefined time range if no custom dates
        const days = getTimeRangeDays(validatedTimeRange);
        if (days !== null) {
          timeFilter = `AND t.start_time_utc >= CURRENT_DATE - INTERVAL '${days} days'`;
        }
      }

      // Build annotation filter for summary
      let summaryAnnotationFilterClause = "";
      if (summaryAnnotationFilter && summaryAnnotationFilter !== 'all') {
        const annotationParamIndex = timeParams.length + 1;
        if (isSummaryGroupFilter) {
          summaryAnnotationFilterClause = `
            AND EXISTS (
              SELECT 1 FROM TestAnnotations ta
              JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
              WHERE ta.current_test_id = t.test_id
              AND aqo.group_name = $${annotationParamIndex}
            )`;
        } else {
          summaryAnnotationFilterClause = `
            AND EXISTS (
              SELECT 1 FROM TestAnnotations ta
              WHERE ta.current_test_id = t.test_id
              AND ta.annotation_text = $${annotationParamIndex}
            )`;
        }
      }

      // When annotation filter is applied, we need different logic:
      // - total and passed should count ALL tests (ignore annotation filter)
      // - failed should count ONLY failures with that annotation
      // - failureRate = (filtered failures) / (all tests)
      // - failurePercentageOfTotal = (filtered failures) / (all failures) - shown in brackets

      let total: number, passed: number, failed: number, totalFailed: number | undefined;

      if (summaryAnnotationFilter && summaryAnnotationFilter !== 'all') {
        // Annotation filter is active - use split query approach

        // Query 1: Get total, passed, and ALL failed counts WITHOUT annotation filter
        let totalPassedQuery: string;
        if (summaryChartMode === "recent") {
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

        const totalPassedResult = timeParams.length > 0
          ? await client.query(totalPassedQuery, timeParams)
          : await client.query(totalPassedQuery);

        total = parseInt(totalPassedResult.rows[0].total) || 0;
        passed = parseInt(totalPassedResult.rows[0].passed) || 0;
        totalFailed = parseInt(totalPassedResult.rows[0].total_failed) || 0;

        // Query 2: Get failed count WITH annotation filter
        let failedQuery: string;
        if (summaryChartMode === "recent") {
          // For "Most Recent" mode: First get most recent tests, THEN filter by annotation
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
              ${summaryAnnotationFilterClause.replace('t.test_id', 'latest_tests.test_id')}
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

        const failedParams = [...timeParams, summaryFilterValue!];
        const failedResult = await client.query(failedQuery, failedParams);
        failed = parseInt(failedResult.rows[0].failed) || 0;

      } else {
        // No annotation filter - use original single query approach
        if (summaryChartMode === "recent") {
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

        const summaryResult = timeParams.length > 0
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

      // Add percentage of total failures if annotation filter is active
      if (totalFailed !== undefined && totalFailed > 0) {
        const failurePercentageOfTotal = (failed / totalFailed) * 100;
        summaryStats.failurePercentageOfTotal = Math.round(failurePercentageOfTotal * 100) / 100;
      }

      return NextResponse.json(summaryStats);
    }

    if (view === "tests") {
      // Get detailed test records for the data table
      const latestOnly = searchParams.get("latestOnly") === "true";
      const annotationFilter = searchParams.get("annotation");

      // Check if filtering by group or individual annotation
      const isGroupFilter = annotationFilter?.startsWith("group:") ?? false;
      const filterValue = isGroupFilter && annotationFilter ? annotationFilter.substring(6) : annotationFilter;

      let testsQuery: string;
      if (latestOnly) {
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
            ${annotationFilter && annotationFilter !== 'all' ? (
              isGroupFilter ? `
            AND EXISTS (
              SELECT 1 FROM TestAnnotations ta2
              JOIN AnnotationQuickOptions aqo ON ta2.annotation_text = aqo.option_text
              WHERE ta2.current_test_id = lt.test_id
              AND aqo.group_name = $1
            )` : `
            AND EXISTS (
              SELECT 1 FROM TestAnnotations ta2
              WHERE ta2.current_test_id = lt.test_id
              AND ta2.annotation_text = $1
            )`
            ) : ''}
          GROUP BY lt.test_id, lt.inv_id, lt.serial_number, lt.firmware_version,
                   lt.duration, lt.non_zero_status_flags, lt.status, lt.failure_reason, lt.start_time
          ORDER BY lt.start_time DESC
          LIMIT 10000
        `;
      } else {
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
          ${annotationFilter && annotationFilter !== 'all' ? (
            isGroupFilter ? `
          WHERE EXISTS (
            SELECT 1 FROM TestAnnotations ta2
            JOIN AnnotationQuickOptions aqo ON ta2.annotation_text = aqo.option_text
            WHERE ta2.current_test_id = t.test_id
            AND aqo.group_name = $1
          )` : `
          WHERE EXISTS (
            SELECT 1 FROM TestAnnotations ta2
            WHERE ta2.current_test_id = t.test_id
            AND ta2.annotation_text = $1
          )`
          ) : ''}
          GROUP BY t.test_id, t.inv_id, i.serial_number, t.firmware_version,
                   t.overall_status, t.failure_description, t.start_time_utc, t.end_time,
                   t.ac_status, t.ch1_status, t.ch2_status, t.ch3_status, t.ch4_status
          ORDER BY t.start_time_utc DESC
          LIMIT 10000
        `;
      }

      const result = annotationFilter && annotationFilter !== 'all'
        ? await client.query(testsQuery, [filterValue])
        : await client.query(testsQuery);

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

    // Default: return daily statistics
    const chartMode = searchParams.get("chartMode") || "all"; // 'all' or 'recent'
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

    // Build annotation filter
    let annotationFilter = "";
    if (chartAnnotationFilter && chartAnnotationFilter !== 'all') {
      const chartAnnotationParamIndex = chartTimeParams.length + 1;
      if (isGroupFilter) {
        annotationFilter = `
          AND EXISTS (
            SELECT 1 FROM TestAnnotations ta
            JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
            WHERE ta.current_test_id = t.test_id
            AND aqo.group_name = $${chartAnnotationParamIndex}
          )`;
      } else {
        annotationFilter = `
          AND EXISTS (
            SELECT 1 FROM TestAnnotations ta
            WHERE ta.current_test_id = t.test_id
            AND ta.annotation_text = $${chartAnnotationParamIndex}
          )`;
      }
    }

    let query: string;
    if (chartMode === "recent") {
      // Show daily statistics for most recent valid test per serial number (excluding INVALID)
      query = `
        WITH daily_latest_tests AS (
          SELECT
            DATE(t.start_time_utc) as test_date,
            t.overall_status,
            i.serial_number,
            t.test_id,
            ROW_NUMBER() OVER (
              PARTITION BY i.serial_number, DATE(t.start_time_utc)
              ORDER BY t.start_time_utc DESC
            ) as rn
          FROM Tests t
          JOIN Inverters i ON t.inv_id = i.inv_id
          WHERE ${timeFilter}
            t.overall_status != 'INVALID'
            ${annotationFilter}
        )
        SELECT
          to_char(test_date, 'YYYY-MM-DD') as test_date,
          COUNT(CASE WHEN overall_status = 'PASS' THEN 1 END) as passed,
          COUNT(CASE WHEN overall_status = 'FAIL' THEN 1 END) as failed
        FROM daily_latest_tests
        WHERE rn = 1
        GROUP BY test_date
        ORDER BY test_date ASC
      `;
    } else {
      // Show daily statistics for all tests
      query = `
        SELECT
          to_char(DATE(t.start_time_utc), 'YYYY-MM-DD') as test_date,
          COUNT(CASE WHEN t.overall_status = 'PASS' THEN 1 END) as passed,
          COUNT(CASE WHEN t.overall_status = 'FAIL' THEN 1 END) as failed
        FROM Tests t
        WHERE ${timeFilter}
          t.overall_status != 'INVALID'
          ${annotationFilter}
        GROUP BY DATE(t.start_time_utc)
        ORDER BY DATE(t.start_time_utc) ASC
      `;
    }

    // Build final params array combining time and annotation filters
    const chartParams = [...chartTimeParams];
    if (chartAnnotationFilter && chartAnnotationFilter !== 'all') {
      chartParams.push(filterValue!);
    }

    const result = chartParams.length > 0
      ? await client.query(query, chartParams)
      : await client.query(query);

    const stats: TestStats[] = result.rows.map((row) => ({
      date: row.test_date,
      passed: parseInt(row.passed) || 0,
      failed: parseInt(row.failed) || 0,
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
