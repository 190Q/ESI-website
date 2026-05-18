import os
import sqlite3
from datetime import datetime as _dt, timezone as _tz

from config import _SHOP_DB


_SHOP_ENABLED_KEY = "shop_enabled"
_SHOP_HAS_EVER_ENABLED_KEY = "shop_has_ever_enabled"

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

def get_shop_state() -> dict:
    enabled = get_shop_enabled(default=False)
    message = None if enabled else get_shop_disabled_message()
    return {
        "shop_enabled": enabled,
        "coming_soon": bool(message == "Coming soon"),
        "message": message,
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
        conn.execute(
            "INSERT INTO shop_settings (key, value, updated_at, updated_by) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET "
            "  value = excluded.value, "
            "  updated_at = excluded.updated_at, "
            "  updated_by = excluded.updated_by",
            (_SHOP_ENABLED_KEY, value, now_iso, actor),
        )
        conn.execute(
            "INSERT INTO shop_settings (key, value, updated_at, updated_by) "
            "VALUES (?, ?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET "
            "  value = excluded.value, "
            "  updated_at = excluded.updated_at, "
            "  updated_by = excluded.updated_by",
            (_SHOP_HAS_EVER_ENABLED_KEY, "true" if has_ever_enabled else "false", now_iso, actor),
        )
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
