import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "burnin-production-"));
  roots.push(root);
  const app = path.join(root, "app");
  const deploy = path.join(root, "deploy");
  const bin = path.join(root, "bin");
  for (const dir of [app, deploy, bin]) mkdirSync(dir);
  const git = (...args: string[]) => execFileSync("git", ["-C", app, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "master");
  git("config", "user.name", "Deployment Test");
  git("config", "user.email", "deployment-test@invalid.local");
  writeFileSync(path.join(app, ".gitignore"), "config.json\n.env.local\n.next/\ndata/\nlog/\nlogs/\n");
  writeFileSync(path.join(app, "package.json"), JSON.stringify({ version: "0.8.0" }));
  git("add", "."); git("commit", "-m", "previous application");
  const previous = git("rev-parse", "HEAD");
  writeFileSync(path.join(app, "package.json"), JSON.stringify({ version: "0.9.0" }));
  writeFileSync(path.join(app, "release.txt"), "new release");
  git("add", "."); git("commit", "-m", "new release");
  const sha = git("rev-parse", "HEAD");
  git("tag", "-a", "v0.9.0", "-m", "new release");
  git("checkout", "--detach", previous);
  writeFileSync(path.join(app, "config.json"), "{}");
  writeFileSync(path.join(app, ".env.local"), "HEALTH_TOKEN=canary-secret\n");
  mkdirSync(path.join(app, ".next"));
  writeFileSync(path.join(app, ".next", "running-build"), "untouched");
  mkdirSync(path.join(app, "data"));
  symlinkSync(app, path.join(deploy, "current"));
  symlinkSync(process.execPath, path.join(bin, "node"));
  const executable = (name: string, body: string) => writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`, { mode: 0o755 });
  executable("npm", `printf 'npm:%s:%s\\n' "$*" "$PWD" >> "$TRACE_FILE"
    if [[ "$*" == "$FAIL_STEP" ]]; then exit 1; fi
    if [[ "$*" == 'run build' ]]; then mkdir .next; printf 'new build' > .next/staged-build; fi`);
  executable("systemctl", `if [[ "$1" == show ]]; then printf '%s/current\\n' "$DEPLOY_ROOT"; else printf 'systemctl:%s\\n' "$*" >> "$TRACE_FILE"; fi`);
  executable("sudo", `if [[ "$2" == -l ]]; then exit 0; fi
    shift; exec "$@"`);
  executable("curl", `output=''
    while [[ "$#" -gt 0 ]]; do
      case "$1" in --output) output="$2"; shift 2;; *) shift;; esac
    done
    current="$(readlink -f "$DEPLOY_ROOT/current")"
    version="$(node -p "require(process.argv[1]).version" "$current/package.json")"
    if [[ "$FAIL_HEALTH" == yes && -f "$current/.production-commit" ]]; then version=broken; fi
    printf '{"version":"%s","checks":[{"name":"database","status":"ok"}]}' "$version" > "$output"
    printf 200`);
  const env = {
    ...process.env, APP_DIR: app, DEPLOY_ROOT: deploy, NODE_BIN_DIR: bin,
    SYSTEMCTL: path.join(bin, "systemctl"), REPO_URL: app,
    TRACE_FILE: path.join(root, "trace"), FAIL_STEP: "", FAIL_HEALTH: "no",
    HEALTH_RETRIES: "1", HEALTH_SLEEP_SEC: "0",
  };
  const run = (overrides: Record<string, string> = {}) => spawnSync("bash", [path.resolve("scripts/deploy-burnin-production.sh"), sha, "v0.9.0"], { env: { ...env, ...overrides }, encoding: "utf8" });
  return { root, app, deploy, sha, git, run, trace: () => readFileSync(env.TRACE_FILE, "utf8") };
}

describe("production deployment", () => {
  it("builds the checked commit separately, migrates before restart, and keeps server configuration shared", () => {
    const f = fixture();
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    const release = readlinkSync(path.join(f.deploy, "current"));
    expect(release).not.toBe(f.app);
    expect(readFileSync(path.join(release, ".production-commit"), "utf8").trim()).toBe(f.sha);
    expect(readFileSync(path.join(f.app, ".next", "running-build"), "utf8")).toBe("untouched");
    expect(f.git("rev-parse", "HEAD")).not.toBe(f.sha);
    expect(readlinkSync(path.join(release, "config.json"))).toBe(path.join(f.app, "config.json"));
    expect(readlinkSync(path.join(release, "data"))).toBe(path.join(f.app, "data"));
    const trace = f.trace();
    expect(trace.indexOf("npm:run build")).toBeLessThan(trace.indexOf("npm:run migrate"));
    expect(trace.indexOf("npm:run migrate")).toBeLessThan(trace.indexOf("systemctl:restart"));
    expect(result.stdout + result.stderr + trace).not.toContain("canary-secret");
  });
  it.each(["ci", "run build", "run migrate"])("leaves the running application in place when %s fails", step => {
    const f = fixture();
    expect(f.run({ FAIL_STEP: step }).status).not.toBe(0);
    expect(readlinkSync(path.join(f.deploy, "current"))).toBe(f.app);
    expect(f.trace()).not.toContain("systemctl:restart");
    if (step !== "run migrate") expect(f.trace()).not.toContain("npm:run migrate");
  });
  it("restores and restarts the previous release if the new application's health check fails", () => {
    const f = fixture();
    const result = f.run({ FAIL_HEALTH: "yes" });
    expect(result.status).not.toBe(0);
    expect(readlinkSync(path.join(f.deploy, "current"))).toBe(f.app);
    expect(f.trace().match(/systemctl:restart/g)).toHaveLength(2);
    expect(result.stdout).toContain("previous release restored; database migrations remain applied");
  });
  it("rejects a tag moved away from the commit that passed CI", () => {
    const f = fixture();
    f.git("tag", "-fa", "v0.9.0", "-m", "moved tag", "HEAD");
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("tag no longer points to checked commit");
    expect(readlinkSync(path.join(f.deploy, "current"))).toBe(f.app);
  });
  it("requires an annotated release tag", () => {
    const f = fixture();
    f.git("tag", "-d", "v0.9.0");
    f.git("tag", "v0.9.0", f.sha);
    const result = f.run();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("tag is not annotated");
  });
});
