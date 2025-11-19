import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDatabaseConfig } from '@/lib/config';
import { requireAuth } from '@/lib/auth-check';

interface ContributorStats {
  contributor_name: string;
  total_annotations: number;
  unique_tests_annotated: number;
  percentage_of_tests: number;
  last_activity: string;
  most_used_group: string;
  annotation_groups: { group_name: string; count: number }[];
}

interface TeamStats {
  total_annotations: number;
  total_annotated_tests: number;
  total_failed_tests: number;
  coverage_percentage: number;
  active_contributors_week: number;
  active_contributors_month: number;
}

interface ActivityData {
  date: string;
  annotation_count: number;
  contributor_name: string;
}

export async function GET() {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();

    // Get contributor stats
    const contributorStatsQuery = `
      WITH contributor_base AS (
        SELECT
          COALESCE(created_by, 'Anonymous') as contributor_name,
          COUNT(*) as total_annotations,
          COUNT(DISTINCT current_test_id) as unique_tests_annotated,
          MAX(created_at) as last_activity
        FROM TestAnnotations
        WHERE current_test_id IS NOT NULL
        GROUP BY created_by
      ),
      total_annotated_tests AS (
        SELECT COUNT(DISTINCT current_test_id) as total
        FROM TestAnnotations
        WHERE current_test_id IS NOT NULL
      ),
      annotation_groups AS (
        SELECT
          COALESCE(ta.created_by, 'Anonymous') as contributor_name,
          COALESCE(aqo.group_name, 'Other') as group_name,
          COUNT(*) as group_count
        FROM TestAnnotations ta
        LEFT JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
        WHERE ta.current_test_id IS NOT NULL
        GROUP BY ta.created_by, aqo.group_name
      ),
      most_used_groups AS (
        SELECT DISTINCT ON (contributor_name)
          contributor_name,
          group_name as most_used_group
        FROM annotation_groups
        ORDER BY contributor_name, group_count DESC
      )
      SELECT
        cb.contributor_name,
        cb.total_annotations,
        cb.unique_tests_annotated,
        ROUND((cb.unique_tests_annotated::numeric / NULLIF(tat.total, 0)::numeric) * 100, 2) as percentage_of_tests,
        cb.last_activity,
        COALESCE(mug.most_used_group, 'N/A') as most_used_group
      FROM contributor_base cb
      CROSS JOIN total_annotated_tests tat
      LEFT JOIN most_used_groups mug ON cb.contributor_name = mug.contributor_name
      ORDER BY cb.total_annotations DESC
    `;

    const contributorStatsResult = await client.query(contributorStatsQuery);

    // Get annotation groups breakdown for each contributor
    const groupsQuery = `
      SELECT
        COALESCE(ta.created_by, 'Anonymous') as contributor_name,
        COALESCE(aqo.group_name, 'Other') as group_name,
        ag.group_color,
        COUNT(*) as count
      FROM TestAnnotations ta
      LEFT JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
      LEFT JOIN AnnotationGroups ag ON aqo.group_name = ag.group_name
      WHERE ta.current_test_id IS NOT NULL
      GROUP BY ta.created_by, aqo.group_name, ag.group_color
      ORDER BY contributor_name, count DESC
    `;

    const groupsResult = await client.query(groupsQuery);

    // Get detailed annotation categories for each contributor and group
    const categoriesQuery = `
      SELECT
        COALESCE(ta.created_by, 'Anonymous') as contributor_name,
        COALESCE(aqo.group_name, 'Other') as group_name,
        ta.annotation_text as category_name,
        COUNT(*) as count
      FROM TestAnnotations ta
      LEFT JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
      WHERE ta.current_test_id IS NOT NULL
      GROUP BY ta.created_by, aqo.group_name, ta.annotation_text
      ORDER BY contributor_name, group_name, count DESC
    `;

    const categoriesResult = await client.query(categoriesQuery);

    // Organize categories by contributor and group
    const categoriesByContributorGroup: Record<string, Record<string, { category_name: string; count: number }[]>> = {};
    categoriesResult.rows.forEach((row) => {
      const key = row.contributor_name;
      const groupKey = row.group_name;

      if (!categoriesByContributorGroup[key]) {
        categoriesByContributorGroup[key] = {};
      }
      if (!categoriesByContributorGroup[key][groupKey]) {
        categoriesByContributorGroup[key][groupKey] = [];
      }
      categoriesByContributorGroup[key][groupKey].push({
        category_name: row.category_name,
        count: parseInt(row.count),
      });
    });

    // Organize groups by contributor
    const groupsByContributor: Record<string, { group_name: string; count: number; group_color: string | null; categories: { category_name: string; count: number }[] }[]> = {};
    groupsResult.rows.forEach((row) => {
      if (!groupsByContributor[row.contributor_name]) {
        groupsByContributor[row.contributor_name] = [];
      }
      groupsByContributor[row.contributor_name].push({
        group_name: row.group_name,
        count: parseInt(row.count),
        group_color: row.group_color,
        categories: categoriesByContributorGroup[row.contributor_name]?.[row.group_name] || [],
      });
    });

    // Add groups to contributor stats
    const contributors: ContributorStats[] = contributorStatsResult.rows.map((row) => ({
      contributor_name: row.contributor_name,
      total_annotations: parseInt(row.total_annotations),
      unique_tests_annotated: parseInt(row.unique_tests_annotated),
      percentage_of_tests: parseFloat(row.percentage_of_tests),
      last_activity: row.last_activity,
      most_used_group: row.most_used_group,
      annotation_groups: groupsByContributor[row.contributor_name] || [],
    }));

    // Get team-wide stats
    const teamStatsQuery = `
      WITH annotation_stats AS (
        SELECT
          COUNT(*) as total_annotations,
          COUNT(DISTINCT ta.current_test_id) as total_annotated_tests
        FROM TestAnnotations ta
        INNER JOIN Tests t ON ta.current_test_id = t.test_id
        WHERE ta.current_test_id IS NOT NULL
          AND t.overall_status = 'FAIL'
      ),
      failed_tests AS (
        SELECT COUNT(*) as total_failed_tests
        FROM Tests
        WHERE overall_status = 'FAIL'
      ),
      active_contributors AS (
        SELECT
          COUNT(DISTINCT created_by) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days') as week_active,
          COUNT(DISTINCT created_by) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as month_active
        FROM TestAnnotations
      )
      SELECT
        ast.total_annotations,
        ast.total_annotated_tests,
        ft.total_failed_tests,
        ROUND((ast.total_annotated_tests::numeric / NULLIF(ft.total_failed_tests, 0)::numeric) * 100, 2) as coverage_percentage,
        ac.week_active as active_contributors_week,
        ac.month_active as active_contributors_month
      FROM annotation_stats ast
      CROSS JOIN failed_tests ft
      CROSS JOIN active_contributors ac
    `;

    const teamStatsResult = await client.query(teamStatsQuery);
    const teamStats: TeamStats = {
      total_annotations: parseInt(teamStatsResult.rows[0].total_annotations),
      total_annotated_tests: parseInt(teamStatsResult.rows[0].total_annotated_tests),
      total_failed_tests: parseInt(teamStatsResult.rows[0].total_failed_tests),
      coverage_percentage: parseFloat(teamStatsResult.rows[0].coverage_percentage || '0'),
      active_contributors_week: parseInt(teamStatsResult.rows[0].active_contributors_week),
      active_contributors_month: parseInt(teamStatsResult.rows[0].active_contributors_month),
    };

    // Get activity timeline (last 30 days)
    const activityQuery = `
      SELECT
        TO_CHAR(DATE(created_at), 'YYYY-MM-DD') as date,
        COALESCE(created_by, 'Anonymous') as contributor_name,
        COUNT(*) as annotation_count
      FROM TestAnnotations
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at), created_by
      ORDER BY DATE(created_at) DESC, annotation_count DESC
    `;

    const activityResult = await client.query(activityQuery);
    const activity: ActivityData[] = activityResult.rows.map((row) => ({
      date: row.date,
      contributor_name: row.contributor_name,
      annotation_count: parseInt(row.annotation_count),
    }));

    return NextResponse.json({
      contributors,
      teamStats,
      activity,
    });
  } catch (error) {
    console.error('Error fetching contributor stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch contributor statistics' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}
