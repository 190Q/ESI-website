"""
gdpr_restrict.py - Restrict further processing of a user's data.
Satisfies the right to restriction of processing (GDPR Art. 18) and
gives a simple on/off mechanism for Art. 21 objections.

How restriction works here:
  * The user's Discord ID is added to the `gdpr_restricted` table.
  * Every remember_tokens row for that user is deleted, so they can no
    longer auto-login or trigger any server-side processing through that
    long-lived credential.
  * The user_settings row is kept (so that later the data subject can
    still receive a full export), but is effectively frozen: the app
    code can check this table and refuse to update it.

Usage:
    # Restrict a user
    python scripts/gdpr_restrict.py <discord_id> --reason "Pending accuracy review"

    # Check restriction status
    python scripts/gdpr_restrict.py <discord_id> --status

    # Lift restriction
    python scripts/gdpr_restrict.py <discord_id> --lift
"""

import argparse
import json
import sys

from _gdpr_common import (
    confirm,
    connect_user_db,
    ensure_restricted_table,
    fetch_restriction,
    now_ts,
    require_discord_id,
)


def _set_restriction(conn, discord_id: str, reason: str) -> None:
    ensure_restricted_table(conn)
    conn.execute(
        """
        INSERT INTO gdpr_restricted (discord_id, reason, restricted_at)
        VALUES (?, ?, ?)
        ON CONFLICT(discord_id) DO UPDATE
            SET reason = excluded.reason,
                restricted_at = excluded.restricted_at
        """,
        (discord_id, reason, now_ts()),
    )
    conn.commit()


def _lift_restriction(conn, discord_id: str) -> int:
    ensure_restricted_table(conn)
    cur = conn.execute(
        "DELETE FROM gdpr_restricted WHERE discord_id = ?", (discord_id,)
    )
    conn.commit()
    return cur.rowcount


def _drop_remember_tokens(conn, discord_id: str) -> int:
    cur = conn.execute(
        "DELETE FROM remember_tokens WHERE discord_id = ?", (discord_id,)
    )
    conn.commit()
    return cur.rowcount


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("discord_id", help="Discord snowflake ID of the user")

    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--reason",
        help="Reason for the restriction (shown in exports and audit logs).",
    )
    group.add_argument(
        "--lift",
        action="store_true",
        help="Remove the restriction for this user.",
    )
    group.add_argument(
        "--status",
        action="store_true",
        help="Show whether the user is currently restricted and exit.",
    )

    parser.add_argument(
        "--yes", action="store_true", help="Skip the interactive confirmation."
    )
    args = parser.parse_args()

    discord_id = require_discord_id(args.discord_id)

    conn = connect_user_db()
    try:
        ensure_restricted_table(conn)
        existing = fetch_restriction(conn, discord_id)

        if args.status or (not args.lift and not args.reason):
            if existing:
                print(
                    f"[STATUS] discord_id={discord_id} is RESTRICTED since "
                    f"{existing['restricted_at_iso']} (reason: {existing['reason']!r})."
                )
            else:
                print(f"[STATUS] discord_id={discord_id} is NOT restricted.")
            return

        if args.lift:
            if not existing:
                print(f"[INFO] discord_id={discord_id} is not restricted. Nothing to do.")
                return
            if not confirm(
                f"Lift restriction on discord_id={discord_id}?", args.yes
            ):
                print("[ABORTED] No changes made.")
                return
            removed = _lift_restriction(conn, discord_id)
            print(f"[OK] Lifted restriction ({removed} row(s) removed).")
            return

        # Apply restriction
        action = "Update" if existing else "Apply"
        print(
            f"{action} restriction on discord_id={discord_id} "
            f"with reason: {args.reason!r}"
        )
        if not confirm(
            "This will also revoke every 'remember me' token for that user. Proceed?",
            args.yes,
        ):
            print("[ABORTED] No changes made.")
            return

        _set_restriction(conn, discord_id, args.reason)
        removed_tokens = _drop_remember_tokens(conn, discord_id)
        print(f"[OK] Restriction recorded for {discord_id}.")
        print(f"[OK] Revoked {removed_tokens} remember_tokens row(s).")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
