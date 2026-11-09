"""Tournament state on disk.

The state is one JSON file written atomically, so a reader never sees a
half-written tournament. ``lock()`` serialises read-modify-write cycles
between requests.
"""

from __future__ import annotations

import os
import secrets
import threading
from time import time

from config import _load_json_file, _save_json_file

from . import config as cfg

_LOCK = threading.RLock()

_RESULTS = (None, "white", "black", "draw")


def lock():
    """The module lock. Hold it around a load, mutate, save cycle."""
    return _LOCK


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_urlsafe(6)}"


def blank_state() -> dict:
    now = time()
    return {
        "event": {
            "title": cfg.DEFAULT_TITLE,
            "description": cfg.DEFAULT_DESCRIPTION,
            "starts_at": "",
            "ends_at": "",
            # 0 means "derive from the player count".
            "rounds": 0,
            "status_override": "",
        },
        "players": [],
        "rounds": [],
        "created_at": now,
        "updated_at": now,
    }


def _text(value, max_len: int) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return text[:max_len]


def _int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _clamp(value, low: int, high: int, default: int) -> int:
    number = _int(value, default)
    if number < low:
        return low
    if number > high:
        return high
    return number


def _normalise_event(raw: dict) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    title = _text(raw.get("title"), cfg.MAX_TITLE_LEN) or cfg.DEFAULT_TITLE
    override = _text(raw.get("status_override"), 16).lower()
    if override not in cfg.STATUS_OVERRIDES:
        override = ""
    return {
        "title": title,
        "description": _text(raw.get("description"), cfg.MAX_DESCRIPTION_LEN),
        "starts_at": _text(raw.get("starts_at"), cfg.MAX_DATETIME_LEN),
        "ends_at": _text(raw.get("ends_at"), cfg.MAX_DATETIME_LEN),
        "rounds": _clamp(raw.get("rounds"), 0, cfg.MAX_ROUNDS, 0),
        "status_override": override,
    }


def _normalise_players(raw) -> list:
    players = []
    seen_ids = set()
    seen_names = set()
    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        player_id = _text(entry.get("id"), 40) or new_id("p")
        if player_id in seen_ids:
            player_id = new_id("p")
        name = _text(entry.get("name"), cfg.MAX_NAME_LEN)
        if not name:
            continue
        key = name.lower()
        if key in seen_names:
            continue
        seen_ids.add(player_id)
        seen_names.add(key)
        players.append({
            "id": player_id,
            "name": name,
            "rating": _clamp(entry.get("rating"), 0, cfg.MAX_RATING, 0),
            "withdrawn": bool(entry.get("withdrawn")),
            "added_at": entry.get("added_at") or time(),
        })
    return players[:cfg.MAX_PLAYERS]


def _normalise_rounds(raw, player_ids) -> list:
    rounds = []
    for index, entry in enumerate(raw if isinstance(raw, list) else [], start=1):
        if not isinstance(entry, dict):
            continue
        matches = []
        for board, match in enumerate(entry.get("matches") or [], start=1):
            if not isinstance(match, dict):
                continue
            white = match.get("white")
            black = match.get("black")
            bye = match.get("bye")
            result = match.get("result")
            matches.append({
                "id": _text(match.get("id"), 40) or new_id("m"),
                "board": board,
                "white": white if white in player_ids else None,
                "black": black if black in player_ids else None,
                "bye": bye if bye in player_ids else None,
                "result": result if result in _RESULTS else None,
            })
        rounds.append({
            "number": index,
            "created_at": entry.get("created_at") or time(),
            "matches": matches,
        })
        if len(rounds) >= cfg.MAX_ROUNDS:
            break
    return rounds


def normalise(raw) -> dict:
    """Coerce anything read off disk into a valid state dict."""
    state = blank_state()
    if not isinstance(raw, dict):
        return state
    state["event"] = _normalise_event(raw.get("event"))
    state["players"] = _normalise_players(raw.get("players"))
    player_ids = {p["id"] for p in state["players"]}
    state["rounds"] = _normalise_rounds(raw.get("rounds"), player_ids)
    state["created_at"] = raw.get("created_at") or state["created_at"]
    state["updated_at"] = raw.get("updated_at") or state["updated_at"]
    return state


def load_state() -> dict:
    return normalise(_load_json_file(cfg.STATE_PATH))


def save_state(state: dict) -> dict:
    state["updated_at"] = time()
    os.makedirs(os.path.dirname(cfg.STATE_PATH), exist_ok=True)
    _save_json_file(cfg.STATE_PATH, state)
    return state
