import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-check";
import { getPool } from "@/lib/db";
import { validateFt3Row } from "@/lib/ft3";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  try {
    const pool = getPool();
    const found = await pool.query(`SELECT * FROM FT3Tests WHERE ft3_id = $1`, [Number(id)]);
    if (!found.rowCount) return NextResponse.json({ error: "FT3 result not found" }, { status: 404 });
    const row = found.rows[0];
    const [attempts, burnin] = await Promise.all([
      pool.query(
        `SELECT ft3_id AS id, test_time_utc AS "testTime", overall_verdict AS verdict, failed_step AS "failedStep", tester
         FROM FT3Tests WHERE serial_number = $1 ORDER BY test_time_utc, ft3_id`, [row.serial_number]),
      pool.query(
        `SELECT t.test_id AS id, t.start_time_utc AS start, t.end_time AS "end", t.overall_status AS status, t.firmware_version AS firmware
         FROM Inverters i JOIN Tests t USING (inv_id) WHERE i.serial_number = $1
         ORDER BY t.start_time_utc DESC NULLS LAST LIMIT 50`, [row.serial_number]),
    ]);
    // Rows were validated on the way in; re-checking surfaces any stored
    // before a parser change instead of silently showing them.
    const { steps, problems } = validateFt3Row(row.raw_headers, row.raw_values);
    return NextResponse.json({
      id: row.ft3_id, serial: row.serial_number, testTime: row.test_time_utc, tester: row.tester,
      verdict: row.overall_verdict, failedStep: row.failed_step, fpga: row.fpga_version, zigbee: row.zigbee_version,
      sourceFile: row.source_file, uploadedBy: row.uploaded_by, uploadedAt: row.uploaded_at,
      steps, problems,
      attempts: attempts.rows, burnin: burnin.rows,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("FT3 detail query failed:", err);
    return NextResponse.json({ error: "Unable to load FT3 result" }, { status: 500 });
  }
}
