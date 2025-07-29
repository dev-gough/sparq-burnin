#!/usr/bin/env tsx

import { Client } from 'pg';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';

import { loadConfig, type Config } from '../src/lib/config';

class SimpleReprocessor {
  private client: Client;
  private readonly config: Config;
  private readonly processedPath: string;
  private readonly toProcessPath: string;

  constructor() {
    this.config = loadConfig();

    this.client = new Client({
      host: this.config.database.host,
      port: this.config.database.port,
      database: this.config.database.name,
      user: this.config.database.user,
      password: this.config.database.password,
    });

    this.processedPath = path.join(this.config.paths.local.main_dir, 'processed');
    this.toProcessPath = path.join(this.config.paths.local.main_dir, 'to_process');
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
    console.log('🗑️  Clearing existing database data...');

    // Clear tables in reverse dependency order
    await this.client.query('DELETE FROM TestData');
    console.log('  ✅ Cleared TestData table');

    await this.client.query('DELETE FROM Tests');
    console.log('  ✅ Cleared Tests table');

    await this.client.query('DELETE FROM Inverters');
    console.log('  ✅ Cleared Inverters table');

    // Reset sequences
    await this.client.query('ALTER SEQUENCE testdata_data_id_seq RESTART WITH 1');
    await this.client.query('ALTER SEQUENCE tests_test_id_seq RESTART WITH 1');
    await this.client.query('ALTER SEQUENCE inverters_inv_id_seq RESTART WITH 1');
    console.log('  ✅ Reset all sequences');
  }

  async moveFiles(fromDir: string, toDir: string, fileType: string): Promise<number> {
    let movedCount = 0;

    try {
      // Ensure destination directory exists
      await fs.mkdir(toDir, { recursive: true });

      // Check if source directory exists
      try {
        await fs.access(fromDir);
      } catch {
        console.log(`  ⚠️  Source directory does not exist: ${fromDir}`);
        return 0;
      }

      const files = await fs.readdir(fromDir);
      const csvFiles = files.filter(file => file.endsWith('.csv'));

      if (csvFiles.length === 0) {
        console.log(`  ℹ️  No CSV files found in ${fromDir}`);
        return 0;
      }

      for (const file of csvFiles) {
        const sourcePath = path.join(fromDir, file);
        const destPath = path.join(toDir, file);

        try {
          await fs.rename(sourcePath, destPath);
          movedCount++;
          console.log(`  ✅ Moved ${file}`);
        } catch (error) {
          console.error(`  ❌ Failed to move ${file}:`, error);
        }
      }

    } catch (error) {
      console.error(`Error processing ${fileType} files:`, error);
    }

    return movedCount;
  }

  async moveAllFiles(): Promise<void> {
    console.log('📁 Moving files from processed to to_process...');

    const resultsFromDir = path.join(this.processedPath, 'results');
    const resultsToDir = path.join(this.toProcessPath, 'results');

    const testsFromDir = path.join(this.processedPath, 'tests');
    const testsToDir = path.join(this.toProcessPath, 'tests');

    console.log('\n  📋 Moving results files...');
    const resultsMoved = await this.moveFiles(resultsFromDir, resultsToDir, 'results');

    console.log('\n  📊 Moving test files...');
    const testsMoved = await this.moveFiles(testsFromDir, testsToDir, 'tests');

    console.log(`\n✅ File movement complete: ${resultsMoved} results files, ${testsMoved} test files moved`);
  }

  async runIngestion(): Promise<void> {
    console.log('🚀 Running new ingestion script...');

    return new Promise((resolve, reject) => {
      const ingestionProcess = spawn('tsx', ['scripts/ingest.ts'], {
        stdio: 'inherit',
        cwd: process.cwd()
      });

      ingestionProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Ingestion completed successfully');
          resolve();
        } else {
          console.error(`❌ Ingestion failed with code ${code}`);
          reject(new Error(`Ingestion process exited with code ${code}`));
        }
      });

      ingestionProcess.on('error', (error) => {
        console.error('❌ Failed to start ingestion process:', error);
        reject(error);
      });
    });
  }

  async reprocess(): Promise<void> {
    console.log('🔄 Starting simple reprocessing...\n');

    try {
      // Step 1: Move files from processed back to to_process
      await this.moveAllFiles();

      // Step 2: Clear database
      await this.clearDatabase();

      // Step 3: Run new ingestion
      await this.runIngestion();

      console.log('\n🎉 Reprocessing completed successfully!');

    } catch (error) {
      console.error('💥 Reprocessing failed:', error);
      throw error;
    }
  }
}

async function main() {
  const reprocessor = new SimpleReprocessor();

  try {
    await reprocessor.connect();
    await reprocessor.reprocess();
  } catch (error) {
    console.error('Reprocessing failed:', error);
    process.exit(1);
  } finally {
    await reprocessor.disconnect();
  }
}

if (require.main === module) {
  main();
}