#!/usr/bin/env python3
"""
Read-only report of leftover ingest files, with paths relative to the pCloud
mount, so someone can sample the unmatched pile before quarantining it.

Default: every CSV in to_process/{results,tests} plus quarantine/*/{results,tests}.
That is the live queue (or the parked copy after a lab rehearsal).

  --from-pcloud   also/instead walk the configured pCloud source dirs and
                  list results that are not Tests.source_file (the leftover
                  set you can reconstruct on lab from the prod DB + rclone).

  --names-file    one basename or kind/basename per line (from `ls` on prod)

Does not move, copy, or delete anything. Does not write the database.

Usage (repo root):

  # Prod, before quarantine — the actual queue:
  python3 scripts/report-unprocessed-queue.py --out /tmp/unprocessed-queue

  # Lab: prod DB + rclone pCloud, reconstruct leftovers:
  python3 scripts/report-unprocessed-queue.py --from-pcloud --out /tmp/pcloud-leftovers

  python3 scripts/report-unprocessed-queue.py --help
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path


RESULTS_RE_SEC = re.compile(r"^(.+)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$")
RESULTS_RE_MIN = re.compile(r"^(.+)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.csv$")
TEST_RE_SEC = re.compile(r"^inverter_(.+)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.csv$")
TEST_RE_MIN = re.compile(r"^inverter_(.+)_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}\.csv$")

CSV_COLUMNS = [
    "kind",
    "basename",
    "origin",
    "queue_relpath",
    "pcloud_relpath",
    "source_name",
    "serial",
    "file_timestamp",
    "partner_basename",
    "partner_pcloud_relpath",
    "partner_in_queue",
    "partner_in_processed",
    "partner_in_pcloud",
    "in_db_source_file",
    "partner_in_db_source_file",
    "likely_reason",
]


def load_config(repo_root: Path) -> dict:
    path = repo_root / "config.json"
    if not path.is_file():
        sys.exit(f"config.json not found at {path}")
    with path.open() as f:
        return json.load(f)


def parse_results_name(filename: str):
    match = RESULTS_RE_SEC.match(filename)
    fmt = "%Y-%m-%d %H-%M-%S"
    if not match:
        match = RESULTS_RE_MIN.match(filename)
        fmt = "%Y-%m-%d %H-%M"
    if not match or filename.startswith("inverter_"):
        return None
    base = filename[: -len(".csv")]
    parts = base.split("_")
    if len(parts) < 3:
        return None
    sn, date_str, time_str = parts[0], parts[1], parts[2]
    try:
        return sn, datetime.strptime(f"{date_str} {time_str}", fmt)
    except ValueError:
        return None


def parse_test_name(filename: str):
    match = TEST_RE_SEC.match(filename)
    fmt = "%Y-%m-%d %H-%M-%S"
    if not match:
        match = TEST_RE_MIN.match(filename)
        fmt = "%Y-%m-%d %H-%M"
    if not match:
        return None
    base = filename[: -len(".csv")]
    parts = base.split("_")
    if len(parts) < 4:
        return None
    sn, date_str, time_str = parts[1], parts[2], parts[3]
    try:
        return sn, datetime.strptime(f"{date_str} {time_str}", fmt)
    except ValueError:
        return None


def kind_of(filename: str) -> str:
    if parse_test_name(filename):
        return "tests"
    if parse_results_name(filename):
        return "results"
    if filename.startswith("inverter_"):
        return "tests"
    return "results"


def expected_partner_basename(filename: str, kind: str) -> str | None:
    if kind == "results":
        parsed = parse_results_name(filename)
        if not parsed:
            return None
        return f"inverter_{filename}"
    if kind == "tests" and filename.startswith("inverter_"):
        return filename[len("inverter_") :]
    return None


def infer_pcloud_root(sources: list[dict], explicit: Path | None) -> Path:
    if explicit:
        root = explicit.expanduser().resolve()
        if not root.is_dir():
            sys.exit(f"pCloud root is not a directory: {root}")
        return root
    paths = []
    for src in sources:
        for key in ("results_dir", "data_dir"):
            raw = src.get(key)
            if raw:
                paths.append(Path(raw).expanduser())
    if not paths:
        sys.exit("no source directories in config; pass --pcloud-root")
    try:
        root = Path(os.path.commonpath(paths))
    except ValueError:
        sys.exit("source dirs do not share a prefix; pass --pcloud-root")
    if root.as_posix() in ("/", "."):
        sys.exit(f"inferred pCloud root {root} looks wrong; pass --pcloud-root")
    return root


def rel_to_root(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def list_csvs(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    return sorted(
        p
        for p in directory.iterdir()
        if p.is_file() and not p.name.startswith(".") and p.suffix.lower() == ".csv"
    )


def collect_queue(main_dir: Path, include_quarantine: bool) -> list[dict]:
    rows = []
    to_process = main_dir / "to_process"
    for kind in ("results", "tests"):
        for path in list_csvs(to_process / kind):
            rows.append(
                {
                    "kind": kind,
                    "basename": path.name,
                    "origin": "to_process",
                    "queue_relpath": f"to_process/{kind}/{path.name}",
                }
            )
    if not include_quarantine:
        return rows
    quarantine = main_dir / "quarantine"
    if not quarantine.is_dir():
        return rows
    for kind in ("results", "tests"):
        for path in list_csvs(quarantine / kind):
            rows.append(
                {
                    "kind": kind,
                    "basename": path.name,
                    "origin": "quarantine",
                    "queue_relpath": f"quarantine/{kind}/{path.name}",
                }
            )
    for batch in sorted(quarantine.iterdir()):
        if not batch.is_dir() or batch.name in ("results", "tests"):
            continue
        for kind in ("results", "tests"):
            for path in list_csvs(batch / kind):
                rows.append(
                    {
                        "kind": kind,
                        "basename": path.name,
                        "origin": f"quarantine/{batch.name}",
                        "queue_relpath": f"quarantine/{batch.name}/{kind}/{path.name}",
                    }
                )
    return rows


def collect_names_file(path: Path) -> list[dict]:
    rows = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        rel = line.replace("\\", "/")
        basename = Path(rel).name
        kind = "tests" if "/tests/" in f"/{rel}" else kind_of(basename)
        if rel.startswith("tests/"):
            kind = "tests"
        elif rel.startswith("results/"):
            kind = "results"
        rows.append(
            {
                "kind": kind,
                "basename": basename,
                "origin": "names-file",
                "queue_relpath": rel if "/" in rel else f"{kind}/{basename}",
            }
        )
    return rows


def index_pcloud(sources: list[dict], root: Path) -> dict:
    """basename -> list of {source, kind, relpath}."""
    index: dict[str, list[dict]] = defaultdict(list)
    tests_by_sn: dict[str, list[tuple[str, datetime, str]]] = defaultdict(list)
    results_by_sn: dict[str, list[tuple[str, datetime, str]]] = defaultdict(list)
    listed = 0
    missing_dirs = []
    for src in sources:
        name = src.get("name") or "?"
        mapping = (
            ("results", src.get("results_dir")),
            ("tests", src.get("data_dir")),
        )
        for kind, raw in mapping:
            if not raw:
                continue
            directory = Path(raw).expanduser()
            if not directory.is_dir():
                missing_dirs.append(str(directory))
                continue
            for path in list_csvs(directory):
                rel = rel_to_root(path, root)
                index[path.name].append(
                    {"source": name, "kind": kind, "relpath": rel}
                )
                listed += 1
                if kind == "tests":
                    parsed = parse_test_name(path.name)
                    if parsed:
                        tests_by_sn[parsed[0]].append((path.name, parsed[1], rel))
                else:
                    parsed = parse_results_name(path.name)
                    if parsed:
                        results_by_sn[parsed[0]].append((path.name, parsed[1], rel))
    return {
        "by_name": index,
        "tests_by_sn": tests_by_sn,
        "results_by_sn": results_by_sn,
        "listed": listed,
        "missing_dirs": missing_dirs,
    }


def watchdog_partner(
    kind: str,
    filename: str,
    pcloud: dict,
) -> tuple[str | None, str | None]:
    """Same pairing rule as watchdog: latest test with S <= T within 3 days."""
    if kind == "results":
        parsed = parse_results_name(filename)
        if not parsed:
            return None, None
        sn, tstamp = parsed
        window = tstamp - timedelta(days=3)
        candidates = [
            (name, started, rel)
            for name, started, rel in pcloud["tests_by_sn"].get(sn, [])
            if started <= tstamp
        ]
        if not candidates:
            return None, None
        name, started, rel = max(candidates, key=lambda row: row[1])
        if started < window:
            return None, None
        return name, rel
    parsed = parse_test_name(filename)
    if not parsed:
        return expected_partner_basename(filename, kind), None
    sn, started = parsed
    window = started + timedelta(days=3)
    candidates = [
        (name, tstamp, rel)
        for name, tstamp, rel in pcloud["results_by_sn"].get(sn, [])
        if started <= tstamp <= window
    ]
    if not candidates:
        exact = expected_partner_basename(filename, kind)
        return exact, None
    name, _, rel = min(candidates, key=lambda row: row[1])
    return name, rel


def load_ingested_source_files(db: dict) -> set[str]:
    names: set[str] = set()
    if not db or not db.get("name") or not db.get("user"):
        return names
    env = os.environ.copy()
    if db.get("password") is not None:
        env["PGPASSWORD"] = str(db["password"])
    cmd = [
        "psql",
        "-h",
        str(db.get("host") or "localhost"),
        "-p",
        str(db.get("port") or 5432),
        "-U",
        str(db["user"]),
        "-d",
        str(db["name"]),
        "-tAc",
        "SELECT source_file FROM Tests WHERE source_file IS NOT NULL",
    ]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, env=env, timeout=30
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as err:
        print(f"warning: could not load Tests.source_file ({err})", file=sys.stderr)
        return names
    if result.returncode != 0:
        err = (result.stderr or result.stdout or "").strip().splitlines()
        print(
            f"warning: psql failed (exit {result.returncode}): "
            f"{err[-1] if err else 'no output'}",
            file=sys.stderr,
        )
        return names
    for line in result.stdout.splitlines():
        raw = line.strip()
        if not raw or raw.startswith("https:"):
            continue
        base = os.path.basename(raw)
        names.add(base)
        if not base.startswith("inverter_"):
            names.add("inverter_" + base)
    return names


def processed_has(main_dir: Path, kind: str, filename: str) -> bool:
    return (main_dir / "processed" / kind / filename).is_file()


def queue_has(queue_names: set[tuple[str, str]], kind: str, filename: str) -> bool:
    return (kind, filename) in queue_names


def classify(row: dict, pcloud: dict, ingested: set[str], main_dir: Path, queue_names: set[tuple[str, str]]) -> dict:
    basename = row["basename"]
    kind = row["kind"]
    hits = pcloud["by_name"].get(basename, [])
    if kind == "tests":
        hits = [h for h in hits if h["kind"] == "tests"] or hits
    else:
        hits = [h for h in hits if h["kind"] == "results"] or hits

    pcloud_rel = "|".join(h["relpath"] for h in hits)
    sources = "|".join(h["source"] for h in hits)

    parsed = parse_test_name(basename) if kind == "tests" else parse_results_name(basename)
    serial = parsed[0] if parsed else ""
    file_ts = parsed[1].isoformat(sep=" ") if parsed else ""

    partner_name, partner_rel = watchdog_partner(kind, basename, pcloud)
    if partner_name and not partner_rel:
        partner_hits = pcloud["by_name"].get(partner_name, [])
        partner_rel = "|".join(h["relpath"] for h in partner_hits) or ""

    partner_kind = "tests" if kind == "results" else "results"
    in_db = basename in ingested
    partner_in_db = bool(partner_name and partner_name in ingested)
    partner_in_pcloud = bool(partner_rel)
    partner_in_processed = bool(partner_name and processed_has(main_dir, partner_kind, partner_name))
    partner_in_queue = bool(partner_name and queue_has(queue_names, partner_kind, partner_name))

    if parsed is None:
        reason = "unparseable_name"
    elif not hits and row["origin"] != "pcloud":
        reason = "not_on_pcloud"
    elif in_db:
        reason = "already_in_db"
    elif partner_in_db:
        reason = "already_in_db_partner"
    elif partner_in_processed:
        reason = "partner_in_processed"
    elif not partner_name or not partner_in_pcloud:
        reason = "no_partner_in_pcloud"
    elif row["origin"] != "pcloud" and not partner_in_queue:
        reason = "no_partner_in_queue"
    elif partner_in_queue:
        reason = "pair_both_in_queue"
    else:
        reason = "unknown"

    return {
        **row,
        "pcloud_relpath": pcloud_rel,
        "source_name": sources,
        "serial": serial,
        "file_timestamp": file_ts,
        "partner_basename": partner_name or "",
        "partner_pcloud_relpath": partner_rel or "",
        "partner_in_queue": "yes" if partner_in_queue else "no",
        "partner_in_processed": "yes" if partner_in_processed else "no",
        "partner_in_pcloud": "yes" if partner_in_pcloud else "no",
        "in_db_source_file": "yes" if in_db else "no",
        "partner_in_db_source_file": "yes" if partner_in_db else "no",
        "likely_reason": reason,
    }


def collect_pcloud_leftovers(pcloud: dict, ingested: set[str], main_dir: Path) -> list[dict]:
    rows = []
    seen = set()
    for basename, hits in pcloud["by_name"].items():
        result_hits = [h for h in hits if h["kind"] == "results"]
        if not result_hits:
            continue
        if basename in ingested:
            continue
        if processed_has(main_dir, "results", basename):
            continue
        if basename in seen:
            continue
        seen.add(basename)
        rows.append(
            {
                "kind": "results",
                "basename": basename,
                "origin": "pcloud",
                "queue_relpath": "",
            }
        )
    rows.sort(key=lambda r: r["basename"])
    return rows


def write_report(out_dir: Path, rows: list[dict], meta: dict, sample_n: int, seed: int) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "unprocessed.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    counts = Counter(r["likely_reason"] for r in rows)
    origins = Counter(r["origin"] for r in rows)
    kinds = Counter(r["kind"] for r in rows)
    on_pcloud = sum(1 for r in rows if r["pcloud_relpath"])
    summary_path = out_dir / "SUMMARY.txt"
    lines = [
        f"generated_at_utc     {meta['generated_at']}",
        f"pcloud_root          {meta['pcloud_root']}",
        f"main_dir             {meta['main_dir']}",
        f"ingested_names       {meta['ingested_names']}",
        f"pcloud_files_listed  {meta['pcloud_listed']}",
        f"rows                 {len(rows)}",
        f"on_pcloud            {on_pcloud}",
        f"not_on_pcloud        {len(rows) - on_pcloud}",
        "",
        "by_kind:",
    ]
    for key, value in sorted(kinds.items()):
        lines.append(f"  {key:12} {value}")
    lines.append("")
    lines.append("by_origin:")
    for key, value in sorted(origins.items()):
        lines.append(f"  {key:24} {value}")
    lines.append("")
    lines.append("by_likely_reason:")
    for key, value in counts.most_common():
        lines.append(f"  {key:28} {value}")
    if meta.get("missing_dirs"):
        lines.append("")
        lines.append("missing_source_dirs:")
        for item in meta["missing_dirs"]:
            lines.append(f"  {item}")
    lines.append("")
    lines.append("likely_reason meanings:")
    lines.append("  already_in_db            this basename is Tests.source_file (or inverter_ twin)")
    lines.append("  already_in_db_partner    watchdog partner was ingested; this file is leftover")
    lines.append("  partner_in_processed     partner sits in processed/")
    lines.append("  no_partner_in_pcloud     no matching test/results on the pCloud mount")
    lines.append("  no_partner_in_queue      partner is on pCloud but not in to_process/quarantine")
    lines.append("  pair_both_in_queue       both sides are in the queue (ingest still did not take them)")
    lines.append("  not_on_pcloud            queue basename not found under any source dir")
    lines.append("  unparseable_name         filename is not inverter_* or SN_YYYY-MM-DD_HH-MM[-SS].csv")
    lines.append("  unknown                  partner exists; reason needs a look at the CSV / ingest log")
    lines.append("")
    lines.append(f"csv  {csv_path}")
    summary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    if sample_n > 0 and rows:
        rng = random.Random(seed)
        sample = rows if len(rows) <= sample_n else rng.sample(rows, sample_n)
        sample = sorted(sample, key=lambda r: (r["likely_reason"], r["basename"]))
        sample_path = out_dir / f"sample-{min(sample_n, len(sample))}.csv"
        with sample_path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=CSV_COLUMNS, extrasaction="ignore")
            writer.writeheader()
            for row in sample:
                writer.writerow(row)
        summary_path.write_text(
            summary_path.read_text(encoding="utf-8") + f"sample  {sample_path}\n",
            encoding="utf-8",
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n\n", 1)[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--repo",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="repo root containing config.json",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="output directory (default: {main_dir}/unprocessed-report-<utc>)",
    )
    parser.add_argument(
        "--pcloud-root",
        type=Path,
        default=None,
        help="pCloud mountpoint; default is the common prefix of source dirs",
    )
    parser.add_argument(
        "--from-pcloud",
        action="store_true",
        help="list pCloud results that are not Tests.source_file / processed",
    )
    parser.add_argument(
        "--queue-only",
        action="store_true",
        help="do not include quarantine/ (to_process only)",
    )
    parser.add_argument(
        "--skip-queue",
        action="store_true",
        help="do not read to_process/quarantine (use with --from-pcloud or --names-file)",
    )
    parser.add_argument(
        "--names-file",
        type=Path,
        default=None,
        help="extra basenames (one per line) to locate on pCloud",
    )
    parser.add_argument(
        "--sample",
        type=int,
        default=200,
        help="also write a random sample CSV (0 to skip). default 200",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=1,
        help="rng seed for --sample",
    )
    args = parser.parse_args()

    config = load_config(args.repo)
    sources = config["paths"]["source_directories"]
    main_dir = Path(config["paths"]["local"]["main_dir"]).expanduser()
    pcloud_root = infer_pcloud_root(sources, args.pcloud_root)

    print(f"main_dir      {main_dir}")
    print(f"pcloud_root   {pcloud_root}")

    pcloud = index_pcloud(sources, pcloud_root)
    print(f"pcloud_files  {pcloud['listed']}")
    if pcloud["missing_dirs"]:
        print(f"missing_dirs  {len(pcloud['missing_dirs'])} (see SUMMARY)")

    ingested = load_ingested_source_files(config.get("database") or {})
    print(f"ingested_db   {len(ingested)}")

    raw_rows: list[dict] = []
    if not args.skip_queue:
        raw_rows.extend(collect_queue(main_dir, include_quarantine=not args.queue_only))
    if args.names_file:
        raw_rows.extend(collect_names_file(args.names_file))
    if args.from_pcloud:
        raw_rows.extend(collect_pcloud_leftovers(pcloud, ingested, main_dir))

    # Dedup by (kind, basename), prefer queue origin over pcloud reconstruction
    dedup: dict[tuple[str, str], dict] = {}
    origin_rank = {"to_process": 0, "names-file": 1, "pcloud": 9}
    for row in raw_rows:
        key = (row["kind"], row["basename"])
        existing = dedup.get(key)
        if existing is None:
            dedup[key] = row
            continue
        old_rank = origin_rank.get(existing["origin"], 5)
        new_rank = origin_rank.get(row["origin"], 5)
        if new_rank < old_rank:
            dedup[key] = row
    raw_rows = list(dedup.values())

    if not raw_rows:
        print(
            "no files to report. On prod run against to_process; "
            "on lab use --from-pcloud or --names-file.",
            file=sys.stderr,
        )
        return 1

    queue_names = {(r["kind"], r["basename"]) for r in raw_rows if r["origin"] != "pcloud"}
    classified = [
        classify(row, pcloud, ingested, main_dir, queue_names) for row in raw_rows
    ]
    classified.sort(key=lambda r: (r["likely_reason"], r["kind"], r["basename"]))

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = args.out or (main_dir / f"unprocessed-report-{stamp}")
    write_report(
        out_dir,
        classified,
        {
            "generated_at": datetime.now().astimezone().isoformat(),
            "pcloud_root": str(pcloud_root),
            "main_dir": str(main_dir),
            "ingested_names": len(ingested),
            "pcloud_listed": pcloud["listed"],
            "missing_dirs": pcloud["missing_dirs"],
        },
        sample_n=args.sample,
        seed=args.seed,
    )

    counts = Counter(r["likely_reason"] for r in classified)
    print(f"rows          {len(classified)}")
    print(f"out           {out_dir}")
    print("reasons:")
    for key, value in counts.most_common():
        print(f"  {value:6}  {key}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
