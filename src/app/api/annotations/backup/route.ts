import { NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDatabaseConfig } from '@/lib/config';
import { requireAuth } from '@/lib/auth-check';

// Quote a single field for RFC 4180 CSV output.
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

const COLUMNS = [
  'annotation_id',
  'serial_number',
  'start_time',
  'annotation_type',
  'annotation_text',
  'created_by',
  'author_email',
  'created_at',
  'updated_at',
  'current_test_id',
] as const;

export async function GET() {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();
    await client.query("SET timezone = 'UTC'");

    const result = await client.query(
      `SELECT
         annotation_id,
         serial_number,
         start_time,
         annotation_type,
         annotation_text,
         created_by,
         author_email,
         created_at,
         updated_at,
         current_test_id
       FROM TestAnnotations
       ORDER BY annotation_id ASC`
    );

    const lines: string[] = [];
    lines.push(COLUMNS.join(','));
    for (const row of result.rows) {
      lines.push(COLUMNS.map((c) => csvEscape(row[c])).join(','));
    }
    const csv = lines.join('\n') + '\n';

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `testannotations-backup-${stamp}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'X-Annotation-Count': String(result.rows.length),
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Annotation backup error:', error);
    return NextResponse.json(
      { error: 'Failed to back up annotations' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}
