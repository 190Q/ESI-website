"""
analytics_query.py - the read side of the analytics database.

One function per panel, each returning exactly the shape that panel's render
code expects.

Every query is bounded. `range` is an allow-listed enum rather than a free
interval, and every WHERE clause filters on the indexed `ts` column, so a caller
cannot ask for a scan of the whole table. Nothing from a request reaches SQL as
text - routes, statuses and paths are bound parameters only.

The bucket count and step for each range must match RANGE_SPEC in
panel_static/shared/analytics.js, or the labels and the series disagree.
"""

import json
import os
import sqlite3
import time
from datetime import datetime, timezone
from http import HTTPStatus

import analytics
from config import (
    _ANALYTICS_DB, _BASE_DIR, _EVENTS_JSON, _SHOP_DB,
    _USER_DB_PATH, _USERNAME_MATCHES_JSON,
)

# range id -> (bucket count, seconds per bucket)
RANGES = {
    "24h": (24, 3600),
    "7d": (7, 86400),
    "30d": (30, 86400),
    "90d": (45, 2 * 86400),
    "all": (26, 7 * 86400),
}
DEFAULT_RANGE = "7d"

_LATENCY_BANDS = ("< 25 ms", "25-100 ms", "100-300 ms", "300-800 ms", "> 800 ms")

_ASSET_PREFIXES = ("/js/", "/css/", "/images/", "/assets/", "/fonts/", "/public/")

_IMAGE_EXT = ("png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "ico")
_FONT_EXT = ("woff", "woff2", "ttf", "otf", "eot")
_ARCHIVE_EXT = ("zip", "gz", "tar")

_UPSTREAM_LABELS = {502: "502 Bad gateway", 503: "503 Unavailable", 504: "504 Timeout"}


def range_spec(range_id):
    """The bucket count and step for a range id, defaulting when unknown."""
    return RANGES.get(range_id) or RANGES[DEFAULT_RANGE]


def _connect():
    conn = sqlite3.connect(_ANALYTICS_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def _iso(ts):
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def _status_label(code):
    try:
        return str(int(code)) + " " + HTTPStatus(int(code)).phrase
    except (ValueError, TypeError):
        return str(code)


def _buckets(start, step, points):
    """Bucket start timestamps, oldest first, as epoch seconds."""
    return [int(start + i * step) for i in range(points)]


def _fill(rows, key, points):
    """Spread sparse per-bucket rows into a dense series."""
    out = [0] * points
    for row in rows:
        idx = row["bucket"]
        if idx is None:
            continue
        idx = int(idx)
        if 0 <= idx < points:
            out[idx] = row[key] or 0
    return out


def _series_rows(conn, start, step):
    return conn.execute(
        "SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket,"
        " COUNT(*) AS requests,"
        " COALESCE(SUM(bytes), 0) AS bytes,"
        " SUM(CASE WHEN status = 404 THEN 1 ELSE 0 END) AS not_found,"
        " SUM(CASE WHEN status IN (502, 503, 504) THEN 1 ELSE 0 END) AS upstream,"
        " SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS server_errors,"
        " SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) AS blocked,"
        " SUM(CASE WHEN cache = 'HIT' THEN 1 ELSE 0 END) AS cache_hits,"
        " SUM(CASE WHEN cache IS NOT NULL THEN 1 ELSE 0 END) AS cache_seen"
        " FROM requests WHERE ts >= ? GROUP BY bucket",
        (start, step, start),
    ).fetchall()


def _latency_rows(conn, start, step):
    """p50/p95/p99 per bucket.

    SQLite has no percentile aggregate, so the ranks are taken with window
    functions in one indexed pass rather than by pulling every duration into
    Python.
    """
    return conn.execute(
        "WITH ranked AS ("
        " SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket, duration_ms,"
        " ROW_NUMBER() OVER (PARTITION BY CAST((ts - ?) / ? AS INTEGER)"
        "                    ORDER BY duration_ms) AS rn,"
        " COUNT(*) OVER (PARTITION BY CAST((ts - ?) / ? AS INTEGER)) AS n"
        " FROM requests WHERE ts >= ? AND duration_ms IS NOT NULL)"
        " SELECT bucket,"
        " MAX(CASE WHEN rn = CAST(n * 0.5 AS INTEGER) + 1 THEN duration_ms END) AS p50,"
        " MAX(CASE WHEN rn = CAST(n * 0.95 AS INTEGER) + 1 THEN duration_ms END) AS p95,"
        " MAX(CASE WHEN rn = CAST(n * 0.99 AS INTEGER) + 1 THEN duration_ms END) AS p99"
        " FROM ranked GROUP BY bucket",
        (start, step, start, step, start, step, start),
    ).fetchall()


def _window_summary(conn, start, end):
    """Totals for one window, used for both the current and previous period."""
    row = conn.execute(
        "SELECT COUNT(*) AS requests,"
        " COALESCE(SUM(bytes), 0) AS bytes,"
        " SUM(CASE WHEN status = 404 THEN 1 ELSE 0 END) AS not_found,"
        " SUM(CASE WHEN status IN (502, 503, 504) THEN 1 ELSE 0 END) AS upstream,"
        " SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS server_errors,"
        " SUM(CASE WHEN blocked = 1 THEN 1 ELSE 0 END) AS blocked,"
        " SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) AS rate_limited,"
        " COUNT(DISTINCT ip_hash) AS visitors,"
        " SUM(CASE WHEN cache = 'HIT' THEN 1 ELSE 0 END) AS cache_hits,"
        " SUM(CASE WHEN cache IS NOT NULL THEN 1 ELSE 0 END) AS cache_seen"
        " FROM requests WHERE ts >= ? AND ts < ?",
        (start, end),
    ).fetchone()
    pct = conn.execute(
        "WITH ranked AS (SELECT duration_ms,"
        " ROW_NUMBER() OVER (ORDER BY duration_ms) AS rn,"
        " COUNT(*) OVER () AS n"
        " FROM requests WHERE ts >= ? AND ts < ? AND duration_ms IS NOT NULL)"
        " SELECT MAX(CASE WHEN rn = CAST(n * 0.5 AS INTEGER) + 1 THEN duration_ms END),"
        " MAX(CASE WHEN rn = CAST(n * 0.95 AS INTEGER) + 1 THEN duration_ms END),"
        " MAX(CASE WHEN rn = CAST(n * 0.99 AS INTEGER) + 1 THEN duration_ms END)"
        " FROM ranked",
        (start, end),
    ).fetchone()
    seen = row["cache_seen"] or 0
    hits = row["cache_hits"] or 0
    return {
        "requests": row["requests"] or 0,
        "bytes": row["bytes"] or 0,
        "notFound": row["not_found"] or 0,
        "upstream": row["upstream"] or 0,
        "serverErrors": row["server_errors"] or 0,
        "blocked": row["blocked"] or 0,
        "rateLimited": row["rate_limited"] or 0,
        "visitors": row["visitors"] or 0,
        "cacheHits": hits,
        "cacheMisses": max(0, seen - hits),
        "cacheSeen": seen,
        "cacheHitRate": (hits / seen * 100.0) if seen else 0.0,
        "p50": round(pct[0] or 0, 1),
        "p95": round(pct[1] or 0, 1),
        "p99": round(pct[2] or 0, 1),
    }


def _count_by(conn, start, column):
    if column not in ("status", "method"):
        return []
    return conn.execute(
        "SELECT " + column + " AS k, COUNT(*) AS n FROM requests"
        " WHERE ts >= ? AND " + column + " IS NOT NULL"
        " GROUP BY k ORDER BY n DESC",
        (start,),
    ).fetchall()


def _top_paths(conn, start, limit=25):
    counts = conn.execute(
        "SELECT route, method, status, COUNT(*) AS requests,"
        " COUNT(DISTINCT ip_hash) AS uniques,"
        " COUNT(DISTINCT session_hash) AS sessions,"
        " AVG(duration_ms) AS avg_ms,"
        " COALESCE(SUM(bytes), 0) AS total_bytes"
        " FROM requests WHERE ts >= ? AND route IS NOT NULL"
        " GROUP BY route, method, status ORDER BY requests DESC LIMIT ?",
        (start, limit),
    ).fetchall()
    if not counts:
        return []

    # Percentiles are computed only for the routes that made the cut.
    routes = sorted({row["route"] for row in counts})
    marks = ",".join("?" * len(routes))
    pct_rows = conn.execute(
        "WITH ranked AS ("
        " SELECT route, method, status, duration_ms,"
        " ROW_NUMBER() OVER (PARTITION BY route, method, status"
        "                    ORDER BY duration_ms) AS rn,"
        " COUNT(*) OVER (PARTITION BY route, method, status) AS n"
        " FROM requests WHERE ts >= ? AND duration_ms IS NOT NULL"
        " AND route IN (" + marks + "))"
        " SELECT route, method, status,"
        " MAX(CASE WHEN rn = CAST(n * 0.5 AS INTEGER) + 1 THEN duration_ms END) AS p50,"
        " MAX(CASE WHEN rn = CAST(n * 0.95 AS INTEGER) + 1 THEN duration_ms END) AS p95,"
        " MAX(CASE WHEN rn = CAST(n * 0.99 AS INTEGER) + 1 THEN duration_ms END) AS p99"
        " FROM ranked GROUP BY route, method, status",
        tuple([start] + routes),
    ).fetchall()
    by_key = {(r["route"], r["method"], r["status"]): r for r in pct_rows}

    out = []
    for row in counts:
        pct = by_key.get((row["route"], row["method"], row["status"]))
        requests = row["requests"] or 0
        total_bytes = row["total_bytes"] or 0
        out.append({
            "path": row["route"],
            "method": row["method"] or "",
            "requests": requests,
            "unique": row["uniques"] or 0,
            "sessions": row["sessions"] or 0,
            "avgMs": round(row["avg_ms"] or 0, 1),
            "p50": round((pct["p50"] if pct else 0) or 0, 1),
            "p95": round((pct["p95"] if pct else 0) or 0, 1),
            "p99": round((pct["p99"] if pct else 0) or 0, 1),
            "bytes": round(total_bytes / requests) if requests else 0,
            "status": _status_label(row["status"]) if row["status"] is not None else "",
        })
    return out


def _latency_bands(conn, start):
    rows = conn.execute(
        "SELECT CASE WHEN duration_ms < 25 THEN 0"
        " WHEN duration_ms < 100 THEN 1"
        " WHEN duration_ms < 300 THEN 2"
        " WHEN duration_ms < 800 THEN 3 ELSE 4 END AS band,"
        " COUNT(*) AS n FROM requests"
        " WHERE ts >= ? AND duration_ms IS NOT NULL GROUP BY band",
        (start,),
    ).fetchall()
    counts = [0] * len(_LATENCY_BANDS)
    for row in rows:
        band = row["band"]
        if band is not None and 0 <= int(band) < len(counts):
            counts[int(band)] = row["n"] or 0
    return [{"label": _LATENCY_BANDS[i], "value": counts[i]} for i in range(len(counts))]


def _asset_rows(conn, start, limit=20):
    clauses = " OR ".join("route LIKE ?" for _ in _ASSET_PREFIXES)
    args = [start] + [prefix + "%" for prefix in _ASSET_PREFIXES] + [limit]
    rows = conn.execute(
        "SELECT route, COUNT(*) AS requests,"
        " COALESCE(AVG(bytes), 0) AS avg_bytes,"
        " COALESCE(SUM(bytes), 0) AS total_bytes,"
        " SUM(CASE WHEN cache = 'HIT' THEN 1 ELSE 0 END) AS hits,"
        " SUM(CASE WHEN status = 404 THEN 1 ELSE 0 END) AS missing,"
        " MAX(status) AS last_status"
        " FROM requests WHERE ts >= ? AND route IS NOT NULL AND (" + clauses + ")"
        " GROUP BY route ORDER BY requests DESC LIMIT ?",
        tuple(args),
    ).fetchall()
    return [{
        "path": row["route"],
        "requests": row["requests"] or 0,
        "bytes": round(row["avg_bytes"] or 0),
        "transferred": row["total_bytes"] or 0,
        "cached": bool(row["hits"]),
        "status": str(row["last_status"]) if row["last_status"] is not None else "",
        "missing": (row["missing"] or 0) > 0,
    } for row in rows]


def _route_kind(route):
    """Coarse classification of a normalised route, used by three cards."""
    path = (route or "").lower()
    if path.startswith("/api/"):
        return "JSON (API)"
    if path.startswith("/auth/"):
        return "Auth"
    last = path.rsplit("/", 1)[-1]
    ext = last.rsplit(".", 1)[-1] if "." in last else ""
    if ext in ("js", "mjs", "map"):
        return "JS"
    if ext == "css":
        return "CSS"
    if ext in _IMAGE_EXT:
        return "Images"
    if ext in _FONT_EXT:
        return "Fonts"
    if ext in _ARCHIVE_EXT:
        return "Archives"
    if ext in ("pdf", "csv", "json", "txt"):
        return "Documents"
    if path.startswith("/panel/"):
        return "Panel"
    return "Other"


def _split_bucket(route):
    path = route or ""
    if path.startswith("/api/"):
        return "/api/*"
    if path.startswith("/auth/"):
        return "/auth/*"
    if path.startswith("/panel/"):
        return "Panel"
    if "." in path.rsplit("/", 1)[-1]:
        return "Static"
    return "SPA shell"


def _group_by_route(conn, start, classifier):
    """Bucket every request by a Python-side classification of its route."""
    rows = conn.execute(
        "SELECT route, COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS bytes"
        " FROM requests WHERE ts >= ? AND route IS NOT NULL GROUP BY route",
        (start,),
    ).fetchall()
    counts = {}
    for row in rows:
        key = classifier(row["route"])
        entry = counts.setdefault(key, {"count": 0, "bytes": 0})
        entry["count"] += row["n"] or 0
        entry["bytes"] += row["bytes"] or 0
    return counts


def _entry_exit_pages(conn, start, limit=10):
    def edge(column):
        rows = conn.execute(
            "WITH s AS (SELECT session_hash, " + column + " AS edge_ts"
            " FROM requests WHERE ts >= ? AND session_hash IS NOT NULL"
            " GROUP BY session_hash)"
            " SELECT r.route, COUNT(*) AS n FROM requests r"
            " JOIN s ON s.session_hash = r.session_hash AND r.ts = s.edge_ts"
            " WHERE r.route IS NOT NULL GROUP BY r.route ORDER BY n DESC LIMIT ?",
            (start, limit),
        ).fetchall()
        return [{"label": row["route"], "value": row["n"]} for row in rows]

    return edge("MIN(ts)"), edge("MAX(ts)")


def _upstream_rows(conn, start):
    rows = conn.execute(
        "SELECT status, COUNT(*) AS n FROM requests"
        " WHERE ts >= ? AND status IN (502, 503, 504) GROUP BY status ORDER BY n DESC",
        (start,),
    ).fetchall()
    return [{
        "label": _UPSTREAM_LABELS.get(row["status"], _status_label(row["status"])),
        "value": row["n"],
    } for row in rows]


def _not_found_rows(conn, start, limit=8):
    rows = conn.execute(
        "SELECT route, COUNT(*) AS n FROM requests"
        " WHERE ts >= ? AND status = 404 AND route IS NOT NULL"
        " GROUP BY route ORDER BY n DESC LIMIT ?",
        (start, limit),
    ).fetchall()
    return [{"label": row["route"], "value": row["n"]} for row in rows]


def _route_coverage(conn, start):
    """Registered routes that produced no request in range."""
    registered = analytics.known_routes()
    seen = {row["route"] for row in conn.execute(
        "SELECT DISTINCT route FROM requests WHERE ts >= ? AND route IS NOT NULL",
        (start,),
    )}
    never = [
        {"path": route, "note": area}
        for route, area in registered
        if route not in seen
    ]
    return {
        "total": len(registered),
        "called": len(registered) - len(never),
        "neverCalled": never,
    }


def traffic(range_id):
    """Everything the Traffic panel renders, for one range."""
    points, step = range_spec(range_id)
    now = time.time()
    start = now - points * step

    conn = _connect()
    try:
        series = _series_rows(conn, start, step)
        latency = _latency_rows(conn, start, step)
        current = _window_summary(conn, start, now)
        previous = _window_summary(conn, start - points * step, start)
        statuses = _count_by(conn, start, "status")
        methods = _count_by(conn, start, "method")
        paths = _top_paths(conn, start)
        assets = _asset_rows(conn, start)
        split = _group_by_route(conn, start, _split_bucket)
        kinds = _group_by_route(conn, start, _route_kind)
        entry, exit_pages = _entry_exit_pages(conn, start)
        upstream = _upstream_rows(conn, start)
        not_found = _not_found_rows(conn, start)
        coverage = _route_coverage(conn, start)
        bands = _latency_bands(conn, start)
    finally:
        conn.close()

    def series_of(key):
        return _fill(series, key, points)

    requests_series = series_of("requests")
    bytes_series = series_of("bytes")
    cache_hits = series_of("cache_hits")
    cache_seen = series_of("cache_seen")

    hit_rate_series = [
        round(cache_hits[i] / cache_seen[i] * 100.0, 2) if cache_seen[i] else 0.0
        for i in range(points)
    ]

    return {
        "range": range_id,
        "generatedAt": _iso(now),
        "buckets": _buckets(start, step, points),
        "totals": {"requests": current["requests"], "bytes": current["bytes"]},
        "bandwidth": bytes_series,
        "latencySeries": {
            "p50": _fill(latency, "p50", points),
            "p95": _fill(latency, "p95", points),
            "p99": _fill(latency, "p99", points),
        },
        "kpis": {
            "requests":     {"value": current["requests"],   "prev": previous["requests"],   "series": requests_series},
            "bytes":        {"value": current["bytes"],      "prev": previous["bytes"],      "series": bytes_series},
            "p50":          {"value": current["p50"],        "prev": previous["p50"],        "series": _fill(latency, "p50", points)},
            "p95":          {"value": current["p95"],        "prev": previous["p95"],        "series": _fill(latency, "p95", points)},
            "p99":          {"value": current["p99"],        "prev": previous["p99"],        "series": _fill(latency, "p99", points)},
            "cacheHitRate": {"value": current["cacheHitRate"], "prev": previous["cacheHitRate"], "series": hit_rate_series},
            "notFound":     {"value": current["notFound"],   "prev": previous["notFound"],   "series": series_of("not_found")},
            "upstream":     {"value": current["upstream"],   "prev": previous["upstream"],   "series": series_of("upstream")},
        },
        "byMethod": [
            {"label": row["k"] or "?", "value": row["n"]} for row in methods
        ],
        "byStatus": [
            {"label": _status_label(row["k"]), "value": row["n"]} for row in statuses
        ],
        "topPaths": paths,
        "trafficSplit": [
            {"label": key, "value": val["count"]}
            for key, val in sorted(split.items(), key=lambda kv: -kv[1]["count"])
        ],
        "latencyBuckets": bands,
        "bandwidthByType": [
            {"label": key, "value": val["bytes"]}
            for key, val in sorted(kinds.items(), key=lambda kv: -kv[1]["bytes"])
        ],
        "assets": assets,
        "asset404": [
            {"label": a["path"], "value": a["requests"]} for a in assets if a["missing"]
        ],
        "notFoundPaths": not_found,
        "cache": {
            "hits": current["cacheHits"],
            "misses": current["cacheMisses"],
            "hitRate": current["cacheHitRate"],
            "prevHitRate": previous["cacheHitRate"],
            "sampled": current["cacheSeen"],
        },
        "routeCoverage": coverage,
        "entryPages": entry,
        "exitPages": exit_pages,
        "upstreamFailures": upstream,
    }


_AUDIT_DB = os.path.join(_BASE_DIR, "logs", "panel_audit.db")
_BANS_DB = os.path.join(_BASE_DIR, "logs", "ip_bans.db")

_LIVE_SESSION_WINDOW = 300
_LIVE_SERIES_MINUTES = 30

_SOURCE_LABELS = {
    "direct": "Direct",
    "internal": "Internal",
    "external": "Referral",
    "search": "Search",
    "social": "Discord",
}

_event_name_cache = {"data": None, "ts": 0.0}


def _event_names():
    """Event id -> display name, from the events store, cached for a minute."""
    now = time.time()
    if _event_name_cache["data"] is not None and now - _event_name_cache["ts"] < 60:
        return _event_name_cache["data"]
    names = {}
    try:
        with open(_EVENTS_JSON, encoding="utf-8") as handle:
            data = json.load(handle)
        if isinstance(data, dict):
            for key, value in data.items():
                if isinstance(value, dict):
                    names[key] = str(value.get("name") or key)[:80]
    except (OSError, ValueError):
        pass
    _event_name_cache["data"] = names
    _event_name_cache["ts"] = now
    return names


def _open_readonly(path):
    """A read-only connection, or None when the database is not there yet."""
    if not os.path.isfile(path):
        return None
    try:
        return sqlite3.connect("file:" + path + "?mode=ro", uri=True, timeout=5)
    except sqlite3.Error:
        return None


def _unique_series(conn, start, step):
    return conn.execute(
        "SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket,"
        " COUNT(DISTINCT ip_hash) AS visitors"
        " FROM requests WHERE ts >= ? AND ip_hash IS NOT NULL GROUP BY bucket",
        (start, step, start),
    ).fetchall()


def _client_error_rows(conn, start, end=None):
    """Client errors as (bucket, count), or a single total when end is None."""
    if end is None:
        return conn.execute(
            "SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket, COUNT(*) AS n"
            " FROM client_errors WHERE ts >= ? GROUP BY bucket",
            (start, 60, start),
        ).fetchall()
    return conn.execute(
        "SELECT COUNT(*) AS n FROM client_errors WHERE ts >= ? AND ts < ?",
        (start, end),
    ).fetchone()["n"] or 0


def _peak_hours(conn, start):
    """7 x 24 request counts by weekday and hour, Monday first.

    Bucketed in UTC, because the server has no reliable view of the viewer's
    timezone and guessing one would be worse than saying which one it is.
    """
    rows = conn.execute(
        "SELECT CAST(strftime('%w', ts, 'unixepoch') AS INTEGER) AS dow,"
        " CAST(strftime('%H', ts, 'unixepoch') AS INTEGER) AS hour,"
        " COUNT(*) AS n FROM requests WHERE ts >= ? GROUP BY dow, hour",
        (start,),
    ).fetchall()
    grid = [[0] * 24 for _ in range(7)]
    for row in rows:
        # strftime %w is 0 = Sunday; the panel's labels start at Monday.
        day = (int(row["dow"]) + 6) % 7
        hour = int(row["hour"])
        if 0 <= day < 7 and 0 <= hour < 24:
            grid[day][hour] = row["n"] or 0
    return grid


def _event_group(conn, start, kind, expression, limit=12):
    """Group client events by a JSON property of their props."""
    return conn.execute(
        "SELECT " + expression + " AS k, COUNT(*) AS n FROM events"
        " WHERE kind = ? AND ts >= ? AND " + expression + " IS NOT NULL"
        " GROUP BY k ORDER BY n DESC LIMIT ?",
        (kind, start, limit),
    ).fetchall()


def _banner_rows(conn, start, limit=8):
    rows = conn.execute(
        "SELECT json_extract(props, '$.banner') AS banner,"
        " SUM(CASE WHEN json_extract(props, '$.action') = 'impression' THEN 1 ELSE 0 END) AS impressions,"
        " SUM(CASE WHEN json_extract(props, '$.action') = 'click' THEN 1 ELSE 0 END) AS clicks,"
        " SUM(CASE WHEN json_extract(props, '$.action') = 'collapse' THEN 1 ELSE 0 END) AS collapses"
        " FROM events WHERE kind = 'banner' AND ts >= ?"
        " AND json_extract(props, '$.banner') IS NOT NULL"
        " GROUP BY banner ORDER BY impressions DESC LIMIT ?",
        (start, limit),
    ).fetchall()
    names = _event_names()
    out = []
    for row in rows:
        banner_id = row["banner"]
        impressions = row["impressions"] or 0
        clicks = row["clicks"] or 0
        out.append({
            "event": names.get(banner_id, banner_id),
            "impressions": impressions,
            "clicks": clicks,
            "ctr": round(clicks / impressions * 100.0, 1) if impressions else 0.0,
            "collapses": row["collapses"] or 0,
        })
    return out


def _banner_ctr_series(conn, start, step, points):
    """Click-through rate per bucket, as a percentage."""
    rows = conn.execute(
        "SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket,"
        " SUM(CASE WHEN json_extract(props, '$.action') = 'click' THEN 1 ELSE 0 END) AS clicks,"
        " SUM(CASE WHEN json_extract(props, '$.action') = 'impression' THEN 1 ELSE 0 END) AS impressions"
        " FROM events WHERE kind = 'banner' AND ts >= ? GROUP BY bucket",
        (start, step, start),
    ).fetchall()
    series = [0.0] * points
    for row in rows:
        idx = int(row["bucket"])
        if 0 <= idx < points:
            impressions = row["impressions"] or 0
            series[idx] = (round((row["clicks"] or 0) / impressions * 100.0, 1)
                           if impressions else 0.0)
    return series


def _banner_ctr(conn, start, end):
    row = conn.execute(
        "SELECT"
        " SUM(CASE WHEN json_extract(props, '$.action') = 'click' THEN 1 ELSE 0 END) AS clicks,"
        " SUM(CASE WHEN json_extract(props, '$.action') = 'impression' THEN 1 ELSE 0 END) AS impressions"
        " FROM events WHERE kind = 'banner' AND ts >= ? AND ts < ?",
        (start, end),
    ).fetchone()
    impressions = row["impressions"] or 0
    clicks = row["clicks"] or 0
    return round(clicks / impressions * 100.0, 1) if impressions else 0.0


def _login_stats(start, end, previous_start, series_start, points, step):
    """Logins from the panel's own audit log: (total, previous, series)."""
    series = [0] * points
    conn = _open_readonly(_AUDIT_DB)
    if conn is None:
        return 0, 0, series
    try:
        total = conn.execute(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'login'"
            " AND ts >= ? AND ts < ?", (start, end),
        ).fetchone()[0] or 0
        previous = conn.execute(
            "SELECT COUNT(*) FROM audit_log WHERE action = 'login'"
            " AND ts >= ? AND ts < ?", (previous_start, start),
        ).fetchone()[0] or 0
        rows = conn.execute(
            "SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket, COUNT(*) AS n"
            " FROM audit_log WHERE action = 'login' AND ts >= ? GROUP BY bucket",
            (series_start, step, series_start),
        ).fetchall()
    except sqlite3.Error:
        return 0, 0, series
    finally:
        conn.close()
    for row in rows:
        idx = int(row[0])
        if 0 <= idx < points:
            series[idx] = row[1]
    return total, previous, series


def _banned_count(start):
    """IPs added to the blacklist in range. Zero when the store is missing."""
    conn = _open_readonly(_BANS_DB)
    if conn is None:
        return 0
    try:
        return conn.execute(
            "SELECT COUNT(*) FROM blacklist WHERE added_at >= ?", (start,)
        ).fetchone()[0] or 0
    except sqlite3.Error:
        return 0
    finally:
        conn.close()


def _error_rows(conn, start, limit=6):
    """Server failures and client errors, ranked together."""
    rows = []
    for row in conn.execute(
        "SELECT status, COUNT(*) AS n FROM requests"
        " WHERE ts >= ? AND status >= 500 GROUP BY status ORDER BY n DESC",
        (start,),
    ):
        rows.append({"label": _status_label(row["status"]), "count": row["n"]})
    for row in conn.execute(
        "SELECT kind, message, COUNT(*) AS n FROM client_errors"
        " WHERE ts >= ? GROUP BY kind, message ORDER BY n DESC LIMIT ?",
        (start, limit),
    ):
        label = (row["kind"] or "error").replace("_", " ").title()
        message = (row["message"] or "").strip()
        if message:
            label += ": " + (message[:60] + "\u2026" if len(message) > 60 else message)
        rows.append({"label": label, "count": row["n"]})
    rows.sort(key=lambda item: -item["count"])
    return rows[:limit]


def live():
    """The Overview's "Live now" card: the last minute, plus a 30-minute spark."""
    now = time.time()
    minute_ago = now - 60
    session_start = now - _LIVE_SESSION_WINDOW
    series_start = now - _LIVE_SERIES_MINUTES * 60

    conn = _connect()
    try:
        rpm = conn.execute(
            "SELECT COUNT(*) FROM requests WHERE ts >= ?", (minute_ago,)
        ).fetchone()[0] or 0
        sessions = conn.execute(
            "SELECT COUNT(DISTINCT session_hash) FROM requests"
            " WHERE ts >= ? AND session_hash IS NOT NULL", (session_start,)
        ).fetchone()[0] or 0
        epm = conn.execute(
            "SELECT COUNT(*) FROM requests WHERE ts >= ? AND status >= 500", (minute_ago,)
        ).fetchone()[0] or 0
        epm += conn.execute(
            "SELECT COUNT(*) FROM client_errors WHERE ts >= ?", (minute_ago,)
        ).fetchone()[0] or 0
        p95 = conn.execute(
            "WITH ranked AS (SELECT duration_ms,"
            " ROW_NUMBER() OVER (ORDER BY duration_ms) AS rn, COUNT(*) OVER () AS n"
            " FROM requests WHERE ts >= ? AND duration_ms IS NOT NULL)"
            " SELECT MAX(CASE WHEN rn = CAST(n * 0.95 AS INTEGER) + 1 THEN duration_ms END)"
            " FROM ranked",
            (session_start,),
        ).fetchone()[0] or 0
        rows = conn.execute(
            "SELECT CAST((ts - ?) / 60 AS INTEGER) AS bucket, COUNT(*) AS n"
            " FROM requests WHERE ts >= ? GROUP BY bucket",
            (series_start, series_start),
        ).fetchall()
    finally:
        conn.close()

    series = [0] * _LIVE_SERIES_MINUTES
    for row in rows:
        idx = int(row["bucket"])
        if 0 <= idx < _LIVE_SERIES_MINUTES:
            series[idx] = row["n"] or 0
    return {
        "rpm": rpm,
        "sessions": sessions,
        "epm": float(epm),
        "p95": round(p95, 1),
        "series": series,
    }


# Events columns that can be grouped directly. Anything else is a JSON prop.
_EVENT_COLUMNS = ("device", "os", "browser", "locale", "timezone", "source")

_DURATION_BANDS = (("< 30s", 0, 30), ("30s - 2m", 30, 120), ("2 - 10m", 120, 600),
                   ("10 - 30m", 600, 1800), ("> 30m", 1800, None))
_PAGE_BANDS = (("1 page", 1, 1), ("2-3", 2, 3), ("4-6", 4, 6), ("7+", 7, None))
_FREQUENCY_BANDS = (("1 visit", 1, 1), ("2-5", 2, 5), ("6-10", 6, 10), ("11+", 11, None))

_LOGIN_OK = ("owner", "developer", "support")

_ACTIVE_WINDOW_MINUTES = 60


def _band_counts(values, bands):
    out = []
    for label, low, high in bands:
        if high is None:
            n = sum(1 for v in values if v >= low)
        else:
            n = sum(1 for v in values if low <= v <= high)
        out.append({"label": label, "value": n})
    return out


def _session_rows(conn, start):
    """One row per session: first and last request, request count, entry route."""
    return conn.execute(
        "SELECT session_hash, MIN(ts) AS first_ts, MAX(ts) AS last_ts,"
        " COUNT(*) AS requests"
        " FROM requests WHERE ts >= ? AND session_hash IS NOT NULL"
        " GROUP BY session_hash",
        (start,),
    ).fetchall()


def _new_visitor_series(conn, start, step, points):
    """Visitors whose first request in the window falls in each bucket.

    A visitor is an ip_hash, which is salted per day, so someone crossing
    midnight is counted as new again. That is a property of the daily-rotating
    hash, not of this query.
    """
    rows = conn.execute(
        "WITH firsts AS (SELECT ip_hash, MIN(ts) AS first_ts FROM requests"
        " WHERE ts >= ? AND ip_hash IS NOT NULL GROUP BY ip_hash)"
        " SELECT CAST((first_ts - ?) / ? AS INTEGER) AS bucket, COUNT(*) AS n"
        " FROM firsts GROUP BY bucket",
        (start, start, step),
    ).fetchall()
    series = [0] * points
    for row in rows:
        idx = int(row["bucket"])
        if 0 <= idx < points:
            series[idx] = row["n"] or 0
    return series


def _visitor_frequency(conn, start):
    rows = conn.execute(
        "WITH v AS (SELECT ip_hash, COUNT(*) AS n FROM requests"
        " WHERE ts >= ? AND ip_hash IS NOT NULL GROUP BY ip_hash)"
        " SELECT n FROM v",
        (start,),
    ).fetchall()
    return _band_counts([row["n"] for row in rows], _FREQUENCY_BANDS)


def _active_window(conn, now):
    """Concurrent sessions per minute over the last hour, plus the hour before."""
    span = _ACTIVE_WINDOW_MINUTES * 60
    current_start = now - span
    previous_start = current_start - span

    def per_minute(start):
        rows = conn.execute(
            "SELECT CAST((ts - ?) / 60 AS INTEGER) AS minute,"
            " COUNT(DISTINCT session_hash) AS n FROM requests"
            " WHERE ts >= ? AND session_hash IS NOT NULL GROUP BY minute",
            (start, start),
        ).fetchall()
        series = [0] * _ACTIVE_WINDOW_MINUTES
        for row in rows:
            idx = int(row["minute"])
            if 0 <= idx < _ACTIVE_WINDOW_MINUTES:
                series[idx] = row["n"] or 0
        return series

    series = per_minute(current_start)
    previous = per_minute(previous_start)
    peak = max(series) if series else 0
    low = min(series) if series else 0
    avg = round(sum(series) / len(series), 1) if series else 0.0
    prev_avg = max(1, round(sum(previous) / len(previous))) if previous else 1
    return {
        "now": series[-1] if series else 0,
        "peak": peak,
        "low": low,
        "avg": avg,
        "prev": prev_avg,
        "series": series,
    }


def _bounce_by_entry(conn, start, limit=8):
    rows = conn.execute(
        "WITH s AS (SELECT session_hash, MIN(ts) AS first_ts, COUNT(*) AS requests"
        " FROM requests WHERE ts >= ? AND session_hash IS NOT NULL"
        " GROUP BY session_hash),"
        " e AS (SELECT r.session_hash AS sh, r.route AS route FROM requests r"
        " JOIN s ON s.session_hash = r.session_hash AND r.ts = s.first_ts)"
        " SELECT e.route AS route, COUNT(*) AS sessions,"
        " SUM(CASE WHEN s.requests = 1 THEN 1 ELSE 0 END) AS bounces"
        " FROM e JOIN s ON s.session_hash = e.sh"
        " WHERE e.route IS NOT NULL"
        " GROUP BY e.route HAVING COUNT(*) >= 3"
        " ORDER BY sessions DESC LIMIT ?",
        (start, limit),
    ).fetchall()
    return [{
        "label": row["route"],
        "value": round((row["bounces"] or 0) / row["sessions"] * 100.0, 1),
    } for row in rows if row["sessions"]]


def _event_column_group(conn, start, column, limit=10):
    if column not in _EVENT_COLUMNS:
        return []
    return conn.execute(
        "SELECT " + column + " AS k, COUNT(*) AS n FROM events"
        " WHERE ts >= ? AND " + column + " IS NOT NULL"
        " GROUP BY k ORDER BY n DESC LIMIT ?",
        (start, limit),
    ).fetchall()


def _ua_groups(conn, start):
    """Bots and humans, and the named crawlers, from the server-side UA class."""
    rows = conn.execute(
        "SELECT ua_class, COUNT(*) AS n FROM requests"
        " WHERE ts >= ? AND ua_class IS NOT NULL GROUP BY ua_class",
        (start,),
    ).fetchall()
    bots = 0
    humans = 0
    crawlers = {}
    for row in rows:
        ua = row["ua_class"] or ""
        n = row["n"] or 0
        if ua.startswith("bot:"):
            bots += n
            name = ua.split(":", 1)[1].replace("-", " ").title()
            crawlers[name] = crawlers.get(name, 0) + n
        else:
            humans += n
    top = sorted(crawlers.items(), key=lambda kv: -kv[1])[:5]
    other = sum(n for _, n in crawlers.items()) - sum(n for _, n in top)
    out = [{"label": name, "value": n} for name, n in top]
    if other:
        out.append({"label": "Other", "value": other})
    return [{"label": "Human", "value": humans}, {"label": "Bot", "value": bots}], out


_TIMEZONE_REGIONS = {
    "Europe": "Europe",
    "America": "Americas",
    "Asia": "Asia",
    "Africa": "Africa",
    "Australia": "Oceania",
    "Pacific": "Oceania",
    "Atlantic": "Atlantic",
    "Indian": "Indian Ocean",
    "Antarctica": "Antarctica",
    "Arctic": "Arctic",
    "Etc": "UTC",
    "UTC": "UTC",
    "GMT": "UTC",
}


def _region_label(area):
    """A timezone, or its area, to a readable region."""
    text = str(area or "").strip()
    if not text:
        return "Unknown"
    text = text.split("/", 1)[0]
    return _TIMEZONE_REGIONS.get(text, text)


def _regions(conn, start, limit=6):
    """Region split and table, derived from the visitor's own timezone.

    Region is the continent part of the IANA timezone the beacon reports
    (Europe/Brussels -> Europe), taken per session so bounce is real. It is a
    coarse proxy for where someone is, but it needs no IP lookup at all.
    """
    rows = conn.execute(
        "WITH tz AS (SELECT session_hash, MIN(timezone) AS timezone FROM events"
        " WHERE ts >= ? AND session_hash IS NOT NULL AND timezone IS NOT NULL"
        " GROUP BY session_hash),"
        " r AS (SELECT session_hash, COUNT(*) AS requests, MIN(ip_hash) AS ip"
        " FROM requests WHERE ts >= ? AND session_hash IS NOT NULL"
        " GROUP BY session_hash)"
        " SELECT CASE WHEN instr(tz.timezone, '/') > 0"
        "             THEN substr(tz.timezone, 1, instr(tz.timezone, '/') - 1)"
        "             ELSE tz.timezone END AS area,"
        " COUNT(*) AS sessions, COUNT(DISTINCT r.ip) AS visitors,"
        " SUM(CASE WHEN r.requests = 1 THEN 1 ELSE 0 END) AS bounces"
        " FROM tz JOIN r ON r.session_hash = tz.session_hash"
        " GROUP BY area ORDER BY sessions DESC",
        (start, start),
    ).fetchall()
    if not rows:
        return [], [], 0

    total_sessions = sum(row["sessions"] or 0 for row in rows) or 1

    def entry(label, sessions, visitors, bounces):
        return {
            "region": label,
            "sessions": sessions,
            "visitors": visitors,
            "share": round(sessions / total_sessions * 100.0, 1),
            "bounce": round(bounces / sessions * 100.0, 1) if sessions else 0.0,
        }

    top = rows[:limit]
    rest = rows[limit:]
    split = [{"label": _region_label(row["area"]), "value": row["sessions"] or 0}
             for row in top]
    table = [entry(_region_label(row["area"]), row["sessions"] or 0,
                   row["visitors"] or 0, row["bounces"] or 0) for row in top]
    if rest:
        other_sessions = sum(row["sessions"] or 0 for row in rest)
        other_visitors = sum(row["visitors"] or 0 for row in rest)
        other_bounces = sum(row["bounces"] or 0 for row in rest)
        split.append({"label": "Other", "value": other_sessions})
        table.append(entry("Other", other_sessions, other_visitors, other_bounces))
    return split, table, len(rows)


def _audit_rows(start, end, actions):
    """Rows from the panel's audit log for the given actions, or [] if absent."""
    conn = _open_readonly(_AUDIT_DB)
    if conn is None:
        return []
    try:
        marks = ",".join("?" * len(actions))
        return conn.execute(
            "SELECT ts, actor_id, actor_name, action, result, detail, service, ip FROM audit_log"
            " WHERE ts >= ? AND ts < ? AND action IN (" + marks + ")",
            tuple([start, end] + list(actions)),
        ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        conn.close()


def _auth_block(conn, start, end, points, step, sessions, roster, started):
    rows = _audit_rows(start, end, ("login", "login_failed", "logout"))
    logins = [r for r in rows if r[3] == "login"]
    failed = [r for r in rows if r[3] == "login_failed"]
    logouts = [r for r in rows if r[3] == "logout"]

    successes = sum(1 for r in logins if (r[4] or "") in _LOGIN_OK)
    denied = sum(1 for r in logins if (r[4] or "") not in _LOGIN_OK)
    failures = denied + len(failed)
    attempts = max(started, successes + failures)
    abandoned = max(0, attempts - successes - failures)
    reached_callback = max(0, attempts - abandoned)

    series = [0] * points
    for row in logins:
        idx = int((row[0] - start) // step)
        if 0 <= idx < points:
            series[idx] += 1

    reasons = {}
    if denied:
        reasons["Access denied"] = denied
    for row in failed:
        reason = (row[5] or "Unknown").strip()[:60] or "Unknown"
        reasons[reason] = reasons.get(reason, 0) + 1
    failure_reasons = [{"label": k, "value": v}
                       for k, v in sorted(reasons.items(), key=lambda kv: -kv[1])[:6]]

    logout_reasons = {}
    for row in logouts:
        key = "Idle timeout" if (row[4] or "") == "idle_timeout" else "Manual"
        logout_reasons[key] = logout_reasons.get(key, 0) + 1

    durations = [(r[2] - r[1]) for r in sessions]
    durations.sort()
    avg_duration = round(sum(durations) / len(durations), 1) if durations else 0.0
    median = durations[len(durations) // 2] if durations else 0.0
    idle = logout_reasons.get("Idle timeout", 0)
    total_logouts = sum(logout_reasons.values())

    # Ranks of everyone who was active in range, from the cached guild roster.
    active_ids = {str(r[0]) for r in conn.execute(
        "SELECT DISTINCT user_id FROM events WHERE ts >= ? AND user_id IS NOT NULL",
        (start,))}
    active_ids |= {str(r[1]) for r in logins if r[1]}
    ranks = []
    never = {"count": 0, "total": 0, "available": False}
    if roster:
        counts = {}
        for uid in active_ids:
            name = roster["ranks"].get(uid)
            if name:
                counts[name] = counts.get(name, 0) + 1
        ranks = [{"label": k, "value": v}
                 for k, v in sorted(counts.items(), key=lambda kv: -kv[1])]
        never = {
            "count": sum(1 for uid in roster["ranks"] if uid not in active_ids),
            "total": roster["total"],
            "available": True,
        }

    # Most active accounts, from the audit log's actor and the event stream.
    per_account = {}
    for row in logins:
        uid = str(row[1] or "")
        if not uid:
            continue
        entry = per_account.setdefault(uid, {"account": row[2] or uid, "logins": 0, "last": row[0]})
        entry["logins"] += 1
        entry["last"] = max(entry["last"], row[0])
    sessions_by_user = {str(r[0]): r[1] for r in conn.execute(
        "SELECT user_id, COUNT(DISTINCT session_hash) FROM events"
        " WHERE ts >= ? AND user_id IS NOT NULL GROUP BY user_id",
        (start,))}
    accounts = []
    for uid, entry in per_account.items():
        accounts.append({
            "account": entry["account"],
            "rank": (roster or {}).get("ranks", {}).get(uid, "\u2014") if roster else "\u2014",
            "logins": entry["logins"],
            "sessions": sessions_by_user.get(uid, 0),
            "lastSeen": _iso(entry["last"]),
        })
    accounts.sort(key=lambda a: -a["logins"])

    ui = _event_group(conn, start, "ui", "json_extract(props, '$.action')", 8)
    theme_changes = conn.execute(
        "SELECT COUNT(*) FROM events WHERE ts >= ? AND kind = 'theme'", (start,)
    ).fetchone()[0] or 0
    font_changes = conn.execute(
        "SELECT COUNT(*) FROM events WHERE ts >= ? AND kind = 'font'", (start,)
    ).fetchone()[0] or 0
    panel_activity = []
    for row in ui:
        label = str(row["k"] or "").replace("_", " ").title()
        panel_activity.append({"label": label, "value": row["n"]})
    if theme_changes:
        panel_activity.append({"label": "Theme Changed", "value": theme_changes})
    if font_changes:
        panel_activity.append({"label": "Font Changed", "value": font_changes})

    dev_requests = conn.execute(
        "SELECT COUNT(*) FROM requests WHERE ts >= ? AND route = '/auth/dev-login'",
        (start,),
    ).fetchone()[0] or 0
    dev_events = conn.execute(
        "SELECT COUNT(*) FROM events WHERE kind = 'feature' AND ts >= ?"
        " AND json_extract(props, '$.name') = 'dev-login'", (start,),
    ).fetchone()[0] or 0
    dev_login = max(dev_requests, dev_events)

    return {
        "funnel": [
            {"label": "Login started", "value": attempts},
            {"label": "Reached callback", "value": reached_callback},
            {"label": "Session issued", "value": successes},
        ],
        "attempts": attempts,
        "successes": successes,
        "failures": failures,
        "abandoned": abandoned,
        "callbackErrors": len(failed),
        "loginSeries": series,
        "failureReasons": failure_reasons,
        "logouts": [{"label": k, "value": v}
                    for k, v in sorted(logout_reasons.items(), key=lambda kv: -kv[1])],
        "logoutTotal": total_logouts,
        "idleTimeoutRate": round(idle / total_logouts * 100.0, 1) if total_logouts else 0.0,
        "sessionHealth": [
            {"label": "Avg session", "value": _fmt_duration(avg_duration)},
            {"label": "Median session", "value": _fmt_duration(median)},
            {"label": "Sessions", "value": str(len(sessions))},
        ],
        "ranks": ranks,
        "neverLoggedIn": never,
        "activeAccounts": accounts[:8],
        "panelActivity": panel_activity,
        "devLogin": dev_login,
    }


def _mc_names():
    """discord id -> Minecraft username, from the bot's account link table."""
    try:
        with open(_USERNAME_MATCHES_JSON, "r", encoding="utf-8") as fh:
            matches = json.load(fh)
    except (OSError, ValueError):
        return {}
    names = {}
    if isinstance(matches, dict):
        for did, entry in matches.items():
            if isinstance(entry, dict):
                name = entry.get("username")
            elif isinstance(entry, str):
                name = entry
            else:
                name = None
            if name:
                names[str(did)] = str(name)
    return names


def _user_db_accounts():
    """The site's own user store: everyone who has logged in, plus their names.

    This is the authoritative list. The panel audit log only sees panel logins,
    which is a small subset of the people who use the dashboard.
    """
    conn = _open_readonly(_USER_DB_PATH)
    if conn is None:
        return {}
    conn.row_factory = sqlite3.Row
    accounts = {}

    def entry(uid):
        item = accounts.get(uid)
        if item is None:
            item = {
                "discordName": "", "tokens": 0, "lastLogin": None,
                "settingsUpdated": None, "restricted": False,
            }
            accounts[uid] = item
        return item

    try:
        for row in conn.execute("SELECT discord_id, updated_at FROM user_settings"):
            uid = str(row["discord_id"] or "")
            if uid:
                entry(uid)["settingsUpdated"] = row["updated_at"]
        for row in conn.execute(
                "SELECT discord_id, user_data, created_at FROM remember_tokens"):
            uid = str(row["discord_id"] or "")
            if not uid:
                continue
            item = entry(uid)
            item["tokens"] += 1
            if item["lastLogin"] is None or (row["created_at"] or 0) > item["lastLogin"]:
                item["lastLogin"] = row["created_at"]
            if not item["discordName"]:
                try:
                    data = json.loads(row["user_data"] or "{}")
                except (ValueError, TypeError):
                    data = {}
                item["discordName"] = str(data.get("nick") or data.get("username") or "")
        for row in conn.execute("SELECT discord_id FROM gdpr_restricted"):
            uid = str(row["discord_id"] or "")
            if uid:
                entry(uid)["restricted"] = True
    except sqlite3.Error:
        return {}
    finally:
        conn.close()
    return accounts


def _accounts_block(conn, start, end, roster):
    """Everyone who has logged in, with their activity in range.

    The account list comes from the site user store; the event stream fills in
    what each account actually did. Names prefer the linked Minecraft username,
    then the Discord name recorded with the remember token, then the id.
    """
    accounts = _user_db_accounts()
    mc_names = _mc_names()

    def entry(uid):
        item = accounts.get(uid)
        if item is None:
            item = {
                "discordName": "", "tokens": 0, "lastLogin": None,
                "settingsUpdated": None, "restricted": False,
            }
            accounts[uid] = item
        return item


    for row in conn.execute(
            "SELECT DISTINCT user_id FROM events WHERE ts >= ? AND user_id IS NOT NULL",
            (start,)):
        uid = str(row["user_id"] or "")
        if uid:
            entry(uid)

    logins = {}
    audit_names = {}
    for row in _audit_rows(0, end, ("login",)):
        uid = str(row[1] or "")
        if not uid:
            continue
        if row[2] and uid not in audit_names:
            audit_names[uid] = str(row[2])
        if row[0] >= start:
            logins[uid] = logins.get(uid, 0) + 1
    for row in conn.execute(
            "SELECT user_id AS k, COUNT(*) AS n FROM events WHERE kind = 'feature'"
            " AND ts >= ? AND json_extract(props, '$.name') = 'site-login'"
            " AND user_id IS NOT NULL GROUP BY k", (start,)):
        uid = str(row["k"] or "")
        if uid:
            logins[uid] = logins.get(uid, 0) + (row["n"] or 0)

    stats = {}

    def stat(uid):
        item = stats.get(uid)
        if item is None:
            item = {"events": 0, "sessions": 0, "panelViews": 0, "activeMs": 0,
                    "firstSeen": None, "lastSeen": None}
            stats[uid] = item
        return item

    for row in conn.execute(
            "SELECT user_id, COUNT(*) AS n, COUNT(DISTINCT session_hash) AS sessions,"
            " MIN(ts) AS first_ts, MAX(ts) AS last_ts FROM events"
            " WHERE ts >= ? AND user_id IS NOT NULL GROUP BY user_id", (start,)):
        item = stat(str(row["user_id"]))
        item["events"] = row["n"] or 0
        item["sessions"] = row["sessions"] or 0
        item["firstSeen"] = row["first_ts"]
        item["lastSeen"] = row["last_ts"]
    for row in conn.execute(
            "SELECT user_id, COUNT(*) AS n FROM events WHERE kind = 'panel_view'"
            " AND ts >= ? AND user_id IS NOT NULL GROUP BY user_id", (start,)):
        stat(str(row["user_id"]))["panelViews"] = row["n"] or 0
    for row in conn.execute(
            "SELECT user_id, SUM(CAST(json_extract(props, '$.active_ms') AS INTEGER)) AS ms"
            " FROM events WHERE kind = 'depth' AND ts >= ? AND user_id IS NOT NULL"
            " GROUP BY user_id", (start,)):
        stat(str(row["user_id"]))["activeMs"] = row["ms"] or 0

    ranks = (roster or {}).get("ranks", {}) if roster else {}
    out = []
    for uid, account in accounts.items():
        item = stats.get(uid) or {}
        last_active = item.get("lastSeen") or account.get("lastLogin")
        out.append({
            "account": (mc_names.get(uid) or account.get("discordName")
                        or audit_names.get(uid) or uid),
            "discord": account.get("discordName") or "",
            "linked": uid in mc_names,
            "rank": ranks.get(uid, "\u2014"),
            "restricted": bool(account.get("restricted")),
            "tokens": account.get("tokens") or 0,
            "logins": logins.get(uid, 0),
            "events": item.get("events", 0),
            "sessions": item.get("sessions", 0),
            "panelViews": item.get("panelViews", 0),
            "activeSeconds": round((item.get("activeMs") or 0) / 1000.0, 1),
            "firstSeen": _iso(item["firstSeen"]) if item.get("firstSeen") else None,
            "lastSeen": _iso(last_active) if last_active else None,
            "inRange": bool(item.get("events") or logins.get(uid)),
        })
    out.sort(key=lambda row: (row["events"] + row["logins"], row["sessions"],
                              row["activeSeconds"]), reverse=True)
    for index, row in enumerate(out):
        row["pos"] = index + 1
    return {
        "total": len(out),
        "activeInRange": sum(1 for row in out if row["inRange"]),
        "withActivity": sum(1 for row in out if row["events"] > 0),
        "loggedInNow": sum(1 for row in out if row["tokens"] > 0),
        "linked": sum(1 for row in out if row["linked"]),
        "restricted": sum(1 for row in out if row["restricted"]),
        "totalLogins": sum(row["logins"] for row in out),
        "list": out,
    }


def _fmt_duration(seconds):
    s = max(0, int(round(seconds or 0)))
    if s < 60:
        return "%ds" % s
    if s < 3600:
        return "%dm %ds" % (s // 60, s % 60)
    return "%dh %dm" % (s // 3600, (s % 3600) // 60)


def audience(range_id, roster=None):
    """Everything the Audience panel renders, for one range."""
    points, step = range_spec(range_id)
    now = time.time()
    start = now - points * step

    conn = _connect()
    try:
        current = _window_summary(conn, start, now)
        previous = _window_summary(conn, start - points * step, start)
        visitors_series = _fill(_unique_series(conn, start, step), "visitors", points)
        new_series = _new_visitor_series(conn, start, step, points)
        sessions = _session_rows(conn, start)
        session_series = _fill(conn.execute(
            "SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket,"
            " COUNT(DISTINCT session_hash) AS n FROM requests"
            " WHERE ts >= ? AND session_hash IS NOT NULL GROUP BY bucket",
            (start, step, start),
        ).fetchall(), "n", points)
        frequency = _visitor_frequency(conn, start)
        active_window = _active_window(conn, now)
        bounce_by_entry = _bounce_by_entry(conn, start)
        devices = _event_column_group(conn, start, "device", 5)
        oses = _event_column_group(conn, start, "os", 8)
        browsers = _event_column_group(conn, start, "browser", 8)
        locales = _event_column_group(conn, start, "locale", 8)
        timezones = _event_column_group(conn, start, "timezone", 8)
        sources = _event_column_group(conn, start, "source", 8)
        screens = _event_group(conn, start, "page_view", "json_extract(props, '$.screen')", 8)
        viewports = _event_group(conn, start, "page_view", "json_extract(props, '$.viewport')", 8)
        memory = _event_group(conn, start, "page_view", "json_extract(props, '$.memory')", 8)
        cores = _event_group(conn, start, "page_view", "json_extract(props, '$.cores')", 8)
        connection = _event_group(conn, start, "page_view", "json_extract(props, '$.connection')", 8)
        utm = conn.execute(
            "SELECT json_extract(props, '$.utm_campaign') AS campaign,"
            " COALESCE(json_extract(props, '$.utm_source'), '') AS source,"
            " COALESCE(json_extract(props, '$.utm_medium'), '') AS medium,"
            " COUNT(*) AS n FROM events"
            " WHERE kind = 'page_view' AND ts >= ?"
            " AND json_extract(props, '$.utm_campaign') IS NOT NULL"
            " GROUP BY campaign, source, medium ORDER BY n DESC LIMIT 10",
            (start,),
        ).fetchall()
        bots, crawlers = _ua_groups(conn, start)
        region_split, region_table, region_count = _regions(conn, start)
        privacy = conn.execute(
            "SELECT SUM(dnt) AS dnt, SUM(gpc) AS gpc, COUNT(*) AS total"
            " FROM requests WHERE ts >= ?", (start,),
        ).fetchone()
        started = conn.execute(
            "SELECT COUNT(*) FROM requests WHERE ts >= ? AND route = '/auth/login'",
            (start,),
        ).fetchone()[0] or 0
        auth = _auth_block(conn, start, now, points, step, sessions, roster, started)
        accounts = _accounts_block(conn, start, now, roster)
    finally:
        conn.close()

    durations = [max(0.0, (r["last_ts"] or 0) - (r["first_ts"] or 0)) for r in sessions]
    pages = [r["requests"] or 0 for r in sessions]
    session_count = len(sessions)
    bounces = sum(1 for n in pages if n == 1)
    total_pages = sum(pages)
    avg_duration = round(sum(durations) / session_count, 1) if session_count else 0.0

    total_visitors = current["visitors"]
    total_new = sum(new_series)
    total_returning = max(0, total_visitors - total_new)
    returning_series = [max(0, visitors_series[i] - new_series[i]) for i in range(points)]

    def group(rows, key="k", title=False, fmt=None):
        out = []
        for row in rows:
            label = row[key]
            if label is None:
                continue
            label = str(label)
            if title:
                label = label.replace("-", " ").title()
            if fmt:
                label = fmt(label)
            out.append({"label": label, "value": row["n"]})
        return out

    dnt_total = privacy["dnt"] or 0
    gpc_total = privacy["gpc"] or 0

    return {
        "range": range_id,
        "generatedAt": _iso(now),
        "buckets": _buckets(start, step, points),
        "kpis": {
            "visitors":    {"value": total_visitors, "prev": previous["visitors"], "series": visitors_series},
            "newVisitors": {"value": total_new, "prev": 0, "series": new_series},
            "returning":   {"value": total_returning, "prev": 0, "series": returning_series},
            "sessions":    {"value": session_count, "prev": 0, "series": session_series},
            "duration":    {"value": avg_duration, "prev": 0,
                            "series": [round(sum(durations) / max(1, len(durations)), 1)] * points},
            "pagesPerSession": {"value": round(total_pages / session_count, 2) if session_count else 0.0,
                                "prev": 0, "series": [round(total_pages / max(1, session_count), 2)] * points},
            "bounceRate":  {"value": round(bounces / session_count * 100.0, 1) if session_count else 0.0,
                            "prev": 0,
                            "series": [round(bounces / max(1, session_count) * 100.0, 1)] * points},
            "logins":      {"value": auth["successes"], "prev": 0, "series": auth["loginSeries"]},
            "loginSuccessRate": {
                "value": round(auth["successes"] / auth["attempts"] * 100.0, 1) if auth["attempts"] else 0.0,
                "prev": 0, "series": [0] * points,
            },
            "countries":   {"value": region_count, "prev": 0, "series": [region_count] * points},
        },
        "visitorSeries": {"total": visitors_series, "new": new_series, "returning": returning_series},
        "split": [
            {"label": "New", "value": total_new},
            {"label": "Returning", "value": total_returning},
        ],
        "frequency": frequency,
        "sources": group(sources, fmt=lambda v: _SOURCE_LABELS.get(v, v.title())),
        "utm": [{
            "campaign": row["campaign"],
            "source": row["source"],
            "medium": row["medium"],
            "arrivals": row["n"],
        } for row in utm],
        "activeWindow": active_window,
        "durationBuckets": _band_counts(durations, _DURATION_BANDS),
        "pagesBuckets": _band_counts(pages, _PAGE_BANDS),
        "bounceByEntry": bounce_by_entry,
        "devices": group(devices, title=True),
        "os": group(oses, title=True),
        "browsers": group(browsers, title=True),
        "screens": group(screens, fmt=lambda v: v.replace("x", " x ")),
        "viewports": group(viewports, fmt=lambda v: v.replace("x", " x ")),
        "connection": group(connection),
        "locales": group(locales),
        "timezones": group(timezones),
        "memory": group(memory, fmt=lambda v: "%s GB" % v),
        "cores": group(cores, fmt=lambda v: "%s cores" % v),
        "bots": bots,
        "crawlers": crawlers,
        "privacy": {"dnt": dnt_total, "gpc": gpc_total},
        "regions": region_split,
        "regionTable": region_table,
        "auth": auth,
        "accounts": accounts,
    }


_SCROLL_MARKS = (25, 50, 75, 100)

_BANNER_ACTION = "json_extract(props, '$.action')"
_BANNER_ID = "json_extract(props, '$.banner')"


def _kind_count(conn, start, kind):
    return conn.execute(
        "SELECT COUNT(*) FROM events WHERE kind = ? AND ts >= ?", (kind, start)
    ).fetchone()[0] or 0


def _kind_series(conn, start, step, points, kind):
    return _fill(conn.execute(
        "SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket, COUNT(*) AS n FROM events"
        " WHERE kind = ? AND ts >= ? GROUP BY bucket",
        (start, step, kind, start),
    ).fetchall(), "n", points)


def _prop_group(conn, start, kind, expression, limit=12):
    return conn.execute(
        "SELECT " + expression + " AS k, COUNT(*) AS n FROM events"
        " WHERE kind = ? AND ts >= ? AND " + expression + " IS NOT NULL"
        " GROUP BY k ORDER BY n DESC LIMIT ?",
        (kind, start, limit),
    ).fetchall()


def _banner_totals(conn, start):
    row = conn.execute(
        "SELECT"
        " SUM(CASE WHEN " + _BANNER_ACTION + " = 'impression' THEN 1 ELSE 0 END) AS impressions,"
        " SUM(CASE WHEN " + _BANNER_ACTION + " = 'visible' THEN 1 ELSE 0 END) AS visible,"
        " SUM(CASE WHEN " + _BANNER_ACTION + " = 'click' THEN 1 ELSE 0 END) AS clicks,"
        " SUM(CASE WHEN " + _BANNER_ACTION + " = 'collapse' THEN 1 ELSE 0 END) AS collapses,"
        " SUM(CASE WHEN " + _BANNER_ACTION + " = 'expand' THEN 1 ELSE 0 END) AS reexpands"
        " FROM events WHERE kind = 'banner' AND ts >= ?",
        (start,),
    ).fetchone()
    impressions = row["impressions"] or 0
    visible = row["visible"] or 0
    return {
        "impressions": impressions,
        "visible": visible,
        "clicks": row["clicks"] or 0,
        "collapses": row["collapses"] or 0,
        "reexpands": row["reexpands"] or 0,
        "visibleRate": round(visible / impressions * 100.0, 1) if impressions else 0.0,
    }


def _banner_rows(conn, start, limit=8):
    """Per-event banner detail, including how many people came back to it."""
    rows = conn.execute(
        "SELECT " + _BANNER_ID + " AS banner,"
        " SUM(CASE WHEN " + _BANNER_ACTION + " = 'impression' THEN 1 ELSE 0 END) AS impressions,"
        " SUM(CASE WHEN " + _BANNER_ACTION + " = 'visible' THEN 1 ELSE 0 END) AS visible,"
        " SUM(CASE WHEN " + _BANNER_ACTION + " = 'click' THEN 1 ELSE 0 END) AS clicks,"
        " SUM(CASE WHEN " + _BANNER_ACTION + " = 'collapse' THEN 1 ELSE 0 END) AS collapses,"
        " SUM(CASE WHEN " + _BANNER_ACTION + " = 'expand' THEN 1 ELSE 0 END) AS reexpands,"
        " COUNT(DISTINCT ip_hash) AS uniques,"
        " AVG(CASE WHEN " + _BANNER_ACTION + " = 'visible'"
        "          THEN CAST(json_extract(props, '$.ms') AS REAL) END) AS dwell_ms,"
        " MAX(json_extract(props, '$.status')) AS status,"
        " MAX(json_extract(props, '$.audience')) AS audience"
        " FROM events WHERE kind = 'banner' AND ts >= ?"
        " AND " + _BANNER_ID + " IS NOT NULL GROUP BY banner"
        " ORDER BY impressions DESC LIMIT ?",
        (start, limit),
    ).fetchall()
    repeats = {row["banner"]: row["n"] for row in conn.execute(
        "SELECT banner, COUNT(*) AS n FROM (SELECT " + _BANNER_ID + " AS banner,"
        " ip_hash, COUNT(*) AS c FROM events WHERE kind = 'banner' AND ts >= ?"
        " AND " + _BANNER_ACTION + " = 'impression' AND ip_hash IS NOT NULL"
        " GROUP BY banner, ip_hash) WHERE c > 1 GROUP BY banner",
        (start,),
    )}
    names = _event_names()
    out = []
    for row in rows:
        impressions = row["impressions"] or 0
        clicks = row["clicks"] or 0
        banner_id = row["banner"]
        out.append({
            "event": names.get(banner_id, banner_id),
            "status": row["status"] or "upcoming",
            "audience": row["audience"] or "public",
            "impressions": impressions,
            "visible": row["visible"] or 0,
            "clicks": clicks,
            "ctr": round(clicks / impressions * 100.0, 2) if impressions else 0.0,
            "collapses": row["collapses"] or 0,
            "collapseRate": round((row["collapses"] or 0) / impressions * 100.0, 2) if impressions else 0.0,
            "reexpands": row["reexpands"] or 0,
            "uniqueUsers": row["uniques"] or 0,
            "repeatUsers": repeats.get(banner_id, 0),
            "dwell": round((row["dwell_ms"] or 0) / 1000.0, 1),
        })
    return out


def _banner_status_rate(conn, start):
    rows = conn.execute(
        "SELECT json_extract(props, '$.status') AS status,"
        " SUM(CASE WHEN " + _BANNER_ACTION + " = 'impression' THEN 1 ELSE 0 END) AS impressions,"
        " SUM(CASE WHEN " + _BANNER_ACTION + " = 'click' THEN 1 ELSE 0 END) AS clicks"
        " FROM events WHERE kind = 'banner' AND ts >= ?"
        " AND json_extract(props, '$.status') IS NOT NULL GROUP BY status",
        (start,),
    ).fetchall()
    out = []
    for row in rows:
        impressions = row["impressions"] or 0
        clicks = row["clicks"] or 0
        out.append({
            "label": str(row["status"]).title(),
            "value": round(clicks / impressions * 100.0, 1) if impressions else 0.0,
        })
    out.sort(key=lambda item: -item["value"])
    return out


def _depth_block(conn, start, sessions_seen):
    """Scroll depth, tab-hidden count and per-session active and idle time."""
    scroll_rows = conn.execute(
        "SELECT session_hash, MAX(CAST(json_extract(props, '$.scroll') AS INTEGER)) AS reach"
        " FROM events WHERE kind = 'depth' AND ts >= ?"
        " AND json_extract(props, '$.scroll') IS NOT NULL GROUP BY session_hash",
        (start,),
    ).fetchall()
    reaches = [row["reach"] or 0 for row in scroll_rows]
    scroll = [{"label": "%d%%" % mark,
               "value": sum(1 for r in reaches if r >= mark)} for mark in _SCROLL_MARKS]

    totals = conn.execute(
        "SELECT SUM(CASE WHEN CAST(json_extract(props, '$.hidden_ms') AS INTEGER) > 0"
        "                 THEN 1 ELSE 0 END) AS hidden,"
        " SUM(CAST(json_extract(props, '$.active_ms') AS INTEGER)) AS active,"
        " SUM(CAST(json_extract(props, '$.idle_ms') AS INTEGER)) AS idle,"
        " COUNT(DISTINCT session_hash) AS sessions"
        " FROM events WHERE kind = 'depth' AND ts >= ?",
        (start,),
    ).fetchone()
    reported = totals["sessions"] or 0
    divisor = reported or max(1, sessions_seen)
    first_use = conn.execute(
        "WITH firsts AS (SELECT session_hash, MIN(ts) AS first_ts FROM events"
        " WHERE kind = 'panel_view' AND ts >= ? GROUP BY session_hash)"
        " SELECT json_extract(e.props, '$.panel') AS panel, COUNT(*) AS n FROM events e"
        " JOIN firsts ON firsts.session_hash = e.session_hash AND e.ts = firsts.first_ts"
        " WHERE e.kind = 'panel_view' AND json_extract(e.props, '$.panel') IS NOT NULL"
        " GROUP BY panel ORDER BY n DESC LIMIT 8",
        (start,),
    ).fetchall()
    return {
        "scroll": scroll,
        "tabHidden": totals["hidden"] or 0,
        "activeSeconds": round((totals["active"] or 0) / 1000.0 / divisor, 1),
        "idleSeconds": round((totals["idle"] or 0) / 1000.0 / divisor, 1),
        "firstUse": [{"label": str(row["panel"]).replace("-", " ").title(), "value": row["n"]}
                    for row in first_use],
    }


def _entry_types(conn, start):
    rows = conn.execute(
        "WITH firsts AS (SELECT session_hash, MIN(ts) AS first_ts FROM requests"
        " WHERE ts >= ? AND session_hash IS NOT NULL GROUP BY session_hash)"
        " SELECT CASE WHEN r.path = '/' THEN 'Landed on /' ELSE 'Deep link' END AS kind,"
        " COUNT(*) AS n FROM requests r"
        " JOIN firsts ON firsts.session_hash = r.session_hash AND r.ts = firsts.first_ts"
        " GROUP BY kind ORDER BY n DESC",
        (start,),
    ).fetchall()
    return [{"label": row["kind"], "value": row["n"]} for row in rows]


def _event_view_block(conn, start, points, step):
    """Event views, where they came from, and how long the card took to show."""
    views = conn.execute(
        "SELECT json_extract(props, '$.event') AS event, COUNT(*) AS n,"
        " SUM(CASE WHEN CAST(json_extract(props, '$.ms') AS INTEGER) <= 60000"
        "          THEN 1 ELSE 0 END) AS from_banner"
        " FROM events WHERE kind = 'event' AND ts >= ?"
        " AND json_extract(props, '$.action') = 'view'"
        " AND json_extract(props, '$.event') IS NOT NULL GROUP BY event",
        (start,),
    ).fetchall()
    pins = {row["k"]: row["n"] for row in conn.execute(
        "SELECT json_extract(props, '$.event') AS k, COUNT(*) AS n FROM events"
        " WHERE kind = 'event' AND ts >= ?"
        " AND json_extract(props, '$.action') IN ('pin', 'unpin')"
        " GROUP BY k",
        (start,),
    )}
    names = _event_names()
    listing = []
    for row in views:
        event_id = row["event"]
        total = row["n"] or 0
        from_banner = row["from_banner"] or 0
        listing.append({
            "event": names.get(event_id, event_id),
            "views": total,
            "fromBanner": from_banner,
            "fromList": max(0, total - from_banner),
            "pins": pins.get(event_id, 0),
        })
    listing.sort(key=lambda item: -item["views"])

    referrers = []
    total_views = sum(item["views"] for item in listing)
    total_banner = sum(item["fromBanner"] for item in listing)
    if total_views:
        referrers = [
            {"label": "Pinned banner", "value": total_banner},
            {"label": "Events page", "value": max(0, total_views - total_banner)},
        ]

    latencies = [row[0] for row in conn.execute(
        "SELECT CAST(json_extract(props, '$.ms') AS INTEGER) FROM events"
        " WHERE kind = 'event' AND ts >= ? AND json_extract(props, '$.action') = 'view'"
        " AND json_extract(props, '$.ms') IS NOT NULL",
        (start,),
    ) if row[0] is not None]
    latencies.sort()
    median = round(latencies[len(latencies) // 2] / 1000.0, 1) if latencies else 0.0
    return {
        "list": listing[:8],
        "referrers": referrers,
        "series": _kind_series(conn, start, step, points, "event"),
        "latency": {
            "median": median,
            "within1m": sum(1 for ms in latencies if ms <= 60000),
            "oneTo5m": sum(1 for ms in latencies if 60000 < ms <= 300000),
            "over5m": sum(1 for ms in latencies if ms > 300000),
        },
    }


def _pin_actors(conn, start, limit=8):
    """Who pinned and unpinned what, with names resolved from the audit log."""
    rows = conn.execute(
        "SELECT user_id,"
        " SUM(CASE WHEN json_extract(props, '$.action') = 'pin' THEN 1 ELSE 0 END) AS pinned,"
        " SUM(CASE WHEN json_extract(props, '$.action') = 'unpin' THEN 1 ELSE 0 END) AS unpinned"
        " FROM events WHERE kind = 'event' AND ts >= ? AND user_id IS NOT NULL"
        " AND json_extract(props, '$.action') IN ('pin', 'unpin')"
        " GROUP BY user_id ORDER BY (pinned + unpinned) DESC LIMIT ?",
        (start, limit),
    ).fetchall()
    names = {}
    audit = _open_readonly(_AUDIT_DB)
    if audit is not None:
        try:
            names = {str(r[0]): r[1] for r in audit.execute(
                "SELECT actor_id, actor_name FROM audit_log"
                " WHERE actor_id IS NOT NULL AND actor_name IS NOT NULL")}
        except sqlite3.Error:
            names = {}
        finally:
            audit.close()
    return [{
        "actor": names.get(str(row["user_id"]), str(row["user_id"])),
        "pinned": row["pinned"] or 0,
        "unpinned": row["unpinned"] or 0,
    } for row in rows]


def engagement(range_id):
    """Everything the Engagement panel renders, for one range."""
    points, step = range_spec(range_id)
    now = time.time()
    start = now - points * step

    conn = _connect()
    try:
        panel_views = _kind_count(conn, start, "panel_view")
        panel_switches = _kind_count(conn, start, "panel_switch")
        panel_series = _kind_series(conn, start, step, points, "panel_view")
        switch_series = _kind_series(conn, start, step, points, "panel_switch")
        banner_series = _kind_series(conn, start, step, points, "banner")
        panels = _prop_group(conn, start, "panel_view", "json_extract(props, '$.panel')", 12)
        panel_sessions = {row["k"]: row["n"] for row in conn.execute(
            "SELECT json_extract(props, '$.panel') AS k, COUNT(DISTINCT session_hash) AS n"
            " FROM events WHERE kind = 'panel_view' AND ts >= ?"
            " AND json_extract(props, '$.panel') IS NOT NULL GROUP BY k",
            (start,),
        )}
        flow = conn.execute(
            "SELECT json_extract(props, '$.from') AS src, json_extract(props, '$.to') AS dst,"
            " COUNT(*) AS n FROM events WHERE kind = 'panel_switch' AND ts >= ?"
            " AND json_extract(props, '$.from') IS NOT NULL"
            " AND json_extract(props, '$.to') IS NOT NULL"
            " GROUP BY src, dst ORDER BY n DESC LIMIT 10",
            (start,),
        ).fetchall()
        entry_types = _entry_types(conn, start)
        nav_clicks = _prop_group(conn, start, "nav_click", "json_extract(props, '$.area')", 8)
        footer_clicks = conn.execute(
            "SELECT json_extract(props, '$.target') AS k, COUNT(*) AS n FROM events"
            " WHERE kind = 'nav_click' AND ts >= ?"
            " AND json_extract(props, '$.area') = 'footer'"
            " AND json_extract(props, '$.target') IS NOT NULL"
            " GROUP BY k ORDER BY n DESC LIMIT 10",
            (start,),
        ).fetchall()
        themes = _prop_group(conn, start, "theme", "json_extract(props, '$.theme')", 8)
        fonts = _prop_group(conn, start, "font", "json_extract(props, '$.font')", 8)
        theme_total = _kind_count(conn, start, "theme")
        font_total = _kind_count(conn, start, "font")
        custom_themes = conn.execute(
            "SELECT COUNT(*) FROM events WHERE kind = 'theme' AND ts >= ?"
            " AND json_extract(props, '$.theme') = 'custom'", (start,)).fetchone()[0] or 0
        custom_fonts = conn.execute(
            "SELECT COUNT(*) FROM events WHERE kind = 'font' AND ts >= ?"
            " AND json_extract(props, '$.font') = 'custom'", (start,)).fetchone()[0] or 0
        depth = _depth_block(conn, start, len(_session_rows(conn, start)))
        banner = _banner_totals(conn, start)
        pinned = _banner_rows(conn, start)
        banner_by_panel = _prop_group(conn, start, "banner", "json_extract(props, '$.panel')", 6)
        banner_slots = _prop_group(conn, start, "banner", "json_extract(props, '$.slot')", 6)
        banner_by_device = _event_column_group(conn, start, "device", 5)
        banner_by_audience = _prop_group(conn, start, "banner", "json_extract(props, '$.audience')", 4)
        banner_status_rate = _banner_status_rate(conn, start)
        banner_toggle = conn.execute(
            "SELECT SUM(CASE WHEN json_extract(props, '$.banner_enabled') = 1 THEN 1 ELSE 0 END) AS on_,"
            " SUM(CASE WHEN json_extract(props, '$.banner_enabled') = 0 THEN 1 ELSE 0 END) AS off_"
            " FROM events WHERE kind = 'page_view' AND ts >= ?"
            " AND json_extract(props, '$.banner_enabled') IS NOT NULL",
            (start,),
        ).fetchone()
        pin_activity = conn.execute(
            "SELECT SUM(CASE WHEN json_extract(props, '$.action') = 'pin' THEN 1 ELSE 0 END) AS pinned,"
            " SUM(CASE WHEN json_extract(props, '$.action') = 'unpin' THEN 1 ELSE 0 END) AS unpinned"
            " FROM events WHERE kind = 'event' AND ts >= ?"
            " AND json_extract(props, '$.action') IN ('pin', 'unpin')",
            (start,),
        ).fetchone()
        description_links = _prop_group(conn, start, "link", "json_extract(props, '$.target')", 8)
        feed = conn.execute(
            "SELECT"
            " SUM(CASE WHEN json_extract(props, '$.action') = 'fetch' THEN 1 ELSE 0 END) AS fetches,"
            " SUM(CASE WHEN json_extract(props, '$.action') = 'changed' THEN 1 ELSE 0 END) AS changed,"
            " COUNT(DISTINCT CASE WHEN json_extract(props, '$.action') = 'fetch'"
            "                   THEN session_hash END) AS viewers"
            " FROM events WHERE kind = 'feed' AND ts >= ?",
            (start,),
        ).fetchone()
        feed_repeat = conn.execute(
            "SELECT COUNT(*) FROM (SELECT session_hash, COUNT(*) AS c FROM events"
            " WHERE kind = 'feed' AND ts >= ? AND session_hash IS NOT NULL"
            " GROUP BY session_hash) WHERE c > 1",
            (start,),
        ).fetchone()[0] or 0
        list_views = conn.execute(
            "SELECT COUNT(*) FROM requests WHERE ts >= ? AND route = '/api/events/public'",
            (start,),
        ).fetchone()[0] or 0
        list_series = _fill(conn.execute(
            "SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket, COUNT(*) AS n FROM requests"
            " WHERE ts >= ? AND route = '/api/events/public' GROUP BY bucket",
            (start, step, start),
        ).fetchall(), "n", points)
        event_views = _event_view_block(conn, start, points, step)
        # Only the events-list status tabs, not every nav click on the site.
        event_filters = conn.execute(
            "SELECT json_extract(props, '$.target') AS k, COUNT(*) AS n FROM events"
            " WHERE kind = 'nav_click' AND ts >= ?"
            " AND json_extract(props, '$.target') LIKE 'events-tab:%'"
            " GROUP BY k ORDER BY n DESC LIMIT 20",
            (start,),
        ).fetchall()
        admin_actions = conn.execute(
            "SELECT json_extract(props, '$.action') AS k, COUNT(*) AS n FROM events"
            " WHERE kind = 'event' AND ts >= ?"
            " AND json_extract(props, '$.action') IN ('create', 'edit', 'delete', 'status')"
            " GROUP BY k ORDER BY n DESC",
            (start,),
        ).fetchall()
        pin_actors = _pin_actors(conn, start)
    finally:
        conn.close()

    event_view_total = sum(item["views"] for item in event_views["list"])
    pin_total = (pin_activity["pinned"] or 0) + (pin_activity["unpinned"] or 0)

    def labelled(rows, title=False, prefix=None, strip=None):
        out = []
        for row in rows:
            label = str(row["k"] if row["k"] is not None else "")
            if prefix and not label.startswith(prefix):
                continue
            if strip:
                label = label[len(strip):]
            if title:
                label = label.replace("-", " ").title()
            out.append({"label": label, "value": row["n"]})
        return out

    return {
        "range": range_id,
        "generatedAt": _iso(now),
        "buckets": _buckets(start, step, points),
        "kpis": {
            "panelViews":    {"value": panel_views, "prev": 0, "series": panel_series},
            "panelSwitches": {"value": panel_switches, "prev": 0, "series": switch_series},
            "deepLinks":     {"value": sum(item["value"] for item in entry_types if item["label"] == "Deep link"),
                              "prev": 0, "series": [0] * points},
            "avgPanelTime":  {"value": depth["activeSeconds"], "prev": 0, "series": [0] * points},
            "impressions":   {"value": banner["impressions"], "prev": 0, "series": banner_series},
            "bannerCtr":     {"value": round(banner["clicks"] / banner["impressions"] * 100.0, 1) if banner["impressions"] else 0.0,
                              "prev": 0, "series": [0] * points},
            "collapseRate":  {"value": round(banner["collapses"] / banner["impressions"] * 100.0, 1) if banner["impressions"] else 0.0,
                              "prev": 0, "series": [0] * points},
            "bannerClicks":  {"value": banner["clicks"], "prev": 0, "series": [0] * points},
            "listViews":     {"value": list_views, "prev": 0, "series": list_series},
            "eventViews":    {"value": event_view_total, "prev": 0, "series": event_views["series"]},
            "eventPins":     {"value": pin_total, "prev": 0, "series": [0] * points},
        },
        "panels": [{
            "label": str(row["k"]).replace("-", " ").title(),
            "views": row["n"],
            "sessions": panel_sessions.get(row["k"], 0),
        } for row in panels],
        "panelSeries": panel_series,
        "flow": [{
            "from": str(row["src"]).replace("-", " ").title(),
            "to": str(row["dst"]).replace("-", " ").title(),
            "moves": row["n"],
        } for row in flow],
        "entryTypes": entry_types,
        "navClicks": labelled(nav_clicks, title=True),
        "footerClicks": labelled(footer_clicks),
        "themes": labelled(themes),
        "fonts": labelled(fonts),
        "appearance": {
            "themeSwitches": theme_total,
            "fontChanges": font_total,
            "customThemes": custom_themes,
            "customFonts": custom_fonts,
        },
        "depth": depth,
        "banner": banner,
        "pinned": pinned,
        "bannerByPanel": labelled(banner_by_panel, title=True),
        "bannerSlots": [{"label": "Slot %s" % row["k"], "value": row["n"]} for row in banner_slots],
        "bannerByDevice": [{"label": str(row["k"]).title(), "value": row["n"]}
                           for row in banner_by_device],
        "bannerByAudience": [
            {"label": "Guild only" if str(row["k"]) == "guild_only" else str(row["k"]).title(),
             "value": row["n"]} for row in banner_by_audience
        ],
        "bannerStatusRate": banner_status_rate,
        "bannerToggle": [
            {"label": "Banner on", "value": banner_toggle["on_"] or 0},
            {"label": "Banner off", "value": banner_toggle["off_"] or 0},
        ],
        "pinActivity": [
            {"label": "Pinned", "value": pin_activity["pinned"] or 0},
            {"label": "Unpinned", "value": pin_activity["unpinned"] or 0},
        ],
        "descriptionLinks": [{
            "label": _link_label(row["k"]), "value": row["n"]
        } for row in description_links],
        "bannerFetch": {
            "fetches": feed["fetches"] or 0,
            "changedEvents": feed["changed"] or 0,
            "uniqueViewers": feed["viewers"] or 0,
            "repeatViewers": feed_repeat,
        },
        "listViews": list_views,
        "eventSeries": event_views["series"],
        "eventReferrers": event_views["referrers"],
        "eventList": event_views["list"],
        "eventFilters": labelled(event_filters, strip="events-tab:", title=True),
        "pinActors": pin_actors,
        "adminActions": [{
            "label": "Event " + str(row["k"]), "value": row["n"]
        } for row in admin_actions],
        "bannerToView": event_views["latency"],
    }


def _link_label(target):
    """A short, readable form of a link target."""
    text = str(target or "")
    for prefix in ("https://", "http://"):
        if text.startswith(prefix):
            text = text[len(prefix):]
            break
    return text.rstrip("/")[:60] or "unknown"


_SHOP_ADMIN_LABELS = {
    "item_edited": "Item edited", "item_created": "Item created",
    "item_activated": "Item activated", "item_deactivated": "Item deactivated",
    "items_reordered": "Items reordered", "stock_updated": "Stock updated",
    "shop_enabled": "Shop enabled", "shop_disabled": "Shop disabled",
    "purchase_fulfilled": "Purchase fulfilled", "purchase_rejected": "Purchase rejected",
    "auction_started": "Auction started", "donation_confirmed": "Donation confirmed",
    "ep_adjusted": "EP adjusted",
}

_BOT_SERVICES = ("q-bot", "esi-bot", "esi-bot-trackers")


def _as_epoch(value):
    """Accept either an epoch number or an ISO string, return seconds or None."""
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


def _shop_rows(table, columns, time_column, start, end=None):
    """Rows from shop.db inside the window.

    Timestamps there are stored as ISO text, so they are parsed and compared in
    Python rather than guessed at in SQL.
    """
    if not os.path.isfile(_SHOP_DB):
        return []
    conn = None
    try:
        conn = sqlite3.connect("file:" + _SHOP_DB + "?mode=ro", uri=True, timeout=5)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT " + ", ".join(columns) + " FROM " + table
        ).fetchall()
    except sqlite3.Error:
        return []
    finally:
        if conn is not None:
            conn.close()
    out = []
    for row in rows:
        ts = _as_epoch(row[time_column])
        if ts is None or ts < start:
            continue
        if end is not None and ts >= end:
            continue
        entry = {key: row[key] for key in row.keys()}
        entry["_ts"] = ts
        out.append(entry)
    return out


def _request_count(conn, start, route):
    return conn.execute(
        "SELECT COUNT(*) FROM requests WHERE ts >= ? AND route = ?", (start, route)
    ).fetchone()[0] or 0


def _request_series(conn, start, step, points, route):
    return _fill(conn.execute(
        "SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket, COUNT(*) AS n FROM requests"
        " WHERE ts >= ? AND route = ? GROUP BY bucket",
        (start, step, start, route),
    ).fetchall(), "n", points)


def _maintenance_window(start, end):
    """Closed-shop windows from the admin log: a disable paired with the next enable."""
    events = _shop_rows(
        "shop_admin_log", ("action", "timestamp"), "timestamp", 0)
    events = [e for e in events if e["action"] in ("shop_disabled", "shop_enabled")]
    events.sort(key=lambda e: e["_ts"])
    windows = 0
    minutes = 0.0
    open_since = None
    for entry in events:
        if entry["action"] == "shop_disabled":
            if open_since is None:
                open_since = entry["_ts"]
                if start <= entry["_ts"] < end:
                    windows += 1
        elif open_since is not None:
            closed_from = max(open_since, start)
            closed_to = min(entry["_ts"], end)
            if closed_to > closed_from:
                minutes += (closed_to - closed_from) / 60.0
            open_since = None
    # Still closed at the end of the window.
    if open_since is not None and end > max(open_since, start):
        minutes += (end - max(open_since, start)) / 60.0
    return windows, round(minutes, 1)


def _player_lookups(conn, start, step, points):
    """Player lookups, read from the request log so the player name survives."""
    rows = conn.execute(
        "SELECT path, ts, cache, duration_ms FROM requests"
        " WHERE ts >= ? AND route = '/api/player/:name'",
        (start,),
    ).fetchall()
    per_player = {}
    series = [0] * points
    hits = 0
    misses = 0
    miss_durations = []
    for row in rows:
        name = (row["path"] or "").rsplit("/", 1)[-1]
        if name:
            per_player[name] = per_player.get(name, 0) + 1
        idx = int((row["ts"] - start) // step)
        if 0 <= idx < points:
            series[idx] += 1
        if row["cache"] == "HIT":
            hits += 1
        elif row["cache"] == "MISS":
            misses += 1
            if row["duration_ms"] is not None:
                miss_durations.append(row["duration_ms"])
    top = sorted(per_player.items(), key=lambda kv: -kv[1])[:6]
    total = hits + misses
    return {
        "total": len(rows),
        "unique": len(per_player),
        "series": series,
        "top": [{"label": name, "value": n} for name, n in top],
        "hitRate": round(hits / total * 100.0, 1) if total else 0.0,
        "missLatency": round(sum(miss_durations) / len(miss_durations), 1) if miss_durations else 0.0,
    }


def content(range_id):
    """Everything the Content panel renders, for one range."""
    points, step = range_spec(range_id)
    now = time.time()
    start = now - points * step

    conn = _connect()
    try:
        shop_views = conn.execute(
            "SELECT COUNT(*) FROM events WHERE kind = 'shop' AND ts >= ?"
            " AND json_extract(props, '$.action') = 'view'", (start,)).fetchone()[0] or 0
        shop_series = _fill(conn.execute(
            "SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket, COUNT(*) AS n FROM events"
            " WHERE kind = 'shop' AND ts >= ? AND json_extract(props, '$.action') = 'view'"
            " GROUP BY bucket", (start, step, start)).fetchall(), "n", points)
        product_views = conn.execute(
            "SELECT COUNT(*) FROM events WHERE kind = 'shop' AND ts >= ?"
            " AND json_extract(props, '$.action') = 'product_view'", (start,)).fetchone()[0] or 0
        per_item_views = {row["k"]: row["n"] for row in conn.execute(
            "SELECT json_extract(props, '$.item') AS k, COUNT(*) AS n FROM events"
            " WHERE kind = 'shop' AND ts >= ?"
            " AND json_extract(props, '$.action') = 'product_view'"
            " AND json_extract(props, '$.item') IS NOT NULL GROUP BY k", (start,))}
        cart_counts = {row["k"]: row["n"] for row in conn.execute(
            "SELECT json_extract(props, '$.action') AS k, COUNT(*) AS n FROM events"
            " WHERE kind = 'shop' AND ts >= ?"
            " AND json_extract(props, '$.action') IN ('cart_add', 'cart_remove', 'qty_change')"
            " GROUP BY k", (start,))}
        checkout_start = conn.execute(
            "SELECT COUNT(*) FROM events WHERE kind = 'shop' AND ts >= ?"
            " AND json_extract(props, '$.action') = 'checkout_start'", (start,)).fetchone()[0] or 0
        checkout_done = conn.execute(
            "SELECT COUNT(*) FROM events WHERE kind = 'shop' AND ts >= ?"
            " AND json_extract(props, '$.action') = 'checkout_done'", (start,)).fetchone()[0] or 0
        abandoned = conn.execute(
            "SELECT COUNT(*) FROM (SELECT session_hash FROM events WHERE kind = 'shop'"
            " AND ts >= ? AND session_hash IS NOT NULL"
            " AND json_extract(props, '$.action') = 'cart_add' GROUP BY session_hash)"
            " WHERE session_hash NOT IN (SELECT session_hash FROM events WHERE kind = 'shop'"
            " AND ts >= ? AND session_hash IS NOT NULL"
            " AND json_extract(props, '$.action') = 'checkout_done')",
            (start, start)).fetchone()[0] or 0
        shop_filters = _prop_group(conn, start, "shop", "json_extract(props, '$.filter')", 8)
        shop_searches = _prop_group(conn, start, "shop", "json_extract(props, '$.q')", 8)
        balance_lookups = conn.execute(
            "SELECT COUNT(*) FROM events WHERE kind = 'shop' AND ts >= ?"
            " AND json_extract(props, '$.action') = 'balance'", (start,)).fetchone()[0] or 0
        dm_cards = conn.execute(
            "SELECT COUNT(*) FROM events WHERE kind = 'shop' AND ts >= ?"
            " AND json_extract(props, '$.action') = 'dm_card'", (start,)).fetchone()[0] or 0
        maintenance_users = conn.execute(
            "SELECT COUNT(DISTINCT session_hash) FROM events WHERE kind = 'shop' AND ts >= ?"
            " AND json_extract(props, '$.action') = 'disabled_view'", (start,)).fetchone()[0] or 0
        lookups = _player_lookups(conn, start, step, points)
        searches = _prop_group(conn, start, "search", "json_extract(props, '$.q')", 8)
        graph_viewed = _prop_group(conn, start, "graph", "json_extract(props, '$.graph')", 8)
        graph_ranges = _prop_group(conn, start, "graph", "json_extract(props, '$.range')", 8)
        graph_hover = conn.execute(
            "SELECT COUNT(*) FROM events WHERE kind = 'graph' AND ts >= ?"
            " AND json_extract(props, '$.action') = 'hover'", (start,)).fetchone()[0] or 0
        feature_views = {row["k"]: row["n"] for row in conn.execute(
            "SELECT json_extract(props, '$.name') AS k, COUNT(*) AS n FROM events"
            " WHERE kind = 'feature' AND ts >= ? AND json_extract(props, '$.name') IS NOT NULL"
            " GROUP BY k", (start,))}
        downloads = _prop_group(conn, start, "download", "json_extract(props, '$.file')", 12)
        wynnpiece_links = _prop_group(conn, start, "link", "json_extract(props, '$.target')", 8)
        not_found = conn.execute(
            "SELECT COUNT(*) FROM requests WHERE ts >= ? AND status = 404", (start,)).fetchone()[0] or 0
        blocked_default = conn.execute(
            "SELECT COUNT(*) FROM requests WHERE ts >= ? AND status = 403", (start,)).fetchone()[0] or 0
        bot_panel_views = _request_count(conn, start, "/bot")
        inactivity_views = _request_count(conn, start, "/inactivity")
        promotion_views = _request_count(conn, start, "/promotions")
        creator_studio = _request_count(conn, start, "/shop/studio")
        guild_info = _request_count(conn, start, "/guild/info")
        wynnpiece_views = _request_count(conn, start, "/wynnpiece")
        auction_views = _request_count(conn, start, "/api/shop/auctions")
    finally:
        conn.close()

    purchases = _shop_rows("bin_purchases",
                           ("purchase_id", "item_id", "uuid", "ep_spent", "purchased_at"),
                           "purchased_at", start)
    purchases.sort(key=lambda row: -row["_ts"])
    bids = _shop_rows("bids", ("bid_id", "uuid", "amount", "placed_at"), "placed_at", start)
    admin_rows = _shop_rows("shop_admin_log", ("action", "actor", "timestamp"),
                            "timestamp", start)
    admin_counts = {}
    for row in admin_rows:
        key = row["action"] or "other"
        admin_counts[key] = admin_counts.get(key, 0) + 1
    admin_sorted = sorted(admin_counts.items(), key=lambda kv: -kv[1])[:8]
    windows, minutes = _maintenance_window(start, now)

    per_item_purchases = {}
    purchase_value = 0
    for row in purchases:
        item_id = row["item_id"] or ""
        per_item_purchases[item_id] = per_item_purchases.get(item_id, 0) + 1
        purchase_value += int(row["ep_spent"] or 0)

    item_ids = sorted(set(list(per_item_views) + list(per_item_purchases)),
                      key=lambda k: -(per_item_views.get(k, 0)))[:10]
    products = []
    for item_id in item_ids:
        views = per_item_views.get(item_id, 0)
        bought = per_item_purchases.get(item_id, 0)
        products.append({
            "item": item_id,
            "views": views,
            "purchases": bought,
            "conversion": round(bought / views * 100.0, 1) if views else 0.0,
        })

    bot_actions = {}
    for row in _audit_rows(start, now, ("start", "stop", "restart", "logs")):
        if str(row[6] or "") not in _BOT_SERVICES:
            continue
        key = str(row[3])
        bot_actions[key] = bot_actions.get(key, 0) + 1

    names = _event_names()
    cart_adds = cart_counts.get("cart_add", 0)
    cart_removes = cart_counts.get("cart_remove", 0)
    checkout_total = cart_adds + abandoned
    return {
        "range": range_id,
        "generatedAt": _iso(now),
        "buckets": _buckets(start, step, points),
        "kpis": {
            "shopViews":     {"value": shop_views, "prev": 0, "series": shop_series},
            "productViews":  {"value": product_views, "prev": 0, "series": [0] * points},
            "purchases":     {"value": len(purchases), "prev": 0, "series": [0] * points},
            "purchaseValue": {"value": purchase_value, "prev": 0, "series": [0] * points},
            "playerLookups": {"value": lookups["total"], "prev": 0, "series": lookups["series"]},
            "uniquePlayers": {"value": lookups["unique"], "prev": 0, "series": [0] * points},
            "cacheHitRate":  {"value": lookups["hitRate"], "prev": 0, "series": [0] * points},
            "cacheMissLatency": {"value": lookups["missLatency"], "prev": 0, "series": [0] * points},
            "botViews":      {"value": bot_panel_views, "prev": 0, "series": [0] * points},
            "inactivityViews": {"value": inactivity_views, "prev": 0, "series": [0] * points},
            "promotionViews": {"value": promotion_views, "prev": 0, "series": [0] * points},
            "guildInfoViews": {"value": guild_info, "prev": 0, "series": [0] * points},
            "fileDownloads": {"value": sum(row["n"] for row in downloads), "prev": 0,
                              "series": [0] * points},
            "gdprExports":   {"value": feature_views.get("gdpr-export", 0), "prev": 0,
                              "series": [0] * points},
            "wynnpieceViews": {"value": wynnpiece_views, "prev": 0, "series": [0] * points},
            "blockedDefault": {"value": blocked_default, "prev": 0, "series": [0] * points},
        },
        "shopViewSeries": shop_series,
        "cart": {
            "adds": cart_adds,
            "removes": cart_removes,
            "qtyChanges": cart_counts.get("qty_change", 0),
            "abandoned": abandoned,
            "abandonmentRate": round(abandoned / checkout_total * 100.0, 1) if checkout_total else 0.0,
        },
        "checkout": [
            {"label": "Checkout started", "value": checkout_start},
            {"label": "Checkout completed", "value": checkout_done},
        ],
        "checkoutDropoff": (round((checkout_start - checkout_done) / checkout_start * 100.0, 1)
                            if checkout_start else 0.0),
        "products": products,
        "shopFilters": [{"label": str(row["k"]), "value": row["n"]} for row in shop_filters],
        "shopSearches": [{"label": str(row["k"]), "value": row["n"]} for row in shop_searches],
        "purchasesTable": [{
            "item": names.get(row["item_id"] or "", row["item_id"] or ""),
            "buyer": row["uuid"] or "",
            "value": int(row["ep_spent"] or 0),
            "at": _iso(row["_ts"]),
        } for row in purchases[:8]],
        "balanceLookups": balance_lookups,
        "auctions": {"views": auction_views, "bids": len(bids)},
        "dmCards": {"generated": dm_cards},
        "shopAdmin": [{
            "label": _SHOP_ADMIN_LABELS.get(key, key.replace("_", " ").title()),
            "value": value,
        } for key, value in admin_sorted],
        "maintenance": {"users": maintenance_users, "windows": windows, "minutes": minutes},
        "lookupSeries": lookups["series"],
        "mostViewedPlayers": lookups["top"],
        "topSearches": [{"label": str(row["k"]), "value": row["n"]} for row in searches],
        "graphInteractions": {
            "viewed": [{"label": str(row["k"]).replace("-", " ").title(), "value": row["n"]}
                       for row in graph_viewed],
            "ranges": [{"label": str(row["k"]), "value": row["n"]} for row in graph_ranges],
            "hover": graph_hover,
        },
        "lookupCache": {
            "hitRate": lookups["hitRate"],
            "prevHitRate": lookups["hitRate"],
            "missLatency": lookups["missLatency"],
        },
        "bot": {
            "panelViews": bot_panel_views,
            "logTailViews": bot_actions.get("logs", 0),
            "restartActions": bot_actions.get("restart", 0),
            "sessionStarts": bot_actions.get("start", 0),
            "sessionStops": bot_actions.get("stop", 0),
        },
        "inactivity": {"views": inactivity_views},
        "promotions": {
            "pageViews": promotion_views,
            "memberListViews": feature_views.get("promotions-members", 0),
            "detailOpens": feature_views.get("promotion-member", 0),
        },
        "creatorStudio": creator_studio,
        "guildInfo": {"threadViews": guild_info},
        "uploads": [{"file": str(row["k"]), "downloads": row["n"]} for row in downloads],
        "gdpr": {"generated": feature_views.get("gdpr-export", 0)},
        "notFoundViews": not_found,
        "wynnpiece": {
            "pageViews": wynnpiece_views,
            "customLinks": [{"label": _link_label(row["k"]), "value": row["n"]}
                            for row in wynnpiece_links],
            "blockedDefault": [],
        },
    }


_BAN_RULES = (
    ("WordPress probe", "WordPress probe"),
    ("Scanner probe", "Scanner probe"),
    ("Injection payload", "Injection payload"),
    ("Banned method", "Banned method"),
    ("Malformed HTTP", "Malformed HTTP"),
    ("Non-human pattern", "HTTP/1.0 fingerprint"),
    ("Debugger probe", "Debugger probe"),
)

_BRUTE_FORCE_MIN = 3


def _ban_rule(reason):
    text = str(reason or "")
    for marker, label in _BAN_RULES:
        if text.startswith(marker):
            return label
    if text.startswith("Manually blacklisted"):
        return "Manual"
    return "Other"


def _bans(start, end):
    """Blacklist entries in range, grouped by rule, plus the malformed split."""
    conn = _open_readonly(_BANS_DB)
    if conn is None:
        return [], 0, 0
    try:
        rows = conn.execute("SELECT reason, added_at FROM blacklist").fetchall()
    except sqlite3.Error:
        return [], 0, 0
    finally:
        conn.close()
    counts = {}
    bad_request = 0
    version_not_supported = 0
    for reason, added_at in rows:
        ts = _as_epoch(added_at)
        if ts is None or ts < start or ts >= end:
            continue
        counts[_ban_rule(reason)] = counts.get(_ban_rule(reason), 0) + 1
        if str(reason or "").startswith("Malformed HTTP"):
            if "505" in str(reason):
                version_not_supported += 1
            else:
                bad_request += 1
    grouped = sorted(counts.items(), key=lambda kv: -kv[1])
    return grouped, bad_request, version_not_supported


def _anomalies(series, labels):
    """Buckets that sit two or more standard deviations from the range mean."""
    if not series:
        return []
    mean = sum(series) / len(series)
    variance = sum((v - mean) ** 2 for v in series) / len(series)
    stdev = variance ** 0.5
    if stdev <= 0:
        return []
    out = []
    for i, value in enumerate(series):
        z = round((value - mean) / stdev, 1)
        out.append({
            "bucket": labels[i] if i < len(labels) else str(i),
            "requests": value,
            "baseline": int(round(mean)),
            "z": z,
        })
    return out


def health(range_id):
    """Everything the Health panel renders, for one range."""
    points, step = range_spec(range_id)
    now = time.time()
    start = now - points * step

    conn = _connect()
    try:
        client_counts = {row["k"]: row["n"] for row in conn.execute(
            "SELECT kind AS k, COUNT(*) AS n FROM client_errors WHERE ts >= ? GROUP BY kind",
            (start,))}
        error_series = _fill(conn.execute(
            "SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket, COUNT(*) AS n FROM client_errors"
            " WHERE ts >= ? AND kind = 'error' GROUP BY bucket",
            (start, step, start)).fetchall(), "n", points)
        js_errors = [{
            "message": (row["message"] or "")[:200],
            "file": row["source"] or "",
            "line": row["line"] or 0,
            "build": row["build"] or "",
            "count": row["n"],
        } for row in conn.execute(
            "SELECT message, source, line, build, COUNT(*) AS n FROM client_errors"
            " WHERE ts >= ? AND kind = 'error'"
            " GROUP BY message, source, line, build ORDER BY n DESC LIMIT 12", (start,))]
        rejection_list = [{"label": (row["message"] or "(no message)")[:80], "value": row["n"]}
                          for row in conn.execute(
            "SELECT message, COUNT(*) AS n FROM client_errors WHERE ts >= ? AND kind = 'rejection'"
            " GROUP BY message ORDER BY n DESC LIMIT 8", (start,))]
        broken_assets = [{"label": row["source"] or "(unknown)", "value": row["n"]}
                         for row in conn.execute(
            "SELECT source, COUNT(*) AS n FROM client_errors"
            " WHERE ts >= ? AND kind = 'broken_asset' GROUP BY source ORDER BY n DESC LIMIT 8",
            (start,))]
        net = {row["k"]: row["n"] for row in conn.execute(
            "SELECT json_extract(props, '$.action') AS k, COUNT(*) AS n FROM events"
            " WHERE kind = 'net' AND ts >= ? GROUP BY k", (start,))}
        failed_requests = [{
            "url": row["url"] or "",
            "status": str(row["status"] or 0),
            "duration": round(row["ms"] or 0, 1),
            "count": row["n"],
        } for row in conn.execute(
            "SELECT json_extract(props, '$.url') AS url, json_extract(props, '$.status') AS status,"
            " AVG(CAST(json_extract(props, '$.ms') AS REAL)) AS ms, COUNT(*) AS n"
            " FROM events WHERE kind = 'net' AND ts >= ?"
            " AND json_extract(props, '$.action') = 'failed'"
            " GROUP BY url, status ORDER BY n DESC LIMIT 12", (start,))]
        gave_up = [{"label": row["k"] or "(unknown)", "value": row["n"]} for row in conn.execute(
            "SELECT json_extract(props, '$.url') AS k, COUNT(*) AS n FROM events"
            " WHERE kind = 'net' AND ts >= ?"
            " AND json_extract(props, '$.action') = 'gave_up'"
            " GROUP BY k ORDER BY n DESC LIMIT 8", (start,))]
        toasts_shown = _kind_count(conn, start, "toast")
        toast_top = _prop_group(conn, start, "toast", "json_extract(props, '$.label')", 8)
        builds = _prop_group(conn, start, "page_view", "json_extract(props, '$.build')", 8)
        build_sessions = {row["k"]: row["n"] for row in conn.execute(
            "SELECT json_extract(props, '$.build') AS k, COUNT(DISTINCT session_hash) AS n"
            " FROM events WHERE kind = 'page_view' AND ts >= ?"
            " AND json_extract(props, '$.build') IS NOT NULL GROUP BY k", (start,))}
        build_errors = {row["k"]: row["n"] for row in conn.execute(
            "SELECT build AS k, COUNT(*) AS n FROM client_errors"
            " WHERE ts >= ? AND kind = 'error' AND build IS NOT NULL GROUP BY k", (start,))}
        build_failures = {row["k"]: row["n"] for row in conn.execute(
            "SELECT json_extract(props, '$.build') AS k, COUNT(*) AS n FROM events"
            " WHERE kind = 'net' AND ts >= ? AND json_extract(props, '$.action') = 'failed'"
            " AND json_extract(props, '$.build') IS NOT NULL GROUP BY k", (start,))}
        blocked_reasons = [{"label": row["k"] or "unspecified", "value": row["n"]}
                           for row in conn.execute(
            "SELECT COALESCE(block_reason, 'unspecified') AS k, COUNT(*) AS n FROM requests"
            " WHERE ts >= ? AND blocked = 1 GROUP BY k ORDER BY n DESC LIMIT 8", (start,))]
        blocked_series = _fill(conn.execute(
            "SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket, COUNT(*) AS n FROM requests"
            " WHERE ts >= ? AND blocked = 1 GROUP BY bucket",
            (start, step, start)).fetchall(), "n", points)
        rate_limited = conn.execute(
            "SELECT COUNT(*) FROM requests WHERE ts >= ? AND status = 429", (start,)).fetchone()[0] or 0
        offending_paths = [{"label": row["k"] or "(unknown)", "value": row["n"]}
                           for row in conn.execute(
            "SELECT route AS k, COUNT(*) AS n FROM requests"
            " WHERE ts >= ? AND status = 403 AND route IS NOT NULL"
            " GROUP BY k ORDER BY n DESC LIMIT 8", (start,))]
        offending_agents = [{"label": row["k"] or "(unknown)", "value": row["n"]}
                            for row in conn.execute(
            "SELECT ua_class AS k, COUNT(*) AS n FROM requests"
            " WHERE ts >= ? AND status = 403 AND ua_class IS NOT NULL"
            " GROUP BY k ORDER BY n DESC LIMIT 8", (start,))]
        not_found_paths = [{"label": row["k"] or "(unknown)", "value": row["n"]}
                           for row in conn.execute(
            "SELECT route AS k, COUNT(*) AS n FROM requests"
            " WHERE ts >= ? AND status = 404 AND route IS NOT NULL"
            " GROUP BY k ORDER BY n DESC LIMIT 8", (start,))]
        not_found = conn.execute(
            "SELECT COUNT(*) FROM requests WHERE ts >= ? AND status = 404", (start,)).fetchone()[0] or 0
        cf_skips = conn.execute(
            "SELECT COUNT(*) FROM events WHERE kind = 'feature' AND ts >= ?"
            " AND json_extract(props, '$.name') = 'cf-skip'", (start,)).fetchone()[0] or 0
        feature_views = {row["k"]: row["n"] for row in conn.execute(
            "SELECT json_extract(props, '$.name') AS k, COUNT(*) AS n FROM events"
            " WHERE kind = 'feature' AND ts >= ? AND json_extract(props, '$.name') IS NOT NULL"
            " GROUP BY k", (start,))}
        request_series = _fill(conn.execute(
            "SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket, COUNT(*) AS n FROM requests"
            " WHERE ts >= ? GROUP BY bucket", (start, step, start)).fetchall(), "n", points)
    finally:
        conn.close()

    ban_rows, bad_request, version_not_supported = _bans(start, now)
    bans_issued = sum(value for _, value in ban_rows)

    # Brute force: an address that failed the login several times.
    failed_logins = {}
    for row in _audit_rows(start, now, ("login_failed",)):
        ip = str(row[7] or "")
        if ip:
            failed_logins[ip] = failed_logins.get(ip, 0) + 1
    brute_force = sum(1 for count in failed_logins.values() if count >= _BRUTE_FORCE_MIN)

    build_rows = []
    for row in builds:
        build = str(row["k"] or "")
        sessions = build_sessions.get(row["k"], 0)
        js = build_errors.get(row["k"], 0)
        failed = build_failures.get(row["k"], 0)
        build_rows.append({
            "build": build,
            "sessions": sessions,
            "jsErrors": js,
            "failedRequests": failed,
            "perSession": round((js + failed) / sessions, 2) if sessions else 0.0,
        })

    labels = [str(int(bucket)) for bucket in _buckets(start, step, points)]
    anomalies = _anomalies(request_series, labels)

    return {
        "range": range_id,
        "generatedAt": _iso(now),
        "buckets": _buckets(start, step, points),
        "kpis": {
            "jsErrors":       {"value": client_counts.get("error", 0), "prev": 0, "series": error_series},
            "rejections":     {"value": client_counts.get("rejection", 0), "prev": 0,
                               "series": [0] * points},
            "failedRequests": {"value": net.get("failed", 0), "prev": 0, "series": [0] * points},
            "notFoundViews":  {"value": not_found, "prev": 0, "series": [0] * points},
            "brokenAssets":   {"value": client_counts.get("broken_asset", 0), "prev": 0,
                               "series": [0] * points},
            "retries":        {"value": net.get("retry", 0), "prev": 0, "series": [0] * points},
            "gaveUp":         {"value": net.get("gave_up", 0), "prev": 0, "series": [0] * points},
            "blocked":        {"value": sum(row["value"] for row in blocked_reasons), "prev": 0,
                               "series": blocked_series},
            "bansIssued":     {"value": bans_issued, "prev": 0, "series": [0] * points},
            "rateLimited":    {"value": rate_limited, "prev": 0, "series": [0] * points},
            "bruteForce":     {"value": brute_force, "prev": 0, "series": [0] * points},
        },
        "errorSeries": error_series,
        "jsErrorList": js_errors,
        "rejectionList": rejection_list,
        "failedRequestList": failed_requests,
        "toasts": {
            "apiErrors": net.get("failed", 0),
            "toastsShown": toasts_shown,
            "top": [{"label": str(row["k"]), "value": row["n"]} for row in toast_top],
        },
        "notFoundPaths": not_found_paths,
        "brokenAssets": broken_assets,
        "gaveUp": gave_up,
        "retries": net.get("retry", 0),
        "builds": [{"label": str(row["k"]), "value": row["n"]} for row in builds],
        "errorsByBuild": build_rows,
        "blockedSeries": blocked_series,
        "blockedReasons": blocked_reasons,
        "banTriggers": [{"label": label, "value": value} for label, value in ban_rows],
        "bannedStillHitting": {"ips": 0, "requests": 0, "top": []},
        "cfSkips": cf_skips,
        "malformed": {
            "total": bad_request + version_not_supported,
            "badRequest": bad_request,
            "versionNotSupported": version_not_supported,
        },
        "offendingPaths": offending_paths,
        "offendingAgents": offending_agents,
        "offendingAsns": [],
        "anomalies": anomalies,
        "flaggedAnomalies": [a for a in anomalies if abs(a["z"]) >= 2],
    }


# Action kinds that count as "took an action" in the funnel.
_ACTION_KINDS = ("shop", "event", "download", "search", "lookup", "link", "feature")

_COHORT_WEEKS = 6


def _cohorts(conn, start, now):
    """Member retention by first-seen week.

    Uses `user_id`, which is the only identifier stable across days - the
    visitor hash is salted per day, so it cannot link anyone across a week by
    design. Anonymous visitors are therefore not part of these cohorts.
    """
    days = {}
    for row in conn.execute(
            "SELECT user_id, CAST(ts / 86400 AS INTEGER) AS day FROM events"
            " WHERE ts >= ? AND user_id IS NOT NULL GROUP BY user_id, day",
            (start,)):
        days.setdefault(str(row[0]), set()).add(int(row[1]))
    if not days:
        return [], {"day1": 0.0, "day7": 0.0, "day30": 0.0}

    # Group members by the Monday of the week they were first seen.
    buckets = {}
    for user, seen in days.items():
        first = min(seen)
        weekday = datetime.fromtimestamp(first * 86400, timezone.utc).weekday()
        week_start = first - weekday
        buckets.setdefault(week_start, []).append(seen)

    ordered = sorted(buckets.items(), key=lambda kv: kv[0])[-_COHORT_WEEKS:]
    cohorts = []
    totals = {"day1": [0, 0], "day7": [0, 0], "day30": [0, 0]}
    for week_start, members in ordered:
        users = len(members)
        counts = {"day1": 0, "day7": 0, "day30": 0}
        for seen in members:
            first = min(seen)
            if first + 1 in seen:
                counts["day1"] += 1
            if any(d in seen for d in range(first + 1, first + 8)):
                counts["day7"] += 1
            if any(d in seen for d in range(first + 1, first + 31)):
                counts["day30"] += 1
        cohorts.append({
            "cohort": datetime.fromtimestamp(week_start * 86400, timezone.utc).strftime("%d %b"),
            "users": users,
            "day1": round(counts["day1"] / users * 100.0, 1) if users else 0.0,
            "day7": round(counts["day7"] / users * 100.0, 1) if users else 0.0,
            "day30": round(counts["day30"] / users * 100.0, 1) if users else 0.0,
        })
        for key in totals:
            totals[key][0] += counts[key]
            totals[key][1] += users
    overall = {
        key: round(value[0] / value[1] * 100.0, 1) if value[1] else 0.0
        for key, value in totals.items()
    }
    return cohorts, overall


def rollups(range_id):
    """Everything the Data panel renders, for one range."""
    points, step = range_spec(range_id)
    now = time.time()
    start = now - points * step

    conn = _connect()
    try:
        dau_series = _fill(conn.execute(
            "SELECT CAST((ts - ?) / ? AS INTEGER) AS bucket,"
            " COUNT(DISTINCT user_id) AS n FROM events"
            " WHERE ts >= ? AND user_id IS NOT NULL GROUP BY bucket",
            (start, step, start)).fetchall(), "n", points)

        def active_members(window):
            return conn.execute(
                "SELECT COUNT(DISTINCT user_id) FROM events"
                " WHERE ts >= ? AND user_id IS NOT NULL", (now - window,)).fetchone()[0] or 0

        dau = active_members(86400)
        wau = active_members(7 * 86400)
        mau = active_members(30 * 86400)
        peak = conn.execute(
            "SELECT CAST(strftime('%H', ts, 'unixepoch') AS INTEGER) AS hour, COUNT(*) AS n"
            " FROM requests WHERE ts >= ? GROUP BY hour ORDER BY n DESC LIMIT 6",
            (start,)).fetchall()
        panels = _prop_group(conn, start, "panel_view", "json_extract(props, '$.panel')", 30)
        cohorts, retention = _cohorts(conn, start, now)

        logged_in_sessions = conn.execute(
            "SELECT COUNT(DISTINCT session_hash) FROM events"
            " WHERE ts >= ? AND user_id IS NOT NULL AND session_hash IS NOT NULL",
            (start,)).fetchone()[0] or 0
        panel_sessions = {row["k"]: row["n"] for row in conn.execute(
            "SELECT json_extract(props, '$.panel') AS k, COUNT(DISTINCT session_hash) AS n"
            " FROM events WHERE kind = 'panel_view' AND ts >= ?"
            " AND json_extract(props, '$.panel') IS NOT NULL GROUP BY k", (start,))}

        visits = conn.execute(
            "SELECT COUNT(DISTINCT session_hash) FROM requests"
            " WHERE ts >= ? AND session_hash IS NOT NULL", (start,)).fetchone()[0] or 0
        opened = conn.execute(
            "SELECT COUNT(DISTINCT session_hash) FROM events WHERE kind = 'panel_view'"
            " AND ts >= ? AND session_hash IS NOT NULL", (start,)).fetchone()[0] or 0
        marks = ",".join("?" * len(_ACTION_KINDS))
        acted = conn.execute(
            "SELECT COUNT(DISTINCT session_hash) FROM events WHERE ts >= ?"
            " AND session_hash IS NOT NULL AND kind IN (" + marks + ")",
            tuple([start] + list(_ACTION_KINDS))).fetchone()[0] or 0
    finally:
        conn.close()

    def feature(row):
        return {
            "label": str(row["k"] or "").replace("-", " ").title(),
            "value": row["n"],
        }

    ordered = [feature(row) for row in panels]
    conversion = [
        {"step": "Visit", "value": visits},
        {"step": "Login", "value": logged_in_sessions},
        {"step": "Open a panel", "value": opened},
        {"step": "Take an action", "value": acted},
    ]
    rates = []
    for i in range(1, len(conversion)):
        previous = conversion[i - 1]["value"]
        rates.append({
            "step": conversion[i - 1]["step"] + " \u2192 " + conversion[i]["step"],
            "rate": round(conversion[i]["value"] / previous * 100.0, 1) if previous else 0.0,
        })

    return {
        "range": range_id,
        "generatedAt": _iso(now),
        "buckets": _buckets(start, step, points),
        "kpis": {
            "dau":   {"value": dau, "prev": 0, "series": dau_series},
            "wau":   {"value": wau, "prev": 0, "series": [0] * points},
            "mau":   {"value": mau, "prev": 0, "series": [0] * points},
            "day1":  {"value": retention["day1"], "prev": 0, "series": [0] * points},
            "day7":  {"value": retention["day7"], "prev": 0, "series": [0] * points},
            "day30": {"value": retention["day30"], "prev": 0, "series": [0] * points},
        },
        "activeSeries": dau_series,
        "peakHours": [{"label": "%02d:00" % int(row["hour"]), "value": row["n"]}
                      for row in peak if row["hour"] is not None],
        "mostUsed": ordered[:6],
        "leastUsed": list(reversed(ordered[-6:])) if len(ordered) > 6 else [],
        "retention": retention,
        "cohorts": cohorts,
        "adoption": [{
            "panel": str(row["k"]).replace("-", " ").title(),
            "sessions": logged_in_sessions,
            "adopted": panel_sessions.get(row["k"], 0),
            "rate": (round(panel_sessions.get(row["k"], 0) / logged_in_sessions * 100.0, 1)
                     if logged_in_sessions else 0.0),
        } for row in panels],
        "conversion": conversion,
        "conversionRates": rates,
    }


def overview(range_id):
    """Everything the Overview panel renders, for one range."""
    points, step = range_spec(range_id)
    now = time.time()
    start = now - points * step
    previous_start = start - points * step

    conn = _connect()
    try:
        series = _series_rows(conn, start, step)
        latency = _latency_rows(conn, start, step)
        visitors_series = _unique_series(conn, start, step)
        client_errors = _client_error_rows(conn, start)
        current = _window_summary(conn, start, now)
        previous = _window_summary(conn, previous_start, start)
        client_error_total = _client_error_rows(conn, start, now)
        client_error_previous = _client_error_rows(conn, previous_start, start)
        paths = _top_paths(conn, start, limit=12)
        sources = _event_group(conn, start, "page_view", "source", 8)
        panels = _event_group(conn, start, "panel_view", "json_extract(props, '$.panel')", 12)
        devices = _event_group(conn, start, "page_view", "device", 5)
        banner_rows = _banner_rows(conn, start)
        peak = _peak_hours(conn, start)
        error_rows = _error_rows(conn, start)
        by_rule = conn.execute(
            "SELECT COALESCE(block_reason, 'unspecified') AS k, COUNT(*) AS n"
            " FROM requests WHERE ts >= ? AND blocked = 1 GROUP BY k ORDER BY n DESC LIMIT 8",
            (start,),
        ).fetchall()
        region_split, region_table, region_count = _regions(conn, start)
        server_error_series = _fill(series, "server_errors", points)
        banner_ctr = _banner_ctr(conn, start, now)
        banner_ctr_previous = _banner_ctr(conn, previous_start, start)
        banner_ctr_series = _banner_ctr_series(conn, start, step, points)
    finally:
        conn.close()

    logins, logins_previous, login_series = _login_stats(
        start, now, previous_start, start, points, step)

    def series_of(key):
        return _fill(series, key, points)

    requests_series = series_of("requests")
    visitors_series = _fill(visitors_series, "visitors", points)
    blocked_series = series_of("blocked")
    p95_series = _fill(latency, "p95", points)

    errors_series = [0] * points
    for row in client_errors:
        idx = int(row["bucket"])
        if 0 <= idx < points:
            errors_series[idx] += row["n"] or 0
    errors_series = [server_error_series[i] + errors_series[i] for i in range(points)]

    total_errors = current["serverErrors"] + client_error_total
    previous_errors = previous["serverErrors"] + client_error_previous

    def rate(numerator, denominator):
        return (numerator / denominator * 100.0) if denominator else 0.0

    live_data = live()
    return {
        "range": range_id,
        "generatedAt": _iso(now),
        "buckets": _buckets(start, step, points),
        "traffic": {
            "requests": requests_series,
            "visitors": visitors_series,
            "errors": errors_series,
            "p95": p95_series,
            "blocked": blocked_series,
        },
        "kpis": {
            "requests":  {"value": current["requests"], "prev": previous["requests"], "series": requests_series},
            "visitors":  {"value": current["visitors"], "prev": previous["visitors"], "series": visitors_series},
            "activeNow": {"value": live_data["sessions"], "prev": None, "series": visitors_series},
            "logins":    {"value": logins, "prev": logins_previous, "series": login_series},
            "errorRate": {"value": rate(total_errors, current["requests"]),
                          "prev": rate(previous_errors, previous["requests"]),
                          "series": [rate(errors_series[i], requests_series[i]) for i in range(points)]},
            "p95":       {"value": current["p95"], "prev": previous["p95"], "series": p95_series},
            "bannerCtr": {"value": banner_ctr, "prev": banner_ctr_previous, "series": banner_ctr_series},
            "blocked":   {"value": current["blocked"], "prev": previous["blocked"], "series": blocked_series},
        },
        "live": live_data,
        "topPaths": [
            {"path": p["path"], "views": p["requests"], "unique": p["unique"],
             "avgMs": p["avgMs"], "status": p["status"]}
            for p in paths
        ],
        "sources": [
            {"label": _SOURCE_LABELS.get(row["k"], str(row["k"]).title()), "value": row["n"]}
            for row in sources
        ],
        "panels": [
            {"label": str(row["k"]).replace("-", " ").title(), "views": row["n"]}
            for row in panels
        ],
        "pinned": banner_rows,
        "devices": [
            {"label": str(row["k"]).title(), "value": row["n"]} for row in devices
        ],
        "regions": [
            {"label": row["region"], "value": row["sessions"]} for row in region_table
        ],
        "peakHours": peak,
        "errors": {"total": total_errors, "top": error_rows},
        "security": {
            "blocked": current["blocked"],
            "banned": _banned_count(start),
            "rateLimited": current["rateLimited"],
            "topRule": (by_rule[0]["k"] if by_rule else "\u2014"),
            "byRule": [{"label": row["k"], "count": row["n"]} for row in by_rule],
        },
    }
