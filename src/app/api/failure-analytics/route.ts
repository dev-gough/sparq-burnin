import { NextRequest, NextResponse } from "next/server";
import { Client } from "pg";
import { getDatabaseConfig } from "@/lib/config";
import { requireAuth } from "@/lib/auth-check";
import { validateTimeRange, getTimeRangeDays } from "@/lib/validation";

export async function GET(request: NextRequest) {
  // Check authentication
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();
    await client.query("SET timezone = 'UTC'");

    const { searchParams } = new URL(request.url);
    const chartMode = searchParams.get("chartMode") || "recent";
    const timeRangeParam = searchParams.get("timeRange");

    // Validate time range
    const validatedTimeRange = validateTimeRange(timeRangeParam);

    // Build time filter
    let timeFilter = "";
    if (validatedTimeRange && validatedTimeRange !== "all") {
      const days = getTimeRangeDays(validatedTimeRange);
      if (days !== null) {
        timeFilter = `AND t.start_time_utc >= CURRENT_DATE - INTERVAL '${days} days'`;
      }
    }

    // Build base query depending on chartMode
    let baseTestsQuery: string;
    if (chartMode === "recent") {
      // Latest test per serial number
      baseTestsQuery = `
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
        SELECT * FROM latest_tests WHERE rn = 1
      `;
    } else {
      // All tests
      baseTestsQuery = `
        SELECT t.*, i.serial_number
        FROM Tests t
        JOIN Inverters i ON t.inv_id = i.inv_id
        WHERE t.overall_status != 'INVALID' ${timeFilter}
      `;
    }

    // Get total tests and failed tests count
    const countsResult = await client.query(`
      WITH base_tests AS (${baseTestsQuery})
      SELECT
        COUNT(*) as total_tests,
        COUNT(*) FILTER (WHERE overall_status = 'FAIL') as total_failed_tests
      FROM base_tests
    `);

    const totalTests = parseInt(countsResult.rows[0].total_tests);
    const totalFailedTests = parseInt(countsResult.rows[0].total_failed_tests);

    // Get failures by category (option_text)
    const categoriesResult = await client.query(`
      WITH base_tests AS (${baseTestsQuery})
      SELECT
        aqo.option_text as name,
        COUNT(*) as count
      FROM TestAnnotations ta
      JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
      JOIN base_tests t ON ta.current_test_id = t.test_id
      WHERE t.overall_status = 'FAIL'
        AND ta.current_test_id IS NOT NULL
      GROUP BY aqo.option_text
      ORDER BY count DESC
    `);

    const categories = categoriesResult.rows.map(row => ({
      name: row.name,
      count: parseInt(row.count),
      percentage_all: totalTests > 0 ? (parseInt(row.count) / totalTests) * 100 : 0,
      percentage_failed: totalFailedTests > 0 ? (parseInt(row.count) / totalFailedTests) * 100 : 0,
    }));

    // Get failures by group (group_name)
    const groupsResult = await client.query(`
      WITH base_tests AS (${baseTestsQuery})
      SELECT
        COALESCE(aqo.group_name, 'Other') as name,
        ag.group_color,
        COUNT(*) as count
      FROM TestAnnotations ta
      LEFT JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
      LEFT JOIN AnnotationGroups ag ON aqo.group_name = ag.group_name
      JOIN base_tests t ON ta.current_test_id = t.test_id
      WHERE t.overall_status = 'FAIL'
        AND ta.current_test_id IS NOT NULL
      GROUP BY aqo.group_name, ag.group_color
      ORDER BY count DESC
    `);

    const groups = groupsResult.rows.map(row => ({
      name: row.name,
      count: parseInt(row.count),
      group_color: row.group_color,
      percentage_all: totalTests > 0 ? (parseInt(row.count) / totalTests) * 100 : 0,
      percentage_failed: totalFailedTests > 0 ? (parseInt(row.count) / totalFailedTests) * 100 : 0,
    }));

    // Get category timeline (failures by category over time)
    const categoryTimelineResult = await client.query(`
      WITH base_tests AS (${baseTestsQuery})
      SELECT
        TO_CHAR(DATE(t.start_time_utc), 'YYYY-MM-DD') as date,
        aqo.option_text as category,
        COUNT(*) as count
      FROM TestAnnotations ta
      JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
      JOIN base_tests t ON ta.current_test_id = t.test_id
      WHERE t.overall_status = 'FAIL'
        AND ta.current_test_id IS NOT NULL
      GROUP BY DATE(t.start_time_utc), aqo.option_text
      ORDER BY date
    `);

    // Transform category timeline into chart-friendly format
    const categoryTimelineMap = new Map<string, Record<string, number>>();
    categoryTimelineResult.rows.forEach(row => {
      const date = row.date;
      const category = row.category;
      const count = parseInt(row.count);

      if (!categoryTimelineMap.has(date)) {
        categoryTimelineMap.set(date, {});
      }
      categoryTimelineMap.get(date)![category] = count;
    });

    const categoryTimeline = Array.from(categoryTimelineMap.entries()).map(([date, data]) => ({
      date,
      ...data,
    }));

    // Get group timeline (failures by group over time)
    const groupTimelineResult = await client.query(`
      WITH base_tests AS (${baseTestsQuery})
      SELECT
        TO_CHAR(DATE(t.start_time_utc), 'YYYY-MM-DD') as date,
        COALESCE(aqo.group_name, 'Other') as group_name,
        COUNT(*) as count
      FROM TestAnnotations ta
      LEFT JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
      JOIN base_tests t ON ta.current_test_id = t.test_id
      WHERE t.overall_status = 'FAIL'
        AND ta.current_test_id IS NOT NULL
      GROUP BY DATE(t.start_time_utc), aqo.group_name
      ORDER BY date
    `);

    // Transform group timeline into chart-friendly format
    const groupTimelineMap = new Map<string, Record<string, number>>();
    groupTimelineResult.rows.forEach(row => {
      const date = row.date;
      const groupName = row.group_name;
      const count = parseInt(row.count);

      if (!groupTimelineMap.has(date)) {
        groupTimelineMap.set(date, {});
      }
      groupTimelineMap.get(date)![groupName] = count;
    });

    const groupTimeline = Array.from(groupTimelineMap.entries()).map(([date, data]) => ({
      date,
      ...data,
    }));

    return NextResponse.json({
      totalTests,
      totalFailedTests,
      categories,
      groups,
      categoryTimeline,
      groupTimeline,
    });
  } catch (error) {
    console.error("Error fetching failure analytics:", error);
    return NextResponse.json(
      { error: "Failed to fetch failure analytics data" },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}
