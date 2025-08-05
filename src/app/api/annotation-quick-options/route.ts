import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDatabaseConfig } from '@/lib/config';

interface QuickOption {
  option_id: number;
  option_text: string;
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
        option_id,
        option_text,
        display_order,
        is_active,
        created_at
      FROM AnnotationQuickOptions
      WHERE is_active = true
      ORDER BY display_order ASC, option_text ASC
    `;
    
    const result = await client.query(query);
    
    const options: QuickOption[] = result.rows.map(row => ({
      option_id: row.option_id,
      option_text: row.option_text,
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
    const { option_text } = body;
    
    if (!option_text || option_text.trim().length === 0) {
      return NextResponse.json(
        { error: 'option_text is required' },
        { status: 400 }
      );
    }
    
    // Get next display order
    const maxOrderQuery = `
      SELECT COALESCE(MAX(display_order), 0) + 1 as next_order
      FROM AnnotationQuickOptions
    `;
    
    const orderResult = await client.query(maxOrderQuery);
    const nextOrder = orderResult.rows[0].next_order;
    
    // Insert new option
    const insertQuery = `
      INSERT INTO AnnotationQuickOptions (option_text, display_order)
      VALUES ($1, $2)
      RETURNING *
    `;
    
    const result = await client.query(insertQuery, [
      option_text.trim(),
      nextOrder
    ]);
    
    const option: QuickOption = {
      option_id: result.rows[0].option_id,
      option_text: result.rows[0].option_text,
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