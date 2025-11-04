import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { getDatabaseConfig } from '@/lib/config';

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
}


export async function GET(request: NextRequest) {
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

      let summaryQuery: string;
      let timeFilter = "";

      // Add time range filter if specified
      if (summaryTimeRange && summaryTimeRange !== "all") {
        let days: number;
        switch (summaryTimeRange) {
          case "7d":
            days = 7;
            break;
          case "30d":
            days = 30;
            break;
          case "90d":
            days = 90;
            break;
          default:
            days = 90;
        }
        timeFilter = `AND t.start_time_utc >= CURRENT_DATE - INTERVAL '${days} days'`;
      }

      if (summaryChartMode === "recent") {
        // Count most recent valid test per serial number (excluding INVALID)
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
        // Count all tests
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

      const summaryResult = await client.query(summaryQuery);
      const row = summaryResult.rows[0];

      const total = parseInt(row.total) || 0;
      const passed = parseInt(row.passed) || 0;
      const failed = parseInt(row.failed) || 0;
      const failureRate = total > 0 ? (failed / total) * 100 : 0;

      const summaryStats: SummaryStats = {
        total,
        passed,
        failed,
        failureRate: Math.round(failureRate * 100) / 100,
      };

      return NextResponse.json(summaryStats);
    }

    if (view === "tests") {
      // Get detailed test records for the data table
      const latestOnly = searchParams.get("latestOnly") === "true";

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
            test_id, inv_id, serial_number, firmware_version, duration,
            non_zero_status_flags, status, failure_reason, start_time
          FROM latest_tests
          WHERE rn = 1
          ORDER BY start_time_utc DESC
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
            t.start_time_utc as start_time
          FROM Tests t
          JOIN Inverters i ON t.inv_id = i.inv_id
          ORDER BY t.start_time_utc DESC
          LIMIT 10000
        `;
      }

      const result = await client.query(testsQuery);

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

    // Default: return daily statistics
    const chartMode = searchParams.get("chartMode") || "all"; // 'all' or 'recent'
    const timeRange = searchParams.get("timeRange");

    // Build time filter based on timeRange parameter
    let timeFilter = "";
    if (timeRange && timeRange !== "all") {
      let days: number;
      switch (timeRange) {
        case "7d":
          days = 7;
          break;
        case "30d":
          days = 30;
          break;
        case "90d":
          days = 90;
          break;
        default:
          days = 90;
      }
      timeFilter = `t.start_time_utc >= CURRENT_DATE - INTERVAL '${days} days' AND`;
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
            ROW_NUMBER() OVER (
              PARTITION BY i.serial_number, DATE(t.start_time_utc)
              ORDER BY t.start_time_utc DESC
            ) as rn
          FROM Tests t
          JOIN Inverters i ON t.inv_id = i.inv_id
          WHERE ${timeFilter}
            t.overall_status != 'INVALID'
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
          to_char(DATE(start_time_utc), 'YYYY-MM-DD') as test_date,
          COUNT(CASE WHEN overall_status = 'PASS' THEN 1 END) as passed,
          COUNT(CASE WHEN overall_status = 'FAIL' THEN 1 END) as failed
        FROM Tests
        WHERE ${timeFilter}
          overall_status != 'INVALID'
        GROUP BY DATE(start_time_utc)
        ORDER BY DATE(start_time_utc) ASC
      `;
    }

    const result = await client.query(query);

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
