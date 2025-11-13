import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDatabaseConfig } from '@/lib/config';
import { requireAuth } from '@/lib/auth-check';

interface Annotation {
  annotation_id: number;
  serial_number: string;
  start_time: string;
  annotation_type: string;
  annotation_text: string;
  group_name: string | null;
  group_color: string | null;
  created_by?: string;
  author_email?: string;
  created_at: string;
  updated_at: string;
  current_test_id?: number;
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();

    const testId = parseInt(params.id);
    if (isNaN(testId)) {
      return NextResponse.json(
        { error: 'Invalid test ID' },
        { status: 400 }
      );
    }

    // Get annotations for this test with group information
    const query = `
      SELECT
        ta.annotation_id,
        ta.serial_number,
        ta.start_time,
        ta.annotation_type,
        ta.annotation_text,
        ta.created_by,
        ta.author_email,
        ta.created_at,
        ta.updated_at,
        ta.current_test_id,
        aqo.group_name,
        ag.group_color
      FROM TestAnnotations ta
      LEFT JOIN AnnotationQuickOptions aqo ON ta.annotation_text = aqo.option_text
      LEFT JOIN AnnotationGroups ag ON aqo.group_name = ag.group_name
      WHERE ta.current_test_id = $1
      ORDER BY ta.created_at DESC
    `;

    const result = await client.query(query, [testId]);

    const annotations: Annotation[] = result.rows.map(row => ({
      annotation_id: row.annotation_id,
      serial_number: row.serial_number,
      start_time: row.start_time.toISOString(),
      annotation_type: row.annotation_type,
      annotation_text: row.annotation_text,
      group_name: row.group_name || null,
      group_color: row.group_color || null,
      created_by: row.created_by,
      author_email: row.author_email,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
      current_test_id: row.current_test_id
    }));

    return NextResponse.json(annotations);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch annotations' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}

export async function POST(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const { error: authError, session } = await requireAuth();
  if (authError) return authError;

  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();

    const testId = parseInt(params.id);
    if (isNaN(testId)) {
      return NextResponse.json(
        { error: 'Invalid test ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { annotation_type, annotation_text } = body;

    if (!annotation_type || !annotation_text) {
      return NextResponse.json(
        { error: 'annotation_type and annotation_text are required' },
        { status: 400 }
      );
    }

    // Extract author information from authenticated session
    const created_by = session?.user?.name || 'Anonymous';
    const author_email = session?.user?.email || null;

    // Get test details for serial_number and start_time
    const testQuery = `
      SELECT i.serial_number, t.start_time_utc as start_time
      FROM Tests t
      JOIN Inverters i ON t.inv_id = i.inv_id
      WHERE t.test_id = $1
    `;

    const testResult = await client.query(testQuery, [testId]);

    if (testResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Test not found' },
        { status: 404 }
      );
    }

    const { serial_number, start_time } = testResult.rows[0];

    // Insert annotation (no conflict handling - allow multiple annotations per type)
    const insertQuery = `
      INSERT INTO TestAnnotations (
        serial_number, start_time, annotation_type, annotation_text,
        created_by, author_email, current_test_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const result = await client.query(insertQuery, [
      serial_number,
      start_time,
      annotation_type,
      annotation_text,
      created_by,
      author_email,
      testId
    ]);

    // Fetch group information for the annotation
    const groupQuery = `
      SELECT aqo.group_name, ag.group_color
      FROM AnnotationQuickOptions aqo
      LEFT JOIN AnnotationGroups ag ON aqo.group_name = ag.group_name
      WHERE aqo.option_text = $1
    `;
    const groupResult = await client.query(groupQuery, [annotation_text]);
    const groupInfo = groupResult.rows[0] || { group_name: null, group_color: null };

    const annotation: Annotation = {
      annotation_id: result.rows[0].annotation_id,
      serial_number: result.rows[0].serial_number,
      start_time: result.rows[0].start_time.toISOString(),
      annotation_type: result.rows[0].annotation_type,
      annotation_text: result.rows[0].annotation_text,
      group_name: groupInfo.group_name,
      group_color: groupInfo.group_color,
      created_by: result.rows[0].created_by,
      author_email: result.rows[0].author_email,
      created_at: result.rows[0].created_at.toISOString(),
      updated_at: result.rows[0].updated_at.toISOString(),
      current_test_id: result.rows[0].current_test_id
    };

    return NextResponse.json(annotation, { status: 201 });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to create annotation' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}