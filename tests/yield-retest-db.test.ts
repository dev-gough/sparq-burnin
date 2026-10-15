// Opt-in real PostgreSQL checks. Only temporary tables are written; the supplied
// database is used as a connection target, never as a fixture store.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "pg";
import { buildYieldQuery, type YieldData } from "@/lib/yield-retest";

const enabled = !!process.env.YIELD_TEST_DATABASE;
describe.skipIf(!enabled)("yield cohorts against PostgreSQL", () => {
  let client: Client;
  beforeAll(async () => {
    const config = JSON.parse(readFileSync("config.json", "utf8")).database;
    client = new Client({ ...config, database: process.env.YIELD_TEST_DATABASE });
    await client.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL timezone = 'Asia/Kolkata'");
    await client.query(`CREATE TEMP TABLE Inverters (inv_id int PRIMARY KEY, serial_number text);
      CREATE TEMP TABLE Tests (test_id int PRIMARY KEY, inv_id int, start_time_utc timestamptz,
      end_time timestamptz, overall_status text, firmware_version text, station_id text);
      INSERT INTO Inverters VALUES (1,'FIRST'),(2,'RECOVER'),(3,'STILL-FAIL'),(4,'PENDING'),
        (5,'REGRESS'),(6,'OLD'),(7,'INVALID-RECOVER'),(8,'TIE'),(9,'BAD-DURATION');
      INSERT INTO Tests (test_id,inv_id,start_time_utc,end_time,overall_status) VALUES
        (1,1,'2026-09-01T00:00Z','2026-09-01T02:00Z','PASS'),
        (2,2,'2026-09-02T00:00Z','2026-09-02T01:00Z','FAIL'),
        (3,2,'2026-09-03T00:00Z','2026-09-03T00:30Z','RETEST'),
        (4,2,'2026-10-05T00:00Z','2026-10-05T02:00Z','PASS'),
        (5,3,'2026-09-03T00:00Z','2026-09-03T01:00Z','FAIL'),
        (6,3,'2026-09-04T00:00Z','2026-09-04T01:00Z','FAIL'),
        (7,4,'2026-09-30T23:59:59Z','2026-10-01T01:59:59Z','INVALID'),
        (8,5,'2026-09-05T00:00Z','2026-09-05T02:00Z','PASS'),
        (9,5,'2026-09-06T00:00Z','2026-09-06T01:00Z','FAIL'),
        (10,6,'2026-08-01T00:00Z','2026-08-01T01:00Z','FAIL'),
        (11,6,'2026-09-05T00:00Z','2026-09-05T02:00Z','PASS'),
        (12,7,'2026-09-06T00:00Z','2026-09-06T00:30Z','INVALID'),
        (13,7,'2026-09-07T00:00Z','2026-09-07T02:00Z','PASS'),
        (14,8,'2026-09-08T00:00Z','2026-09-08T01:00Z','FAIL'),
        (15,8,'2026-09-08T00:00Z','2026-09-08T02:00Z','PASS'),
        (16,8,'2026-09-09T00:00Z','2026-09-09T00:30Z','RETEST'),
        (17,9,'2026-09-10T00:00Z','2026-09-10T01:00Z','FAIL'),
        (18,9,'2026-09-11T00:00Z','2026-09-10T01:00Z','FAIL');`);
  });
  afterAll(async () => { if (client) { await client.query("ROLLBACK"); await client.end(); } });
  async function load(extra = ""): Promise<YieldData> {
    const q = buildYieldQuery(new URLSearchParams(`timeRange=all&dateFrom=2026-09-01&dateTo=2026-09-30&${extra}`));
    return (await client.query(q.sql, q.values)).rows[0].data;
  }
  it("keeps the cohort stable, includes later recovery, and uses UTC bounds", async () => {
    const d = await load("scope=all");
    expect(d.summary).toEqual({ units: 8, firstPass: 2, latestPass: 4, repeated: 6,
      recovered: 3, unresolved: 3, pending: 1, firstNondecisive: 2,
      repeatRuns: 8, repeatHours: 9, missingDurations: 1 });
    expect(d.units.some(u => u.serial === "OLD")).toBe(false);
    expect(d.units.find(u => u.serial === "RECOVER")?.history.map(r => r.status)).toEqual(["FAIL", "RETEST", "PASS"]);
    expect(d.units.find(u => u.serial === "TIE")?.latestStatus).toBe("PASS");
    expect(d.units.find(u => u.serial === "REGRESS")?.outcome).toBe("unresolved");
    expect(d.period).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    // OLD began on Aug 1, outside the 30 days before September.
    expect(d.previous).toEqual({ units: 0, firstPass: 0 });
    expect(d.repeatReasons).toEqual([{ status: "FAIL", units: 4 }, { status: "INVALID", units: 1 }, { status: "PASS", units: 1 }]);
    expect(d.clearing).toMatchObject({ recoveredUnits: 3, recoveredMedianHours: 26, firstPassMedianHours: 2, heldUp: 4 });
  });
  it("counts runs by the day they started, splitting new units from repeats", async () => {
    const d = await load("scope=all");
    // REGRESS's first run and OLD's second run both started on Sep 5.
    expect(d.daily.find(day => day.day === "2026-09-05")).toEqual({ day: "2026-09-05", newUnits: 1, newPass: 1, repeatRuns: 1, hours: 4, repeatHours: 2 });
    // RECOVER's passing run on Oct 5 is outside the period's runs.
    expect(d.daily.some(day => day.day === "2026-10-05")).toBe(false);
    expect(d.daily.reduce((n, day) => n + day.newUnits, 0)).toBe(8);
  });
  it("filters drilldowns without changing summary denominators", async () => {
    const d = await load("scope=recovered&serial=RECOVER");
    expect(d.summary.units).toBe(8);
    expect(d.matchingUnits).toBe(2);
    expect(d.units.map(u => u.serial).sort()).toEqual(["INVALID-RECOVER", "RECOVER"]);
  });
  it("lists repeated units by their first result without changing the summary", async () => {
    const d = await load("scope=repeat&first=FAIL");
    expect(d.summary.units).toBe(8);
    expect(d.units.map(u => u.serial).sort()).toEqual(["BAD-DURATION", "RECOVER", "STILL-FAIL", "TIE"]);
    expect((await load("scope=repeat&first=PASS")).units.map(u => u.serial)).toEqual(["REGRESS"]);
  });
  it("returns empty arrays and zero totals for empty cohorts", async () => {
    const q = buildYieldQuery(new URLSearchParams("timeRange=all&dateFrom=2030-01-01"));
    const d = (await client.query(q.sql, q.values)).rows[0].data as YieldData;
    expect(d.summary.units).toBe(0);
    expect(d.summary.repeatHours).toBe(0);
    expect(d.units).toEqual([]);
    expect(d.daily).toEqual([]);
    expect(d.repeatReasons).toEqual([]);
  });
  it("paginates without truncating cohort totals", async () => {
    await client.query(`INSERT INTO Inverters SELECT n, 'PAGE-' || n FROM generate_series(100,129) n;
      INSERT INTO Tests (test_id,inv_id,start_time_utc,end_time,overall_status)
      SELECT n,n,'2026-09-01T00:00Z'::timestamptz,'2026-09-01T02:00Z'::timestamptz,'PASS' FROM generate_series(100,129) n`);
    const d = await load("scope=all&serial=PAGE-&page=2");
    expect(d.summary.units).toBe(38);
    expect(d.matchingUnits).toBe(30);
    expect(d.units).toHaveLength(5);
    expect(d.page).toBe(2);
  });
});
