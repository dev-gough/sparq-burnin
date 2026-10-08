import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { compareChangelog, groupChangelog, loadChangelog, parseChangelog, readPackageVersion, type ChangelogEntry } from "@/lib/changelog";

const released = (id: string): ChangelogEntry => ({ id, title: `v${id}`, summary: [], sections: [], shots: [] });

describe("changelog notes", () => {
  it("reads a version file as the tag message", () => {
    const entry = parseChangelog("v0.7.0.md", [
      "v0.7.0 — 2025-11-17",
      "",
      "Baseline paragraph.",
      "",
      "Fixed",
      "- Charts stay still.",
    ].join("\n"));
    expect(entry.id).toBe("0.7.0");
    expect(entry.title).toBe("v0.7.0 — 2025-11-17");
    expect(entry.summary).toEqual(["Baseline paragraph."]);
    expect(entry.sections).toEqual([{ name: "Fixed", items: ["Charts stay still."] }]);
  });

  it("reads before and after shots and rejects paths outside /changelog/", () => {
    const entry = parseChangelog("v0.8.0.md", [
      "v0.8.0",
      "",
      "Shots",
      "- Sidebar | before /changelog/v0.8.0/nav-before.png | after /changelog/v0.8.0/nav-after.png",
    ].join("\n"));
    expect(entry.shots).toEqual([{
      caption: "Sidebar",
      before: "/changelog/v0.8.0/nav-before.png",
      after: "/changelog/v0.8.0/nav-after.png",
    }]);
    expect(() => parseChangelog("v0.8.0.md", "v0.8.0\n\nShots\n- Nav | before /etc/passwd | after /changelog/v0.8.0/a.png\n")).toThrow(/\/changelog\//);
    expect(() => parseChangelog("v0.8.0.md", "v0.8.0\n\nShots\n- Nav | before /changelog/../package.json | after /changelog/v0.8.0/a.png\n")).toThrow(/\/changelog\//);
  });

  it("rejects a file name that does not match its title", () => {
    expect(() => parseChangelog("v0.7.0.md", "v0.8.0\n")).toThrow(/does not match/);
    expect(() => parseChangelog("unreleased.md", "v0.7.0\n")).toThrow(/Unreleased/);
  });

  it("lists Unreleased first, then newer versions", () => {
    const entries = [released("0.7.0"), released("0.10.0"), { ...released("0.0.0"), id: "unreleased" }, released("1.0.0")];
    expect(entries.sort(compareChangelog).map(entry => entry.id)).toEqual(["unreleased", "1.0.0", "0.10.0", "0.7.0"]);
  });

  it("collects same-day patches without collapsing feature releases or Unreleased", () => {
    const patches = ["0.9.4", "0.9.3", "0.9.2", "0.9.1"].map(id => ({
      ...released(id), title: `v${id} — 2026-10-07`,
    }));
    const unreleased = { ...released("0.0.0"), id: "unreleased" };
    const entries = [unreleased, released("0.10.0"), ...patches, released("0.9.0")];
    expect(groupChangelog(entries)).toEqual([
      { kind: "release", entry: unreleased },
      { kind: "release", entry: entries[1] },
      { kind: "patches", family: "0.9.x", date: "2026-10-07", entries: patches },
      { kind: "release", entry: entries.at(-1) },
    ]);
  });

  it("keeps patches from different days or version families separate", () => {
    const entries = [
      { ...released("0.9.4"), title: "v0.9.4 — 2026-10-07" },
      { ...released("0.9.3"), title: "v0.9.3 — 2026-10-06" },
      { ...released("0.8.2"), title: "v0.8.2 — 2026-10-06" },
    ];
    const groups = groupChangelog(entries);
    expect(groups).toHaveLength(3);
    expect(groups.every(group => group.kind === "patches" && group.entries.length === 1)).toBe(true);
    expect(entries.map(entry => entry.id)).toEqual(["0.9.4", "0.9.3", "0.8.2"]);
  });

  it("matches package.json to the newest released note and skips an empty Unreleased file", () => {
    const root = mkdtempSync(path.join(tmpdir(), "changelog-"));
    mkdirSync(path.join(root, "changelog"));
    writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "0.8.0" }));
    writeFileSync(path.join(root, "changelog", "unreleased.md"), "Unreleased\n");
    writeFileSync(path.join(root, "changelog", "v0.8.0.md"), "v0.8.0\n\nA release.\n");
    writeFileSync(path.join(root, "changelog", "v0.7.0.md"), "v0.7.0\n\nOlder.\n");
    const entries = loadChangelog(root);
    expect(entries.map(entry => entry.id)).toEqual(["0.8.0", "0.7.0"]);
    expect(readPackageVersion(root)).toBe(entries.find(entry => entry.id !== "unreleased")!.id);
  });

  it("keeps any published note on the same version as package.json", () => {
    const newest = loadChangelog().find(entry => entry.id !== "unreleased");
    if (newest) expect(newest.id).toBe(readPackageVersion());
    else expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
