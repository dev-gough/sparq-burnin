#!/usr/bin/env tsx

import { Client } from 'pg';
import { getDatabaseConfig } from '../src/lib/config';

async function checkFailedTestSizes() {
  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();

    const query = `
      SELECT
        t.test_id,
        t.overall_status,
        COUNT(td.data_id) as row_count,
        EXTRACT(EPOCH FROM (t.end_time - t.start_time_utc))/3600 as duration_hours
      FROM Tests t
      LEFT JOIN TestData td ON t.test_id = td.test_id
      WHERE t.overall_status = 'FAIL'
      GROUP BY t.test_id, t.overall_status, t.start_time_utc, t.end_time
      ORDER BY row_count DESC
      LIMIT 20
    `;

    const result = await client.query(query);

    console.log('Top 20 Failed Tests by Data Point Count:');
    console.log('='.repeat(80));
    console.log('Test ID | Status | Row Count | Duration (hours) | Rows/Hour');
    console.log('-'.repeat(80));

    for (const row of result.rows) {
      const rowsPerHour = row.duration_hours > 0 ? (row.row_count / row.duration_hours).toFixed(0) : 0;
      console.log(
        `${String(row.test_id).padStart(7)} | ${row.overall_status.padEnd(6)} | ${String(row.row_count).padStart(9)} | ${String(parseFloat(row.duration_hours).toFixed(2)).padStart(16)} | ${String(rowsPerHour).padStart(9)}`
      );
    }

    // Get average for failed tests
    const avgQuery = `
      SELECT
        AVG(row_count) as avg_rows,
        MAX(row_count) as max_rows,
        MIN(row_count) as min_rows
      FROM (
        SELECT COUNT(td.data_id) as row_count
        FROM Tests t
        LEFT JOIN TestData td ON t.test_id = td.test_id
        WHERE t.overall_status = 'FAIL'
        GROUP BY t.test_id
      ) subquery
    `;

    const avgResult = await client.query(avgQuery);
    console.log('\n' + '='.repeat(80));
    console.log('Statistics for Failed Tests:');
    console.log(`Average rows: ${parseFloat(avgResult.rows[0].avg_rows).toFixed(0)}`);
    console.log(`Maximum rows: ${avgResult.rows[0].max_rows}`);
    console.log(`Minimum rows: ${avgResult.rows[0].min_rows}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

checkFailedTestSizes();
