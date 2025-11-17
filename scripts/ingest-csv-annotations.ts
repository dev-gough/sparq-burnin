#!/usr/bin/env tsx

import { Client } from 'pg';
import * as fs from 'fs';
import csvParser from 'csv-parser';
import { getDatabaseConfig } from '../src/lib/config';

// Author information for imported annotations
const AUTHOR_NAME = 'Thomas Kulin';
const AUTHOR_EMAIL = 'tkulin@sparqsys.com';

interface CsvAnnotation {
  annotation_id: string;
  serial_number: string;
  start_time: string;
  annotation_type: string;
  annotation_text: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  current_test_id: string;
}

// Map old annotation names to new defaults
const ANNOTATION_NAME_MAP: Record<string, string> = {
  // Setup issues - map to new simplified names
  'Setup Issue - DC SRC Temp': 'DC',
  'Setup - DC': 'DC',
  'Setup - AC': 'AC',
  'Setup - Grid': 'Grid',
  'Setup - Mixed Connectors': 'Mixed Connectors',
  'Failure - Mixed Connectors': 'Mixed Connectors',

  // Device issues
  'device timeout': 'Device Timeout',

  // Manufacturing defects - these already match
  'Channel Short BA': 'Channel Short BA',
  'Channel Short AA': 'Channel Short AA',
  'Channel Undervoltage BA': 'Channel Undervoltage BA',
  'Channel Undervoltage AA': 'Channel Undervoltage AA',
  'GFDI Fault': 'GFDI Fault',

  // Other failures
  'anti islanding': 'Inverter Failure - Other',
  'unknown': 'Inverter Failure - Other',
};

function mapAnnotationName(oldName: string): string {
  return ANNOTATION_NAME_MAP[oldName] || oldName;
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

async function main() {
  const client = new Client(getDatabaseConfig());
  const csvFilePath = './testAnnotations.csv';

  if (!fs.existsSync(csvFilePath)) {
    console.error(`❌ CSV file not found: ${csvFilePath}`);
    process.exit(1);
  }

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Set timezone to UTC for consistent timestamp handling
    await client.query("SET timezone = 'UTC'");

    const annotations: CsvAnnotation[] = [];

    // Read and parse CSV file
    await new Promise<void>((resolve, reject) => {
      fs.createReadStream(csvFilePath)
        .pipe(csvParser())
        .on('data', (row: CsvAnnotation) => {
          annotations.push(row);
        })
        .on('end', () => resolve())
        .on('error', (error) => reject(error));
    });

    console.log(`📄 Read ${annotations.length} annotations from CSV`);

    let inserted = 0;
    let skipped = 0;
    let errors = 0;
    let notFound = 0;

    for (const row of annotations) {
      try {
        // Parse the start_time (it includes timezone in the CSV)
        const startTime = new Date(row.start_time);

        if (isNaN(startTime.getTime())) {
          console.warn(`⚠️  Skipping row with invalid date: ${row.start_time}`);
          skipped++;
          continue;
        }

        // Map the annotation name to new default
        const mappedAnnotationText = mapAnnotationName(row.annotation_text);

        // Check if annotation already exists
        const exists = await annotationExists(
          client,
          row.serial_number,
          startTime,
          'failure_cause',
          mappedAnnotationText
        );

        if (exists) {
          console.log(`⏭️  Annotation already exists for ${row.serial_number} on ${startTime.toISOString().split('T')[0]}, skipping`);
          skipped++;
          continue;
        }

        // Find matching test by serial number and date
        const matchingTest = await findMatchingTest(
          client,
          row.serial_number,
          startTime
        );

        if (!matchingTest) {
          console.warn(`⚠️  No test found for ${row.serial_number} on ${startTime.toISOString().split('T')[0]} - "${row.annotation_text}"`);
          notFound++;
          continue;
        }

        // Insert the annotation
        await client.query(
          `INSERT INTO TestAnnotations (
            serial_number,
            start_time,
            annotation_type,
            annotation_text,
            created_by,
            author_email,
            current_test_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            row.serial_number,
            matchingTest.start_time_utc,
            'failure_cause',
            mappedAnnotationText,
            AUTHOR_NAME,
            AUTHOR_EMAIL,
            matchingTest.test_id
          ]
        );

        console.log(`✅ Inserted: Test ${matchingTest.test_id} - ${row.serial_number} - "${row.annotation_text}" → "${mappedAnnotationText}"`);
        inserted++;

      } catch (error) {
        console.error(`❌ Error processing row for ${row.serial_number}:`, error);
        errors++;
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('📊 Import Summary:');
    console.log(`   Total rows:     ${annotations.length}`);
    console.log(`   ✅ Inserted:    ${inserted}`);
    console.log(`   ⏭️  Skipped:     ${skipped} (already exist)`);
    console.log(`   🔍 Not found:   ${notFound} (no matching test)`);
    console.log(`   ❌ Errors:      ${errors}`);
    console.log('='.repeat(80));

  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});
