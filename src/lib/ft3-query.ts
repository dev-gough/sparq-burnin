import { getTimeRangeDays, validateDateRange, validateTimeRange } from "@/lib/validation";
import { FT3_STEPS } from "@/lib/ft3";

export type Ft3VerdictFilter = "all" | "PASS" | "FAIL";
export const FT3_PAGE_SIZE = 50;

export interface Ft3ListRow {
  id: number; serial: string; testTime: string; tester: string | null; verdict: string;
  failedStep: string | null; fpga: string | null; zigbee: string | null;
  attempts: number; burninRuns: number; burninLatest: string | null;
}
export interface Ft3ListData {
  summary: { runs: number; passed: number; failed: number; units: number; unitsLatestPass: number; unitsRetested: number };
  /** Runs per UTC day in the period, oldest first; days without runs are omitted. */
  daily: { day: string; passed: number; failed: number }[];
  /** First and last UTC day of the selected period (null bounds for all time). */
  period: { from: string | null; to: string };
  failuresByStep: { step: string; count: number }[];
  rows: Ft3ListRow[]; matching: number; page: number; pageSize: number; asOf: string;
}

/** Period filters on FT3 test time (UTC days, same as the other dashboard views). */
export function buildFt3ListQuery(params: URLSearchParams): { sql: string; values: (string | number)[] } {
  const timeRange = validateTimeRange(params.get("timeRange") || "30d");
  if (!timeRange) throw new Error("Invalid timeRange");
  const dates = validateDateRange(params.get("dateFrom"), params.get("dateTo"));
  if (dates.error) throw new Error(dates.error);
  for (const date of [dates.dateFrom, dates.dateTo]) {
    if (date && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error("Invalid calendar date");
  }
  const rawPage = params.get("page") || "1";
  if (!/^\d+$/.test(rawPage) || Number(rawPage) < 1 || Number(rawPage) > 100000) throw new Error("Invalid page");
  const page = Number(rawPage);
  const verdict = (params.get("verdict") || "all") as Ft3VerdictFilter;
  if (!["all", "PASS", "FAIL"].includes(verdict)) throw new Error("Invalid verdict");
  const step = params.get("step") || "";
  if (step && !FT3_STEPS.some(s => s.label === step)) throw new Error("Invalid step");
  const search = (params.get("serial") || "").trim();
  if (search.length > 50) throw new Error("Serial search is too long");

  const values: (string | number)[] = [];
  const bind = (value: string | number) => { values.push(value); return `$${values.length}`; };
  const bounds: string[] = [];
  let fromRef: string | null = null;
  let toRef: string | null = null;
  if (dates.dateFrom || dates.dateTo) {
    if (dates.dateFrom) { fromRef = bind(dates.dateFrom); bounds.push(`(test_time_utc AT TIME ZONE 'UTC') >= ${fromRef}::date`); }
    if (dates.dateTo) { toRef = bind(dates.dateTo); bounds.push(`(test_time_utc AT TIME ZONE 'UTC') < ${toRef}::date + INTERVAL '1 day'`); }
  } else {
    const days = getTimeRangeDays(timeRange);
    if (days !== null) bounds.push(`(test_time_utc AT TIME ZONE 'UTC') >= (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - INTERVAL '${days} days'`);
  }
  const period = bounds.length ? bounds.join(" AND ") : "TRUE";
  // Bounds for the trend axis, as UTC days. All time starts at the first run.
  const today = `to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD')`;
  let periodFrom = `(SELECT to_char(MIN(test_time_utc) AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM period)`;
  let periodTo = today;
  if (dates.dateFrom || dates.dateTo) {
    if (fromRef) periodFrom = `${fromRef}::text`;
    if (toRef) periodTo = `${toRef}::text`;
  } else {
    const days = getTimeRangeDays(timeRange);
    if (days !== null) periodFrom = `to_char((CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date - INTERVAL '${days} days', 'YYYY-MM-DD')`;
  }
  const filters: string[] = [];
  if (search) filters.push(`serial_number ILIKE ${bind(`%${search.replace(/[\\%_]/g, "\\$&")}%`)}`);
  if (verdict === "PASS" || verdict === "FAIL") filters.push(`overall_verdict = ${bind(verdict)}`);
  if (step) filters.push(`failed_step = ${bind(step)}`);
  const listFilter = filters.length ? filters.join(" AND ") : "TRUE";
  const limit = bind(FT3_PAGE_SIZE);
  const offset = bind((page - 1) * FT3_PAGE_SIZE);
  const pageValue = bind(page);

  return { values, sql: `
    WITH period AS MATERIALIZED (
      SELECT * FROM FT3Tests WHERE ${period}
    ), units AS (
      SELECT serial_number, COUNT(*)::int AS runs,
        (ARRAY_AGG(overall_verdict ORDER BY test_time_utc DESC, ft3_id DESC))[1] AS latest
      FROM period GROUP BY serial_number
    ), matching AS (
      SELECT * FROM period WHERE ${listFilter}
    ), page_rows AS (
      SELECT m.*, u.runs AS attempts FROM matching m JOIN units u USING (serial_number)
      ORDER BY m.test_time_utc DESC, m.ft3_id DESC LIMIT ${limit} OFFSET ${offset}
    )
    SELECT json_build_object(
      'summary', json_build_object(
        'runs', (SELECT COUNT(*) FROM period),
        'passed', (SELECT COUNT(*) FROM period WHERE overall_verdict = 'PASS'),
        'failed', (SELECT COUNT(*) FROM period WHERE overall_verdict = 'FAIL'),
        'units', (SELECT COUNT(*) FROM units),
        'unitsLatestPass', (SELECT COUNT(*) FROM units WHERE latest = 'PASS'),
        'unitsRetested', (SELECT COUNT(*) FROM units WHERE runs > 1)
      ),
      'daily', COALESCE((
        SELECT json_agg(json_build_object('day', day, 'passed', passed, 'failed', failed) ORDER BY day)
        FROM (SELECT to_char(test_time_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                COUNT(*) FILTER (WHERE overall_verdict = 'PASS')::int AS passed,
                COUNT(*) FILTER (WHERE overall_verdict = 'FAIL')::int AS failed
              FROM period GROUP BY 1) d
      ), '[]'::json),
      'period', json_build_object('from', ${periodFrom}, 'to', ${periodTo}),
      'failuresByStep', COALESCE((
        SELECT json_agg(json_build_object('step', step, 'count', count) ORDER BY count DESC, step)
        FROM (SELECT COALESCE(failed_step, 'Not recorded') AS step, COUNT(*)::int AS count
              FROM period WHERE overall_verdict = 'FAIL' GROUP BY 1) s
      ), '[]'::json),
      'rows', COALESCE((
        SELECT json_agg(json_build_object(
          'id', p.ft3_id, 'serial', p.serial_number, 'testTime', to_char(p.test_time_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'tester', p.tester,
          'verdict', p.overall_verdict, 'failedStep', p.failed_step, 'fpga', p.fpga_version,
          'zigbee', p.zigbee_version, 'attempts', p.attempts,
          'burninRuns', COALESCE(b.runs, 0), 'burninLatest', b.latest
        ) ORDER BY p.test_time_utc DESC, p.ft3_id DESC)
        FROM page_rows p
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS runs, (ARRAY_AGG(t.overall_status ORDER BY t.start_time_utc DESC))[1] AS latest
          FROM Inverters i JOIN Tests t USING (inv_id) WHERE i.serial_number = p.serial_number
        ) b ON TRUE
      ), '[]'::json),
      'matching', (SELECT COUNT(*) FROM matching),
      'page', ${pageValue}::int, 'pageSize', ${limit}::int, 'asOf', to_char(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    ) AS data` };
}
