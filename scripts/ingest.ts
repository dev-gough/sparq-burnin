#!/usr/bin/env tsx

import { Client } from 'pg';
import * as fs from 'fs/promises';
import * as path from 'path';
import csvParser from 'csv-parser';
import { createReadStream } from 'fs';
import { toZonedTime } from 'date-fns-tz';

import { loadConfig, type Config, isProfilingEnabled } from '../src/lib/config';
import { runMigrations } from './migrate-db';
import { Profiler } from './profiler';
// Shared ingest core (single source of truth for BOTH transports — HTTPS API
// and this CSV script). Import the specific modules, NOT the barrel
// (src/lib/ingest/index.ts): the barrel re-exports processPayload.ts, which
// pulls in `@/`-aliased Next-side modules that tsx doesn't resolve here.
import {
  parseTimestampFromDelhi,
} from '../src/lib/ingest/timestamps';
import {
  evaluateResultRow,
  selectBestResult,
  type ValidatedResult,
} from '../src/lib/ingest/validate';
import {
  ensureInverter,
  findExistingTestByInvStart,
  insertSamplesCopy,
  insertTest,
  relinkAllAnnotations,
} from '../src/lib/ingest/dbInsert';
import type { IngestSample } from '../src/lib/ingest/schema';

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
  /** Parsed once by the shared rule evaluation; null when start/end missing. */
  startTimeUtc: string | null;
  endTimeUtc: string | null;
}

class CSVIngester {
  private client: Client;
  private readonly config: Config;
  private readonly toProcessPath: string;
  private readonly processedPath: string;
  private usedFilesCache: Set<string> = new Set();
  private profiler: Profiler;

  constructor() {
    this.config = loadConfig();
    this.profiler = new Profiler(isProfilingEnabled());

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
      await this.profiler.time('db_connect', async () => {
        await this.client.connect();
      });
      console.log('Connected to PostgreSQL database');
    } catch (error) {
      console.error('Failed to connect to database:', error);
      throw error;
    }
  }

  async loadUsedFilesCache(): Promise<void> {
    await this.profiler.time('load_used_files_cache', async () => {
      console.log('📦 Loading used files cache from database...');

      const query = `
        SELECT DISTINCT source_file
        FROM TestData
        WHERE source_file IS NOT NULL
      `;

      const result = await this.client.query(query);

      this.usedFilesCache = new Set(result.rows.map(row => row.source_file));

      console.log(`✅ Loaded ${this.usedFilesCache.size} used files into cache`);
    });
  }

  async disconnect(): Promise<void> {
    await this.client.end();
    console.log('Disconnected from PostgreSQL database');
  }

  async ensureInverter(serialNumber: string): Promise<number> {
    return await this.profiler.time('db_ensure_inverter', async () => {
      return await ensureInverter(this.client, serialNumber);
    }, { serialNumber });
  }

  async insertTestDataBatch(rows: TestDataCsvRow[], testId: number, sourceFile: string): Promise<void> {
    if (rows.length === 0) return;

    return await this.profiler.time('db_insert_test_data_batch', async () => {
      // Map raw CSV strings into the shared sample shape; the 41-column COPY
      // itself (column list, TSV/NULL serialization, batching) is the shared
      // implementation in src/lib/ingest/dbInsert.ts, identical for both
      // transports.
      const samples: IngestSample[] = rows.map((row) => this.csvRowToSample(row));
      await insertSamplesCopy(this.client, testId, samples, sourceFile);

      // Add to used files cache after successful insert
      this.usedFilesCache.add(sourceFile);
    }, { rowCount: rows.length, testId });
  }

  /** CSV header/string → shared IngestSample mapping (CSV-transport specific). */
  private csvRowToSample(row: TestDataCsvRow): IngestSample {
    return {
      timestamp: row['Timestamp'],
      vgrid: this.parseFloat(row['Vgrid']),
      pgrid: this.parseFloat(row['Pgrid']),
      qgrid: this.parseFloat(row['Qgrid']),
      vpv1: this.parseFloat(row['Vpv1']),
      ppv1: this.parseFloat(row['Ppv1']),
      vpv2: this.parseFloat(row['Vpv2']),
      ppv2: this.parseFloat(row['Ppv2']),
      vpv3: this.parseFloat(row['Vpv3']),
      ppv3: this.parseFloat(row['Ppv3']),
      vpv4: this.parseFloat(row['Vpv4']),
      ppv4: this.parseFloat(row['Ppv4']),
      frequency: this.parseFloat(row['Frequency']),
      vbus: this.parseFloat(row['Vbus']),
      extstatus: this.parseInt(row['extstatus']),
      status: this.parseInt(row['status']),
      temperature: this.parseFloat(row['Temperature']),
      epv1: this.parseFloat(row['EPV1']),
      epv2: this.parseFloat(row['EPV2']),
      epv3: this.parseFloat(row['EPV3']),
      epv4: this.parseFloat(row['EPV4']),
      activeEnergy: this.parseFloat(row['ActiveEnergy']),
      reactiveEnergy: this.parseFloat(row['ReactiveEnergy']),
      extstatusLatch: this.parseInt(row['extstatus_latch']),
      statusLatch: this.parseInt(row['status_latch']),
      vgridInstLatch: this.parseFloat(row['Vgrid_inst_latch']),
      vntrlInstLatch: this.parseFloat(row['Vntrl_inst_latch']),
      igridInstLatch: this.parseFloat(row['Igrid_inst_latch']),
      vbusInstLatch: this.parseFloat(row['Vbus_inst_latch']),
      vpv1InstLatch: this.parseFloat(row['Vpv1_inst_latch']),
      ipv1InstLatch: this.parseFloat(row['Ipv1_inst_latch']),
      vpv2InstLatch: this.parseFloat(row['Vpv2_inst_latch']),
      ipv2InstLatch: this.parseFloat(row['Ipv2_inst_latch']),
      vpv3InstLatch: this.parseFloat(row['Vpv3_inst_latch']),
      ipv3InstLatch: this.parseFloat(row['Ipv3_inst_latch']),
      vpv4InstLatch: this.parseFloat(row['Vpv4_inst_latch']),
      ipv4InstLatch: this.parseFloat(row['Ipv4_inst_latch']),
      statusBits: row['status_bits'] || null,
    };
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

  // Delhi→UTC parsing and failure-time parsing live in the shared core
  // (src/lib/ingest/timestamps.ts) — used via parseTimestampFromDelhi and,
  // inside insertTest, parseFailureTime.

  async isTestDataFileAlreadyUsed(fileName: string): Promise<boolean> {
    // Use in-memory cache instead of querying database
    return this.usedFilesCache.has(fileName);
  }

  async moveFile(sourcePath: string, destinationDir: string): Promise<void> {
    await this.profiler.time('file_move', async () => {
      const fileName = path.basename(sourcePath);
      const destinationPath = path.join(destinationDir, fileName);

      // Ensure destination directory exists
      await fs.mkdir(destinationDir, { recursive: true });

      await fs.rename(sourcePath, destinationPath);
      console.log(`Moved ${sourcePath} to ${destinationPath}`);
    });
  }

  async processResultsCSV(filePath: string): Promise<number[]> {
    console.log(`Processing results CSV: ${filePath}`);
    const testIds: number[] = [];

    return this.profiler.time('process_results_csv', () => new Promise<number[]>((resolve, reject) => {
      const tests: TestResultsCsvRow[] = [];

      createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => {
          tests.push(row);
        })
        .on('end', async () => {
          try {
            // Process all rows and categorize them with priority levels using
            // the shared rule core (src/lib/ingest/validate.ts) — the same
            // INVALID/priority rules the HTTPS transport applies.
            const allTests: ProcessedTestResult[] = [];

            for (const test of tests) {
              // Extract inverter serial from filename or use Serial Number column
              const serialNumber = test['Serial Number'];
              if (!serialNumber) {
                console.warn(`No serial number found in row: ${JSON.stringify(test)}`);
                continue;
              }

              const evaluation = evaluateResultRow(
                {
                  serialNumber,
                  startTime: test['Start Time'],
                  endTime: test['End Time'],
                  firmwareVersion: test['Inverter Firmware'],
                  overallStatus: test['Overall'],
                },
                this.config.settings.debug_firmware_version,
                (message) => console.log(message)
              );
              // Legacy behavior: an unparseable start/end timestamp fails the
              // whole results file (rejects this promise), it is not stored.
              if (evaluation.timestampParseError) {
                throw evaluation.timestampParseError;
              }

              // Support both historical headers (AC Output / Failure time)
              // and current burn-in software headers (AC / Failure Time).
              const acStatus = test['AC Output'] ?? (test as unknown as Record<string, string>)['AC'];
              const ch1Status = test['CH1 Output'] ?? (test as unknown as Record<string, string>)['CH1'];
              const ch2Status = test['CH2 Output'] ?? (test as unknown as Record<string, string>)['CH2'];
              const ch3Status = test['CH3 Output'] ?? (test as unknown as Record<string, string>)['CH3'];
              const ch4Status = test['CH4 Output'] ?? (test as unknown as Record<string, string>)['CH4'];
              const failureTime =
                test['Failure time'] ??
                (test as unknown as Record<string, string>)['Failure Time'];

              const testInfo: ProcessedTestResult = {
                serialNumber,
                startTime: test['Start Time'],
                endTime: test['End Time'],
                firmwareVersion: test['Inverter Firmware'],
                overallStatus: evaluation.overallStatus,
                acStatus,
                ch1Status,
                ch2Status,
                ch3Status,
                ch4Status,
                statusFlags: test['Status Flags'],
                failureDescription: test['Failure Description'],
                failureTime,
                priority: evaluation.priority,
                invalidReason: evaluation.invalidReason,
                startTimeUtc: evaluation.startTimeUtc,
                endTimeUtc: evaluation.endTimeUtc,
              };

              allTests.push(testInfo);
            }

            // Log summary
            console.log(`Found ${tests.length} total rows`);

            // Select the best test to process based on priority — shared
            // multi-row selection rule (see selectBestResult's doc; the station
            // client mirrors it).
            const testToProcess = selectBestResult(allTests, {
              fileLabel: path.basename(filePath),
              log: (message) => console.log(message),
              warn: (message) => console.warn(message),
            });

            if (testToProcess) {
              const invId = await this.ensureInverter(testToProcess.serialNumber);

              const startTimeUtc =
                testToProcess.startTimeUtc ??
                parseTimestampFromDelhi(testToProcess.startTime).toISOString();

              // Cross-pipeline dedup (migration window): the same physical test
              // may already exist from an HTTPS ingest (which dedups by
              // idempotency key, not filename). Shared guard on
              // (inv_id, start_time_utc) with a 1-second tolerance.
              // NOTE: this queries only rows ALREADY committed to the DB, so it
              // never collides with the multi-row priority selection above (which
              // picks a single row per file) and it stays reprocess-safe: during
              // reprocess only https:* rows survive the clear, and those are
              // exactly the rows we want to dedup against.
              const existingTest = await findExistingTestByInvStart(
                this.client,
                invId,
                startTimeUtc
              );
              if (existingTest) {
                console.log(
                  `⏭️  Skipping ${path.basename(filePath)}: test already exists for inverter ${testToProcess.serialNumber} at ${startTimeUtc} (test_id ${existingTest.testId}, source ${existingTest.sourceFile}). Cross-pipeline duplicate.`
                );
                resolve(testIds);
                return;
              }

              const endTimeUtc =
                testToProcess.endTimeUtc ??
                parseTimestampFromDelhi(testToProcess.endTime).toISOString();

              const validated: ValidatedResult = {
                serialNumber: testToProcess.serialNumber,
                startTime: testToProcess.startTime,
                endTime: testToProcess.endTime,
                startTimeUtc,
                endTimeUtc,
                firmwareVersion: testToProcess.firmwareVersion ?? null,
                overallStatus: testToProcess.overallStatus,
                acStatus: testToProcess.acStatus ?? null,
                ch1Status: testToProcess.ch1Status ?? null,
                ch2Status: testToProcess.ch2Status ?? null,
                ch3Status: testToProcess.ch3Status ?? null,
                ch4Status: testToProcess.ch4Status ?? null,
                statusFlags: testToProcess.statusFlags || null,
                failureDescription: testToProcess.failureDescription || null,
                failureTime: testToProcess.failureTime ?? null,
                invalidReason: testToProcess.invalidReason,
              };

              const testId = await insertTest(this.client, {
                invId,
                validated,
                stationId: null,
                idempotencyKey: null,
                sourceFile: path.basename(filePath),
              });
              testIds.push(testId);

              console.log(`Inserted test ${testId} for inverter ${testToProcess.serialNumber}`);
            } else {
              console.log(`No valid tests found in ${path.basename(filePath)}`);
            }
            resolve(testIds);
          } catch (error) {
            reject(error);
          }
        })
        .on('error', reject);
    }), { file: path.basename(filePath) });
  }

  async processTestDataCSV(filePath: string, testId: number): Promise<void> {
    console.log(`Processing test data CSV: ${filePath} for test_id: ${testId}`);

    return this.profiler.time('process_test_data_csv', () => new Promise<void>((resolve, reject) => {
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
            // Tested: 1000 rows is optimal (1500 was 36s slower due to query planning overhead)
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
    }), { file: path.basename(filePath), testId });
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
            const startTimeUtc = parseTimestampFromDelhi(startTime);

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
    return await this.profiler.time('find_exact_match', async () => {
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
    });
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
      return parseTimestampFromDelhi(timestampStr);
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
    return await this.profiler.time('find_closest_match', async () => {
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
    }, { serialNumber });
  }

  async relinkAnnotations(): Promise<void> {
    console.log('🔗 Re-linking annotations to new test IDs...');

    await this.profiler.time('db_relink_annotations', async () => {
      const count = await relinkAllAnnotations(this.client);
      console.log(`✅ Re-linked ${count} annotations to new test IDs`);
    });
  }

  async countTotalTests(): Promise<number> {
    const result = await this.client.query('SELECT COUNT(*)::int AS n FROM Tests');
    return result.rows[0]?.n ?? 0;
  }

  /**
   * Process all pending files under to_process/.
   * Returns summary stats for ops status / Control Center.
   */
  async processAllFiles(): Promise<{
    newTests: number;
    exactMatches: number;
    closestMatches: number;
    unmatched: number;
    totalTests: number;
  }> {
    console.log('Starting new ingestion process...');

    // Load used files cache once at startup
    await this.loadUsedFilesCache();

    // Find all results files
    this.profiler.start('overall_ingestion');
    const resultsFiles = await this.profiler.time('find_all_results_files', async () => {
      return await this.findAllResultsFiles();
    });
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
    const newTests = exactMatches.length + closestMatches.length;
    console.log(`\n📈 Final Processing Summary:`);
    console.log(`   ✅ Exact matches: ${exactMatches.length}`);
    console.log(`   🔍 Closest matches: ${closestMatches.length}`);
    console.log(`   ❌ Unmatched files: ${unmatched.length}`);
    console.log(`   📄 Total processed: ${newTests}`);

    if (unmatched.length > 0) {
      console.log(`\n❌ Unmatched files (require manual review):`);
      for (const unmatchedFile of unmatched) {
        console.log(`   - ${path.basename(unmatchedFile.resultsFile)} (${unmatchedFile.serialNumber}): ${unmatchedFile.reason}`);
      }
    }

    // Re-link annotations after processing all files
    await this.relinkAnnotations();

    this.profiler.stop('overall_ingestion');
    this.profiler.printSummary();

    let totalTests = 0;
    try {
      totalTests = await this.countTotalTests();
      console.log(`   📚 Total tests in DB: ${totalTests}`);
    } catch (err) {
      console.warn('Could not count total tests:', err);
    }

    return {
      newTests,
      exactMatches: exactMatches.length,
      closestMatches: closestMatches.length,
      unmatched: unmatched.length,
      totalTests,
    };
  }
}

async function writeOpsIngestStatus(payload: {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  success: boolean;
  newTests: number;
  totalTests: number | null;
  exactMatches?: number;
  closestMatches?: number;
  unmatched?: number;
  error?: string | null;
}): Promise<void> {
  try {
    // Dynamic import so the script still works if path aliases differ
    const { writeIngestStatus } = await import('../src/lib/opsStatus');
    await writeIngestStatus(payload);
    console.log('📝 Wrote ingest ops status for Control Center');
  } catch (err) {
    console.warn('Failed to write ingest ops status:', err);
  }
}

async function main() {
  // Run database migrations before starting ingestion
  console.log('🔄 Checking for database migrations...');
  await runMigrations();

  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const ingester = new CSVIngester();
  try {
    await ingester.connect();
    const summary = await ingester.processAllFiles();
    const finishedAt = new Date().toISOString();
    await writeOpsIngestStatus({
      startedAt,
      finishedAt,
      durationMs: Date.now() - startedMs,
      success: true,
      newTests: summary.newTests,
      totalTests: summary.totalTests,
      exactMatches: summary.exactMatches,
      closestMatches: summary.closestMatches,
      unmatched: summary.unmatched,
      error: null,
    });
  } catch (error) {
    console.error('Ingestion failed:', error);
    const finishedAt = new Date().toISOString();
    await writeOpsIngestStatus({
      startedAt,
      finishedAt,
      durationMs: Date.now() - startedMs,
      success: false,
      newTests: 0,
      totalTests: null,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  } finally {
    await ingester.disconnect();
  }
}

if (require.main === module) {
  main();
}