import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth-check", () => ({ requireAuth: async () => ({ error: null }) }));
vi.mock("@/lib/config", () => ({ getDatabaseConfig: () => ({}) }));
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("pg", () => ({
  Client: class {
    connect = async () => {};
    end = async () => {};
    query = query;
  },
}));
import { GET } from "@/app/api/failure-analytics/route";

beforeEach(() => {
  query.mockReset();
  query.mockImplementation(async (sql: string) => ({
    rows: sql.includes("as total_tests") && !sql.includes("GROUP BY")
      ? [{ total_tests: "0", total_failed_tests: "0", untagged_failed: "0", test_outcomes: "" }]
      : [],
  }));
});

const request = (params: string) => new NextRequest(`http://localhost/api/failure-analytics?${params}`);
const scopedQueries = () => query.mock.calls.filter(([sql]) => sql.includes("WITH base_tests"));

describe("failure analytics date filtering", () => {
  it.each(["recent", "all"])("filters every metric in %s mode with inclusive UTC days", async (mode) => {
    const response = await GET(request(`chartMode=${mode}&timeRange=90d&dateFrom=2026-09-01&dateTo=2026-09-30`));
    expect(response.status).toBe(200);
    expect(scopedQueries()).toHaveLength(6);
    for (const [sql, params] of scopedQueries()) {
      expect(sql).toContain("t.start_time_utc >= $1::date");
      expect(sql).toContain("t.start_time_utc < $2::date + INTERVAL '1 day'");
      expect(sql).not.toContain("CURRENT_DATE");
      expect(params).toEqual(["2026-09-01", "2026-09-30"]);
    }
  });

  it("returns untagged failures from the same scoped test population", async () => {
    query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("as total_tests") && !sql.includes("GROUP BY")
        ? [{ total_tests: "100", total_failed_tests: "10", untagged_failed: "3", test_outcomes: "F".repeat(10) + "P".repeat(90) }]
        : [],
    }));
    const response = await GET(request("timeRange=30d"));
    const body = await response.json();
    expect(body).toMatchObject({ totalTests: 100, totalFailedTests: 10, untaggedFailed: 3, testOutcomes: "F".repeat(10) + "P".repeat(90) });
    const sql = scopedQueries()[0][0];
    expect(sql).toContain("NOT EXISTS");
    expect(sql).toContain("ta.current_test_id = base_tests.test_id");
    expect(sql).toContain("ORDER BY start_time_utc, test_id");
  });

  it("rejects a reversed range before querying metrics", async () => {
    const response = await GET(request("dateFrom=2026-09-30&dateTo=2026-09-01"));
    expect(response.status).toBe(400);
    expect(scopedQueries()).toHaveLength(0);
  });

  it("keeps preset filtering when no custom dates are supplied", async () => {
    expect((await GET(request("timeRange=90d"))).status).toBe(200);
    for (const [sql, params] of scopedQueries()) {
      expect(sql).toContain("CURRENT_DATE - INTERVAL '90 days'");
      expect(params).toEqual([]);
    }
  });

  it("clears all date bounds for all time", async () => {
    expect((await GET(request("timeRange=all"))).status).toBe(200);
    for (const [sql, params] of scopedQueries()) {
      expect(sql).not.toContain("t.start_time_utc >=");
      expect(sql).not.toContain("t.start_time_utc <");
      expect(params).toEqual([]);
    }
  });
});
