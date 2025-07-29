#!/usr/bin/env tsx

import { Client } from 'pg';
import * as fs from 'fs/promises';
import * as path from 'path';
import csvParser from 'csv-parser';
import { createReadStream } from 'fs';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

import { loadConfig, type Config } from '../src/lib/config';

// CSV data interfaces for raw parsed data
interface TestDataCsvRow {
  Timestamp: string;
  Vgrid?: string;
  Pgrid?: string;
  Qgrid?: string;
  Vpv1?: string;
  Ppv1?: string;
  Vpv2?: string;
  Ppv2?: string;
  Vpv3?: string;
  Ppv3?: string;
  Vpv4?: string;
  Ppv4?: string;
  Frequency?: string;
  Vbus?: string;
  extstatus?: string;
  status?: string;
  Temperature?: string;
  EPV1?: string;
  EPV2?: string;
  EPV3?: string;
  EPV4?: string;
  'ActiveEnergy'?: string;
  'ReactiveEnergy'?: string;
  'extstatus_latch'?: string;
  'status_latch'?: string;
  'Vgrid_inst_latch'?: string;
  'Vntrl_inst_latch'?: string;
  'Igrid_inst_latch'?: string;
  'Vbus_inst_latch'?: string;
  'Vpv1_inst_latch'?: string;
  'Ipv1_inst_latch'?: string;
  'Vpv2_inst_latch'?: string;
  'Ipv2_inst_latch'?: string;
  'Vpv3_inst_latch'?: string;
  'Ipv3_inst_latch'?: string;
  'Vpv4_inst_latch'?: string;
  'Ipv4_inst_latch'?: string;
  'status_bits'?: string;
}

interface TestResultsCsvRow {
  'Serial Number': string;
  'Start Time': string;
  'End Time': string;
  'Inverter Firmware'?: string;
  Overall: string;
  'AC Output'?: string;
  'CH1 Output'?: string;
  'CH2 Output'?: string;
  'CH3 Output'?: string;
  'CH4 Output'?: string;
  'Status Flags'?: string;
  'Failure Description'?: string;
  'Failure time'?: string;
}

interface ProcessedTestResult {
  serialNumber: string;
  startTime: string;
  endTime: string;
  firmwareVersion?: string;
  overallStatus: string;
  acStatus?: string;
  ch1Status?: string;
  ch2Status?: string;
  ch3Status?: string;
  ch4Status?: string;
  statusFlags?: string;
  failureDescription?: string;
  failureTime?: string;
  priority: number;
  invalidReason: string;
}

class CSVIngester {
  private client: Client;
  private readonly config: Config;
  private readonly toProcessPath: string;
  private readonly processedPath: string;

  constructor() {
    this.config = loadConfig();

    this.client = new Client({
      host: this.config.database.host,
      port: this.config.database.port,
      database: this.config.database.name,
      user: this.config.database.user,
      password: this.config.database.password,
    });

    this.toProcessPath = path.join(this.config.paths.local.main_dir, 'to_process');
    this.processedPath = path.join(this.config.paths.local.main_dir, 'processed');
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

  async insertTestDataBatch(rows: TestDataCsvRow[], testId: number, sourceFile: string): Promise<void> {
    if (rows.length === 0) return;

    const values: (number | string | null)[] = [];
    const placeholders: string[] = [];
    let paramIndex = 1;

    for (const row of rows) {
      const rowValues = [
        testId,
        this.parseTimestampFromDelhi(row['Timestamp']).toISOString(),
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

  private parseFloat(value: string | undefined): number | null {
    if (!value || value.trim() === '') return null;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? null : parsed;
  }

  private parseInt(value: string | undefined): number | null {
    if (!value || value.trim() === '') return null;
    const parsed = parseInt(value);
    return isNaN(parsed) ? null : parsed;
  }

  private parseTimestampFromDelhi(timestamp: string): Date {
    // Parse timestamp as Delhi time (Asia/Kolkata), convert to UTC for database storage
    try {
      return fromZonedTime(timestamp, 'Asia/Kolkata');
    } catch (error) {
      console.warn(`Error parsing Delhi timestamp: ${timestamp}`, error);
      throw error;
    }
  }

  private parseFailureTime(value: string | null): string | null {
    if (!value || value.trim() === '' || value.trim().toUpperCase() === 'N/A') {
      return null;
    }

    // Expected format: "2025-07-15_11-08-38"
    // Convert to ISO timestamp format, treating as Delhi time
    try {
      const parts = value.split('_');
      if (parts.length !== 2) {
        console.warn(`Invalid failure time format: ${value}`);
        return null;
      }

      const datePart = parts[0]; // "2025-07-15"
      const timePart = parts[1].replace(/-/g, ':'); // "11:08:38"

      const delhiTimestamp = `${datePart}T${timePart}`;

      // Convert Delhi time to UTC for database storage
      const utcDate = this.parseTimestampFromDelhi(delhiTimestamp);
      return utcDate.toISOString();
    } catch (error) {
      console.warn(`Error parsing failure time: ${value}`, error);
      return null;
    }
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

  async moveFile(sourcePath: string, destinationDir: string): Promise<void> {
    const fileName = path.basename(sourcePath);
    const destinationPath = path.join(destinationDir, fileName);

    // Ensure destination directory exists
    await fs.mkdir(destinationDir, { recursive: true });

    await fs.rename(sourcePath, destinationPath);
    console.log(`Moved ${sourcePath} to ${destinationPath}`);
  }

  async processResultsCSV(filePath: string): Promise<number[]> {
    console.log(`Processing results CSV: ${filePath}`);
    const testIds: number[] = [];

    return new Promise((resolve, reject) => {
      const tests: TestResultsCsvRow[] = [];

      createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => {
          tests.push(row);
        })
        .on('end', async () => {
          try {
            // Process all rows and categorize them with priority levels
            const allTests: ProcessedTestResult[] = [];

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

              // Mark debug firmware version as INVALID
              const firmwareVersion = test['Inverter Firmware'];
              if (firmwareVersion === this.config.settings.debug_firmware_version) {
                console.log(`Marking test with debug firmware version ${this.config.settings.debug_firmware_version} as INVALID for inverter ${serialNumber}`);
                overallStatus = 'INVALID';
                invalidReason = 'Debug firmware version';
                priority = 3; // Medium priority - can be processed if no better options
              }

              // Check if start time is after end time
              if (startTime && endTime) {
                const start = this.parseTimestampFromDelhi(startTime);
                const end = this.parseTimestampFromDelhi(endTime);
                if (start > end) {
                  console.log(`Marking test as INVALID due to start time (${startTime}) being after end time (${endTime}) for inverter ${serialNumber}`);
                  overallStatus = 'INVALID';
                  invalidReason = invalidReason ? `${invalidReason}, Invalid date range` : 'Invalid date range';
                  priority = 1; // Lowest priority - only process if no other options
                } else {
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
              }

              // Check if overall status is already invalid (from CSV data itself)
              if (overallStatus === 'INVALID' && priority === 4) {
                priority = 3; // If already marked invalid but no specific reason, medium priority
              }

              const testInfo: ProcessedTestResult = {
                serialNumber,
                startTime: test['Start Time'],
                endTime: test['End Time'],
                firmwareVersion: test['Inverter Firmware'],
                overallStatus,
                acStatus: test['AC Output'],
                ch1Status: test['CH1 Output'],
                ch2Status: test['CH2 Output'],
                ch3Status: test['CH3 Output'],
                ch4Status: test['CH4 Output'],
                statusFlags: test['Status Flags'],
                failureDescription: test['Failure Description'],
                failureTime: test['Failure time'],
                priority,
                invalidReason
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

              console.log(`Multiple rows found - priority breakdown: P4(valid)=${priorityGroups[4]}, P3(debug/invalid)=${priorityGroups[3]}, P2(short)=${priorityGroups[2]}, P1(date-range)=${priorityGroups[1]}`);
              console.log(`Selected: ${testToProcess.serialNumber} (${testToProcess['startTime']}) with priority ${testToProcess.priority}`);

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
                  status_flags, failure_description, failure_time, source_file
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                RETURNING test_id
              `;

              const values = [
                invId,
                this.parseTimestampFromDelhi(testToProcess.startTime).toISOString(),
                this.parseTimestampFromDelhi(testToProcess.endTime).toISOString(),
                testToProcess.firmwareVersion,
                testToProcess.overallStatus,
                testToProcess.acStatus,
                testToProcess.ch1Status,
                testToProcess.ch2Status,
                testToProcess.ch3Status,
                testToProcess.ch4Status,
                testToProcess.statusFlags || null,
                testToProcess.failureDescription || null,
                this.parseFailureTime(testToProcess.failureTime || null),
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

  async processTestDataCSV(filePath: string, testId: number): Promise<void> {
    console.log(`Processing test data CSV: ${filePath} for test_id: ${testId}`);

    return new Promise((resolve, reject) => {
      const dataRows: TestDataCsvRow[] = [];
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

  private async findAllResultsFiles(): Promise<string[]> {
    const resultsDir = path.join(this.toProcessPath, 'results');
    try {
      const files = await fs.readdir(resultsDir);
      return files.filter(file => file.endsWith('.csv')).map(file => path.join(resultsDir, file));
    } catch (error) {
      console.error(`Error reading results directory: ${resultsDir}`, error);
      return [];
    }
  }

  private async parseStartTimeFromResultsFile(filePath: string): Promise<{ serialNumber: string; startTime: Date; filenameWithSeconds: string; filenameWithoutSeconds: string } | null> {
    return new Promise((resolve, reject) => {
      let firstRow: TestResultsCsvRow | null = null;

      createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => {
          if (!firstRow) {
            firstRow = row;
          }
        })
        .on('end', () => {
          try {
            if (!firstRow) {
              console.warn(`No data found in results file: ${filePath}`);
              resolve(null);
              return;
            }

            const serialNumber = firstRow['Serial Number'];
            const startTime = firstRow['Start Time'];

            if (!serialNumber || !startTime) {
              console.warn(`Missing serial number or start time in results file: ${filePath}`);
              resolve(null);
              return;
            }

            // Parse start time as Delhi time, convert to UTC
            const startTimeUtc = this.parseTimestampFromDelhi(startTime);

            // Convert back to Delhi time for filename construction
            const startTimeDelhi = toZonedTime(startTimeUtc, 'Asia/Kolkata');

            // Create filename with full seconds (exact time)
            const dateStr = startTimeDelhi.toISOString().split('T')[0]; // YYYY-MM-DD
            const timeStrWithSeconds = startTimeDelhi.toTimeString().substring(0, 8).replace(/:/g, '-'); // HH-MM-SS
            const filenameWithSeconds = `inverter_${serialNumber}_${dateStr}_${timeStrWithSeconds}.csv`;

            // Create filename without seconds (rounded to nearest minute)
            const roundedDelhi = new Date(startTimeDelhi);
            const roundedMinutes = Math.round(roundedDelhi.getMinutes());
            roundedDelhi.setMinutes(roundedMinutes);
            roundedDelhi.setSeconds(0);
            roundedDelhi.setMilliseconds(0);

            const timeStrWithoutSeconds = roundedDelhi.toTimeString().substring(0, 5).replace(/:/g, '-'); // HH-MM
            const filenameWithoutSeconds = `inverter_${serialNumber}_${dateStr}_${timeStrWithoutSeconds}.csv`;

            resolve({
              serialNumber,
              startTime: startTimeUtc,
              filenameWithSeconds,
              filenameWithoutSeconds
            });
          } catch (error) {
            console.error(`Error parsing results file: ${filePath}`, error);
            resolve(null);
          }
        })
        .on('error', reject);
    });
  }

  private async findExactTestFileMatch(filenameWithSeconds: string, filenameWithoutSeconds: string): Promise<string | null> {
    const testsDir = path.join(this.toProcessPath, 'tests');

    // First try: exact match with seconds
    const pathWithSeconds = path.join(testsDir, filenameWithSeconds);
    try {
      await fs.access(pathWithSeconds);

      // Check if file is already used
      const isUsed = await this.isTestDataFileAlreadyUsed(filenameWithSeconds);
      if (isUsed) {
        console.log(`File ${filenameWithSeconds} already used, skipping`);
      } else {
        console.log(`✅ Found exact match with seconds: ${filenameWithSeconds}`);
        return pathWithSeconds;
      }
    } catch {
      // File doesn't exist, continue to next attempt
    }

    // Second try: exact match without seconds (rounded to nearest minute)
    const pathWithoutSeconds = path.join(testsDir, filenameWithoutSeconds);
    try {
      await fs.access(pathWithoutSeconds);

      // Check if file is already used
      const isUsed = await this.isTestDataFileAlreadyUsed(filenameWithoutSeconds);
      if (isUsed) {
        console.log(`File ${filenameWithoutSeconds} already used, skipping`);
        return null;
      }

      console.log(`✅ Found exact match without seconds: ${filenameWithoutSeconds}`);
      return pathWithoutSeconds;
    } catch {
      // File doesn't exist
      return null;
    }
  }

  private parseTimestampFromFilename(filename: string): Date | null {
    // Expected format: inverter_SERIAL_YYYY-MM-DD_HH-MM-SS.csv or inverter_SERIAL_YYYY-MM-DD_HH-MM.csv
    const match = filename.match(/inverter_\w+_(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2}(?:-\d{2})?).csv$/);
    if (!match) {
      return null;
    }

    const datePart = match[1]; // YYYY-MM-DD
    const timePart = match[2]; // HH-MM or HH-MM-SS

    try {
      // Convert HH-MM or HH-MM-SS to HH:MM:SS
      const timeFormatted = timePart.includes('-')
        ? timePart.replace(/-/g, ':')
        : timePart.replace(/-/g, ':') + ':00';

      const timestampStr = `${datePart}T${timeFormatted}`;

      // Parse as Delhi time, then convert to UTC for comparison
      return this.parseTimestampFromDelhi(timestampStr);
    } catch (error) {
      console.warn(`Error parsing timestamp from filename: ${filename}`, error);
      return null;
    }
  }

  private async findTestFilesForSerial(serialNumber: string): Promise<string[]> {
    const testsDir = path.join(this.toProcessPath, 'tests');

    try {
      const files = await fs.readdir(testsDir);
      return files.filter(file =>
        file.startsWith(`inverter_${serialNumber}_`) &&
        file.endsWith('.csv')
      );
    } catch (error) {
      console.warn(`Error reading tests directory: ${testsDir}`, error);
      return [];
    }
  }

  private async findClosestTestFile(serialNumber: string, targetTime: Date): Promise<{ filePath: string | null; timeDelta: number | null }> {
    const testFiles = await this.findTestFilesForSerial(serialNumber);

    if (testFiles.length === 0) {
      console.log(`No test files found for serial: ${serialNumber}`);
      return { filePath: null, timeDelta: null };
    }

    const candidates: Array<{ filename: string; timeDiff: number }> = [];

    for (const filename of testFiles) {
      // Check if file is already used
      const isUsed = await this.isTestDataFileAlreadyUsed(filename);
      if (isUsed) {
        console.log(`File ${filename} already used, skipping from closest match`);
        continue;
      }

      const fileTimestamp = this.parseTimestampFromFilename(filename);
      if (!fileTimestamp) {
        console.warn(`Could not parse timestamp from filename: ${filename}`);
        continue;
      }

      const timeDiff = Math.abs(targetTime.getTime() - fileTimestamp.getTime());
      candidates.push({ filename, timeDiff });
    }

    if (candidates.length === 0) {
      console.log(`No unused test files found for serial: ${serialNumber}`);
      return { filePath: null, timeDelta: null };
    }

    // Sort by time difference (closest first)
    candidates.sort((a, b) => a.timeDiff - b.timeDiff);

    const closest = candidates[0];
    const timeDiffMinutes = closest.timeDiff / (1000 * 60);

    console.log(`🔍 Found closest match: ${closest.filename} (${timeDiffMinutes.toFixed(2)} minutes difference)`);

    return { 
      filePath: path.join(this.toProcessPath, 'tests', closest.filename),
      timeDelta: closest.timeDiff
    };
  }

  async processAllFiles(): Promise<void> {
    console.log('Starting new ingestion process...');

    // Find all results files
    const resultsFiles = await this.findAllResultsFiles();
    console.log(`Found ${resultsFiles.length} results files to process`);

    const exactMatches: Array<{ resultsFile: string; testFile: string; testId: number }> = [];
    const queuedFiles: Array<{ resultsFile: string; serialNumber: string; startTime: Date; expectedFilename: string }> = [];

    // Process each results file for exact matches
    for (const resultsFile of resultsFiles) {
      console.log(`Processing results file: ${path.basename(resultsFile)}`);

      const parseResult = await this.parseStartTimeFromResultsFile(resultsFile);
      if (!parseResult) {
        console.warn(`Skipping results file due to parsing error: ${resultsFile}`);
        continue;
      }

      const { serialNumber, startTime, filenameWithSeconds, filenameWithoutSeconds } = parseResult;

      // Look for exact match (try with seconds first, then without)
      const exactTestFile = await this.findExactTestFileMatch(filenameWithSeconds, filenameWithoutSeconds);

      if (exactTestFile) {
        // Process results file to get test ID
        const testIds = await this.processResultsCSV(resultsFile);

        if (testIds.length > 0) {
          exactMatches.push({
            resultsFile,
            testFile: exactTestFile,
            testId: testIds[0]
          });
        }
      } else {
        console.log(`❌ No exact match found for: ${filenameWithSeconds} or ${filenameWithoutSeconds}`);
        queuedFiles.push({
          resultsFile,
          serialNumber,
          startTime,
          expectedFilename: filenameWithSeconds  // Use the full filename for reference
        });
      }
    }

    // Process exact matches
    console.log(`\n📊 Processing ${exactMatches.length} exact matches...`);
    for (const match of exactMatches) {
      console.log(`Processing test data for results file: ${path.basename(match.resultsFile)}`);
      await this.processTestDataCSV(match.testFile, match.testId);

      // Move processed files
      await this.moveFile(match.resultsFile, path.join(this.processedPath, 'results'));
      await this.moveFile(match.testFile, path.join(this.processedPath, 'tests'));
    }

    // Process closest matches for queued files
    console.log(`\n🔍 Processing ${queuedFiles.length} files with closest match algorithm...`);

    const closestMatches: Array<{ resultsFile: string; testFile: string; testId: number }> = [];
    const unmatched: Array<{ resultsFile: string; serialNumber: string; reason: string }> = [];
    const timeDeltaMap = new Map<string, number>(); // serialNumber -> timeDelta in ms

    for (const queued of queuedFiles) {
      console.log(`\n🔍 Finding closest match for: ${path.basename(queued.resultsFile)}`);
      console.log(`   Serial: ${queued.serialNumber}, Start time: ${queued.startTime.toISOString()}`);

      const closestResult = await this.findClosestTestFile(queued.serialNumber, queued.startTime);

      if (closestResult.filePath && closestResult.timeDelta !== null) {
        // Store time delta for debugging
        timeDeltaMap.set(queued.serialNumber, closestResult.timeDelta);
        
        // Process results file to get test ID
        const testIds = await this.processResultsCSV(queued.resultsFile);

        if (testIds.length > 0) {
          closestMatches.push({
            resultsFile: queued.resultsFile,
            testFile: closestResult.filePath,
            testId: testIds[0]
          });
        }
      } else {
        console.log(`❌ No closest match found for: ${path.basename(queued.resultsFile)}`);
        unmatched.push({
          resultsFile: queued.resultsFile,
          serialNumber: queued.serialNumber,
          reason: 'No test files found or all files already used'
        });
      }
    }

    // Process closest matches
    console.log(`\n📊 Processing ${closestMatches.length} closest matches...`);
    for (const match of closestMatches) {
      console.log(`Processing test data for closest match: ${path.basename(match.testFile)}`);
      await this.processTestDataCSV(match.testFile, match.testId);

      // Move processed files
      await this.moveFile(match.resultsFile, path.join(this.processedPath, 'results'));
      await this.moveFile(match.testFile, path.join(this.processedPath, 'tests'));
    }

    // Debug: Log time deltas sorted by largest first
    if (timeDeltaMap.size > 0) {
      console.log(`\n🔧 DEBUG: Time Delta Analysis (sorted by largest delta):`);
      const sortedDeltas = Array.from(timeDeltaMap.entries())
        .sort((a, b) => b[1] - a[1]) // Sort by delta descending (largest first)
        .map(([serialNumber, deltaMs]) => ({
          serialNumber,
          deltaMinutes: deltaMs / (1000 * 60)
        }));

      for (const { serialNumber, deltaMinutes } of sortedDeltas) {
        console.log(`   ${serialNumber}: ${deltaMinutes.toFixed(2)} minutes`);
      }
    }

    // Report final statistics
    console.log(`\n📈 Final Processing Summary:`);
    console.log(`   ✅ Exact matches: ${exactMatches.length}`);
    console.log(`   🔍 Closest matches: ${closestMatches.length}`);
    console.log(`   ❌ Unmatched files: ${unmatched.length}`);
    console.log(`   📄 Total processed: ${exactMatches.length + closestMatches.length}`);

    if (unmatched.length > 0) {
      console.log(`\n❌ Unmatched files (require manual review):`);
      for (const unmatchedFile of unmatched) {
        console.log(`   - ${path.basename(unmatchedFile.resultsFile)} (${unmatchedFile.serialNumber}): ${unmatchedFile.reason}`);
      }
    }
  }
}

async function main() {
  const ingester = new CSVIngester();

  try {
    await ingester.connect();
    await ingester.processAllFiles();
  } catch (error) {
    console.error('Ingestion failed:', error);
    process.exit(1);
  } finally {
    await ingester.disconnect();
  }
}

if (require.main === module) {
  main();
}