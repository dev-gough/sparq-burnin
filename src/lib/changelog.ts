import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

const SECTIONS = ["Added", "Changed", "Fixed"] as const;
export type ChangelogSectionName = (typeof SECTIONS)[number];

export type ChangelogShot = {
  caption: string;
  before: string;
  after: string;
};

export type ChangelogEntry = {
  /** `unreleased`, or `MAJOR.MINOR.PATCH` without a leading v. */
  id: string;
  /** First line of the file. This is the annotated tag message's title. */
  title: string;
  summary: string[];
  sections: { name: ChangelogSectionName; items: string[] }[];
  shots: ChangelogShot[];
};

export type ChangelogGroup =
  | { kind: "release"; entry: ChangelogEntry }
  | { kind: "patches"; family: string; date?: string; entries: ChangelogEntry[] };

/** Keep feature releases prominent and collect adjacent patches from one day. */
export function groupChangelog(entries: ChangelogEntry[]): ChangelogGroup[] {
  const groups: ChangelogGroup[] = [];
  for (const entry of entries) {
    const [major, minor, patch] = entry.id.split(".");
    if (entry.id === "unreleased" || Number(patch) === 0) {
      groups.push({ kind: "release", entry });
      continue;
    }
    const family = `${major}.${minor}.x`;
    const date = VERSION_TITLE.exec(entry.title)?.[4];
    const previous = groups.at(-1);
    if (previous?.kind === "patches" && previous.family === family && previous.date === date) {
      previous.entries.push(entry);
    } else {
      groups.push({ kind: "patches", family, date, entries: [entry] });
    }
  }
  return groups;
}

const VERSION_TITLE = /^v(\d+)\.(\d+)\.(\d+)(?: — (\d{4}-\d{2}-\d{2}))?$/;
const SHOT_PATH = /^\/changelog\/[A-Za-z0-9._/-]+$/;

export function parseChangelog(filename: string, text: string): ChangelogEntry {
  const lines = text.replace(/\r\n/g, "\n").replace(/\s+$/, "").split("\n");
  if (lines.length === 0 || lines[0].trim() === "") {
    throw new Error(`${filename}: the first line is the version title`);
  }
  const title = lines[0].trim();
  const id = idFromTitle(filename, title);
  const summary: string[] = [];
  const sections: ChangelogEntry["sections"] = [];
  const shots: ChangelogShot[] = [];
  let paragraph: string[] = [];
  let section: ChangelogSectionName | "Shots" | null = null;
  const seen = new Set<string>();

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    if (section) throw new Error(`${filename}: prose after ${section} is not a bullet`);
    summary.push(paragraph.join(" "));
    paragraph = [];
  };

  for (let index = 1; index < lines.length; index++) {
    const line = lines[index];
    const trimmed = line.trim();
    const location = `${filename}:${index + 1}`;
    if (trimmed === "") {
      flushParagraph();
      continue;
    }
    if (SECTIONS.includes(trimmed as ChangelogSectionName) || trimmed === "Shots") {
      flushParagraph();
      if (seen.has(trimmed)) throw new Error(`${location}: ${trimmed} is repeated`);
      seen.add(trimmed);
      section = trimmed as ChangelogSectionName | "Shots";
      if (section !== "Shots") sections.push({ name: section, items: [] });
      continue;
    }
    if (!section) {
      if (line.startsWith(" ") || line.startsWith("\t") || line.startsWith("- ")) {
        throw new Error(`${location}: summary lines are plain sentences`);
      }
      paragraph.push(trimmed);
      continue;
    }
    if (!trimmed.startsWith("- ")) throw new Error(`${location}: expected a "- " bullet under ${section}`);
    const body = trimmed.slice(2).trim();
    if (!body) throw new Error(`${location}: empty bullet`);
    if (section === "Shots") shots.push(parseShot(location, body));
    else sections.at(-1)!.items.push(body);
  }
  flushParagraph();
  for (const block of sections) {
    if (block.items.length === 0) throw new Error(`${filename}: ${block.name} has no bullets`);
  }
  return { id, title, summary, sections, shots };
}

function idFromTitle(filename: string, title: string): string {
  if (filename === "unreleased.md") {
    if (title !== "Unreleased") throw new Error(`${filename}: title must be "Unreleased"`);
    return "unreleased";
  }
  const match = VERSION_TITLE.exec(title);
  if (!match) throw new Error(`${filename}: title must look like "v1.2.3" or "v1.2.3 — YYYY-MM-DD"`);
  const id = `${match[1]}.${match[2]}.${match[3]}`;
  if (filename !== `v${id}.md`) throw new Error(`${filename}: file name does not match ${title}`);
  return id;
}

function parseShot(location: string, body: string): ChangelogShot {
  const parts = body.split("|").map(part => part.trim());
  if (parts.length !== 3) throw new Error(`${location}: shot bullets are "caption | before /changelog/... | after /changelog/..."`);
  const [caption, beforePart, afterPart] = parts;
  if (!caption) throw new Error(`${location}: shot caption is empty`);
  return { caption, before: shotPath(location, "before", beforePart), after: shotPath(location, "after", afterPart) };
}

function shotPath(location: string, side: "before" | "after", value: string): string {
  const prefix = `${side} `;
  if (!value.startsWith(prefix)) throw new Error(`${location}: ${side} path must start with "${prefix}"`);
  const shot = value.slice(prefix.length);
  if (!SHOT_PATH.test(shot) || shot.includes("..")) {
    throw new Error(`${location}: ${side} path must stay under /changelog/`);
  }
  return shot;
}

export function compareChangelog(a: ChangelogEntry, b: ChangelogEntry): number {
  return rank(b.id) - rank(a.id) || a.id.localeCompare(b.id);
}

function rank(id: string): number {
  if (id === "unreleased") return Number.POSITIVE_INFINITY;
  const [major, minor, patch] = id.split(".").map(Number);
  return major * 1_000_000 + minor * 1_000 + patch;
}

export function loadChangelog(root = process.cwd()): ChangelogEntry[] {
  const directory = path.join(root, "changelog");
  const files = readdirSync(directory).filter(name => name.endsWith(".md")).sort();
  const entries = files.map(name => parseChangelog(name, readFileSync(path.join(directory, name), "utf8")));
  for (const entry of entries) {
    for (const shot of entry.shots) {
      for (const shotPath of [shot.before, shot.after]) {
        const file = path.join(root, "public", shotPath.slice(1));
        if (!existsSync(file)) throw new Error(`${entry.title}: missing ${file}`);
      }
    }
  }
  const released = entries.filter(entry => entry.id !== "unreleased");
  const seen = new Set<string>();
  for (const entry of released) {
    if (seen.has(entry.id)) throw new Error(`changelog lists ${entry.id} twice`);
    seen.add(entry.id);
  }
  return entries
    .filter(entry => entry.id !== "unreleased" || entry.summary.length > 0 || entry.sections.length > 0 || entry.shots.length > 0)
    .sort(compareChangelog);
}

export function readPackageVersion(root = process.cwd()): string {
  const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as { version?: string };
  if (!manifest.version || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error("package.json version must be MAJOR.MINOR.PATCH");
  }
  return manifest.version;
}
