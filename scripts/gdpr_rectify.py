"""
gdpr_rectify.py - Correct inaccurate data we hold about a user.
Satisfies the right to rectification (GDPR Art. 16).

What you can change:
  * A single key/value pair inside the user's settings JSON, with --set.
  * Replace the whole settings blob with the contents of a JSON file, with --from-file.
  * Remove a specific key with --unset.

Usage:
    # Set one preference
    python scripts/gdpr_rectify.py <discord_id> --set defaultMetric playtime

    # Remove one preference
    python scripts/gdpr_rectify.py <discord_id> --unset defaultMetric

    # Replace the whole settings object
    python scripts/gdpr_rectify.py <discord_id> --from-file new_settings.json

The script always prints a diff (before/after) and asks for confirmation
unless --yes is passed.
"""

import argparse
import json
import sys
from time import time

from _gdpr_common import (
    confirm,
    connect_user_db,
    fetch_user_settings,
    require_discord_id,
)


def _parse_value(raw: str):
    """Try to parse --set value as JSON, otherwise keep it as a string."""
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return raw


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("discord_id", help="Discord snowflake ID of the user")

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--set",
        nargs=2,
        metavar=("KEY", "VALUE"),
        help="Set a single settings key. VALUE is parsed as JSON if possible.",
    )
    group.add_argument(
        "--unset",
        metavar="KEY",
        help="Remove a single settings key.",
    )
    group.add_argument(
        "--from-file",
        metavar="PATH",
        help="Replace the user's settings object with the JSON in this file.",
    )

    parser.add_argument(
        "--yes", action="store_true", help="Skip the interactive confirmation."
    )
    args = parser.parse_args()

    discord_id = require_discord_id(args.discord_id)

    conn = connect_user_db()
    try:
        existing = fetch_user_settings(conn, discord_id)
        current = (existing or {}).get("settings") or {}
        if not isinstance(current, dict):
            print(
                f"[ERROR] Current settings for {discord_id} is not a JSON object; "
                "refusing to rectify in-place. Use --from-file to overwrite.",
                file=sys.stderr,
            )
            sys.exit(2)

        new_settings = dict(current)

        if args.set:
            key, value = args.set
            new_settings[key] = _parse_value(value)
        elif args.unset:
            new_settings.pop(args.unset, None)
        elif args.from_file:
            with open(args.from_file, encoding="utf-8") as fh:
                loaded = json.load(fh)
            if not isinstance(loaded, dict):
                print("[ERROR] --from-file must contain a JSON object.", file=sys.stderr)
                sys.exit(2)
            new_settings = loaded

        if new_settings == current:
            print("[INFO] New settings are identical to current. Nothing to do.")
            return

        print(f"Rectifying settings for discord_id={discord_id}")
        print("---- BEFORE ----")
        print(json.dumps(current, indent=2, ensure_ascii=False, sort_keys=True))
        print("---- AFTER ----")
        print(json.dumps(new_settings, indent=2, ensure_ascii=False, sort_keys=True))
        if not confirm("Apply these changes?", args.yes):
            print("[ABORTED] No changes made.")
            return

        now = time()
        conn.execute(
            """
            INSERT INTO user_settings (discord_id, settings, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(discord_id) DO UPDATE
                SET settings = excluded.settings, updated_at = excluded.updated_at
            """,
            (discord_id, json.dumps(new_settings), now),
        )
        conn.commit()
    finally:
        conn.close()

    print(f"[OK] Rectified user_settings for {discord_id}.")


if __name__ == "__main__":
    main()
