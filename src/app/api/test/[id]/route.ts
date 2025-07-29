import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDatabaseConfig } from '@/lib/config';

interface DataPoint {
  timestamp: string;
  vgrid?: number;
  pgrid?: number;
  qgrid?: number;
  vpv1?: number;
  ppv1?: number;
  vpv2?: number;
  ppv2?: number;
  vpv3?: number;
  ppv3?: number;
  vpv4?: number;
  ppv4?: number;
  frequency?: number;
  vbus?: number;
  extstatus?: number;
  status?: number;
  temperature?: number;
  epv1?: number;
  epv2?: number;
  epv3?: number;
  epv4?: number;
  activeenergy?: number;
  reactiveenergy?: number;
  extstatus_latch?: string;
  status_latch?: string;
  vgrid_inst_latch?: number;
  vntrl_inst_latch?: number;
  igrid_inst_latch?: number;
  vbus_inst_latch?: number;
  vpv1_inst_latch?: number;
  ipv1_inst_latch?: number;
  vpv2_inst_latch?: number;
  ipv2_inst_latch?: number;
  vpv3_inst_latch?: number;
  ipv3_inst_latch?: number;
  vpv4_inst_latch?: number;
  ipv4_inst_latch?: number;
  status_bits?: string;
}

interface FailureInfo {
  test_id: number;
  start_time: string;
  failure_description?: string;
}

interface TestData {
  test_id: number;
  inv_id: number;
  serial_number: string;
  firmware_version: string;
  start_time: string;
  end_time: string;
  overall_status: string;
  failure_description?: string;
  data_points: DataPoint[];
  navigation: {
    previous_failed_test?: FailureInfo;
    next_failed_test?: FailureInfo;
    current_failure_index?: number;
    total_failed_tests: number;
  };
}

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
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
    
    // Get test metadata
    const testQuery = `
      SELECT 
        t.test_id,
        t.inv_id,
        i.serial_number,
        t.firmware_version,
        t.start_time,
        t.end_time,
        t.overall_status,
        t.failure_description
      FROM Tests t
      JOIN Inverters i ON t.inv_id = i.inv_id
      WHERE t.test_id = $1 AND (t.firmware_version != '1.11.11' OR t.firmware_version IS NULL)
    `;
    
    const testResult = await client.query(testQuery, [testId]);
    
    if (testResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Test not found' },
        { status: 404 }
      );
    }
    
    const testInfo = testResult.rows[0];
    
    // Get test data points - select ALL columns
    const dataQuery = `
      SELECT *
      FROM TestData 
      WHERE test_id = $1 
      ORDER BY timestamp ASC
    `;
    
    const dataResult = await client.query(dataQuery, [testId]);
    
    // Get navigation information for failed tests
    const serialNumber = testInfo.serial_number;
    const currentStartTime = testInfo.start_time;
    
    // Find previous failed test (chronologically before current test)
    const previousFailQuery = `
      SELECT t.test_id, t.start_time, t.failure_description
      FROM Tests t 
      JOIN Inverters i ON t.inv_id = i.inv_id 
      WHERE i.serial_number = $1 
        AND t.test_id != $2 
        AND t.overall_status = 'FAIL'
        AND t.start_time < $3
        AND (t.firmware_version != '1.11.11' OR t.firmware_version IS NULL)
      ORDER BY t.start_time DESC
      LIMIT 1
    `;
    
    // Find next failed test (chronologically after current test)
    const nextFailQuery = `
      SELECT t.test_id, t.start_time, t.failure_description
      FROM Tests t 
      JOIN Inverters i ON t.inv_id = i.inv_id 
      WHERE i.serial_number = $1 
        AND t.test_id != $2 
        AND t.overall_status = 'FAIL'
        AND t.start_time > $3
        AND (t.firmware_version != '1.11.11' OR t.firmware_version IS NULL)
      ORDER BY t.start_time ASC
      LIMIT 1
    `;
    
    // Count total failed tests for this serial number
    const totalFailuresQuery = `
      SELECT COUNT(*) as total_count
      FROM Tests t 
      JOIN Inverters i ON t.inv_id = i.inv_id 
      WHERE i.serial_number = $1 
        AND t.overall_status = 'FAIL'
        AND (t.firmware_version != '1.11.11' OR t.firmware_version IS NULL)
    `;
    
    // Get current failure index (position in chronological order of failures)
    const currentIndexQuery = `
      SELECT COUNT(*) + 1 as current_index
      FROM Tests t 
      JOIN Inverters i ON t.inv_id = i.inv_id 
      WHERE i.serial_number = $1 
        AND t.overall_status = 'FAIL'
        AND t.start_time < $2
        AND (t.firmware_version != '1.11.11' OR t.firmware_version IS NULL)
    `;
    
    // Execute navigation queries in parallel
    const [previousFailResult, nextFailResult, totalFailuresResult, currentIndexResult] = await Promise.all([
      client.query(previousFailQuery, [serialNumber, testId, currentStartTime]),
      client.query(nextFailQuery, [serialNumber, testId, currentStartTime]),
      client.query(totalFailuresQuery, [serialNumber]),
      testInfo.overall_status === 'FAIL' ? client.query(currentIndexQuery, [serialNumber, currentStartTime]) : null
    ]);
    
    const navigation = {
      previous_failed_test: previousFailResult.rows.length > 0 ? {
        test_id: previousFailResult.rows[0].test_id,
        start_time: previousFailResult.rows[0].start_time.toISOString(),
        failure_description: previousFailResult.rows[0].failure_description
      } : undefined,
      next_failed_test: nextFailResult.rows.length > 0 ? {
        test_id: nextFailResult.rows[0].test_id,
        start_time: nextFailResult.rows[0].start_time.toISOString(),
        failure_description: nextFailResult.rows[0].failure_description
      } : undefined,
      current_failure_index: currentIndexResult ? parseInt(currentIndexResult.rows[0].current_index) : undefined,
      total_failed_tests: parseInt(totalFailuresResult.rows[0].total_count)
    };
    
    const testData: TestData = {
      test_id: testInfo.test_id,
      inv_id: testInfo.inv_id,
      serial_number: testInfo.serial_number || 'Unknown',
      firmware_version: testInfo.firmware_version || 'Unknown',
      start_time: testInfo.start_time.toISOString(),
      end_time: testInfo.end_time?.toISOString() || new Date().toISOString(),
      overall_status: testInfo.overall_status,
      failure_description: testInfo.failure_description,
      navigation,
      data_points: dataResult.rows.map(row => {
        // Convert timestamp to ISO string, keep all other fields as-is
        const point = { ...row };
        if (point.timestamp) {
          point.timestamp = point.timestamp.toISOString();
        }
        return point;
      })
    };
    
    return NextResponse.json(testData);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch test data' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}