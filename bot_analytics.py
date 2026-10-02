"""
bot_analytics.py - the read side of the ESI-Bot analytics panel.

Everything here reads the ESI-Bot checkout directly: its SQLite databases, its
JSON state files, and the tail of its log. Nothing is ever written, and every
database is opened read-only, because the bot and its trackers hold those same
files open while they run.

The bucket count and step for each range are taken from analytics_query.RANGES
so the series and the labels the panel draws can never disagree.

Three figures are not collected by the bot at all yet - slash-command usage,
per-feature counters and a ticket first-response timestamp - so they come back
empty rather than invented, and the panel says so.
"""

import json
import os
import sqlite3
import time
from datetime import datetime, timedelta, timezone

from analytics_query import DEFAULT_RANGE, range_spec
from config import _BASE_DIR, _ESI_BOT_DIR, _SHOP_DB

BOT_DIR = _ESI_BOT_DIR
_DATA_DIR = os.path.join(BOT_DIR, "data")
_DB_DIR = os.path.join(BOT_DIR, "databases")
_API_TRACKING_DIR = os.path.join(_DB_DIR, "api_tracking")
_PLAYTIME_TRACKING_DIR = os.path.join(_DB_DIR, "playtime_tracking")
_PLAYTIME_DB = os.path.join(_DB_DIR, "playtime_tracking.db")
_POINTS_DB = os.path.join(_DB_DIR, "esi_points.db")
_RECRUITED_DB = os.path.join(_DB_DIR, "recruited_data.db")
_RANK_DB = os.path.join(_DB_DIR, "rank_changes.db")
_EXEMPTIONS_DB = os.path.join(_DB_DIR, "inactivity_exemptions.db")
_BLACKLIST_DB = os.path.join(_DB_DIR, "blacklist.db")
_USAGE_DB = os.path.join(_DB_DIR, "usage.db")
_LOG_DIR = os.path.join(_BASE_DIR, "logs")

_SUPPORT_TICKETS_JSON = os.path.join(_DATA_DIR, "support_tickets.json")
_INACTIVITY_REQUESTS_JSON = os.path.join(_DATA_DIR, "inactivity_requests.json")
_FORWARDED_APPS_JSON = os.path.join(_DATA_DIR, "forwarded_applications.json")
_PENDING_APPS_JSON = os.path.join(_DATA_DIR, "pending_applications.json")
_QUEUE_JSON = os.path.join(_DATA_DIR, "guild_member_queue.json")
_USER_BANS_JSON = os.path.join(_DATA_DIR, "user_bans.json")
_TRACKED_GUILD_JSON = os.path.join(_DATA_DIR, "tracked_guild.json")
_TERRITORIES_JSON = os.path.join(_DATA_DIR, "guild_territories.json")

_TRACKER_STALE_MINUTES = 20
_LOG_TAIL_BYTES = 200_000

# ESI points cycle: anchored to cycle 1, two weeks each (see utils/esi_points.py).
_CYCLE_ANCHOR = datetime(2026, 4, 21, 16, 0, 0, tzinfo=timezone.utc)
_CYCLE_DURATION = timedelta(weeks=2)

_APPLICATION_TYPES = ("Guild Member", "Envoy", "Ex-Citizen")

# player_stats columns that may be missing on older snapshots.
_TOTAL_COLUMNS = {
    "members": (None, "COUNT(*)"),
    "wars": ("wars", "COALESCE(SUM(wars), 0)"),
    "raids": ("raids_total", "COALESCE(SUM(raids_total), 0)"),
    "playtime": ("playtime", "COALESCE(SUM(playtime), 0)"),
}


# Small shared helpers
def _iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def _buckets(start, step, points):
    return [int(start + i * step) for i in range(points)]


def _as_epoch(value):
    """Accept an epoch number or an ISO string, return seconds or None."""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        pass
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def _read_json(path, default):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return default
    return data if isinstance(data, type(default)) else default


def _open_readonly(path):
    """A read-only connection, or None when the file is not there."""
    if not path or not os.path.isfile(path):
        return None
    try:
        conn = sqlite3.connect(
            "file:" + path.replace("\\", "/") + "?mode=ro", uri=True, timeout=5
        )
        conn.row_factory = sqlite3.Row
        return conn
    except sqlite3.Error:
        return None


def _query(conn, sql, params=()):
    """Run one query, returning rows or [] when the schema does not match."""
    if conn is None:
        return []
    try:
        return conn.execute(sql, params).fetchall()
    except sqlite3.Error:
        return []


def _fill_counts(rows, points):
    """Spread (bucket, n) rows into a dense series."""
    series = [0] * points
    for row in rows:
        try:
            index = int(row[0])
            count = int(row[1] or 0)
        except (TypeError, ValueError):
            continue
        if 0 <= index < points:
            series[index] = count
    return series


def _file_age_minutes(path):
    try:
        return max(0, int((time.time() - os.path.getmtime(path)) / 60))
    except OSError:
        return None


def _dir_size(path):
    total = 0
    if not os.path.isdir(path):
        return 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                continue
    return total


def _cycle_id(moment=None):
    moment = moment or datetime.now(timezone.utc)
    return int((moment - _CYCLE_ANCHOR) / _CYCLE_DURATION) + 1


# Snapshot history (databases/api_tracking)
def _snapshot_files():
    """(mtime, path) for every api_tracking snapshot, oldest first."""
    found = []
    if not os.path.isdir(_API_TRACKING_DIR):
        return found
    try:
        days = list(os.scandir(_API_TRACKING_DIR))
    except OSError:
        return found
    for day in days:
        if not day.is_dir():
            continue
        try:
            entries = list(os.scandir(day.path))
        except OSError:
            continue
        for entry in entries:
            if not entry.name.endswith(".db"):
                continue
            try:
                found.append((entry.stat().st_mtime, entry.path))
            except OSError:
                continue
    found.sort()
    return found


def _snapshot_totals(path):
    """Guild-wide totals from one snapshot, or None if it is unreadable."""
    conn = _open_readonly(path)
    if conn is None:
        return None
    try:
        columns = {row[1] for row in _query(conn, "PRAGMA table_info(player_stats)")}
        if not columns:
            return None
        wanted = [name for name, (column, _expr) in _TOTAL_COLUMNS.items()
                  if column is None or column in columns]
        if "members" not in wanted:
            return None
        selected = ", ".join(
            _TOTAL_COLUMNS[name][1] + " AS " + name for name in wanted
        )
        row = _query(conn, "SELECT " + selected + " FROM player_stats")
        if not row:
            return None
        totals = {name: row[0][name] or 0 for name in wanted}
        level = _query(
            conn,
            "SELECT guild_level FROM guild_info WHERE guild_level IS NOT NULL"
            " ORDER BY timestamp DESC LIMIT 1",
        )
        totals["level"] = level[0][0] if level else None
        return totals
    finally:
        conn.close()


def _bucket_snapshots(files, start, step, points):
    """The newest snapshot in each bucket, plus the baseline before the range."""
    baseline = None
    chosen = [None] * points
    for mtime, path in files:
        if mtime < start:
            baseline = path
            continue
        index = int((mtime - start) // step)
        if 0 <= index < points:
            chosen[index] = path
    return baseline, chosen


def _growth_series(files, start, step, points):
    """Per-bucket guild totals, carrying the last known value forward.

    Snapshots are written every few minutes but the older day folders keep only
    the latest file each, so a bucket with no snapshot of its own inherits the
    value before it rather than dropping to zero.
    """
    baseline, chosen = _bucket_snapshots(files, start, step, points)
    current = _snapshot_totals(baseline) if baseline else None
    if current is None:
        # No snapshot before the range: start from the first one inside it.
        for path in chosen:
            if path:
                current = _snapshot_totals(path)
                if current:
                    break
    series = {name: [] for name in ("members", "wars", "raids", "playtime", "level")}
    for path in chosen:
        if path:
            totals = _snapshot_totals(path)
            if totals:
                current = totals
        value = current or {}
        series["members"].append(int(value.get("members") or 0))
        series["wars"].append(int(value.get("wars") or 0))
        series["raids"].append(int(value.get("raids") or 0))
        # Snapshot playtime is hours; the panel's formatter expects minutes.
        series["playtime"].append(int(round(float(value.get("playtime") or 0) * 60)))
        series["level"].append(value.get("level"))
    return series, current or {}


def _roster_from_snapshot(files):
    """Current guild member usernames, from the newest readable snapshot."""
    for _mtime, path in reversed(files):
        conn = _open_readonly(path)
        if conn is None:
            continue
        try:
            rows = _query(conn, "SELECT username FROM player_stats WHERE username IS NOT NULL")
            if rows:
                return {str(row[0]).lower(): str(row[0]) for row in rows}
        finally:
            conn.close()
    return {}


def _snapshot_playtime_ranking(files, limit=10):
    for _mtime, path in reversed(files):
        conn = _open_readonly(path)
        if conn is None:
            continue
        try:
            rows = _query(
                conn,
                "SELECT username, playtime FROM player_stats"
                " WHERE username IS NOT NULL AND playtime IS NOT NULL"
                " ORDER BY playtime DESC LIMIT ?",
                (limit,),
            )
            if rows:
                return [{"label": str(row[0]), "value": int(round(float(row[1] or 0)))}
                        for row in rows]
        finally:
            conn.close()
    return []


# Applications and recruitment
def _application_block(start, end, previous_start):
    forwarded = _read_json(_FORWARDED_APPS_JSON, {})

    def is_accepted(entry):
        status = str(entry.get("status") or "").lower()
        if status:
            return status == "accepted"
        threshold = entry.get("threshold")
        approves = entry.get("approve_count") or 0
        return bool(threshold) and approves >= threshold

    def is_denied(entry):
        return str(entry.get("status") or "").lower() == "denied"

    counts = {name: {"received": 0, "approved": 0, "denied": 0, "pending": 0}
              for name in _APPLICATION_TYPES}
    total = 0
    previous_total = 0
    series_rows = []
    for entry in forwarded.values():
        if not isinstance(entry, dict):
            continue
        stamp = _as_epoch(entry.get("timestamp"))
        if stamp is None:
            continue
        if previous_start <= stamp < start:
            previous_total += 1
            continue
        if not (start <= stamp < end):
            continue
        total += 1
        kind = str(entry.get("app_type") or "Unknown")
        bucket = counts.setdefault(kind, {"received": 0, "approved": 0,
                                          "denied": 0, "pending": 0})
        bucket["received"] += 1
        if is_accepted(entry):
            bucket["approved"] += 1
        elif is_denied(entry):
            bucket["denied"] += 1
        else:
            bucket["pending"] += 1
        series_rows.append((stamp, 1))

    rows = []
    for kind in sorted(counts, key=lambda name: -counts[name]["received"]):
        bucket = counts[kind]
        decided = bucket["approved"] + bucket["denied"]
        rows.append({
            "type": kind,
            "received": bucket["received"],
            "approved": bucket["approved"],
            "denied": bucket["denied"],
            "pending": bucket["pending"],
            "rate": round(bucket["approved"] / decided * 100.0, 1) if decided else 0.0,
        })

    # Applications opened but never submitted.
    pending = _read_json(_PENDING_APPS_JSON, {})
    abandoned = 0
    for entry in pending.values():
        if not isinstance(entry, dict):
            continue
        stamp = _as_epoch(entry.get("timestamp"))
        if stamp is not None and start <= stamp < end:
            abandoned += 1

    return {
        "rows": rows,
        "total": total,
        "previous": previous_total,
        "abandoned": abandoned,
        "stamps": series_rows,
    }


def _recruit_stamps():
    """(recruiter, epoch) for every recorded recruit."""
    conn = _open_readonly(_RECRUITED_DB)
    if conn is None:
        return []
    try:
        rows = _query(
            conn, "SELECT recruiter, timestamp FROM recruited WHERE timestamp IS NOT NULL"
        )
    finally:
        conn.close()
    out = []
    for row in rows:
        stamp = _as_epoch(row[1])
        if stamp is not None:
            out.append((str(row[0] or ""), stamp))
    return out


# Queue, inactivity and exemptions
def _queue_block(now):
    queue = _read_json(_QUEUE_JSON, {})
    normal = queue.get("normal") if isinstance(queue.get("normal"), list) else []
    veteran = queue.get("veteran") if isinstance(queue.get("veteran"), list) else []

    waits = []
    for entry in list(normal) + list(veteran):
        if not isinstance(entry, dict):
            continue
        stamp = _as_epoch(entry.get("queued_at"))
        if stamp is not None and stamp <= now:
            waits.append((now - stamp) / 3600.0)
    average = round(sum(waits) / len(waits), 1) if waits else 0.0

    exemptions = 0
    expiring = 0
    conn = _open_readonly(_EXEMPTIONS_DB)
    if conn is not None:
        try:
            rows = _query(conn, "SELECT exempt_until FROM exemptions")
        finally:
            conn.close()
        for row in rows:
            stamp = _as_epoch(row[0])
            if stamp is None or stamp <= now:
                continue
            exemptions += 1
            if stamp <= now + 7 * 86400:
                expiring += 1

    return {
        "normal": len(normal),
        "veteran": len(veteran),
        "total": len(normal) + len(veteran),
        "avgWaitHours": average,
        "exemptions": exemptions,
        "expiringSoon": expiring,
    }


def _inactivity_outcomes(start, end):
    """Approved / denied / pending inactivity requests decided in range."""
    data = _read_json(_INACTIVITY_REQUESTS_JSON, {})
    archived = data.get("archived_tickets")
    archived = archived if isinstance(archived, dict) else {}
    counts = {"approved": 0, "denied": 0, "pending": 0}
    for entry in archived.values():
        if not isinstance(entry, dict):
            continue
        resolved = _as_epoch(entry.get("resolved_at"))
        created = _as_epoch(entry.get("created_at"))
        when = resolved if resolved is not None else created
        if when is None or not (start <= when < end):
            continue
        status = str(entry.get("status") or "").lower()
        if status in counts:
            counts[status] += 1
    return [
        {"label": "Approved", "value": counts["approved"]},
        {"label": "Denied", "value": counts["denied"]},
        {"label": "Pending", "value": counts["pending"]},
    ]


# ESI points and the shop
def _points_block():
    """Current and previous cycle totals, the reason split, and top earners."""
    cycle = _cycle_id()
    empty = {
        "awarded": 0, "clean": 0, "dirty": 0, "previous": 0,
        "byReason": [], "topEarners": [],
    }
    conn = _open_readonly(_POINTS_DB)
    if conn is None:
        return empty
    try:
        current = _query(
            conn,
            "SELECT COALESCE(SUM(points), 0) AS points,"
            " COALESCE(SUM(clean_ep), 0) AS clean,"
            " COALESCE(SUM(dirty_ep), 0) AS dirty"
            " FROM esi_points WHERE cycle_id = ?",
            (cycle,),
        )
        previous = _query(
            conn,
            "SELECT COALESCE(SUM(points), 0) FROM esi_points WHERE cycle_id = ?",
            (cycle - 1,),
        )
        earners = _query(
            conn,
            "SELECT username, points FROM esi_points WHERE cycle_id = ? AND points > 0"
            " ORDER BY points DESC LIMIT 6",
            (cycle,),
        )
        tables = [
            str(row[0]) for row in _query(
                conn,
                "SELECT name FROM sqlite_master WHERE type = 'table'"
                " AND name LIKE 'player\\_%' ESCAPE '\\'",
            )
        ]
        reasons = {}
        for table in tables[:400]:
            for row in _query(
                conn,
                'SELECT reason, SUM(points_gained) AS n FROM "' + table + '"'
                " WHERE cycle_id = ? GROUP BY reason",
                (cycle,),
            ):
                label = str(row[0] or "Unknown").strip() or "Unknown"
                reasons[label] = reasons.get(label, 0) + int(row[1] or 0)
    finally:
        conn.close()

    row = current[0] if current else None
    awarded = int(row["points"] or 0) if row else 0
    return {
        "awarded": awarded,
        "clean": int(row["clean"] or 0) if row else 0,
        "dirty": int(row["dirty"] or 0) if row else 0,
        "previous": int(previous[0][0] or 0) if previous else 0,
        "byReason": [
            {"label": label, "value": value}
            for label, value in sorted(reasons.items(), key=lambda kv: -kv[1])[:10]
        ],
        "topEarners": [
            {"label": str(r[0]), "value": int(r[1] or 0)} for r in earners
        ],
    }


def _shop_block():
    """EP spent and pending purchases, from the website's shop database."""
    conn = _open_readonly(_SHOP_DB)
    if conn is None:
        return {"spent": 0, "pending": 0}
    try:
        spent = _query(
            conn,
            "SELECT COALESCE(SUM(ep_spent), 0) FROM bin_purchases"
            " WHERE status <> 'rejected'",
        )
        pending = _query(
            conn, "SELECT COUNT(*) FROM bin_purchases WHERE status = 'pending'"
        )
    finally:
        conn.close()
    return {
        "spent": int(spent[0][0] or 0) if spent else 0,
        "pending": int(pending[0][0] or 0) if pending else 0,
    }


# Activity
def _peak_hours(roster):
    """When the guild is online: last_seen by weekday and hour, in UTC.

    The playtime tracker refreshes each player's last_seen every five minutes
    while they are online, so a player's most recent stamp is the best signal
    the bot keeps about when they actually play. Only the last week of stamps
    is counted, and only for current guild members.
    """
    grid = [[0] * 24 for _ in range(7)]
    conn = _open_readonly(_PLAYTIME_DB)
    if conn is None:
        return grid
    try:
        rows = _query(conn, "SELECT username, last_seen FROM playtime")
    finally:
        conn.close()

    stamps = []
    for row in rows:
        username = str(row[0] or "")
        if roster and username.lower() not in roster:
            continue
        stamp = _as_epoch(row[1])
        if stamp is not None:
            stamps.append(stamp)
    if not stamps:
        return grid

    cutoff = max(stamps) - 7 * 86400
    for stamp in stamps:
        if stamp < cutoff:
            continue
        moment = datetime.fromtimestamp(stamp, timezone.utc)
        grid[moment.weekday()][moment.hour] += 1
    return grid


# Moderation and support
def _moderation_block(start, end):
    entries = 0
    links = 0
    conn = _open_readonly(_BLACKLIST_DB)
    if conn is not None:
        try:
            rows = _query(conn, "SELECT COUNT(*) FROM blacklist_entries WHERE active = 1")
            entries = int(rows[0][0] or 0) if rows else 0
            rows = _query(
                conn, "SELECT COUNT(*) FROM blacklist_account_links WHERE active = 1"
            )
            links = int(rows[0][0] or 0) if rows else 0
        finally:
            conn.close()

    bans = _read_json(_USER_BANS_JSON, {})
    executors = {}
    conn = _open_readonly(_RANK_DB)
    if conn is not None:
        try:
            rows = _query(
                conn,
                "SELECT executor_username, COUNT(*) AS n FROM rank_changes"
                " WHERE unix_timestamp >= ? AND unix_timestamp < ?"
                " GROUP BY executor_username ORDER BY n DESC LIMIT 6",
                (int(start), int(end)),
            )
        finally:
            conn.close()
        for row in rows:
            executors[str(row[0] or "Unknown")] = int(row[1] or 0)

    return {
        "blacklist": entries,
        "altLinks": links,
        "bans": len(bans) if isinstance(bans, dict) else 0,
        "rankChanges": [{"label": name, "value": value}
                        for name, value in executors.items()],
    }


def _ticket_block(start, end, now):
    data = _read_json(_SUPPORT_TICKETS_JSON, {})
    tickets = data.get("tickets")
    tickets = tickets if isinstance(tickets, dict) else {}
    archived = data.get("archived_tickets")
    archived = archived if isinstance(archived, dict) else {}

    open_count = 0
    acknowledged = 0
    categories = {}
    for entry in tickets.values():
        if not isinstance(entry, dict):
            continue
        if str(entry.get("status") or "").lower() == "open":
            open_count += 1
        if entry.get("acknowledged"):
            acknowledged += 1
        label = str(entry.get("category") or "").strip()
        if label:
            categories[label] = categories.get(label, 0) + 1

    closed_in_range = 0
    durations = []
    for entry in archived.values():
        if not isinstance(entry, dict):
            continue
        closed = _as_epoch(entry.get("closed_at"))
        if closed is None or not (start <= closed < end):
            continue
        closed_in_range += 1
        opened = _as_epoch(entry.get("opened_at"))
        if opened is not None and closed >= opened:
            durations.append((closed - opened) / 3600.0)

    busiest = "\u2014"
    if categories:
        busiest = max(categories.items(), key=lambda kv: kv[1])[0]

    return {
        "open": open_count,
        "acknowledged": acknowledged,
        "archived": closed_in_range,
        "avgCloseHours": round(sum(durations) / len(durations), 1) if durations else None,
        # The bot records no first-response timestamp yet.
        "avgFirstResponseHours": None,
        "busiest": busiest,
    }


# Bot health
def _log_stats():
    """Error, restart and API-failure counts from the tail of the bot log.

    The bot's own log lines carry no timestamps, so these are counts over the
    retained tail rather than over the selected range, and the panel says so.
    """
    stats = {"errors": 0, "restarts": 0, "apiErrors": 0}
    path = os.path.join(_LOG_DIR, "esi-bot.log")
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as handle:
            if size > _LOG_TAIL_BYTES:
                handle.seek(size - _LOG_TAIL_BYTES)
                handle.readline()
            text = handle.read().decode("utf-8", errors="ignore")
    except OSError:
        return stats
    for line in text.splitlines():
        if line.startswith("[ERROR]"):
            stats["errors"] += 1
        elif line.startswith("[RESTART]"):
            stats["restarts"] += 1
        if "API returned status" in line or "Rate Limited" in line:
            stats["apiErrors"] += 1
    return stats


def _tracker_status(files, now):
    tracked = _read_json(_TRACKED_GUILD_JSON, {})
    guild_stamp = _as_epoch(tracked.get("last_update")) if isinstance(tracked, dict) else None

    def minutes(stamp):
        if stamp is None:
            return None
        return max(0, int((now - stamp) / 60))

    entries = [
        ("API snapshots", _file_age_minutes(files[-1][1]) if files else None),
        ("Playtime", _playtime_age_minutes()),
        ("Guild", minutes(guild_stamp)),
        ("Claims", _file_age_minutes(_TERRITORIES_JSON)),
        ("ESI points", _file_age_minutes(_POINTS_DB)),
    ]
    return [
        {"name": name, "minutesAgo": age, "stale": age is None or age > _TRACKER_STALE_MINUTES}
        for name, age in entries
    ]


def _playtime_age_minutes():
    """Minutes since the playtime tracker last wrote, from its own metadata."""
    conn = _open_readonly(_PLAYTIME_DB)
    if conn is not None:
        try:
            rows = _query(
                conn,
                "SELECT value FROM metadata WHERE key = 'last_fetch_timestamp'",
            )
        finally:
            conn.close()
        if rows:
            stamp = _as_epoch(rows[0][0])
            if stamp is not None:
                return max(0, int((time.time() - stamp) / 60))
    return _file_age_minutes(_PLAYTIME_DB)


# Command and feature usage
def _usage_block(start, end):
    """Counts from the bot's own usage counters.

    The bot only started writing these when this panel was built, so an empty
    list means nothing has run since, not that nothing ever has.
    """
    conn = _open_readonly(_USAGE_DB)
    if conn is None:
        return [], []
    try:
        counts = []
        for kind in ("command", "feature"):
            rows = _query(
                conn,
                "SELECT name, COUNT(*) AS n FROM usage"
                " WHERE kind = ? AND ts >= ? AND ts <= ?"
                " GROUP BY name ORDER BY n DESC LIMIT 10",
                (kind, int(start), int(end)),
            )
            counts.append([{"label": str(row[0]), "value": int(row[1] or 0)}
                           for row in rows])
    finally:
        conn.close()
    return counts[0], counts[1]


# Panel payload
def overview(range_id, uptime_seconds=None):
    """Everything the ESI-Bot panel renders, for one range."""
    points, step = range_spec(range_id)
    now = time.time()
    start = now - points * step
    previous_start = start - points * step

    files = _snapshot_files()
    growth, latest = _growth_series(files, start, step, points)
    roster = _roster_from_snapshot(files)

    applications = _application_block(start, now, previous_start)
    application_series = _fill_counts(
        [(int((stamp - start) // step), 1) for stamp, _n in applications["stamps"]],
        points,
    )

    recruits = _recruit_stamps()
    recruit_series = _fill_counts(
        [(int((stamp - start) // step), 1) for _name, stamp in recruits if start <= stamp < now],
        points,
    )
    recruits_total = sum(recruit_series)
    recruits_previous = sum(1 for _name, stamp in recruits
                            if previous_start <= stamp < start)

    points_block = _points_block()
    shop = _shop_block()
    queue = _queue_block(now)
    tickets = _ticket_block(start, now, now)
    moderation = _moderation_block(start, now)
    commands, features = _usage_block(start, now)
    logs = _log_stats()
    trackers = _tracker_status(files, now)

    # Guild totals are cumulative.
    members_now = growth["members"][-1] if growth["members"] else latest.get("members", 0)
    members_previous = growth["members"][0] if growth["members"] else members_now

    return {
        "range": range_id,
        "generatedAt": _iso(now),
        "buckets": _buckets(start, step, points),
        "kpis": {
            "applications": {
                "value": applications["total"],
                "prev": applications["previous"],
                "series": application_series,
            },
            "recruits": {
                "value": recruits_total,
                "prev": recruits_previous,
                "series": recruit_series,
            },
            "members": {
                "value": members_now,
                "prev": members_previous,
                "series": growth["members"],
            },
            "epAwarded": {
                "value": points_block["awarded"],
                "prev": points_block["previous"],
                "series": [],
            },
            "openTickets": {
                "value": tickets["open"],
                "prev": None,
                "series": [],
            },
            "errors": {
                "value": logs["errors"],
                "prev": None,
                "series": [],
            },
        },
        "traffic": {
            "recruits": recruit_series,
            "applications": application_series,
            "members": growth["members"],
            "wars": growth["wars"],
            "raids": growth["raids"],
            "playtime": growth["playtime"],
        },
        "bot": {
            "uptimeSeconds": uptime_seconds,
            "restarts": logs["restarts"],
            "errors": logs["errors"],
            "apiErrors": logs["apiErrors"],
            "storageBytes": _dir_size(_API_TRACKING_DIR) + _dir_size(_PLAYTIME_TRACKING_DIR),
            "trackers": trackers,
        },
        "applications": applications["rows"],
        "applicationNote": {
            "started": applications["total"] + applications["abandoned"],
            "abandoned": applications["abandoned"],
        },
        "queue": queue,
        "inactivity": _inactivity_outcomes(start, now),
        "ep": {
            "awarded": points_block["awarded"],
            "clean": points_block["clean"],
            "dirty": points_block["dirty"],
            "spent": shop["spent"],
            "shopPending": shop["pending"],
            "byReason": points_block["byReason"],
            "topEarners": points_block["topEarners"],
        },
        "activity": {
            "peakHours": _peak_hours(roster),
            "topPlaytime": _snapshot_playtime_ranking(files),
        },
        "moderation": moderation,
        "tickets": tickets,
        "commands": commands,
        "features": features,
    }
