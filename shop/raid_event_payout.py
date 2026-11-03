"""Bulk clean-EP payouts for the raid event, with a ledger and a revert.

The event bonus is applied at read time by ``events/raid_event.py`` and is never
written to a database, so it disappears the moment the window closes. These
grants write real ``ep_adjustments`` rows instead, which the EP balance treats
like any other EP: clean while the cycle it lands in is the current one, and
aged into dirty EP after that.

Every grant is recorded in ``raid_event_payouts`` under a batch label, so the
same batch can be re-run without paying anyone twice and can be reverted
exactly.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import uuid as _uuid_mod
from datetime import datetime as _dt, timezone as _tz

from config import _SHOP_DB, _USERNAME_MATCHES_JSON, _load_json_file

PAYOUT_REASON = "Raid event payout"
EP_TYPE = "clean"


def _now_iso() -> str:
    return _dt.now(_tz.utc).isoformat()


def _ensure_ledger_table(conn: sqlite3.Connection) -> None:
    """Create raid_event_payouts if it doesn't exist yet (idempotent)."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS raid_event_payouts (
            id          TEXT PRIMARY KEY,
            batch       TEXT NOT NULL,
            uuid        TEXT NOT NULL,
            username    TEXT NOT NULL DEFAULT '',
            raids       INTEGER NOT NULL DEFAULT 0,
            amount      INTEGER NOT NULL DEFAULT 0,
            ep_type     TEXT NOT NULL DEFAULT 'clean',
            reason      TEXT NOT NULL DEFAULT '',
            actor       TEXT NOT NULL DEFAULT '',
            created_at  TEXT NOT NULL,
            reverted_at TEXT
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_raid_event_payouts_batch "
        "ON raid_event_payouts (batch, uuid)"
    )


def list_payouts(batch: str | None = None) -> list[dict]:
    """Return ledger rows, newest first, optionally limited to one batch."""
    if not os.path.isfile(_SHOP_DB):
        return []
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.row_factory = sqlite3.Row
        _ensure_ledger_table(conn)
        if batch:
            rows = conn.execute(
                "SELECT * FROM raid_event_payouts WHERE batch = ? "
                "ORDER BY created_at DESC, username",
                (batch,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM raid_event_payouts "
                "ORDER BY created_at DESC, username"
            ).fetchall()
        conn.close()
    except sqlite3.Error:
        return []
    return [dict(r) for r in rows]


def granted_by_uuid(batch: str) -> dict[str, int]:
    """Return ``{uuid_lower: granted_amount}`` for one batch, ignoring reverts."""
    out: dict[str, int] = {}
    for row in list_payouts(batch):
        if row.get("reverted_at"):
            continue
        uuid = (row.get("uuid") or "").strip().lower()
        if uuid:
            out[uuid] = out.get(uuid, 0) + int(row.get("amount") or 0)
    return out


def _normalize_exclude(exclude) -> set[str]:
    tokens: set[str] = set()
    if not exclude:
        return tokens
    if isinstance(exclude, str):
        exclude = [exclude]
    for raw in exclude:
        token = str(raw or "").strip().lower()
        if token:
            tokens.add(token)
    return tokens


def _discord_id_for_uuid(uuid: str) -> str | None:
    matches = _load_json_file(_USERNAME_MATCHES_JSON) or {}
    target = (uuid or "").strip().lower()
    if not target:
        return None
    for did, entry in matches.items():
        if isinstance(entry, dict):
            linked = (entry.get("uuid") or "").strip().lower()
            if linked and linked == target:
                return str(did)
    return None


def grant_payouts(
    rows,
    *,
    batch: str,
    actor: str = "cli",
    note: str | None = None,
    exclude=None,
    dry_run: bool = False,
    send_dm: bool = True,
) -> dict:
    """Grant each row's ``bonus_ep`` as clean EP, skipping uuids already paid.

    ``rows`` is the output of ``_raid_event_common.build_payout``: each row needs
    ``uuid``, ``username``, ``raids`` and ``bonus_ep``.
    """
    if not batch:
        return {"ok": False, "error": "batch label is required"}
    if not os.path.isfile(_SHOP_DB):
        return {"ok": False, "error": "Shop database unavailable"}

    exclude_tokens = _normalize_exclude(exclude)
    reason = (note or "").strip() or PAYOUT_REASON
    now_iso = _now_iso()

    candidates: list[dict] = []
    excluded: list[dict] = []
    for row in rows or []:
        uuid = (row.get("uuid") or "").strip()
        entry = {
            "uuid": uuid,
            "username": row.get("username") or uuid,
            "raids": int(row.get("raids") or 0),
            "amount": int(row.get("bonus_ep") or 0),
        }
        tokens = {entry["uuid"].lower(), (entry["username"] or "").lower()}
        if exclude_tokens and (tokens & exclude_tokens):
            excluded.append({**entry, "reason": "excluded"})
            continue
        if not uuid or entry["amount"] <= 0:
            continue
        candidates.append(entry)

    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "batch": batch,
            "reason": reason,
            "amount": sum(c["amount"] for c in candidates),
            "granted": 0,
            "skipped": 0,
            "excluded": len(excluded),
            "candidates": candidates,
            "excluded_users": excluded,
        }

    granted: list[dict] = []
    skipped: list[dict] = []
    errors: list[dict] = []

    conn = sqlite3.connect(_SHOP_DB, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        from shop.ep_balance import _ensure_ep_adjustments_table

        _ensure_ep_adjustments_table(conn)
        _ensure_ledger_table(conn)
        already_paid = set(granted_by_uuid(batch))

        for entry in candidates:
            uuid = entry["uuid"]
            if uuid.lower() in already_paid:
                skipped.append({**entry, "reason": "already_paid"})
                continue
            try:
                adj_id = str(_uuid_mod.uuid4())
                conn.execute(
                    "INSERT INTO ep_adjustments "
                    "(id, uuid, amount, ep_type, reason, actor, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (adj_id, uuid, entry["amount"], EP_TYPE, reason, actor or "cli", now_iso),
                )
                conn.execute(
                    "INSERT INTO raid_event_payouts "
                    "(id, batch, uuid, username, raids, amount, ep_type, reason, "
                    " actor, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        adj_id,
                        batch,
                        uuid,
                        entry["username"] or "",
                        entry["raids"],
                        entry["amount"],
                        EP_TYPE,
                        reason,
                        actor or "cli",
                        now_iso,
                    ),
                )
                already_paid.add(uuid.lower())
                granted.append({**entry, "adjustment_id": adj_id})
            except sqlite3.Error as exc:
                errors.append({**entry, "error": str(exc)})
        conn.commit()
    except sqlite3.Error as exc:
        conn.rollback()
        return {"ok": False, "error": f"Database error: {exc}"}
    finally:
        conn.close()

    if send_dm:
        _dm_granted(granted, reason, actor)
    _log_admin(actor, "raid_event_payout_granted", batch, {
        "batch": batch,
        "granted": len(granted),
        "skipped": len(skipped),
        "errors": len(errors),
        "amount": sum(g["amount"] for g in granted),
        "ep_type": EP_TYPE,
        "reason": reason,
        "usernames": [g["username"] for g in granted[:50]],
    })

    return {
        "ok": True,
        "dry_run": False,
        "batch": batch,
        "reason": reason,
        "amount": sum(g["amount"] for g in granted),
        "granted": len(granted),
        "skipped": len(skipped),
        "excluded": len(excluded),
        "errors": len(errors),
        "granted_users": granted,
        "skipped_users": skipped,
        "excluded_users": excluded,
        "error_users": errors,
    }


def revert_payouts(batch: str, *, actor: str = "cli", dry_run: bool = False) -> dict:
    """Delete a batch's EP adjustments and mark its ledger rows reverted."""
    if not batch:
        return {"ok": False, "error": "batch label is required"}
    if not os.path.isfile(_SHOP_DB):
        return {"ok": False, "error": "Shop database unavailable"}

    conn = sqlite3.connect(_SHOP_DB, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        from shop.ep_balance import _ensure_ep_adjustments_table

        _ensure_ep_adjustments_table(conn)
        _ensure_ledger_table(conn)
        rows = conn.execute(
            "SELECT id, uuid, username, amount FROM raid_event_payouts "
            "WHERE batch = ? AND reverted_at IS NULL",
            (batch,),
        ).fetchall()
        users = [
            {
                "uuid": r["uuid"],
                "username": r["username"],
                "amount": int(r["amount"] or 0),
            }
            for r in rows
        ]
        amount = sum(u["amount"] for u in users)

        if dry_run:
            return {
                "ok": True,
                "dry_run": True,
                "batch": batch,
                "reverted": 0,
                "would_revert": len(users),
                "amount": amount,
                "users": users,
            }

        now_iso = _now_iso()
        for r in rows:
            conn.execute("DELETE FROM ep_adjustments WHERE id = ?", (r["id"],))
        conn.execute(
            "UPDATE raid_event_payouts SET reverted_at = ? "
            "WHERE batch = ? AND reverted_at IS NULL",
            (now_iso, batch),
        )
        conn.commit()
    except sqlite3.Error as exc:
        conn.rollback()
        return {"ok": False, "error": f"Database error: {exc}"}
    finally:
        conn.close()

    _log_admin(actor, "raid_event_payout_reverted", batch, {
        "batch": batch,
        "reverted": len(users),
        "amount": amount,
    })

    return {
        "ok": True,
        "dry_run": False,
        "batch": batch,
        "reverted": len(users),
        "amount": amount,
        "users": users,
    }


def _dm_granted(granted: list[dict], reason: str, actor: str) -> None:
    """Best-effort DM fanout; failures never block a committed grant."""
    if not granted:
        return
    try:
        from shop.auction import _dm_card_in_background
    except Exception as exc:
        print(f"[RAID-PAYOUT] DM fanout unavailable: {exc}", file=sys.stderr)
        return

    for entry in granted:
        try:
            did = _discord_id_for_uuid(entry["uuid"])
            if not did:
                continue
            amount = int(entry["amount"])
            _dm_card_in_background(
                did,
                "ep_granted",
                "Raid Event Payout",
                amount,
                amount_label="clean EP credited",
                fields=[
                    ("REASON", reason[:50]),
                    ("AMOUNT", f"+{amount:,} Clean EP"),
                    ("RAIDS", str(entry.get("raids") or 0)),
                    ("BY", (actor or "cli")[:30]),
                ],
                fallback_text=(
                    f"Your raid event payout of {amount} clean EP has been granted."
                ),
            )
        except Exception as exc:
            print(f"[RAID-PAYOUT] DM failed for {entry.get('username')}: {exc}", file=sys.stderr)


def _log_admin(actor: str, action: str, target_id: str, details: dict) -> None:
    try:
        from shop.admin import _log_admin_action, _invalidate_users_cache

        _log_admin_action(actor or "cli", action, target_id, details)
        _invalidate_users_cache()
    except Exception:
        pass
