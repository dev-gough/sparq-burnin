import type { Ft3Record } from "./ft3";

interface Queryable {
  query: (sql: string, values: unknown[]) => Promise<{ rowCount: number | null }>;
}

/**
 * Insert one parsed FT3 run; false when the same serial and test time is
 * already stored, so re-uploading or re-syncing a file is harmless. Shared by
 * the upload API and the pCloud ingester (scripts/ingest-ft3.ts).
 */
export async function insertFt3Record(
  db: Queryable, r: Ft3Record, sourceFile: string, uploadedBy: string | null,
): Promise<boolean> {
  const inserted = await db.query(
    `INSERT INTO FT3Tests (serial_number, test_time_utc, tester, overall_verdict, failed_step,
       fpga_version, zigbee_version, raw_headers, raw_values, source_file, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (serial_number, test_time_utc) DO NOTHING`,
    [r.serialNumber, r.testTimeUtc, r.tester, r.overallVerdict, r.failedStep,
      r.fpgaVersion, r.zigbeeVersion, r.rawHeaders, r.rawValues, sourceFile, uploadedBy],
  );
  return Boolean(inserted.rowCount);
}
