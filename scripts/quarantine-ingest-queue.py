#!/usr/bin/env python3
"""
Move leftover to_process/{results,tests} files out of the live ingest queue.

Ingest leaves unmatched / already-in-DB pairs in to_process forever. Watchdog
will recopy anything that is in neither to_process/ nor processed/, so this
script:

  1. Moves the real CSVs to
     {main_dir}/quarantine/unmatched-YYYYMMDD-HHMMSS/{results,tests}/
     (same filesystem = rename, no extra disk).
  2. Hard-links the same basenames into processed/{results,tests}/ so
     watchdog treats them as already seen and will not pull them from pCloud
     again.

Does not delete anything. Does not touch the database.

Usage (from the repo root, on the prod box):

  python3 scripts/quarantine-ingest-queue.py            # dry-run
  python3 scripts/quarantine-ingest-queue.py --apply    # do it

Stop the watchdog first so it cannot copy into a half-moved tree:

  sudo systemctl stop burnin-watchdog.service
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
    processed = main_dir / "processed"
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
        (processed / kind).mkdir(parents=True, exist_ok=True)

    moved = 0
    linked = 0
    already_processed = 0
    errors: list[str] = []

    for kind, files in (("results", results), ("tests", tests)):
        for src in files:
            dest = quarantine / kind / src.name
            marker = processed / kind / src.name
            try:
                os.rename(src, dest)
                moved += 1
            except OSError as err:
                errors.append(f"rename {src} → {dest}: {err}")
                continue
            if marker.exists():
                already_processed += 1
                continue
            try:
                os.link(dest, marker)
                linked += 1
            except OSError as err:
                errors.append(f"hardlink {dest} → {marker}: {err}")

    manifest = quarantine / "MANIFEST.txt"
    manifest.write_text(
        "\n".join(
            [
                f"quarantined_at_utc  {datetime.now(timezone.utc).isoformat()}",
                f"main_dir            {main_dir}",
                f"results_moved       {len(results)}",
                f"tests_moved         {len(tests)}",
                f"hardlinks_created   {linked}",
                f"already_in_processed {already_processed}",
                f"errors              {len(errors)}",
                "",
                "Files were moved out of to_process/ so Control Center queue",
                "goes empty. Hardlinks in processed/{results,tests}/ stop",
                "watchdog from recopying the same names from pCloud.",
                "Nothing was deleted. Restore = rename back to to_process/.",
                "",
            ]
        )
        + ("\n".join(errors) + "\n" if errors else ""),
        encoding="utf-8",
    )

    print(f"\nmoved {moved}  hardlinked {linked}  already-in-processed {already_processed}")
    print(f"manifest {manifest}")
    if errors:
        print(f"{len(errors)} errors — see manifest")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
