import { readFileSync } from "fs";
import path from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const { auth, query } = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auth-check", () => ({ requireAuth: auth }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ query }) }));
import { POST } from "@/app/api/ft3/upload/route";

const SAMPLE_NAME = "FT3_190826396198_2026-10-15_12-07-29.csv";
const sample = readFileSync(path.join(__dirname, "fixtures", SAMPLE_NAME), "utf8");

function upload(files: File[]) {
  const form = new FormData();
  files.forEach(f => form.append("files", f));
  return new NextRequest("http://localhost/api/ft3/upload", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.mockResolvedValue({ error: null, session: { user: { email: "someone@sparqsys.com" } } });
});

describe("FT3 upload API", () => {
  it("requires authentication", async () => {
    auth.mockResolvedValue({ error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null });
    expect((await POST(upload([new File([sample], SAMPLE_NAME)]))).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it("adds new runs, skips duplicates and reports unreadable files", async () => {
    query.mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 });
    const response = await POST(upload([
      new File([sample], SAMPLE_NAME),
      new File([sample], SAMPLE_NAME),
      new File(["not,a,result"], "FT3_bad.csv"),
      new File(["x"], "notes.txt"),
    ]));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.summary).toEqual({ added: 1, duplicates: 1, failed: 2 });
    expect(body.results.map((r: { status: string }) => r.status)).toEqual(["added", "duplicate", "error", "error"]);
    expect(body.results[2].problems).toEqual(expect.arrayContaining(['Filename "FT3_bad.csv" is not FT3_<serial>_<YYYY-MM-DD_HH-MM-SS>.csv']));
    const [, params] = query.mock.calls[0];
    expect(params[0]).toBe("190826396198");
    expect((params[1] as Date).toISOString()).toBe("2026-10-15T05:27:23.000Z");
    expect(params[10]).toBe("someone@sparqsys.com");
  });

  it("rejects an empty upload", async () => {
    expect((await POST(upload([]))).status).toBe(400);
  });
});
