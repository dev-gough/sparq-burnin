import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { FT3_COLUMNS, Ft3ParseError, parseFt3Csv, parseFt3TestTime, validateFt3Row } from "@/lib/ft3";

const NAME = "FT3_190826396198_2026-10-15_12-07-29.csv";
const sample = readFileSync(path.join(__dirname, "fixtures", NAME), "utf8");
const [headerLine, valueLine] = sample.trim().split(/\r?\n/);
const headers = headerLine.split(",");

function withValues(changes: Record<string, string>, extra = ""): string {
  const values = valueLine.split(",");
  for (const [name, value] of Object.entries(changes)) {
    const i = headers.indexOf(name);
    if (i < 0) throw new Error(`fixture has no column ${name}`);
    values[i] = value;
  }
  return `${headerLine}\r\n${values.join(",")}\r\n${extra}`;
}

const notRun = (...columns: string[]) => Object.fromEntries(columns.map(c => [c, "N/A"]));
const AFTER_AC = notRun("GFDI Result", "Zigbee Result", "ABVF Result", "ABVF 1", "ABVF 2", "ABVF 3", "ABVF 4");

function problems(text: string, name = NAME): string[] {
  try {
    parseFt3Csv(text, name);
  } catch (err) {
    expect(err).toBeInstanceOf(Ft3ParseError);
    return (err as Ft3ParseError).problems;
  }
  throw new Error("expected the file to be rejected");
}

describe("parseFt3Csv", () => {
  it("parses the station sample", () => {
    const record = parseFt3Csv(sample, NAME);
    expect(record).toMatchObject({
      serialNumber: "190826396198", tester: "Alex", overallVerdict: "PASS", failedStep: null,
      fpgaVersion: "1.20.105", zigbeeVersion: "1.10.6",
    });
    expect(record.rawHeaders).toEqual(FT3_COLUMNS);
  });

  it("reads Test Time as India Standard Time", () => {
    expect(parseFt3Csv(sample, NAME).testTimeUtc.toISOString()).toBe("2026-10-15T05:27:23.000Z");
    expect(parseFt3TestTime("2026-10-15 10:57:23-04:00")).toBeNull();
    expect(parseFt3TestTime("2026-02-30 10:57:23")).toBeNull();
  });

  it("accepts a run that stops at its first failure", () => {
    const record = parseFt3Csv(withValues({ "Overall Verdict": "Fail", "AC Power": "Fail", "Maximum Power": "1200", ...AFTER_AC }), NAME);
    expect(record.overallVerdict).toBe("FAIL");
    expect(record.failedStep).toBe("AC Power");
  });

  it("rejects unknown and missing columns", () => {
    const renamed = sample.replace("GFDI Result", "GFDI Status").replace("Tester,", "Tester,Fixture,").replace("Alex,", "Alex,F1,");
    expect(problems(renamed)).toEqual(expect.arrayContaining([
      "Missing columns: GFDI Result",
      'Unknown columns: "Fixture", "GFDI Status"',
    ]));
  });

  it("rejects values it does not recognise instead of coercing them", () => {
    expect(problems(withValues({ "Grid Detect Result": "PASS", "MPPT 2 PV 3 Voltage": "36.3V", "Maximum Power": "" }))).toEqual(expect.arrayContaining([
      'Grid Detect Result is "PASS", expected Pass, Fail or N/A',
      'MPPT 2 PV 3 Voltage is "36.3V", expected a number',
      'Maximum Power is "", expected a number',
    ]));
    // An unreadable result does not also produce knock-on sequence complaints.
    expect(problems(withValues({ "GFDI Result": "PASS" }))).toEqual(['GFDI Result is "PASS", expected Pass, Fail or N/A']);
  });

  it("rejects verdicts that contradict the subtests", () => {
    expect(problems(withValues({ "Overall Verdict": "Fail" }))).toContain("Overall Verdict is Fail but no subtest failed");
    expect(problems(withValues({ "Overall Verdict": "Fail", "AC Power": "Fail" }))).toContain("Subtests after AC Power should be N/A");
    expect(problems(withValues({ "MPPT 3 PV 2 Result": "Fail" }))).toEqual(expect.arrayContaining([
      "MPPT Result is Pass but not every MPPT channel passed",
    ]));
    expect(problems(withValues({ "Overall Verdict": "N/A" }))).toContain('Overall Verdict is "N/A", expected Pass or Fail');
  });

  it("requires readings to be N/A when their subtest did not run", () => {
    const ran = withValues({ "Overall Verdict": "Fail", "AC Power": "Fail", "Maximum Power": "1200", ...AFTER_AC, "ABVF 2": "0.1" });
    expect(problems(ran)).toContain('ABVF 2 is "0.1", expected N/A because the subtest did not run');
  });

  it("checks the filename, serial and row count", () => {
    expect(problems(sample, "results.csv")).toContain('Filename "results.csv" is not FT3_<serial>_<YYYY-MM-DD_HH-MM-SS>.csv');
    expect(problems(sample, "FT3_190826396199_2026-10-15_12-07-29.csv")).toContain("Serial Number 190826396198 does not match 190826396199 in the filename");
    expect(problems(sample, "FT3_190826396198_2026-10-15_10-00-00.csv")).toContain("The filename time is earlier than Test Time");
    expect(problems(withValues({ "Serial Number": "1.90826E+11" }))).toContain('Serial Number "1.90826E+11" is not 12 digits');
    expect(problems(withValues({}, `${valueLine}\r\n`))).toContain("The file has 2 result rows, expected 1");
    expect(problems(`${headerLine}\r\n`)).toContain("The file has no result row");
  });

  it("reports every problem in one pass", () => {
    const list = problems(withValues({ Tester: "", "FPGA Version": "dev", "Test Time": "15/10/2026" }));
    expect(list).toEqual(expect.arrayContaining([
      "Tester is empty",
      'FPGA Version "dev" is not a version number or N/A',
      'Test Time "15/10/2026" is not YYYY-MM-DD HH:MM:SS',
    ]));
  });
});

describe("validateFt3Row", () => {
  const { steps, problems: found } = validateFt3Row(headers, valueLine.split(","));

  it("returns the seven subtests in test order", () => {
    expect(found).toEqual([]);
    expect(steps.map(s => s.label)).toEqual(["Auxiliary Power", "Grid Detect", "MPPT", "AC Power", "GFDI", "Zigbee", "ABVF"]);
  });

  it("lays MPPT out as 4 conditions by 4 PV channels", () => {
    const mppt = steps.find(s => s.key === "mppt")!.mppt!;
    expect(mppt).toHaveLength(4);
    expect(mppt[1].cells[3]).toEqual({ channel: 4, result: "PASS", voltage: "36.294", current: "13.106" });
  });

  it("reads AC maximum power and ABVF response times", () => {
    expect(steps.find(s => s.key === "ac")!.readings).toEqual([{ label: "Maximum power", value: "2013", unit: "W" }]);
    expect(steps.find(s => s.key === "abvf")!.readings.map(r => r.value)).toEqual(["0.141", "0.112", "0.031", "0.018"]);
  });
});
