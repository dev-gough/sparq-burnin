import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDatabaseConfig } from '@/lib/config';
import { requireAuth } from '@/lib/auth-check';

interface UnannotatedTest {
  test_id: number;
  serial_number: string;
  start_time: string;
  end_time: string;
  duration_hours: number;
  firmware_version: string;
  overall_status: string;
  failure_description: string;
}

export async function GET() {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();

    // Get all failed tests without annotations
    const query = `
      SELECT
        t.test_id,
        i.serial_number,
        t.start_time_utc as start_time,
        t.end_time,
        EXTRACT(EPOCH FROM (t.end_time - t.start_time_utc)) / 3600 as duration_hours,
        t.firmware_version,
        t.overall_status,
        t.failure_description
      FROM Tests t
      JOIN Inverters i ON t.inv_id = i.inv_id
      LEFT JOIN TestAnnotations ta ON t.test_id = ta.current_test_id
      WHERE t.overall_status = 'FAIL'
        AND ta.annotation_id IS NULL
      ORDER BY t.start_time_utc DESC
    `;

    const result = await client.query(query);

    const tests: UnannotatedTest[] = result.rows.map((row) => ({
      test_id: row.test_id,
      serial_number: row.serial_number,
      start_time: row.start_time,
      end_time: row.end_time,
      duration_hours: parseFloat(row.duration_hours),
      firmware_version: row.firmware_version,
      overall_status: row.overall_status,
      failure_description: row.failure_description || 'No description',
    }));

    return NextResponse.json({
      tests,
      total_count: tests.length,
    });
  } catch (error) {
    console.error('Error fetching unannotated tests:', error);
    return NextResponse.json(
      { error: 'Failed to fetch unannotated tests' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}
