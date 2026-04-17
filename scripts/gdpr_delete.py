"""
gdpr_delete.py - Erase all data we hold about a user.
Satisfies the right to erasure / "right to be forgotten" (GDPR Art. 17).

The script:
  1. Auto-writes a final export (so the request is auditable) unless --no-backup.
  2. Deletes the user_settings row.
  3. Deletes every remember_tokens row for that user.
  4. Removes any gdpr_restricted flag for that user.

Usage:
    python scripts/gdpr_delete.py <discord_id>
    python scripts/gdpr_delete.py <discord_id> --yes      # skip confirmation
    python scripts/gdpr_delete.py <discord_id> --no-backup

Note: access logs are not touched - they only contain truncated IPs that
cannot be linked to a Discord ID, and they self-expire after 14 days.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

from _gdpr_common import (
    confirm,
    connect_user_db,
    ensure_export_dir,
    fetch_remember_tokens,
    fetch_restriction,
    fetch_user_settings,
    require_discord_id,
)


def _backup(conn, discord_id: str) -> str | None:
    settings = fetch_user_settings(conn, discord_id)
    tokens = fetch_remember_tokens(conn, discord_id)
    restriction = fetch_restriction(conn, discord_id)
    if settings is None and not tokens and restriction is None:
        return None
    out_dir = ensure_export_dir()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = os.path.join(out_dir, f"{discord_id}_{stamp}_pre-delete.json")
    payload = {
        "metadata": {
            "discord_id": discord_id,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "reason": "pre-deletion audit backup",
            "gdpr_article": "Art. 17 (erasure)",
        },
        "user_settings": settings,
        "remember_tokens": tokens,
        "restriction": restriction,
    }
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
    return out_path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("discord_id", help="Discord snowflake ID of the user")
    parser.add_argument(
        "--yes", action="store_true", help="Skip the interactive confirmation."
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Do not write a pre-deletion audit backup.",
    )
    args = parser.parse_args()

    discord_id = require_discord_id(args.discord_id)

    conn = connect_user_db()
    try:
        settings = fetch_user_settings(conn, discord_id)
        tokens = fetch_remember_tokens(conn, discord_id)

        if settings is None and not tokens:
            print(f"[INFO] No data found for discord_id={discord_id}. Nothing to delete.")
            return

        print(f"About to delete data for discord_id={discord_id}:")
        print(f"  - user_settings row:     {'yes' if settings else 'no'}")
        print(f"  - remember_tokens rows:  {len(tokens)}")
        if not confirm("Proceed with irreversible deletion?", args.yes):
            print("[ABORTED] No changes made.")
            return

        backup_path = None
        if not args.no_backup:
            backup_path = _backup(conn, discord_id)

        cur = conn.cursor()
        deleted_settings = cur.execute(
            "DELETE FROM user_settings WHERE discord_id = ?", (discord_id,)
        ).rowcount
        deleted_tokens = cur.execute(
            "DELETE FROM remember_tokens WHERE discord_id = ?", (discord_id,)
        ).rowcount
        try:
            deleted_restriction = cur.execute(
                "DELETE FROM gdpr_restricted WHERE discord_id = ?", (discord_id,)
            ).rowcount
        except Exception:
            deleted_restriction = 0
        conn.commit()
    finally:
        conn.close()

    print(f"[OK] Deleted {deleted_settings} user_settings row(s).")
    print(f"[OK] Deleted {deleted_tokens} remember_tokens row(s).")
    if deleted_restriction:
        print(f"[OK] Deleted {deleted_restriction} gdpr_restricted row(s).")
    if backup_path:
        print(f"[INFO] Audit backup written to: {backup_path}")


if __name__ == "__main__":
    main()
