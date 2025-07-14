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
    console.log(`\nProcessing results CSV: ${filePath}`);
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
            // Process all rows and categorize them with priority levels
            const allTests = [];

            for (const test of tests) {
              // Extract inverter serial from filename or use Serial Number column
              const serialNumber = test['Serial Number'];
              if (!serialNumber) {
                console.warn(`No serial number found in row: ${JSON.stringify(test)}`);
                continue;
              }

              // Get start and end times for validation
              const startTime = test['Start Time'];
              const endTime = test['End Time'];
              let overallStatus = test['Overall'];
              let invalidReason = '';
              let priority = 4; // Start with highest priority (valid)

              // Mark debug firmware version 1.11.11 as INVALID
              const firmwareVersion = test['Inverter Firmware'];
              if (firmwareVersion === '1.11.11') {
                console.log(`Marking test with debug firmware version 1.11.11 as INVALID for inverter ${serialNumber}`);
                overallStatus = 'INVALID';
                invalidReason = 'Debug firmware version';
                priority = 3; // Medium priority - can be processed if no better options
              }

              // Check if start time is after end time
              if (startTime && endTime) {
                const start = new Date(startTime);
                const end = new Date(endTime);
                if (start > end) {
                  console.log(`Marking test as INVALID due to start time (${startTime}) being after end time (${endTime}) for inverter ${serialNumber}`);
                  overallStatus = 'INVALID';
                  invalidReason = invalidReason ? `${invalidReason}, Invalid date range` : 'Invalid date range';
                  priority = 1; // Lowest priority - only process if no other options
                }

                // Check if test duration is less than 2 hours
                const durationMs = end.getTime() - start.getTime();
                const durationHours = durationMs / (1000 * 60 * 60);
                if (durationHours < 2) {
                  console.log(`Marking test as INVALID due to duration less than 2 hours (${durationHours.toFixed(2)} hours) for inverter ${serialNumber}`);
                  overallStatus = 'INVALID';
                  invalidReason = invalidReason ? `${invalidReason}, Duration less than 2 hours` : 'Duration less than 2 hours';
                  // Only lower priority if not already lowered by date range issue
                  if (priority > 2) {
                    priority = 2; // Medium-low priority - acceptable if no date range issues
                  }
                }
              }

              // Check if overall status is already invalid (from CSV data itself)
              if (overallStatus === 'INVALID' && priority === 4) {
                priority = 3; // If already marked invalid but no specific reason, medium priority
              }

              const testInfo = {
                ...test,
                serialNumber,
                overallStatus,
                invalidReason,
                priority
              };

              allTests.push(testInfo);
            }

            // Log summary
            console.log(`Found ${tests.length} total rows`);

            // Select the best test to process based on priority
            let testToProcess = null;

            if (allTests.length === 1) {
              // Single row: always process regardless of validity
              testToProcess = allTests[0];
              console.log(`Single row found - processing regardless of validity (priority: ${testToProcess.priority})`);
            } else if (allTests.length > 1) {
              // Multiple rows: select highest priority
              allTests.sort((a, b) => b.priority - a.priority); // Sort by priority descending
              testToProcess = allTests[0];

              const priorityGroups = {
                1: allTests.filter(t => t.priority === 1).length,
                2: allTests.filter(t => t.priority === 2).length,
                3: allTests.filter(t => t.priority === 3).length,
                4: allTests.filter(t => t.priority === 4).length
              };

              console.log(`Multiple rows found for S/N ${allTests[0].serialNumber} - priority breakdown: P4(valid)=${priorityGroups[4]}, P3(debug/invalid)=${priorityGroups[3]}, P2(short)=${priorityGroups[2]}, P1(date-range)=${priorityGroups[1]}`);
              console.log(`Selected: ${testToProcess.serialNumber} (${testToProcess['Start Time']}) with priority ${testToProcess.priority}`);

              if (testToProcess.priority === 1 && priorityGroups[1] === allTests.length) {
                console.warn(`⚠️  WARNING: All rows in ${path.basename(filePath)} have date range issues (start > end). Skipping file.`);
                testToProcess = null;
              }
            }

            if (testToProcess) {
              const invId = await this.ensureInverter(testToProcess.serialNumber);

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
                testToProcess['Start Time'],
                testToProcess['End Time'],
                testToProcess['Inverter Firmware'],
                testToProcess.overallStatus,
                testToProcess['AC'],
                testToProcess['CH1'],
                testToProcess['CH2'],
                testToProcess['CH3'],
                testToProcess['CH4'],
                testToProcess['Status Flags'] || null,
                testToProcess['Failure Description'] || null,
                path.basename(filePath)
              ];

              const result = await this.client.query(query, values);
              testIds.push(result.rows[0].test_id);

              console.log(`Inserted test ${result.rows[0].test_id} for inverter ${testToProcess.serialNumber}`);
            } else {
              console.log(`No valid tests found in ${path.basename(filePath)}`);
            }
            resolve(testIds);
          } catch (error) {
            reject(error);
          }
        })
        .on('error', reject);
    });
  }

  async findTestDataFileForTest(testId: number, testsDir: string): Promise<string | null> {
    // Get test details from database
    const query = `
      SELECT t.start_time, i.serial_number
      FROM Tests t
      JOIN Inverters i ON t.inv_id = i.inv_id
      WHERE t.test_id = $1
    `;

    const result = await this.client.query(query, [testId]);

    if (result.rows.length === 0) {
      console.warn(`Test ${testId} not found in database`);
      return null;
    }

    const { start_time, serial_number } = result.rows[0];
    // Convert start time to filename format (convert UTC from database to local time)
    const startDate = new Date(start_time);
    const dateStr = startDate.toISOString().split('T')[0]; // YYYY-MM-DD (use ISO date)
    const timeStr = startDate.toTimeString().substring(0, 5).replace(':', '-'); // HH-MM (use local time)
    const secondsStr = startDate.toTimeString().substring(0, 8).replace(/:/g, '-'); // HH-MM-SS (use local time)

    if (serial_number == 190825260773) {
      console.log("bitch>", result.rows)
      console.log('startDate: ', startDate)
      console.log('dateStr: ', dateStr)
      console.log('timeStr: ', timeStr)
      console.log('secondsStr: ', secondsStr)
    }

    // Try new filename format first (with seconds)
    const expectedFileNameWithSeconds = `inverter_${serial_number}_${dateStr}_${secondsStr}.csv`;
    const expectedFilePathWithSeconds = path.join(testsDir, expectedFileNameWithSeconds);
    try {
      await fs.access(expectedFilePathWithSeconds);
      const isUsed = await this.isTestDataFileAlreadyUsed(expectedFileNameWithSeconds);
      if (!isUsed) {
        console.log(`Found exact match with seconds: ${expectedFileNameWithSeconds} for test ${testId}`);
        return expectedFileNameWithSeconds;
      } else {
        console.log(`File ${expectedFileNameWithSeconds} already used, skipping`);
      }
    } catch {
      // File doesn't exist
    }

    // Try old filename format (without seconds)
    const expectedFileName = `inverter_${serial_number}_${dateStr}_${timeStr}.csv`;
    const expectedFilePath = path.join(testsDir, expectedFileName);
    try {
      await fs.access(expectedFilePath);
      const isUsed = await this.isTestDataFileAlreadyUsed(expectedFileName);
      if (!isUsed) {
        console.log(`Found exact match: ${expectedFileName} for test ${testId}`);
        return expectedFileName;
      } else {
        console.log(`File ${expectedFileName} already used, skipping`);
      }
    } catch {
      // File doesn't exist
    }

    // If exact match not found, look for files with same serial within ±1 day
    try {
      const files = await fs.readdir(testsDir);
      const candidates: Array<{ fileName: string, timeDiff: number }> = [];

      // Create date range: target date ±1 day
      const targetDate = new Date(startDate);
      const searchDates = [
        new Date(targetDate.getTime() - 24 * 60 * 60 * 1000), // -1 day
        new Date(targetDate.getTime()),                        // target day
        new Date(targetDate.getTime() + 24 * 60 * 60 * 1000)  // +1 day
      ];

      for (const searchDate of searchDates) {
        const searchDateStr = searchDate.toISOString().split('T')[0];
        const pattern = `inverter_${serial_number}_${searchDateStr}_`;

        for (const file of files) {
          if (file.startsWith(pattern) && file.endsWith('.csv')) {
            // Check if file is already used
            const isUsed = await this.isTestDataFileAlreadyUsed(file);
            if (isUsed) {
              console.log(`File ${file} already used, skipping from candidates`);
              continue;
            }

            // Extract time from filename
            const timeMatch = file.match(/inverter_\w+_\d{4}-\d{2}-\d{2}_(\d{2}-\d{2}(?:-\d{2})?).csv$/);
            if (timeMatch) {
              const fileTimeStr = timeMatch[1];
              const fileTime = this.parseTimeFromFilename(fileTimeStr, searchDateStr);
              // Create expected time in local time to match filename parsing
              const expectedLocalDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate(),
                                                startDate.getHours(), startDate.getMinutes(), startDate.getSeconds());
              const expectedTime = expectedLocalDate.getTime();
              const timeDiff = Math.abs(fileTime - expectedTime);

              console.log('calculating timediff>', fileTime, expectedTime)
              candidates.push({
                fileName: file,
                timeDiff: timeDiff
              });
            }
          }
        }
      }

      // Find the closest match
      if (candidates.length > 0) {
        console.log(candidates)
        candidates.sort((a, b) => a.timeDiff - b.timeDiff);
        const closest = candidates[0];
        const timeDiffHours = closest.timeDiff / (1000 * 60 * 60);
        console.log(`Found closest match: ${closest.fileName} for test ${testId} (time difference: ${timeDiffHours.toFixed(2)} hours)`);
        return closest.fileName;
      }

      console.log(`No files found for inverter ${serial_number} within ±1 day of ${dateStr}`);
    } catch (error) {
      console.warn(`Could not read tests directory: ${testsDir}`);
    }

    console.warn(`No test data file found for test ${testId} (serial: ${serial_number}, start: ${dateStr}_${timeStr})`);
    return null;
  }

  async processTestDataCSV(filePath: string, testId: number): Promise<void> {
    console.log(`\nProcessing test data CSV: ${filePath} for test_id: ${testId}`);

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

  private parseTimeFromFilename(timeStr: string, dateStr: string): number {
    // Parse time string in format HH-MM or HH-MM-SS
    const timeParts = timeStr.split('-');
    const hours = parseInt(timeParts[0]);
    const minutes = parseInt(timeParts[1]);
    const seconds = timeParts.length > 2 ? parseInt(timeParts[2]) : 0;

    // Create date object with the specified date and time
    const date = new Date(dateStr);
    date.setHours(hours, minutes, seconds, 0);

    return date.getTime();
  }

  async isTestDataFileAlreadyUsed(fileName: string): Promise<boolean> {
    const query = `
      SELECT COUNT(*) as count
      FROM TestData
      WHERE source_file = $1
      LIMIT 1
    `;

    const result = await this.client.query(query, [fileName]);
    return result.rows[0].count > 0;
  }

  async reprocessAllFiles(): Promise<void> {
    try {
      console.log('=== Starting reprocessing of all files ===');

      // Clear existing data
      await this.clearDatabase();

      // Process results files and their corresponding test data files together
      const resultsDir = path.join(this.processedPath, 'results');
      const testsDir = path.join(this.processedPath, 'tests');
      console.log(`\n=== Processing paired results and test files ===`);

      try {
        const resultsFiles = await fs.readdir(resultsDir);
        console.log(`Found ${resultsFiles.length} files in results directory`);

        for (const resultsFile of resultsFiles) {
          if (resultsFile.endsWith('.csv')) {
            const resultsFilePath = path.join(resultsDir, resultsFile);

            // Process the results file and get the test IDs
            const testIds = await this.processResultsCSV(resultsFilePath);
            // For each test created, find and process its corresponding test data file
            for (const testId of testIds) {
              const testDataFile = await this.findTestDataFileForTest(testId, testsDir);
              if (testDataFile) {
                const testDataFilePath = path.join(testsDir, testDataFile);
                await this.processTestDataCSV(testDataFilePath, testId);
              } else {
                console.warn(`No test data file found for test ${testId}`);
              }
            }
          }
        }
      } catch (error) {
        console.log(`Results directory not found or empty: ${resultsDir}`);
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