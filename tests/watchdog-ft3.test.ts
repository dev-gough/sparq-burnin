import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "burnin-ft3-watchdog-"));
  roots.push(root);
  const cloud = path.join(root, "cloud");
  const data = path.join(root, "data");
  mkdirSync(path.join(root, "scripts"));
  mkdirSync(path.join(cloud, "station-2"), { recursive: true });
  mkdirSync(path.join(data, "quarantine", "ft3"), { recursive: true });
  writeFileSync(path.join(root, "psutil.py"), "def pid_exists(pid):\n    return False\n");
  writeFileSync(path.join(root, "scripts", "watchdog.py"), readFileSync("scripts/watchdog.py", "utf8"));
  writeFileSync(path.join(root, "config.json"), JSON.stringify({
    paths: {
      source_directories: [],
      ft3_directories: [{ name: "FT3", dir: cloud }],
      local: { main_dir: data, log_dir: path.join(root, "log"), dashboard_dir: root },
    },
    settings: { check_interval: 3600, log_file: "watchdog.log", max_log_size_mb: 1, log_backup_count: 1 },
  }));
  for (const name of ["FT3_1_2026-10-15_12-00-00.csv", "FT3_old_2026-10-01_12-00-00.csv", "FT3_bad_2026-10-02_12-00-00.csv", "notes.txt"]) {
    writeFileSync(path.join(cloud, name), "x");
  }
  writeFileSync(path.join(cloud, "station-2", "FT3_2_2026-10-15_13-00-00.csv"), "x");
  writeFileSync(path.join(data, "quarantine", "ft3", "FT3_bad_2026-10-02_12-00-00.csv"), "x");
  return { root, cloud, data };
}

function runPython(root: string, body: string) {
  const result = spawnSync("python3", ["-c", `
import sys, json
sys.path.insert(0, ${JSON.stringify(path.join(root, "scripts"))})
import watchdog
watchdog.load_ft3_ingested_names = lambda: {"FT3_old_2026-10-01_12-00-00.csv"}
${body}`], { env: { ...process.env, PYTHONPATH: root }, encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim().split("\n").pop()!);
}

describe("watchdog FT3 sync", () => {
  it("copies new FT3 files from subfolders and skips ingested or quarantined names", () => {
    const { root, data } = setup();
    const out = runPython(root, `errors = []
print(json.dumps([watchdog.sync_ft3_sources(errors), errors]))`);
    expect(out).toEqual([[4, 2], []]);
    const queue = path.join(data, "to_process", "ft3");
    expect(existsSync(path.join(queue, "FT3_1_2026-10-15_12-00-00.csv"))).toBe(true);
    expect(existsSync(path.join(queue, "FT3_2_2026-10-15_13-00-00.csv"))).toBe(true);
    expect(existsSync(path.join(queue, "FT3_old_2026-10-01_12-00-00.csv"))).toBe(false);
    expect(existsSync(path.join(queue, "FT3_bad_2026-10-02_12-00-00.csv"))).toBe(false);

    // A second cycle finds the queued files and copies nothing.
    const again = runPython(root, `print(json.dumps(watchdog.sync_ft3_sources([])))`);
    expect(again).toEqual([4, 0]);
  });

  it("reports an unreadable FT3 folder instead of treating it as empty", () => {
    const { root, cloud } = setup();
    rmSync(cloud, { recursive: true });
    const [counts, errors] = runPython(root, `errors = []
print(json.dumps([watchdog.sync_ft3_sources(errors), errors]))`);
    expect(counts).toEqual([0, 0]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("FT3 FT3");
  });
});
