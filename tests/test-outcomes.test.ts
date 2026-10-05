import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/auth-check", () => ({ requireAuth: async () => ({ error: null }) }));
vi.mock("@/lib/config", () => ({ getDatabaseConfig: () => ({}) }));
vi.mock("pg", () => ({ Client: class { connect = async () => {}; end = async () => {}; query = query; } }));
import { GET } from "@/app/api/test-stats/route";

beforeEach(() => query.mockReset().mockResolvedValue({ rows: [{ outcomes: "PFFP" }] }));
const request = (params: string) => new NextRequest(`http://localhost/api/test-stats?view=test-outcomes&${params}`);
const outcomeQuery = () => query.mock.calls.find(([sql]) => sql.includes("STRING_AGG"))!;

describe("dashboard rolling outcomes", () => {
  it.each(["recent", "all"])("uses decisive chronological outcomes in %s mode", async mode => {
    const response = await GET(request(`chartMode=${mode}&timeRange=30d&station=station-1`));
    expect(await response.json()).toEqual({ outcomes: "PFFP" });
    const [sql, params] = outcomeQuery();
    expect(sql).toContain("t.overall_status NOT IN ('INVALID', 'RETEST')");
    expect(sql).toContain("ORDER BY b.start_time_utc, b.test_id");
    expect(sql.includes("DISTINCT ON (t.inv_id)")).toBe(mode === "recent");
    expect(sql).toContain("t.station_id = $1");
    expect(params).toEqual(["station-1"]);
    if (mode === "recent") expect(sql).toContain("t.start_time_utc DESC, t.test_id DESC");
  });
  it("counts matching failures without shrinking the test denominator", async () => {
    await GET(request("chartMode=recent&dateFrom=2026-09-01&dateTo=2026-09-30&annotation=group:Hardware"));
    const [sql, params] = outcomeQuery();
    expect(sql).toContain("b.overall_status = 'FAIL' AND (EXISTS");
    expect(sql).toContain("aqo.group_name = $3");
    expect(sql).toContain("THEN 'F' ELSE 'P'");
    expect(sql).toContain("t.start_time_utc >= $1::date");
    expect(sql).toContain("t.start_time_utc <= $2::date + INTERVAL '1 day' - INTERVAL '1 second'");
    expect(params).toEqual(["2026-09-01", "2026-09-30", "Hardware"]);
  });
  it("supports the synthetic Other group without a bound category name", async () => {
    await GET(request("annotation=group:Other"));
    const [sql, params] = outcomeQuery();
    expect(sql).toContain("aqo.option_text IS NULL OR aqo.group_name IS NULL");
    expect(params).toEqual([]);
  });
  it("rejects an inverted custom range before aggregating", async () => {
    expect((await GET(request("dateFrom=2026-09-30&dateTo=2026-09-01"))).status).toBe(400);
    expect(query.mock.calls.some(([sql]) => sql.includes("STRING_AGG"))).toBe(false);
  });
});
