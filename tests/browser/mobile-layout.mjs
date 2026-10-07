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
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: "More options" }).click();
    await fits("[role=dialog]");
    await shot(`${width}-dashboard-options`);
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
  assert(await page.getByRole("dialog").evaluate((e) => e.scrollHeight > e.clientHeight));
  await page.getByRole("dialog").evaluate((e) => (e.scrollTop = e.scrollHeight));
  await shot("landscape-navigation-bottom");
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/");
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByTitle("Light mode", { exact: true }).click();
  await page.keyboard.press("Escape");
  await shot("390-dashboard-light");
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
