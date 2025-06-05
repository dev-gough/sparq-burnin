#!/usr/bin/env tsx

import { Client } from 'pg';
import * as fs from 'fs/promises';
import * as path from 'path';
import csvParser from 'csv-parser';
import { createReadStream } from 'fs';

interface InverterRecord {
  inv_id: number;
  serial_number: string;
}

interface TestRecord {
  test_id: number;
  inv_id: number;
  start_time: string;
  end_time: string;
  firmware_version?: string;
  overall_status: string;
  ac_status?: string;
  ch1_status?: string;
  ch2_status?: string;
  ch3_status?: string;
  ch4_status?: string;
  status_flags?: string;
  failure_description?: string;
  source_file: string;
}

interface TestDataRecord {
  test_id: number;
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
  active_energy?: number;
  reactive_energy?: number;
  extstatus_latch?: number;
  status_latch?: number;
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
  source_file: string;
}

class ReprocessingIngester {
  private client: Client;
  private readonly processedPath = 'data/processed';

  constructor() {
    this.client = new Client({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'burnin_dashboard',
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'root',
    });
  }

  async connect(): Promise<void> {
    try {
      await this.client.connect();
      console.log('Connected to PostgreSQL database');
    } catch (error) {
      console.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this.client.end();
    console.log('Disconnected from PostgreSQL database');
  }

  async clearDatabase(): Promise<void> {
    console.log('Clearing existing data...');
    
    // Clear tables in reverse dependency order
    await this.client.query('DELETE FROM TestData');
    console.log('Cleared TestData table');
    
    await this.client.query('DELETE FROM Tests');
    console.log('Cleared Tests table');
    
    await this.client.query('DELETE FROM Inverters');
    console.log('Cleared Inverters table');
    
    // Reset sequences
    await this.client.query('ALTER SEQUENCE testdata_data_id_seq RESTART WITH 1');
    await this.client.query('ALTER SEQUENCE tests_test_id_seq RESTART WITH 1');
    await this.client.query('ALTER SEQUENCE inverters_inv_id_seq RESTART WITH 1');
    console.log('Reset all sequences');
  }

  async ensureInverter(serialNumber: string): Promise<number> {
    const query = `
      INSERT INTO Inverters (serial_number) 
      VALUES ($1) 
      ON CONFLICT (serial_number) DO NOTHING 
      RETURNING inv_id
    `;
    
    const result = await this.client.query(query, [serialNumber]);
    
    if (result.rows.length > 0) {
      return result.rows[0].inv_id;
    }
    
    // If no row was inserted (conflict), get the existing inv_id
    const selectQuery = 'SELECT inv_id FROM Inverters WHERE serial_number = $1';
    const selectResult = await this.client.query(selectQuery, [serialNumber]);
    return selectResult.rows[0].inv_id;
  }

  async processResultsCSV(filePath: string): Promise<number[]> {
    console.log(`Processing results CSV: ${filePath}`);
    const testIds: number[] = [];
    
    return new Promise((resolve, reject) => {
      const tests: any[] = [];
      
      createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => {
          tests.push(row);
        })
        .on('end', async () => {
          try {
            for (const test of tests) {
              // Extract inverter serial from filename or use Serial Number column
              const serialNumber = test['Serial Number'];
              if (!serialNumber) {
                console.warn(`No serial number found in row: ${JSON.stringify(test)}`);
                continue;
              }

              // Skip debug firmware version 1.11.11
              const firmwareVersion = test['Inverter Firmware'];
              if (firmwareVersion === '1.11.11') {
                console.log(`Skipping test with debug firmware version 1.11.11 for inverter ${serialNumber}`);
                continue;
              }

              const invId = await this.ensureInverter(serialNumber);
              
              const query = `
                INSERT INTO Tests (
                  inv_id, start_time, end_time, firmware_version, overall_status,
                  ac_status, ch1_status, ch2_status, ch3_status, ch4_status,
                  status_flags, failure_description, source_file
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                RETURNING test_id
              `;
              
              const values = [
                invId,
                test['Start Time'],
                test['End Time'],
                test['Inverter Firmware'],
                test['Overall'],
                test['AC'],
                test['CH1'],
                test['CH2'],
                test['CH3'],
                test['CH4'],
                test['Status Flags'] || null,
                test['Failure Description'] || null,
                path.basename(filePath)
              ];
              
              const result = await this.client.query(query, values);
              testIds.push(result.rows[0].test_id);
              
              console.log(`Inserted test ${result.rows[0].test_id} for inverter ${serialNumber}`);
            }
            resolve(testIds);
          } catch (error) {
            reject(error);
          }
        })
        .on('error', reject);
    });
  }

  async findTestIdForDataFile(dataFileName: string): Promise<number | null> {
    // Extract serial number and datetime from filename (format: inverter_{12-digit-SN}_{YYYY-MM-DD}_{HH-MM}.csv)
    const match = dataFileName.match(/inverter_(\d{12})_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})\.csv$/);
    if (!match) {
      console.warn(`Could not extract serial number and date from filename: ${dataFileName}`);
      return null;
    }
    
    const serialNumber = match[1];
    const dateStr = match[2]; // YYYY-MM-DD
    const timeStr = match[3]; // HH-MM
    
    // Convert filename date/time to a timestamp for comparison
    const fileDateTime = new Date(`${dateStr}T${timeStr.replace('-', ':')}:00`);
    
    // Find the test that started closest to this file's date/time
    const query = `
      SELECT t.test_id, t.start_time,
             ABS(EXTRACT(EPOCH FROM (t.start_time - $2))) as time_diff_seconds
      FROM Tests t 
      JOIN Inverters i ON t.inv_id = i.inv_id 
      WHERE i.serial_number = $1 
      ORDER BY time_diff_seconds ASC
      LIMIT 1
    `;
    
    const result = await this.client.query(query, [serialNumber, fileDateTime.toISOString()]);
    
    if (result.rows.length === 0) {
      console.warn(`No test found for inverter ${serialNumber}`);
      return null;
    }
    
    const timeDiffHours = result.rows[0].time_diff_seconds / 3600;
    console.log(`Matched file ${dataFileName} to test ${result.rows[0].test_id} (time difference: ${timeDiffHours.toFixed(2)} hours)`);
    
    return result.rows[0].test_id;
  }

  async processTestDataCSV(filePath: string, testId: number): Promise<void> {
    console.log(`Processing test data CSV: ${filePath} for test_id: ${testId}`);
    
    return new Promise((resolve, reject) => {
      const dataRows: any[] = [];
      let rowCount = 0;
      
      createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => {
          dataRows.push(row);
          rowCount++;
        })
        .on('end', async () => {
          try {
            console.log(`Processing ${rowCount} data rows...`);
            
            // Process in batches to avoid memory issues
            const batchSize = 1000;
            for (let i = 0; i < dataRows.length; i += batchSize) {
              const batch = dataRows.slice(i, i + batchSize);
              await this.insertTestDataBatch(batch, testId, path.basename(filePath));
              console.log(`Processed batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(dataRows.length / batchSize)}`);
            }
            
            console.log(`Finished processing ${rowCount} data rows for test ${testId}`);
            resolve();
          } catch (error) {
            reject(error);
          }
        })
        .on('error', reject);
    });
  }

  async insertTestDataBatch(rows: any[], testId: number, sourceFile: string): Promise<void> {
    if (rows.length === 0) return;

    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const row of rows) {
      const rowValues = [
        testId,
        row['Timestamp'],
        this.parseFloat(row['Vgrid']),
        this.parseFloat(row['Pgrid']),
        this.parseFloat(row['Qgrid']),
        this.parseFloat(row['Vpv1']),
        this.parseFloat(row['Ppv1']),
        this.parseFloat(row['Vpv2']),
        this.parseFloat(row['Ppv2']),
        this.parseFloat(row['Vpv3']),
        this.parseFloat(row['Ppv3']),
        this.parseFloat(row['Vpv4']),
        this.parseFloat(row['Ppv4']),
        this.parseFloat(row['Frequency']),
        this.parseFloat(row['Vbus']),
        this.parseInt(row['extstatus']),
        this.parseInt(row['status']),
        this.parseFloat(row['Temperature']),
        this.parseFloat(row['EPV1']),
        this.parseFloat(row['EPV2']),
        this.parseFloat(row['EPV3']),
        this.parseFloat(row['EPV4']),
        this.parseFloat(row['ActiveEnergy']),
        this.parseFloat(row['ReactiveEnergy']),
        this.parseInt(row['extstatus_latch']),
        this.parseInt(row['status_latch']),
        this.parseFloat(row['Vgrid_inst_latch']),
        this.parseFloat(row['Vntrl_inst_latch']),
        this.parseFloat(row['Igrid_inst_latch']),
        this.parseFloat(row['Vbus_inst_latch']),
        this.parseFloat(row['Vpv1_inst_latch']),
        this.parseFloat(row['Ipv1_inst_latch']),
        this.parseFloat(row['Vpv2_inst_latch']),
        this.parseFloat(row['Ipv2_inst_latch']),
        this.parseFloat(row['Vpv3_inst_latch']),
        this.parseFloat(row['Ipv3_inst_latch']),
        this.parseFloat(row['Vpv4_inst_latch']),
        this.parseFloat(row['Ipv4_inst_latch']),
        row['status_bits'] || null,
        sourceFile
      ];

      values.push(...rowValues);
      
      const paramPlaceholders = Array.from(
        { length: rowValues.length }, 
        (_, i) => `$${paramIndex + i}`
      ).join(',');
      
      placeholders.push(`(${paramPlaceholders})`);
      paramIndex += rowValues.length;
    }

    const query = `
      INSERT INTO TestData (
        test_id, timestamp, vgrid, pgrid, qgrid, vpv1, ppv1, vpv2, ppv2,
        vpv3, ppv3, vpv4, ppv4, frequency, vbus, extstatus, status,
        temperature, epv1, epv2, epv3, epv4, active_energy, reactive_energy,
        extstatus_latch, status_latch, vgrid_inst_latch, vntrl_inst_latch,
        igrid_inst_latch, vbus_inst_latch, vpv1_inst_latch, ipv1_inst_latch,
        vpv2_inst_latch, ipv2_inst_latch, vpv3_inst_latch, ipv3_inst_latch,
        vpv4_inst_latch, ipv4_inst_latch, status_bits, source_file
      ) VALUES ${placeholders.join(',')}
    `;

    await this.client.query(query, values);
  }

  private parseFloat(value: string): number | null {
    if (!value || value.trim() === '') return null;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }

  private parseInt(value: string): number | null {
    if (!value || value.trim() === '') return null;
    const parsed = parseInt(value);
    return isNaN(parsed) ? null : parsed;
  }

  async reprocessAllFiles(): Promise<void> {
    try {
      console.log('=== Starting reprocessing of all files ===');
      
      // Clear existing data
      await this.clearDatabase();
      
      // Process results files first
      const resultsDir = path.join(this.processedPath, 'results');
      console.log(`\n=== Processing results files from ${resultsDir} ===`);
      
      try {
        const resultsFiles = await fs.readdir(resultsDir);
        console.log(`Found ${resultsFiles.length} files in results directory`);
        
        for (const file of resultsFiles) {
          if (file.endsWith('.csv')) {
            const filePath = path.join(resultsDir, file);
            await this.processResultsCSV(filePath);
          }
        }
      } catch (error) {
        console.log(`Results directory not found or empty: ${resultsDir}`);
      }
      
      // Process test data files
      const testsDir = path.join(this.processedPath, 'tests');
      console.log(`\n=== Processing test data files from ${testsDir} ===`);
      
      try {
        const testFiles = await fs.readdir(testsDir);
        console.log(`Found ${testFiles.length} files in tests directory`);
        
        for (const file of testFiles) {
          if (file.endsWith('.csv')) {
            const filePath = path.join(testsDir, file);
            const testId = await this.findTestIdForDataFile(file);
            
            if (testId) {
              await this.processTestDataCSV(filePath, testId);
            } else {
              console.error(`Skipping ${file} - no matching test found`);
            }
          }
        }
      } catch (error) {
        console.log(`Tests directory not found or empty: ${testsDir}`);
      }
      
      console.log('\n=== All files reprocessed successfully! ===');
    } catch (error) {
      console.error('Error reprocessing files:', error);
      throw error;
    }
  }
}

async function main() {
  const ingester = new ReprocessingIngester();
  
  try {
    await ingester.connect();
    await ingester.reprocessAllFiles();
  } catch (error) {
    console.error('Reprocessing failed:', error);
    process.exit(1);
  } finally {
    await ingester.disconnect();
  }
}

if (require.main === module) {
  main();
}