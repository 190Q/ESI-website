"""
ip_ban.py — Fail2ban-style IP banning system.
Tracks "strikes" per IP across configurable jails and automatically
bans IPs that exceed thresholds.  Bans escalate on repeat offences.

    Jails
    ─────
    blocked     10 × 403 in 5 min  → 30 min ban
    rate_limit  20 × 429 in 5 min  → 60 min ban

    Escalation
    ──────────
    Each subsequent ban for the same IP doubles the duration,
    up to BAN_MAX_DURATION (default 24 h).

    Permanent Blacklist
    ───────────────────
    After BAN_BLACKLIST_AFTER (default 3) temporary bans, an IP
    is automatically moved to the permanent blacklist.  IPs can
    also be blacklisted manually via blacklist_ip().  Blacklisted
    IPs are blocked unconditionally until manually removed with
    unblacklist_ip().

    Persistence
    ───────────
    Active bans, ban history, and the permanent blacklist are
    all stored in SQLite so they survive restarts.
"""

import os
import sys
import json
import threading
import sqlite3
from time import time
from collections import deque

from config import _BASE_DIR, DEV_MODE

# paths

_LOG_DIR = os.path.join(_BASE_DIR, "logs")
os.makedirs(_LOG_DIR, exist_ok=True)
_BAN_DB = os.path.join(_LOG_DIR, "ip_bans.db")

# configurable constants (overridable via config.py)

# {jail_name: (max_strikes, window_seconds, base_ban_seconds)}
BAN_JAILS = {
    "blocked":    (10, 300, 1800),    # 10 × 403 in 5 min → 30 min
    "rate_limit": (20, 300, 3600),    # 20 × 429 in 5 min → 60 min
}
BAN_MAX_DURATION     = 86400           # hard cap: 24 hours
BAN_BLACKLIST_AFTER  = 3               # auto-blacklist after this many temp bans
BAN_CLEANUP_INTERVAL = 300             # purge expired entries every 5 min
BAN_WHITELIST: set   = {"127.0.0.1", "::1"}

# in-memory state

# strikes: {(ip, jail): deque([timestamp, …])}
_strikes: dict = {}
_strikes_lock  = threading.Lock()

# active bans: {ip: expires_ts}
_bans: dict   = {}
_bans_lock    = threading.Lock()

# permanent blacklist: {ip: reason}
_blacklist: dict = {}
_blacklist_lock  = threading.Lock()

# escalation counter: {ip: consecutive_ban_count}
_escalation: dict = {}

_last_cleanup = 0

# SQLite persistence

_db_local = threading.local()


def _init_db():
    conn = sqlite3.connect(_BAN_DB)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS active_bans (
            ip          TEXT PRIMARY KEY,
            expires_at  REAL NOT NULL,
            jail        TEXT NOT NULL,
            banned_at   REAL NOT NULL,
            ban_count   INTEGER NOT NULL DEFAULT 1
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ban_history (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            ip          TEXT    NOT NULL,
            jail        TEXT    NOT NULL,
            banned_at   REAL    NOT NULL,
            expires_at  REAL    NOT NULL,
            ban_count   INTEGER NOT NULL DEFAULT 1
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS blacklist (
            ip          TEXT PRIMARY KEY,
            reason      TEXT NOT NULL DEFAULT '',
            added_at    REAL NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_bh_ip ON ban_history(ip)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_bh_ts ON ban_history(banned_at)")
    conn.commit()
    conn.close()


_init_db()


def _get_db():
    conn = getattr(_db_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(_BAN_DB, timeout=10, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        _db_local.conn = conn
    return conn


def _load_persisted_bans():
    """Restore active bans from disk on startup."""
    now = time()
    conn = _get_db()
    rows = conn.execute(
        "SELECT ip, expires_at, ban_count FROM active_bans WHERE expires_at > ?",
        (now,),
    ).fetchall()
    with _bans_lock:
        for ip, expires_at, ban_count in rows:
            _bans[ip] = expires_at
            _escalation[ip] = ban_count
    # clean up anything that already expired
    conn.execute("DELETE FROM active_bans WHERE expires_at <= ?", (now,))
    conn.commit()


_load_persisted_bans()


def _load_persisted_blacklist():
    """Restore the permanent blacklist from disk on startup."""
    conn = _get_db()
    rows = conn.execute("SELECT ip, reason FROM blacklist").fetchall()
    with _blacklist_lock:
        for ip, reason in rows:
            _blacklist[ip] = reason or ""


_load_persisted_blacklist()

# core logic


def is_banned(ip: str) -> bool:
    """Check whether *ip* is currently banned or blacklisted. O(1) lookup."""
    # dev-mode: never report any IP as banned
    if DEV_MODE:
        return False
    if not ip or ip in BAN_WHITELIST:
        return False
    # permanent blacklist takes priority
    with _blacklist_lock:
        if ip in _blacklist:
            return True
    with _bans_lock:
        expires = _bans.get(ip)
    if expires is None:
        return False
    if time() < expires:
        return True
    # expired — remove lazily
    _unban(ip)
    return False


def record_strike(ip: str, jail: str) -> bool:
    """Record one strike for *ip* in *jail*.

    Returns True if the IP was just banned as a result.
    """
    # dev-mode: never accrue strikes, so bans can never trigger
    if DEV_MODE:
        return False
    if not ip or ip in BAN_WHITELIST:
        return False
    if jail not in BAN_JAILS:
        return False

    max_strikes, window, base_ban = BAN_JAILS[jail]
    now = time()

    with _strikes_lock:
        _maybe_cleanup(now)
        key = (ip, jail)
        bucket = _strikes.setdefault(key, deque())
        # expire old strikes outside the window
        while bucket and now - bucket[0] >= window:
            bucket.popleft()
        bucket.append(now)
        count = len(bucket)

    if count >= max_strikes:
        _ban(ip, jail, base_ban)
        # clear strikes so we don't re-ban on every subsequent request
        with _strikes_lock:
            _strikes.pop((ip, jail), None)
        return True

    return False


def ban_ip(ip: str, duration: int = 3600, jail: str = "manual"):
    """Manually ban an IP for *duration* seconds."""
    # dev-mode: ignore manual ban requests so nothing gets banned locally
    if DEV_MODE:
        return
    if ip in BAN_WHITELIST:
        return
    _ban(ip, jail, duration, escalate=False)


def unban_ip(ip: str):
    """Manually unban an IP and reset its escalation counter."""
    _unban(ip, reset_escalation=True)


def get_ban_info(ip: str) -> dict | None:
    """Return ban details for *ip*, or None if not banned."""
    with _bans_lock:
        expires = _bans.get(ip)
    if expires is None or time() >= expires:
        return None
    return {"ip": ip, "expires_at": expires, "remaining": int(expires - time())}


def get_all_bans() -> list:
    """Return a list of all currently active bans."""
    now = time()
    with _bans_lock:
        return [
            {"ip": ip, "expires_at": exp, "remaining": int(exp - now)}
            for ip, exp in _bans.items()
            if exp > now
        ]


# permanent blacklist


def blacklist_ip(ip: str, reason: str = ""):
    """Permanently ban an IP until manually removed.

    Idempotent: if *ip* is already on the permanent blacklist this is a
    no-op (no DB write, no log spam).
    """
    # dev-mode: do not persist any blacklist entries so local testing
    if DEV_MODE:
        return
    if not ip or ip in BAN_WHITELIST:
        return
    now = time()
    with _blacklist_lock:
        if ip in _blacklist:
            return
        _blacklist[ip] = reason
    try:
        conn = _get_db()
        conn.execute(
            "INSERT OR REPLACE INTO blacklist (ip, reason, added_at) VALUES (?, ?, ?)",
            (ip, reason, now),
        )
        conn.commit()
    except sqlite3.Error as e:
        print(f"[IP-BAN] Blacklist DB write failed: {e}", file=sys.stderr)
    _log(f"BLACKLISTED  ip={ip}  reason={reason!r}")


def unblacklist_ip(ip: str):
    """Remove an IP from the permanent blacklist."""
    with _blacklist_lock:
        _blacklist.pop(ip, None)
    try:
        conn = _get_db()
        conn.execute("DELETE FROM blacklist WHERE ip = ?", (ip,))
        conn.commit()
    except sqlite3.Error:
        pass
    _log(f"UN-BLACKLISTED  ip={ip}")


def get_blacklist() -> list:
    """Return all permanently blacklisted IPs."""
    with _blacklist_lock:
        return [
            {"ip": ip, "reason": reason}
            for ip, reason in _blacklist.items()
        ]


def is_blacklisted(ip: str) -> bool:
    """Check if an IP is on the permanent blacklist."""
    with _blacklist_lock:
        return ip in _blacklist


# internal helpers


def _ban(ip: str, jail: str, base_duration: int, escalate: bool = True):
    now = time()
    # Permanent blacklist supersedes any temp ban → don't re-ban.
    with _blacklist_lock:
        if ip in _blacklist:
            return
    # Already serving an active temp ban → don't layer another on top.
    with _bans_lock:
        existing = _bans.get(ip)
        if existing is not None and existing > now:
            return
    if escalate:
        count = _escalation.get(ip, 0) + 1
        _escalation[ip] = count
        duration = min(base_duration * (2 ** (count - 1)), BAN_MAX_DURATION)
    else:
        count = 1
        duration = min(base_duration, BAN_MAX_DURATION)

    expires = now + duration

    with _bans_lock:
        _bans[ip] = expires

    # persist
    try:
        conn = _get_db()
        conn.execute(
            "INSERT OR REPLACE INTO active_bans (ip, expires_at, jail, banned_at, ban_count)"
            " VALUES (?, ?, ?, ?, ?)",
            (ip, expires, jail, now, count),
        )
        conn.execute(
            "INSERT INTO ban_history (ip, jail, banned_at, expires_at, ban_count)"
            " VALUES (?, ?, ?, ?, ?)",
            (ip, jail, now, expires, count),
        )
        conn.commit()
    except sqlite3.Error as e:
        print(f"[IP-BAN] DB write failed: {e}", file=sys.stderr)

    _log(f"BANNED  ip={ip}  jail={jail}  duration={int(duration)}s  count={count}")

    # auto-blacklist after too many temporary bans
    if escalate and count >= BAN_BLACKLIST_AFTER:
        blacklist_ip(ip, reason=f"Auto-blacklisted after {count} temporary bans")


def _unban(ip: str, reset_escalation: bool = False):
    with _bans_lock:
        _bans.pop(ip, None)
    if reset_escalation:
        _escalation.pop(ip, None)
    try:
        conn = _get_db()
        conn.execute("DELETE FROM active_bans WHERE ip = ?", (ip,))
        conn.commit()
    except sqlite3.Error:
        pass


def _maybe_cleanup(now):
    """Purge expired strikes and bans periodically. Called under _strikes_lock."""
    global _last_cleanup
    if now - _last_cleanup < BAN_CLEANUP_INTERVAL:
        return
    _last_cleanup = now

    # expired strikes
    stale = [k for k, v in _strikes.items() if not v]
    for k in stale:
        del _strikes[k]

    # fire-and-forget ban cleanup in a background thread
    threading.Thread(target=_cleanup_expired_bans, daemon=True).start()


def _cleanup_expired_bans():
    now = time()
    expired = []
    with _bans_lock:
        expired = [ip for ip, exp in _bans.items() if now >= exp]
        for ip in expired:
            del _bans[ip]
    if expired:
        try:
            conn = _get_db()
            conn.execute(
                f"DELETE FROM active_bans WHERE ip IN ({','.join('?' * len(expired))})",
                expired,
            )
            conn.commit()
        except sqlite3.Error:
            pass


def cleanup_ban_history(days: int = 90):
    """Delete ban history older than *days*. Call from a background loop."""
    cutoff = time() - (days * 86400)
    try:
        conn = _get_db()
        conn.execute("DELETE FROM ban_history WHERE banned_at < ?", (cutoff,))
        conn.commit()
    except sqlite3.Error:
        pass


# logging

_LOG_FILE = os.path.join(_LOG_DIR, "ip_bans.log")
_log_lock = threading.Lock()


def _log(line: str):
    from datetime import datetime, timezone
    ts = datetime.now(timezone.utc).isoformat()
    entry = f"[{ts}] {line}"
    try:
        with _log_lock:
            with open(_LOG_FILE, "a", encoding="utf-8") as f:
                f.write(entry + "\n")
    except OSError:
        pass
    print(f"[IP-BAN] {entry}", file=sys.stderr)
