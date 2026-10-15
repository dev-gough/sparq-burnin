import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const config = vi.hoisted(() => ({ paths: { local: { main_dir: "" }, ft3_directories: [{ name: "FT3", dir: "/cloud/FT3" }] } }));
vi.mock("@/lib/config", () => ({ loadConfig: () => config }));
import { ft3Status, snapshotFt3 } from "@/lib/ft3Ops";

let root = "";
beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), "burnin-ft3ops-")); config.paths.local.main_dir = root; });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("FT3 health", () => {
  it("is ok with nothing quarantined or waiting", async () => {
    const snap = await snapshotFt3();
    expect(snap).toMatchObject({ configuredFolders: 1, quarantined: 0, queued: 0 });
    expect(ft3Status(snap, 60)).toEqual({ status: "ok", detail: "1 FT3 folder · 0 queued · none quarantined" });
  });

  it("is degraded while unparsed files sit in quarantine, naming the newest problem", async () => {
    const dir = path.join(root, "quarantine", "ft3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "FT3_a.csv"), "x");
    utimesSync(path.join(dir, "FT3_a.csv"), new Date("2026-10-01"), new Date("2026-10-01"));
    writeFileSync(path.join(dir, "FT3_b.csv"), "x");
    writeFileSync(path.join(dir, "FT3_b.csv.reason.txt"), 'Unknown columns: "Fixture"\nTester is empty\n');
    const snap = await snapshotFt3();
    expect(snap.quarantined).toBe(2);
    expect(snap.files[0]).toMatchObject({ name: "FT3_b.csv", problems: ['Unknown columns: "Fixture"', "Tester is empty"] });
    expect(snap.files[1].problems).toEqual(["No reason recorded"]);
    const status = ft3Status(snap, 60);
    expect(status.status).toBe("degraded");
    expect(status.detail).toBe('2 FT3 files could not be parsed; see quarantine/ft3 (newest FT3_b.csv: Unknown columns: "Fixture")');
  });

  it("is degraded when queued files are not being ingested", async () => {
    const dir = path.join(root, "to_process", "ft3");
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "FT3_a.csv"), "x");
    const old = new Date(Date.now() - 3600_000);
    utimesSync(path.join(dir, "FT3_a.csv"), old, old);
    expect(ft3Status(await snapshotFt3(), 60).status).toBe("degraded");
    expect(ft3Status(await snapshotFt3(), 3600).status).toBe("ok");
  });
});
