import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ingestFt3Queue, requeueFt3Quarantine } from "../scripts/ingest-ft3";

const SAMPLE = "FT3_190826396198_2026-10-15_12-07-29.csv";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function queue(files: Record<string, string | null>) {
  const root = mkdtempSync(path.join(tmpdir(), "burnin-ft3-ingest-"));
  roots.push(root);
  const dir = path.join(root, "to_process", "ft3");
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    if (content === null) copyFileSync(path.join(__dirname, "fixtures", SAMPLE), path.join(dir, name));
    else writeFileSync(path.join(dir, name), content);
  }
  return root;
}

describe("ingestFt3Queue", () => {
  it("stores runs, moves files to processed and quarantines unreadable ones", async () => {
    const root = queue({ [SAMPLE]: null, "FT3_broken_2026-10-15_12-00-00.csv": "Test Time\r\n" });
    const query = vi.fn().mockResolvedValue({ rowCount: 1 });
    const summary = await ingestFt3Queue(root, { query }, () => {});
    expect(summary).toEqual({ files: 2, added: 1, duplicates: 0, quarantined: 1, failed: 0 });
    expect(query.mock.calls[0][1][9]).toBe(SAMPLE);
    expect(query.mock.calls[0][1][10]).toBe("pcloud");
    expect(existsSync(path.join(root, "processed", "ft3", SAMPLE))).toBe(true);
    expect(existsSync(path.join(root, "quarantine", "ft3", "FT3_broken_2026-10-15_12-00-00.csv"))).toBe(true);
    expect(readFileSync(path.join(root, "quarantine", "ft3", "FT3_broken_2026-10-15_12-00-00.csv.reason.txt"), "utf8")).toBe("The file has no result row\n");
  });

  it("treats an already stored run as done", async () => {
    const root = queue({ [SAMPLE]: null });
    const summary = await ingestFt3Queue(root, { query: vi.fn().mockResolvedValue({ rowCount: 0 }) }, () => {});
    expect(summary).toMatchObject({ added: 0, duplicates: 1, failed: 0 });
    expect(existsSync(path.join(root, "processed", "ft3", SAMPLE))).toBe(true);
  });

  it("leaves files in the queue when the database fails", async () => {
    const root = queue({ [SAMPLE]: null });
    const summary = await ingestFt3Queue(root, { query: vi.fn().mockRejectedValue(new Error("down")) }, () => {});
    expect(summary.failed).toBe(1);
    expect(existsSync(path.join(root, "to_process", "ft3", SAMPLE))).toBe(true);
  });

  it("puts quarantined files back in the queue for a retry", async () => {
    const root = queue({ "FT3_broken_2026-10-15_12-00-00.csv": "Test Time\r\n" });
    await ingestFt3Queue(root, { query: vi.fn() }, () => {});
    expect(await requeueFt3Quarantine(root)).toBe(1);
    expect(existsSync(path.join(root, "to_process", "ft3", "FT3_broken_2026-10-15_12-00-00.csv"))).toBe(true);
    expect(existsSync(path.join(root, "quarantine", "ft3", "FT3_broken_2026-10-15_12-00-00.csv.reason.txt"))).toBe(false);
  });

  it("does nothing when there is no queue", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "burnin-ft3-empty-"));
    roots.push(root);
    expect(await ingestFt3Queue(root, { query: vi.fn() }, () => {})).toEqual({ files: 0, added: 0, duplicates: 0, quarantined: 0, failed: 0 });
  });
});
