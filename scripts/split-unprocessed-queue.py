#!/usr/bin/env python3
"""
Split the live to_process queue using an unprocessed.csv report.

Reads the report from scripts/report-unprocessed-queue.py, checks the
database for the leftover "is this basename already used?" bit, then:

  quarantine/unmatched-STAMP/{results,tests}/
      already_in_db
      already_in_db_partner
      partner_in_processed
      no_partner_in_queue files whose basename is already in TestData/Tests

  recovery/pair-both-STAMP/{results,tests}/
      pair_both_in_queue  (includes the two already-used tests; flagged)

  recovery/orphans-STAMP/{results,tests}/
      no_partner_in_queue files that are NOT in the DB (recoverable)

Live to_process is emptied of classified files. Watchdog treats
quarantine/ and recovery/ as seen and will not recopy those basenames.
Restart burnin-watchdog from a watchdog.py that knows about recovery/.

Does not delete anything. Does not ingest. Does not write the database.
Does not write into processed/.

Usage (on prod, watchdog stopped):

  python3 scripts/split-unprocessed-queue.py \\
      --report /tmp/unprocessed-queue/unprocessed.csv          # dry-run
  python3 scripts/split-unprocessed-queue.py \\
      --report /tmp/unprocessed-queue/unprocessed.csv --apply
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


QUARANTINE_REASONS = {
    "already_in_db",
    "already_in_db_partner",
    "partner_in_processed",
}
RECOVERY_PAIR_BOTH = "pair_both_in_queue"
RECOVERY_ORPHAN_CANDIDATE = "no_partner_in_queue"


def load_config(repo_root: Path) -> dict:
    path = repo_root / "config.json"
    if not path.is_file():
        sys.exit(f"config.json not found at {path}")
    with path.open() as f:
        return json.load(f)


def lock_is_held(main_dir: Path) -> bool:
    lock = main_dir / ".ingestion.lock"
    if not lock.is_file():
        return False
    try:
        data = json.loads(lock.read_text())
        pid = data.get("pid")
        if isinstance(pid, int) and pid > 0:
            os.kill(pid, 0)
            return True
    except (OSError, json.JSONDecodeError, TypeError):
        return False
    return False


def list_queue_files(directory: Path) -> dict[str, Path]:
    if not directory.is_dir():
        return {}
    return {
        p.name: p
        for p in directory.iterdir()
        if p.is_file() and not p.name.startswith(".")
    }


def load_source_files(db: dict, table: str) -> set[str]:
    if table not in ("Tests", "TestData"):
        raise ValueError(table)
    env = os.environ.copy()
    if db.get("password") is not None:
        env["PGPASSWORD"] = str(db["password"])
    distinct = "DISTINCT " if table == "TestData" else ""
    sql = f"SELECT {distinct}source_file FROM {table} WHERE source_file IS NOT NULL"
    cmd = [
        "psql",
        "-h",
        str(db.get("host") or "localhost"),
        "-p",
        str(db.get("port") or 5432),
        "-U",
        str(db.get("user") or "postgres"),
        "-d",
        str(db["name"]),
        "-tAc",
        sql,
    ]
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, env=env, timeout=120
        )
    except FileNotFoundError:
        sys.exit("psql not on PATH — cannot classify used vs unused leftovers")
    except subprocess.TimeoutExpired:
        sys.exit(f"psql timed out loading {table}.source_file")
    if result.returncode != 0:
        err = (result.stderr or result.stdout or "").strip().splitlines()
        sys.exit(
            f"psql failed loading {table}.source_file "
            f"(exit {result.returncode}): {err[-1] if err else 'no output'}"
        )
    names = set()
    for line in result.stdout.splitlines():
        raw = line.strip()
        if not raw or raw.startswith("https:"):
            continue
        names.add(os.path.basename(raw))
    return names


def already_used(kind: str, basename: str, tests_sf: set[str], testdata_sf: set[str]) -> bool:
    if kind == "tests":
        return basename in testdata_sf
    return basename in tests_sf


def decide_bucket(reason: str, kind: str, basename: str, tests_sf: set[str], testdata_sf: set[str]) -> tuple[str, str]:
    """Return (bucket, note). bucket is quarantine | pair-both | orphans | skip."""
    used = already_used(kind, basename, tests_sf, testdata_sf)
    if reason in QUARANTINE_REASONS:
        return "quarantine", "used" if used else "report-class"
    if reason == RECOVERY_PAIR_BOTH:
        return "pair-both", "already-used-do-not-reingest" if used else "unused-missed-pair"
    if reason == RECOVERY_ORPHAN_CANDIDATE:
        if used:
            return "quarantine", "orphan-but-already-in-db"
        return "orphans", "unused-orphan-recover"
    return "skip", f"unexpected-reason:{reason}"


def load_report(path: Path) -> list[dict]:
    with path.open(newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    if not rows:
        sys.exit(f"report is empty: {path}")
    if "likely_reason" not in rows[0] or "basename" not in rows[0] or "kind" not in rows[0]:
        sys.exit(f"report is missing required columns: {path}")
    dedup: dict[tuple[str, str], dict] = {}
    for row in rows:
        kind = (row.get("kind") or "").strip()
        basename = (row.get("basename") or "").strip()
        if kind not in ("results", "tests") or not basename:
            continue
        dedup[(kind, basename)] = row
    return list(dedup.values())


def write_csv(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__.split("\n\n", 1)[0],
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--report",
        type=Path,
        required=True,
        help="unprocessed.csv from report-unprocessed-queue.py",
    )
    parser.add_argument(
        "--repo",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="repo root containing config.json",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="actually move files (default is dry-run)",
    )
    args = parser.parse_args()

    report_path = args.report.expanduser()
    if not report_path.is_file():
        sys.exit(f"report not found: {report_path}")

    config = load_config(args.repo)
    main_dir = Path(config["paths"]["local"]["main_dir"]).expanduser()
    to_process = main_dir / "to_process"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    dest = {
        "quarantine": main_dir / "quarantine" / f"unmatched-{stamp}",
        "pair-both": main_dir / "recovery" / f"pair-both-{stamp}",
        "orphans": main_dir / "recovery" / f"orphans-{stamp}",
    }
    split_dir = main_dir / f"queue-split-{stamp}"

    report_rows = load_report(report_path)
    tests_sf = load_source_files(config.get("database") or {}, "Tests")
    testdata_sf = load_source_files(config.get("database") or {}, "TestData")

    on_disk = {
        "results": list_queue_files(to_process / "results"),
        "tests": list_queue_files(to_process / "tests"),
    }
    disk_keys = {(kind, name) for kind, files in on_disk.items() for name in files}

    planned: list[dict] = []
    missing: list[dict] = []
    skipped: list[dict] = []

    for row in report_rows:
        kind = row["kind"]
        basename = row["basename"]
        reason = (row.get("likely_reason") or "").strip()
        bucket, note = decide_bucket(kind=kind, basename=basename, reason=reason, tests_sf=tests_sf, testdata_sf=testdata_sf)
        src = on_disk[kind].get(basename) if kind in on_disk else None
        rec = {
            "kind": kind,
            "basename": basename,
            "likely_reason": reason,
            "bucket": bucket,
            "note": note,
            "serial": row.get("serial") or "",
            "partner_basename": row.get("partner_basename") or "",
            "source_name": row.get("source_name") or "",
            "file_timestamp": row.get("file_timestamp") or "",
            "src": str(src) if src else "",
            "dest": "",
        }
        if bucket == "skip":
            skipped.append(rec)
            continue
        if src is None:
            missing.append(rec)
            continue
        rec["dest"] = str(dest[bucket] / kind / basename)
        planned.append(rec)

    planned_keys = {(r["kind"], r["basename"]) for r in planned}
    extras = [
        {"kind": kind, "basename": name, "src": str(path)}
        for kind, files in on_disk.items()
        for name, path in sorted(files.items())
        if (kind, name) not in planned_keys
        and (kind, name) not in {(s["kind"], s["basename"]) for s in skipped}
    ]

    buckets = Counter(r["bucket"] for r in planned)
    notes = Counter(r["note"] for r in planned)

    print(f"report        {report_path}")
    print(f"main_dir      {main_dir}")
    print(f"to_process    {to_process}")
    print(f"db Tests.sf   {len(tests_sf)}")
    print(f"db TestData   {len(testdata_sf)}")
    print(f"report rows   {len(report_rows)}")
    print(f"on disk       {len(disk_keys)}")
    print(f"mode          {'APPLY' if args.apply else 'DRY-RUN'}")
    print("plan:")
    print(f"  quarantine  {buckets.get('quarantine', 0)}")
    print(f"  pair-both   {buckets.get('pair-both', 0)}")
    print(f"  orphans     {buckets.get('orphans', 0)}")
    print(f"  missing     {len(missing)}  (in report, not in to_process)")
    print(f"  extra       {len(extras)}  (in to_process, not moved)")
    print(f"  skipped     {len(skipped)}  (unexpected likely_reason)")
    print("notes:")
    for key, value in notes.most_common():
        print(f"  {value:6}  {key}")

    if lock_is_held(main_dir):
        sys.exit("ingest lock is held — stop the running ingest / watchdog and retry")

    action_fields = [
        "bucket",
        "note",
        "kind",
        "basename",
        "likely_reason",
        "serial",
        "partner_basename",
        "source_name",
        "file_timestamp",
        "src",
        "dest",
    ]
    if args.apply:
        plan_dir = split_dir
    else:
        plan_dir = report_path.parent / f"queue-split-plan-{stamp}"
    plan_dir.mkdir(parents=True, exist_ok=True)

    write_csv(plan_dir / "ACTIONS.csv", action_fields, planned)
    write_csv(
        plan_dir / "MISSING.csv",
        action_fields,
        missing,
    )
    write_csv(plan_dir / "EXTRA.csv", ["kind", "basename", "src"], extras)
    write_csv(plan_dir / "SKIPPED.csv", action_fields, skipped)

    summary = [
        f"generated_at_utc  {datetime.now(timezone.utc).isoformat()}",
        f"report            {report_path}",
        f"main_dir          {main_dir}",
        f"mode              {'APPLY' if args.apply else 'DRY-RUN'}",
        f"quarantine        {dest['quarantine']}",
        f"pair_both         {dest['pair-both']}",
        f"orphans           {dest['orphans']}",
        f"planned           {len(planned)}",
        f"quarantine_n      {buckets.get('quarantine', 0)}",
        f"pair_both_n       {buckets.get('pair-both', 0)}",
        f"orphans_n         {buckets.get('orphans', 0)}",
        f"missing_n         {len(missing)}",
        f"extra_n           {len(extras)}",
        f"skipped_n         {len(skipped)}",
        "",
        "Do not run npm run ingest against these trees.",
        "pair-both unused-missed-pair is the 34-candidate one-shot set.",
        "pair-both already-used-do-not-reingest stays for metadata only.",
        "orphans need their missing half copied from pCloud into isolated staging.",
        "",
    ]
    (plan_dir / "MANIFEST.txt").write_text("\n".join(summary), encoding="utf-8")
    print(f"plan written  {plan_dir}")

    if not args.apply:
        print("\nRe-run with --apply to move files. Stop burnin-watchdog first.")
        return 0

    if not planned:
        print("nothing to move")
        return 1 if missing or extras else 0

    for bucket in ("quarantine", "pair-both", "orphans"):
        if any(r["bucket"] == bucket for r in planned):
            for kind in ("results", "tests"):
                (dest[bucket] / kind).mkdir(parents=True, exist_ok=True)

    moved = 0
    errors: list[str] = []
    for rec in planned:
        src = Path(rec["src"])
        dst = Path(rec["dest"])
        dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.rename(src, dst)
            moved += 1
        except OSError as err:
            errors.append(f"rename {src} → {dst}: {err}")

    (plan_dir / "MANIFEST.txt").write_text(
        "\n".join(summary)
        + f"moved             {moved}\n"
        + f"errors            {len(errors)}\n"
        + (("\n".join(errors) + "\n") if errors else ""),
        encoding="utf-8",
    )
    print(f"moved         {moved}")
    print(f"manifest      {plan_dir / 'MANIFEST.txt'}")
    if errors:
        print(f"{len(errors)} errors — see manifest")
        return 1
    leftover = sum(len(list_queue_files(to_process / kind)) for kind in ("results", "tests"))
    print(f"to_process now {leftover} files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
