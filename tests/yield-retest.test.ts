import { describe, expect, it } from "vitest";
import { buildYieldQuery, yieldPercent } from "@/lib/yield-retest";

describe("yield query validation", () => {
  it.each(["timeRange=bad", "dateFrom=2026-02-30", "dateFrom=2026-10-08&dateTo=2026-10-01", "page=-1", "page=1.5", "page=100001", "scope=bad", `serial=${"a".repeat(51)}`])("rejects %s", params => {
    expect(() => buildYieldQuery(new URLSearchParams(params))).toThrow();
  });
  it("binds literal serial searches and inclusive custom bounds", () => {
    const q = buildYieldQuery(new URLSearchParams("dateFrom=2026-09-01&dateTo=2026-09-30&serial=INV%25_&page=2"));
    expect(q.values).toEqual(["2026-09-01", "2026-09-30", "%INV\\%\\_%", 25]);
    expect(q.sql).toContain("AT TIME ZONE 'UTC'");
    expect(q.sql).not.toContain("INV%_");
  });
  it("defaults to held-up units and compares against the same-length previous period", () => {
    expect(buildYieldQuery(new URLSearchParams("")).scope).toBe("held");
    const q = buildYieldQuery(new URLSearchParams("dateFrom=2026-09-01&dateTo=2026-09-30"));
    expect(q.sql).toContain("'previous', (SELECT");
    expect(buildYieldQuery(new URLSearchParams("timeRange=all")).sql).toContain("'previous', NULL");
  });
  it("does not present empty populations as zero percent", () => {
    expect(yieldPercent(0, 0)).toBe("—");
    expect(yieldPercent(2, 3)).toBe("66.7%");
  });
});
