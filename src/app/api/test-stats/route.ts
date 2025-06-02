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
    
    // Default: return daily statistics
    const query = `
      SELECT 
        DATE(start_time) as test_date,
        COUNT(CASE WHEN overall_status = 'PASS' THEN 1 END) as passed,
        COUNT(CASE WHEN overall_status = 'FAIL' THEN 1 END) as failed
      FROM Tests 
      WHERE start_time >= CURRENT_DATE - INTERVAL '90 days'
      GROUP BY DATE(start_time)
      ORDER BY test_date ASC
    `;
    
    const result = await client.query(query);
    
    const stats: TestStats[] = result.rows.map(row => ({
      date: row.test_date.toISOString().split('T')[0],
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