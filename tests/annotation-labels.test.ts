import { describe, expect, it } from "vitest";
import { annotationColour, annotationShortLabel, tableAnnotationItems } from "@/lib/annotation-labels";

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
  it("uses readable short names and retains custom text verbatim", () => {
    expect(annotationShortLabel("Channel Short Before Aging")).toBe("Short (before aging)");
    expect(annotationShortLabel("Channel Short BA")).toBe("Short (before aging)");
    expect(annotationShortLabel("Channel Short During Aging")).toBe("Short (during aging)");
    expect(annotationShortLabel("Internal DC Connection Loose")).toBe("Loose DC connection");
    expect(annotationShortLabel("Custom cause; check cable")).toBe("Custom cause; check cable");
  });
});
