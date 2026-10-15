#!/usr/bin/env tsx
/**
 * Ingest FT3 result CSVs queued by the watchdog in <main_dir>/to_process/ft3.
 *
 *   saved or already stored → processed/ft3
 *   unreadable              → quarantine/ft3 (+ .reason.txt); the watchdog
 *                             will not copy that name again
 *   database error          → left in to_process/ft3 for the next run
 *
 * Exits non-zero when any file hit a database error.
 *
 * After updating the parser for a quarantined file, run
 *   npm run ingest:ft3 -- --retry-quarantine
 * to move every quarantined file back into the queue and ingest it again.
 */
import { Client } from 'pg';
import * as fs from 'fs/promises';
import * as path from 'path';
import { loadConfig, getDatabaseConfig } from '../src/lib/config';
import { Ft3ParseError, parseFt3Csv, type Ft3Record } from '../src/lib/ft3';
import { insertFt3Record } from '../src/lib/ft3-db';
import { FT3_REASON_SUFFIX } from '../src/lib/ft3Ops';
import { runMigrations } from './migrate-db';

export const FT3_UPLOADED_BY = 'pcloud';

export interface Ft3QueueSummary { files: number; added: number; duplicates: number; quarantined: number; failed: number }

type Db = Parameters<typeof insertFt3Record>[0];

async function moveInto(file: string, dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, path.basename(file));
  await fs.rename(file, target);
  return target;
}

/** Move quarantined files back into the queue, dropping their reasons. Returns how many. */
export async function requeueFt3Quarantine(mainDir: string): Promise<number> {
  const quarantineDir = path.join(mainDir, 'quarantine', 'ft3');
  let names: string[];
  try {
    names = await fs.readdir(quarantineDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
  let moved = 0;
  for (const name of names) {
    const file = path.join(quarantineDir, name);
    if (name.endsWith(FT3_REASON_SUFFIX)) continue;
    if (!name.toLowerCase().endsWith('.csv')) continue;
    await moveInto(file, path.join(mainDir, 'to_process', 'ft3'));
    await fs.rm(`${file}${FT3_REASON_SUFFIX}`, { force: true });
    moved++;
  }
  return moved;
}

export async function ingestFt3Queue(
  mainDir: string, db: Db, log: (line: string) => void = console.log,
): Promise<Ft3QueueSummary> {
  const queueDir = path.join(mainDir, 'to_process', 'ft3');
  const processedDir = path.join(mainDir, 'processed', 'ft3');
  const quarantineDir = path.join(mainDir, 'quarantine', 'ft3');
  const summary: Ft3QueueSummary = { files: 0, added: 0, duplicates: 0, quarantined: 0, failed: 0 };

  let names: string[];
  try {
    names = (await fs.readdir(queueDir)).filter(n => n.toLowerCase().endsWith('.csv')).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return summary;
    throw err;
  }

  for (const name of names) {
    summary.files++;
    const file = path.join(queueDir, name);
    let record: Ft3Record;
    try {
      record = parseFt3Csv(await fs.readFile(file, 'utf8'), name);
    } catch (err) {
      const problems = err instanceof Ft3ParseError ? err.problems : [(err as Error).message];
      await moveInto(file, quarantineDir);
      await fs.writeFile(path.join(quarantineDir, `${name}${FT3_REASON_SUFFIX}`), problems.map(p => `${p}\n`).join(''));
      summary.quarantined++;
      log(`Quarantined ${name}: ${problems.join('; ')}`);
      continue;
    }
    try {
      const added = await insertFt3Record(db, record, name, FT3_UPLOADED_BY);
      if (added) summary.added++; else summary.duplicates++;
      await moveInto(file, processedDir);
      log(`${added ? 'Added' : 'Already stored'} ${name}`);
    } catch (err) {
      summary.failed++;
      log(`Database error for ${name}, left in queue: ${(err as Error).message}`);
    }
  }

  log(`FT3 ingest: ${summary.files} files, ${summary.added} runs added, ${summary.duplicates} already stored, ` +
    `${summary.quarantined} quarantined, ${summary.failed} failed`);
  return summary;
}

async function main() {
  const config = loadConfig();
  await runMigrations();
  if (process.argv.includes('--retry-quarantine')) {
    console.log(`Requeued ${await requeueFt3Quarantine(config.paths.local.main_dir)} quarantined FT3 files`);
  }
  const client = new Client(getDatabaseConfig());
  await client.connect();
  try {
    const summary = await ingestFt3Queue(config.paths.local.main_dir, client);
    if (summary.failed) process.exitCode = 1;
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('FT3 ingest failed:', error);
    process.exit(1);
  });
}
