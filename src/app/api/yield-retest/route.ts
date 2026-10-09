import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-check";
import { getPool } from "@/lib/db";
import { buildYieldQuery } from "@/lib/yield-retest";

export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;
  let query;
  try {
    query = buildYieldQuery(request.nextUrl.searchParams);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
  try {
    const result = await getPool().query(query.sql, query.values);
    return NextResponse.json(result.rows[0].data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Yield and retest query failed:", error);
    return NextResponse.json({ error: "Unable to load yield and retest data" }, { status: 500 });
  }
}
