#!/usr/bin/env tsx
/**
 * Nightly backup of TestAnnotations to a gzipped CSV.
 *
 * Designed for a tiny EC2 disk: keeps only the last 7 daily backups by default.
 *
 * Usage:
 *   tsx scripts/backup-annotations.ts                 # default dir + 7-day retention
 *   BACKUP_DIR=/var/backups/burnin tsx scripts/backup-annotations.ts
 *   BACKUP_RETENTION=14 tsx scripts/backup-annotations.ts
 *
 * Cron example (daily at 03:15 UTC, log to file):
 *   15 3 * * * cd /home/devon/burnin-dashboard && \
 *     /usr/bin/env BACKUP_DIR=/home/devon/burnin-backups \
 *     /home/devon/.nvm/versions/node/v22.0.0/bin/tsx \
 *     scripts/backup-annotations.ts >> /home/devon/burnin-backups/cron.log 2>&1
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createGzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { getDatabaseConfig } from '../src/lib/config';

const COLUMNS = [
  'annotation_id',
  'serial_number',
  'start_time',
  'annotation_type',
  'annotation_text',
  'created_by',
  'author_email',
  'created_at',
  'updated_at',
  'current_test_id',
] as const;

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function defaultBackupDir(): string {
  return path.join(os.homedir(), 'burnin-backups', 'annotations');
}

async function rotate(dir: string, keep: number): Promise<string[]> {
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith('testannotations-') && f.endsWith('.csv.gz'))
    .map((f) => ({
      name: f,
      mtime: fs.statSync(path.join(dir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  const stale = files.slice(keep);
  const removed: string[] = [];
  for (const f of stale) {
    try {
      fs.unlinkSync(path.join(dir, f.name));
      removed.push(f.name);
    } catch (err) {
      console.error(`Failed to remove ${f.name}:`, err);
    }
  }
  return removed;
}

async function main() {
  const backupDir = process.env.BACKUP_DIR || defaultBackupDir();
  const retention = Math.max(1, parseInt(process.env.BACKUP_RETENTION || '7', 10));

  fs.mkdirSync(backupDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(backupDir, `testannotations-${stamp}.csv.gz`);
  const tmpFile = outFile + '.tmp';

  const client = new Client(getDatabaseConfig());
  await client.connect();
  await client.query("SET timezone = 'UTC'");

  console.log(`[${new Date().toISOString()}] Backing up TestAnnotations to ${outFile}`);

  try {
    const result = await client.query(
      `SELECT ${COLUMNS.join(', ')}
         FROM TestAnnotations
         ORDER BY annotation_id ASC`
    );

    async function* lines() {
      yield COLUMNS.join(',') + '\n';
      for (const row of result.rows) {
        yield COLUMNS.map((c) => csvEscape((row as Record<string, unknown>)[c])).join(',') + '\n';
      }
    }

    await pipeline(
      Readable.from(lines()),
      createGzip(),
      fs.createWriteStream(tmpFile)
    );

    fs.renameSync(tmpFile, outFile);
    const sizeKb = (fs.statSync(outFile).size / 1024).toFixed(1);
    console.log(`  wrote ${result.rows.length} rows (${sizeKb} KiB)`);

    const removed = await rotate(backupDir, retention);
    if (removed.length > 0) {
      console.log(`  rotated out: ${removed.join(', ')}`);
    }
  } catch (err) {
    // Clean up partial temp file on failure
    if (fs.existsSync(tmpFile)) {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
