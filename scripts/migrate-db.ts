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
  },
  {
    id: '008',
    name: 'add_author_email_to_annotations',
    sql: `
      -- Add author_email column to TestAnnotations for tracking who created/modified annotations
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'testannotations' AND column_name = 'author_email'
        ) THEN
          ALTER TABLE TestAnnotations ADD COLUMN author_email VARCHAR(255);

          RAISE NOTICE 'Added author_email column to TestAnnotations';
        ELSE
          RAISE NOTICE 'author_email column already exists in TestAnnotations, skipping';
        END IF;
      END
      $$;
    `
  },
  {
    id: '009',
    name: 'add_testdata_test_id_index',
    sql: `
      -- Add index on TestData.test_id for faster lookups
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE tablename = 'testdata' AND indexname = 'idx_testdata_test_id'
        ) THEN
          CREATE INDEX idx_testdata_test_id ON TestData(test_id);

          RAISE NOTICE 'Created index idx_testdata_test_id on TestData(test_id)';
        ELSE
          RAISE NOTICE 'Index idx_testdata_test_id already exists, skipping';
        END IF;
      END
      $$;
    `
  },
  {
    id: '010',
    name: 'https_ingest_receipts_and_station',
    sql: `
      DO $$
      BEGIN
        -- Station identity + idempotency on Tests
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'tests' AND column_name = 'station_id'
        ) THEN
          ALTER TABLE Tests ADD COLUMN station_id TEXT;
          RAISE NOTICE 'Added Tests.station_id';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'tests' AND column_name = 'idempotency_key'
        ) THEN
          ALTER TABLE Tests ADD COLUMN idempotency_key TEXT;
          RAISE NOTICE 'Added Tests.idempotency_key';
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE tablename = 'tests' AND indexname = 'idx_tests_station_id'
        ) THEN
          CREATE INDEX idx_tests_station_id ON Tests(station_id);
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE tablename = 'tests' AND indexname = 'idx_tests_idempotency_key'
        ) THEN
          CREATE UNIQUE INDEX idx_tests_idempotency_key
            ON Tests(idempotency_key)
            WHERE idempotency_key IS NOT NULL;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'ingestreceipts'
        ) THEN
          CREATE TABLE IngestReceipts (
            idempotency_key TEXT PRIMARY KEY,
            station_id TEXT NOT NULL,
            test_id INTEGER REFERENCES Tests(test_id),
            payload_hash TEXT,
            status TEXT NOT NULL,
            error TEXT,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            completed_at TIMESTAMPTZ
          );
          CREATE INDEX idx_ingestreceipts_station ON IngestReceipts(station_id);
          CREATE INDEX idx_ingestreceipts_status ON IngestReceipts(status);
          RAISE NOTICE 'Created IngestReceipts table';
        ELSE
          RAISE NOTICE 'IngestReceipts already exists, skipping';
        END IF;
      END
      $$;
    `
  },
  {
    id: '011',
    name: 'station_controls',
    sql: `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'stationcontrols'
        ) THEN
          CREATE TABLE StationControls (
            station_id TEXT PRIMARY KEY,
            enabled BOOLEAN NOT NULL DEFAULT true,
            reason TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_by TEXT,
            revision BIGINT NOT NULL DEFAULT 1
          );
          RAISE NOTICE 'Created StationControls table';
        ELSE
          RAISE NOTICE 'StationControls already exists, skipping';
        END IF;
      END
      $$;
    `
  },
  {
    id: '012',
    name: 'ingest_receipts_test_id_cascade',
    sql: `
      -- Make IngestReceipts.test_id FK cascade on Tests deletion.
      -- Without this, DELETE FROM Tests fails once any HTTPS ingest has written
      -- a receipt (blocking reprocess); with the partial-clear reprocess we still
      -- want a receipt to disappear if its test row is removed.
      DO $$
      DECLARE
        fk_name TEXT;
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'ingestreceipts'
        ) THEN
          -- Drop whatever FK currently backs IngestReceipts.test_id (name may vary)
          FOR fk_name IN
            SELECT con.conname
            FROM pg_constraint con
            JOIN pg_attribute att
              ON att.attrelid = con.conrelid
             AND att.attnum = ANY (con.conkey)
            WHERE con.conrelid = 'ingestreceipts'::regclass
              AND con.contype = 'f'
              AND att.attname = 'test_id'
          LOOP
            EXECUTE format('ALTER TABLE IngestReceipts DROP CONSTRAINT %I', fk_name);
            RAISE NOTICE 'Dropped IngestReceipts FK %', fk_name;
          END LOOP;

          -- Re-add with ON DELETE CASCADE
          ALTER TABLE IngestReceipts
            ADD CONSTRAINT ingestreceipts_test_id_fkey
            FOREIGN KEY (test_id) REFERENCES Tests(test_id) ON DELETE CASCADE;
          RAISE NOTICE 'Added IngestReceipts.test_id FK with ON DELETE CASCADE';
        ELSE
          RAISE NOTICE 'IngestReceipts does not exist, skipping FK cascade migration';
        END IF;
      END
      $$;
    `
  },
  {
    id: '013',
    name: 'unique_tests_inv_start_time_utc',
    sql: `
      -- Durable cross-pipeline dedup: a UNIQUE index on (inv_id, start_time_utc)
      -- so the same physical test cannot land twice (once via CSV filename dedup,
      -- once via HTTPS idempotency-key dedup) during the migration window.
      --
      -- Guard on start_time_utc (the column app-level checks and annotation
      -- relink use); it mirrors start_time but is the canonical UTC value. Rows
      -- with a NULL start_time_utc are excluded (partial index), matching the
      -- app-level guards which also skip NULLs.
      --
      -- SAFETY: only create the index if no pre-existing duplicates would violate
      -- it. If duplicates exist, log a clear warning with the count and skip
      -- index creation rather than failing the whole migration run.
      DO $$
      DECLARE
        dup_groups INTEGER;
        dup_rows INTEGER;
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE tablename = 'tests' AND indexname = 'idx_tests_inv_start_time_utc'
        ) THEN
          RAISE NOTICE 'idx_tests_inv_start_time_utc already exists, skipping';
          RETURN;
        END IF;

        SELECT COUNT(*), COALESCE(SUM(cnt), 0)
          INTO dup_groups, dup_rows
          FROM (
            SELECT inv_id, start_time_utc, COUNT(*) AS cnt
              FROM Tests
             WHERE start_time_utc IS NOT NULL
             GROUP BY inv_id, start_time_utc
            HAVING COUNT(*) > 1
          ) d;

        IF dup_groups > 0 THEN
          RAISE WARNING 'Skipping UNIQUE index idx_tests_inv_start_time_utc: found % duplicate (inv_id, start_time_utc) group(s) spanning % row(s). Resolve duplicates then re-run this migration (delete the migrations row for 013 first).', dup_groups, dup_rows;
        ELSE
          CREATE UNIQUE INDEX idx_tests_inv_start_time_utc
            ON Tests(inv_id, start_time_utc)
            WHERE start_time_utc IS NOT NULL;
          RAISE NOTICE 'Created UNIQUE index idx_tests_inv_start_time_utc on Tests(inv_id, start_time_utc)';
        END IF;
      END
      $$;
    `
  },
  {
    id: '014',
    name: 'ingest_nonces',
    sql: `
      -- Shared, DB-backed nonce replay store for station->dashboard HMAC auth.
      -- Replaces the process-local in-memory Map (void across restarts/workers).
      -- Rows are pruned opportunistically per-request (TTL = 2x the HMAC skew
      -- window); the index on seen_at keeps that prune cheap.
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'ingestnonces'
        ) THEN
          CREATE TABLE IngestNonces (
            nonce TEXT PRIMARY KEY,
            station_id TEXT NOT NULL,
            seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
          CREATE INDEX idx_ingestnonces_seen_at ON IngestNonces(seen_at);
          RAISE NOTICE 'Created IngestNonces table with idx_ingestnonces_seen_at';
        ELSE
          RAISE NOTICE 'IngestNonces already exists, skipping';
        END IF;
      END
      $$;
    `
  },
  {
    id: '015',
    name: 'tests_summary_valid_start_utc_index',
    sql: `
      -- Hero summary / period probes filter valid tests by start_time_utc.
      -- Existing indexes are start_time (legacy local) and (inv_id, start_time_utc)
      -- unique — neither supports a time-range index-only scan. This partial
      -- covering index turns summary aggregates into index-only scans and
      -- feeds DISTINCT ON (inv_id) latest-per-inverter without joining Inverters.
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_indexes
          WHERE tablename = 'tests' AND indexname = 'idx_tests_valid_start_inv'
        ) THEN
          RAISE NOTICE 'idx_tests_valid_start_inv already exists, skipping';
        ELSE
          CREATE INDEX idx_tests_valid_start_inv
            ON Tests (start_time_utc DESC, inv_id)
            INCLUDE (overall_status)
            WHERE overall_status <> 'INVALID' AND start_time_utc IS NOT NULL;
          RAISE NOTICE 'Created idx_tests_valid_start_inv on Tests(start_time_utc, inv_id) INCLUDE (overall_status)';
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