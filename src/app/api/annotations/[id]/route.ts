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
  created_by?: string;
  author_email?: string;
  created_at: string;
  updated_at: string;
  current_test_id?: number;
}

export async function PUT(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const params = await props.params;
  const client = new Client(getDatabaseConfig());
  
  try {
    await client.connect();
    
    const annotationId = parseInt(params.id);
    if (isNaN(annotationId)) {
      return NextResponse.json(
        { error: 'Invalid annotation ID' },
        { status: 400 }
      );
    }
    
    const body = await request.json();
    const { annotation_text } = body;

    if (!annotation_text) {
      return NextResponse.json(
        { error: 'annotation_text is required' },
        { status: 400 }
      );
    }

    // Update annotation (preserve original author information)
    const updateQuery = `
      UPDATE TestAnnotations
      SET
        annotation_text = $1,
        updated_at = CURRENT_TIMESTAMP
      WHERE annotation_id = $2
      RETURNING *
    `;

    const result = await client.query(updateQuery, [
      annotation_text,
      annotationId
    ]);
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Annotation not found' },
        { status: 404 }
      );
    }
    
    const annotation: Annotation = {
      annotation_id: result.rows[0].annotation_id,
      serial_number: result.rows[0].serial_number,
      start_time: result.rows[0].start_time.toISOString(),
      annotation_type: result.rows[0].annotation_type,
      annotation_text: result.rows[0].annotation_text,
      created_by: result.rows[0].created_by,
      author_email: result.rows[0].author_email,
      created_at: result.rows[0].created_at.toISOString(),
      updated_at: result.rows[0].updated_at.toISOString(),
      current_test_id: result.rows[0].current_test_id
    };
    
    return NextResponse.json(annotation);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to update annotation' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}

export async function DELETE(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const params = await props.params;
  const client = new Client(getDatabaseConfig());
  
  try {
    await client.connect();
    
    const annotationId = parseInt(params.id);
    if (isNaN(annotationId)) {
      return NextResponse.json(
        { error: 'Invalid annotation ID' },
        { status: 400 }
      );
    }
    
    // Delete annotation
    const deleteQuery = `
      DELETE FROM TestAnnotations 
      WHERE annotation_id = $1
      RETURNING annotation_id
    `;
    
    const result = await client.query(deleteQuery, [annotationId]);
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Annotation not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({ 
      message: 'Annotation deleted successfully',
      annotation_id: result.rows[0].annotation_id
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to delete annotation' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}