#!/usr/bin/env tsx

import * as XLSX from 'xlsx';
import { Client } from 'pg';
import { getDatabaseConfig } from '../src/lib/config';

// Author information for imported annotations
const AUTHOR_NAME = 'Thomas Kulin';
const AUTHOR_EMAIL = 'tkulin@sparqsys.com';

// Excel column names
interface ExcelRow {
  'Failure Date': string;
  'Failure Category': string;
  'Serial Number': string;
  'Additional Information': string;
}

// Category normalization mapping
// Maps Excel categories to existing AnnotationQuickOptions values
const CATEGORY_MAP: Record<string, string> = {
  // Channel issues - map to existing options
  'Channel Short Circuit Before Aging': 'Channel Short BA',
  'Channel Short Circuit During Aging': 'Channel Short AA',
  'Channel Undervoltage Before Aging': 'Channel Undervoltage BA',
  'Channel Undervoltage During Aging': 'Channel Undervoltage AA',

  // Setup issues - map to existing options
  'Setup Issue - AC': 'AC',
  'Setup Issue - DC': 'DC',
  'Setup Issue - Mixed Connectors': 'Mixed Connectors',
  'Manufacturing Issue - Failure due to inverted connectors': 'Mixed Connectors',

  // Inverter failures - map to existing options
  'Inverter Failure During Burnin - Other': 'Inverter Failure - Other',

  // Other inverter failures - all under Manufacturing Defect / Inverter Failure group
  'GFDI Fault': 'GFDI Fault',
  'Device Timeout': 'Device Timeout',
  'Grid Issue': 'Grid Issue',
  'Anti-Islanding': 'Anti-Islanding',
  'Unknown': 'Unknown'
};

/**
 * Parse Excel date in DD/MM/YYYY format to Date object
 */
function parseExcelDate(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) {
    return null;
  }

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // Month is 0-indexed
  const year = parseInt(parts[2], 10);

  if (isNaN(day) || isNaN(month) || isNaN(year)) {
    return null;
  }

  const date = new Date(Date.UTC(year, month, day, 0, 0, 0, 0));

  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

/**
 * Normalize Excel failure category to annotation text
 */
function normalizeCategory(category: string): string {
  return CATEGORY_MAP[category] || category;
}

/**
 * Find matching test for a given serial number and date
 */
async function findMatchingTest(
  client: Client,
  serialNumber: string,
  date: Date
): Promise<{ test_id: number; start_time_utc: Date } | null> {
  const dateStr = date.toISOString().split('T')[0]; // Get YYYY-MM-DD

  const query = `
    SELECT t.test_id, t.start_time_utc
    FROM Tests t
    JOIN Inverters i ON t.inv_id = i.inv_id
    WHERE i.serial_number = $1
      AND DATE(t.start_time_utc) = $2::date
    ORDER BY t.start_time_utc ASC
    LIMIT 1
  `;

  try {
    const result = await client.query(query, [serialNumber, dateStr]);

    if (result.rows.length === 0) {
      return null;
    }

    return {
      test_id: result.rows[0].test_id,
      start_time_utc: result.rows[0].start_time_utc
    };
  } catch (error) {
    console.error(`Error finding test for ${serialNumber} on ${dateStr}:`, error);
    return null;
  }
}

/**
 * Check if annotation already exists to prevent duplicates
 */
async function annotationExists(
  client: Client,
  serialNumber: string,
  startTime: Date,
  annotationType: string,
  annotationText: string
): Promise<boolean> {
  const query = `
    SELECT annotation_id
    FROM TestAnnotations
    WHERE serial_number = $1
      AND ABS(EXTRACT(EPOCH FROM (start_time - $2::timestamptz))) < 1
      AND annotation_type = $3
      AND annotation_text = $4
    LIMIT 1
  `;

  try {
    const result = await client.query(query, [
      serialNumber,
      startTime.toISOString(),
      annotationType,
      annotationText
    ]);

    return result.rows.length > 0;
  } catch (error) {
    console.error('Error checking for duplicate annotation:', error);
    return false;
  }
}

/**
 * Insert annotation into database
 */
async function insertAnnotation(
  client: Client,
  serialNumber: string,
  startTime: Date,
  annotationType: string,
  annotationText: string,
  testId: number | null
): Promise<boolean> {
  const query = `
    INSERT INTO TestAnnotations (
      serial_number,
      start_time,
      annotation_type,
      annotation_text,
      created_by,
      author_email,
      current_test_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING annotation_id
  `;

  try {
    const result = await client.query(query, [
      serialNumber,
      startTime.toISOString(),
      annotationType,
      annotationText,
      AUTHOR_NAME,
      AUTHOR_EMAIL,
      testId
    ]);

    return result.rows.length > 0;
  } catch (error) {
    console.error('Error inserting annotation:', error);
    return false;
  }
}

/**
 * Ensure annotation quick options exist for all categories
 * Creates missing options under the Manufacturing Defect / Inverter Failure group
 */
async function ensureAnnotationQuickOptions(client: Client): Promise<void> {
  const manufacturingDefectGroup = 'Manufacturing Defect / Inverter Failure';

  // Categories that should be in the Manufacturing Defect group
  const categoriesForManufacturingDefect = [
    'GFDI Fault',
    'Device Timeout',
    'Grid Issue',
    'Anti-Islanding',
    'Unknown'
  ];

  for (const optionText of categoriesForManufacturingDefect) {
    // Check if option already exists
    const checkQuery = `
      SELECT option_id FROM AnnotationQuickOptions
      WHERE option_text = $1
    `;

    const existingResult = await client.query(checkQuery, [optionText]);

    if (existingResult.rows.length === 0) {
      // Option doesn't exist, create it
      const insertQuery = `
        INSERT INTO AnnotationQuickOptions (option_text, group_name, is_active)
        VALUES ($1, $2, true)
        ON CONFLICT (option_text) DO NOTHING
      `;

      await client.query(insertQuery, [optionText, manufacturingDefectGroup]);
      console.log(`  ✅ Created AnnotationQuickOption: "${optionText}" → ${manufacturingDefectGroup}`);
    } else {
      // Option exists, update group_name if different
      const updateQuery = `
        UPDATE AnnotationQuickOptions
        SET group_name = $2
        WHERE option_text = $1
          AND (group_name IS DISTINCT FROM $2)
      `;

      const result = await client.query(updateQuery, [optionText, manufacturingDefectGroup]);

      if (result.rowCount && result.rowCount > 0) {
        console.log(`  ✅ Updated AnnotationQuickOption: "${optionText}" → ${manufacturingDefectGroup}`);
      }
    }
  }
}

/**
 * Main ingestion function
 */
async function ingestExcelAnnotations() {
  const excelFilePath = './Burnin Failure Overview.xlsx';
  const client = new Client(getDatabaseConfig());

  console.log('🔄 Starting Excel annotation ingestion...');
  console.log(`📁 Reading file: ${excelFilePath}`);
  console.log(`👤 Author: ${AUTHOR_NAME} <${AUTHOR_EMAIL}>\n`);

  try {
    // Read Excel file
    const workbook = XLSX.readFile(excelFilePath);
    console.log(`📑 Available sheets: ${workbook.SheetNames.join(', ')}`);

    const sheetName = 'Failures'; // Use the Failures sheet
    console.log(`📄 Using sheet: "${sheetName}"`);

    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json<ExcelRow>(worksheet);

    console.log(`📊 Found ${data.length} rows in Excel file`);

    // Debug: Show first row if available
    if (data.length > 0) {
      console.log(`🔍 First row sample:`, JSON.stringify(data[0], null, 2));
    } else {
      console.log(`⚠️  No data found in sheet. Sheet range:`, worksheet['!ref']);
    }
    console.log('');

    // Connect to database
    await client.connect();
    console.log('✅ Connected to database\n');

    // Ensure all annotation quick options exist with proper grouping
    console.log('📝 Ensuring annotation quick options exist...');
    await ensureAnnotationQuickOptions(client);
    console.log('');

    // Statistics
    let processed = 0;
    let inserted = 0;
    let duplicates = 0;
    let noTestMatch = 0;
    let parseErrors = 0;

    const skippedRows: Array<{
      row: number;
      reason: string;
      serial: string;
      date: string;
    }> = [];

    // Process each row
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2; // +2 because Excel is 1-indexed and has header row

      processed++;

      // Validate required fields
      if (!row['Serial Number']) {
        console.log(`⚠️  Row ${rowNum}: Missing serial number`);
        skippedRows.push({
          row: rowNum,
          reason: 'Missing serial number',
          serial: '',
          date: row['Failure Date'] || ''
        });
        parseErrors++;
        continue;
      }

      if (!row['Failure Date']) {
        console.log(`⚠️  Row ${rowNum}: Missing failure date`);
        skippedRows.push({
          row: rowNum,
          reason: 'Missing failure date',
          serial: row['Serial Number'],
          date: ''
        });
        parseErrors++;
        continue;
      }

      if (!row['Failure Category']) {
        console.log(`⚠️  Row ${rowNum}: Missing failure category`);
        skippedRows.push({
          row: rowNum,
          reason: 'Missing failure category',
          serial: row['Serial Number'],
          date: row['Failure Date']
        });
        parseErrors++;
        continue;
      }

      // Parse date
      const failureDate = parseExcelDate(row['Failure Date']);
      if (!failureDate) {
        console.log(`⚠️  Row ${rowNum}: Invalid date format "${row['Failure Date']}"`);
        skippedRows.push({
          row: rowNum,
          reason: `Invalid date format: ${row['Failure Date']}`,
          serial: row['Serial Number'],
          date: row['Failure Date']
        });
        parseErrors++;
        continue;
      }

      // Find matching test
      const test = await findMatchingTest(
        client,
        row['Serial Number'],
        failureDate
      );

      if (!test) {
        console.log(
          `⚠️  Row ${rowNum}: No test found for S/N ${row['Serial Number']} on ${row['Failure Date']}`
        );
        skippedRows.push({
          row: rowNum,
          reason: 'No matching test found',
          serial: row['Serial Number'],
          date: row['Failure Date']
        });
        noTestMatch++;
        continue;
      }

      // Normalize category
      const normalizedCategory = normalizeCategory(row['Failure Category']);
      const additionalInfo = row['Additional Information'] || '';

      // Check for duplicate failure_cause annotation
      const failureCauseExists = await annotationExists(
        client,
        row['Serial Number'],
        test.start_time_utc,
        'failure_cause',
        normalizedCategory
      );

      if (failureCauseExists) {
        console.log(
          `⏭️  Row ${rowNum}: Duplicate failure_cause annotation (S/N ${row['Serial Number']}, ${row['Failure Date']})`
        );
        duplicates++;
        continue;
      }

      // Insert failure_cause annotation (with normalized category for grouping/colors)
      const failureCauseSuccess = await insertAnnotation(
        client,
        row['Serial Number'],
        test.start_time_utc,
        'failure_cause',
        normalizedCategory,  // Use normalized category for matching AnnotationQuickOptions
        test.test_id
      );

      if (!failureCauseSuccess) {
        console.log(
          `❌ Row ${rowNum}: Failed to insert failure_cause annotation`
        );
        skippedRows.push({
          row: rowNum,
          reason: 'Database insert failed',
          serial: row['Serial Number'],
          date: row['Failure Date']
        });
        continue;
      }

      console.log(
        `✅ Row ${rowNum}: Inserted failure_cause for test ${test.test_id} (${normalizedCategory})`
      );
      inserted++;

      // If there's additional information, create a custom_note annotation
      if (additionalInfo.trim()) {
        const noteExists = await annotationExists(
          client,
          row['Serial Number'],
          test.start_time_utc,
          'custom_note',
          additionalInfo
        );

        if (!noteExists) {
          const noteSuccess = await insertAnnotation(
            client,
            row['Serial Number'],
            test.start_time_utc,
            'custom_note',
            additionalInfo,
            test.test_id
          );

          if (noteSuccess) {
            console.log(
              `  📝 Added additional info note: "${additionalInfo}"`
            );
            inserted++;
          }
        }
      }

      // Progress update every 50 rows
      if (processed % 50 === 0) {
        console.log(`\n📈 Progress: ${processed}/${data.length} rows processed\n`);
      }
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 INGESTION SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total rows processed:     ${processed}`);
    console.log(`✅ Successfully inserted:  ${inserted}`);
    console.log(`⏭️  Duplicates (skipped):   ${duplicates}`);
    console.log(`⚠️  No test match:          ${noTestMatch}`);
    console.log(`❌ Parse errors:           ${parseErrors}`);
    console.log('='.repeat(60));

    // Print detailed skip report if any
    if (skippedRows.length > 0) {
      console.log('\n⚠️  SKIPPED ROWS REPORT:');
      console.log('='.repeat(60));
      for (const skip of skippedRows) {
        console.log(
          `Row ${skip.row}: ${skip.reason} (S/N: ${skip.serial}, Date: ${skip.date})`
        );
      }
      console.log('='.repeat(60));
    }

    console.log('\n✅ Excel annotation ingestion complete!\n');

  } catch (error) {
    console.error('\n❌ Ingestion failed:', error);
    throw error;
  } finally {
    await client.end();
    console.log('🔌 Database connection closed');
  }
}

// Run ingestion if this file is executed directly
if (require.main === module) {
  ingestExcelAnnotations()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { ingestExcelAnnotations };
