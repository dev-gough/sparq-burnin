// Screenshot and interaction regression checks with local, representative API fixtures.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs";
const out = process.env.OUTPUT_DIR || "/tmp/burnin-mobile-review";
const base = process.env.BASE_URL || "http://127.0.0.1:3100";
assert(
  ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname),
  "Run against a local SKIP_AUTH development server.",
);
fs.mkdirSync(out, { recursive: true });
const points = Array.from({ length: 30 }, (_, i) => ({
  date: `2026-09-${String(i + 1).padStart(2, "0")}`,
  passed: 75 + (i % 9) * 4,
  failed: (i % 7) + 1,
}));
const groups = [
  {
    name: "Electrical",
    count: 60,
    group_color: "#6366f1",
    percentage_all: 6,
    percentage_failed: 60,
  },
  { name: "Thermal", count: 30, group_color: "#f59e0b", percentage_all: 3, percentage_failed: 30 },
];
const categories = [
  {
    name: "Grid undervoltage",
    group_name: "Electrical",
    count: 60,
    percentage_all: 6,
    percentage_failed: 60,
  },
  {
    name: "Overtemperature",
    group_name: "Thermal",
    count: 30,
    percentage_all: 3,
    percentage_failed: 30,
  },
];
const analytics = {
  totalTests: 1000,
  totalFailedTests: 100,
  untaggedFailed: 10,
  testOutcomes: "PPPPPPPPPF".repeat(100),
  groups,
  categories,
  groupTimeline: points.map((p, i) => ({ date: p.date, Electrical: i % 5, Thermal: i % 3 })),
  categoryTimeline: points.map((p, i) => ({
    date: p.date,
    "Grid undervoltage": i % 5,
    Overtemperature: i % 3,
  })),
  failureRateTimeline: points.map((p) => ({
    ...p,
    total: p.passed + p.failed,
    failureRate: (p.failed / (p.passed + p.failed)) * 100,
  })),
};
const names = ["alex.chen@sparqsys.com", "sam.patel@sparqsys.com", "jordan.lee@sparqsys.com"];
const people = names.map((name, i) => ({
  contributor_name: name,
  total_annotations: 320 - i * 35,
  unique_tests_annotated: 190 - i * 17,
  percentage_of_tests: 29 - i * 3,
  last_activity: "2026-10-07T10:00:00Z",
  most_used_group: "Electrical",
  annotation_groups: groups.map((g) => ({
    group_name: g.name,
    count: g.count,
    group_color: g.group_color,
    categories: categories
      .filter((c) => c.group_name === g.name)
      .map((c) => ({ category_name: c.name, count: c.count })),
  })),
}));
const activity = Array.from({ length: 30 }, (_, i) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - i);
  return people.map((p, j) => ({
    date: d.toISOString().slice(0, 10),
    contributor_name: p.contributor_name,
    annotation_count: (i * 3 + j * 7) % 19,
  }));
}).flat();
const tests = Array.from({ length: 5 }, (_, i) => ({
  test_id: i + 1,
  inv_id: i + 1,
  serial_number: `SPARQ-2026-00000${i + 1}`,
  test_count: 3,
  test_number: 3,
  firmware_version: "sparq-quad-v4.2.1-production",
  duration: (4.25 + i) * 3600000,
  start_time: "2026-10-06T10:30:00Z",
  end_time: "2026-10-06T15:30:00Z",
  status: i % 2 ? "PASS" : "FAIL",
  overall_status: i % 2 ? "PASS" : "FAIL",
  failure_reason: i % 2 ? null : "Grid undervoltage during the final burn-in cycle.",
  failure_description: "Grid undervoltage during the final burn-in cycle.",
  annotations: i % 2 ? null : "Grid undervoltage",
  annotation_items: [],
}));
const data_points = Array.from({ length: 80 }, (_, i) => ({
  timestamp: new Date(Date.UTC(2026, 9, 6, 10, 30 + i)).toISOString(),
  vgrid: 230 + Math.sin(i / 7) * 10,
  pgrid: 500 + Math.sin(i / 5) * 60,
  qgrid: 10,
  frequency: 60,
  vbus: 390,
  temperature: 45 + Math.sin(i / 8) * 12,
  ...Object.fromEntries(
    [1, 2, 3, 4].flatMap((n) => [
      [`vpv${n}`, 35 + Math.sin(i / 8) * 2],
      [`ppv${n}`, 120 + Math.sin(i / 8) * 25],
      [`vpv${n}_inst_latch`, 35],
      [`ipv${n}_inst_latch`, 4],
    ]),
  ),
  vgrid_inst_latch: 220,
  vntrl_inst_latch: 1,
  igrid_inst_latch: 4,
  vbus_inst_latch: 390,
}));
const detail = {
  ...tests[0],
  data_points,
  navigation: {
    total_failed_tests: 3,
    current_failure_index: 2,
    previous_failed_test: { test_id: 2, start_time: tests[0].start_time },
    next_failed_test: { test_id: 3, start_time: tests[0].start_time },
  },
};
const station = {
  stationId: "burnin-production-station-01",
  enabled: true,
  reason: null,
  updatedAt: tests[0].start_time,
  updatedBy: names[0],
  revision: 3,
  hasSecret: true,
  hasDbCredential: true,
  credentialRevokedAt: null,
  hiddenAt: null,
  lastIngestAt: tests[0].start_time,
  stats: {
    totalTests: 1200,
    passCount: 1100,
    failCount: 100,
    invalidCount: 0,
    retestCount: 0,
    otherCount: 0,
    uniqueSerials: 500,
    testsLast24h: 23,
    testsLast7d: 140,
    firstIngestAt: tests[0].start_time,
    lastIngestAt: tests[0].start_time,
  },
};
(async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ||
      (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  await page.route("**/api/**", (r) => {
    const u = new URL(r.request().url());
    let body = [];
    if (u.pathname === "/api/auth/session")
      body = { user: { name: "Alex Chen", email: names[0] }, expires: "2099-01-01" };
    else if (u.pathname === "/api/user/failure-rate-prefs") body = { view: "rate", window: 100 };
    else if (u.pathname === "/api/test-report") body = {
      dateRange: { start: "2026-09-01", end: "2026-09-30" },
      totals: { totalTests: 1000, totalPassed: 900, totalFailed: 100, totalInvalid: 0, overallPassRate: 90, overallFailRate: 10 },
      dailyData: [{ date: "2026-09-01", total: 100, passed: 90, failed: 10, invalid: 0, passRate: 90, failRate: 10 }],
    };
    else if (u.pathname === "/api/failed-test-data") return r.fulfill({
      contentType: "application/zip", body: Buffer.from("504b0506000000000000000000000000000000000000", "hex"),
    });
    else if (u.pathname === "/api/todo/count") body = { count: 5 };
    else if (u.pathname === "/api/stations/admin-status") body = { isStationAdmin: true };
    else if (u.pathname === "/api/stations")
      body = {
        stations: [
          station,
          {
            ...station,
            stationId: "burnin-production-station-02",
            enabled: false,
            reason: "Maintenance",
          },
        ],
      };
    else if (u.pathname === "/api/stations/enrollments")
      body = {
        enrollments: [
          {
            id: 1,
            stationId: "pending-station-03",
            status: "pending",
            requestedAt: tests[0].start_time,
            fingerprint: { hostname: "factory-station-03" },
            requestIp: "192.0.2.1",
          },
        ],
      };
    else if (u.pathname === "/api/stations/tokens")
      body = {
        tokens: [
          {
            id: "test-token",
            label: "Factory enrollment",
            createdAt: tests[0].start_time,
            maxUses: 5,
            useCount: 1,
          },
        ],
      };
    else if (u.pathname === "/api/stations/options")
      body = { stations: [{ stationId: station.stationId, alias: "Factory line 1" }] };
    else if (u.pathname === "/api/failure-analytics") body = analytics;
    else if (u.pathname === "/api/contributors")
      body = {
        contributors: people,
        teamStats: {
          total_annotations: 1100,
          total_annotated_tests: 650,
          total_failed_tests: 900,
          coverage_percentage: 72.22,
          active_contributors_week: 3,
          active_contributors_month: 3,
        },
        activity,
      };
    else if (u.pathname === "/api/todo")
      body = {
        tests: tests
          .filter((t) => t.status === "FAIL")
          .map((t) => ({ ...t, duration_hours: t.duration / 3600000 })),
        total_count: 3,
      };
    else if (u.pathname.match(/^\/api\/test\/\d+$/)) body = detail;
    else if (u.pathname === "/api/annotation-groups")
      body = [{ group_id: 1, group_name: "Electrical", group_color: "#6366f1", display_order: 0 }];
    else if (u.pathname === "/api/annotation-quick-options")
      body = [
        {
          option_id: 1,
          option_text: "Grid undervoltage",
          group_id: 1,
          group_name: "Electrical",
          group_color: "#6366f1",
          display_order: 0,
          is_active: true,
        },
      ];
    else if (u.pathname.endsWith("/annotations"))
      body = [
        {
          id: 1,
          test_id: 1,
          annotation_text: "Grid undervoltage during the final burn-in cycle.",
          annotation_type: "quick",
          created_by: names[0],
          created_at: tests[0].start_time,
          group_name: "Electrical",
        },
      ];
    else if (u.pathname === "/api/test-stats") {
      const view = u.searchParams.get("view");
      if (view === "has-data") body = { hasData: true };
      else if (view === "firmware-versions") body = [tests[0].firmware_version];
      else if (view === "summary")
        body = {
          current: { total: 1000, passed: 900, failed: 100, failureRate: 10 },
          previous: { total: 900, passed: 790, failed: 110, failureRate: 12.22 },
          delta: { total: 100, passed: 110, failed: -10, failureRatePp: -2.2 },
          labels: { current: "Last 30 days", previous: "Prior 30 days" },
          failurePercentageOfTotal: 10,
        };
      else if (view === "annotation-summary")
        body = {
          groups: groups.map((g) => ({ ...g, percentageOfFailed: g.percentage_failed })),
          options: categories.map((c) => ({ ...c, percentageOfFailed: c.percentage_failed })),
          untaggedFailed: 10,
          totalFailed: 100,
          range: { from: null, to: null },
        };
      else if (view === "test-outcomes") body = { outcomes: analytics.testOutcomes };
      else if (view === "tests") body = u.searchParams.get("cursor") ? [] : tests;
      else body = points;
    }
    return r.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
  const routes = [
    "/",
    "/contributors",
    "/failure-analytics",
    "/todo",
    "/stations",
    "/settings",
    "/changelog",
    "/test/1",
    "/test-batch-prefetch",
    "/auth/signin",
    "/auth/error?error=AccessDenied",
  ];
  const report = [];
  for (const width of (process.env.WIDTHS || "390,320,768,1440").split(",").map(Number)) {
    await page.setViewportSize({ width, height: width >= 768 ? 1000 : 844 });
    for (const path of routes) {
      await page.goto(base + path);
      await page.waitForTimeout(3000);
      await page.addStyleTag({ content: "nextjs-portal { display: none; }" });
      const name = path === "/" ? "dashboard" : path.split("?")[0].slice(1).replaceAll("/", "-");
      const dims = await page.evaluate(() => ({
        geometry: [...document.querySelectorAll("h1,h2,h3,[data-slot=card],.echarts-for-react")]
          .filter((e) => e.getBoundingClientRect().width > 0)
          .map((e) => {
            const r = e.getBoundingClientRect();
            return {
              tag: e.tagName,
              text: e.tagName.match(/^H/) ? e.textContent : null,
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
            };
          }),
        width: innerWidth,
        scroll: document.documentElement.scrollWidth,
        canvases: [...document.querySelectorAll(".echarts-for-react")].map((e) => ({
          host: e.clientWidth,
          canvas: parseFloat(e.querySelector("canvas")?.style.width),
        })),
      }));
      for (const chart of dims.canvases) {
        assert(chart.host > 0 && chart.canvas === chart.host, `${path}: chart did not resize at ${width}px`);
      }
      report.push({ path, width, ...dims });
      await page.screenshot({ path: `${out}/${width}-${name}.png`, fullPage: true });
      if (path === "/" || path === "/contributors" || path === "/failure-analytics") {
        await page
          .locator("h1")
          .first()
          .evaluate((e) => {
            let node = e;
            while (node && getComputedStyle(node).overflowY !== "auto") node = node.parentElement;
            const scroll = [...document.querySelectorAll("div")].find(
              (el) =>
                getComputedStyle(el).overflowY === "auto" && el.scrollHeight > el.clientHeight,
            );
            if (scroll) scroll.scrollTop = scroll.scrollHeight;
          });
        await page.screenshot({ path: `${out}/${width}-${name}-lower.png`, fullPage: true });
      }
      console.log(path, width, dims.scroll);
      assert(dims.scroll <= width, `${path} overflows at ${width}: ${dims.scroll}`);
    }
  }
  async function shot(name) {
    await page.waitForTimeout(600);
    await page.addStyleTag({ content: "nextjs-portal{display:none}" });
    await page.screenshot({ path: `${out}/${name}.png`, fullPage: false });
  }
  async function fits(selector) {
    await page.waitForTimeout(600);
    const box = await page.locator(selector).filter({ visible: true }).boundingBox();
    assert(
      box && box.x >= -1 && box.x + box.width <= page.viewportSize().width + 1,
      `${selector} outside screen: ${JSON.stringify(box)}`,
    );
  }
  async function drawerFits() {
    await fits(".sidebar-drawer");
    const layout = await page.locator(".sidebar-drawer").evaluate((e) => {
      const r = e.getBoundingClientRect();
      return {
        x: r.x, bottom: r.bottom, height: e.clientHeight, total: e.scrollHeight,
        targets: [...e.querySelectorAll("a,button,[role=combobox]")].map((target) => {
          const b = target.getBoundingClientRect();
          return { text: target.textContent, left: b.left, top: b.top, right: b.right, bottom: b.bottom };
        }),
      };
    });
    assert.equal(layout.x, 0, "Drawer should enter from the left");
    assert(layout.total <= layout.height + 1, `Drawer needs scrolling: ${JSON.stringify(layout)}`);
    for (const target of layout.targets) {
      assert(target.top >= -1 && target.bottom <= page.viewportSize().height + 1 &&
        target.left >= -1 && target.right <= page.viewportSize().width + 1,
        `Drawer control is outside the viewport: ${JSON.stringify(target)}`);
    }
  }
  async function slimNavigation() {
    const layout = await page.locator(".mobile-navigation").evaluate((e) => {
      const links = [...e.querySelectorAll(".drawer-navigation a")].map((link) => {
        const r = link.getBoundingClientRect();
        return { left: r.left, bottom: r.bottom, top: r.top };
      });
      const title = e.querySelector("[data-slot=sheet-title]").getBoundingClientRect();
      const description = e.querySelector("[data-slot=sheet-description]").getBoundingClientRect();
      const avatar = e.querySelector(".drawer-avatar").getBoundingClientRect();
      return {
        width: e.getBoundingClientRect().width, links,
        titleY: title.y + title.height / 2, descriptionY: description.y + description.height / 2,
        avatar: { left: avatar.left, top: avatar.top },
        icons: [...e.querySelectorAll(".drawer-icon-controls button")].map((button) => ({
          border: getComputedStyle(button).borderTopWidth,
          background: getComputedStyle(button).backgroundColor,
        })),
      };
    });
    assert(layout.width >= 180 && layout.width <= 208, `Navigation is too wide: ${layout.width}`);
    assert(Math.abs(layout.titleY - layout.descriptionY) < 1, "Sidebar title and description should share a row");
    for (const link of layout.links) assert.equal(link.left, layout.links[0].left, "Navigation should use one column");
    assert(layout.avatar.top > layout.links.at(-1).bottom && layout.avatar.left <= 10, "Account should sit at bottom left");
    for (const icon of layout.icons) {
      assert.equal(icon.border, "0px", "Preference icons should not have boxes");
      assert.equal(icon.background, "rgba(0, 0, 0, 0)", "Preference icons should be unfilled");
    }
  }
  // Same-day patch notes stay compact while feature releases remain visible.
  for (const width of [320, 412, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.goto(base + "/changelog");
    const patches = page.locator(".changelog-patches").filter({ hasText: "0.9.x patches" });
    const summary = patches.locator("summary");
    assert.equal(await patches.locator("details").getAttribute("open"), null);
    assert.equal(await patches.locator(".changelog-patch-entry:visible").count(), 0);
    assert(await page.getByRole("heading", { name: "v0.9.0 — 2026-10-06", exact: true }).isVisible());
    await summary.scrollIntoViewIfNeeded();
    const closed = await patches.boundingBox();
    assert(closed.height >= 44 && closed.height <= 80, "Four patches should occupy one compact row");
    await shot(`${width}-changelog-patches-closed`);
    await summary.focus();
    await page.keyboard.press("Enter");
    assert.equal(await patches.locator(".changelog-patch-entry:visible").count(), 4);
    await shot(`${width}-changelog-patches-open`);
    assert(await patches.getByRole("heading", { name: "v0.9.4", exact: true }).isVisible());
    await summary.click();
    assert.equal(await patches.locator(".changelog-patch-entry:visible").count(), 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  // The selected date pill travels into the mobile bar and can reopen in place.
  for (const width of [320, 412]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base + "/");
    await page.waitForTimeout(1600);
    const scroll = page.locator(".dashboard-home");
    const panel = page.locator(".mobile-period-panel");
    const summary = page.locator(".mobile-period-summary");
    assert.equal(await panel.getAttribute("data-collapsed"), "false");
    await page.getByRole("radio", { name: "30 days", exact: true }).click();
    await scroll.evaluate((e) => { e.scrollTop = 220; });
    await page.locator('.mobile-period-panel[data-collapsed="true"]').waitFor({ state: "attached" });
    if (width === 412) {
      await page.waitForTimeout(100);
      await page.screenshot({ path: `${out}/${width}-dates-folding.png` });
    }
    await page.waitForTimeout(420);
    const pill = await summary.boundingBox();
    assert(pill && pill.y >= 0 && pill.y + pill.height <= 56, "Selected range should fit in the fixed header");
    assert(pill.width >= 84, "Header badge should have a generous width");
    const painted = panel.locator('[aria-checked="true"]');
    const paintedBox = await painted.boundingBox();
    assert(Math.abs(paintedBox.x - pill.x) < 1 && Math.abs(paintedBox.width - pill.width) < 1,
      "The animated pill should remain aligned with its header tap target");
    assert.equal(await painted.evaluate((e) => getComputedStyle(e).opacity), "1",
      "The selected pill should remain visible after the animation finishes");
    await page.waitForTimeout(180);
    assert.equal(await painted.evaluate((e) => getComputedStyle(e).opacity), "1");
    assert.equal(await summary.getAttribute("aria-expanded"), "false");
    assert.equal(await page.getByRole("radio", { name: "30 days", exact: true }).count(), 0, "Folded controls should not be focusable");
    await shot(`${width}-dates-folded`);
    const top = await scroll.evaluate((e) => e.scrollTop);
    await summary.click();
    await page.locator('.mobile-period-panel[data-collapsed="false"]').waitFor({ state: "attached" });
    if (width === 412) {
      await page.waitForTimeout(100);
      await page.screenshot({ path: `${out}/${width}-dates-unfolding.png` });
    }
    await page.waitForTimeout(420);
    assert.equal(await scroll.evaluate((e) => e.scrollTop), top, "Expanding dates should not jump the page");
    assert(await page.getByRole("radio", { name: "30 days", exact: true }).evaluate((e) => document.activeElement === e));
    await shot(`${width}-dates-expanded-scrolled`);
    await scroll.evaluate((e) => { e.scrollTop += 10; });
    await page.waitForTimeout(100);
    assert.equal(await panel.getAttribute("data-collapsed"), "false", "A small scroll should not immediately dismiss the row");
    for (const [label, short] of [["7 days", "7d"], ["90 days", "90d"], ["All time", "All"]]) {
      if (await panel.getAttribute("data-collapsed") === "true") await summary.click();
      await page.waitForTimeout(420);
      await page.getByRole("radio", { name: label, exact: true }).click();
      await page.locator('.mobile-period-panel[data-collapsed="true"]').waitFor({ state: "attached" });
      await page.waitForTimeout(420);
      assert.equal((await summary.textContent()).trim(), short, "Header should retain the selected period");
    }
    await summary.click();
    await page.waitForTimeout(420);
    await page.getByRole("radio", { name: "Custom date range", exact: true }).click();
    await fits("[data-slot=popover-content]");
    await scroll.evaluate((e) => { e.scrollTop += 100; });
    await page.waitForTimeout(100);
    assert.equal(await panel.getAttribute("data-collapsed"), "false", "Date picker should keep its anchor expanded");
    await page.locator("[data-slot=popover-content]").getByRole("button", { name: "6 months", exact: true }).click();
    await page.waitForTimeout(1000);
    assert.equal(await panel.getAttribute("data-collapsed"), "true");
    assert.equal((await summary.textContent()).trim(), "Custom");
    assert((await summary.getAttribute("aria-label")).includes("Custom date range:"));
    await shot(`${width}-dates-custom-folded`);
    await summary.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(420);
    assert.equal(await panel.getAttribute("data-collapsed"), "false");
    assert.equal(await page.locator("[data-slot=popover-content]").count(), 0, "Expanding a Custom pill should open the row first");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(420);
    assert.equal(await panel.getAttribute("data-collapsed"), "true");
    assert(await summary.evaluate((e) => document.activeElement === e));
    await scroll.evaluate((e) => { e.scrollTop = 0; });
    await page.waitForTimeout(420);
    assert.equal(await panel.getAttribute("data-collapsed"), "false", "Returning to the top should reopen dates");
    await shot(`${width}-dates-returned-to-top`);
    await scroll.evaluate((e) => { e.scrollTop = 180; });
    await page.waitForTimeout(60);
    await scroll.evaluate((e) => { e.scrollTop = 0; });
    await page.waitForTimeout(60);
    await scroll.evaluate((e) => { e.scrollTop = 180; });
    await page.waitForTimeout(420);
    assert.equal(await panel.getAttribute("data-collapsed"), "true", "Rapid direction changes should settle cleanly");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await summary.evaluate((e) => getComputedStyle(e).transitionDuration), "0s");
    await summary.click();
    await page.waitForTimeout(100);
    assert.equal(await panel.getAttribute("data-collapsed"), "false");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForTimeout(300);
    assert.equal(await page.locator(".mobile-period-panel").count(), 0, "Desktop should retain its original date controls");
    assert(await page.getByRole("radio", { name: "Custom date range", exact: true }).isVisible());
  }
  // Search stays full width; all other phone controls share one dropdown row.
  const stationFixture = (r) => r.fulfill({ contentType: "application/json",
    body: JSON.stringify({ stations: [station.stationId] }) });
  await page.route("**/api/stations/options", stationFixture);
  for (const width of [320, 390, 412]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base + "/");
    await page.waitForTimeout(1600);
    await page.locator("#serial-search").scrollIntoViewIfNeeded();
    const row = page.locator(".table-filter-row");
    const buttons = row.locator("button:visible");
    assert.equal(await buttons.count(), 5);
    const boxes = await buttons.evaluateAll((es) => es.map((e) => {
      const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right };
    }));
    assert(boxes.every((b) => Math.abs(b.y - boxes[0].y) < 1 && b.height >= 44 && b.right <= width),
      "Five touch-sized filter dropdowns should fit on one row");
    const searchBox = await page.locator("#serial-search").boundingBox();
    const rowBox = await row.boundingBox();
    assert(Math.abs(searchBox.width - rowBox.width) < 1, "Serial search should remain full width");
    await shot(`${width}-compact-table-filters`);
    const result = row.getByRole("combobox", { name: "Filter by result" });
    await result.click();
    await fits("[data-slot=select-content]");
    await page.getByRole("option", { name: "Failed", exact: true }).click();
    assert.equal(await result.getAttribute("data-active"), "true");
    await row.getByRole("combobox", { name: "Category or note" }).click();
    await fits("[data-slot=select-content]");
    await page.getByRole("option", { name: "Tagged tests (any annotation)", exact: true }).click();
    assert.equal(await row.getByRole("combobox", { name: "Category or note" }).getAttribute("data-active"), "true");
    await row.getByRole("combobox", { name: "Firmware version" }).click();
    await fits("[data-slot=select-content]");
    await page.getByRole("option", { name: tests[0].firmware_version, exact: true }).click();
    await row.getByRole("combobox", { name: "Test station" }).click();
    await fits("[data-slot=select-content]");
    await page.getByRole("option", { name: station.stationId, exact: true }).click();
    await page.getByRole("button", { name: "Table options", exact: true }).click();
    const options = page.locator(".mobile-table-options");
    await fits(".mobile-table-options");
    const mode = options.getByRole("switch", { name: /One row per inverter/ });
    const previous = await mode.getAttribute("aria-checked");
    await mode.click();
    assert.notEqual(await mode.getAttribute("aria-checked"), previous);
    const link = options.getByRole("switch", { name: /Dates/ });
    const linked = await link.getAttribute("aria-checked");
    await link.click();
    assert.notEqual(await link.getAttribute("aria-checked"), linked);
    if (await link.getAttribute("aria-checked") === "true") await link.click();
    await shot(`${width}-table-options`);
    await options.getByRole("button", { name: /date range/i }).click();
    await fits("[data-slot=popover-content]:not(.mobile-table-options)");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Clear all", exact: true }).click();
    await page.locator("#serial-search").fill("SPARQ*");
    assert.equal(await page.locator("#serial-search").inputValue(), "SPARQ*");
    await page.getByRole("button", { name: "Clear serial search" }).click();
  }
  await page.unroute("**/api/stations/options", stationFixture);
  // The clock stays icon-only while its accessible label follows the chosen timezone.
  await page.setViewportSize({ width: 412, height: 915 });
  await page.goto(base + "/");
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("combobox", { name: "Display timezone: Local Time", exact: true }).click();
  await page.getByRole("option").filter({ hasText: "Coordinated Universal Time" }).click();
  await page.getByRole("combobox", { name: "Display timezone: UTC", exact: true }).waitFor({ state: "visible" });
  const timezoneText = await page.locator(".timezone-icon [data-slot=select-value]").evaluate((e) => {
    const r = e.parentElement.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  assert(timezoneText.width <= 1 && timezoneText.height <= 1, "Clock trigger should not show timezone text");
  await page.getByRole("combobox", { name: "Display timezone: UTC", exact: true }).click();
  await page.getByRole("option").filter({ hasText: "Your browser timezone" }).click();
  await page.getByRole("button", { name: "Sign Out", exact: true }).waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  // Check short portrait and landscape screens, including resizing an open drawer.
  for (const [width, height] of [[320, 568], [320, 480], [360, 640], [384, 824], [412, 915], [568, 320], [667, 375], [740, 360]]) {
    await page.setViewportSize({ width, height });
    await page.goto(base + "/");
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await drawerFits();
    await slimNavigation();
    await shot(`${width}x${height}-left-navigation`);
    await page.setViewportSize({ width, height: Math.max(320, height - 100) });
    await drawerFits();
    await slimNavigation();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await drawerFits();
    await shot(`${width}x${height}-download-drawer`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
  // Mobile chrome must leave room for the dashboard and scroll out of the way.
  for (const width of [412, 384, 320]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto(base + "/");
    await page.waitForTimeout(2000);
    const chrome = await page.evaluate(() => {
      const header = document.querySelector(".dashboard-page-header").getBoundingClientRect();
      return {
        bottom: header.bottom,
        buttons: [...document.querySelectorAll(".header-period-button")].map((e) => {
          const r = e.getBoundingClientRect();
          return { width: r.width, height: r.height };
        }),
      };
    });
    assert(chrome.bottom <= 120, `Dashboard chrome uses ${chrome.bottom}px at ${width}px`);
    assert.equal(chrome.buttons.length, 5);
    for (const button of chrome.buttons) {
      assert.equal(button.height, 44);
      assert(Math.abs(button.width - chrome.buttons[0].width) < 1, "Period buttons differ in width");
    }
    for (const name of ["Open navigation", "Export"]) {
      const target = await page.getByRole("button", { name, exact: true }).boundingBox();
      assert(target && target.width >= 44 && target.height >= 44, `${name} is too small`);
    }
    assert.equal(await page.getByRole("button", { name: "More options" }).count(), 0);
    const hamburger = await page.getByRole("button", { name: "Open navigation" }).boundingBox();
    const download = await page.getByRole("button", { name: "Export", exact: true }).boundingBox();
    const logo = await page.getByRole("link", { name: "BurnIn home" }).boundingBox();
    assert(hamburger.x < download.x && download.x < logo.x, "Mobile header order is incorrect");
    await page.getByRole("radio", { name: "All time", exact: true }).click();
    await page.waitForTimeout(600);
    const note = await page.getByRole("note").boundingBox();
    assert(note && note.height === 20 && note.width > width - 40, "Comparison note must span one full-width line");
    await shot(`${width}-all-time-comparison`);
    await page.getByRole("radio", { name: "30 days", exact: true }).click();
    await shot(`${width}-compact-dashboard`);
    await page.locator(".dashboard-home").evaluate((e) => { e.scrollTop = 350; });
    assert(await page.locator(".dashboard-page-header").evaluate((e) => e.getBoundingClientRect().bottom <= 56));
    assert(await page.getByRole("button", { name: "Open navigation" }).isVisible());
    await shot(`${width}-dashboard-scrolled`);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await fits(".mobile-navigation");
    const menu = await page.locator(".mobile-navigation").evaluate((e) => ({
      height: e.clientHeight, scrollHeight: e.scrollHeight,
      animationMs: parseFloat(getComputedStyle(e).animationDuration) * 1000,
    }));
    assert(menu.scrollHeight <= menu.height + 1, `Navigation needs scrolling at ${width}px: ${JSON.stringify(menu)}`);
    assert(menu.animationMs <= 180, "Navigation animation is too slow");
    await shot(`${width}-compact-navigation`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.getByRole("button", { name: "Open navigation" }).click();
    assert.equal(await page.locator(".mobile-navigation").evaluate((e) => getComputedStyle(e).animationName), "none");
    await page.keyboard.press("Escape");
    await page.emulateMedia({ reducedMotion: "no-preference" });
  }
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(base + "/");
    await page.waitForTimeout(2000);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.getByRole("dialog").waitFor();
    await fits("[role=dialog]");
    await shot(`${width}-navigation`);
    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await page.getByRole("heading", { name: "Settings", exact: true }).first().waitFor();
    await page.waitForTimeout(400);
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    assert.equal(await page.getByRole("dialog").count(), 0);
    await page.goto(base + "/");
    await page.waitForTimeout(1600);
    await page.getByRole("radio", { name: "Custom date range", exact: true }).click();
    await fits("[data-slot=popover-content]");
    await shot(`${width}-date-picker`);
    await page.locator("[data-slot=popover-content]").getByRole("button", { name: "6 months", exact: true }).click();
    await page.waitForTimeout(700);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await drawerFits();
    assert(await page.getByRole("button", { name: "Test report (CSV)", exact: true }).isDisabled());
    assert(await page.getByRole("button", { name: "Failed test data (ZIP)", exact: true }).isDisabled());
    await shot(`${width}-custom-range-downloads`);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    await page.getByRole("radio", { name: "30 days", exact: true }).click();
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await drawerFits();
    await shot(`${width}-dashboard-downloads`);
    const csvDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Test report (CSV)", exact: true }).click();
    const csv = await csvDownload;
    assert(csv.suggestedFilename().endsWith(".csv"));
    await csv.saveAs(`${out}/${width}-test-report.csv`);
    assert(fs.readFileSync(`${out}/${width}-test-report.csv`, "utf8").includes("Total Tests: 1000"));
    const zipDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "Failed test data (ZIP)", exact: true }).click();
    const zip = await zipDownload;
    assert(zip.suggestedFilename().endsWith(".zip"));
    await zip.saveAs(`${out}/${width}-failed-tests.zip`);
    assert.equal(fs.readFileSync(`${out}/${width}-failed-tests.zip`).subarray(0, 2).toString(), "PK");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page.getByRole("radio", { name: "By test count", exact: true }).click();
    await page.getByRole("combobox", { name: "Rolling test window" }).waitFor();
    await shot(`${width}-dashboard-charts`);
    await page.goto(base + "/test/1");
    await page.waitForTimeout(3000);
    await page.getByTitle("Open in full screen", { exact: true }).first().click();
    await page.getByRole("heading", { name: "PV Data — Full Screen" }).waitFor();
    await shot(`${width}-test-fullscreen`);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    assert.equal(await page.getByRole("heading", { name: "PV Data — Full Screen" }).count(), 0);
    await page.getByRole("button", { name: "Hide annotations", exact: true }).click();
    assert(await page.locator("#test-annotations-panel").isHidden());
    await page.getByRole("button", { name: "Show annotations", exact: true }).click();
    assert(await page.locator("#test-annotations-panel").isVisible());
    await page.getByRole("button", { name: "History", exact: false }).click();
    await fits("[data-slot=popover-content]");
    await shot(`${width}-status-history`);
    await page.keyboard.press("Escape");
    await page.locator("#test-annotations-panel").scrollIntoViewIfNeeded();
    await page.getByRole("button", { name: "Add Custom Note" }).click();
    await shot(`${width}-annotation-editor`);
    for (const path of ["/", "/contributors", "/failure-analytics"]) {
      await page.goto(base + path);
      await page.waitForTimeout(2200);
      const scrolls = await page.evaluate(() => {
        const e = [...document.querySelectorAll("div")].find(
          (e) => getComputedStyle(e).overflowY === "auto" && e.scrollHeight > e.clientHeight,
        );
        return e ? { height: e.clientHeight, total: e.scrollHeight } : null;
      });
      if (scrolls) {
        let i = 0;
        for (let top = 0; top < scrolls.total; top += Math.max(100, scrolls.height * 0.8)) {
          await page.evaluate((top) => {
            const e = [...document.querySelectorAll("div")].find(
              (e) => getComputedStyle(e).overflowY === "auto" && e.scrollHeight > e.clientHeight,
            );
            e.scrollTop = top;
          }, top);
          await shot(`${width}-${path === "/" ? "dashboard" : path.slice(1)}-section-${i++}`);
        }
      }
    }
  }
  await page.setViewportSize({ width: 667, height: 375 });
  await page.goto(base + "/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await shot("landscape-navigation");
  await drawerFits();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByTitle("Light mode", { exact: true }).click();
  await page.keyboard.press("Escape");
  await shot("390-dashboard-light");
  await page.locator(".dashboard-home").evaluate((e) => { e.scrollTop = 220; });
  await page.locator('.mobile-period-panel[data-collapsed="true"]').waitFor({ state: "attached" });
  await page.waitForTimeout(420);
  const lightPill = page.locator('.mobile-period-panel [aria-checked="true"]');
  assert.equal(await lightPill.evaluate((e) => getComputedStyle(e).opacity), "1");
  await shot("390-dates-folded-light");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole("dialog").count(), 0);

  fs.writeFileSync(`${out}/layout-report.json`, JSON.stringify({ report, errors }, null, 2));
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log(
    `Passed ${report.length} route/viewport checks and mobile interactions. Screenshots: ${out}`,
  );
  await browser.close();
})();
