// Local browser checks with representative API fixtures; no production writes.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
const base = process.env.BASE_URL || "http://localhost:3100";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const out = "/tmp/burnin-yield-review";
fs.mkdirSync(out, { recursive: true });
const runs = ["FAIL", "RETEST", "PASS"].map((status, index) => ({
  id: index + 1, status, start: `2026-09-0${index + 1}T01:00:00Z`,
  hours: index === 1 ? 0.5 : 2, firmware: "0.10.5", station: "MFG-01",
}));
const data = {
  summary: { units: 1000, firstPass: 850, latestPass: 960, repeated: 180,
    recovered: 120, unresolved: 35, pending: 5, firstNondecisive: 10,
    repeatRuns: 220, repeatHours: 375.5, missingDurations: 2 },
  timeline: Array.from({ length: 9 }, (_, i) => ({ month: `2026-0${i + 1}`, units: 100 + i * 2, firstPass: 85 + i, latestPass: 95 + i })),
  units: [{ serial: "SPARQ-190825180351", firstDate: runs[0].start, firstStatus: "FAIL", latestStatus: "PASS", attempts: 3, repeatHours: 2.5, missingDurations: 0, outcome: "recovered", history: runs }],
  matchingUnits: 30, page: 1, pageSize: 25, asOf: "2026-10-09T12:00:00Z",
};
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
try {
  for (const [name, width, height, theme] of [["desktop-dark", 1440, 1000, "dark"], ["desktop-light", 1440, 1000, "light"], ["mobile", 390, 844, "light"], ["mobile-small", 320, 740, "dark"]]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    let fail = false;
    let empty = false;
    const requests = [];
    await page.route("**/api/yield-retest?*", route => {
      const params = new URL(route.request().url()).searchParams;
      requests.push(params);
      const result = structuredClone(data);
      result.page = Number(params.get("page"));
      if (empty) {
        result.summary = Object.fromEntries(Object.keys(result.summary).map(k => [k, 0]));
        result.units = []; result.timeline = []; result.matchingUnits = 0;
      }
      return route.fulfill({ status: fail ? 500 : 200, contentType: "application/json", body: JSON.stringify(result) });
    });
    await page.route("**/api/todo/count", route => route.fulfill({ json: { count: 3 } }));
    await page.route("**/api/stations/admin-status", route => route.fulfill({ json: { isStationAdmin: false } }));
    await page.goto(`${base}/yield-retest`);
    await page.getByText("85.0%", { exact: true }).first().waitFor();
    await page.locator("summary").filter({ hasText: "SPARQ-190825180351" }).click();
    assert.equal(await page.locator('a[href="/test/3"]').count(), 1);
    await page.screenshot({ path: `${out}/${name}-history.png` });
    await page.locator(".yield-home").evaluate(element => { element.scrollTop = 0; });
    await page.screenshot({ path: `${out}/${name}.png` });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${name} overflow`);
    await Promise.all([page.waitForResponse(r => r.url().includes("scope=recovered")), page.getByRole("button", { name: "Passed after repeat", exact: true }).click()]);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByText("Page 2 of 2", { exact: false }).waitFor();
    await Promise.all([page.waitForResponse(r => r.url().includes("serial=180351")), page.getByRole("textbox", { name: "Search serial number" }).fill("180351")]);
    assert.equal(requests.at(-1).get("page"), "1");
    fail = true;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Couldn’t load this view" }).waitFor();
    assert.equal(await page.getByText("85.0%", { exact: true }).count(), 0);
    fail = false;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByText("85.0%", { exact: true }).first().waitFor();
    empty = true;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByText("No units entered burn-in in this period", { exact: true }).waitFor();
    assert.deepEqual(errors, [], `${name} runtime errors`);
    await context.close();
    console.log(`${name}: layout, histories, filters, pagination, search, retry and empty state passed`);
  }
} finally { await browser.close(); }
