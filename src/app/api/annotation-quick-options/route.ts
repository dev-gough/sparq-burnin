import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDatabaseConfig } from '@/lib/config';

interface QuickOption {
  option_id: number;
  option_text: string;
  group_name: string | null;
  group_color: string | null;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

export async function GET() {
  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();

    const query = `
      SELECT
        aqo.option_id,
        aqo.option_text,
        aqo.group_name,
        ag.group_color,
        aqo.display_order,
        aqo.is_active,
        aqo.created_at
      FROM AnnotationQuickOptions aqo
      LEFT JOIN AnnotationGroups ag ON aqo.group_name = ag.group_name
      WHERE aqo.is_active = true
      ORDER BY
        ag.display_order ASC NULLS LAST,
        aqo.display_order ASC,
        aqo.option_text ASC
    `;

    const result = await client.query(query);

    const options: QuickOption[] = result.rows.map(row => ({
      option_id: row.option_id,
      option_text: row.option_text,
      group_name: row.group_name || null,
      group_color: row.group_color || null,
      display_order: row.display_order,
      is_active: row.is_active,
      created_at: row.created_at.toISOString()
    }));

    return NextResponse.json(options);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch quick options' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}

export async function POST(request: NextRequest) {
  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();

    const body = await request.json();
    const { option_text, group_name = null } = body;

    if (!option_text || option_text.trim().length === 0) {
      return NextResponse.json(
        { error: 'option_text is required' },
        { status: 400 }
      );
    }

    // Get next display order within the group or globally
    let maxOrderQuery: string;
    let orderParams: any[] = [];

    if (group_name) {
      maxOrderQuery = `
        SELECT COALESCE(MAX(display_order), 0) + 1 as next_order
        FROM AnnotationQuickOptions
        WHERE group_name = $1
      `;
      orderParams = [group_name];
    } else {
      maxOrderQuery = `
        SELECT COALESCE(MAX(display_order), 0) + 1 as next_order
        FROM AnnotationQuickOptions
        WHERE group_name IS NULL
      `;
    }

    const orderResult = await client.query(maxOrderQuery, orderParams);
    const nextOrder = orderResult.rows[0].next_order;

    // Insert new option
    const insertQuery = `
      INSERT INTO AnnotationQuickOptions (option_text, group_name, display_order)
      VALUES ($1, $2, $3)
      RETURNING *
    `;

    const result = await client.query(insertQuery, [
      option_text.trim(),
      group_name,
      nextOrder
    ]);

    // Fetch group_color if group exists
    let groupColor = null;
    if (group_name) {
      const colorQuery = `SELECT group_color FROM AnnotationGroups WHERE group_name = $1`;
      const colorResult = await client.query(colorQuery, [group_name]);
      if (colorResult.rows.length > 0) {
        groupColor = colorResult.rows[0].group_color;
      }
    }

    const option: QuickOption = {
      option_id: result.rows[0].option_id,
      option_text: result.rows[0].option_text,
      group_name: result.rows[0].group_name || null,
      group_color: groupColor,
      display_order: result.rows[0].display_order,
      is_active: result.rows[0].is_active,
      created_at: result.rows[0].created_at.toISOString()
    };

    return NextResponse.json(option, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes('duplicate key')) {
      return NextResponse.json(
        { error: 'Option already exists' },
        { status: 409 }
      );
    }
    
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to create quick option' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}