import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-check";
import { getPool } from "@/lib/db";
import { Ft3ParseError, parseFt3Csv } from "@/lib/ft3";
import { insertFt3Record } from "@/lib/ft3-db";

const MAX_FILES = 500;
const MAX_FILE_BYTES = 1024 * 1024;

export interface Ft3UploadFileResult {
  file: string;
  status: "added" | "duplicate" | "error";
  added: number;
  duplicates: number;
  serial: string | null;
  /** Every problem the parser found; the file is not stored when present. */
  problems?: string[];
  error?: string;
}

export async function POST(request: NextRequest) {
  const { error: authError, session } = await requireAuth();
  if (authError) return authError;

  let files: File[];
  try {
    const form = await request.formData();
    files = form.getAll("files").filter((f): f is File => f instanceof File);
  } catch {
    return NextResponse.json({ error: "Upload must be multipart form data" }, { status: 400 });
  }
  if (!files.length) return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
  if (files.length > MAX_FILES) return NextResponse.json({ error: `Upload at most ${MAX_FILES} files at once` }, { status: 400 });

  const uploadedBy = session?.user?.email ?? null;
  const results: Ft3UploadFileResult[] = [];
  const pool = getPool();

  for (const file of files) {
    const result: Ft3UploadFileResult = { file: file.name, status: "error", added: 0, duplicates: 0, serial: null };
    results.push(result);
    if (!/\.csv$/i.test(file.name)) { result.error = "Not a CSV file"; continue; }
    if (file.size > MAX_FILE_BYTES) { result.error = "File is larger than 1 MB"; continue; }
    let record;
    try {
      record = parseFt3Csv(await file.text(), file.name);
    } catch (err) {
      result.error = "Could not read this file";
      result.problems = err instanceof Ft3ParseError ? err.problems : [(err as Error).message];
      continue;
    }
    result.serial = record.serialNumber;
    try {
      const added = await insertFt3Record(pool, record, file.name, uploadedBy);
      result.added = added ? 1 : 0;
      result.duplicates = added ? 0 : 1;
      result.status = added ? "added" : "duplicate";
    } catch (err) {
      console.error("FT3 upload insert failed:", err);
      result.error = "Could not save this file";
    }
  }

  const summary = {
    added: results.reduce((n, r) => n + r.added, 0),
    duplicates: results.reduce((n, r) => n + r.duplicates, 0),
    failed: results.filter(r => r.status === "error").length,
  };
  return NextResponse.json({ summary, results }, { headers: { "Cache-Control": "no-store" } });
}
