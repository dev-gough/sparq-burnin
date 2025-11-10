import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDatabaseConfig } from '@/lib/config';
import { requireAuth } from '@/lib/auth-check';

interface AnnotationGroup {
  group_id: number;
  group_name: string;
  group_color: string;
  display_order: number;
  created_at: string;
}

export async function GET() {
  // Check authentication
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();

    const query = `
      SELECT group_id, group_name, group_color, display_order, created_at
      FROM AnnotationGroups
      ORDER BY display_order ASC, group_name ASC
    `;

    const result = await client.query(query);

    const groups: AnnotationGroup[] = result.rows.map(row => ({
      group_id: row.group_id,
      group_name: row.group_name,
      group_color: row.group_color,
      display_order: row.display_order,
      created_at: row.created_at.toISOString()
    }));

    return NextResponse.json(groups);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch annotation groups' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}

export async function POST(request: NextRequest) {
  // Check authentication
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();

    const body = await request.json();
    const { group_name, group_color = '#6b7280', display_order = 999 } = body;

    if (!group_name) {
      return NextResponse.json(
        { error: 'group_name is required' },
        { status: 400 }
      );
    }

    const insertQuery = `
      INSERT INTO AnnotationGroups (group_name, group_color, display_order)
      VALUES ($1, $2, $3)
      RETURNING *
    `;

    const result = await client.query(insertQuery, [
      group_name,
      group_color,
      display_order
    ]);

    const group: AnnotationGroup = {
      group_id: result.rows[0].group_id,
      group_name: result.rows[0].group_name,
      group_color: result.rows[0].group_color,
      display_order: result.rows[0].display_order,
      created_at: result.rows[0].created_at.toISOString()
    };

    return NextResponse.json(group, { status: 201 });
  } catch (error: unknown) {
    console.error('Database error:', error);

    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') { // Unique constraint violation
      return NextResponse.json(
        { error: 'A group with this name already exists' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create annotation group' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}
