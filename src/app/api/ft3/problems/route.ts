import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-check";
import { snapshotFt3 } from "@/lib/ft3Ops";

/** pCloud FT3 files the parser rejected, newest first. */
export async function GET() {
  const { error } = await requireAuth();
  if (error) return error;
  const snap = await snapshotFt3(50);
  if (snap.error) {
    console.error("FT3 quarantine unreadable:", snap.error);
    return NextResponse.json({ error: "Unable to read FT3 problem files" }, { status: 500 });
  }
  return NextResponse.json({ quarantined: snap.quarantined, files: snap.files }, { headers: { "Cache-Control": "no-store" } });
}
