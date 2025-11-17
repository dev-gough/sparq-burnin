import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDatabaseConfig } from '@/lib/config';
import { requireAuth } from '@/lib/auth-check';

export async function GET() {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();

    const query = `
      SELECT COUNT(*) as count
      FROM Tests t
      LEFT JOIN TestAnnotations ta ON t.test_id = ta.current_test_id
      WHERE t.overall_status = 'FAIL'
        AND ta.annotation_id IS NULL
    `;

    const result = await client.query(query);
    const count = parseInt(result.rows[0].count);

    return NextResponse.json({ count });
  } catch (error) {
    console.error('Error fetching todo count:', error);
    return NextResponse.json({ count: 0 }, { status: 500 });
  } finally {
    await client.end();
  }
}
