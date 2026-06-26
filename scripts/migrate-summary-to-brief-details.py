#!/usr/bin/env python3
"""Migrate old body-like task summaries into Brief/Details semantics.

The DB column names stay as summary/description for compatibility:
- summary becomes the short, map-visible Brief.
- description becomes the longer Details body.

Rows are changed only when summary is longer than LONG_SUMMARY_LIMIT. Before
applying or restoring, the script creates a full SQLite backup and a JSON report.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


LONG_SUMMARY_LIMIT = 240
DEFAULT_BRIEF_LIMIT = 180


def utc_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def default_db_path() -> Path:
    return Path(os.environ.get("VIBETASKS_DB", "~/.vibetasks/vibetasks.db")).expanduser()


def default_backup_dir() -> Path:
    return Path("~/.vibetasks/backups").expanduser()


def normalize_space(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def trim_to_word(text: str, limit: int) -> str:
    text = normalize_space(text)
    if len(text) <= limit:
        return text
    cut = text[: max(0, limit - 3)].rstrip()
    last_space = cut.rfind(" ")
    if last_space >= max(30, limit // 2):
        cut = cut[:last_space].rstrip()
    return f"{cut}..."


def make_brief(summary: str, limit: int) -> str:
    text = normalize_space(summary)
    if not text:
        return ""

    # Prefer a useful first sentence, but avoid tiny prefixes like "DONE."
    for match in re.finditer(r"[.!?](?:\s|$)", text):
        end = match.end()
        if 60 <= end <= limit:
            return trim_to_word(text[:end], limit)
        if end > limit:
            break

    # Common task bodies use colon/dash boundaries before details.
    for sep in (": ", " - ", " -- "):
        idx = text.find(sep)
        if 60 <= idx + len(sep) <= limit:
            return trim_to_word(text[: idx + len(sep)].rstrip(" -:"), limit)

    return trim_to_word(text, limit)


def connect(db_path: Path) -> sqlite3.Connection:
    if not db_path.exists():
        raise SystemExit(f"DB not found: {db_path}")
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def fetch_tasks(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return list(
        conn.execute(
            """
            SELECT
              t.id, t.ref, t.title, t.summary, t.description, t.status,
              p.name AS project_name
            FROM task t
            JOIN project p ON p.id = t.project_id
            ORDER BY p.name, t.ref
            """
        )
    )


def build_plan(rows: list[sqlite3.Row], brief_limit: int) -> list[dict[str, Any]]:
    changes: list[dict[str, Any]] = []
    for row in rows:
        old_summary = row["summary"] or ""
        old_description = row["description"] or ""
        if len(old_summary) <= LONG_SUMMARY_LIMIT:
            continue

        new_summary = make_brief(old_summary, brief_limit)
        if old_description.strip():
            reason = "long_summary_with_existing_details"
            new_description = (
                old_description.rstrip()
                + "\n\nPrevious long summary preserved during Brief/Details migration:\n"
                + old_summary.strip()
            )
        else:
            reason = "long_summary_promoted_to_details"
            new_description = old_summary.strip()

        changes.append(
            {
                "id": row["id"],
                "ref": row["ref"],
                "project": row["project_name"],
                "title": row["title"],
                "status": row["status"],
                "reason": reason,
                "old_summary": old_summary,
                "old_description": old_description,
                "new_summary": new_summary,
                "new_description": new_description,
                "old_summary_len": len(old_summary),
                "old_description_len": len(old_description),
                "new_summary_len": len(new_summary),
                "new_description_len": len(new_description),
            }
        )
    return changes


def summarize(changes: list[dict[str, Any]]) -> dict[str, Any]:
    by_project: dict[str, int] = {}
    by_reason: dict[str, int] = {}
    for change in changes:
        by_project[change["project"]] = by_project.get(change["project"], 0) + 1
        by_reason[change["reason"]] = by_reason.get(change["reason"], 0) + 1
    return {
        "changed": len(changes),
        "by_project": dict(sorted(by_project.items())),
        "by_reason": dict(sorted(by_reason.items())),
    }


def backup_db(conn: sqlite3.Connection, db_path: Path, backup_dir: Path, label: str) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup_path = backup_dir / f"{db_path.stem}-{label}-{utc_stamp()}.db"
    dest = sqlite3.connect(str(backup_path))
    try:
        conn.backup(dest)
    finally:
        dest.close()
    return backup_path


def write_report(
    report_path: Path,
    *,
    migration_id: str,
    db_path: Path,
    backup_path: Path | None,
    mode: str,
    brief_limit: int,
    changes: list[dict[str, Any]],
) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "migration_id": migration_id,
        "created_at": iso_now(),
        "mode": mode,
        "db_path": str(db_path),
        "backup_path": str(backup_path) if backup_path else None,
        "long_summary_limit": LONG_SUMMARY_LIMIT,
        "brief_limit": brief_limit,
        "summary": summarize(changes),
        "changes": changes,
    }
    report_path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def print_summary(label: str, changes: list[dict[str, Any]], report_path: Path | None, backup_path: Path | None) -> None:
    stats = summarize(changes)
    print(f"{label}: {stats['changed']} task(s)")
    for project, count in stats["by_project"].items():
        print(f"  {project}: {count}")
    for reason, count in stats["by_reason"].items():
        print(f"  {reason}: {count}")
    if backup_path:
        print(f"backup: {backup_path}")
    if report_path:
        print(f"report: {report_path}")
    for change in changes[:8]:
        print(
            f"  #{change['ref']} {change['project']}: "
            f"{change['old_summary_len']} -> {change['new_summary_len']} summary chars"
        )
    if len(changes) > 8:
        print(f"  ... {len(changes) - 8} more")


def apply_changes(conn: sqlite3.Connection, changes: list[dict[str, Any]]) -> None:
    now = iso_now()
    with conn:
        conn.executemany(
            """
            UPDATE task
            SET summary = :new_summary,
                description = :new_description,
                updated_at = :updated_at
            WHERE id = :id
            """,
            [
                {
                    "id": change["id"],
                    "new_summary": change["new_summary"],
                    "new_description": change["new_description"],
                    "updated_at": now,
                }
                for change in changes
            ],
        )


def restore_from_report(conn: sqlite3.Connection, report: dict[str, Any]) -> int:
    changes = report.get("changes", [])
    now = iso_now()
    with conn:
        conn.executemany(
            """
            UPDATE task
            SET summary = :old_summary,
                description = :old_description,
                updated_at = :updated_at
            WHERE id = :id
            """,
            [
                {
                    "id": change["id"],
                    "old_summary": change["old_summary"],
                    "old_description": change["old_description"],
                    "updated_at": now,
                }
                for change in changes
            ],
        )
    return len(changes)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=default_db_path(), help="SQLite DB path")
    parser.add_argument("--backup-dir", type=Path, default=default_backup_dir(), help="Backup/report directory")
    parser.add_argument("--report", type=Path, help="JSON report path")
    parser.add_argument("--brief-limit", type=int, default=DEFAULT_BRIEF_LIMIT, help="Generated Brief max chars")
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true", help="Plan changes and write a report; no DB writes")
    mode.add_argument("--apply", action="store_true", help="Backup DB, write report, then migrate")
    mode.add_argument("--restore-report", type=Path, help="Backup DB, then restore old fields from a report")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    db_path = args.db.expanduser()
    backup_dir = args.backup_dir.expanduser()
    conn = connect(db_path)
    migration_id = f"summary-brief-details-{utc_stamp()}"

    try:
        if args.restore_report:
            report = json.loads(args.restore_report.expanduser().read_text(encoding="utf-8"))
            backup_path = backup_db(conn, db_path, backup_dir, "before-brief-details-restore")
            restored = restore_from_report(conn, report)
            print(f"RESTORED: {restored} task(s)")
            print(f"backup: {backup_path}")
            return 0

        rows = fetch_tasks(conn)
        changes = build_plan(rows, args.brief_limit)
        report_path = (
            args.report.expanduser()
            if args.report
            else backup_dir / f"{migration_id}.json"
        )

        if args.dry_run:
            write_report(
                report_path,
                migration_id=migration_id,
                db_path=db_path,
                backup_path=None,
                mode="dry-run",
                brief_limit=args.brief_limit,
                changes=changes,
            )
            print_summary("DRY RUN", changes, report_path, None)
            return 0

        backup_path = backup_db(conn, db_path, backup_dir, "before-brief-details")
        write_report(
            report_path,
            migration_id=migration_id,
            db_path=db_path,
            backup_path=backup_path,
            mode="apply",
            brief_limit=args.brief_limit,
            changes=changes,
        )
        apply_changes(conn, changes)
        print_summary("APPLIED", changes, report_path, backup_path)
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
