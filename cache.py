"""
cache.py — Cache computation service.
Runs on port 5002. Periodically computes bulk playtime / metrics
and exposes the results via HTTP for the routes service.

    python cache.py
"""

import os
import threading
import sqlite3 as _sqlite3
from time import time, sleep
from flask import Flask, jsonify

from config import (
    _BASE_DIR, _ESI_BOT_DIR, _API_TRACKING_DIR, _UPLOAD_DIR,
    _safe_number, _is_player_api_off, _is_reactivation_spike,
    _get_latest_api_db, RESET_SPIKE_MIN_BY_METRIC,
    BULK_PLAYTIME_REFRESH, CACHE_PORT,
)

app = Flask(__name__)

# in-process cache

_bulk_playtime_cache = {"data": None, "debug": None, "ts": 0}
_bulk_playtime_lock  = threading.Lock()


# bulk computation (transplanted verbatim from server.py)

def _compute_bulk_playtime():
    """Crunches playtime + stat deltas for every guild member and caches the result."""
    from datetime import datetime as _dt
    from datetime import timedelta as _td
    from concurrent.futures import ThreadPoolExecutor

    _latest_db = _get_latest_api_db()
    if not _latest_db:
        _bulk_playtime_cache["data"] = {
            "members": {},
            "guild": {"dates": [], "metricDates": [], "playerCount": [],
                      "wars": [], "guildRaids": [], "newMembers": []},
        }
        _bulk_playtime_cache["ts"] = time()
        return

    conn = _sqlite3.connect(_latest_db)
    usernames = [
        row[0] for row in conn.execute(
            "SELECT username FROM player_stats WHERE UPPER(guild_prefix) = 'ESI' ORDER BY username"
        ).fetchall()
    ]
    conn.close()

    if not usernames:
        _bulk_playtime_cache["data"] = {
            "members": {},
            "guild": {"dates": [], "metricDates": [], "playerCount": [],
                      "wars": [], "guildRaids": [], "newMembers": []},
        }
        _bulk_playtime_cache["ts"] = time()
        return

    # playtime tracking
    tracking_folder = os.path.join(_ESI_BOT_DIR, "databases", "playtime_tracking")
    all_snapshots = []
    if os.path.isdir(tracking_folder):
        for day_folder_name in os.listdir(tracking_folder):
            if not day_folder_name.startswith("playtime_"):
                continue
            day_folder_path = os.path.join(tracking_folder, day_folder_name)
            if not os.path.isdir(day_folder_path):
                continue
            date_str = day_folder_name.replace("playtime_", "")
            try:
                day_dt = _dt.strptime(date_str, "%d-%m-%Y")
            except ValueError:
                continue
            for fname in os.listdir(day_folder_path):
                if not fname.endswith(".db"):
                    continue
                all_snapshots.append((day_dt, fname, os.path.join(day_folder_path, fname)))

    dates = []
    all_results = []
    if all_snapshots:
        all_snapshots.sort(key=lambda x: (x[0], x[1]))

        day_groups = {}
        for day_dt, fname, db_path in all_snapshots:
            day_key = day_dt.date()
            day_groups.setdefault(day_key, []).append((fname, db_path))

        sorted_days = sorted(day_groups.keys())[-60:]
        # Newest snapshot first, then earlier ones as fallbacks within the same day.
        daily_candidates = [
            [p for _f, p in reversed(day_groups[d])]
            for d in sorted_days
        ]
        daily_paths = [paths[0] for paths in daily_candidates]
        username_set = {u.lower() for u in usernames}

        def read_all_hours(db_path):
            try:
                c = _sqlite3.connect(db_path, check_same_thread=False)
                rows = c.execute(
                    "SELECT username, playtime_seconds FROM playtime"
                ).fetchall()
                c.close()
                return {
                    row[0].lower(): round(row[1] / 3600, 1)
                    for row in rows if row[0].lower() in username_set
                }
            except Exception:
                return {}

        def read_day(candidate_paths):
            """Try newest snapshot; if it looks mid-write (empty/unreadable), wait 1s
            and retry once, then fall back to earlier snapshots of the same day."""
            if not candidate_paths:
                return {}
            newest = candidate_paths[0]
            result = read_all_hours(newest)
            if result:
                return result
            # Newest file may be mid-write - wait briefly and try again.
            sleep(1)
            result = read_all_hours(newest)
            if result:
                return result
            # Still nothing - fall back to earlier snapshots for this same day.
            for path in candidate_paths[1:]:
                result = read_all_hours(path)
                if result:
                    return result
            return {}

        with ThreadPoolExecutor(max_workers=8) as ex:
            all_results = list(zip(daily_paths, ex.map(read_day, daily_candidates)))

        dates = [d.isoformat() for d in sorted_days]

    members = {}
    for username in usernames:
        ulow = username.lower()
        data = [result.get(ulow, 0.0) for _, result in all_results]
        members[ulow] = {"username": username, "data": data, "dates": dates}

    # stat deltas from api_tracking snapshots
    _STAT_COLS = [
        ("wars",             "wars"),
        ("mobs_killed",      "mobsKilled"),
        ("chests_found",     "chestsFound"),
        ("total_level",      "totalLevel"),
        ("completed_quests", "questsDone"),
        ("dungeons_total",   "dungeons"),
        ("raids_total",      "raids"),
        ("world_events",     "worldEvents"),
        ("caves",            "caves"),
    ]
    api_folder = os.path.join(_ESI_BOT_DIR, "databases", "api_tracking")
    api_snapshots = []
    metric_dates = []
    debug_members = {}
    invalid_transitions = set()
    api_days = []
    if os.path.isdir(api_folder):
        for name in os.listdir(api_folder):
            if not name.startswith("api_"):
                continue
            path = os.path.join(api_folder, name)
            if not os.path.isdir(path):
                continue
            try:
                day_dt = _dt.strptime(name[4:], "%d-%m-%Y")
            except ValueError:
                continue
            files = sorted(f for f in os.listdir(path) if f.endswith(".db"))
            if files:
                api_days.append((day_dt, os.path.join(path, files[-1])))

        api_days.sort(key=lambda x: x[0])
        api_days = api_days[-61:]
        metric_dates = [day_dt.date().isoformat() for day_dt, _ in api_days[1:]]

        cols_sql = ", ".join(c[0] for c in _STAT_COLS)
        metric_keys = [c[1] for c in _STAT_COLS] + ["guildRaids"]

        def read_api_day(db_path):
            try:
                c = _sqlite3.connect(db_path, check_same_thread=False)
                stats = {}
                for row in c.execute(
                    f"SELECT username, guild_prefix, {cols_sql} FROM player_stats"
                    " WHERE UPPER(guild_prefix) = 'ESI'"
                ).fetchall():
                    ulow = row[0].lower()
                    entry = {"guildPrefix": (row[1] or "").upper()}
                    for i in range(len(_STAT_COLS)):
                        entry[_STAT_COLS[i][1]] = row[i + 2] or 0
                    stats[ulow] = entry
                try:
                    for row in c.execute(
                        "SELECT username, total_graids FROM guild_raid_stats"
                    ).fetchall():
                        ulow = row[0].lower()
                        if ulow not in stats:
                            stats[ulow] = {"guildPrefix": ""}
                        stats[ulow]["guildRaids"] = row[1] or 0
                except Exception:
                    pass
                c.close()
                return stats
            except Exception:
                return {}

        with ThreadPoolExecutor(max_workers=8) as ex:
            api_snapshots = list(ex.map(read_api_day, [d[1] for d in api_days]))

        for i in range(1, len(api_days)):
            prev_dt, cur_dt = api_days[i - 1][0], api_days[i][0]
            if (cur_dt - prev_dt) > _td(days=1):
                invalid_transitions.add(i)

        debug_guild_intervals = [
            {
                "timestamp": api_days[i][0].isoformat(),
                "db": os.path.basename(api_days[i][1]),
                "day": api_days[i][0].date().isoformat(),
                "guildRaidsRawDelta": 0, "guildRaidsAppliedDelta": 0,
                "warsRawDelta": 0, "warsAppliedDelta": 0,
                "skippedMissing": 0, "skippedApiGap": 0,
                "skippedApiOff": 0, "skippedReactivation": 0,
                "reactivationUsers": [],
            }
            for i in range(1, len(api_days))
        ]

        # per-member daily deltas
        for ulow in members:
            user_debug_intervals = []
            seen_non_zero = {}
            first_user = api_snapshots[0].get(ulow, {}) if api_snapshots else {}
            for mk in metric_keys:
                first_val = first_user.get(mk)
                seen_non_zero[mk] = first_val is not None and _safe_number(first_val) > 0

            for mk in metric_keys:
                deltas = []
                metric_seen_non_zero = seen_non_zero.get(mk, False)

                for i in range(1, len(api_snapshots)):
                    prev_snap = api_snapshots[i - 1]
                    cur_snap = api_snapshots[i]
                    prev_user = prev_snap.get(ulow)
                    curr_user = cur_snap.get(ulow)
                    prev_value = prev_user.get(mk) if prev_user else None
                    curr_value = curr_user.get(mk) if curr_user else None

                    raw_delta = None
                    if prev_value is not None and curr_value is not None:
                        raw_delta = _safe_number(curr_value) - _safe_number(prev_value)

                    applied = 0
                    reason = None
                    if i in invalid_transitions:
                        reason = "api_gap"
                    elif not prev_user or not curr_user or prev_value is None or curr_value is None:
                        reason = "missing_snapshot"
                    elif _is_player_api_off(prev_user) or _is_player_api_off(curr_user):
                        reason = "api_off_interval"
                    elif _is_reactivation_spike(
                        prev_value, curr_value, metric_seen_non_zero,
                        metric_key=mk, prev_snapshot=prev_user, curr_snapshot=curr_user,
                    ):
                        reason = "reactivation_spike"
                    else:
                        applied = raw_delta if raw_delta is not None and raw_delta > 0 else 0
                        if applied <= 0:
                            reason = "non_positive_or_unavailable"

                    if curr_value is not None and _safe_number(curr_value) > 0:
                        metric_seen_non_zero = True

                    if mk in ("wars", "guildRaids") and i - 1 < len(debug_guild_intervals):
                        gdbg = debug_guild_intervals[i - 1]
                        if mk == "wars":
                            if raw_delta is not None and raw_delta > 0:
                                gdbg["warsRawDelta"] += int(round(raw_delta))
                            if applied > 0:
                                gdbg["warsAppliedDelta"] += int(round(applied))
                        else:
                            if raw_delta is not None and raw_delta > 0:
                                gdbg["guildRaidsRawDelta"] += int(round(raw_delta))
                            if applied > 0:
                                gdbg["guildRaidsAppliedDelta"] += int(round(applied))
                            if reason == "missing_snapshot":
                                gdbg["skippedMissing"] += 1
                            elif reason == "api_gap":
                                gdbg["skippedApiGap"] += 1
                            elif reason == "api_off_interval":
                                gdbg["skippedApiOff"] += 1
                            elif reason == "reactivation_spike":
                                gdbg["skippedReactivation"] += 1
                                if raw_delta is not None and raw_delta > 0 and len(gdbg["reactivationUsers"]) < 20:
                                    gdbg["reactivationUsers"].append({
                                        "username": members[ulow]["username"],
                                        "rawDelta": int(round(raw_delta)),
                                        "prev": int(round(_safe_number(prev_value))),
                                        "curr": int(round(_safe_number(curr_value))),
                                    })

                    if mk == "guildRaids":
                        if (
                            raw_delta not in (None, 0)
                            or reason in ("missing_snapshot", "api_gap", "api_off_interval", "reactivation_spike")
                        ):
                            user_debug_intervals.append({
                                "timestamp": api_days[i][0].isoformat() if i < len(api_days) else None,
                                "db": os.path.basename(api_days[i][1]) if i < len(api_days) else None,
                                "day": api_days[i][0].date().isoformat() if i < len(api_days) else None,
                                "metric": "guildRaids",
                                "prev": None if prev_value is None else int(round(_safe_number(prev_value))),
                                "curr": None if curr_value is None else int(round(_safe_number(curr_value))),
                                "rawDelta": None if raw_delta is None else int(round(raw_delta)),
                                "appliedDelta": int(round(applied)),
                                "reason": reason or "applied",
                            })

                    deltas.append(int(round(applied)) if applied > 0 else 0)

                seen_non_zero[mk] = metric_seen_non_zero
                members[ulow][mk] = deltas

            members[ulow]["metricDates"] = metric_dates
            if user_debug_intervals:
                debug_members[ulow] = {
                    "username": members[ulow]["username"],
                    "guildRaids": user_debug_intervals[-300:],
                }

    # guild-wide totals
    num_pt_days = len(dates)
    sample_mk = next((m.get("wars", []) for m in members.values() if m.get("wars")), [])
    num_mk_days = len(sample_mk)

    player_count = [0] * num_pt_days
    for m in members.values():
        for i, v in enumerate(m.get("data", [])):
            if v > 0 and i < num_pt_days:
                player_count[i] += 1

    guild_wars = [0] * num_mk_days
    guild_raids = [0] * num_mk_days
    tracked_guild_prefix = "ESI"
    debug_guild_intervals = []
    if api_snapshots and num_mk_days:
        guild_seen_non_zero = {}
        first_snap = api_snapshots[0]
        for ulow, snap in first_snap.items():
            if (snap.get("guildPrefix") or "").upper() != tracked_guild_prefix:
                continue
            guild_seen_non_zero[ulow] = {
                "wars": _safe_number(snap.get("wars")) > 0,
                "guildRaids": snap.get("guildRaids") is not None and _safe_number(snap.get("guildRaids")) > 0,
            }

        for i in range(1, len(api_snapshots)):
            day_idx = i - 1
            if day_idx >= num_mk_days:
                break
            prev_snap = api_snapshots[i - 1]
            cur_snap = api_snapshots[i]
            day_ts = api_days[i][0] if i < len(api_days) else None
            day_db = api_days[i][1] if i < len(api_days) else None

            interval_debug = {
                "timestamp": day_ts.isoformat() if day_ts else None,
                "db": os.path.basename(day_db) if day_db else None,
                "day": day_ts.date().isoformat() if day_ts else None,
                "guildRaidsRawDelta": 0, "guildRaidsAppliedDelta": 0,
                "warsRawDelta": 0, "warsAppliedDelta": 0,
                "skippedMissing": 0, "skippedApiGap": 0,
                "skippedApiOff": 0, "skippedReactivation": 0,
                "reactivationUsers": [],
            }

            if i in invalid_transitions:
                interval_debug["skippedApiGap"] = len(set(prev_snap.keys()) & set(cur_snap.keys()))
                debug_guild_intervals.append(interval_debug)
                continue

            for ulow in (set(prev_snap.keys()) & set(cur_snap.keys())):
                prev_user = prev_snap.get(ulow) or {}
                cur_user = cur_snap.get(ulow) or {}

                if (prev_user.get("guildPrefix") or "").upper() != tracked_guild_prefix:
                    continue
                if (cur_user.get("guildPrefix") or "").upper() != tracked_guild_prefix:
                    continue

                state = guild_seen_non_zero.setdefault(ulow, {
                    "wars": _safe_number(prev_user.get("wars")) > 0,
                    "guildRaids": prev_user.get("guildRaids") is not None and _safe_number(prev_user.get("guildRaids")) > 0,
                })

                if _is_player_api_off(prev_user) or _is_player_api_off(cur_user):
                    interval_debug["skippedApiOff"] += 1
                    if _safe_number(cur_user.get("wars")) > 0:
                        state["wars"] = True
                    if cur_user.get("guildRaids") is not None and _safe_number(cur_user.get("guildRaids")) > 0:
                        state["guildRaids"] = True
                    continue

                prev_wars = prev_user.get("wars")
                curr_wars = cur_user.get("wars")
                raw_wars = None if prev_wars is None or curr_wars is None else _safe_number(curr_wars) - _safe_number(prev_wars)
                if raw_wars is None:
                    interval_debug["skippedMissing"] += 1
                else:
                    if raw_wars > 0:
                        interval_debug["warsRawDelta"] += int(round(raw_wars))
                    if _is_reactivation_spike(
                        prev_wars, curr_wars, state.get("wars", False),
                        metric_key="wars", prev_snapshot=prev_user, curr_snapshot=cur_user,
                    ):
                        interval_debug["skippedReactivation"] += 1
                    else:
                        applied_wars = raw_wars if raw_wars > 0 else 0
                        if applied_wars > 0:
                            guild_wars[day_idx] += int(round(applied_wars))
                            interval_debug["warsAppliedDelta"] += int(round(applied_wars))

                prev_graids = prev_user.get("guildRaids")
                curr_graids = cur_user.get("guildRaids")
                raw_graids = None if prev_graids is None or curr_graids is None else _safe_number(curr_graids) - _safe_number(prev_graids)
                if raw_graids is None:
                    interval_debug["skippedMissing"] += 1
                else:
                    if raw_graids > 0:
                        interval_debug["guildRaidsRawDelta"] += int(round(raw_graids))
                    if _is_reactivation_spike(
                        prev_graids, curr_graids, state.get("guildRaids", False),
                        metric_key="guildRaids", prev_snapshot=prev_user, curr_snapshot=cur_user,
                    ):
                        interval_debug["skippedReactivation"] += 1
                        if raw_graids > 0 and len(interval_debug["reactivationUsers"]) < 20:
                            interval_debug["reactivationUsers"].append({
                                "username": ulow,
                                "rawDelta": int(round(raw_graids)),
                                "prev": int(round(_safe_number(prev_graids))),
                                "curr": int(round(_safe_number(curr_graids))),
                            })
                    else:
                        applied_graids = raw_graids if raw_graids > 0 else 0
                        if applied_graids > 0:
                            guild_raids[day_idx] += int(round(applied_graids))
                            interval_debug["guildRaidsAppliedDelta"] += int(round(applied_graids))

                if _safe_number(cur_user.get("wars")) > 0:
                    state["wars"] = True
                if cur_user.get("guildRaids") is not None and _safe_number(cur_user.get("guildRaids")) > 0:
                    state["guildRaids"] = True

            debug_guild_intervals.append(interval_debug)

    guild_raids = [max(0, (int(v) // 4)) for v in guild_raids]

    for _m in members.values():
        _mr = _m.get("guildRaids", [])
        for _di in range(min(len(_mr), len(guild_raids))):
            if _mr[_di] > guild_raids[_di]:
                _mr[_di] = 0

    total_members = [0] * num_mk_days
    if api_snapshots and num_mk_days:
        for i in range(1, len(api_snapshots)):
            day_idx = i - 1
            if day_idx >= num_mk_days:
                break
            total_members[day_idx] = sum(
                1 for snap in api_snapshots[i].values()
                if (snap.get("guildPrefix") or "").upper() == "ESI"
            )

    new_members = [0] * num_mk_days
    if os.path.isdir(os.path.join(_ESI_BOT_DIR, "databases", "api_tracking")):
        try:
            seen = set(api_snapshots[0].keys()) if api_snapshots else set()
            for idx in range(1, len(api_snapshots)):
                new_today = 0
                for ulow in api_snapshots[idx]:
                    if ulow not in seen:
                        new_today += 1
                        seen.add(ulow)
                if idx - 1 < num_mk_days:
                    new_members[idx - 1] = new_today
        except Exception:
            pass

    guild_data = {
        "dates":        dates,
        "metricDates":  metric_dates,
        "playerCount":  player_count,
        "wars":         guild_wars,
        "guildRaids":   guild_raids,
        "newMembers":   new_members,
        "totalMembers": total_members,
    }

    with _bulk_playtime_lock:
        _bulk_playtime_cache["data"] = {"members": members, "guild": guild_data}
        _bulk_playtime_cache["debug"] = {
            "rules": {"resetSpikeThresholds": RESET_SPIKE_MIN_BY_METRIC},
            "members": debug_members,
            "guild": {
                "intervals": [
                    row for row in debug_guild_intervals
                    if (
                        row.get("guildRaidsRawDelta", 0) > 0
                        or row.get("guildRaidsAppliedDelta", 0) > 0
                        or row.get("skippedMissing", 0) > 0
                        or row.get("skippedApiGap", 0) > 0
                        or row.get("skippedApiOff", 0) > 0
                        or row.get("skippedReactivation", 0) > 0
                    )
                ],
                "dailyGuildRaids": [
                    {"date": metric_dates[i], "value": int(guild_raids[i])}
                    for i in range(min(len(metric_dates), len(guild_raids)))
                ],
            },
        }
        _bulk_playtime_cache["ts"] = time()


# background threads

def _bulk_playtime_loop():
    """Re-crunches bulk playtime every BULK_PLAYTIME_REFRESH seconds."""
    while True:
        threading.Event().wait(BULK_PLAYTIME_REFRESH)
        try:
            _compute_bulk_playtime()
            print("Bulk playtime cache refreshed")
        except Exception as e:
            print(f"Bulk playtime refresh failed: {e}")


_UPLOAD_MAX_AGE = 3600  # orphaned uploads deleted after 1 hour


def _cleanup_orphaned_uploads():
    """Delete uploaded files older than _UPLOAD_MAX_AGE seconds."""
    now = time()
    try:
        for name in os.listdir(_UPLOAD_DIR):
            path = os.path.join(_UPLOAD_DIR, name)
            if not os.path.isfile(path):
                continue
            age = now - os.path.getmtime(path)
            if age > _UPLOAD_MAX_AGE:
                try:
                    os.unlink(path)
                except OSError:
                    pass
    except OSError:
        pass


def _upload_cleanup_loop():
    """Purge orphaned uploads every 10 minutes."""
    while True:
        threading.Event().wait(600)
        _cleanup_orphaned_uploads()


# HTTP endpoints (consumed by routes.py)

@app.route("/cache/status")
def cache_status():
    with _bulk_playtime_lock:
        ts = _bulk_playtime_cache["ts"]
    return jsonify({
        "ok": True,
        "cache_age": time() - ts if ts else None,
        "cache_ts": ts,
    })


@app.route("/cache/activity")
def cache_activity():
    with _bulk_playtime_lock:
        data = _bulk_playtime_cache["data"]
    if data:
        return jsonify(data)
    return jsonify({"members": {}, "guild": {}})


@app.route("/cache/activity/debug")
def cache_activity_debug():
    with _bulk_playtime_lock:
        debug = _bulk_playtime_cache["debug"]
    if debug:
        return jsonify(debug)
    return jsonify({})


@app.route("/cache/activity/member/<username>")
def cache_activity_member(username):
    ulow = username.lower()
    with _bulk_playtime_lock:
        bulk = _bulk_playtime_cache.get("data") or {}
    member = (bulk.get("members") or {}).get(ulow)
    if member:
        return jsonify(member)
    return jsonify(None)


@app.route("/cache/activity/guild")
def cache_activity_guild():
    with _bulk_playtime_lock:
        bulk = _bulk_playtime_cache.get("data") or {}
    guild = bulk.get("guild") or {}
    return jsonify(guild)


# startup

if __name__ == "__main__":
    print()
    print("  ESI Cache Service")
    print("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")
    print("  Computing initial activity cache\u2026", end="", flush=True)
    try:
        _diag_db = _get_latest_api_db()
        if not _diag_db:
            print(f" skipped \u2014 no api_tracking snapshots found in {_API_TRACKING_DIR}")
        else:
            _compute_bulk_playtime()
            _cd  = _bulk_playtime_cache.get("data") or {}
            _nm  = len(_cd.get("members") or {})
            _nd  = len((_cd.get("guild") or {}).get("dates") or [])
            _dbf = os.path.basename(_diag_db)
            if _nm == 0:
                print(f" done \u2014 0 members (player_stats empty in {_dbf})")
                print("  \u26a0  Activity data unavailable until player_stats is populated.")
            else:
                print(f" done ({_nm} members, {_nd} playtime days)")
    except Exception as _e:
        print(f" failed: {_e}")

    threading.Thread(target=_bulk_playtime_loop, daemon=True).start()
    threading.Thread(target=_upload_cleanup_loop, daemon=True).start()

    print(f"  Listening on 127.0.0.1:{CACHE_PORT}")
    print("  Press Ctrl+C to stop")
    print()
    app.run(host="127.0.0.1", port=CACHE_PORT, debug=False, threaded=True)
