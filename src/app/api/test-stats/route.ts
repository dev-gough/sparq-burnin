import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';

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
  passed: boolean;
  failure_reason: string | null;
  start_time: string;
}

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'burnin_dashboard',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'root',
};

export async function GET(request: NextRequest) {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view');
    
    if (view === 'summary') {
      // Get summary statistics
      const summaryQuery = `
        SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN overall_status = 'PASS' THEN 1 END) as passed,
          COUNT(CASE WHEN overall_status = 'FAIL' THEN 1 END) as failed
        FROM Tests
        WHERE firmware_version != '1.11.11' OR firmware_version IS NULL
      `;
      
      const summaryResult = await client.query(summaryQuery);
      const row = summaryResult.rows[0];
      
      const total = parseInt(row.total) || 0;
      const passed = parseInt(row.passed) || 0;
      const failed = parseInt(row.failed) || 0;
      const failureRate = total > 0 ? (failed / total * 100) : 0;
      
      const summaryStats: SummaryStats = {
        total,
        passed,
        failed,
        failureRate: Math.round(failureRate * 100) / 100
      };
      
      return NextResponse.json(summaryStats);
    }
    
    if (view === 'tests') {
      // Get detailed test records for the data table
      const testsQuery = `
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
          (t.overall_status = 'PASS') as passed,
          t.failure_description as failure_reason,
          t.start_time
        FROM Tests t
        JOIN Inverters i ON t.inv_id = i.inv_id
        WHERE t.firmware_version != '1.11.11' OR t.firmware_version IS NULL
        ORDER BY t.start_time DESC
        LIMIT 1000
      `;
      const result = await client.query(testsQuery);

      const tests: TestRecord[] = result.rows.map(row => ({
        test_id: row.test_id,
        inv_id: row.inv_id,
        serial_number: row.serial_number || 'Unknown',
        firmware_version: row.firmware_version || 'Unknown',
        duration: Math.round(row.duration) || 0,
        non_zero_status_flags: row.non_zero_status_flags || 0,
        passed: row.passed || false,
        failure_reason: row.failure_reason || null,
        start_time: row.start_time ? row.start_time.toISOString() : '',
      }));

      return NextResponse.json(tests);
    }

    if (view === 'firmware-versions') {
      // Get unique firmware versions
      const firmwareQuery = `
        SELECT DISTINCT firmware_version
        FROM Tests
        WHERE firmware_version IS NOT NULL AND firmware_version != '' AND firmware_version != '1.11.11'
        ORDER BY firmware_version DESC
      `;
      const result = await client.query(firmwareQuery);
      const versions = result.rows.map(row => row.firmware_version);
      return NextResponse.json(versions);
    }

    // Default: return daily statistics
    const query = `
      SELECT 
        to_char(DATE(start_time), 'YYYY-MM-DD') as test_date,
        COUNT(CASE WHEN overall_status = 'PASS' THEN 1 END) as passed,
        COUNT(CASE WHEN overall_status = 'FAIL' THEN 1 END) as failed
      FROM Tests 
      WHERE start_time >= CURRENT_DATE - INTERVAL '90 days'
        AND (firmware_version != '1.11.11' OR firmware_version IS NULL)
      GROUP BY DATE(start_time)
      ORDER BY DATE(start_time) ASC
    `;
    
    const result = await client.query(query);
    
    const stats: TestStats[] = result.rows.map(row => ({
      date: row.test_date,
      passed: parseInt(row.passed) || 0,
      failed: parseInt(row.failed) || 0,
    }));
    
    return NextResponse.json(stats);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch test statistics' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}