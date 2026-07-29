/**
 * Summary compare response contract tests (mocked pg Client).
 * Covers flat vs structured envelope, null previous for all, annotation split
 * query params, and failureRatePp from raw counts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth-check", () => ({
  requireAuth: vi.fn(async () => ({ error: null })),
}));

vi.mock("@/lib/config", () => ({
  getDatabaseConfig: () => ({ connectionString: "mock" }),
}));

const connectMock = vi.fn(async () => undefined);
const endMock = vi.fn(async () => undefined);
const queryMock = vi.fn();

vi.mock("pg", () => {
  return {
    Client: class {
      connect = connectMock;
      end = endMock;
      query = queryMock;
    },
  };
});

import { GET } from "@/app/api/test-stats/route";
import { buildSummaryDelta } from "@/lib/summary-delta";

function req(qs: string) {
  return new NextRequest(`http://localhost/api/test-stats?${qs}`);
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

/** Default mock: relative windows return fixed current vs previous counts. */
function installDefaultQueryMock() {
  queryMock.mockImplementation(async (sql: string, _params?: unknown[]) => {
    if (typeof sql === "string" && sql.includes("SET timezone")) {
      return { rows: [] };
    }

    // Annotation path first (unfiltered totals include total_failed)
    if (typeof sql === "string" && sql.includes("as total_failed")) {
      return { rows: [{ total: "100", passed: "90", total_failed: "10" }] };
    }

    // Annotation path: filtered failed only (no total/passed columns)
    if (
      typeof sql === "string" &&
      sql.includes("as failed") &&
      !sql.includes("as total") &&
      !sql.includes("as passed")
    ) {
      return { rows: [{ failed: "3" }] };
    }

    // Previous 30d half-open: INTERVAL '60 days' ... INTERVAL '30 days'
    if (
      typeof sql === "string" &&
      sql.includes("INTERVAL '60 days'") &&
      sql.includes("INTERVAL '30 days'")
    ) {
      return { rows: [{ total: "1144", passed: "1105", failed: "39" }] };
    }

    // Current 30d open: only INTERVAL '30 days' (not 60)
    if (
      typeof sql === "string" &&
      sql.includes("INTERVAL '30 days'") &&
      !sql.includes("INTERVAL '60 days'")
    ) {
      return { rows: [{ total: "1284", passed: "1253", failed: "31" }] };
    }

    // all-time / no filter
    if (
      typeof sql === "string" &&
      sql.includes("COUNT(*) as total") &&
      !sql.includes("INTERVAL")
    ) {
      return { rows: [{ total: "5000", passed: "4800", failed: "200" }] };
    }

    return { rows: [{ total: "0", passed: "0", failed: "0" }] };
  });
}

beforeEach(() => {
  connectMock.mockClear();
  endMock.mockClear();
  queryMock.mockReset();
  installDefaultQueryMock();
});

describe("view=summary without compare", () => {
  it("returns flat SummaryStats keys only", async () => {
    const res = await GET(
      req("view=summary&chartMode=recent&timeRange=30d")
    );
    expect(res.status).toBe(200);
    const body = await json(res);

    expect(body).toMatchObject({
      total: 1284,
      passed: 1253,
      failed: 31,
      failureRate: 2.41,
    });
    expect(body).not.toHaveProperty("current");
    expect(body).not.toHaveProperty("previous");
    expect(body).not.toHaveProperty("delta");
    expect(body).not.toHaveProperty("labels");
    expect(body).not.toHaveProperty("chartMode");
  });
});

describe("view=summary&compare=1", () => {
  it("returns structured envelope with previous/delta/labels for 30d", async () => {
    const res = await GET(
      req("view=summary&compare=1&chartMode=recent&timeRange=30d&annotation=all")
    );
    expect(res.status).toBe(200);
    const body = await json(res);

    expect(body.chartMode).toBe("recent");
    expect(body.timeRange).toBe("30d");
    expect(body.annotation).toBe("all");
    expect(body.current).toMatchObject({
      total: 1284,
      passed: 1253,
      failed: 31,
      failureRate: 2.41,
    });
    expect(body.previous).toMatchObject({
      total: 1144,
      passed: 1105,
      failed: 39,
      failureRate: 3.41,
    });
    expect(body.delta).toMatchObject({
      total: 140,
      passed: 148,
      failed: -8,
      failureRatePp: -1.0,
    });
    expect(body.labels).toEqual({
      current: "Last 30 days",
      previous: "Prior 30 days",
    });
    // Two clients: primary + previous window
    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(endMock).toHaveBeenCalledTimes(2);
  });

  it("nulls previous/delta/labels when timeRange=all", async () => {
    const res = await GET(
      req("view=summary&compare=1&chartMode=recent&timeRange=all")
    );
    expect(res.status).toBe(200);
    const body = await json(res);

    expect(body.timeRange).toBe("all");
    expect(body.current).toMatchObject({
      total: 5000,
      passed: 4800,
      failed: 200,
    });
    expect(body.previous).toBeNull();
    expect(body.delta).toBeNull();
    expect(body.labels).toBeNull();
    // Only primary client (no prior window)
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it("emits only validated timeRange (invalid raw string → null)", async () => {
    const res = await GET(
      req("view=summary&compare=1&timeRange=14d&chartMode=recent")
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    // 14d is not in whitelist → validatedTimeRange null; filter is all-time
    expect(body.timeRange).toBeNull();
    expect(body.previous).toBeNull();
    expect(body.delta).toBeNull();
  });

  it("normalizes invalid chartMode to recent", async () => {
    const res = await GET(
      req("view=summary&compare=1&timeRange=30d&chartMode=bogus")
    );
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.chartMode).toBe("recent");
    // recent branch uses latest_tests CTE
    const dataQueries = queryMock.mock.calls
      .map((c) => String(c[0]))
      .filter((s) => s.includes("COUNT"));
    expect(dataQueries.some((s) => s.includes("latest_tests"))).toBe(true);
  });
});

describe("annotation filter split queries", () => {
  it("issues unfiltered then filtered queries with annotation param", async () => {
    const res = await GET(
      req(
        "view=summary&chartMode=all&timeRange=30d&annotation=Hardware%20Failure"
      )
    );
    expect(res.status).toBe(200);
    const body = await json(res);

    expect(body).toMatchObject({
      total: 100,
      passed: 90,
      failed: 3,
      failureRate: 3,
      failurePercentageOfTotal: 30,
    });

    const calls = queryMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && String(c[0]).includes("COUNT")
    );
    expect(calls.length).toBe(2);

    // Query 1: unfiltered totals (no annotation param)
    const q1sql = String(calls[0][0]);
    expect(q1sql).toContain("total_failed");
    expect(q1sql).not.toContain("TestAnnotations");
    expect(calls[0][1]).toBeUndefined(); // only INTERVAL, no params

    // Query 2: filtered failed with annotation text as last param
    const q2sql = String(calls[1][0]);
    expect(q2sql).toContain("TestAnnotations");
    expect(calls[1][1]).toEqual(["Hardware Failure"]);
  });

  it("compare with annotation runs split queries on both windows", async () => {
    await GET(
      req(
        "view=summary&compare=1&chartMode=all&timeRange=30d&annotation=Hardware%20Failure"
      )
    );

    const dataCalls = queryMock.mock.calls.filter(
      (c) => typeof c[0] === "string" && String(c[0]).includes("COUNT")
    );
    // 2 windows × 2 split queries = 4
    expect(dataCalls.length).toBe(4);

    const withAnnotation = dataCalls.filter((c) =>
      String(c[0]).includes("TestAnnotations")
    );
    expect(withAnnotation.length).toBe(2);
    for (const call of withAnnotation) {
      expect(call[1]).toEqual(["Hardware Failure"]);
    }
  });
});

describe("buildSummaryDelta", () => {
  it("computes failureRatePp from raw counts not rounded rates", () => {
    // 1/3 ≈ 33.33% rounded display 33.33; 1/7 ≈ 14.29
    // pp from rounded: 33.33 - 14.29 = 19.04 → 19.0
    // pp from raw: (1/3 - 1/7)*100 ≈ 19.0476 → 19.0 (same at 1dp here)
    // Use counts where rounded rates diverge more at 1dp chain:
    // failed/total such that (round(a,2) - round(b,2)) differs from raw at 1dp
    const current = {
      total: 3,
      passed: 2,
      failed: 1,
      failureRate: 33.33,
    };
    const previous = {
      total: 6,
      passed: 5,
      failed: 1,
      failureRate: 16.67,
    };
    // raw: (1/3 - 1/6)*100 = 16.666... → 16.7
    // from rounded: 33.33 - 16.67 = 16.66 → 16.7
    const delta = buildSummaryDelta(current, previous);
    expect(delta.failureRatePp).toBe(16.7);
    expect(delta.total).toBe(-3);
    expect(delta.failed).toBe(0);
  });

  it("treats zero total as 0% rate", () => {
    const delta = buildSummaryDelta(
      { total: 0, passed: 0, failed: 0, failureRate: 0 },
      { total: 10, passed: 9, failed: 1, failureRate: 10 }
    );
    expect(delta.failureRatePp).toBe(-10);
  });
});
