import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const { query, requireAuth } = vi.hoisted(() => ({ query: vi.fn(), requireAuth: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ query }) }));
vi.mock("@/lib/auth-check", () => ({ requireAuth }));
import { GET, PUT } from "@/app/api/user/failure-rate-prefs/route";

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [] });
  requireAuth.mockReset().mockResolvedValue({ error: null, session: { user: { email: "User@Sparqsys.com" } } });
});
const request = (body: unknown) => new NextRequest("http://localhost/api/user/failure-rate-prefs", {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

describe("account chart preferences", () => {
  it("returns the existing date view by default and scopes reads to the signed-in identity", async () => {
    expect(await (await GET()).json()).toEqual({ view: "rate", window: 100 });
    expect(query.mock.calls[0][1]).toEqual(["user@sparqsys.com"]);
  });
  it("round-trips both selections with private cache headers", async () => {
    const prefs = { view: "tests", window: 250 };
    const saved = await PUT(request(prefs));
    expect(saved.status).toBe(200);
    expect(query.mock.calls[0][1]).toEqual(["user@sparqsys.com", "tests", 250]);
    query.mockResolvedValue({ rows: [prefs] });
    const loaded = await GET();
    expect(await loaded.json()).toEqual(prefs);
    expect(loaded.headers.get("Cache-Control")).toBe("private, no-store");
  });
  it.each([0, 9, 2001, 100.5, "100"])("rejects an invalid window %s before writing", async window => {
    expect((await PUT(request({ view: "tests", window }))).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it("rejects a supplied account identity instead of accepting another user's key", async () => {
    expect((await PUT(request({ view: "tests", window: 100, user_email: "someone@sparqsys.com" }))).status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
  it("requires a real signed-in identity even in anonymous development mode", async () => {
    requireAuth.mockResolvedValue({ error: null, session: null });
    expect((await GET()).status).toBe(401);
    expect((await PUT(request({ view: "tests", window: 100 }))).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
  it("preserves authentication failures", async () => {
    requireAuth.mockResolvedValue({ error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) });
    expect((await GET()).status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});
