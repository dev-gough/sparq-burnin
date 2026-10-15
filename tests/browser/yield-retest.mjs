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
  previous: { units: 940, firstPass: 780 },
  daily: Array.from({ length: 30 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, newUnits: 30 + (i % 7) * 3, newPass: 26 + (i % 7) * 3, repeatRuns: i % 4, hours: 70, repeatHours: (i % 4) * 2 })),
  period: { from: "2026-09-01", to: "2026-09-30" },
  repeatReasons: [{ status: "PASS", units: 90 }, { status: "RETEST", units: 60 }, { status: "FAIL", units: 30 }],
  clearing: { recoveredUnits: 120, recoveredMedianHours: 7.4, recoveredP90Hours: 80.1, firstPassMedianHours: 2, heldUp: 40, heldUpMedianAgeHours: 381 },
  units: [{ serial: "SPARQ-190825180351", firstDate: runs[0].start, firstStatus: "FAIL", latestStatus: "PASS", attempts: 3, repeatHours: 2.5, missingDurations: 0, outcome: "recovered", history: runs }],
  matchingUnits: 30, page: 1, pageSize: 25, asOf: "2026-10-09T12:00:00Z",
};
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", args: ["--no-sandbox"] });
try {
  for (const [name, width, height, theme] of [["desktop-dark", 2560, 1200, "dark"], ["desktop-light", 1440, 1000, "light"], ["mobile", 390, 844, "light"], ["mobile-small", 320, 740, "dark"]]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: theme });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.addInitScript(theme => localStorage.setItem("theme", theme), theme);
    let fail = false;
    let empty = false;
    let hold = false;
    let release;
    let responseDelay = 0;
    const requests = [];
    await page.route("**/api/yield-retest?*", async route => {
      const params = new URL(route.request().url()).searchParams;
      requests.push(params);
      if (hold) await new Promise(resolve => { release = resolve; });
      if (responseDelay) await new Promise(resolve => setTimeout(resolve, responseDelay));
      const result = structuredClone(data);
      result.page = Number(params.get("page"));
      if (empty) {
        result.summary = Object.fromEntries(Object.keys(result.summary).map(k => [k, 0]));
        result.units = []; result.daily = []; result.repeatReasons = []; result.matchingUnits = 0; result.previous = null;
        result.clearing = { recoveredUnits: 0, recoveredMedianHours: null, recoveredP90Hours: null, firstPassMedianHours: null, heldUp: 0, heldUpMedianAgeHours: null };
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
    if (width > 1600) {
      const content = await page.locator(".yield-content").boundingBox();
      assert(content.width > 2400, "Yield content should use the available desktop width");
    }
    await page.locator('summary').filter({ hasText: "How to read these numbers" }).click();
    await page.locator("[data-yield-overview]").evaluate(element => { window.__yieldOverview = element; });
    await page.locator("#yield-serial").evaluate(element => { window.__yieldSearch = element; });
    hold = true;
    await Promise.all([page.waitForRequest(r => r.url().includes("scope=all")), page.getByRole("button", { name: "All units", exact: true }).click()]);
    await page.getByText("Updating unit results…", { exact: true }).waitFor();
    assert.equal(await page.getByRole("status", { name: "Loading yield and retest" }).count(), 0);
    assert(await page.locator("[data-yield-overview]").evaluate(element => element === window.__yieldOverview));
    assert(await page.locator("#yield-serial").evaluate(element => element === window.__yieldSearch));
    assert.equal(await page.locator("details").filter({ hasText: "How to read these numbers" }).getAttribute("open"), "");
    assert.equal(await page.locator("details").filter({ has: page.locator('summary', { hasText: "SPARQ-190825180351" }) }).getAttribute("open"), "");
    assert(await page.getByRole("button", { name: "Next", exact: true }).isDisabled());
    const scrollSelector = width < 768 ? ".yield-home" : ".yield-home main";
    const scrollBefore = await page.locator(scrollSelector).evaluate(element => element.scrollTop);
    hold = false;
    release();
    await page.getByRole("button", { name: "Next", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[data-yield-units]')?.getAttribute('aria-busy') === 'false');
    const scrollAfter = await page.locator(scrollSelector).evaluate(element => element.scrollTop);
    assert(Math.abs(scrollAfter - scrollBefore) < 2, "Updating the unit list must preserve scroll position");
    // Slow requests must leave typing focused; a superseded search must not
    // overwrite the final search or collapse the existing overview.
    responseDelay = 600;
    await page.getByRole("textbox", { name: "Search serial number" }).fill("180");
    await page.waitForRequest(r => r.url().includes("serial=180"));
    assert(await page.locator("#yield-serial").evaluate(element => element === document.activeElement));
    await Promise.all([page.waitForResponse(r => r.url().includes("serial=180351")), page.getByRole("textbox", { name: "Search serial number" }).fill("180351")]);
    await page.waitForFunction(() => document.querySelector('[data-yield-units]')?.getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator("#yield-serial").inputValue(), "180351");
    assert(await page.locator("#yield-serial").evaluate(element => element === document.activeElement));
    responseDelay = 0;
    await Promise.all([page.waitForResponse(r => r.url().includes("serial=&")), page.getByRole("textbox", { name: "Search serial number" }).fill("")]);
    await Promise.all([page.waitForResponse(r => r.url().includes("scope=recovered")), page.getByRole("button", { name: "Passed after repeat", exact: true }).click()]);
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await page.getByText("Page 2 of 2", { exact: false }).waitFor();
    await Promise.all([page.waitForResponse(r => r.url().includes("serial=180351")), page.getByRole("textbox", { name: "Search serial number" }).fill("180351")]);
    assert.equal(requests.at(-1).get("page"), "1");
    // A reason under "Why units ran again" filters the unit list to those repeats.
    await page.getByRole("textbox", { name: "Search serial number" }).fill("");
    await Promise.all([page.waitForResponse(r => r.url().includes("first=RETEST") && r.url().includes("scope=repeat")), page.getByRole("button", { name: /^Marked RETEST/ }).click()]);
    await page.getByRole("button", { name: "Clear filter: Marked RETEST" }).waitFor();
    if (name === "desktop-light") await page.screenshot({ path: `${out}/${name}-reason-filter.png` });
    await Promise.all([page.waitForResponse(r => r.url().includes("scope=repeat") && !r.url().includes("first=")), page.getByRole("button", { name: "Clear filter: Marked RETEST" }).click()]);
    fail = true;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Couldn’t update this view" }).waitFor();
    assert(await page.getByText("85.0%", { exact: true }).first().isVisible());
    assert(await page.locator("[data-yield-overview]").evaluate(element => element === window.__yieldOverview));
    fail = false;
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await page.getByText("85.0%", { exact: true }).first().waitFor();
    // Position within the scrolled content, so scrolling itself does not count as a shift.
    const overviewTop = async () => page.locator("[data-yield-overview]").evaluate(element => {
      const content = element.closest(".yield-content");
      return element.getBoundingClientRect().top - content.getBoundingClientRect().top;
    });
    const topBefore = await overviewTop();
    hold = true;
    await Promise.all([page.waitForRequest(r => r.url().includes("timeRange=all")), page.getByRole("radio", { name: "All time", exact: true }).click()]);
    await page.getByRole("status").filter({ hasText: "Updating the period…" }).waitFor({ state: "attached" });
    // Changing the period must not push the overview down while results load.
    assert(Math.abs(await overviewTop() - topBefore) < 1, "Changing the period must not shift the overview");
    assert(await page.locator("[data-yield-overview]").evaluate(element => element === window.__yieldOverview));
    hold = false;
    release();
    await page.waitForFunction(() => document.querySelector('[data-yield-units]')?.getAttribute('aria-busy') === 'false');
    empty = true;
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByText("No units entered burn-in in this period", { exact: true }).waitFor();
    assert.deepEqual(errors, [], `${name} runtime errors`);
    await context.close();
    console.log(`${name}: layout, histories, filters, pagination, search, retry and empty state passed`);
  }
  const context = await browser.newContext({ viewport: { width: 320, height: 568 } });
  const page = await context.newPage();
  await page.route("**/api/yield-retest?*", route => route.fulfill({ json: data }));
  await page.route("**/api/stations/admin-status", route => route.fulfill({ json: { isStationAdmin: true } }));
  await page.route("**/api/todo/count", route => route.fulfill({ json: { count: 5 } }));
  await page.goto(`${base}/yield-retest`);
  await page.getByText("85.0%", { exact: true }).first().waitFor();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Stations", exact: true }).waitFor();
  for (const [width, height] of [[320,568], [320,468], [320,380], [568,320], [667,375], [740,360]]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(200);
    const fits = await page.locator(".mobile-navigation").evaluate(element => {
      return element.scrollHeight <= element.clientHeight + 1 && [...element.querySelectorAll("a,button,[role=combobox]")].every(control => {
        const box = control.getBoundingClientRect();
        return box.top >= -1 && box.bottom <= innerHeight + 1 && box.left >= -1 && box.right <= innerWidth + 1;
      });
    });
    assert(fits, `Navigation must fit at ${width}x${height}`);
  }
  await context.close();
  console.log("Short portrait and landscape navigation passed with station-admin links");
} finally { await browser.close(); }
