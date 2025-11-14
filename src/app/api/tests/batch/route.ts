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

interface TestDataBatch {
  test_id: number;
  inv_id: number;
  serial_number: string;
  firmware_version: string;
  start_time: string;
  end_time: string;
  overall_status: string;
  failure_description?: string;
  data_points: DataPoint[];
  _metadata: {
    mode: string;
    total_points: number;
    returned_points: number;
    decimated: boolean;
    decimation_factor: number;
  };
}

export async function GET(request: NextRequest) {
  const profiler = new Profiler();
  profiler.start('batch_request');

  const { error: authError } = await requireAuth();
  if (authError) return authError;

  // Parse query parameters
  const { searchParams } = new URL(request.url);
  const testIdsParam = searchParams.get('test_ids');
  const mode = searchParams.get('mode') || 'quick';
  const targetPoints = 1000;

  if (!testIdsParam) {
    return NextResponse.json(
      { error: 'test_ids parameter is required' },
      { status: 400 }
    );
  }

  const testIds = testIdsParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

  if (testIds.length === 0) {
    return NextResponse.json(
      { error: 'No valid test IDs provided' },
      { status: 400 }
    );
  }

  // Limit batch size to prevent abuse
  if (testIds.length > 50) {
    return NextResponse.json(
      { error: 'Maximum 50 tests per batch request' },
      { status: 400 }
    );
  }

  const client = new Client(getDatabaseConfig());

  try {
    await profiler.time('db_connect', async () => {
      await client.connect();
    });

    await client.query("SET timezone = 'UTC'");

    // Get test metadata for all tests
    const metadataQuery = `
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
      WHERE t.test_id = ANY($1)
        AND (t.firmware_version != '1.11.11' OR t.firmware_version IS NULL)
    `;

    const metadataResult = await profiler.time('query_metadata', async () => {
      return await client.query(metadataQuery, [testIds]);
    });

    if (metadataResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'No tests found' },
        { status: 404 }
      );
    }

    // Get point counts for all tests
    const countQuery = `
      SELECT test_id, COUNT(*) as total
      FROM TestData
      WHERE test_id = ANY($1)
      GROUP BY test_id
    `;

    const countResult = await profiler.time('query_counts', async () => {
      return await client.query(countQuery, [testIds]);
    });

    // Create map of test_id -> total_points
    const pointCounts = new Map<number, number>();
    countResult.rows.forEach(row => {
      pointCounts.set(row.test_id, parseInt(row.total));
    });

    // Build data query based on mode (time-based decimation)
    let dataQuery: string;

    if (mode === 'quick') {
      // Time-based decimation: Sample evenly across time range for each test
      // Uses ROW_NUMBER ordered by timestamp to ensure even temporal distribution
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
            ROW_NUMBER() OVER (PARTITION BY test_id ORDER BY COALESCE(timestamp_utc, timestamp)) as rn,
            COUNT(*) OVER (PARTITION BY test_id) as total_rows
          FROM TestData
          WHERE test_id = ANY($1)
        )
        SELECT
          data_id, test_id, timestamp, vgrid, pgrid, qgrid, vpv1, ppv1, vpv2, ppv2,
          vpv3, ppv3, vpv4, ppv4, frequency, vbus, extstatus, status, temperature,
          epv1, epv2, epv3, epv4, active_energy, reactive_energy, extstatus_latch,
          status_latch, vgrid_inst_latch, vntrl_inst_latch, igrid_inst_latch,
          vbus_inst_latch, vpv1_inst_latch, ipv1_inst_latch, vpv2_inst_latch,
          ipv2_inst_latch, vpv3_inst_latch, ipv3_inst_latch, vpv4_inst_latch,
          ipv4_inst_latch, status_bits, source_file, created_at, total_rows
        FROM numbered_rows
        WHERE
          -- Time-based decimation: Keep every Nth point (calculated per test)
          -- If total_rows <= ${targetPoints}, keep all points (MOD will always match)
          MOD(rn, GREATEST(CEIL(total_rows::float / ${targetPoints})::int, 1)) = 0
        ORDER BY test_id, timestamp ASC
      `;
    } else {
      // Full mode: Return all data points
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
        WHERE test_id = ANY($1)
        ORDER BY test_id, COALESCE(timestamp_utc, timestamp) ASC
      `;
    }

    const dataResult = await profiler.time('query_all_test_data', async () => {
      return await client.query(dataQuery, [testIds]);
    }, { test_count: testIds.length, mode });

    // Group data points by test_id
    const dataByTestId = new Map<number, DataPoint[]>();
    dataResult.rows.forEach(row => {
      if (!dataByTestId.has(row.test_id)) {
        dataByTestId.set(row.test_id, []);
      }
      dataByTestId.get(row.test_id)!.push(row);
    });

    // Build response object
    const result = await profiler.time('build_response', async () => {
      const batchResult: Record<number, TestDataBatch> = {};

      for (const metadata of metadataResult.rows) {
        const testId = metadata.test_id;
        const dataPoints = dataByTestId.get(testId) || [];
        const totalPoints = pointCounts.get(testId) || 0;
        const decimated = mode === 'quick' && totalPoints > targetPoints;

        batchResult[testId] = {
          test_id: metadata.test_id,
          inv_id: metadata.inv_id,
          serial_number: metadata.serial_number || 'Unknown',
          firmware_version: metadata.firmware_version || 'Unknown',
          start_time: metadata.start_time.toISOString(),
          end_time: metadata.end_time?.toISOString() || new Date().toISOString(),
          overall_status: metadata.overall_status,
          failure_description: metadata.failure_description,
          data_points: dataPoints.map(row => {
            const point = { ...row } as Record<string, unknown>;
            if (point.timestamp) {
              // Handle both Date objects and strings
              const timestamp = point.timestamp;
              point.timestamp = timestamp instanceof Date
                ? timestamp.toISOString()
                : String(timestamp);
            }
            // Remove internal fields
            delete point.total_rows;
            delete point.rn;
            return point as unknown as DataPoint;
          }),
          _metadata: {
            mode,
            total_points: totalPoints,
            returned_points: dataPoints.length,
            decimated,
            decimation_factor: decimated ? Math.ceil(totalPoints / targetPoints) : 1
          }
        };
      }

      return batchResult;
    }, { test_count: metadataResult.rows.length });

    profiler.stop('batch_request');

    console.log(`\n[API /api/tests/batch] Performance Profile (${testIds.length} tests, mode: ${mode}):`);
    profiler.printSummary();

    return NextResponse.json(result);
  } catch (error) {
    console.error('Database error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch batch test data' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}
