#!/usr/bin/env python3
"""
Move leftover to_process/{results,tests} files out of the live ingest queue.

Ingest leaves unmatched / already-in-DB pairs in to_process forever. This
script moves those CSVs to

    {main_dir}/quarantine/unmatched-YYYYMMDD-HHMMSS/{results,tests}/

(same filesystem = rename, no extra disk). Watchdog treats anything already
under quarantine/ or processed/ as seen and will not recopy it from pCloud.
Watchdog also skips leftover pCloud results whose matching test is already
in processed/, and any basename already stored in Tests.source_file
(needed after a DB-only restore, when processed/ is empty). Restart
burnin-watchdog after pulling a watchdog.py that knows about all three
— an old process will recopy the pile.

Does not delete anything. Does not touch the database. Does not write into
processed/ (that directory is successfully ingested files only).

To split the queue from an unprocessed.csv report (quarantine slush,
park recoverable pairs), use scripts/split-unprocessed-queue.py instead.

Usage (from the repo root, on the prod box):

  git pull
  sudo systemctl stop burnin-watchdog.service
  python3 scripts/quarantine-ingest-queue.py            # dry-run
  python3 scripts/quarantine-ingest-queue.py --apply
  sudo systemctl start burnin-watchdog.service
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path


def load_config(repo_root: Path) -> dict:
    path = repo_root / "config.json"
    if not path.is_file():
        sys.exit(f"config.json not found at {path}")
    with path.open() as f:
        return json.load(f)


def list_queue_files(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    return sorted(
        p
        for p in directory.iterdir()
        if p.is_file() and not p.name.startswith(".")
    )


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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n", 1)[0])
    parser.add_argument(
        "--apply",
        action="store_true",
        help="actually move files (default is dry-run)",
    )
    parser.add_argument(
        "--repo",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="repo root containing config.json",
    )
    args = parser.parse_args()

    config = load_config(args.repo)
    main_dir = Path(config["paths"]["local"]["main_dir"])
    to_process = main_dir / "to_process"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    quarantine = main_dir / "quarantine" / f"unmatched-{stamp}"

    results = list_queue_files(to_process / "results")
    tests = list_queue_files(to_process / "tests")

    print(f"main_dir     {main_dir}")
    print(f"to_process   {to_process}")
    print(f"results      {len(results)} files")
    print(f"tests        {len(tests)} files")
    print(f"quarantine   {quarantine}")
    print(f"mode         {'APPLY' if args.apply else 'DRY-RUN'}")
    if results:
        print(f"  oldest result name: {results[0].name}")
        print(f"  newest result name: {results[-1].name}")
    if tests:
        print(f"  oldest test name:   {tests[0].name}")
        print(f"  newest test name:   {tests[-1].name}")

    if lock_is_held(main_dir):
        sys.exit("ingest lock is held — stop the running ingest / watchdog and retry")

    if not results and not tests:
        print("queue already empty")
        return 0

    if not args.apply:
        print("\nRe-run with --apply to move these files. Stop burnin-watchdog first.")
        return 0

    for kind in ("results", "tests"):
        (quarantine / kind).mkdir(parents=True, exist_ok=True)

    moved = 0
    errors: list[str] = []

    for kind, files in (("results", results), ("tests", tests)):
        for src in files:
            dest = quarantine / kind / src.name
            try:
                os.rename(src, dest)
                moved += 1
            except OSError as err:
                errors.append(f"rename {src} → {dest}: {err}")

    manifest = quarantine / "MANIFEST.txt"
    manifest.write_text(
        "\n".join(
            [
                f"quarantined_at_utc  {datetime.now(timezone.utc).isoformat()}",
                f"main_dir            {main_dir}",
                f"results_moved       {len(results)}",
                f"tests_moved         {len(tests)}",
                f"errors              {len(errors)}",
                "",
                "Files were moved out of to_process/ so the Control Center",
                "queue goes empty. Restarted watchdog will not recopy these",
                "basenames from pCloud (it checks quarantine/ and processed/).",
                "Nothing was deleted. Restore = rename back to to_process/.",
                "",
            ]
        )
        + ("\n".join(errors) + "\n" if errors else ""),
        encoding="utf-8",
    )

    print(f"\nmoved {moved}")
    print(f"manifest {manifest}")
    if errors:
        print(f"{len(errors)} errors — see manifest")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
