import sys
import threading
from time import time as _time

_CACHE_TTL_SECONDS = 60
_CACHE_MAX_CYCLES = 16
_cache_lock = threading.Lock()
_cycle_board_cache: dict[int, tuple[float, list[dict]]] = {}

_REQUIRED_ROUTES_FUNCS = (
    "_points_guild_ranks_and_members",
    "_points_graph_graid_ep_by_username",
    "_points_build_leaderboard",
)


def _resolve_points_runtime_module():
    candidates = []
    routes_mod = sys.modules.get("routes")
    if routes_mod is not None:
        candidates.append(routes_mod)
    main_mod = sys.modules.get("__main__")
    if main_mod is not None:
        candidates.append(main_mod)
    for mod in candidates:
        if all(hasattr(mod, name) for name in _REQUIRED_ROUTES_FUNCS):
            return mod
    return None


def _copy_rows(rows: list[dict]) -> list[dict]:
    return [dict(row) for row in rows]


def _normalize_players(players: list[dict]) -> list[dict]:
    out: list[dict] = []
    for idx, player in enumerate(players, start=1):
        if not isinstance(player, dict):
            continue
        points = int(player.get("points") or 0)
        if points <= 0:
            continue
        out.append(
            {
                "uuid": (player.get("uuid") or "").strip().lower(),
                "username": (player.get("username") or "").strip(),
                "points": points,
                "clean_ep": int(player.get("clean_ep") or 0),
                "dirty_ep": int(player.get("dirty_ep") or 0),
                "le": float(player.get("le") or 0),
                "rank": (player.get("rank") or "").strip().lower() or None,
                "position": int(player.get("position") or idx),
            }
        )
    return out


def get_cycle_leaderboard_rows(cycle_id: int) -> list[dict] | None:
    cycle_id = int(cycle_id or 0)
    if cycle_id <= 0:
        return []

    now = _time()
    with _cache_lock:
        cached = _cycle_board_cache.get(cycle_id)
        if cached and (now - float(cached[0])) < _CACHE_TTL_SECONDS:
            return _copy_rows(cached[1])

    runtime_mod = _resolve_points_runtime_module()
    if runtime_mod is None:
        return None

    try:
        guild_ranks, guild_members, guild_uuids = runtime_mod._points_guild_ranks_and_members()
        cycle_graid_ep_by_user = {cycle_id: runtime_mod._points_graph_graid_ep_by_username(cycle_id)}
        board = runtime_mod._points_build_leaderboard(
            [cycle_id],
            guild_ranks,
            guild_members,
            {},
            guild_uuids=guild_uuids,
            cycle_graid_ep_by_user=cycle_graid_ep_by_user,
        )
        rows = _normalize_players((board or {}).get("players") or [])
    except Exception:
        return None

    with _cache_lock:
        _cycle_board_cache[cycle_id] = (now, rows)
        if len(_cycle_board_cache) > _CACHE_MAX_CYCLES:
            oldest_keys = sorted(
                _cycle_board_cache.keys(),
                key=lambda cid: _cycle_board_cache[cid][0],
            )[:-_CACHE_MAX_CYCLES]
            for cid in oldest_keys:
                _cycle_board_cache.pop(cid, None)

    return _copy_rows(rows)


def get_user_cycle_totals(uuid: str, cycle_id: int) -> dict | None:
    rows = get_cycle_leaderboard_rows(cycle_id)
    if rows is None:
        return None

    uid = (uuid or "").strip().lower()
    if not uid:
        return {
            "uuid": "",
            "username": "",
            "points": 0,
            "clean_ep": 0,
            "dirty_ep": 0,
            "le": 0.0,
            "rank": None,
            "position": None,
        }

    for row in rows:
        if (row.get("uuid") or "").strip().lower() == uid:
            return dict(row)

    return {
        "uuid": uid,
        "username": "",
        "points": 0,
        "clean_ep": 0,
        "dirty_ep": 0,
        "le": 0.0,
        "rank": None,
        "position": None,
    }
