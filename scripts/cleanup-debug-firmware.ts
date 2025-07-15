#!/usr/bin/env tsx

import * as fs from 'fs/promises';
import * as path from 'path';
import csvParser from 'csv-parser';
import { createReadStream } from 'fs';

class DebugFirmwareCleanup {
  private readonly toProcessPath = 'data/to_process';
  private readonly processedPath = 'data/processed';
  
  async checkFirmwareVersion(filePath: string): Promise<string | null> {
    return new Promise((resolve, reject) => {
      let firmwareVersion: string | null = null;
      
      createReadStream(filePath)
        .pipe(csvParser())
        .on('data', (row) => {
          if (!firmwareVersion) {
            firmwareVersion = row['Inverter Firmware'] || null;
          }
        })
        .on('end', () => {
          resolve(firmwareVersion);
        })
        .on('error', (error) => {
          console.error(`Error reading file ${filePath}:`, error);
          reject(error);
        });
    });
  }
  
  async scanAndDeleteDebugFiles(directory: string): Promise<{ scanned: number; deleted: number }> {
    let scannedCount = 0;
    let deletedCount = 0;
    
    try {
      // Check if directory exists
      try {
        await fs.access(directory);
      } catch {
        console.log(`⚠️  Directory does not exist: ${directory}`);
        return { scanned: 0, deleted: 0 };
      }
      
      const files = await fs.readdir(directory);
      const csvFiles = files.filter(file => file.endsWith('.csv'));
      
      console.log(`📂 Scanning ${csvFiles.length} CSV files in ${directory}`);
      
      for (const file of csvFiles) {
        const filePath = path.join(directory, file);
        scannedCount++;
        
        try {
          const firmwareVersion = await this.checkFirmwareVersion(filePath);
          
          if (firmwareVersion === '1.11.11') {
            console.log(`🗑️  Deleting debug firmware file: ${file}`);
            await fs.unlink(filePath);
            deletedCount++;
          } else {
            console.log(`✅ Keeping file: ${file} (firmware: ${firmwareVersion || 'unknown'})`);
          }
        } catch (error) {
          console.error(`❌ Error processing file ${file}:`, error);
        }
      }
      
    } catch (error) {
      console.error(`Error scanning directory ${directory}:`, error);
    }
    
    return { scanned: scannedCount, deleted: deletedCount };
  }
  
  async cleanupAllDirectories(): Promise<void> {
    console.log('🧹 Starting cleanup of debug firmware files (version 1.11.11)...\n');
    
    const directories = [
      path.join(this.toProcessPath, 'results'),
      path.join(this.processedPath, 'results')
    ];
    
    let totalScanned = 0;
    let totalDeleted = 0;
    
    for (const directory of directories) {
      console.log(`\n📁 Processing directory: ${directory}`);
      const { scanned, deleted } = await this.scanAndDeleteDebugFiles(directory);
      totalScanned += scanned;
      totalDeleted += deleted;
      console.log(`   Scanned: ${scanned}, Deleted: ${deleted}`);
    }
    
    console.log(`\n📊 Summary:`);
    console.log(`   Total files scanned: ${totalScanned}`);
    console.log(`   Total files deleted: ${totalDeleted}`);
    console.log(`   Files kept: ${totalScanned - totalDeleted}`);
    
    if (totalDeleted > 0) {
      console.log(`\n✅ Cleanup completed successfully! Removed ${totalDeleted} debug firmware files.`);
    } else {
      console.log(`\n✅ No debug firmware files found. All directories are clean.`);
    }
  }
}

async function main() {
  const cleanup = new DebugFirmwareCleanup();
  
  console.log('⚠️  WARNING: This script will permanently delete results files with firmware version 1.11.11');
  console.log('🔍 Scanning both to_process and processed directories...\n');
  
  try {
    await cleanup.cleanupAllDirectories();
  } catch (error) {
    console.error('💥 Cleanup failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}