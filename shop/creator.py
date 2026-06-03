"""
shop/creator.py - Creator application and item-request system.

Citizens can apply to become Creators. Once approved, Creators can submit
item-create / item-edit requests that Parliament reviews. Creators can also
directly toggle stock and active state on their own items.
"""

import json
import os
import sqlite3
import sys
import uuid as _uuid_mod
from datetime import datetime as _dt, timezone as _tz, timedelta as _td
from config import (
    _SHOP_DB, _SHOP_ITEMS_JSON,
    _ROLE_CITIZEN, _PARLIAMENT_PLUS, _CHIEF_PLUS,
    _USERNAME_MATCHES_JSON, _load_json_file as _cfg_load_json,
)
from shop.items import reload as _reload_items, get_item_unfiltered
from shop.ep_balance import resolve_uuid_for_user
from shop.admin import (
    _log_admin_action, _json_write_lock, _atomic_write_json,
    _invalidate_users_cache, admin_set_override,
    is_shop_banned, _restore_stock,
)
from shop.auction import _resolve_discord_id_for_uuid, _dm_card_in_background

CREATOR_REAPPLY_COOLDOWN_DAYS = 30
CREATOR_COMMISSION_PCT = 35  # % of ep_spent granted to the creator as dirty EP on fulfillment

_CITIZEN_PLUS = {_ROLE_CITIZEN}
_SHOP_ADMIN = _CHIEF_PLUS | _PARLIAMENT_PLUS

_now = lambda: _dt.now(_tz.utc)
_now_iso = lambda: _now().isoformat()

def _grant_creator_commission(
    creator_discord_id: str,
    item_id: str,
    ep_spent: int,
    purchase_id: str,
    actor: str = "system",
) -> int:
    """Grant the creator CREATOR_COMMISSION_PCT% of ep_spent as dirty EP.

    Called on purchase fulfillment (both admin and self-fulfillment paths).
    Silently no-ops if the creator has no linked MC account.
    Returns the amount granted (0 on failure or skip).
    """
    if not creator_discord_id or not ep_spent or ep_spent <= 0:
        return 0

    amount = int(ep_spent * CREATOR_COMMISSION_PCT / 100)  # floor via int()
    if amount <= 0:
        return 0

    mc_uuid, _mc_uname = resolve_uuid_for_user(creator_discord_id)
    if not mc_uuid:
        return 0  # No linked MC account – skip silently

    now_iso = _now_iso()
    adj_id = str(_uuid_mod.uuid4())
    reason = f"Creator commission: {item_id} (purchase {purchase_id[:8]})"

    try:
        conn = _get_conn(timeout=10)
        from shop.ep_balance import _ensure_ep_adjustments_table
        _ensure_ep_adjustments_table(conn)
        conn.execute(
            "INSERT INTO ep_adjustments (id, uuid, amount, ep_type, reason, actor, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (adj_id, mc_uuid, amount, "dirty", reason, actor, now_iso),
        )
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        print(f"[CREATOR] Commission grant failed for {creator_discord_id}: {exc}", file=sys.stderr)
        return 0

    _log_admin_action(
        "system", "creator_commission_granted", creator_discord_id,
        {"item_id": item_id, "commission": amount, "ep_spent": ep_spent,
         "reason": reason, "purchase_id": purchase_id, "uuid": mc_uuid},
    )
    _invalidate_users_cache()

    # DM the creator
    _dm_card_in_background(
        creator_discord_id, "ep_granted",
        "Creator Commission",
        amount,
        fields=[
            ("ITEM", item_id[:30]),
            ("SALE", f"{ep_spent:,} EP"),
            ("COMMISSION", f"+{amount:,} Dirty EP"),
        ],
        fallback_text=(
            f"You earned {amount} dirty EP commission from a "
            f"{ep_spent} EP sale of {item_id}."
        ),
    )
    return amount

# Table helpers (lazy creation, idempotent)
def _ensure_creator_applications_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS creator_applications (
            id               TEXT PRIMARY KEY,
            discord_id       TEXT NOT NULL,
            uuid             TEXT,
            username         TEXT,
            status           TEXT NOT NULL DEFAULT 'pending',
            submitted_at     TEXT NOT NULL,
            reviewed_at      TEXT,
            reviewer         TEXT,
            rejection_reason TEXT,
            answers          TEXT
        )
    """)
    # Migrate existing tables that lack the answers column
    try:
        conn.execute("SELECT answers FROM creator_applications LIMIT 0")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE creator_applications ADD COLUMN answers TEXT")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ca_discord_id "
        "ON creator_applications (discord_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ca_status_submitted "
        "ON creator_applications (status, submitted_at)"
    )

def _ensure_creator_item_requests_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS creator_item_requests (
            id               TEXT PRIMARY KEY,
            discord_id       TEXT NOT NULL,
            item_id          TEXT,
            changes          TEXT NOT NULL,
            status           TEXT NOT NULL DEFAULT 'pending',
            submitted_at     TEXT NOT NULL,
            reviewed_at      TEXT,
            reviewer         TEXT,
            rejection_reason TEXT
        )
    """)
    # Migrate existing tables that lack the note column
    try:
        conn.execute("SELECT note FROM creator_item_requests LIMIT 0")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE creator_item_requests ADD COLUMN note TEXT")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cir_discord_id "
        "ON creator_item_requests (discord_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cir_status_submitted "
        "ON creator_item_requests (status, submitted_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cir_item_id "
        "ON creator_item_requests (item_id)"
    )

def _ensure_creator_flags_table(conn: sqlite3.Connection) -> None:
    conn.execute("""
        CREATE TABLE IF NOT EXISTS creator_flags (
            discord_id  TEXT PRIMARY KEY,
            granted_at  TEXT NOT NULL,
            granted_by  TEXT NOT NULL
        )
    """)

def _get_conn(timeout: int = 5) -> sqlite3.Connection:
    """Open a WAL-mode connection to shop.db."""
    conn = sqlite3.connect(_SHOP_DB, timeout=timeout)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.row_factory = sqlite3.Row
    return conn

# Creator flag
def is_creator(discord_id: str) -> bool:
    """Return True if the user has the creator flag."""
    if not discord_id or not os.path.isfile(_SHOP_DB):
        return False
    try:
        conn = _get_conn()
        _ensure_creator_flags_table(conn)
        row = conn.execute(
            "SELECT 1 FROM creator_flags WHERE discord_id = ?",
            (discord_id,),
        ).fetchone()
        conn.close()
        return row is not None
    except sqlite3.Error:
        return False

def _grant_creator_flag(conn: sqlite3.Connection, discord_id: str, granted_by: str) -> None:
    """Insert the creator flag (idempotent)."""
    _ensure_creator_flags_table(conn)
    conn.execute(
        "INSERT OR IGNORE INTO creator_flags (discord_id, granted_at, granted_by) "
        "VALUES (?, ?, ?)",
        (discord_id, _now_iso(), granted_by),
    )

def revoke_creator_flag(discord_id: str, revoked_by: str, target_username: str = "") -> dict:
    """Remove the creator flag from a user."""
    if not discord_id:
        return {"error": "discord_id is required"}
    # Resolve target name before deleting the flag
    target = target_username or _resolve_creator_username(discord_id)
    try:
        conn = _get_conn(timeout=10)
        _ensure_creator_flags_table(conn)
        cur = conn.execute(
            "DELETE FROM creator_flags WHERE discord_id = ?", (discord_id,)
        )
        conn.commit()
        conn.close()
        if cur.rowcount == 0:
            return {"error": "User is not a creator"}
    except sqlite3.Error as exc:
        return {"error": f"Database error: {exc}"}
    _log_admin_action(
        revoked_by, "creator_flag_revoked", target,
        {"discord_id": discord_id},
    )
    # DM the user that their creator status has been revoked
    _dm_card_in_background(
        discord_id, "creator_revoked",
        "Creator Status",
        fields=[
            ("STATUS", "Revoked"),
            ("REVOKED BY", revoked_by),
        ],
        fallback_text=f"Your Creator status has been revoked by {revoked_by}.",
    )
    return {"ok": True}

def grant_creator_flag_standalone(discord_id: str, granted_by: str, target_username: str = "") -> dict:
    """Grant the creator flag to a user (admin action, standalone)."""
    if not discord_id:
        return {"error": "discord_id is required"}
    if is_creator(discord_id):
        return {"error": "User is already a creator"}
    target = target_username or _resolve_creator_username(discord_id)
    folder = os.path.dirname(_SHOP_DB)
    if folder:
        os.makedirs(folder, exist_ok=True)
    try:
        conn = _get_conn(timeout=10)
        _grant_creator_flag(conn, discord_id, granted_by)
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        return {"error": f"Database error: {exc}"}
    _log_admin_action(
        granted_by, "creator_flag_granted", target,
        {"discord_id": discord_id},
    )
    # DM the user that they've been granted creator status
    _dm_card_in_background(
        discord_id, "creator_granted",
        "Creator Status",
        fields=[
            ("STATUS", "Granted"),
            ("GRANTED BY", granted_by),
        ],
        fallback_text=f"You have been granted Creator status by {granted_by}. You can now submit items for the shop.",
    )
    return {"ok": True}

def get_all_creator_ids() -> set:
    """Return the set of all discord_ids that have the creator flag."""
    if not os.path.isfile(_SHOP_DB):
        return set()
    try:
        conn = _get_conn()
        _ensure_creator_flags_table(conn)
        rows = conn.execute("SELECT discord_id FROM creator_flags").fetchall()
        conn.close()
        return {r[0] for r in rows}
    except sqlite3.Error:
        return set()

# Seller Applications
def submit_application(discord_id: str, user_roles: list, answers: list | None = None) -> dict:
    """Submit a creator application.

    Enforces:
    - Must be a Citizen (has _ROLE_CITIZEN).
    - No pending application.
    - 30-day cooldown after rejection.
    - Not already a creator.
    """
    if not discord_id:
        return {"error": "Authentication required"}

    role_set = set(user_roles or [])

    # Must be a Citizen
    if not (role_set & _CITIZEN_PLUS):
        return {"error": "Only Citizens can apply to become a Creator"}

    # Already a creator
    if is_creator(discord_id):
        return {"error": "You are already a Creator"}

    folder = os.path.dirname(_SHOP_DB)
    if folder:
        os.makedirs(folder, exist_ok=True)

    try:
        conn = _get_conn(timeout=10)
        _ensure_creator_applications_table(conn)

        # Check for pending application
        pending = conn.execute(
            "SELECT id FROM creator_applications "
            "WHERE discord_id = ? AND status = 'pending'",
            (discord_id,),
        ).fetchone()
        if pending:
            conn.close()
            return {"error": "You already have a pending application"}

        # Check rejection cooldown
        last_rejected = conn.execute(
            "SELECT reviewed_at FROM creator_applications "
            "WHERE discord_id = ? AND status = 'rejected' "
            "ORDER BY reviewed_at DESC LIMIT 1",
            (discord_id,),
        ).fetchone()
        if last_rejected and last_rejected["reviewed_at"]:
            reviewed = _dt.fromisoformat(last_rejected["reviewed_at"])
            if reviewed.tzinfo is None:
                reviewed = reviewed.replace(tzinfo=_tz.utc)
            cooldown_end = reviewed + _td(days=CREATOR_REAPPLY_COOLDOWN_DAYS)
            now = _now()
            if now < cooldown_end:
                remaining = cooldown_end - now
                days_left = remaining.days
                conn.close()
                return {
                    "error": "You cannot reapply yet",
                    "cooldown_ends_at": cooldown_end.isoformat(),
                    "days_remaining": days_left,
                }

        # Resolve MC identity
        mc_uuid, mc_username = resolve_uuid_for_user(discord_id)

        # Check shop ban
        if mc_uuid and is_shop_banned(mc_uuid):
            conn.close()
            return {"error": "You are banned from the shop"}

        app_id = str(_uuid_mod.uuid4())
        now_iso = _now_iso()

        answers_json = json.dumps(answers) if answers else None
        conn.execute(
            "INSERT INTO creator_applications "
            "(id, discord_id, uuid, username, status, submitted_at, answers) "
            "VALUES (?, ?, ?, ?, 'pending', ?, ?)",
            (app_id, discord_id, mc_uuid, mc_username, now_iso, answers_json),
        )
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        return {"error": f"Database error: {exc}"}

    _log_admin_action(
        mc_username or discord_id, "creator_application_submitted", app_id,
        {"discord_id": discord_id, "uuid": mc_uuid},
    )
    # DM the applicant confirming submission
    _dm_card_in_background(
        discord_id, "creator_application_submitted",
        "Creator Application",
        fields=[
            ("STATUS", "Under Review"),
            ("APPLICANT", mc_username or discord_id),
        ],
        fallback_text="Your Creator application has been submitted and is under review by Parliament.",
    )
    return {"ok": True, "id": app_id, "submitted_at": now_iso}

def get_application_status(discord_id: str) -> dict:
    """Return the user's own current/latest application status + cooldown info."""
    if not discord_id:
        return {"has_application": False}

    if not os.path.isfile(_SHOP_DB):
        return {"has_application": False, "is_creator": False}

    try:
        conn = _get_conn()
        _ensure_creator_applications_table(conn)
        _ensure_creator_flags_table(conn)

        # Check creator flag
        creator = conn.execute(
            "SELECT 1 FROM creator_flags WHERE discord_id = ?",
            (discord_id,),
        ).fetchone()

        # Latest application (any status)
        row = conn.execute(
            "SELECT id, status, submitted_at, reviewed_at, rejection_reason "
            "FROM creator_applications WHERE discord_id = ? "
            "ORDER BY submitted_at DESC LIMIT 1",
            (discord_id,),
        ).fetchone()
        conn.close()
    except sqlite3.Error:
        return {"has_application": False, "is_creator": False}

    result = {
        "is_creator": creator is not None,
        "has_application": row is not None,
    }

    if row:
        result["application"] = {
            "id": row["id"],
            "status": row["status"],
            "submitted_at": row["submitted_at"],
            "reviewed_at": row["reviewed_at"],
            "rejection_reason": row["rejection_reason"],
        }
        # Compute cooldown if rejected
        if row["status"] == "rejected" and row["reviewed_at"]:
            reviewed = _dt.fromisoformat(row["reviewed_at"])
            if reviewed.tzinfo is None:
                reviewed = reviewed.replace(tzinfo=_tz.utc)
            cooldown_end = reviewed + _td(days=CREATOR_REAPPLY_COOLDOWN_DAYS)
            now = _now()
            if now < cooldown_end:
                remaining = cooldown_end - now
                result["cooldown_ends_at"] = cooldown_end.isoformat()
                result["cooldown_days_remaining"] = remaining.days
            else:
                result["can_reapply"] = True
        elif row["status"] == "pending":
            result["can_reapply"] = False

    return result

def list_applications(status_filter: str | None = None) -> list:
    """Return all applications, optionally filtered by status. Parliament view."""
    if not os.path.isfile(_SHOP_DB):
        return []
    try:
        conn = _get_conn()
        _ensure_creator_applications_table(conn)

        if status_filter and status_filter in ("pending", "approved", "rejected"):
            rows = conn.execute(
                "SELECT id, discord_id, uuid, username, status, "
                "submitted_at, reviewed_at, reviewer, rejection_reason, answers "
                "FROM creator_applications WHERE status = ? "
                "ORDER BY submitted_at DESC",
                (status_filter,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, discord_id, uuid, username, status, "
                "submitted_at, reviewed_at, reviewer, rejection_reason, answers "
                "FROM creator_applications ORDER BY submitted_at DESC"
            ).fetchall()
        conn.close()
    except sqlite3.Error:
        return []

    results = []
    for r in rows:
        entry = {
            "id": r["id"],
            "discord_id": r["discord_id"],
            "uuid": r["uuid"],
            "username": r["username"],
            "status": r["status"],
            "submitted_at": r["submitted_at"],
            "reviewed_at": r["reviewed_at"],
            "reviewer": r["reviewer"],
            "rejection_reason": r["rejection_reason"],
        }
        raw = r["answers"]
        if raw:
            try:
                entry["answers"] = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                entry["answers"] = None
        else:
            entry["answers"] = None
        results.append(entry)
    return results

def approve_application(app_id: str, reviewer: str) -> dict:
    """Approve a creator application: grants the creator flag."""
    if not app_id:
        return {"error": "Application ID is required"}
    if not os.path.isfile(_SHOP_DB):
        return {"error": "Shop database unavailable"}

    now_iso = _now_iso()
    try:
        conn = _get_conn(timeout=10)
        _ensure_creator_applications_table(conn)

        row = conn.execute(
            "SELECT discord_id, status FROM creator_applications WHERE id = ?",
            (app_id,),
        ).fetchone()
        if not row:
            conn.close()
            return {"error": "Application not found"}
        if row["status"] != "pending":
            conn.close()
            return {"error": f"Application is already {row['status']}"}

        discord_id = row["discord_id"]

        conn.execute(
            "UPDATE creator_applications SET status = 'approved', "
            "reviewed_at = ?, reviewer = ? WHERE id = ?",
            (now_iso, reviewer, app_id),
        )
        _grant_creator_flag(conn, discord_id, reviewer)
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        return {"error": f"Database error: {exc}"}

    _log_admin_action(
        reviewer, "creator_application_approved", app_id,
        {"app_id": app_id, "discord_id": discord_id},
    )
    # DM the applicant that they've been approved
    _dm_card_in_background(
        discord_id, "creator_application_approved",
        "Creator Application",
        fields=[
            ("STATUS", "Approved"),
            ("REVIEWED BY", reviewer),
        ],
        fallback_text="Congratulations! Your Creator application has been approved. You can now submit items for the shop.",
    )
    return {"ok": True, "id": app_id, "status": "approved", "reviewed_at": now_iso}

def reject_application(app_id: str, reviewer: str, reason: str | None = None) -> dict:
    """Reject a creator application: records cooldown start."""
    if not app_id:
        return {"error": "Application ID is required"}
    if not os.path.isfile(_SHOP_DB):
        return {"error": "Shop database unavailable"}

    now_iso = _now_iso()
    try:
        conn = _get_conn(timeout=10)
        _ensure_creator_applications_table(conn)

        row = conn.execute(
            "SELECT discord_id, status FROM creator_applications WHERE id = ?",
            (app_id,),
        ).fetchone()
        if not row:
            conn.close()
            return {"error": "Application not found"}
        if row["status"] != "pending":
            conn.close()
            return {"error": f"Application is already {row['status']}"}

        conn.execute(
            "UPDATE creator_applications SET status = 'rejected', "
            "reviewed_at = ?, reviewer = ?, rejection_reason = ? WHERE id = ?",
            (now_iso, reviewer, reason, app_id),
        )
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        return {"error": f"Database error: {exc}"}

    _log_admin_action(
        reviewer, "creator_application_rejected", app_id,
        {"app_id": app_id, "discord_id": row["discord_id"], "reason": reason},
    )
    # DM the applicant that they've been rejected
    _dm_card_in_background(
        row["discord_id"], "creator_application_rejected",
        "Creator Application",
        fields=[
            ("STATUS", "Rejected"),
            ("REVIEWED BY", reviewer),
            ("COOLDOWN", f"{CREATOR_REAPPLY_COOLDOWN_DAYS} days"),
        ],
        fallback_text=f"Your Creator application has been rejected."
        + (f" Reason: {reason}" if reason else "")
        + f" You may reapply in {CREATOR_REAPPLY_COOLDOWN_DAYS} days.",
        comment=reason or "",
    )
    return {"ok": True, "id": app_id, "status": "rejected", "reviewed_at": now_iso}

def _safe_int(v, cap=999_999):
    """Coerce *v* to a non-negative int capped at *cap*, or None if blank."""
    if v is None or v == "":
        return None
    try:
        i = int(v)
    except (TypeError, ValueError):
        return None
    return min(abs(i), cap)

def _coerce_item_types(item: dict) -> None:
    """In-place coerce numeric and boolean fields to proper Python types.

    Mirrors the type normalisation that ``admin._build_item`` performs
    so that creator-submitted string values (e.g. ``"3"``) become real ints
    in the JSON catalogue.
    """
    for field in ("price", "stock", "max_quantity", "starting_bid",
                  "min_increment", "duration_hours", "anti_snipe_seconds",
                  "winner_count"):
        if field in item:
            item[field] = _safe_int(item[field])

    # visible_to_top_n
    if "visible_to_top_n" in item:
        v = _safe_int(item["visible_to_top_n"], 999)
        item["visible_to_top_n"] = v if v and v > 0 else None

    # Booleans
    for field in ("active", "accepts_dirty_ep"):
        if field in item:
            val = item[field]
            if isinstance(val, str):
                item[field] = val.strip().lower() not in ("false", "0", "no", "off")
            elif not isinstance(val, bool):
                item[field] = bool(val)

    # Variants
    variants = item.get("variants")
    if isinstance(variants, list) and variants:
        for v in variants:
            if not isinstance(v, dict):
                continue
            for vf in ("price", "stock", "max_quantity"):
                if vf in v:
                    v[vf] = _safe_int(v[vf])
            for vf in ("active", "accepts_dirty_ep"):
                if vf in v:
                    val = v[vf]
                    if isinstance(val, str):
                        v[vf] = val.strip().lower() not in ("false", "0", "no", "off")
                    elif not isinstance(val, bool):
                        v[vf] = bool(val)
        # Sync top-level stock from variants (same logic as admin._build_item)
        if item.get("type", "bin") == "bin":
            if len(variants) == 1:
                item["stock"] = variants[0].get("stock")
            else:
                if any(v.get("stock") is None for v in variants if isinstance(v, dict)):
                    item["stock"] = None
                else:
                    item["stock"] = sum(
                        v.get("stock") or 0 for v in variants if isinstance(v, dict)
                    )

# Fields that creators are NOT allowed to set/change via requests
_BLOCKED_REQUEST_FIELDS = frozenset({
    "stock", "active", "id", "creator_discord_id",
})
# Fields blocked during approval
_BLOCKED_APPLY_FIELDS = frozenset({"id", "creator_discord_id"})

# Creator Item Requests
def submit_item_request(
    discord_id: str,
    item_id: str | None,
    changes: dict,
    note: str | None = None,
    actor_name: str | None = None,
) -> dict:
    """Submit a request to create a new item or edit an existing one.

    *item_id* = None for new items, or the ID of an existing item owned
    by this creator for edits.

    *changes* is a JSON-serialisable dict of requested field values.
    """
    if not discord_id:
        return {"error": "Authentication required"}
    if not isinstance(changes, dict) or not changes:
        return {"error": "Changes must be a non-empty object"}

    # Strip blocked fields
    sanitised = {
        k: v for k, v in changes.items()
        if k not in _BLOCKED_REQUEST_FIELDS
    }
    if not sanitised:
        return {"error": "No valid changes provided (stock and active cannot be changed via requests)"}
    changes = sanitised  # store only the sanitised version

    # Creators cannot create or change items to the 'donate' type
    if sanitised.get("type") == "donate":
        return {"error": "Creators cannot create donate items"}

    if not os.path.isfile(_SHOP_DB):
        return {"error": "Shop database unavailable"}

    # Check creator flag
    if not is_creator(discord_id):
        return {"error": "Creator status required"}

    # Check shop ban
    mc_uuid, _ = resolve_uuid_for_user(discord_id)
    if mc_uuid and is_shop_banned(mc_uuid):
        return {"error": "You are banned from the shop"}

    # If editing, verify ownership
    if item_id:
        existing = get_item_unfiltered(item_id)
        if existing is None:
            return {"error": f"Item {item_id!r} not found"}
        if existing.get("creator_discord_id") != discord_id:
            return {"error": "You can only edit your own items"}

    try:
        conn = _get_conn(timeout=10)
        _ensure_creator_item_requests_table(conn)

        req_id = str(_uuid_mod.uuid4())
        now_iso = _now_iso()

        # Trim note
        note_val = (note or "").strip()[:200] or None

        conn.execute(
            "INSERT INTO creator_item_requests "
            "(id, discord_id, item_id, changes, status, submitted_at, note) "
            "VALUES (?, ?, ?, ?, 'pending', ?, ?)",
            (req_id, discord_id, item_id, json.dumps(changes, ensure_ascii=False), now_iso, note_val),
        )
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        return {"error": f"Database error: {exc}"}

    _resolved_actor = actor_name or _resolve_creator_username(discord_id)
    _log_admin_action(
        _resolved_actor, "creator_item_request_submitted", item_id or changes.get("name") or req_id,
        {
            "discord_id": discord_id,
            "username": _resolved_actor,
            "item_id": item_id,
            "item_name": changes.get("name"),
            "request_type": "edit" if item_id else "new",
            "changes": changes,
        },
    )
    # DM the creator confirming request submission
    _req_type = "Edit" if item_id else "New Item"
    _req_name = changes.get("name") or item_id or "Item"
    _dm_card_in_background(
        discord_id, "creator_request_submitted",
        _req_name,
        fields=[
            ("TYPE", _req_type),
            ("STATUS", "Under Review"),
        ],
        fallback_text=f"Your {_req_type.lower()} request for '{_req_name}' has been submitted and is under review.",
        comment=note or "",
    )
    return {"ok": True, "id": req_id, "submitted_at": now_iso}

def list_item_requests(status_filter: str | None = None) -> list:
    """Return all item requests. Parliament view."""
    if not os.path.isfile(_SHOP_DB):
        return []
    try:
        conn = _get_conn()
        _ensure_creator_item_requests_table(conn)

        _ensure_creator_applications_table(conn)
        if status_filter and status_filter in ("pending", "approved", "rejected"):
            rows = conn.execute(
                "SELECT r.id, r.discord_id, r.item_id, r.changes, r.status, "
                "r.submitted_at, r.reviewed_at, r.reviewer, r.rejection_reason, r.note, "
                "(SELECT a.username FROM creator_applications a "
                "WHERE a.discord_id = r.discord_id "
                "ORDER BY a.submitted_at DESC LIMIT 1) AS username "
                "FROM creator_item_requests r WHERE r.status = ? "
                "ORDER BY r.submitted_at DESC",
                (status_filter,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT r.id, r.discord_id, r.item_id, r.changes, r.status, "
                "r.submitted_at, r.reviewed_at, r.reviewer, r.rejection_reason, r.note, "
                "(SELECT a.username FROM creator_applications a "
                "WHERE a.discord_id = r.discord_id "
                "ORDER BY a.submitted_at DESC LIMIT 1) AS username "
                "FROM creator_item_requests r ORDER BY r.submitted_at DESC"
            ).fetchall()
        conn.close()
    except sqlite3.Error:
        return []

    _matches = _cfg_load_json(_USERNAME_MATCHES_JSON) or {}

    result = []
    for r in rows:
        try:
            changes_parsed = json.loads(r["changes"]) if r["changes"] else {}
        except (json.JSONDecodeError, TypeError):
            changes_parsed = {}
        username = r["username"]
        if not username:
            _entry = _matches.get(str(r["discord_id"]))
            username = (
                _entry.get("username") if isinstance(_entry, dict)
                else (_entry if isinstance(_entry, str) else None)
            )
        result.append({
            "id": r["id"],
            "discord_id": r["discord_id"],
            "item_id": r["item_id"],
            "changes": changes_parsed,
            "status": r["status"],
            "submitted_at": r["submitted_at"],
            "reviewed_at": r["reviewed_at"],
            "reviewer": r["reviewer"],
            "rejection_reason": r["rejection_reason"],
            "note": r["note"],
            "username": username,
        })
    return result

def approve_item_request(req_id: str, reviewer: str) -> dict:
    """Approve an item request: applies changes to the JSON catalogue.

    For new items: generates a UUID-based item ID, stamps creator_discord_id,
    appends to the JSON catalogue, and creates an inactive override.
    For edits: merges the requested changes into the existing item in JSON.
    """
    if not req_id:
        return {"error": "Request ID is required"}
    if not os.path.isfile(_SHOP_DB):
        return {"error": "Shop database unavailable"}

    now_iso = _now_iso()
    try:
        conn = _get_conn(timeout=10)
        _ensure_creator_item_requests_table(conn)

        row = conn.execute(
            "SELECT * FROM creator_item_requests WHERE id = ?",
            (req_id,),
        ).fetchone()
        if not row:
            conn.close()
            return {"error": "Request not found"}
        if row["status"] != "pending":
            conn.close()
            return {"error": f"Request is already {row['status']}"}

        discord_id = row["discord_id"]
        item_id = row["item_id"]
        try:
            changes = json.loads(row["changes"]) if row["changes"] else {}
        except (json.JSONDecodeError, TypeError):
            conn.close()
            return {"error": "Malformed changes data"}

        conn.execute(
            "UPDATE creator_item_requests SET status = 'approved', "
            "reviewed_at = ?, reviewer = ? WHERE id = ?",
            (now_iso, reviewer, req_id),
        )
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        return {"error": f"Database error: {exc}"}

    # Apply to JSON catalogue
    try:
        with _json_write_lock:
            from shop.items import _load_json
            items = _load_json()

            if item_id:
                # Edit existing item
                found = False
                for i, it in enumerate(items):
                    if it.get("id") == item_id:
                        items[i] = dict(it)
                        for k, v in changes.items():
                            if k not in _BLOCKED_APPLY_FIELDS:
                                items[i][k] = v
                        _coerce_item_types(items[i])
                        found = True
                        break
                if not found:
                    return {"error": f"Item {item_id!r} not found in catalogue during apply"}
            else:
                # New item
                import re as _re
                _raw_name = (changes.get("name") or "").strip()
                _slug = _re.sub(r'[^a-z0-9]+', '-', _raw_name.lower()).strip('-')[:40]
                if not _slug:
                    _slug = _uuid_mod.uuid4().hex[:12]
                # Deduplicate: append -2, -3, … if the slug is already taken
                _existing_ids = {it.get("id") for it in items}
                new_id = _slug
                _suffix = 2
                while new_id in _existing_ids:
                    new_id = _slug + '-' + str(_suffix)
                    _suffix += 1
                new_item = dict(changes)
                new_item["id"] = new_id
                new_item["creator_discord_id"] = discord_id
                new_item.setdefault("type", "bin")
                new_item.setdefault("active", False)
                new_item.setdefault("price", 0)
                _coerce_item_types(new_item)
                items.append(new_item)
                item_id = new_id

            _atomic_write_json(_SHOP_ITEMS_JSON, items)

            # Find the final written item for override sync
            written_item = next(
                (it for it in items if it.get("id") == item_id), None
            )
    except Exception as exc:
        print(f"[CREATOR] Failed to apply item request {req_id}: {exc}", file=sys.stderr)
        return {"error": f"Failed to apply changes: {exc}"}

    # Sync DB overrides so they don't shadow the new JSON values
    if written_item and os.path.isfile(_SHOP_DB):
        try:
            sync_conn = _get_conn(timeout=5)
            ov_row = sync_conn.execute(
                "SELECT stock, active FROM item_overrides WHERE item_id = ?",
                (item_id,),
            ).fetchone()
            if ov_row is not None:
                new_stock = written_item.get("stock")
                new_active = written_item.get("active")
                ov_stock = ov_row["stock"]
                ov_active = ov_row["active"]
                updates = []
                params = []
                if ov_stock is not None and ov_stock != new_stock:
                    updates.append("stock = ?")
                    params.append(new_stock)
                if ov_active is not None and (bool(ov_active) if ov_active is not None else None) != new_active:
                    updates.append("active = ?")
                    params.append(1 if new_active else 0)
                if updates:
                    updates.append("updated_by = ?")
                    params.append(f"creator-approve:{reviewer}")
                    updates.append("updated_at = ?")
                    params.append(now_iso)
                    params.append(item_id)
                    sync_conn.execute(
                        f"UPDATE item_overrides SET {', '.join(updates)} WHERE item_id = ?",
                        params,
                    )
                    sync_conn.commit()
            sync_conn.close()
        except sqlite3.Error as exc:
            print(f"[CREATOR] Failed to sync overrides for {item_id}: {exc}", file=sys.stderr)

    _reload_items()

    # Resolve creator username for the log
    _cr_username = None
    try:
        _cr_conn = _get_conn()
        _ensure_creator_applications_table(_cr_conn)
        _cr_row = _cr_conn.execute(
            "SELECT username FROM creator_applications WHERE discord_id = ? "
            "ORDER BY submitted_at DESC LIMIT 1",
            (discord_id,),
        ).fetchone()
        if _cr_row:
            _cr_username = _cr_row["username"]
        _cr_conn.close()
    except Exception:
        pass

    _is_new = not row["item_id"]
    _log_admin_action(
        reviewer, "creator_item_request_approved", item_id,
        {
            "req_id": req_id,
            "discord_id": discord_id,
            "username": _cr_username,
            "item_id": item_id,
            "item_name": changes.get("name") or item_id,
            "request_type": "new" if _is_new else "edit",
            "changes": changes,
        },
    )
    # DM the creator that their request was approved
    _appr_name = changes.get("name") or item_id or "Item"
    _dm_card_in_background(
        discord_id, "creator_request_approved",
        _appr_name,
        fields=[
            ("TYPE", "New Item" if _is_new else "Edit"),
            ("REVIEWED BY", reviewer),
            ("ITEM ID", item_id or "N/A"),
        ],
        fallback_text=f"Your {'new item' if _is_new else 'edit'} request for '{_appr_name}' has been approved.",
    )
    return {"ok": True, "id": req_id, "item_id": item_id, "status": "approved", "reviewed_at": now_iso}

def reject_item_request(req_id: str, reviewer: str, reason: str | None = None) -> dict:
    """Reject an item request."""
    if not req_id:
        return {"error": "Request ID is required"}
    if not os.path.isfile(_SHOP_DB):
        return {"error": "Shop database unavailable"}

    now_iso = _now_iso()
    try:
        conn = _get_conn(timeout=10)
        _ensure_creator_item_requests_table(conn)

        row = conn.execute(
            "SELECT discord_id, status FROM creator_item_requests WHERE id = ?",
            (req_id,),
        ).fetchone()
        if not row:
            conn.close()
            return {"error": "Request not found"}
        if row["status"] != "pending":
            conn.close()
            return {"error": f"Request is already {row['status']}"}

        conn.execute(
            "UPDATE creator_item_requests SET status = 'rejected', "
            "reviewed_at = ?, reviewer = ?, rejection_reason = ? WHERE id = ?",
            (now_iso, reviewer, reason, req_id),
        )
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        return {"error": f"Database error: {exc}"}

    # Resolve item_id and creator username for the log
    _rej_item_id = None
    _rej_username = None
    _rej_changes = {}
    try:
        _rej_conn = _get_conn()
        _ensure_creator_item_requests_table(_rej_conn)
        _rej_full = _rej_conn.execute(
            "SELECT item_id, changes FROM creator_item_requests WHERE id = ?",
            (req_id,),
        ).fetchone()
        if _rej_full:
            _rej_item_id = _rej_full["item_id"]
            try:
                _rej_changes = json.loads(_rej_full["changes"]) if _rej_full["changes"] else {}
            except (json.JSONDecodeError, TypeError):
                pass
        _ensure_creator_applications_table(_rej_conn)
        _rej_u = _rej_conn.execute(
            "SELECT username FROM creator_applications WHERE discord_id = ? "
            "ORDER BY submitted_at DESC LIMIT 1",
            (row["discord_id"],),
        ).fetchone()
        if _rej_u:
            _rej_username = _rej_u["username"]
        _rej_conn.close()
    except Exception:
        pass

    _rej_is_new = not _rej_item_id
    _rej_target = _rej_item_id or _rej_changes.get("name") or req_id
    _log_admin_action(
        reviewer, "creator_item_request_rejected", _rej_target,
        {
            "req_id": req_id,
            "discord_id": row["discord_id"],
            "username": _rej_username,
            "item_id": _rej_item_id,
            "item_name": _rej_changes.get("name"),
            "request_type": "new" if _rej_is_new else "edit",
            "reason": reason,
        },
    )
    # DM the creator that their request was rejected
    _rej_name = _rej_changes.get("name") or _rej_item_id or "Item"
    _dm_card_in_background(
        row["discord_id"], "creator_request_rejected",
        _rej_name,
        fields=[
            ("TYPE", "New Item" if _rej_is_new else "Edit"),
            ("REVIEWED BY", reviewer),
        ],
        fallback_text=f"Your {'new item' if _rej_is_new else 'edit'} request for '{_rej_name}' has been rejected."
        + (f" Reason: {reason}" if reason else ""),
        comment=reason or "",
    )
    return {"ok": True, "id": req_id, "status": "rejected", "reviewed_at": now_iso}


def list_creators_with_usernames() -> list:
    """Return a list of {discord_id, username} for all creators."""
    if not os.path.isfile(_SHOP_DB):
        return []
    try:
        conn = _get_conn()
        _ensure_creator_flags_table(conn)
        _ensure_creator_applications_table(conn)
        rows = conn.execute(
            "SELECT f.discord_id, "
            "(SELECT a.username FROM creator_applications a "
            "WHERE a.discord_id = f.discord_id "
            "ORDER BY a.submitted_at DESC LIMIT 1) AS username "
            "FROM creator_flags f ORDER BY f.granted_at DESC"
        ).fetchall()
        conn.close()
        result = []
        for r in rows:
            uname = r["username"]
            if not uname:
                uname = _resolve_creator_username(r["discord_id"])
            result.append({
                "discord_id": r["discord_id"],
                "username": uname,
            })
        return result
    except sqlite3.Error:
        return []


def _resolve_creator_username(discord_id: str) -> str:
    """Return the creator's MC username, falling back to discord_id."""
    try:
        conn = _get_conn()
        _ensure_creator_applications_table(conn)
        row = conn.execute(
            "SELECT username FROM creator_applications WHERE discord_id = ? "
            "ORDER BY submitted_at DESC LIMIT 1",
            (discord_id,),
        ).fetchone()
        conn.close()
        if row and row["username"]:
            return row["username"]
    except Exception:
        pass
    # Fallback: try resolve_uuid_for_user
    try:
        _, mc_name = resolve_uuid_for_user(discord_id)
        if mc_name:
            return mc_name
    except Exception:
        pass
    return discord_id


# Creator's own items
def get_creator_items(discord_id: str) -> dict:
    """Return the calling creator's own items and any pending item requests."""
    if not discord_id:
        return {"items": [], "pending_requests": []}

    # Fetch items from JSON catalogue where creator_discord_id matches
    _reload_items()
    from shop.items import _load_json, _load_overrides, _merge
    all_items = _merge(_load_json(), _load_overrides())
    own_items = [
        it for it in all_items
        if it.get("creator_discord_id") == discord_id
    ]

    # Fetch pending item requests
    pending = []
    if os.path.isfile(_SHOP_DB):
        try:
            conn = _get_conn()
            _ensure_creator_item_requests_table(conn)
            rows = conn.execute(
                "SELECT id, item_id, changes, status, submitted_at, "
                "reviewed_at, reviewer, rejection_reason, note "
                "FROM creator_item_requests WHERE discord_id = ? "
                "ORDER BY submitted_at DESC",
                (discord_id,),
            ).fetchall()
            conn.close()
            for r in rows:
                try:
                    changes_parsed = json.loads(r["changes"]) if r["changes"] else {}
                except (json.JSONDecodeError, TypeError):
                    changes_parsed = {}
                pending.append({
                    "id": r["id"],
                    "item_id": r["item_id"],
                    "changes": changes_parsed,
                    "status": r["status"],
                    "submitted_at": r["submitted_at"],
                    "reviewed_at": r["reviewed_at"],
                    "reviewer": r["reviewer"],
                    "rejection_reason": r["rejection_reason"],
                    "note": r["note"],
                })
        except sqlite3.Error:
            pass

    return {"items": own_items, "requests": pending}

def get_creator_orders(discord_id: str) -> dict:
    """Return purchases made on this creator's items (all statuses)."""
    if not discord_id:
        return {"orders": []}

    # Collect item IDs owned by this creator
    _reload_items()
    from shop.items import _load_json, _load_overrides, _merge
    all_items = _merge(_load_json(), _load_overrides())
    own_ids = [
        it["id"] for it in all_items
        if it.get("creator_discord_id") == discord_id and it.get("id")
    ]
    if not own_ids or not os.path.isfile(_SHOP_DB):
        return {"orders": []}

    try:
        conn = _get_conn()
        placeholders = ",".join("?" for _ in own_ids)
        rows = conn.execute(
            f"SELECT purchase_id, item_id, uuid, username, quantity, "
            f"ep_spent, clean_ep_spent, dirty_ep_spent, status, "
            f"fulfillment_note, chief_note, purchased_at, resolved_at, "
            f"COALESCE(variant_name, '') AS variant_name "
            f"FROM bin_purchases WHERE item_id IN ({placeholders}) "
            f"ORDER BY purchased_at DESC",
            own_ids,
        ).fetchall()
        conn.close()
        orders = [dict(r) for r in rows]
    except sqlite3.Error:
        orders = []

    return {"orders": orders}


def fulfill_own_order(discord_id: str, purchase_id: str, note: str | None, actor: str = "") -> dict:
    """Mark a pending purchase on the creator's own item as fulfilled."""
    if not discord_id or not purchase_id:
        return {"error": "Missing parameters"}
    if not os.path.isfile(_SHOP_DB):
        return {"error": "Database not found"}

    now_iso = _now_iso()
    try:
        conn = _get_conn(timeout=10)
        row = conn.execute(
            "SELECT * FROM bin_purchases WHERE purchase_id = ? AND status = 'pending'",
            (purchase_id,),
        ).fetchone()
        if not row:
            conn.close()
            return {"error": "Purchase not found or not pending"}

        # Verify the item belongs to this creator
        item_id = row["item_id"]
        existing = get_item_unfiltered(item_id)
        if existing is None or existing.get("creator_discord_id") != discord_id:
            conn.close()
            return {"error": "You can only fulfill orders on your own items"}

        conn.execute(
            "UPDATE bin_purchases SET status = 'fulfilled', chief_note = ?, resolved_at = ? "
            "WHERE purchase_id = ?",
            (note, now_iso, purchase_id),
        )
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        return {"error": f"Database error: {exc}"}

    # DM the buyer
    buyer_did = _resolve_discord_id_for_uuid(row["uuid"])
    if buyer_did:
        _dm_card_in_background(
            buyer_did, "purchase_fulfilled", row["item_id"], row["ep_spent"],
            fields=[
                ("EP SPENT", f"{row['ep_spent']:,} EP"),
                ("STATUS", "Fulfilled"),
                *( [("NOTE", note[:50])] if note else [] ),
            ],
            fallback_text=f"Your purchase of {row['item_id']} ({row['ep_spent']} EP) has been fulfilled.",
        )

    _log_admin_action(
        actor or _resolve_creator_username(discord_id), "purchase_fulfilled", purchase_id,
        {"purchase_id": purchase_id, "item_id": row["item_id"],
         "ep_spent": row["ep_spent"], "username": row["username"],
         "note": note},
    )
    _invalidate_users_cache()

    # Grant creator commission (self-fulfillment path)
    commission = _grant_creator_commission(
        discord_id, row["item_id"], row["ep_spent"],
        purchase_id, actor or _resolve_creator_username(discord_id),
    )
    return {"ok": True, "purchase_id": purchase_id, "status": "fulfilled",
            "resolved_at": now_iso, "commission": commission}


def reject_own_order(discord_id: str, purchase_id: str, reason: str, actor: str = "") -> dict:
    """Reject a pending purchase on the creator's own item. Restores stock & refunds EP."""
    if not discord_id or not purchase_id:
        return {"error": "Missing parameters"}
    if not reason:
        return {"error": "Reason is required"}
    if not os.path.isfile(_SHOP_DB):
        return {"error": "Database not found"}

    now_iso = _now_iso()
    try:
        conn = _get_conn(timeout=10)
        row = conn.execute(
            "SELECT * FROM bin_purchases WHERE purchase_id = ? AND status = 'pending'",
            (purchase_id,),
        ).fetchone()
        if not row:
            conn.close()
            return {"error": "Purchase not found or not pending"}

        item_id = row["item_id"]
        existing = get_item_unfiltered(item_id)
        if existing is None or existing.get("creator_discord_id") != discord_id:
            conn.close()
            return {"error": "You can only reject orders on your own items"}

        conn.execute(
            "UPDATE bin_purchases SET status = 'rejected', chief_note = ?, resolved_at = ? "
            "WHERE purchase_id = ?",
            (reason, now_iso, purchase_id),
        )
        try:
            qty = row["quantity"] or 1
        except (IndexError, KeyError):
            qty = 1
        _restore_stock(conn, item_id, qty, now_iso)
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        return {"error": f"Database error: {exc}"}

    from shop.items import reload as _reload
    _reload()

    buyer_did = _resolve_discord_id_for_uuid(row["uuid"])
    if buyer_did:
        _dm_card_in_background(
            buyer_did, "purchase_rejected", row["item_id"], row["ep_spent"],
            fields=[
                ("REASON", reason[:50]),
                ("REFUNDED", f"{row['ep_spent']} EP"),
            ],
            fallback_text=f"Your purchase of {row['item_id']} was rejected. {row['ep_spent']} EP refunded. Reason: {reason}",
        )

    _log_admin_action(
        actor or _resolve_creator_username(discord_id), "purchase_rejected", purchase_id,
        {"purchase_id": purchase_id, "item_id": row["item_id"],
         "ep_spent": row["ep_spent"], "username": row["username"],
         "reason": reason},
    )
    _invalidate_users_cache()
    return {"ok": True, "purchase_id": purchase_id, "status": "rejected", "resolved_at": now_iso}


def update_own_item_stock(discord_id: str, item_id: str, stock: int | None, actor: str = "") -> dict:
    """Directly update the stock of the creator's own item.

    *stock* = None means unlimited.
    """
    if not discord_id or not item_id:
        return {"error": "Missing parameters"}

    existing = get_item_unfiltered(item_id)
    if existing is None:
        return {"error": f"Item {item_id!r} not found"}
    if existing.get("creator_discord_id") != discord_id:
        return {"error": "You can only update stock on your own items"}

    if stock is not None:
        if not isinstance(stock, int) or stock < 0:
            return {"error": "Stock must be a non-negative integer or null"}
        if stock > 99999:
            return {"error": "Stock cannot exceed 99,999"}

    # Use the existing admin_set_override for consistency
    result = admin_set_override(
        item_id, active=None, stock=stock,
        updated_by=actor or _resolve_creator_username(discord_id),
        clear_stock=(stock is None),
    )
    if isinstance(result, dict) and "error" in result:
        return result
    return {"ok": True, "item_id": item_id, "stock": stock}

def update_own_item_active(discord_id: str, item_id: str, active: bool, actor: str = "") -> dict:
    """Directly toggle the active state of the creator's own item."""
    if not discord_id or not item_id:
        return {"error": "Missing parameters"}

    existing = get_item_unfiltered(item_id)
    if existing is None:
        return {"error": f"Item {item_id!r} not found"}
    if existing.get("creator_discord_id") != discord_id:
        return {"error": "You can only toggle your own items"}

    result = admin_set_override(
        item_id, active=bool(active), stock=None,
        updated_by=actor or _resolve_creator_username(discord_id),
    )
    if isinstance(result, dict) and "error" in result:
        return result
    return {"ok": True, "item_id": item_id, "active": bool(active)}
