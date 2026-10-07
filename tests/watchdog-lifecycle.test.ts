import { afterEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

async function waitFor(file: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (existsSync(file)) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Watchdog did not write ${file}`);
}

async function exerciseWatchdog(slowCycle: boolean, override = true) {
  const root = mkdtempSync(path.join(tmpdir(), "burnin-watchdog-"));
  roots.push(root);
  mkdirSync(path.join(root, "scripts"));
  const current = path.join(root, "current");
  symlinkSync(root, current);
  writeFileSync(path.join(root, "psutil.py"), "def pid_exists(pid):\n    return False\n");
  writeFileSync(path.join(root, "config.json"), JSON.stringify({
    paths: { source_directories: [], local: { main_dir: path.join(root, "data"), log_dir: path.join(root, "log"), dashboard_dir: override ? "/old-checkout" : root } },
    settings: { check_interval: 3600, log_file: "watchdog.log", max_log_size_mb: 1, log_backup_count: 1 },
  }));
  let source = readFileSync("scripts/watchdog.py", "utf8");
  if (slowCycle) {
    source = source.replace('if __name__ == "__main__":', `
def slow_cycle_fixture():
    with open(os.path.join(main_dir, "cycle-entered"), "w") as marker:
        marker.write("started")
    time.sleep(0.2)
    return set()
load_ingested_names = slow_cycle_fixture
if __name__ == "__main__":`);
  }
  const script = path.join(root, "scripts", "watchdog.py");
  writeFileSync(script, source);
  const child = spawn("python3", [script], { env: { ...process.env, PYTHONPATH: root, BURNIN_RELEASE_DIR: override ? current : "" } });
  let output = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { output += data; });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("exit", resolve);
    child.once("error", reject);
  });
  const statusFile = path.join(root, "data", ".ops", "watchdog-status.json");
  try {
    await waitFor(slowCycle ? path.join(root, "data", "cycle-entered") : statusFile);
    const status = JSON.parse(readFileSync(statusFile, "utf8"));
    expect(status.pid).toBe(child.pid);
    expect(status.releaseDir).toBe(root);
    // A subsequent deployment changes current, but this process remains pinned.
    rmSync(current);
    symlinkSync("/another-release", current);
    child.kill("SIGTERM");
    expect(await exited, output).toBe(0);
    const finished = JSON.parse(readFileSync(statusFile, "utf8"));
    expect(finished.releaseDir).toBe(root);
    if (slowCycle) expect(finished.lastCycleFinishedAt).toBeTruthy();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
}

describe("watchdog release lifecycle", () => {
  it("uses the deployed release override and exits promptly while idle", async () => {
    await exerciseWatchdog(false);
  });
  it("finishes an active cycle before exiting on SIGTERM", async () => {
    await exerciseWatchdog(true);
  });
  it("retains the configured checkout when no release override is supplied", async () => {
    await exerciseWatchdog(false, false);
  });
});
