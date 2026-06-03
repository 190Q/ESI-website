import os
import sqlite3
import json
from datetime import datetime as _dt, timezone as _tz

from config import _SHOP_DB


_SHOP_ENABLED_KEY = "shop_enabled"
_SHOP_HAS_EVER_ENABLED_KEY = "shop_has_ever_enabled"
_SHOP_MAINTENANCE_SETTINGS_KEY = "shop_maintenance_settings"
_SHOP_ADMIN_MAINTENANCE_SETTINGS_KEY = "shop_admin_maintenance_settings"
_SHOP_MAINT_BOOL_FIELDS = (
    "shop_visible",
    "show_items",
    "show_balance_bar",
    "show_orders",
)
_SHOP_MAINT_AUDIENCE_TYPES = (
    "normal_users",
    "chief_admins",
    "parliament_admins",
)
_SHOP_ADMIN_MAINT_BOOL_FIELDS = (
    "admin_visible",
    "show_items_tab",
    "allow_item_edit",
    "show_queue_tab",
    "allow_queue_actions",
    "show_logs_tab",
    "show_users_tab",
    "allow_user_edit",
)
_SHOP_ADMIN_MAINT_AUDIENCE_TYPES = (
    "creators",
    "chief_admins",
    "parliament_admins",
)
_DEFAULT_SHOP_MAINTENANCE_SETTINGS = {
    "shop_visible": True,
    "show_items": True,
    "show_balance_bar": True,
    "show_orders": True,
    "affected_user_types": None,
    "eta_iso": None,
    "owner_notified_at": None,
    "owner_notified_for_eta": None,
}
_DEFAULT_SHOP_ADMIN_MAINTENANCE_SETTINGS = {
    "admin_visible": True,
    "show_items_tab": True,
    "allow_item_edit": True,
    "show_queue_tab": True,
    "allow_queue_actions": True,
    "show_logs_tab": True,
    "show_users_tab": True,
    "allow_user_edit": True,
    "affected_user_types": None,
}

def _migrate_bin_purchases_check(conn: sqlite3.Connection) -> None:
    """Remove the CHECK constraint on bin_purchases.status if present.

    SQLite doesn't support ALTER CONSTRAINT, so we recreate the table.
    Only runs once (checks for 'refund_pending' insertability first).
    """
    try:
        # Test if the new statuses are already allowed
        conn.execute("SAVEPOINT _chk_test")
        conn.execute(
            "INSERT INTO bin_purchases (purchase_id, item_id, uuid, username, "
            "ep_spent, clean_ep_spent, dirty_ep_spent, status, purchased_at) "
            "VALUES ('__chk_test__', '', '', '', 0, 0, 0, 'refund_pending', '')"
        )
        conn.execute("DELETE FROM bin_purchases WHERE purchase_id = '__chk_test__'")
        conn.execute("RELEASE _chk_test")
        return  # constraint already allows new statuses
    except sqlite3.IntegrityError:
        conn.execute("ROLLBACK TO _chk_test")
        conn.execute("RELEASE _chk_test")
    except sqlite3.OperationalError:
        try:
            conn.execute("ROLLBACK TO _chk_test")
            conn.execute("RELEASE _chk_test")
        except Exception:
            pass
        return  # table doesn't exist yet, nothing to migrate

    import sys
    print("[SHOP] Migrating bin_purchases CHECK constraint...", file=sys.stderr)
    try:
        # Get the column list from the existing table
        cols = conn.execute("PRAGMA table_info(bin_purchases)").fetchall()
        col_names = [c[1] for c in cols]
        col_csv = ", ".join(col_names)

        conn.execute("ALTER TABLE bin_purchases RENAME TO _bin_purchases_old")
        # Rebuild without the CHECK constraint
        col_defs = []
        for c in cols:
            d = c[1] + " " + c[2]
            if c[3]:  # NOT NULL
                d += " NOT NULL"
            if c[4] is not None:  # DEFAULT
                d += " DEFAULT " + str(c[4])
            if c[5]:  # PK
                d += " PRIMARY KEY"
            col_defs.append(d)
        conn.execute("CREATE TABLE bin_purchases (" + ", ".join(col_defs) + ")")
        conn.execute("INSERT INTO bin_purchases (" + col_csv + ") SELECT " + col_csv + " FROM _bin_purchases_old")
        conn.execute("DROP TABLE _bin_purchases_old")
        conn.commit()
        print("[SHOP] Migration complete.", file=sys.stderr)
    except Exception as exc:
        print(f"[SHOP] Migration failed: {exc}", file=sys.stderr)
        try:
            conn.execute("ROLLBACK")
        except Exception:
            pass

def _now_iso() -> str:
    return _dt.now(_tz.utc).isoformat()

def _ensure_settings_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS shop_settings (
            key         TEXT PRIMARY KEY,
            value       TEXT NOT NULL,
            updated_at  TEXT NOT NULL,
            updated_by  TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_shop_settings_updated_at "
        "ON shop_settings (updated_at)"
    )

def _as_bool(value, default: bool = False) -> bool:
    if value is None:
        return bool(default)
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}

def _get_setting_value(conn: sqlite3.Connection, key: str):
    row = conn.execute(
        "SELECT value FROM shop_settings WHERE key = ?",
        (key,),
    ).fetchone()
    return row[0] if row else None
def _upsert_setting(conn: sqlite3.Connection, key: str, value: str, updated_at: str, updated_by: str) -> None:
    conn.execute(
        "INSERT INTO shop_settings (key, value, updated_at, updated_by) "
        "VALUES (?, ?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET "
        "  value = excluded.value, "
        "  updated_at = excluded.updated_at, "
        "  updated_by = excluded.updated_by",
        (key, value, updated_at, updated_by),
    )

def _parse_iso_utc(value) -> _dt | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = _dt.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=_tz.utc)
    return parsed.astimezone(_tz.utc)
def _normalize_audience_tokens(raw_value, allowed_tokens) -> list | None:
    if not isinstance(raw_value, (list, tuple)):
        return None
    allowed = set(allowed_tokens or [])
    cleaned: list = []
    seen: set = set()
    for entry in raw_value:
        text = str(entry or "").strip().lower()
        if not text:
            continue
        is_exclude = text.startswith("!")
        token = text[1:] if is_exclude else text
        if token not in allowed:
            continue
        normalized = ("!" + token) if is_exclude else token
        if normalized in seen:
            continue
        seen.add(normalized)
        cleaned.append(normalized)
    return cleaned or None

def _normalize_shop_maintenance_settings(raw) -> dict:
    base = dict(_DEFAULT_SHOP_MAINTENANCE_SETTINGS)
    payload = raw
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (TypeError, ValueError, json.JSONDecodeError):
            payload = None
    if isinstance(payload, dict):
        for field in _SHOP_MAINT_BOOL_FIELDS:
            if field in payload:
                base[field] = _as_bool(payload.get(field), default=base[field])
        if "affected_user_types" in payload:
            base["affected_user_types"] = _normalize_audience_tokens(
                payload.get("affected_user_types"),
                _SHOP_MAINT_AUDIENCE_TYPES,
            )
        eta_dt = _parse_iso_utc(payload.get("eta_iso"))
        base["eta_iso"] = eta_dt.isoformat() if eta_dt else None
        notified_at_dt = _parse_iso_utc(payload.get("owner_notified_at"))
        base["owner_notified_at"] = notified_at_dt.isoformat() if notified_at_dt else None
        notified_for_dt = _parse_iso_utc(payload.get("owner_notified_for_eta"))
        base["owner_notified_for_eta"] = notified_for_dt.isoformat() if notified_for_dt else None
    if not base["eta_iso"] or base["owner_notified_for_eta"] != base["eta_iso"]:
        base["owner_notified_at"] = None
        base["owner_notified_for_eta"] = None
    return base

def _normalize_shop_admin_maintenance_settings(raw) -> dict:
    base = dict(_DEFAULT_SHOP_ADMIN_MAINTENANCE_SETTINGS)
    payload = raw
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except (TypeError, ValueError, json.JSONDecodeError):
            payload = None
    if isinstance(payload, dict):
        for field in _SHOP_ADMIN_MAINT_BOOL_FIELDS:
            if field in payload:
                base[field] = _as_bool(payload.get(field), default=base[field])
        if "affected_user_types" in payload:
            base["affected_user_types"] = _normalize_audience_tokens(
                payload.get("affected_user_types"),
                _SHOP_ADMIN_MAINT_AUDIENCE_TYPES,
            )
    if not base["show_items_tab"]:
        base["allow_item_edit"] = False
    if not base["show_queue_tab"]:
        base["allow_queue_actions"] = False
    if not base["show_users_tab"]:
        base["allow_user_edit"] = False
    has_any_tab = bool(base["show_items_tab"] or base["show_queue_tab"] or base["show_logs_tab"] or base["show_users_tab"])
    if not has_any_tab:
        base["admin_visible"] = False
    if not base["admin_visible"]:
        base["show_items_tab"] = False
        base["allow_item_edit"] = False
        base["show_queue_tab"] = False
        base["allow_queue_actions"] = False
        base["show_logs_tab"] = False
        base["show_users_tab"] = False
        base["allow_user_edit"] = False
    return base

def _get_shop_maintenance_settings_from_conn(conn: sqlite3.Connection) -> dict:
    raw = _get_setting_value(conn, _SHOP_MAINTENANCE_SETTINGS_KEY)
    return _normalize_shop_maintenance_settings(raw)

def _get_shop_admin_maintenance_settings_from_conn(conn: sqlite3.Connection) -> dict:
    raw = _get_setting_value(conn, _SHOP_ADMIN_MAINTENANCE_SETTINGS_KEY)
    return _normalize_shop_admin_maintenance_settings(raw)

def _write_shop_maintenance_settings(conn: sqlite3.Connection, settings: dict, updated_at: str, updated_by: str) -> None:
    normalized = _normalize_shop_maintenance_settings(settings)
    encoded = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
    _upsert_setting(conn, _SHOP_MAINTENANCE_SETTINGS_KEY, encoded, updated_at, updated_by)

def _write_shop_admin_maintenance_settings(conn: sqlite3.Connection, settings: dict, updated_at: str, updated_by: str) -> None:
    normalized = _normalize_shop_admin_maintenance_settings(settings)
    encoded = json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))
    _upsert_setting(conn, _SHOP_ADMIN_MAINTENANCE_SETTINGS_KEY, encoded, updated_at, updated_by)

def _has_shop_enabled_log(conn: sqlite3.Connection) -> bool:
    """Legacy fallback: infer whether shop was ever enabled from admin logs."""
    try:
        table_exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'shop_admin_log'"
        ).fetchone()
        if not table_exists:
            return False
        row = conn.execute(
            "SELECT 1 FROM shop_admin_log WHERE action = 'shop_enabled' LIMIT 1"
        ).fetchone()
        return bool(row)
    except sqlite3.Error:
        return False

def _get_has_ever_enabled(conn: sqlite3.Connection, default: bool = False) -> bool:
    raw = _get_setting_value(conn, _SHOP_HAS_EVER_ENABLED_KEY)
    if raw is not None:
        return _as_bool(raw, default=default)
    # Backward-compatible inference for existing installs.
    if _as_bool(_get_setting_value(conn, _SHOP_ENABLED_KEY), default=False):
        return True
    return _has_shop_enabled_log(conn) or bool(default)

def get_shop_enabled(default: bool = False) -> bool:
    """Return the persisted shop enabled flag (default False when unset)."""
    if not os.path.isfile(_SHOP_DB):
        return bool(default)
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_settings_table(conn)
        _migrate_bin_purchases_check(conn)
        row = _get_setting_value(conn, _SHOP_ENABLED_KEY)
        conn.close()
    except sqlite3.Error:
        return bool(default)
    return _as_bool(row, default=default)

def get_shop_has_ever_enabled(default: bool = False) -> bool:
    """Return True once the shop has ever been enabled at least once."""
    if not os.path.isfile(_SHOP_DB):
        return bool(default)
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        _ensure_settings_table(conn)
        value = _get_has_ever_enabled(conn, default=default)
        conn.close()
    except sqlite3.Error:
        return bool(default)
    return bool(value)

def get_shop_disabled_message() -> str:
    """Return the user-facing message for the disabled shop state."""
    return "Under maintenance" if get_shop_has_ever_enabled(default=False) else "Coming soon"
def get_shop_maintenance_settings() -> dict:
    """Return persisted maintenance settings with defaults."""
    if not os.path.isfile(_SHOP_DB):
        return dict(_DEFAULT_SHOP_MAINTENANCE_SETTINGS)
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_settings_table(conn)
        settings = _get_shop_maintenance_settings_from_conn(conn)
        conn.close()
        return settings
    except sqlite3.Error:
        return dict(_DEFAULT_SHOP_MAINTENANCE_SETTINGS)

def get_shop_admin_maintenance_settings() -> dict:
    """Return persisted admin/creator maintenance settings with defaults."""
    if not os.path.isfile(_SHOP_DB):
        return dict(_DEFAULT_SHOP_ADMIN_MAINTENANCE_SETTINGS)
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_settings_table(conn)
        settings = _get_shop_admin_maintenance_settings_from_conn(conn)
        conn.close()
        return settings
    except sqlite3.Error:
        return dict(_DEFAULT_SHOP_ADMIN_MAINTENANCE_SETTINGS)

def set_shop_maintenance_settings(settings: dict, actor: str = "unknown") -> dict:
    """Persist maintenance settings for disabled-shop behavior."""
    if not isinstance(settings, dict):
        return {"error": "settings must be an object"}
    folder = os.path.dirname(_SHOP_DB)
    if folder:
        os.makedirs(folder, exist_ok=True)
    now_iso = _now_iso()
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_settings_table(conn)
        current = _get_shop_maintenance_settings_from_conn(conn)
        updated = dict(current)
        for field in _SHOP_MAINT_BOOL_FIELDS:
            if field in settings:
                updated[field] = _as_bool(settings.get(field), default=current.get(field, True))
        if "affected_user_types" in settings:
            updated["affected_user_types"] = _normalize_audience_tokens(
                settings.get("affected_user_types"),
                _SHOP_MAINT_AUDIENCE_TYPES,
            )
        if "eta_iso" in settings:
            eta_dt = _parse_iso_utc(settings.get("eta_iso"))
            new_eta = eta_dt.isoformat() if eta_dt else None
            if new_eta != current.get("eta_iso"):
                updated["owner_notified_at"] = None
                updated["owner_notified_for_eta"] = None
            updated["eta_iso"] = new_eta
        _write_shop_maintenance_settings(conn, updated, now_iso, actor)
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        return {"error": str(exc)}
    return {
        "ok": True,
        "maintenance_settings": _normalize_shop_maintenance_settings(updated),
        "updated_at": now_iso,
        "updated_by": actor,
    }

def set_shop_admin_maintenance_settings(settings: dict, actor: str = "unknown") -> dict:
    """Persist admin/creator-studio maintenance settings."""
    if not isinstance(settings, dict):
        return {"error": "settings must be an object"}
    folder = os.path.dirname(_SHOP_DB)
    if folder:
        os.makedirs(folder, exist_ok=True)
    now_iso = _now_iso()
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_settings_table(conn)
        current = _get_shop_admin_maintenance_settings_from_conn(conn)
        updated = dict(current)
        for field in _SHOP_ADMIN_MAINT_BOOL_FIELDS:
            if field in settings:
                updated[field] = _as_bool(settings.get(field), default=current.get(field, True))
        if "affected_user_types" in settings:
            updated["affected_user_types"] = _normalize_audience_tokens(
                settings.get("affected_user_types"),
                _SHOP_ADMIN_MAINT_AUDIENCE_TYPES,
            )
        normalized = _normalize_shop_admin_maintenance_settings(updated)
        _write_shop_admin_maintenance_settings(conn, normalized, now_iso, actor)
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        return {"error": str(exc)}
    return {
        "ok": True,
        "admin_maintenance_settings": normalized,
        "updated_at": now_iso,
        "updated_by": actor,
    }

def claim_due_maintenance_eta_notification(actor: str = "system") -> dict | None:
    """Mark ETA reminder as claimed once due, returning notification payload."""
    if not os.path.isfile(_SHOP_DB):
        return None
    now_dt = _dt.now(_tz.utc)
    now_iso = now_dt.isoformat()
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_settings_table(conn)
        enabled = _as_bool(_get_setting_value(conn, _SHOP_ENABLED_KEY), default=False)
        if enabled:
            conn.close()
            return None
        settings = _get_shop_maintenance_settings_from_conn(conn)
        eta_iso = settings.get("eta_iso")
        eta_dt = _parse_iso_utc(eta_iso)
        if not eta_dt or eta_dt > now_dt:
            conn.close()
            return None
        if settings.get("owner_notified_for_eta") == eta_iso:
            conn.close()
            return None
        settings["owner_notified_for_eta"] = eta_iso
        settings["owner_notified_at"] = now_iso
        _write_shop_maintenance_settings(conn, settings, now_iso, actor)
        conn.commit()
        conn.close()
        return {
            "eta_iso": eta_iso,
            "notified_at": now_iso,
            "maintenance_settings": settings,
        }
    except sqlite3.Error:
        return None

def get_shop_state() -> dict:
    enabled = get_shop_enabled(default=False)
    message = None if enabled else get_shop_disabled_message()
    maintenance_settings = get_shop_maintenance_settings()
    admin_maintenance_settings = get_shop_admin_maintenance_settings()
    return {
        "shop_enabled": enabled,
        "coming_soon": bool(message == "Coming soon"),
        "message": message,
        "maintenance_settings": maintenance_settings,
        "admin_maintenance_settings": admin_maintenance_settings,
        "maintenance_view_only": bool((not enabled) and maintenance_settings.get("shop_visible", True)),
    }

def set_shop_enabled(enabled: bool, actor: str = "unknown") -> dict:
    """Persist the global shop enabled/disabled flag."""
    folder = os.path.dirname(_SHOP_DB)
    if folder:
        os.makedirs(folder, exist_ok=True)
    now_iso = _now_iso()
    value = "true" if enabled else "false"
    has_ever_enabled = False
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_settings_table(conn)
        current_enabled = _as_bool(_get_setting_value(conn, _SHOP_ENABLED_KEY), default=False)
        has_ever_enabled = _get_has_ever_enabled(conn, default=False)
        if enabled or current_enabled or has_ever_enabled:
            has_ever_enabled = True
        _upsert_setting(conn, _SHOP_ENABLED_KEY, value, now_iso, actor)
        _upsert_setting(conn, _SHOP_HAS_EVER_ENABLED_KEY, "true" if has_ever_enabled else "false", now_iso, actor)
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        return {"error": str(exc)}
    message = None if enabled else ("Under maintenance" if has_ever_enabled else "Coming soon")
    return {
        "ok": True,
        "shop_enabled": bool(enabled),
        "coming_soon": bool(message == "Coming soon"),
        "message": message,
        "updated_at": now_iso,
        "updated_by": actor,
    }
