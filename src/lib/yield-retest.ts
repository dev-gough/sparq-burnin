import { getTimeRangeDays, validateDateRange, validateTimeRange } from "@/lib/validation";

export type YieldScope = "repeat" | "all" | "passed" | "recovered" | "unresolved" | "pending";
export interface YieldRun {
  id: number; status: string; start: string; hours: number | null;
  firmware: string | null; station: string | null;
}
export interface YieldUnit {
  serial: string; firstDate: string; firstStatus: string; latestStatus: string | null;
  attempts: number; repeatHours: number; missingDurations: number;
  outcome: "passed" | "recovered" | "unresolved" | "pending";
  history: YieldRun[];
}
export interface YieldSummary {
  units: number; firstPass: number; latestPass: number; repeated: number;
  recovered: number; unresolved: number; pending: number; firstNondecisive: number;
  repeatRuns: number; repeatHours: number; missingDurations: number;
}
export interface YieldData {
  summary: YieldSummary;
  timeline: { month: string; units: number; firstPass: number; latestPass: number }[];
  units: YieldUnit[]; matchingUnits: number; page: number; pageSize: number; asOf: string;
}

// Cohort selection happens AFTER ranking the complete recorded history. Never
// filter the input runs by the selected period: that would invent first attempts.
export function buildYieldQuery(params: URLSearchParams): { sql: string; values: (string | number)[]; page: number; scope: YieldScope } {
  const rawRange = params.get("timeRange") || "30d";
  const timeRange = validateTimeRange(rawRange);
  if (!timeRange) throw new Error("Invalid timeRange");
  const dates = validateDateRange(params.get("dateFrom"), params.get("dateTo"));
  if (dates.error) throw new Error(dates.error);
  for (const date of [dates.dateFrom, dates.dateTo]) {
    if (date && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Invalid calendar date");
  }
  const rawPage = params.get("page") || "1";
  if (!/^\d+$/.test(rawPage) || Number(rawPage) < 1 || Number(rawPage) > 100000) throw new Error("Invalid page");
  const page = Number(rawPage);
  const scope = (params.get("scope") || "repeat") as YieldScope;
  if (!["repeat", "all", "passed", "recovered", "unresolved", "pending"].includes(scope)) throw new Error("Invalid scope");
  const search = (params.get("serial") || "").trim();
  if (search.length > 50) throw new Error("Serial search is too long");
  const values: (string | number)[] = [];
  const bind = (value: string | number) => { values.push(value); return `$${values.length}`; };
  let period = "TRUE";
  if (dates.dateFrom || dates.dateTo) {
    const bounds = [];
    if (dates.dateFrom) bounds.push(`(first_date AT TIME ZONE 'UTC') >= ${bind(dates.dateFrom)}::date`);
    if (dates.dateTo) bounds.push(`(first_date AT TIME ZONE 'UTC') < ${bind(dates.dateTo)}::date + INTERVAL '1 day'`);
    period = bounds.join(" AND ");
  } else {
    const days = getTimeRangeDays(timeRange);
    if (days !== null) period = `(first_date AT TIME ZONE 'UTC') >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - INTERVAL '${days} days'`;
  }
  const scopes: Record<YieldScope, string> = {
    repeat: "attempts > 1", all: "TRUE", passed: "outcome = 'passed'", recovered: "outcome = 'recovered'",
    unresolved: "outcome = 'unresolved'", pending: "outcome = 'pending'",
  };
  const serialFilter = search ? `AND serial ILIKE ${bind(`%${search.replace(/[\\%_]/g, "\\$&")}%`)}` : "";
  const offset = bind((page - 1) * 25);
  return { values, page, scope, sql: `
    WITH runs AS MATERIALIZED (
      SELECT t.inv_id, t.test_id, t.start_time_utc, t.overall_status, ROW_NUMBER() OVER (PARTITION BY inv_id ORDER BY start_time_utc, test_id) AS attempt,
        CASE WHEN end_time >= start_time_utc THEN EXTRACT(EPOCH FROM (end_time - start_time_utc)) / 3600 END AS hours
      FROM Tests t WHERE start_time_utc IS NOT NULL
        AND overall_status IN ('PASS', 'FAIL', 'INVALID', 'RETEST')
    ), histories AS (
      SELECT inv_id, MIN(start_time_utc) AS first_date, COUNT(*)::int AS attempts,
        (ARRAY_AGG(overall_status ORDER BY attempt))[1] AS first_status,
        (ARRAY_AGG(overall_status ORDER BY attempt DESC) FILTER (WHERE overall_status IN ('PASS','FAIL')))[1] AS latest_status,
        COALESCE(SUM(hours) FILTER (WHERE attempt > 1), 0)::float AS repeat_hours,
        COUNT(*) FILTER (WHERE attempt > 1 AND hours IS NULL)::int AS missing_durations
      FROM runs GROUP BY inv_id
    ), cohort AS MATERIALIZED (
      SELECT h.*, i.serial_number AS serial,
        CASE WHEN latest_status = 'PASS' AND first_status = 'PASS' THEN 'passed'
          WHEN latest_status = 'PASS' THEN 'recovered'
          WHEN latest_status = 'FAIL' THEN 'unresolved' ELSE 'pending' END AS outcome
      FROM histories h JOIN Inverters i USING (inv_id) WHERE ${period}
    ), matching AS (
      SELECT * FROM cohort WHERE ${scopes[scope]} ${serialFilter}
    ), page_units AS (
      SELECT * FROM matching ORDER BY repeat_hours DESC, attempts DESC, serial LIMIT 25 OFFSET ${offset}
    )
    SELECT json_build_object(
      'summary', (SELECT json_build_object(
        'units', COUNT(*), 'firstPass', COUNT(*) FILTER (WHERE first_status = 'PASS'),
        'latestPass', COUNT(*) FILTER (WHERE latest_status = 'PASS'),
        'repeated', COUNT(*) FILTER (WHERE attempts > 1),
        'recovered', COUNT(*) FILTER (WHERE outcome = 'recovered'),
        'unresolved', COUNT(*) FILTER (WHERE outcome = 'unresolved'),
        'pending', COUNT(*) FILTER (WHERE outcome = 'pending'),
        'firstNondecisive', COUNT(*) FILTER (WHERE first_status IN ('INVALID','RETEST')),
        'repeatRuns', COALESCE(SUM(attempts - 1), 0),
        'repeatHours', COALESCE(SUM(repeat_hours), 0),
        'missingDurations', COALESCE(SUM(missing_durations), 0)
      ) FROM cohort),
      'timeline', COALESCE((SELECT json_agg(b ORDER BY b.month) FROM (
        SELECT TO_CHAR(first_date AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
          COUNT(*) AS units, COUNT(*) FILTER (WHERE first_status = 'PASS') AS "firstPass",
          COUNT(*) FILTER (WHERE latest_status = 'PASS') AS "latestPass"
        FROM cohort GROUP BY 1
      ) b), '[]'::json),
      'matchingUnits', (SELECT COUNT(*) FROM matching),
      'units', COALESCE((SELECT json_agg(json_build_object(
        'serial', p.serial, 'firstDate', p.first_date, 'firstStatus', p.first_status,
        'latestStatus', p.latest_status, 'attempts', p.attempts,
        'repeatHours', p.repeat_hours, 'missingDurations', p.missing_durations,
        'outcome', p.outcome, 'history', (
          SELECT json_agg(json_build_object('id', r.test_id, 'status', r.overall_status,
            'start', r.start_time_utc, 'hours', r.hours,
            'firmware', r.firmware_version, 'station', r.station_id) ORDER BY r.start_time_utc, r.test_id)
          FROM (SELECT t.test_id, t.overall_status, t.start_time_utc, t.firmware_version, t.station_id,
            CASE WHEN t.end_time >= t.start_time_utc THEN EXTRACT(EPOCH FROM (t.end_time - t.start_time_utc)) / 3600 END AS hours
            FROM Tests t WHERE t.inv_id = p.inv_id AND t.start_time_utc IS NOT NULL
              AND t.overall_status IN ('PASS','FAIL','INVALID','RETEST')
            ORDER BY t.start_time_utc DESC, t.test_id DESC LIMIT 100) r
        )
      ) ORDER BY p.repeat_hours DESC, p.attempts DESC, p.serial) FROM page_units p), '[]'::json),
      'page', ${page}, 'pageSize', 25, 'asOf', CURRENT_TIMESTAMP
    ) AS data
  ` };
}

export function yieldPercent(count: number, total: number): string {
  return total ? `${(count / total * 100).toFixed(1)}%` : "—";
}
