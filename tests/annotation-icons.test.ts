import { describe, expect, it } from "vitest";
import { annotationColour, annotationIcon, tableAnnotationItems } from "@/lib/annotation-icons";

describe("table annotation metadata", () => {
  it("retains full free-text names containing semicolons", () => {
    const item = { name: "Check relay; reconnect cable", group_name: null, group_color: null };
    expect(tableAnnotationItems([item], item.name, [])).toEqual([item]);
  });
  it("resolves legacy setup prefixes and cached category colours", () => {
    const dc = { name: "DC", group_name: "Setup Issue", group_color: "#123456" };
    expect(tableAnnotationItems(undefined, "Setup Issue - DC; New cause", [dc])).toEqual([
      dc, { name: "New cause", group_name: null, group_color: null },
    ]);
    expect(annotationColour(dc)).toBe("#123456");
  });
  it("keeps every distinct annotation and safely handles empty cells", () => {
    const item = { name: "AC", group_name: "Setup Issue", group_color: null };
    expect(tableAnnotationItems([item, item], "AC; AC", [])).toEqual([item]);
    expect(tableAnnotationItems(undefined, null, [])).toEqual([]);
    expect(tableAnnotationItems(undefined, "-", [])).toEqual([]);
    expect(annotationColour(item)).toBe("#f59e0b");
  });
  it("gives all 15 active categories a distinct symbol and supports historical names", () => {
    const names = ["Unknown", "Channel Short Before Aging", "Internal DC Connection Loose", "Relay Issue", "Zigbee/NIOS UART", "Channel Short During Aging", "Inverter Failure - Other", "DC", "AC", "Mixed Connectors", "Unstable Grid", "Anti-Islanding", "GFDI Fault", "Device Timeout", "inverter over temperature"];
    expect(new Set(names.map(annotationIcon)).size).toBe(names.length);
    expect(annotationIcon("Channel Short BA")).toBe(annotationIcon("Channel Short Before Aging"));
    expect(annotationIcon("Custom cause")).toBeDefined();
  });
});
