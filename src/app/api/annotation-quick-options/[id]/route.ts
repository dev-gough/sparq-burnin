import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDatabaseConfig } from '@/lib/config';
import { requireAuth } from '@/lib/auth-check';

// GET endpoint to preview affected tests before deletion
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

    const optionId = parseInt(params.id);
    if (isNaN(optionId)) {
      return NextResponse.json(
        { error: 'Invalid option ID' },
        { status: 400 }
      );
    }

    // Get the option text
    const optionQuery = `
      SELECT option_text FROM AnnotationQuickOptions WHERE option_id = $1
    `;
    const optionResult = await client.query(optionQuery, [optionId]);

    if (optionResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Quick option not found' },
        { status: 404 }
      );
    }

    const optionText = optionResult.rows[0].option_text;

    // Find all tests with annotations matching this option text
    const affectedTestsQuery = `
      SELECT DISTINCT
        ta.current_test_id as test_id,
        ta.serial_number,
        ta.start_time,
        t.overall_status
      FROM TestAnnotations ta
      LEFT JOIN Tests t ON ta.current_test_id = t.test_id
      WHERE ta.annotation_text = $1
      ORDER BY ta.start_time DESC
    `;
    const affectedTests = await client.query(affectedTestsQuery, [optionText]);

    return NextResponse.json({
      option_text: optionText,
      affected_count: affectedTests.rows.length,
      affected_tests: affectedTests.rows.map(row => ({
        test_id: row.test_id,
        serial_number: row.serial_number,
        start_time: row.start_time?.toISOString(),
        overall_status: row.overall_status
      }))
    });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch affected tests' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}

export async function PATCH(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();

    const optionId = parseInt(params.id);
    if (isNaN(optionId)) {
      return NextResponse.json(
        { error: 'Invalid option ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { group_name } = body;

    // Validate that the new group exists if group_name is not null
    if (group_name !== null) {
      const groupCheckQuery = `
        SELECT group_name FROM AnnotationGroups WHERE group_name = $1
      `;
      const groupResult = await client.query(groupCheckQuery, [group_name]);

      if (groupResult.rows.length === 0) {
        return NextResponse.json(
          { error: 'Group not found' },
          { status: 404 }
        );
      }
    }

    // Update the quick option's group_name
    const updateQuery = `
      UPDATE AnnotationQuickOptions
      SET group_name = $1
      WHERE option_id = $2
      RETURNING *
    `;

    const result = await client.query(updateQuery, [group_name, optionId]);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Quick option not found' },
        { status: 404 }
      );
    }

    // Fetch group_color if group exists
    let groupColor = null;
    if (group_name) {
      const colorQuery = `SELECT group_color FROM AnnotationGroups WHERE group_name = $1`;
      const colorResult = await client.query(colorQuery, [group_name]);
      if (colorResult.rows.length > 0) {
        groupColor = colorResult.rows[0].group_color;
      }
    }

    const option = {
      option_id: result.rows[0].option_id,
      option_text: result.rows[0].option_text,
      group_name: result.rows[0].group_name || null,
      group_color: groupColor,
      display_order: result.rows[0].display_order,
      is_active: result.rows[0].is_active,
      created_at: result.rows[0].created_at.toISOString()
    };

    return NextResponse.json(option);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to update quick option' },
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
  const params = await props.params;
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();

    const optionId = parseInt(params.id);
    if (isNaN(optionId)) {
      return NextResponse.json(
        { error: 'Invalid option ID' },
        { status: 400 }
      );
    }

    // Get the option text before deletion
    const optionQuery = `
      SELECT option_text FROM AnnotationQuickOptions WHERE option_id = $1
    `;
    const optionResult = await client.query(optionQuery, [optionId]);

    if (optionResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Quick option not found' },
        { status: 404 }
      );
    }

    const optionText = optionResult.rows[0].option_text;

    // Begin transaction
    await client.query('BEGIN');

    try {
      // Delete all test annotations with this text
      const deleteAnnotationsQuery = `
        DELETE FROM TestAnnotations
        WHERE annotation_text = $1
      `;
      const deleteResult = await client.query(deleteAnnotationsQuery, [optionText]);

      // Delete the quick option itself
      const deleteOptionQuery = `
        DELETE FROM AnnotationQuickOptions
        WHERE option_id = $1
      `;
      await client.query(deleteOptionQuery, [optionId]);

      // Commit transaction
      await client.query('COMMIT');

      return NextResponse.json({
        success: true,
        deleted_annotations_count: deleteResult.rowCount || 0
      });
    } catch (error) {
      // Rollback transaction on error
      await client.query('ROLLBACK');
      throw error;
    }
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to delete quick option' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}
