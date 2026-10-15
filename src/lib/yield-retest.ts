import { getTimeRangeDays, validateDateRange, validateTimeRange } from "@/lib/validation";

export type YieldScope = "held" | "repeat" | "all" | "passed" | "recovered" | "unresolved" | "pending";
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
/** Burn-in runs started on one UTC day; a unit's first attempt counts as a new unit. */
export interface YieldDay {
  day: string; newUnits: number; newPass: number; repeatRuns: number; hours: number; repeatHours: number;
}
export interface YieldData {
  summary: YieldSummary;
  /** Same-length period immediately before this one; null for all time or open-ended ranges. */
  previous: { units: number; firstPass: number } | null;
  daily: YieldDay[];
  period: { from: string | null; to: string };
  /** Units that needed more than one run, by the result of their first attempt. */
  repeatReasons: { status: string; units: number }[];
  clearing: {
    recoveredUnits: number; recoveredMedianHours: number | null; recoveredP90Hours: number | null;
    firstPassMedianHours: number | null; heldUp: number; heldUpMedianAgeHours: number | null;
  };
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
  const scope = (params.get("scope") || "held") as YieldScope;
  if (!["held", "repeat", "all", "passed", "recovered", "unresolved", "pending"].includes(scope)) throw new Error("Invalid scope");
  const search = (params.get("serial") || "").trim();
  if (search.length > 50) throw new Error("Serial search is too long");
  const values: (string | number)[] = [];
  const bind = (value: string | number) => { values.push(value); return `$${values.length}`; };
  // Period as UTC calendar days [lo, hi). Null bounds are open (all time).
  const today = "(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date";
  let lo: string | null = null;
  let hi: string | null = null;
  if (dates.dateFrom || dates.dateTo) {
    if (dates.dateFrom) lo = `${bind(dates.dateFrom)}::date`;
    if (dates.dateTo) hi = `(${bind(dates.dateTo)}::date + 1)`;
  } else {
    const days = getTimeRangeDays(timeRange);
    if (days !== null) { lo = `(${today} - ${days})`; hi = `(${today} + 1)`; }
  }
  const within = (column: string, from: string | null, to: string | null) => [
    from ? `(${column} AT TIME ZONE 'UTC') >= ${from}` : null,
    to ? `(${column} AT TIME ZONE 'UTC') < ${to}` : null,
  ].filter(Boolean).join(" AND ") || "TRUE";
  const period = within("first_date", lo, hi);
  const previous = lo && hi ? within("first_date", `(${lo} - (${hi} - ${lo}))`, lo) : null;
  const scopes: Record<YieldScope, string> = {
    held: "outcome IN ('unresolved', 'pending')", repeat: "attempts > 1", all: "TRUE", passed: "outcome = 'passed'", recovered: "outcome = 'recovered'",
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
        COUNT(*) FILTER (WHERE attempt > 1 AND hours IS NULL)::int AS missing_durations,
        MIN(start_time_utc + COALESCE(hours, 0) * INTERVAL '1 hour') FILTER (WHERE overall_status = 'PASS') AS first_pass_done
      FROM runs GROUP BY inv_id
    ), cohort AS MATERIALIZED (
      SELECT h.*, i.serial_number AS serial,
        CASE WHEN latest_status = 'PASS' AND first_status = 'PASS' THEN 'passed'
          WHEN latest_status = 'PASS' THEN 'recovered'
          WHEN latest_status = 'FAIL' THEN 'unresolved' ELSE 'pending' END AS outcome
      FROM histories h JOIN Inverters i USING (inv_id) WHERE ${period}
    ), period_runs AS MATERIALIZED (
      SELECT * FROM runs WHERE ${within("start_time_utc", lo, hi)}
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
      'previous', ${previous ? `(SELECT json_build_object('units', COUNT(*), 'firstPass', COUNT(*) FILTER (WHERE first_status = 'PASS'))
        FROM histories WHERE ${previous})` : "NULL"},
      'daily', COALESCE((SELECT json_agg(d ORDER BY d.day) FROM (
        SELECT TO_CHAR(start_time_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
          COUNT(*) FILTER (WHERE attempt = 1)::int AS "newUnits",
          COUNT(*) FILTER (WHERE attempt = 1 AND overall_status = 'PASS')::int AS "newPass",
          COUNT(*) FILTER (WHERE attempt > 1)::int AS "repeatRuns",
          COALESCE(SUM(hours), 0)::float AS hours,
          COALESCE(SUM(hours) FILTER (WHERE attempt > 1), 0)::float AS "repeatHours"
        FROM period_runs GROUP BY 1
      ) d), '[]'::json),
      'period', json_build_object(
        'from', ${lo ? `TO_CHAR(${lo}, 'YYYY-MM-DD')` : "(SELECT TO_CHAR(MIN(first_date) AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM cohort)"},
        'to', TO_CHAR(${hi ? `LEAST(${hi} - 1, ${today})` : today}, 'YYYY-MM-DD')),
      'repeatReasons', COALESCE((SELECT json_agg(r ORDER BY r.units DESC, r.status) FROM (
        SELECT first_status AS status, COUNT(*)::int AS units FROM cohort WHERE attempts > 1 GROUP BY 1
      ) r), '[]'::json),
      'clearing', (SELECT json_build_object(
        'recoveredUnits', COUNT(*) FILTER (WHERE outcome = 'recovered'),
        'recoveredMedianHours', PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_pass_done - first_date)) / 3600) FILTER (WHERE outcome = 'recovered'),
        'recoveredP90Hours', PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_pass_done - first_date)) / 3600) FILTER (WHERE outcome = 'recovered'),
        'firstPassMedianHours', PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_pass_done - first_date)) / 3600) FILTER (WHERE first_status = 'PASS'),
        'heldUp', COUNT(*) FILTER (WHERE outcome IN ('unresolved', 'pending')),
        'heldUpMedianAgeHours', PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - first_date)) / 3600) FILTER (WHERE outcome IN ('unresolved', 'pending'))
      ) FROM cohort),
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
