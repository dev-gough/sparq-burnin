import { parseTimestampFromDelhi } from "./ingest/timestamps";

/**
 * FT3 (functional test 3) results. The station writes one CSV per run named
 * FT3_<serial>_<YYYY-MM-DD_HH-MM-SS>.csv with one header row and one data row.
 *
 * Parsing is strict on purpose: the format is still changing, so anything the
 * parser does not fully understand (a new column, an unexpected value, a
 * verdict that contradicts its subtests) is rejected with every problem
 * listed. Rejected pCloud files are quarantined and reported by the health
 * check so the parser can be updated, rather than stored half-understood.
 *
 * Subtests run in order. When one fails the station stops, and every later
 * result and reading is N/A.
 */

export type Ft3Verdict = "PASS" | "FAIL" | "N/A";

export interface Ft3Record {
  serialNumber: string;
  testTimeUtc: Date;
  tester: string;
  overallVerdict: "PASS" | "FAIL";
  failedStep: string | null;
  fpgaVersion: string | null;
  zigbeeVersion: string | null;
  rawHeaders: string[];
  rawValues: string[];
}

export interface Ft3Reading { label: string; value: string; unit: string }
export interface Ft3MpptCell { channel: number; result: Ft3Verdict; voltage: string | null; current: string | null }
export interface Ft3Step {
  key: string;
  label: string;
  description: string;
  result: Ft3Verdict;
  readings: Ft3Reading[];
  mppt?: { condition: number; cells: Ft3MpptCell[] }[];
}

export const FT3_STEPS = [
  { key: "aux", label: "Auxiliary Power", description: "Auxiliary power supply" },
  { key: "grid", label: "Grid Detect", description: "Grid connection detected" },
  { key: "mppt", label: "MPPT", description: "4 test conditions × 4 PV channels" },
  { key: "ac", label: "AC Power", description: "AC output with maximum power reading" },
  { key: "gfdi", label: "GFDI", description: "Ground fault detection" },
  { key: "zigbee", label: "Zigbee", description: "Zigbee communication" },
  { key: "abvf", label: "ABVF", description: "Abnormal voltage / frequency: 4 conditions with response times" },
] as const;

const QUAD = [1, 2, 3, 4] as const;
const mpptColumn = (condition: number, channel: number, field: "Result" | "Voltage" | "Current") =>
  `MPPT ${condition} PV ${channel} ${field}`;

/** Every column the station writes, in station order. Anything else is rejected. */
export const FT3_COLUMNS: readonly string[] = [
  "Test Time", "Tester", "Serial Number", "Overall Verdict", "FPGA Version", "Zigbee Version",
  "Aux Power Result", "Grid Detect Result", "MPPT Result",
  ...QUAD.flatMap(c => QUAD.flatMap(p => (["Result", "Voltage", "Current"] as const).map(f => mpptColumn(c, p, f)))),
  "AC Power", "Maximum Power", "GFDI Result", "Zigbee Result", "ABVF Result",
  ...QUAD.map(n => `ABVF ${n}`),
];

const STEP_RESULT_COLUMN: Record<(typeof FT3_STEPS)[number]["key"], string> = {
  aux: "Aux Power Result", grid: "Grid Detect Result", mppt: "MPPT Result", ac: "AC Power",
  gfdi: "GFDI Result", zigbee: "Zigbee Result", abvf: "ABVF Result",
};

const VERDICTS: Record<string, Ft3Verdict> = { Pass: "PASS", Fail: "FAIL", "N/A": "N/A" };
const NUMBER_RE = /^-?\d+(\.\d+)?$/;
const VERSION_RE = /^\d+(\.\d+)+$/;
const SERIAL_RE = /^\d{12}$/;
const TEST_TIME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const FILENAME_RE = /^FT3_([^_]+)_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.csv$/;

export class Ft3ParseError extends Error {
  constructor(public readonly problems: string[]) {
    super(problems.join("; "));
    this.name = "Ft3ParseError";
  }
}

// Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF. Unterminated quotes are an error.
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { cur.push(field); field = ""; }
    else if (ch === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (inQuotes) throw new Ft3ParseError(["Unterminated quoted field"]);
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter(r => !(r.length === 1 && r[0].trim() === ""));
}

/** Wall-clock "YYYY-MM-DDTHH:MM:SS" when it is a real calendar time, else null. */
function wallClock(y: string, mo: string, d: string, h: string, mi: string, s: string): string | null {
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  const check = new Date(`${iso}Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 19) === iso ? iso : null;
}

export function parseFt3Filename(filename: string): { serial: string; time: Date } | null {
  const m = FILENAME_RE.exec(filename.split(/[\\/]/).pop() ?? "");
  if (!m) return null;
  const iso = wallClock(m[2], m[3], m[4], m[5], m[6], m[7]);
  return iso ? { serial: m[1], time: parseTimestampFromDelhi(iso) } : null;
}

/** Station wall clock "2026-10-15 10:57:23", read as IST (the factory PCs run on IST). */
export function parseFt3TestTime(value: string): Date | null {
  const m = TEST_TIME_RE.exec(value);
  if (!m) return null;
  const iso = wallClock(m[1], m[2], m[3], m[4], m[5], m[6]);
  return iso ? parseTimestampFromDelhi(iso) : null;
}

/**
 * Check one data row against the FT3 format and build the subtest view.
 * Returns every problem found; the steps are only trustworthy when there are none.
 */
export function validateFt3Row(headers: string[], values: string[]): { steps: Ft3Step[]; problems: string[] } {
  const problems: string[] = [];
  let unreadableVerdict = false;
  const index = new Map<string, number>();
  headers.forEach((h, i) => {
    if (index.has(h)) problems.push(`Duplicate column "${h}"`);
    index.set(h, i);
  });
  const missing = FT3_COLUMNS.filter(c => !index.has(c));
  const unknown = headers.filter(h => !FT3_COLUMNS.includes(h));
  if (missing.length) problems.push(`Missing columns: ${missing.join(", ")}`);
  if (unknown.length) problems.push(`Unknown columns: ${unknown.map(h => `"${h}"`).join(", ")}`);
  if (values.length !== headers.length) problems.push(`Row has ${values.length} values for ${headers.length} columns`);

  const get = (column: string) => { const i = index.get(column); return i === undefined ? undefined : values[i]; };
  const verdict = (column: string): Ft3Verdict => {
    const raw = get(column);
    if (raw === undefined) return "N/A"; // already reported as missing
    const v = VERDICTS[raw];
    if (!v) { problems.push(`${column} is "${raw}", expected Pass, Fail or N/A`); unreadableVerdict = true; }
    return v ?? "N/A";
  };
  // A reading is a number when its subtest ran, and N/A when it did not.
  const reading = (column: string, ran: boolean): string | null => {
    const raw = get(column);
    if (raw === undefined) return null;
    if (ran && NUMBER_RE.test(raw)) return raw;
    if (!ran && raw === "N/A") return null;
    problems.push(`${column} is "${raw}", expected ${ran ? "a number" : "N/A because the subtest did not run"}`);
    return null;
  };

  const steps: Ft3Step[] = FT3_STEPS.map(step => {
    const result = verdict(STEP_RESULT_COLUMN[step.key]);
    const ran = result !== "N/A";
    const base: Ft3Step = { ...step, result, readings: [] };
    if (step.key === "mppt") {
      base.mppt = QUAD.map(condition => ({
        condition,
        cells: QUAD.map(channel => {
          const cell = verdict(mpptColumn(condition, channel, "Result"));
          const cellRan = cell !== "N/A";
          return {
            channel, result: cell,
            voltage: reading(mpptColumn(condition, channel, "Voltage"), cellRan),
            current: reading(mpptColumn(condition, channel, "Current"), cellRan),
          };
        }),
      }));
      const cells = base.mppt.flatMap(c => c.cells.map(cell => cell.result));
      if (unreadableVerdict) return base;
      if (result === "PASS" && cells.some(c => c !== "PASS")) problems.push("MPPT Result is Pass but not every MPPT channel passed");
      if (result === "FAIL" && !cells.includes("FAIL")) problems.push("MPPT Result is Fail but no MPPT channel failed");
      if (result === "N/A" && cells.some(c => c !== "N/A")) problems.push("MPPT Result is N/A but MPPT channels have results");
    }
    if (step.key === "ac") {
      const power = reading("Maximum Power", ran);
      if (power !== null) base.readings.push({ label: "Maximum power", value: power, unit: "W" });
    }
    if (step.key === "abvf") {
      for (const n of QUAD) {
        const time = reading(`ABVF ${n}`, ran);
        if (time !== null) base.readings.push({ label: `Condition ${n} response`, value: time, unit: "s" });
      }
    }
    return base;
  });

  // The station stops at the first failure: passes, then at most one Fail, then only N/A.
  // Skipped when a subtest result was unreadable, to avoid knock-on complaints.
  const overall = get("Overall Verdict");
  if (unreadableVerdict) {
    if (overall !== undefined && overall !== "Pass" && overall !== "Fail") problems.push(`Overall Verdict is "${overall}", expected Pass or Fail`);
    return { steps, problems };
  }
  const results = steps.map(s => s.result);
  const firstFail = results.indexOf("FAIL");
  if (overall === "Pass") {
    const notPassed = steps.filter(s => s.result !== "PASS").map(s => s.label);
    if (notPassed.length) problems.push(`Overall Verdict is Pass but ${notPassed.join(", ")} did not pass`);
  } else if (overall === "Fail") {
    if (firstFail < 0) problems.push("Overall Verdict is Fail but no subtest failed");
    else {
      if (results.slice(0, firstFail).some(r => r !== "PASS")) problems.push(`Subtests before ${steps[firstFail].label} did not all pass`);
      if (results.slice(firstFail + 1).some(r => r !== "N/A")) problems.push(`Subtests after ${steps[firstFail].label} should be N/A`);
    }
  } else if (overall !== undefined) {
    problems.push(`Overall Verdict is "${overall}", expected Pass or Fail`);
  }
  return { steps, problems };
}

/** Parse one station file. Throws Ft3ParseError listing every problem found. */
export function parseFt3Csv(text: string, filename: string): Ft3Record {
  const problems: string[] = [];
  const name = filename.split(/[\\/]/).pop() ?? filename;
  const fromName = parseFt3Filename(name);
  if (!fromName) problems.push(`Filename "${name}" is not FT3_<serial>_<YYYY-MM-DD_HH-MM-SS>.csv`);

  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Ft3ParseError([...problems, "The file has no result row"]);
  if (rows.length > 2) problems.push(`The file has ${rows.length - 1} result rows, expected 1`);
  const [headers, values] = rows;
  const { steps, problems: rowProblems } = validateFt3Row(headers, values);
  problems.push(...rowProblems);

  const get = (column: string) => { const i = headers.indexOf(column); return i < 0 ? "" : values[i] ?? ""; };
  const serialNumber = get("Serial Number");
  if (!SERIAL_RE.test(serialNumber)) problems.push(`Serial Number "${serialNumber}" is not 12 digits`);
  else if (fromName && fromName.serial !== serialNumber) problems.push(`Serial Number ${serialNumber} does not match ${fromName.serial} in the filename`);

  const testTimeUtc = parseFt3TestTime(get("Test Time"));
  if (!testTimeUtc) problems.push(`Test Time "${get("Test Time")}" is not YYYY-MM-DD HH:MM:SS`);
  else if (fromName && fromName.time < testTimeUtc) problems.push("The filename time is earlier than Test Time");

  const tester = get("Tester");
  if (!tester.trim()) problems.push("Tester is empty");
  const version = (column: string) => {
    const v = get(column);
    if (v === "N/A") return null;
    if (!VERSION_RE.test(v)) problems.push(`${column} "${v}" is not a version number or N/A`);
    return v;
  };
  const fpgaVersion = version("FPGA Version");
  const zigbeeVersion = version("Zigbee Version");

  if (problems.length) throw new Ft3ParseError(problems);
  return {
    serialNumber, testTimeUtc: testTimeUtc!, tester,
    overallVerdict: get("Overall Verdict") === "Pass" ? "PASS" : "FAIL",
    failedStep: steps.find(s => s.result === "FAIL")?.label ?? null,
    fpgaVersion, zigbeeVersion, rawHeaders: headers, rawValues: values,
  };
}
