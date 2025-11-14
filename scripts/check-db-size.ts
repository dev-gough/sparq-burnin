#!/usr/bin/env tsx

/**
 * Check database and table sizes for disk space planning
 */

import { Client } from 'pg';
import { getDatabaseConfig } from '../src/lib/config';

async function checkDatabaseSize() {
  const client = new Client(getDatabaseConfig());

  try {
    await client.connect();
    console.log('Connected to PostgreSQL database\n');

    // Get database size
    const dbSizeQuery = `
      SELECT
        pg_database.datname as database_name,
        pg_size_pretty(pg_database_size(pg_database.datname)) AS size
      FROM pg_database
      WHERE datname = current_database()
    `;

    const dbSizeResult = await client.query(dbSizeQuery);
    console.log('='.repeat(80));
    console.log('DATABASE SIZE');
    console.log('='.repeat(80));
    console.log(`Database: ${dbSizeResult.rows[0].database_name}`);
    console.log(`Total Size: ${dbSizeResult.rows[0].size}`);
    console.log('');

    // Get individual table sizes with row counts
    const tableSizeQuery = `
      SELECT
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
        pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename) - pg_relation_size(schemaname||'.'||tablename)) AS indexes_size,
        pg_total_relation_size(schemaname||'.'||tablename) AS total_bytes,
        (SELECT count(*) FROM information_schema.tables t WHERE t.table_schema = schemaname AND t.table_name = tablename) as exists
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
    `;

    const tableSizeResult = await client.query(tableSizeQuery);

    console.log('='.repeat(80));
    console.log('TABLE SIZES (sorted by total size)');
    console.log('='.repeat(80));
    console.log('');

    let totalBytes = 0;

    for (const row of tableSizeResult.rows) {
      // Get row count
      const countQuery = `SELECT count(*) as count FROM ${row.tablename}`;
      const countResult = await client.query(countQuery);
      const rowCount = countResult.rows[0].count;

      console.log(`📊 Table: ${row.tablename}`);
      console.log(`   Total Size:   ${row.total_size} (table: ${row.table_size}, indexes: ${row.indexes_size})`);
      console.log(`   Row Count:    ${Number(rowCount).toLocaleString()}`);
      console.log('');

      totalBytes += parseInt(row.total_bytes);
    }

    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));

    const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);
    const totalGB = (totalBytes / (1024 * 1024 * 1024)).toFixed(2);

    console.log(`Total Tables Size: ${totalMB} MB (${totalGB} GB)`);
    console.log('');

    // Estimate growth
    const testDataQuery = `SELECT count(*) as count FROM TestData`;
    const testDataResult = await client.query(testDataQuery);
    const testDataRows = parseInt(testDataResult.rows[0].count);

    if (testDataRows > 0) {
      const testDataBytes = tableSizeResult.rows.find(r => r.tablename === 'testdata')?.total_bytes || 0;
      const bytesPerRow = testDataBytes / testDataRows;

      console.log('='.repeat(80));
      console.log('GROWTH ESTIMATES');
      console.log('='.repeat(80));
      console.log(`Current TestData rows: ${testDataRows.toLocaleString()}`);
      console.log(`Bytes per row: ${bytesPerRow.toFixed(2)}`);
      console.log('');
      console.log('Projected size for additional tests:');
      console.log(`  +1,000 tests (~1.4M rows):   ${((bytesPerRow * 1400000) / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`  +5,000 tests (~7M rows):     ${((bytesPerRow * 7000000) / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`  +10,000 tests (~14M rows):   ${((bytesPerRow * 14000000) / (1024 * 1024 * 1024)).toFixed(2)} GB`);
      console.log('');
    }

    console.log('='.repeat(80));

  } catch (error) {
    console.error('Error checking database size:', error);
    throw error;
  } finally {
    await client.end();
  }
}

checkDatabaseSize().catch(console.error);
