import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDatabaseConfig } from '@/lib/config';
import { requireAuth } from '@/lib/auth-check';
import { Profiler } from '../../../../../scripts/profiler';

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
  const profiler = new Profiler();

  profiler.start('total_request');

  const { error: authError } = await requireAuth();
  if (authError) return authError;

  // Parse query parameters
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') || 'quick'; // 'quick' or 'full'
  const targetPoints = 1000; // Target number of points for decimated data

  const client = new Client(getDatabaseConfig());

  try {
    await profiler.time('db_connect', async () => {
      await client.connect();
    });

    const testId = parseInt(params.id);
    if (isNaN(testId)) {
      return NextResponse.json(
        { error: 'Invalid test ID' },
        { status: 400 }
      );
    }
    
    // Set session timezone to UTC for consistent timestamp handling
    await client.query("SET timezone = 'UTC'");
    
    // Get test metadata
    const testQuery = `
      SELECT
        t.test_id,
        t.inv_id,
        i.serial_number,
        t.firmware_version,
        t.start_time_utc as start_time,
        t.end_time,
        t.overall_status,
        t.failure_description
      FROM Tests t
      JOIN Inverters i ON t.inv_id = i.inv_id
      WHERE t.test_id = $1 AND (t.firmware_version != '1.11.11' OR t.firmware_version IS NULL)
    `;

    const testResult = await profiler.time('query_test_metadata', async () => {
      return await client.query(testQuery, [testId]);
    });
    
    if (testResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Test not found' },
        { status: 404 }
      );
    }
    
    const testInfo = testResult.rows[0];

    // First, get total point count for metadata
    const countQuery = `SELECT COUNT(*) as total FROM TestData WHERE test_id = $1`;
    const countResult = await profiler.time('query_count', async () => {
      return await client.query(countQuery, [testId]);
    });
    const totalPoints = parseInt(countResult.rows[0].total);

    // Build data query based on mode
    let dataQuery: string;

    if (mode === 'quick' && totalPoints > targetPoints) {
      // Decimated query: Sample evenly across time range using row_number
      // This ensures we get evenly distributed points across the entire test duration
      const decimationFactor = Math.ceil(totalPoints / targetPoints);

      dataQuery = `
        WITH numbered_rows AS (
          SELECT
            data_id, test_id,
            COALESCE(timestamp_utc, timestamp AT TIME ZONE 'UTC') as timestamp,
            vgrid, pgrid, qgrid, vpv1, ppv1, vpv2, ppv2, vpv3, ppv3, vpv4, ppv4,
            frequency, vbus, extstatus, status, temperature, epv1, epv2, epv3, epv4,
            active_energy, reactive_energy, extstatus_latch, status_latch,
            vgrid_inst_latch, vntrl_inst_latch, igrid_inst_latch, vbus_inst_latch,
            vpv1_inst_latch, ipv1_inst_latch, vpv2_inst_latch, ipv2_inst_latch,
            vpv3_inst_latch, ipv3_inst_latch, vpv4_inst_latch, ipv4_inst_latch,
            status_bits, source_file, created_at,
            ROW_NUMBER() OVER (ORDER BY COALESCE(timestamp_utc, timestamp)) as rn
          FROM TestData
          WHERE test_id = $1
        )
        SELECT
          data_id, test_id, timestamp, vgrid, pgrid, qgrid, vpv1, ppv1, vpv2, ppv2,
          vpv3, ppv3, vpv4, ppv4, frequency, vbus, extstatus, status, temperature,
          epv1, epv2, epv3, epv4, active_energy, reactive_energy, extstatus_latch,
          status_latch, vgrid_inst_latch, vntrl_inst_latch, igrid_inst_latch,
          vbus_inst_latch, vpv1_inst_latch, ipv1_inst_latch, vpv2_inst_latch,
          ipv2_inst_latch, vpv3_inst_latch, ipv3_inst_latch, vpv4_inst_latch,
          ipv4_inst_latch, status_bits, source_file, created_at
        FROM numbered_rows
        WHERE MOD(rn, ${decimationFactor}) = 0
        ORDER BY timestamp ASC
      `;
    } else {
      // Full query: Return all data points
      dataQuery = `
        SELECT
          data_id, test_id,
          COALESCE(timestamp_utc, timestamp AT TIME ZONE 'UTC') as timestamp,
          vgrid, pgrid, qgrid, vpv1, ppv1, vpv2, ppv2, vpv3, ppv3, vpv4, ppv4,
          frequency, vbus, extstatus, status, temperature, epv1, epv2, epv3, epv4,
          active_energy, reactive_energy, extstatus_latch, status_latch,
          vgrid_inst_latch, vntrl_inst_latch, igrid_inst_latch, vbus_inst_latch,
          vpv1_inst_latch, ipv1_inst_latch, vpv2_inst_latch, ipv2_inst_latch,
          vpv3_inst_latch, ipv3_inst_latch, vpv4_inst_latch, ipv4_inst_latch,
          status_bits, source_file, created_at
        FROM TestData
        WHERE test_id = $1
        ORDER BY COALESCE(timestamp_utc, timestamp) ASC
      `;
    }

    const dataResult = await profiler.time('query_test_data', async () => {
      return await client.query(dataQuery, [testId]);
    }, { test_id: testId, mode, total_points: totalPoints, returned_points: 0 });
    
    // Get navigation information for failed tests
    const serialNumber = testInfo.serial_number;
    const currentStartTime = testInfo.start_time;
    
    // Find previous failed test (chronologically before current test)
    const previousFailQuery = `
      SELECT t.test_id, t.start_time_utc as start_time, t.failure_description
      FROM Tests t 
      JOIN Inverters i ON t.inv_id = i.inv_id 
      WHERE i.serial_number = $1 
        AND t.test_id != $2 
        AND t.overall_status = 'FAIL'
        AND t.start_time_utc < $3
        AND (t.firmware_version != '1.11.11' OR t.firmware_version IS NULL)
      ORDER BY t.start_time_utc DESC
      LIMIT 1
    `;
    
    // Find next failed test (chronologically after current test)
    const nextFailQuery = `
      SELECT t.test_id, t.start_time_utc as start_time, t.failure_description
      FROM Tests t 
      JOIN Inverters i ON t.inv_id = i.inv_id 
      WHERE i.serial_number = $1 
        AND t.test_id != $2 
        AND t.overall_status = 'FAIL'
        AND t.start_time_utc > $3
        AND (t.firmware_version != '1.11.11' OR t.firmware_version IS NULL)
      ORDER BY t.start_time_utc ASC
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
        AND t.start_time_utc < $2
        AND (t.firmware_version != '1.11.11' OR t.firmware_version IS NULL)
    `;
    
    // Execute navigation queries in parallel
    const [previousFailResult, nextFailResult, totalFailuresResult, currentIndexResult] = await profiler.time('query_navigation', async () => {
      return await Promise.all([
        client.query(previousFailQuery, [serialNumber, testId, currentStartTime]),
        client.query(nextFailQuery, [serialNumber, testId, currentStartTime]),
        client.query(totalFailuresQuery, [serialNumber]),
        testInfo.overall_status === 'FAIL' ? client.query(currentIndexQuery, [serialNumber, currentStartTime]) : null
      ]);
    });
    
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
    
    const testData: TestData = await profiler.time('build_response', async () => {
      return {
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
    }, { data_points_count: dataResult.rows.length });

    profiler.stop('total_request');

    // Log profiling results to server console
    console.log(`\n[API /api/test/${testId}] Performance Profile (mode: ${mode}):`);
    profiler.printSummary();

    // Add metadata about decimation to response
    const responseWithMetadata = {
      ...testData,
      _metadata: {
        mode,
        total_points: totalPoints,
        returned_points: dataResult.rows.length,
        decimated: mode === 'quick' && totalPoints > targetPoints,
        decimation_factor: mode === 'quick' && totalPoints > targetPoints
          ? Math.ceil(totalPoints / targetPoints)
          : 1
      }
    };

    return NextResponse.json(responseWithMetadata);
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