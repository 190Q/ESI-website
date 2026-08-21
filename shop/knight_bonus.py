"""One-time 250 dirty EP bonus on first promotion into Knight+.

Eligibility is transition-based:
- Bonus is queued only when a linked member moves from a rank *below*
  Knight (e.g. Squire / no rank) into Knight or any higher rank.
- Anyone previously observed at Knight+ is permanently ineligible, even
  after demotion and re-promotion (duke -> squire -> duke).
- The first successful scan baselines current Knight+ members so they do
  not flood the queue.

Fulfill grants dirty EP via ep_adjustments. Reject still consumes
eligibility so the member never gets another ticket.
"""

from __future__ import annotations

import os
import sqlite3
import sys
import threading
import uuid as _uuid_mod
from datetime import datetime as _dt, timezone as _tz

import requests

from config import (
    _SHOP_DB,
    _USERNAME_MATCHES_JSON,
    _CLIENT_CONFIG,
    DISCORD_API,
    DISCORD_TOKEN,
    DISCORD_GUILD_ID,
    _load_json_file,
)

KNIGHT_BONUS_AMOUNT = 250
KNIGHT_BONUS_REASON = "Knight promotion bonus"

# rankRoles are ordered highest-first (Emperor=0 ... Squire=last).
_RANK_ROLES = list(_CLIENT_CONFIG.get("rankRoles") or [])
_ROLE_TIER_BY_ID: dict[str, int] = {}
for _i, _r in enumerate(_RANK_ROLES):
    _rid = str(_r.get("id") or "").strip()
    if _rid:
        # Higher tier number = higher rank. Invert list index.
        _ROLE_TIER_BY_ID[_rid] = len(_RANK_ROLES) - _i

_KNIGHT_TIER = next(
    (
        _ROLE_TIER_BY_ID[str(r.get("id"))]
        for r in _RANK_ROLES
        if str(r.get("name") or "").lower() == "knight" and r.get("id")
    ),
    None,
)

_scan_lock = threading.Lock()


def _now_iso() -> str:
    return _dt.now(_tz.utc).isoformat()


def _ensure_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS knight_bonus_grants (
            uuid          TEXT PRIMARY KEY,
            discord_id    TEXT NOT NULL DEFAULT '',
            username      TEXT NOT NULL DEFAULT '',
            amount        INTEGER NOT NULL DEFAULT 250,
            status        TEXT NOT NULL,
            ticket_id     TEXT,
            chief_note    TEXT,
            created_at    TEXT NOT NULL,
            resolved_at   TEXT,
            resolved_by   TEXT NOT NULL DEFAULT ''
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_knight_bonus_status "
        "ON knight_bonus_grants (status)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_knight_bonus_ticket "
        "ON knight_bonus_grants (ticket_id)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS knight_bonus_rank_state (
            discord_id       TEXT PRIMARY KEY,
            uuid             TEXT NOT NULL DEFAULT '',
            username         TEXT NOT NULL DEFAULT '',
            last_rank_tier   INTEGER NOT NULL DEFAULT 0,
            max_rank_tier    INTEGER NOT NULL DEFAULT 0,
            updated_at       TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS knight_bonus_meta (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT ''
        )
        """
    )


def _rank_tier_from_roles(role_ids) -> int:
    """Highest configured guild-rank tier present on the member (0 = below squire/none)."""
    best = 0
    for rid in role_ids or []:
        tier = _ROLE_TIER_BY_ID.get(str(rid), 0)
        if tier > best:
            best = tier
    return best


def _is_knight_or_above(tier: int) -> bool:
    return _KNIGHT_TIER is not None and tier >= _KNIGHT_TIER


def _linked_accounts() -> dict[str, tuple[str, str]]:
    """Return {discord_id: (uuid, username)} for linked members."""
    matches = _load_json_file(_USERNAME_MATCHES_JSON) or {}
    out: dict[str, tuple[str, str]] = {}
    for did, entry in matches.items():
        if not isinstance(did, str) or not did:
            continue
        if isinstance(entry, dict):
            uuid = (entry.get("uuid") or "").strip()
            username = (entry.get("username") or "").strip()
        elif isinstance(entry, str):
            uuid, username = "", entry.strip()
        else:
            continue
        if not uuid:
            continue
        out[did] = (uuid, username)
    return out


def _fetch_discord_members() -> list[dict]:
    if not DISCORD_TOKEN or not DISCORD_GUILD_ID:
        return []
    members: list[dict] = []
    after = "0"
    headers = {"Authorization": f"Bot {DISCORD_TOKEN}"}
    while True:
        resp = requests.get(
            f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/members",
            params={"limit": 1000, "after": after},
            headers=headers,
            timeout=15,
        )
        if not resp.ok:
            print(
                f"[KNIGHT-BONUS] Discord member fetch failed: "
                f"{resp.status_code} {resp.text[:200]}",
                file=sys.stderr,
            )
            break
        batch = resp.json()
        if not batch:
            break
        members.extend(batch)
        if len(batch) < 1000:
            break
        after = (batch[-1].get("user") or {}).get("id") or after
        if after == "0":
            break
    return members


def _meta_get(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute(
        "SELECT value FROM knight_bonus_meta WHERE key = ?", (key,)
    ).fetchone()
    return row[0] if row else None


def _meta_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO knight_bonus_meta (key, value) VALUES (?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def _upsert_rank_state(
    conn: sqlite3.Connection,
    *,
    discord_id: str,
    uuid: str,
    username: str,
    tier: int,
    now_iso: str,
) -> tuple[int, int]:
    """Update observed rank. Returns (previous_tier, previous_max_tier)."""
    row = conn.execute(
        "SELECT last_rank_tier, max_rank_tier FROM knight_bonus_rank_state "
        "WHERE discord_id = ?",
        (discord_id,),
    ).fetchone()
    if row:
        prev_last, prev_max = int(row[0] or 0), int(row[1] or 0)
        new_max = max(prev_max, tier)
        conn.execute(
            "UPDATE knight_bonus_rank_state "
            "SET uuid = ?, username = ?, last_rank_tier = ?, "
            "    max_rank_tier = ?, updated_at = ? "
            "WHERE discord_id = ?",
            (uuid, username or "", tier, new_max, now_iso, discord_id),
        )
        return prev_last, prev_max

    conn.execute(
        "INSERT INTO knight_bonus_rank_state "
        "(discord_id, uuid, username, last_rank_tier, max_rank_tier, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        (discord_id, uuid, username or "", tier, tier, now_iso),
    )
    return 0, 0


def _has_grant(conn: sqlite3.Connection, uuid: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM knight_bonus_grants WHERE uuid = ? LIMIT 1", (uuid,)
    ).fetchone()
    return row is not None


def _insert_grant(
    conn: sqlite3.Connection,
    *,
    uuid: str,
    discord_id: str,
    username: str,
    status: str,
    ticket_id: str | None,
    now_iso: str,
) -> bool:
    """Insert grant if uuid is new. Returns True when a row was inserted."""
    before = conn.total_changes
    conn.execute(
        "INSERT OR IGNORE INTO knight_bonus_grants "
        "(uuid, discord_id, username, amount, status, ticket_id, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (
            uuid,
            discord_id or "",
            username or "",
            KNIGHT_BONUS_AMOUNT,
            status,
            ticket_id,
            now_iso,
        ),
    )
    return conn.total_changes > before


def scan_knight_promotions() -> dict:
    """Detect first-time promotions into Knight+ and enqueue dirty-EP tickets."""
    if _KNIGHT_TIER is None:
        return {"ok": False, "error": "Knight role is not configured"}
    if not os.path.isfile(_SHOP_DB):
        return {"ok": False, "error": "Shop database unavailable"}

    if not _scan_lock.acquire(blocking=False):
        return {"ok": True, "skipped": True, "reason": "scan already running"}

    try:
        members = _fetch_discord_members()
        linked = _linked_accounts()
        now_iso = _now_iso()

        observed: list[tuple[str, str, str, int]] = []
        # (uuid, discord_id, username, tier)
        for m in members:
            user = m.get("user") or {}
            did = str(user.get("id") or "")
            if not did or user.get("bot"):
                continue
            link = linked.get(did)
            if not link:
                continue
            uuid, username = link
            tier = _rank_tier_from_roles(m.get("roles") or [])
            if not username:
                username = (
                    m.get("nick")
                    or user.get("global_name")
                    or user.get("username")
                    or ""
                )
            observed.append((uuid, did, username, tier))

        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            _ensure_tables(conn)
            baselined = _meta_get(conn, "baselined_at")

            created = 0
            baselined_count = 0
            consumed_no_ticket = 0

            if not baselined:
                # Seed rank state for everyone we can see. Mark current Knight+
                # as already consumed so they never enter the queue.
                for uuid, did, username, tier in observed:
                    _upsert_rank_state(
                        conn,
                        discord_id=did,
                        uuid=uuid,
                        username=username,
                        tier=tier,
                        now_iso=now_iso,
                    )
                    if _is_knight_or_above(tier):
                        if _insert_grant(
                            conn,
                            uuid=uuid,
                            discord_id=did,
                            username=username,
                            status="baseline",
                            ticket_id=None,
                            now_iso=now_iso,
                        ):
                            baselined_count += 1
                _meta_set(conn, "baselined_at", now_iso)
                conn.commit()
                print(
                    f"[KNIGHT-BONUS] Baseline complete: {baselined_count} "
                    f"existing Knight+ members marked ineligible.",
                    file=sys.stderr,
                )
                return {
                    "ok": True,
                    "baselined": True,
                    "baselined_count": baselined_count,
                    "created": 0,
                }

            for uuid, did, username, tier in observed:
                prev_last, prev_max = _upsert_rank_state(
                    conn,
                    discord_id=did,
                    uuid=uuid,
                    username=username,
                    tier=tier,
                    now_iso=now_iso,
                )

                if not _is_knight_or_above(tier):
                    continue
                if _has_grant(conn, uuid):
                    continue

                # Already held Knight+ at some earlier observation (demotion case).
                if _is_knight_or_above(prev_max):
                    if _insert_grant(
                        conn,
                        uuid=uuid,
                        discord_id=did,
                        username=username,
                        status="ineligible",
                        ticket_id=None,
                        now_iso=now_iso,
                    ):
                        consumed_no_ticket += 1
                    continue

                # First rise into Knight+: previous observed tier must be below Knight.
                # Unknown/first-seen-as-Knight+ is treated as ineligible (no history).
                if not _is_knight_or_above(prev_last) and prev_last > 0:
                    ticket_id = str(_uuid_mod.uuid4())
                    if _insert_grant(
                        conn,
                        uuid=uuid,
                        discord_id=did,
                        username=username,
                        status="pending",
                        ticket_id=ticket_id,
                        now_iso=now_iso,
                    ):
                        created += 1
                        print(
                            f"[KNIGHT-BONUS] Queued bonus for {username or uuid} "
                            f"({ticket_id}).",
                            file=sys.stderr,
                        )
                else:
                    # First observation already at Knight+, or no prior below-knight rank.
                    if _insert_grant(
                        conn,
                        uuid=uuid,
                        discord_id=did,
                        username=username,
                        status="ineligible",
                        ticket_id=None,
                        now_iso=now_iso,
                    ):
                        consumed_no_ticket += 1

            conn.commit()
            return {
                "ok": True,
                "baselined": False,
                "created": created,
                "consumed_no_ticket": consumed_no_ticket,
                "observed": len(observed),
            }
        finally:
            conn.close()
    except Exception as exc:
        print(f"[KNIGHT-BONUS] Scan failed: {exc}", file=sys.stderr)
        return {"ok": False, "error": str(exc)}
    finally:
        _scan_lock.release()


def list_pending_knight_bonuses() -> list[dict]:
    if not os.path.isfile(_SHOP_DB):
        return []
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.row_factory = sqlite3.Row
        _ensure_tables(conn)
        rows = conn.execute(
            "SELECT ticket_id, uuid, discord_id, username, amount, status, "
            "       created_at "
            "FROM knight_bonus_grants "
            "WHERE status = 'pending' "
            "ORDER BY created_at ASC"
        ).fetchall()
        conn.close()
        out = []
        for r in rows:
            amount = int(r["amount"] or KNIGHT_BONUS_AMOUNT)
            out.append(
                {
                    "ticket_id": r["ticket_id"],
                    "uuid": r["uuid"],
                    "discord_id": r["discord_id"],
                    "username": r["username"],
                    "amount": amount,
                    "dirty_ep_to_grant": amount,
                    "status": r["status"],
                    "submitted_at": r["created_at"],
                    "created_at": r["created_at"],
                    "bonus_type": "knight_promotion",
                    "reason": KNIGHT_BONUS_REASON,
                }
            )
        return out
    except sqlite3.Error:
        return []


def get_pending_knight_bonus(ticket_id: str) -> dict | None:
    if not ticket_id or not os.path.isfile(_SHOP_DB):
        return None
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.row_factory = sqlite3.Row
        _ensure_tables(conn)
        row = conn.execute(
            "SELECT * FROM knight_bonus_grants "
            "WHERE ticket_id = ? AND status = 'pending'",
            (ticket_id,),
        ).fetchone()
        conn.close()
        return dict(row) if row else None
    except sqlite3.Error:
        return None


def list_rank_names() -> list[str]:
    """Configured guild rank names, highest-first."""
    return [str(r.get("name") or "").strip() for r in _RANK_ROLES if r.get("name")]


def _tier_for_rank_name(rank_name: str) -> int | None:
    target = (rank_name or "").strip().lower().replace("_", " ")
    if not target:
        return None
    for r in _RANK_ROLES:
        name = str(r.get("name") or "").strip().lower()
        rid = str(r.get("id") or "").strip()
        if name == target and rid in _ROLE_TIER_BY_ID:
            return _ROLE_TIER_BY_ID[rid]
    return None


def _lowest_rank_tier() -> int:
    """Tier of the lowest configured rank (Squire)."""
    if not _ROLE_TIER_BY_ID:
        return 0
    return min(_ROLE_TIER_BY_ID.values())


def _normalize_exclude_tokens(exclude) -> set[str]:
    """Normalize exclude entries (usernames / Discord IDs / UUIDs) to lowercase."""
    out: set[str] = set()
    if not exclude:
        return out
    if isinstance(exclude, str):
        exclude = [exclude]
    for raw in exclude:
        token = str(raw or "").strip().lower()
        if token:
            out.add(token)
    return out


def _is_excluded_candidate(candidate: dict, exclude_tokens: set[str]) -> bool:
    if not exclude_tokens:
        return False
    keys = (
        candidate.get("username"),
        candidate.get("discord_id"),
        candidate.get("uuid"),
    )
    for key in keys:
        if key and str(key).strip().lower() in exclude_tokens:
            return True
    return False


def bulk_grant_knight_bonus(
    *,
    max_rank: str = "knight",
    dry_run: bool = False,
    actor: str = "cli",
    note: str | None = None,
    send_dm: bool = True,
    exclude=None,
) -> dict:
    """Instantly grant the one-time Knight bonus to current members in a rank band.

    *max_rank* (default ``"knight"``):
      - ``knight`` → only members whose highest rank is exactly Knight
      - higher rank name (e.g. ``count``) → every member whose highest rank is
        that rank **or below** (Count, Viscount, Knight, Squire)

    *exclude*: optional iterable of Minecraft usernames, Discord IDs, and/or
    Minecraft UUIDs to skip.

    Already-fulfilled grants are skipped. Baseline/ineligible/rejected/pending
    rows are converted into a real fulfilled grant so backfill works.
    """
    if _KNIGHT_TIER is None:
        return {"ok": False, "error": "Knight role is not configured"}
    if not os.path.isfile(_SHOP_DB):
        return {"ok": False, "error": "Shop database unavailable"}

    max_tier = _tier_for_rank_name(max_rank)
    if max_tier is None:
        return {
            "ok": False,
            "error": f"Unknown rank {max_rank!r}. Valid: {', '.join(list_rank_names())}",
        }

    # Exact knight by default; otherwise the full band from lowest rank up to max_rank.
    if max_tier == _KNIGHT_TIER and (max_rank or "").strip().lower() == "knight":
        min_tier = _KNIGHT_TIER
    else:
        min_tier = _lowest_rank_tier()

    if max_tier < min_tier:
        return {"ok": False, "error": "Invalid rank band"}

    exclude_tokens = _normalize_exclude_tokens(exclude)

    members = _fetch_discord_members()
    linked = _linked_accounts()
    now_iso = _now_iso()
    grant_note = (note or "").strip() or f"{KNIGHT_BONUS_REASON} (CLI backfill)"

    candidates: list[dict] = []
    excluded: list[dict] = []
    for m in members:
        user = m.get("user") or {}
        did = str(user.get("id") or "")
        if not did or user.get("bot"):
            continue
        link = linked.get(did)
        if not link:
            continue
        uuid, username = link
        tier = _rank_tier_from_roles(m.get("roles") or [])
        if tier < min_tier or tier > max_tier:
            continue
        if not username:
            username = (
                m.get("nick")
                or user.get("global_name")
                or user.get("username")
                or ""
            )
        entry = {
            "uuid": uuid,
            "discord_id": did,
            "username": username,
            "tier": tier,
        }
        if _is_excluded_candidate(entry, exclude_tokens):
            excluded.append({**entry, "reason": "excluded"})
            continue
        candidates.append(entry)

    # Stable output order by username
    candidates.sort(key=lambda c: (c["username"] or "").lower())
    excluded.sort(key=lambda c: (c["username"] or "").lower())

    granted: list[dict] = []
    skipped: list[dict] = []
    errors: list[dict] = []

    if dry_run:
        for c in candidates:
            granted.append({**c, "status": "would_grant"})
        return {
            "ok": True,
            "dry_run": True,
            "max_rank": max_rank,
            "min_tier": min_tier,
            "max_tier": max_tier,
            "amount": KNIGHT_BONUS_AMOUNT,
            "matched": len(candidates),
            "excluded": len(excluded),
            "granted": 0,
            "skipped": 0,
            "exclude": sorted(exclude_tokens),
            "candidates": granted,
            "excluded_users": excluded,
        }

    conn = sqlite3.connect(_SHOP_DB, timeout=30)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_tables(conn)
        from shop.ep_balance import _ensure_ep_adjustments_table

        _ensure_ep_adjustments_table(conn)

        for c in candidates:
            uuid = c["uuid"]
            did = c["discord_id"]
            username = c["username"]
            try:
                existing = conn.execute(
                    "SELECT ticket_id, status FROM knight_bonus_grants WHERE uuid = ?",
                    (uuid,),
                ).fetchone()
                if existing and (existing["status"] or "") == "fulfilled":
                    skipped.append({**c, "reason": "already_fulfilled"})
                    continue

                ticket_id = None
                if existing and existing["ticket_id"]:
                    ticket_id = existing["ticket_id"]
                else:
                    ticket_id = str(_uuid_mod.uuid4())

                adj_id = str(_uuid_mod.uuid4())
                conn.execute(
                    "INSERT INTO ep_adjustments "
                    "(id, uuid, amount, ep_type, reason, actor, created_at) "
                    "VALUES (?, ?, ?, 'dirty', ?, ?, ?)",
                    (
                        adj_id,
                        uuid,
                        KNIGHT_BONUS_AMOUNT,
                        grant_note,
                        actor or "cli",
                        now_iso,
                    ),
                )

                if existing:
                    conn.execute(
                        "UPDATE knight_bonus_grants "
                        "SET discord_id = ?, username = ?, amount = ?, status = 'fulfilled', "
                        "    ticket_id = ?, chief_note = ?, resolved_at = ?, resolved_by = ? "
                        "WHERE uuid = ?",
                        (
                            did,
                            username or "",
                            KNIGHT_BONUS_AMOUNT,
                            ticket_id,
                            grant_note,
                            now_iso,
                            actor or "cli",
                            uuid,
                        ),
                    )
                else:
                    conn.execute(
                        "INSERT INTO knight_bonus_grants "
                        "(uuid, discord_id, username, amount, status, ticket_id, "
                        " chief_note, created_at, resolved_at, resolved_by) "
                        "VALUES (?, ?, ?, ?, 'fulfilled', ?, ?, ?, ?, ?)",
                        (
                            uuid,
                            did,
                            username or "",
                            KNIGHT_BONUS_AMOUNT,
                            ticket_id,
                            grant_note,
                            now_iso,
                            now_iso,
                            actor or "cli",
                        ),
                    )

                # Keep rank state in sync so the scanner won't re-queue them.
                _upsert_rank_state(
                    conn,
                    discord_id=did,
                    uuid=uuid,
                    username=username,
                    tier=c["tier"],
                    now_iso=now_iso,
                )

                granted.append(
                    {
                        **c,
                        "ticket_id": ticket_id,
                        "adjustment_id": adj_id,
                        "amount": KNIGHT_BONUS_AMOUNT,
                    }
                )
            except sqlite3.Error as exc:
                errors.append({**c, "error": str(exc)})

        conn.commit()
    except sqlite3.Error as exc:
        conn.rollback()
        return {"ok": False, "error": f"Database error: {exc}"}
    finally:
        conn.close()

    if send_dm and granted:
        try:
            from shop.auction import _dm_card_in_background

            for g in granted:
                did = g.get("discord_id")
                if not did:
                    continue
                _dm_card_in_background(
                    did,
                    "ep_granted",
                    "Knight Bonus",
                    KNIGHT_BONUS_AMOUNT,
                    amount_label="dirty EP credited",
                    fields=[
                        ("REASON", KNIGHT_BONUS_REASON[:50]),
                        ("AMOUNT", f"+{KNIGHT_BONUS_AMOUNT:,} Dirty EP"),
                        ("BY", (actor or "cli")[:30]),
                    ],
                    fallback_text=(
                        f"Your Knight promotion bonus of {KNIGHT_BONUS_AMOUNT} "
                        f"dirty EP has been granted."
                    ),
                    comment=grant_note,
                )
        except Exception as exc:
            print(f"[KNIGHT-BONUS] Bulk DM fanout failed: {exc}", file=sys.stderr)

    try:
        from shop.admin import _log_admin_action, _invalidate_users_cache

        _log_admin_action(
            actor or "cli",
            "knight_bonus_bulk_grant",
            max_rank,
            {
                "max_rank": max_rank,
                "min_tier": min_tier,
                "max_tier": max_tier,
                "granted": len(granted),
                "skipped": len(skipped),
                "errors": len(errors),
                "amount": KNIGHT_BONUS_AMOUNT,
                "note": grant_note,
                "usernames": [g.get("username") for g in granted[:50]],
            },
        )
        _invalidate_users_cache()
    except Exception:
        pass

    return {
        "ok": True,
        "dry_run": False,
        "max_rank": max_rank,
        "min_tier": min_tier,
        "max_tier": max_tier,
        "amount": KNIGHT_BONUS_AMOUNT,
        "matched": len(candidates),
        "excluded": len(excluded),
        "granted": len(granted),
        "skipped": len(skipped),
        "errors": len(errors),
        "exclude": sorted(exclude_tokens),
        "granted_users": granted,
        "skipped_users": skipped,
        "excluded_users": excluded,
        "error_users": errors,
    }


def resolve_knight_bonus(
    ticket_id: str,
    *,
    approve: bool,
    chief_name: str,
    chief_note: str | None = None,
) -> dict:
    """Approve (grant dirty EP) or reject a pending knight bonus ticket."""
    if not ticket_id:
        return {"error": "ticket_id is required"}
    if not os.path.isfile(_SHOP_DB):
        return {"error": "Shop database unavailable"}

    now_iso = _now_iso()
    new_status = "fulfilled" if approve else "rejected"
    conn = sqlite3.connect(_SHOP_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_tables(conn)
        row = conn.execute(
            "SELECT * FROM knight_bonus_grants "
            "WHERE ticket_id = ? AND status = 'pending'",
            (ticket_id,),
        ).fetchone()
        if not row:
            return {"error": "Ticket not found or not pending"}

        uuid = row["uuid"]
        amount = int(row["amount"] or KNIGHT_BONUS_AMOUNT)
        username = row["username"] or ""
        discord_id = row["discord_id"] or ""

        if approve:
            from shop.ep_balance import _ensure_ep_adjustments_table

            _ensure_ep_adjustments_table(conn)
            adj_id = str(_uuid_mod.uuid4())
            conn.execute(
                "INSERT INTO ep_adjustments "
                "(id, uuid, amount, ep_type, reason, actor, created_at) "
                "VALUES (?, ?, ?, 'dirty', ?, ?, ?)",
                (
                    adj_id,
                    uuid,
                    amount,
                    chief_note or KNIGHT_BONUS_REASON,
                    chief_name or "system",
                    now_iso,
                ),
            )

        conn.execute(
            "UPDATE knight_bonus_grants "
            "SET status = ?, chief_note = ?, resolved_at = ?, resolved_by = ? "
            "WHERE ticket_id = ? AND status = 'pending'",
            (
                new_status,
                (chief_note or "").strip() or None,
                now_iso,
                chief_name or "",
                ticket_id,
            ),
        )
        conn.commit()
    except sqlite3.Error as exc:
        conn.rollback()
        return {"error": f"Database error: {exc}"}
    finally:
        conn.close()

    # DM best-effort
    try:
        from shop.auction import _dm_card_in_background, _resolve_discord_id_for_uuid

        did = discord_id or _resolve_discord_id_for_uuid(uuid)
        if did:
            if approve:
                _dm_card_in_background(
                    did,
                    "ep_granted",
                    "Knight Bonus",
                    amount,
                    amount_label="dirty EP credited",
                    fields=[
                        ("REASON", KNIGHT_BONUS_REASON[:50]),
                        ("AMOUNT", f"+{amount:,} Dirty EP"),
                        ("BY", (chief_name or "Staff")[:30]),
                    ],
                    fallback_text=(
                        f"Your Knight promotion bonus of {amount} dirty EP "
                        f"has been granted."
                    ),
                    comment=chief_note or "",
                )
            else:
                _dm_card_in_background(
                    did,
                    "purchase_rejected",
                    "Knight Bonus",
                    0,
                    fields=[
                        ("STATUS", "Denied"),
                        ("REASON", (chief_note or "Rejected")[:50]),
                        ("BY", (chief_name or "Staff")[:30]),
                    ],
                    fallback_text=(
                        f"Your Knight promotion bonus request was denied"
                        f"{(': ' + chief_note) if chief_note else '.'}"
                    ),
                )
    except Exception as exc:
        print(f"[KNIGHT-BONUS] DM failed: {exc}", file=sys.stderr)

    try:
        from shop.admin import _log_admin_action, _invalidate_users_cache

        _log_admin_action(
            chief_name or "unknown",
            "knight_bonus_fulfilled" if approve else "knight_bonus_rejected",
            ticket_id,
            {
                "ticket_id": ticket_id,
                "uuid": uuid,
                "username": username,
                "amount": amount,
                "note": chief_note,
            },
        )
        _invalidate_users_cache()
    except Exception:
        pass

    return {
        "ok": True,
        "ticket_id": ticket_id,
        "status": new_status,
        "resolved_at": now_iso,
        "amount": amount,
        "username": username,
    }
