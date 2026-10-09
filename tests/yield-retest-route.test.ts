import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const { auth, query } = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auth-check", () => ({ requireAuth: auth }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ query }) }));
import { GET } from "@/app/api/yield-retest/route";
const request = (params = "") => new NextRequest(`http://localhost/api/yield-retest?${params}`);
beforeEach(() => { vi.clearAllMocks(); auth.mockResolvedValue({ error: null }); });
describe("yield API", () => {
  it("requires authentication before querying", async () => {
    auth.mockResolvedValue({ error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    expect((await GET(request())).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects bad bounds before querying", async () => {
    expect((await GET(request("dateFrom=2026-02-30"))).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it("returns the database snapshot without allowing caching", async () => {
    query.mockResolvedValue({ rows: [{ data: { summary: { units: 10 }, units: [] } }] });
    const response = await GET(request("timeRange=all"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ summary: { units: 10 }, units: [] });
  });
  it("returns a generic error when the database is unavailable", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      query.mockRejectedValue(new Error("private connection information"));
      const response = await GET(request());
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Unable to load yield and retest data" });
    } finally { log.mockRestore(); }
  });
});
