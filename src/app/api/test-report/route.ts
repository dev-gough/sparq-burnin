import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';

interface DailyReportData {
  date: string;
  total: number;
  passed: number;
  failed: number;
  invalid: number;
  passRate: number;
  failRate: number;
}

interface ReportSummary {
  dateRange: {
    start: string;
    end: string;
  };
  totals: {
    totalTests: number;
    totalPassed: number;
    totalFailed: number;
    totalInvalid: number;
    overallPassRate: number;
    overallFailRate: number;
  };
  dailyData: DailyReportData[];
}

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'burnin_dashboard',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD
};

export async function GET(request: NextRequest) {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    
    const { searchParams } = new URL(request.url);
    const timeRange = searchParams.get('timeRange') || '90d';
    
    let daysToSubtract: number | null = 90;
    if (timeRange === '30d') {
      daysToSubtract = 30;
    } else if (timeRange === '7d') {
      daysToSubtract = 7;
    } else if (timeRange === 'all') {
      daysToSubtract = null;
    }
    
    const whereClause = daysToSubtract 
      ? `WHERE start_time >= CURRENT_DATE - INTERVAL '${daysToSubtract} days'`
      : '';
    
    const query = `
      SELECT 
        to_char(DATE(start_time), 'YYYY-MM-DD') as test_date,
        COUNT(*) as total,
        COUNT(CASE WHEN overall_status = 'PASS' THEN 1 END) as passed,
        COUNT(CASE WHEN overall_status = 'FAIL' THEN 1 END) as failed,
        COUNT(CASE WHEN overall_status = 'INVALID' THEN 1 END) as invalid
      FROM Tests 
      ${whereClause}
      GROUP BY DATE(start_time)
      ORDER BY DATE(start_time) ASC
    `;
    
    const result = await client.query(query);
    
    const dailyData: DailyReportData[] = result.rows.map(row => {
      const total = parseInt(row.total) || 0;
      const passed = parseInt(row.passed) || 0;
      const failed = parseInt(row.failed) || 0;
      const invalid = parseInt(row.invalid) || 0;
      
      return {
        date: row.test_date,
        total,
        passed,
        failed,
        invalid,
        passRate: total > 0 ? Math.round((passed / total) * 10000) / 100 : 0,
        failRate: total > 0 ? Math.round((failed / total) * 10000) / 100 : 0,
      };
    });
    
    // Calculate overall totals
    const totals = dailyData.reduce(
      (acc, day) => ({
        totalTests: acc.totalTests + day.total,
        totalPassed: acc.totalPassed + day.passed,
        totalFailed: acc.totalFailed + day.failed,
        totalInvalid: acc.totalInvalid + day.invalid,
      }),
      { totalTests: 0, totalPassed: 0, totalFailed: 0, totalInvalid: 0 }
    );
    
    const overallPassRate = totals.totalTests > 0 
      ? Math.round((totals.totalPassed / totals.totalTests) * 10000) / 100 
      : 0;
    const overallFailRate = totals.totalTests > 0 
      ? Math.round((totals.totalFailed / totals.totalTests) * 10000) / 100 
      : 0;
    
    const reportData: ReportSummary = {
      dateRange: {
        start: dailyData.length > 0 ? dailyData[0].date : '',
        end: dailyData.length > 0 ? dailyData[dailyData.length - 1].date : '',
      },
      totals: {
        ...totals,
        overallPassRate,
        overallFailRate,
      },
      dailyData,
    };
    
    return NextResponse.json(reportData);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to generate test report' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}