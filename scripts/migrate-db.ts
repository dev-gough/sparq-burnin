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
  },
  {
    id: '003',
    name: 'create_test_annotations_table',
    sql: `
      -- Create TestAnnotations table
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'testannotations'
        ) THEN
          CREATE TABLE TestAnnotations (
            annotation_id SERIAL PRIMARY KEY,
            serial_number VARCHAR(50) NOT NULL,
            start_time TIMESTAMPTZ NOT NULL,
            annotation_type VARCHAR(100) NOT NULL,
            annotation_text TEXT NOT NULL,
            created_by VARCHAR(100),
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
            current_test_id INTEGER REFERENCES Tests(test_id) ON DELETE SET NULL,
            UNIQUE(serial_number, start_time, annotation_type)
          );

          -- Create indexes for performance
          CREATE INDEX idx_testannotations_serial_start ON TestAnnotations(serial_number, start_time);
          CREATE INDEX idx_testannotations_current_test ON TestAnnotations(current_test_id);
          CREATE INDEX idx_testannotations_type ON TestAnnotations(annotation_type);

          RAISE NOTICE 'Created TestAnnotations table with indexes';
        ELSE
          RAISE NOTICE 'TestAnnotations table already exists, skipping creation';
        END IF;
      END
      $$;
    `
  },
  {
    id: '004',
    name: 'create_annotation_quick_options_table',
    sql: `
      -- Create AnnotationQuickOptions table for customizable quick annotate options
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'annotationquickoptions'
        ) THEN
          CREATE TABLE AnnotationQuickOptions (
            option_id SERIAL PRIMARY KEY,
            option_text VARCHAR(100) NOT NULL UNIQUE,
            display_order INTEGER DEFAULT 0,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
          );

          -- Insert default quick options
          INSERT INTO AnnotationQuickOptions (option_text, display_order) VALUES
            ('Channel Short BA', 1),
            ('Channel Short AA', 2),
            ('Channel Undervoltage BA', 3),
            ('Channel Undervoltage AA', 4),
            ('GFDI Fault', 5),
            ('Inverter Failure - Other', 6),
            ('Setup - AC', 7),
            ('Setup - DC', 8),
            ('Setup - Mixed Connectors', 9);

          RAISE NOTICE 'Created AnnotationQuickOptions table with default options';
        ELSE
          RAISE NOTICE 'AnnotationQuickOptions table already exists, skipping creation';
        END IF;
      END
      $$;
    `
  },
  {
    id: '005',
    name: 'update_annotation_quick_options',
    sql: `
      -- Update quick options with correct default fail reasons
      DO $$
      BEGIN
        -- Clear existing options and insert new ones
        DELETE FROM AnnotationQuickOptions;

        -- Insert updated quick options
        INSERT INTO AnnotationQuickOptions (option_text, display_order) VALUES
          ('Channel Short BA', 1),
          ('Channel Short AA', 2),
          ('Channel Undervoltage BA', 3),
          ('Channel Undervoltage AA', 4),
          ('GFDI Fault', 5),
          ('Inverter Failure - Other', 6),
          ('Setup - AC', 7),
          ('Setup - DC', 8),
          ('Setup - Mixed Connectors', 9);

        RAISE NOTICE 'Updated AnnotationQuickOptions with correct default options';
      END
      $$;
    `
  },
  {
    id: '006',
    name: 'remove_annotation_unique_constraint',
    sql: `
      -- Remove unique constraint to allow multiple annotations of the same type per test
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'testannotations_serial_number_start_time_annotation_type_key'
            AND conrelid = 'TestAnnotations'::regclass
        ) THEN
          ALTER TABLE TestAnnotations
          DROP CONSTRAINT testannotations_serial_number_start_time_annotation_type_key;

          RAISE NOTICE 'Removed unique constraint on TestAnnotations to allow multiple annotations per type';
        ELSE
          RAISE NOTICE 'Unique constraint does not exist, skipping removal';
        END IF;
      END
      $$;
    `
  },
  {
    id: '007',
    name: 'create_annotation_groups_and_update_options',
    sql: `
      -- Create AnnotationGroups table and add group_name to AnnotationQuickOptions
      DO $$
      BEGIN
        -- Create AnnotationGroups table
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'annotationgroups'
        ) THEN
          CREATE TABLE AnnotationGroups (
            group_id SERIAL PRIMARY KEY,
            group_name VARCHAR(100) NOT NULL UNIQUE,
            group_color VARCHAR(7) NOT NULL,
            display_order INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
          );

          -- Insert default groups with colors
          INSERT INTO AnnotationGroups (group_name, group_color, display_order) VALUES
            ('Manufacturing Defect / Inverter Failure', '#dc2626', 1),
            ('Setup Issue', '#f59e0b', 2);

          RAISE NOTICE 'Created AnnotationGroups table with default groups';
        ELSE
          RAISE NOTICE 'AnnotationGroups table already exists, skipping creation';
        END IF;

        -- Add group_name column to AnnotationQuickOptions if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'annotationquickoptions' AND column_name = 'group_name'
        ) THEN
          ALTER TABLE AnnotationQuickOptions ADD COLUMN group_name VARCHAR(100);

          -- Add foreign key constraint
          ALTER TABLE AnnotationQuickOptions
          ADD CONSTRAINT fk_annotation_group
          FOREIGN KEY (group_name) REFERENCES AnnotationGroups(group_name)
          ON UPDATE CASCADE
          ON DELETE SET NULL;

          RAISE NOTICE 'Added group_name column to AnnotationQuickOptions';
        ELSE
          RAISE NOTICE 'group_name column already exists, skipping addition';
        END IF;

        -- Update existing options with group assignments based on ANNOTATIONGROUPS.md
        UPDATE AnnotationQuickOptions SET group_name = 'Manufacturing Defect / Inverter Failure'
        WHERE option_text IN (
          'Channel Short BA',
          'Channel Short AA',
          'Channel Undervoltage BA',
          'Channel Undervoltage AA',
          'Inverter Failure - Other',
          'Zigbee Failure - Other'
        );

        UPDATE AnnotationQuickOptions SET group_name = 'Setup Issue'
        WHERE option_text IN (
          'DC',
          'AC',
          'Grid',
          'Mixed Connectors',
          'Device Timeout'
        );

        -- Update existing quick options to match ANNOTATIONGROUPS.md
        DELETE FROM AnnotationQuickOptions;

        INSERT INTO AnnotationQuickOptions (option_text, group_name, display_order) VALUES
          -- Manufacturing Defect / Inverter Failure
          ('Channel Short BA', 'Manufacturing Defect / Inverter Failure', 1),
          ('Channel Short AA', 'Manufacturing Defect / Inverter Failure', 2),
          ('Channel Undervoltage BA', 'Manufacturing Defect / Inverter Failure', 3),
          ('Channel Undervoltage AA', 'Manufacturing Defect / Inverter Failure', 4),
          ('Inverter Failure - Other', 'Manufacturing Defect / Inverter Failure', 5),
          ('Zigbee Failure - Other', 'Manufacturing Defect / Inverter Failure', 6),
          -- Setup Issue
          ('DC', 'Setup Issue', 1),
          ('AC', 'Setup Issue', 2),
          ('Grid', 'Setup Issue', 3),
          ('Mixed Connectors', 'Setup Issue', 4),
          ('Device Timeout', 'Setup Issue', 5);

        RAISE NOTICE 'Updated AnnotationQuickOptions with group assignments';
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