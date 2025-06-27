import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import archiver from 'archiver';

interface FailedTest {
  test_id: number;
  inv_id: number;
  serial_number: string;
  start_time: string;
  end_time: string;
  firmware_version: string;
  overall_status: string;
  failure_description: string | null;
}

interface TestDataPoint {
  timestamp: string;
  vgrid: number | null;
  pgrid: number | null;
  qgrid: number | null;
  vpv1: number | null;
  ppv1: number | null;
  vpv2: number | null;
  ppv2: number | null;
  vpv3: number | null;
  ppv3: number | null;
  vpv4: number | null;
  ppv4: number | null;
  frequency: number | null;
  vbus: number | null;
  extstatus: number | null;
  status: number | null;
  temperature: number | null;
  epv1: number | null;
  epv2: number | null;
  epv3: number | null;
  epv4: number | null;
  active_energy: number | null;
  reactive_energy: number | null;
  extstatus_latch: number | null;
  status_latch: number | null;
  vgrid_inst_latch: number | null;
  vntrl_inst_latch: number | null;
  igrid_inst_latch: number | null;
  vbus_inst_latch: number | null;
  vpv1_inst_latch: number | null;
  ipv1_inst_latch: number | null;
  vpv2_inst_latch: number | null;
  ipv2_inst_latch: number | null;
  vpv3_inst_latch: number | null;
  ipv3_inst_latch: number | null;
  vpv4_inst_latch: number | null;
  ipv4_inst_latch: number | null;
  status_bits: string | null;
}

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'burnin_dashboard',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD
};

export async function GET(request: NextRequest) {
  const client = new Client(dbConfig);
  
  try {
    await client.connect();
    
    const { searchParams } = new URL(request.url);
    const timeRange = searchParams.get('timeRange') || '90d';
    
    let daysToSubtract: number | null = 90;
    if (timeRange === '30d') {
      daysToSubtract = 30;
    } else if (timeRange === '7d') {
      daysToSubtract = 7;
    } else if (timeRange === 'all') {
      daysToSubtract = null;
    }
    
    const whereClause = daysToSubtract 
      ? `AND t.start_time >= CURRENT_DATE - INTERVAL '${daysToSubtract} days'`
      : '';
    
    // Query for failed tests in the specified time range
    const failedTestsQuery = `
      SELECT 
        t.test_id,
        t.inv_id,
        i.serial_number,
        t.start_time,
        t.end_time,
        t.firmware_version,
        t.overall_status,
        t.failure_description
      FROM Tests t
      JOIN Inverters i ON t.inv_id = i.inv_id
      WHERE t.overall_status = 'FAIL'
      ${whereClause}
      ORDER BY t.start_time DESC
      LIMIT 100
    `;
    
    const failedTestsResult = await client.query(failedTestsQuery);
    const failedTests: FailedTest[] = failedTestsResult.rows;
    
    if (failedTests.length === 0) {
      return NextResponse.json(
        { error: 'No failed tests found in the specified time range' },
        { status: 404 }
      );
    }
    
    // Create zip archive
    const archive = archiver('zip', {
      zlib: { level: 9 } // Maximum compression
    });
    
    // Create a promise to handle the archive completion
    const archivePromise = new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      
      archive.on('data', (chunk) => {
        chunks.push(chunk);
      });
      
      archive.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
      
      archive.on('error', (err) => {
        reject(err);
      });
    });
    
    // Generate CSV for each failed test and add to archive
    for (const test of failedTests) {
      const csvContent = await generateTestCSV(client, test);
      const filename = `${formatDate(test.start_time)}_test_${test.test_id}_${test.serial_number}_FAILED.csv`;
      archive.append(csvContent, { name: filename });
    }
    
    // Finalize the archive
    archive.finalize();
    
    // Wait for archive to complete
    const zipBuffer = await archivePromise;
    
    // Generate filename for the zip
    const zipFilename = `failed-tests-${timeRange}-${new Date().toISOString().split('T')[0]}.zip`;
    
    // Return the zip file
    return new NextResponse(zipBuffer, {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${zipFilename}"`,
        'Content-Length': zipBuffer.length.toString(),
      },
    });
    
  } catch (error) {
    console.error('Error generating failed test data:', error);
    return NextResponse.json(
      { error: 'Failed to generate failed test data archive' },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}

async function generateTestCSV(client: Client, test: FailedTest): Promise<string> {
  // Query test data for this specific test
  const testDataQuery = `
    SELECT 
      timestamp,
      vgrid, pgrid, qgrid,
      vpv1, ppv1, vpv2, ppv2, vpv3, ppv3, vpv4, ppv4,
      frequency, vbus, extstatus, status, temperature,
      epv1, epv2, epv3, epv4,
      active_energy, reactive_energy,
      extstatus_latch, status_latch, vgrid_inst_latch, vntrl_inst_latch,
      igrid_inst_latch, vbus_inst_latch, vpv1_inst_latch, ipv1_inst_latch,
      vpv2_inst_latch, ipv2_inst_latch, vpv3_inst_latch, ipv3_inst_latch,
      vpv4_inst_latch, ipv4_inst_latch, status_bits
    FROM TestData
    WHERE test_id = $1
    ORDER BY timestamp ASC
  `;
  
  const testDataResult = await client.query(testDataQuery, [test.test_id]);
  const testData: TestDataPoint[] = testDataResult.rows;
  
  // Generate CSV content
  let csvContent = '';
  
  // Add metadata header
  csvContent += `# Test ID: ${test.test_id}\n`;
  csvContent += `# Serial Number: ${test.serial_number}\n`;
  csvContent += `# Firmware Version: ${test.firmware_version || 'Unknown'}\n`;
  csvContent += `# Start Time: ${test.start_time}\n`;
  csvContent += `# End Time: ${test.end_time}\n`;
  csvContent += `# Status: ${test.overall_status}\n`;
  csvContent += `# Failure Description: ${test.failure_description || 'Not specified'}\n`;
  csvContent += `# Data Points: ${testData.length}\n`;
  csvContent += `#\n`;
  
  // Add CSV headers
  const headers = [
    'timestamp',
    'vgrid', 'pgrid', 'qgrid',
    'vpv1', 'ppv1', 'vpv2', 'ppv2', 'vpv3', 'ppv3', 'vpv4', 'ppv4',
    'frequency', 'vbus', 'extstatus', 'status', 'temperature',
    'epv1', 'epv2', 'epv3', 'epv4',
    'active_energy', 'reactive_energy',
    'extstatus_latch', 'status_latch', 'vgrid_inst_latch', 'vntrl_inst_latch',
    'igrid_inst_latch', 'vbus_inst_latch', 'vpv1_inst_latch', 'ipv1_inst_latch',
    'vpv2_inst_latch', 'ipv2_inst_latch', 'vpv3_inst_latch', 'ipv3_inst_latch',
    'vpv4_inst_latch', 'ipv4_inst_latch', 'status_bits'
  ];
  
  csvContent += headers.join(',') + '\n';
  
  // Add data rows
  testData.forEach(row => {
    const values = headers.map(header => {
      const value = row[header as keyof TestDataPoint];
      return value !== null ? value.toString() : '';
    });
    csvContent += values.join(',') + '\n';
  });
  
  return csvContent;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toISOString().split('T')[0];
}