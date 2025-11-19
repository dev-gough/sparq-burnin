import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDatabaseConfig } from '@/lib/config';
import { requireAuth } from '@/lib/auth-check';

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

    const groupId = parseInt(params.id);
    if (isNaN(groupId)) {
      return NextResponse.json(
        { error: 'Invalid group ID' },
        { status: 400 }
      );
    }

    // First, get the group name
    const groupQuery = `
      SELECT group_name FROM AnnotationGroups WHERE group_id = $1
    `;
    const groupResult = await client.query(groupQuery, [groupId]);

    if (groupResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Group not found' },
        { status: 404 }
      );
    }

    const groupName = groupResult.rows[0].group_name;

    // Check if the group has any quick options
    const optionsCheckQuery = `
      SELECT COUNT(*) as count
      FROM AnnotationQuickOptions
      WHERE group_name = $1
    `;
    const optionsResult = await client.query(optionsCheckQuery, [groupName]);
    const optionCount = parseInt(optionsResult.rows[0].count);

    if (optionCount > 0) {
      return NextResponse.json(
        {
          error: 'Cannot delete group with existing options',
          message: `This group contains ${optionCount} option(s). Please remove or reassign all options before deleting the group.`
        },
        { status: 409 }
      );
    }

    // Delete the group
    const deleteQuery = `
      DELETE FROM AnnotationGroups WHERE group_id = $1
    `;
    await client.query(deleteQuery, [groupId]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to delete annotation group' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}
