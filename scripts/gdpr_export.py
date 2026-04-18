"""
gdpr_export.py - Export every piece of data we hold for a single user.
Satisfies the data subject's right of access (GDPR Art. 15) and the
right to data portability (Art. 20).

Usage:
    python scripts/gdpr_export.py <discord_id>
    python scripts/gdpr_export.py <discord_id> --stdout
    python scripts/gdpr_export.py <discord_id> --out path/to/file.json

The output is a single JSON document containing:
    - user_settings row (preferences, timestamps)
    - remember_tokens rows (with the raw token redacted)
    - gdpr_restricted flag if present
    - metadata describing the export
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

from _gdpr_common import (
    connect_user_db,
    ensure_export_dir,
    fetch_remember_tokens,
    fetch_restriction,
    fetch_user_settings,
    require_discord_id,
)


def build_export(conn, discord_id: str) -> dict:
    settings = fetch_user_settings(conn, discord_id)
    tokens = fetch_remember_tokens(conn, discord_id)
    restriction = fetch_restriction(conn, discord_id)
    return {
        "metadata": {
            "discord_id": discord_id,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "controller": "190Q",
            "controller_email": "esi.dashboard.support@gmail.com",
            "gdpr_articles": ["Art. 15 (access)", "Art. 20 (portability)"],
            "notes": (
                "Access logs are not included because they contain only "
                "truncated IP addresses that cannot be linked to a specific "
                "user. Logs are deleted after 14 days."
            ),
        },
        "user_settings": settings,
        "remember_tokens": tokens,
        "restriction": restriction,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("discord_id", help="Discord snowflake ID of the user")
    parser.add_argument(
        "--out",
        help="Output file path. Defaults to gdpr_exports/<id>_<timestamp>.json.",
    )
    parser.add_argument(
        "--stdout",
        action="store_true",
        help="Print the JSON to stdout instead of writing to a file.",
    )
    args = parser.parse_args()

    discord_id = require_discord_id(args.discord_id)

    conn = connect_user_db()
    try:
        payload = build_export(conn, discord_id)
    finally:
        conn.close()

    if payload["user_settings"] is None and not payload["remember_tokens"]:
        print(
            f"[WARN] No data found for discord_id={discord_id}. "
            "A valid response to the data subject is still "
            "'we hold no data about you'.",
            file=sys.stderr,
        )

    serialized = json.dumps(payload, indent=2, ensure_ascii=False)

    if args.stdout:
        print(serialized)
        return

    if args.out:
        out_path = args.out
    else:
        out_dir = ensure_export_dir()
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        out_path = os.path.join(out_dir, f"{discord_id}_{stamp}.json")

    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(serialized)
    print(f"[OK] Exported data for {discord_id} -> {out_path}")


if __name__ == "__main__":
    main()
