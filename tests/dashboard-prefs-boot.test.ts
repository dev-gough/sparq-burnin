import { describe, expect, it } from "vitest";
import {
  hasDashboardBootPrefs,
  parseDashboardBootCookie,
  pickBootPrefs,
  resolveDashboardInitState,
  prefsFromDashboardState,
} from "@/lib/dashboard-prefs";

describe("resolveDashboardInitState", () => {
  it.each([true, false])("restores a chart day drill with filters linked=%s", (filterLinked) => {
    const snapshot = prefsFromDashboardState({
      dashboardRange: { kind: "90d" }, lastPill: "90d", chartMode: "recent",
      bucket: "day", filterLinked, annotationFilter: "all", statusFilter: "valid",
      tableDateFrom: "2026-09-24", tableDateTo: "2026-09-24", selectedDate: "2026-09-24",
    });
    // Both client navigation (localStorage) and a fresh page (boot cookie).
    for (const saved of [snapshot, parseDashboardBootCookie(encodeURIComponent(JSON.stringify(pickBootPrefs(snapshot))))]) {
      const restored = resolveDashboardInitState(saved);
      expect(restored.dashboardRange).toEqual({ kind: "90d" });
      expect(restored.selectedDate).toBe("2026-09-24");
      expect(restored.tableDateFrom).toBe("2026-09-24");
      expect(restored.tableDateTo).toBe("2026-09-24");
    }
  });

  it("clears the saved day when returning to a period filter", () => {
    const snapshot = prefsFromDashboardState({
      dashboardRange: { kind: "all" }, lastPill: "all", chartMode: "recent",
      bucket: "day", filterLinked: true, annotationFilter: "all", statusFilter: "valid",
      tableDateFrom: "", tableDateTo: "", selectedDate: "",
    });
    expect(snapshot.selectedDate).toBeUndefined();
    expect(resolveDashboardInitState(snapshot).selectedDate).toBe("");
  });

  it("ignores a stale day marker when the date range has changed", () => {
    const restored = resolveDashboardInitState({period: "all", selectedDate: "2026-09-24", dateFromFilter: "", dateToFilter: ""});
    expect(restored.selectedDate).toBe("");
    expect(restored.tableDateFrom).toBe("");
  });

  it("defaults to 30d + recent when empty", () => {
    const s = resolveDashboardInitState({});
    expect(s.dashboardRange).toEqual({ kind: "30d" });
    expect(s.chartMode).toBe("recent");
    expect(s.filterLinked).toBe(true);
  });

  it("restores all-time + all tests from boot prefs", () => {
    const s = resolveDashboardInitState({
      period: "all",
      chartMode: "all",
    });
    expect(s.dashboardRange).toEqual({ kind: "all" });
    expect(s.lastPill).toBe("all");
    expect(s.chartMode).toBe("all");
    expect(s.tableDateFrom).toBe("");
    expect(s.tableDateTo).toBe("");
  });

  it("restores custom range", () => {
    const s = resolveDashboardInitState({
      period: "custom",
      customFrom: "2026-01-01",
      customTo: "2026-01-15",
      chartMode: "recent",
    });
    expect(s.dashboardRange).toEqual({
      kind: "custom",
      from: "2026-01-01",
      to: "2026-01-15",
    });
  });
});

describe("boot cookie helpers", () => {
  it("parseDashboardBootCookie round-trips encodeURIComponent JSON", () => {
    const raw = encodeURIComponent(
      JSON.stringify({ period: "all", chartMode: "all" }),
    );
    expect(parseDashboardBootCookie(raw)).toEqual({
      period: "all",
      chartMode: "all",
    });
  });

  it("hasDashboardBootPrefs detects period or mode", () => {
    expect(hasDashboardBootPrefs({})).toBe(false);
    expect(hasDashboardBootPrefs({ period: "all" })).toBe(true);
    expect(hasDashboardBootPrefs({ chartMode: "all" })).toBe(true);
  });

  it("pickBootPrefs drops non-boot fields", () => {
    const boot = pickBootPrefs({
      period: "7d",
      chartMode: "recent",
      serialSearch: "ABC",
    });
    expect(boot.period).toBe("7d");
    expect(boot.chartMode).toBe("recent");
    expect((boot as { serialSearch?: string }).serialSearch).toBeUndefined();
  });
});
