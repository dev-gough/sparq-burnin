import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';
import { getDatabaseConfig } from '@/lib/config';
import { requireRestoreAuth } from '@/lib/auth-check';

interface IncomingRow {
  serial_number: string;
  start_time: string;
  annotation_type: string;
  annotation_text: string;
  created_by?: string;
  author_email?: string;
  created_at?: string;
  updated_at?: string;
  current_test_id?: string;
}

interface SkipReport {
  row: number;
  serial_number: string;
  start_time: string;
  annotation_type: string;
  annotation_text: string;
  reason: string;
}

// Minimal RFC 4180 CSV parser supporting quoted fields with escaped quotes.
function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;
  const n = text.length;

  const pushField = () => { cur.push(field); field = ''; };
  const pushRow = () => { rows.push(cur); cur = []; };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { pushField(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { pushField(); pushRow(); i++; continue; }
    field += ch;
    i++;
  }
  // Final field/row
  if (field.length > 0 || cur.length > 0) {
    pushField();
    pushRow();
  }

  if (rows.length === 0) return { headers: [], rows: [] };
  const headers = rows.shift()!.map((h) => h.trim());
  // Drop accidental trailing blank rows
  const dataRows = rows.filter((r) => !(r.length === 1 && r[0] === ''));
  return { headers, rows: dataRows };
}

export async function POST(request: NextRequest) {
  const { error: authError, session } = await requireRestoreAuth();
  if (authError) return authError;

  const contentType = request.headers.get('content-type') || '';

  let csvText: string;
  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('file');
      if (!(file instanceof File)) {
        return NextResponse.json(
          { error: 'No "file" field in upload' },
          { status: 400 }
        );
      }
      csvText = await file.text();
    } else {
      csvText = await request.text();
    }
  } catch (err) {
    console.error('Failed to read restore upload:', err);
    return NextResponse.json(
      { error: 'Failed to read upload' },
      { status: 400 }
    );
  }

  if (!csvText || csvText.trim().length === 0) {
    return NextResponse.json(
      { error: 'Empty backup file' },
      { status: 400 }
    );
  }

  const { headers, rows } = parseCsv(csvText);
  const required = [
    'serial_number',
    'start_time',
    'annotation_type',
    'annotation_text',
  ];
  for (const col of required) {
    if (!headers.includes(col)) {
      return NextResponse.json(
        { error: `Missing required column "${col}"` },
        { status: 400 }
      );
    }
  }
  const idx = (name: string) => headers.indexOf(name);

  const client = new Client(getDatabaseConfig());

  let inserted = 0;
  let skippedDuplicate = 0;
  let skippedNoText = 0;
  let skippedNoTest = 0;
  let errors = 0;
  const skipReports: SkipReport[] = [];

  try {
    await client.connect();
    await client.query("SET timezone = 'UTC'");
    await client.query('BEGIN');

    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r];
      const row: IncomingRow = {
        serial_number: cells[idx('serial_number')] ?? '',
        start_time: cells[idx('start_time')] ?? '',
        annotation_type: cells[idx('annotation_type')] ?? '',
        annotation_text: cells[idx('annotation_text')] ?? '',
        created_by: idx('created_by') >= 0 ? cells[idx('created_by')] : undefined,
        author_email: idx('author_email') >= 0 ? cells[idx('author_email')] : undefined,
        created_at: idx('created_at') >= 0 ? cells[idx('created_at')] : undefined,
        updated_at: idx('updated_at') >= 0 ? cells[idx('updated_at')] : undefined,
        current_test_id: idx('current_test_id') >= 0 ? cells[idx('current_test_id')] : undefined,
      };

      const rowNum = r + 2; // 1-indexed + header row

      // Validate required fields
      if (!row.serial_number || !row.start_time || !row.annotation_type || !row.annotation_text) {
        skippedNoText++;
        skipReports.push({
          row: rowNum,
          serial_number: row.serial_number,
          start_time: row.start_time,
          annotation_type: row.annotation_type,
          annotation_text: row.annotation_text,
          reason: 'Missing required field',
        });
        continue;
      }

      const startTime = new Date(row.start_time);
      if (isNaN(startTime.getTime())) {
        skippedNoText++;
        skipReports.push({
          row: rowNum,
          serial_number: row.serial_number,
          start_time: row.start_time,
          annotation_type: row.annotation_type,
          annotation_text: row.annotation_text,
          reason: 'Invalid start_time',
        });
        continue;
      }

      try {
        // Skip if an equivalent annotation already exists.
        // Natural key matches the unique constraint:
        //   (serial_number, start_time, annotation_type)
        // We use a 1-second tolerance on the timestamp to match the existing
        // ingest-csv-annotations dedup behaviour (handles sub-second drift).
        const dupRes = await client.query(
          `SELECT annotation_id
             FROM TestAnnotations
            WHERE serial_number = $1
              AND ABS(EXTRACT(EPOCH FROM (start_time - $2::timestamptz))) < 1
              AND annotation_type = $3
            LIMIT 1`,
          [row.serial_number, startTime.toISOString(), row.annotation_type]
        );
        if (dupRes.rows.length > 0) {
          skippedDuplicate++;
          skipReports.push({
            row: rowNum,
            serial_number: row.serial_number,
            start_time: row.start_time,
            annotation_type: row.annotation_type,
            annotation_text: row.annotation_text,
            reason: 'Already exists (same serial+start_time+type)',
          });
          continue;
        }

        // Look up the matching current_test_id by (serial_number, date(start_time))
        const testRes = await client.query(
          `SELECT t.test_id, t.start_time_utc
             FROM Tests t
             JOIN Inverters i ON t.inv_id = i.inv_id
            WHERE i.serial_number = $1
              AND DATE(t.start_time_utc) = $2::date
            ORDER BY t.start_time_utc ASC
            LIMIT 1`,
          [row.serial_number, startTime.toISOString().split('T')[0]]
        );

        let currentTestId: number | null = null;
        let canonicalStartTime: Date = startTime;
        if (testRes.rows.length > 0) {
          currentTestId = testRes.rows[0].test_id;
          canonicalStartTime = testRes.rows[0].start_time_utc;
        } else {
          // No matching test — still insert the annotation; current_test_id
          // can be relinked later by reprocess.ts when the test reappears.
          skippedNoTest++;
          skipReports.push({
            row: rowNum,
            serial_number: row.serial_number,
            start_time: row.start_time,
            annotation_type: row.annotation_type,
            annotation_text: row.annotation_text,
            reason: 'No matching test (annotation inserted with NULL current_test_id)',
          });
        }

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
            canonicalStartTime,
            row.annotation_type,
            row.annotation_text,
            row.created_by || null,
            row.author_email || null,
            currentTestId,
          ]
        );

        inserted++;
      } catch (rowErr) {
        errors++;
        console.error(`Restore error on row ${rowNum}:`, rowErr);
        skipReports.push({
          row: rowNum,
          serial_number: row.serial_number,
          start_time: row.start_time,
          annotation_type: row.annotation_type,
          annotation_text: row.annotation_text,
          reason: `DB error: ${rowErr instanceof Error ? rowErr.message : String(rowErr)}`,
        });
      }
    }

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      restored_by: session?.user?.email ?? null,
      totals: {
        rows_in_file: rows.length,
        inserted,
        skipped_duplicate: skippedDuplicate,
        skipped_invalid: skippedNoText,
        skipped_no_test: skippedNoTest,
        errors,
      },
      skipped: skipReports,
    });
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    console.error('Annotation restore error:', error);
    return NextResponse.json(
      { error: 'Failed to restore annotations', detail: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  } finally {
    await client.end();
  }
}
