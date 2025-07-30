#!/usr/bin/env tsx

import { Client } from 'pg';
import { getDatabaseConfig } from '../src/lib/config';

interface Migration {
  id: string;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    id: '001',
    name: 'add_timestamptz_column',
    sql: `
      -- Check if start_time_utc column already exists
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'tests' AND column_name = 'start_time_utc'
        ) THEN
          -- Add new TIMESTAMPTZ column
          ALTER TABLE Tests ADD COLUMN start_time_utc TIMESTAMPTZ;
          
          -- Migrate data: set session timezone to UTC, then convert timestamps
          SET timezone = 'UTC';
          UPDATE Tests SET start_time_utc = start_time::timestamptz;
          
          RAISE NOTICE 'Added start_time_utc column and migrated % rows', (SELECT COUNT(*) FROM Tests);
        ELSE
          RAISE NOTICE 'start_time_utc column already exists, skipping migration';
        END IF;
      END
      $$;
    `
  },
  {
    id: '002',
    name: 'add_testdata_timestamptz_column',
    sql: `
      -- Check if timestamp_utc column already exists in TestData
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'testdata' AND column_name = 'timestamp_utc'
        ) THEN
          -- Add new TIMESTAMPTZ column to TestData
          ALTER TABLE TestData ADD COLUMN timestamp_utc TIMESTAMPTZ;
          
          -- Migrate data: set session timezone to UTC, then convert timestamps
          SET timezone = 'UTC';
          UPDATE TestData SET timestamp_utc = timestamp::timestamptz;
          
          RAISE NOTICE 'Added timestamp_utc column to TestData and migrated % rows', (SELECT COUNT(*) FROM TestData);
        ELSE
          RAISE NOTICE 'timestamp_utc column already exists in TestData, skipping migration';
        END IF;
      END
      $$;
    `
  }
];

async function runMigrations() {
  const client = new Client(getDatabaseConfig());
  
  try {
    await client.connect();
    console.log('🔄 Connected to database, checking for migrations...');

    // Create migrations table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id VARCHAR(10) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);

    for (const migration of migrations) {
      console.log(`🔍 Checking migration: ${migration.id} - ${migration.name}`);
      
      // Check if migration already applied
      const result = await client.query(
        'SELECT id FROM migrations WHERE id = $1', 
        [migration.id]
      );
      
      if (result.rows.length > 0) {
        console.log(`✅ Migration ${migration.id} already applied, skipping`);
        continue;
      }
      
      console.log(`🚀 Applying migration: ${migration.id} - ${migration.name}`);
      
      try {
        // Run the migration
        await client.query(migration.sql);
        
        // Record successful migration
        await client.query(
          'INSERT INTO migrations (id, name, applied_at) VALUES ($1, $2, NOW())',
          [migration.id, migration.name]
        );
        
        console.log(`✅ Successfully applied migration: ${migration.id}`);
      } catch (error) {
        console.error(`❌ Failed to apply migration ${migration.id}:`, error);
        throw error;
      }
    }
    
    console.log('🎉 All migrations completed successfully');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run migrations if this file is executed directly
if (require.main === module) {
  runMigrations().catch(error => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });
}

export { runMigrations };