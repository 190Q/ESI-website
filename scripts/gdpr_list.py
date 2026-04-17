"""
gdpr_list.py - List every user whose data we currently hold.
Useful for bookkeeping and to sanity-check that a deletion succeeded.

Usage:
    python scripts/gdpr_list.py
    python scripts/gdpr_list.py --json
"""

import argparse
import json
from datetime import datetime, timezone

from _gdpr_common import connect_user_db, ensure_restricted_table


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--json",
        dest="as_json",
        action="store_true",
        help="Emit machine-readable JSON instead of a table.",
    )
    args = parser.parse_args()

    conn = connect_user_db()
    try:
        ensure_restricted_table(conn)
        rows = conn.execute(
            """
            SELECT
                COALESCE(s.discord_id, t.discord_id, r.discord_id) AS discord_id,
                s.updated_at AS settings_updated_at,
                (SELECT COUNT(*) FROM remember_tokens rt WHERE rt.discord_id = COALESCE(s.discord_id, t.discord_id, r.discord_id)) AS token_count,
                r.reason AS restriction_reason,
                r.restricted_at AS restricted_at
            FROM user_settings s
            FULL OUTER JOIN remember_tokens t ON s.discord_id = t.discord_id
            FULL OUTER JOIN gdpr_restricted r ON COALESCE(s.discord_id, t.discord_id) = r.discord_id
            GROUP BY COALESCE(s.discord_id, t.discord_id, r.discord_id)
            ORDER BY discord_id
            """
        ).fetchall()
    except Exception:
        # SQLite's FULL OUTER JOIN is only in newer versions. Fall back to
        # a simpler UNION query that works on every SQLite build.
        rows = conn.execute(
            """
            WITH ids AS (
                SELECT discord_id FROM user_settings
                UNION
                SELECT discord_id FROM remember_tokens
                UNION
                SELECT discord_id FROM gdpr_restricted
            )
            SELECT
                ids.discord_id AS discord_id,
                (SELECT updated_at FROM user_settings s WHERE s.discord_id = ids.discord_id) AS settings_updated_at,
                (SELECT COUNT(*) FROM remember_tokens t WHERE t.discord_id = ids.discord_id) AS token_count,
                (SELECT reason FROM gdpr_restricted r WHERE r.discord_id = ids.discord_id) AS restriction_reason,
                (SELECT restricted_at FROM gdpr_restricted r WHERE r.discord_id = ids.discord_id) AS restricted_at
            FROM ids
            ORDER BY ids.discord_id
            """
        ).fetchall()
    finally:
        conn.close()

    records = []
    for row in rows:
        records.append(
            {
                "discord_id": row["discord_id"],
                "has_settings": row["settings_updated_at"] is not None,
                "settings_updated_at": _iso(row["settings_updated_at"]),
                "remember_tokens": row["token_count"] or 0,
                "restricted": row["restriction_reason"] is not None,
                "restriction_reason": row["restriction_reason"],
                "restricted_at": _iso(row["restricted_at"]),
            }
        )

    if args.as_json:
        print(json.dumps(records, indent=2, ensure_ascii=False))
        return

    if not records:
        print("No users with stored data.")
        return

    header = f"{'discord_id':<22} {'settings':<9} {'tokens':<7} {'restricted':<11} {'updated_at (UTC)'}"
    print(header)
    print("-" * len(header))
    for rec in records:
        print(
            f"{rec['discord_id']:<22} "
            f"{'yes' if rec['has_settings'] else 'no':<9} "
            f"{rec['remember_tokens']:<7} "
            f"{'yes' if rec['restricted'] else 'no':<11} "
            f"{rec['settings_updated_at'] or '-'}"
        )


def _iso(ts):
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


if __name__ == "__main__":
    main()
