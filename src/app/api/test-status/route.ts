import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDatabaseConfig } from '@/lib/config';
import { requireAuth } from '@/lib/auth-check';

const ALLOWED_STATUSES = ['PASS', 'FAIL', 'INVALID'] as const;
type AllowedStatus = (typeof ALLOWED_STATUSES)[number];

function isAllowedStatus(s: unknown): s is AllowedStatus {
  return typeof s === 'string' && (ALLOWED_STATUSES as readonly string[]).includes(s);
}

/**
 * GET /api/test-status?testId=123
 * Returns append-only revision history for a test's overall_status (newest first).
 */
export async function GET(request: NextRequest) {
  const { error: authError } = await requireAuth();
  if (authError) return authError;

  const testIdParam = request.nextUrl.searchParams.get('testId');
  const testId = testIdParam ? parseInt(testIdParam, 10) : NaN;
  if (!testIdParam || isNaN(testId)) {
    return NextResponse.json(
      { error: 'Query parameter testId is required and must be a number' },
      { status: 400 }
    );
  }

  const client = new Client(getDatabaseConfig());
  try {
    await client.connect();
    await client.query("SET timezone = 'UTC'");

    const exists = await client.query(
      'SELECT test_id FROM Tests WHERE test_id = $1',
      [testId]
    );
    if (exists.rows.length === 0) {
      return NextResponse.json({ error: 'Test not found' }, { status: 404 });
    }

    const result = await client.query(
      `
      SELECT
        revision_id,
        test_id,
        old_status,
        new_status,
        changed_by_email,
        changed_by_name,
        changed_at,
        source
      FROM TestStatusRevisions
      WHERE test_id = $1
      ORDER BY changed_at DESC, revision_id DESC
      `,
      [testId]
    );

    return NextResponse.json({
      test_id: testId,
      revisions: result.rows.map((row) => ({
        revision_id: row.revision_id,
        test_id: row.test_id,
        old_status: row.old_status,
        new_status: row.new_status,
        changed_by_email: row.changed_by_email,
        changed_by_name: row.changed_by_name,
        changed_at: row.changed_at instanceof Date
          ? row.changed_at.toISOString()
          : row.changed_at,
        source: row.source,
      })),
    });
  } catch (error) {
    console.error('Database error (GET test-status):', error);
    return NextResponse.json(
      { error: 'Failed to fetch test status history' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}

/**
 * PATCH /api/test-status
 * Body: { testId, status }
 * Updates Tests.overall_status and appends a TestStatusRevisions row (who/when/from→to).
 */
export async function PATCH(request: NextRequest) {
  const { error: authError, session } = await requireAuth();
  if (authError) return authError;

  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();

    const body = await request.json();
    const { testId, status } = body;

    if (!testId || !status) {
      return NextResponse.json(
        { error: 'Test ID and status are required' },
        { status: 400 }
      );
    }

    if (!isAllowedStatus(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be PASS, FAIL, or INVALID' },
        { status: 400 }
      );
    }

    const changedByEmail = session?.user?.email?.toLowerCase() ?? null;
    const changedByName =
      session?.user?.name?.trim() ||
      (changedByEmail ? changedByEmail.split('@')[0] : null) ||
      (process.env.SKIP_AUTH === 'true' ? 'local-dev' : 'unknown');

    await client.query('BEGIN');

    try {
      const current = await client.query(
        `SELECT test_id, overall_status FROM Tests WHERE test_id = $1 FOR UPDATE`,
        [testId]
      );

      if (current.rows.length === 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Test not found' }, { status: 404 });
      }

      const oldStatus = current.rows[0].overall_status as string;

      // No-op: same status — do not write a revision or touch the row
      if (oldStatus === status) {
        await client.query('COMMIT');
        return NextResponse.json({
          message: 'Status unchanged',
          test_id: testId,
          status: oldStatus,
          unchanged: true,
        });
      }

      const updateResult = await client.query(
        `
        UPDATE Tests
        SET overall_status = $1
        WHERE test_id = $2
        RETURNING test_id, overall_status
        `,
        [status, testId]
      );

      const revResult = await client.query(
        `
        INSERT INTO TestStatusRevisions (
          test_id, old_status, new_status,
          changed_by_email, changed_by_name, source
        )
        VALUES ($1, $2, $3, $4, $5, 'ui')
        RETURNING
          revision_id, test_id, old_status, new_status,
          changed_by_email, changed_by_name, changed_at, source
        `,
        [testId, oldStatus, status, changedByEmail, changedByName]
      );

      await client.query('COMMIT');

      const rev = revResult.rows[0];
      return NextResponse.json({
        message: 'Test status updated successfully',
        test_id: updateResult.rows[0].test_id,
        status: updateResult.rows[0].overall_status,
        previous_status: oldStatus,
        revision: {
          revision_id: rev.revision_id,
          test_id: rev.test_id,
          old_status: rev.old_status,
          new_status: rev.new_status,
          changed_by_email: rev.changed_by_email,
          changed_by_name: rev.changed_by_name,
          changed_at:
            rev.changed_at instanceof Date
              ? rev.changed_at.toISOString()
              : rev.changed_at,
          source: rev.source,
        },
      });
    } catch (inner) {
      await client.query('ROLLBACK');
      throw inner;
    }
  } catch (error) {
    console.error('Database error (PATCH test-status):', error);
    return NextResponse.json(
      { error: 'Failed to update test status' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}
