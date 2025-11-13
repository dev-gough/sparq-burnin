#!/usr/bin/env tsx

import { Client } from 'pg';
import { getDatabaseConfig } from '../src/lib/config';

async function checkTestData() {
  const client = new Client(getDatabaseConfig());
  
  try {
    await client.connect();
    console.log('Connected to database\n');

    // Get a few sample tests
    const sampleQuery = `
      SELECT 
        t.test_id,
        i.serial_number,
        t.start_time_utc,
        t.end_time,
        t.overall_status,
        t.firmware_version
      FROM Tests t
      JOIN Inverters i ON t.inv_id = i.inv_id
      ORDER BY t.start_time_utc DESC
      LIMIT 5
    `;

    const result = await client.query(sampleQuery);

    console.log('========== SAMPLE TESTS ==========\n');
    result.rows.forEach((row, idx) => {
      console.log('Test ' + (idx + 1) + ':');
      console.log('  test_id: ' + row.test_id);
      console.log('  serial_number: ' + row.serial_number);
      console.log('  start_time_utc: ' + row.start_time_utc.toISOString());
      console.log('  end_time: ' + row.end_time.toISOString());
      console.log('  overall_status: ' + row.overall_status);
      console.log('  firmware_version: ' + row.firmware_version);
      console.log('');
    });

    // Check if we have tests for specific serial numbers from Excel
    const serialsToCheck = ['190825130075', '190825060204', '190824520068'];
    
    console.log('\n========== CHECKING FOR EXCEL SERIAL NUMBERS ==========\n');
    for (const serial of serialsToCheck) {
      const checkQuery = `
        SELECT 
          t.test_id,
          i.serial_number,
          t.start_time_utc,
          t.end_time,
          t.overall_status
        FROM Tests t
        JOIN Inverters i ON t.inv_id = i.inv_id
        WHERE i.serial_number = $1
        ORDER BY t.start_time_utc DESC
        LIMIT 3
      `;
      
      const result = await client.query(checkQuery, [serial]);
      
      console.log('Serial: ' + serial);
      console.log('  Found ' + result.rows.length + ' tests');
      if (result.rows.length > 0) {
        result.rows.forEach(row => {
          console.log('    - test_id: ' + row.test_id + ', start: ' + row.start_time_utc.toISOString().split('T')[0] + ', status: ' + row.overall_status);
        });
      }
      console.log('');
    }

    // Check existing annotations
    const annotationQuery = `
      SELECT 
        annotation_id,
        serial_number,
        start_time,
        annotation_type,
        annotation_text,
        created_by,
        current_test_id
      FROM TestAnnotations
      LIMIT 5
    `;

    const annotationResult = await client.query(annotationQuery);
    console.log('\n========== SAMPLE ANNOTATIONS ==========\n');
    console.log('Total existing annotations: ' + (await client.query('SELECT COUNT(*) FROM TestAnnotations')).rows[0].count);
    if (annotationResult.rows.length > 0) {
      annotationResult.rows.forEach((row, idx) => {
        console.log('Annotation ' + (idx + 1) + ':');
        console.log('  annotation_id: ' + row.annotation_id);
        console.log('  serial_number: ' + row.serial_number);
        console.log('  start_time: ' + row.start_time.toISOString());
        console.log('  annotation_type: ' + row.annotation_type);
        console.log('  annotation_text: ' + row.annotation_text);
        console.log('  created_by: ' + row.created_by);
        console.log('  current_test_id: ' + row.current_test_id);
        console.log('');
      });
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await client.end();
  }
}

checkTestData();
