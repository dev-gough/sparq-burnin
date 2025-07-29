import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDatabaseConfig } from '@/lib/config';

export async function PATCH(request: NextRequest) {
  const client = new Client(getDatabaseConfig());
  
  try {
    await client.connect();
    
    const { testId, status } = await request.json();
    
    // Validate inputs
    if (!testId || !status) {
      return NextResponse.json(
        { error: 'Test ID and status are required' },
        { status: 400 }
      );
    }
    
    if (!['PASS', 'FAIL', 'INVALID'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be PASS, FAIL, or INVALID' },
        { status: 400 }
      );
    }
    
    // Update the test status
    const updateQuery = `
      UPDATE Tests 
      SET overall_status = $1
      WHERE test_id = $2
      RETURNING test_id, overall_status
    `;
    
    const result = await client.query(updateQuery, [status, testId]);
    
    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: 'Test not found' },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      message: 'Test status updated successfully',
      test_id: result.rows[0].test_id,
      status: result.rows[0].overall_status
    });
    
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to update test status' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}