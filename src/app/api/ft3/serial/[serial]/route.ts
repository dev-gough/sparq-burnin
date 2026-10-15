import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-check";
import { getPool } from "@/lib/db";

/** FT3 runs for one serial, newest first — used to link burn-in tests to FT3. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ serial: string }> }) {
  const { error } = await requireAuth();
  if (error) return error;
  const { serial } = await params;
  if (!/^[A-Za-z0-9-]{1,50}$/.test(serial)) return NextResponse.json({ error: "Invalid serial" }, { status: 400 });
  try {
    const result = await getPool().query(
      `SELECT ft3_id AS id, test_time_utc AS "testTime", overall_verdict AS verdict, failed_step AS "failedStep"
       FROM FT3Tests WHERE serial_number = $1 ORDER BY test_time_utc DESC, ft3_id DESC LIMIT 20`, [serial]);
    return NextResponse.json({ runs: result.rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("FT3 serial query failed:", err);
    return NextResponse.json({ error: "Unable to load FT3 runs" }, { status: 500 });
  }
}
