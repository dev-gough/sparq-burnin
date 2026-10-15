import { describe, expect, it } from "vitest";
import { parseUtcTimestamp } from "@/lib/utc-timestamp";

describe("parseUtcTimestamp", () => {
  it.each([
    ["2026-10-04T21:16:10.938-04:00", "2026-10-05T01:16:10.938Z"],
    ["2026-10-04T21:16:10-04", "2026-10-05T01:16:10.000Z"],
    ["2026-10-15T10:57:23+0530", "2026-10-15T05:27:23.000Z"],
    ["2026-10-15 05:27:23+00", "2026-10-15T05:27:23.000Z"],
    ["2026-10-15T05:27:23Z", "2026-10-15T05:27:23.000Z"],
    ["2026-10-15T05:27:23", "2026-10-15T05:27:23.000Z"],
    ["2026-10-15", "2026-10-15T00:00:00.000Z"],
  ])("reads %s", (input, expected) => {
    expect(parseUtcTimestamp(input).toISOString()).toBe(expected);
  });
});
