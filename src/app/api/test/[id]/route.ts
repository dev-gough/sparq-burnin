import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';

interface DataPoint {
  timestamp: string;
  Vpv1?: number;
  Ppv1?: number;
  Vpv2?: number;
  Ppv2?: number;
  Vpv3?: number;
  Ppv3?: number;
  Vpv4?: number;
  Ppv4?: number;
  frequency?: number;
  Vgrid?: number;
  Pgrid?: number;
  Qgrid?: number;
  Vbus?: number;
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
}

interface TestData {
  test_id: number;
  inv_id: number;
  firmware_version: string;
  start_time: string;
  end_time: string;
  overall_status: string;
  failure_description?: string;
  data_points: DataPoint[];
}

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'burnin_dashboard',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'root',
};

export async function GET(
  request: NextRequest,
  props: { params: Promise<{ id: string }> }
) {
  const params = await props.params;
  const client = new Client(dbConfig);
  
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
        test_id,
        inv_id,
        firmware_version,
        start_time,
        end_time,
        overall_status,
        failure_description
      FROM Tests 
      WHERE test_id = $1
    `;
    
    const testResult = await client.query(testQuery, [testId]);
    
    if (testResult.rows.length === 0) {
      return NextResponse.json(
        { error: 'Test not found' },
        { status: 404 }
      );
    }
    
    const testInfo = testResult.rows[0];
    
    // Get test data points
    const dataQuery = `
      SELECT 
        timestamp,
        vpv1, ppv1, vpv2, ppv2, vpv3, ppv3, vpv4, ppv4,
        frequency,
        vgrid, pgrid, qgrid, vbus,
        vgrid_inst_latch, vntrl_inst_latch, igrid_inst_latch, vbus_inst_latch,
        vpv1_inst_latch, ipv1_inst_latch, vpv2_inst_latch, ipv2_inst_latch,
        vpv3_inst_latch, ipv3_inst_latch, vpv4_inst_latch, ipv4_inst_latch
      FROM TestData 
      WHERE test_id = $1 
      ORDER BY timestamp ASC
    `;
    
    const dataResult = await client.query(dataQuery, [testId]);
    
    const testData: TestData = {
      test_id: testInfo.test_id,
      inv_id: testInfo.inv_id,
      firmware_version: testInfo.firmware_version || 'Unknown',
      start_time: testInfo.start_time.toISOString(),
      end_time: testInfo.end_time?.toISOString() || new Date().toISOString(),
      overall_status: testInfo.overall_status,
      failure_description: testInfo.failure_description,
      data_points: dataResult.rows.map(row => ({
        timestamp: row.timestamp.toISOString(),
        Vpv1: row.vpv1,
        Ppv1: row.ppv1,
        Vpv2: row.vpv2,
        Ppv2: row.ppv2,
        Vpv3: row.vpv3,
        Ppv3: row.ppv3,
        Vpv4: row.vpv4,
        Ppv4: row.ppv4,
        frequency: row.frequency,
        Vgrid: row.vgrid,
        Pgrid: row.pgrid,
        Qgrid: row.qgrid,
        Vbus: row.vbus,
        vgrid_inst_latch: row.vgrid_inst_latch,
        vntrl_inst_latch: row.vntrl_inst_latch,
        igrid_inst_latch: row.igrid_inst_latch,
        vbus_inst_latch: row.vbus_inst_latch,
        vpv1_inst_latch: row.vpv1_inst_latch,
        ipv1_inst_latch: row.ipv1_inst_latch,
        vpv2_inst_latch: row.vpv2_inst_latch,
        ipv2_inst_latch: row.ipv2_inst_latch,
        vpv3_inst_latch: row.vpv3_inst_latch,
        ipv3_inst_latch: row.ipv3_inst_latch,
        vpv4_inst_latch: row.vpv4_inst_latch,
        ipv4_inst_latch: row.ipv4_inst_latch,
      }))
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