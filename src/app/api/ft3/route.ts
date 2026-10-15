import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-check";
import { getPool } from "@/lib/db";
import { buildFt3ListQuery } from "@/lib/ft3-query";

export async function GET(request: NextRequest) {
  const { error } = await requireAuth();
  if (error) return error;
  let query;
  try {
    query = buildFt3ListQuery(request.nextUrl.searchParams);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  try {
    const result = await getPool().query(query.sql, query.values);
    return NextResponse.json(result.rows[0].data, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("FT3 list query failed:", err);
    return NextResponse.json({ error: "Unable to load FT3 results" }, { status: 500 });
  }
}
