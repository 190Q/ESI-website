"""Chess tournament pages and JSON API.

Exposed as a Flask blueprint that ``routes.py`` registers automatically, so
deleting this package removes the event without touching anything else. The
public page and the manager dashboard are served from here too, which keeps
the "is this a manager" decision next to the session code.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from datetime import datetime
from functools import wraps
from time import time

from flask import Blueprint, jsonify, request, send_from_directory, session

from config import _BASE_DIR, _USER_DB_PATH

from . import config as cfg
from . import store, swiss

bp = Blueprint("chess_tournament", __name__)

_SLOTS = ("white", "black", "bye")
_RESULTS = ("white", "black", "draw")


def _current_user():
    """The logged-in user, falling back to the remember-me cookie."""
    user = session.get("user")
    if user:
        return user
    token = request.cookies.get("esi_remember")
    if not token:
        return None
    try:
        connection = sqlite3.connect(_USER_DB_PATH, timeout=5)
        row = connection.execute(
            "SELECT user_data, expires_at FROM remember_tokens WHERE token = ?",
            (token,),
        ).fetchone()
        connection.close()
    except sqlite3.Error:
        return None
    if not row or time() > row[1]:
        return None
    try:
        user = json.loads(row[0])
    except (TypeError, ValueError):
        return None
    if not isinstance(user, dict):
        return None
    session.permanent = True
    session["user"] = user
    return user


def _require_manager():
    """Return (user, None) or (None, response) for non-managers.

    Non-managers get the same 404 the page gives, so the dashboard's
    existence is not advertised.
    """
    user = _current_user()
    if not cfg.is_manager((user or {}).get("id")):
        return None, (jsonify({"error": "Not found"}), 404)
    return user, None


_RATE_STORE = {}
_RATE_LOCK = threading.Lock()


def _rate_limit(calls=30, window=60.0):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = _current_user()
            key = (fn.__name__, (user or {}).get("id") or (request.remote_addr or ""))
            now = time()
            with _RATE_LOCK:
                bucket = _RATE_STORE.setdefault(key, [])
                bucket[:] = [stamp for stamp in bucket if now - stamp < window]
                if len(bucket) >= calls:
                    retry_after = int(window - (now - bucket[0])) + 1 if bucket else int(window)
                    response = jsonify({
                        "error": "Rate limit exceeded",
                        "message": f"Please wait {retry_after} second(s) and try again.",
                    })
                    response.status_code = 429
                    response.headers["Retry-After"] = str(retry_after)
                    return response
                bucket.append(now)
                if len(_RATE_STORE) > 5000:
                    cutoff = now - window * 2
                    for stale in [k for k, v in _RATE_STORE.items() if not v or v[-1] < cutoff]:
                        del _RATE_STORE[stale]
            return fn(*args, **kwargs)
        return wrapper
    return decorator


def _require_ajax():
    """Block classic CSRF: a form cannot set this header without a preflight."""
    if request.headers.get("X-Requested-With", "").strip().lower() != "xmlhttprequest":
        return jsonify({"error": "Forbidden"}), 403
    return None


def _json_body() -> dict:
    data = request.get_json(silent=True)
    return data if isinstance(data, dict) else {}


def _not_found_page():
    return send_from_directory(_BASE_DIR, "404.html"), 404


def _send_page(filename: str, max_age: int):
    response = send_from_directory(cfg.HTML_DIR, filename, mimetype="text/html")
    if max_age:
        response.headers["Cache-Control"] = f"public, max-age={int(max_age)}"
    else:
        response.headers["Cache-Control"] = "private, no-store"
    return response


def _parse_datetime(value):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text)
    except ValueError:
        return None


def _datetime_text(value) -> str:
    """Keep only a datetime-local string that actually parses."""
    text = str(value or "").strip()
    if not text:
        return ""
    parsed = _parse_datetime(text)
    if parsed is None:
        return ""
    return text[:cfg.MAX_DATETIME_LEN]


def _rating(value) -> int:
    text = str(value if value is not None else "").strip()
    if not text.isdigit():
        return 0
    return max(0, min(cfg.MAX_RATING, int(text)))


def _planned_rounds(state) -> int:
    planned = int(state["event"].get("rounds") or 0)
    if planned > 0:
        return planned
    return cfg.default_round_count(len(swiss.active_players(state)))


def _status(state) -> str:
    override = (state["event"].get("status_override") or "").strip().lower()
    if override in ("upcoming", "ongoing", "finished"):
        return override
    starts = _parse_datetime(state["event"].get("starts_at"))
    ends = _parse_datetime(state["event"].get("ends_at"))
    now = datetime.now()
    if ends is not None and now >= ends:
        return "finished"
    rounds = state.get("rounds") or []
    if rounds and len(rounds) >= _planned_rounds(state) and swiss.all_rounds_complete(state):
        return "finished"
    if starts is not None and now >= starts:
        return "ongoing"
    if starts is None and rounds:
        return "ongoing"
    return "upcoming"


def _find_match(state, match_id: str):
    for rnd in state.get("rounds") or []:
        for match in rnd.get("matches") or []:
            if match.get("id") == match_id:
                return rnd, match
    return None


def _player_has_games(state, player_id: str) -> bool:
    for rnd in state.get("rounds") or []:
        for match in rnd.get("matches") or []:
            if player_id in (match.get("white"), match.get("black"), match.get("bye")):
                return True
    return False


def _public_payload(state) -> dict:
    names = {p["id"]: p["name"] for p in state["players"]}
    rounds = []
    for rnd in state["rounds"]:
        boards = []
        for match in rnd["matches"]:
            boards.append({
                "board": match["board"],
                "white": names.get(match["white"] or ""),
                "black": names.get(match["black"] or ""),
                "bye": names.get(match["bye"] or ""),
                "result": match["result"],
            })
        rounds.append({
            "number": rnd["number"],
            "complete": swiss.round_complete(rnd),
            "boards": boards,
        })
    return {
        "event": {
            "title": state["event"]["title"],
            "description": state["event"]["description"],
            "starts_at": state["event"]["starts_at"],
            "ends_at": state["event"]["ends_at"],
            "status": _status(state),
        },
        "has_brackets": bool(rounds),
        "players": [
            {
                "name": player["name"],
                "rating": player["rating"],
                "withdrawn": bool(player["withdrawn"]),
            }
            for player in state["players"]
        ],
        "active_players": len(swiss.active_players(state)),
        "rounds_played": len(rounds),
        "rounds_planned": _planned_rounds(state),
        "rounds": rounds,
        "standings": swiss.compute_standings(state),
        "updated_at": state["updated_at"],
    }


def _manage_payload(state, extra=None) -> dict:
    payload = _public_payload(state)
    payload["event"]["status_override"] = state["event"]["status_override"]
    payload["event"]["rounds"] = state["event"]["rounds"]
    payload["players"] = state["players"]
    payload["default_rounds"] = cfg.default_round_count(len(swiss.active_players(state)))
    payload["can_generate"] = (
        len(swiss.active_players(state)) >= 2
        and len(state["rounds"]) < cfg.MAX_ROUNDS
        and (not state["rounds"] or swiss.round_complete(state["rounds"][-1]))
    )
    payload["rounds"] = [
        {
            "number": rnd["number"],
            "created_at": rnd["created_at"],
            "complete": swiss.round_complete(rnd),
            "matches": rnd["matches"],
        }
        for rnd in state["rounds"]
    ]
    if extra:
        payload.update(extra)
    return payload


@bp.route("/events/chess")
@bp.route("/events/chess/")
def chess_page():
    return _send_page("chess.html", max_age=30)


@bp.route("/events/manage/chess")
@bp.route("/events/manage/chess/")
def chess_manage_page():
    user = _current_user()
    if not cfg.is_manager((user or {}).get("id")):
        return _not_found_page()
    return _send_page("manage.html", max_age=0)


@bp.route("/events/chess/assets/<path:filename>")
def chess_asset(filename):
    mimetype = cfg.ASSET_TYPES.get(os.path.splitext(filename)[1].lower())
    if not mimetype:
        return _not_found_page()
    response = send_from_directory(cfg.ASSETS_DIR, filename, mimetype=mimetype)
    response.headers["Cache-Control"] = "public, max-age=300"
    return response


@bp.route("/api/events/chess/public")
def chess_public():
    with store.lock():
        state = store.load_state()
    response = jsonify(_public_payload(state))
    response.headers["Cache-Control"] = "private, max-age=15"
    return response


@bp.route("/api/events/chess/manage/state")
def manage_state():
    _user, error = _require_manager()
    if error:
        return error
    with store.lock():
        state = store.load_state()
    response = jsonify(_manage_payload(state))
    response.headers["Cache-Control"] = "private, no-store"
    return response


@bp.route("/api/events/chess/manage/event", methods=["POST"])
@_rate_limit(60, 60)
def manage_event():
    guard = _require_ajax()
    if guard:
        return guard
    _user, error = _require_manager()
    if error:
        return error
    body = _json_body()
    with store.lock():
        state = store.load_state()
        event = state["event"]
        event["title"] = (
            str(body.get("title") or "").strip()[:cfg.MAX_TITLE_LEN] or cfg.DEFAULT_TITLE
        )
        event["description"] = str(body.get("description") or "").strip()[:cfg.MAX_DESCRIPTION_LEN]
        event["starts_at"] = _datetime_text(body.get("starts_at"))
        event["ends_at"] = _datetime_text(body.get("ends_at"))
        event["rounds"] = max(0, min(cfg.MAX_ROUNDS, store._int(body.get("rounds"), 0)))
        override = str(body.get("status_override") or "").strip().lower()
        event["status_override"] = override if override in cfg.STATUS_OVERRIDES else ""
        store.save_state(state)
    return jsonify(_manage_payload(state))


@bp.route("/api/events/chess/manage/players", methods=["POST"])
@_rate_limit(60, 60)
def manage_add_players():
    guard = _require_ajax()
    if guard:
        return guard
    _user, error = _require_manager()
    if error:
        return error
    body = _json_body()
    entries = []
    raw_list = body.get("players")
    if isinstance(raw_list, list):
        for item in raw_list:
            if isinstance(item, dict):
                entries.append((item.get("name"), item.get("rating")))
            elif isinstance(item, str):
                entries.append((item, None))
    if not entries and isinstance(body.get("text"), str):
        for line in body["text"].splitlines():
            line = line.strip()
            if not line:
                continue
            parts = [part.strip() for part in line.replace("\t", ",").split(",", 1)]
            entries.append((parts[0], parts[1] if len(parts) > 1 else None))

    with store.lock():
        state = store.load_state()
        existing = {player["name"].lower() for player in state["players"]}
        added, skipped = [], []
        for name, rating in entries:
            clean = str(name or "").strip()[:cfg.MAX_NAME_LEN]
            if not clean:
                continue
            if clean.lower() in existing or len(state["players"]) >= cfg.MAX_PLAYERS:
                skipped.append(clean)
                continue
            existing.add(clean.lower())
            state["players"].append({
                "id": store.new_id("p"),
                "name": clean,
                "rating": _rating(rating),
                "withdrawn": False,
                "added_at": time(),
            })
            added.append(clean)
        if added:
            store.save_state(state)
    return jsonify(_manage_payload(state, {"added": added, "skipped": skipped}))


@bp.route("/api/events/chess/manage/players/<player_id>", methods=["PATCH"])
@_rate_limit(60, 60)
def manage_update_player(player_id):
    guard = _require_ajax()
    if guard:
        return guard
    _user, error = _require_manager()
    if error:
        return error
    body = _json_body()
    with store.lock():
        state = store.load_state()
        player = next((p for p in state["players"] if p["id"] == player_id), None)
        if player is None:
            return jsonify({"error": "Not found"}), 404
        if "name" in body:
            name = str(body.get("name") or "").strip()[:cfg.MAX_NAME_LEN]
            if not name:
                return jsonify({"error": "A player name is required."}), 400
            clash = any(
                other["id"] != player_id and other["name"].lower() == name.lower()
                for other in state["players"]
            )
            if clash:
                return jsonify({"error": f"{name} is already registered."}), 400
            player["name"] = name
        if "rating" in body:
            player["rating"] = _rating(body.get("rating"))
        if "withdrawn" in body:
            player["withdrawn"] = bool(body.get("withdrawn"))
        store.save_state(state)
    return jsonify(_manage_payload(state))


@bp.route("/api/events/chess/manage/players/<player_id>", methods=["DELETE"])
@_rate_limit(60, 60)
def manage_delete_player(player_id):
    guard = _require_ajax()
    if guard:
        return guard
    _user, error = _require_manager()
    if error:
        return error
    with store.lock():
        state = store.load_state()
        player = next((p for p in state["players"] if p["id"] == player_id), None)
        if player is None:
            return jsonify({"error": "Not found"}), 404
        if _player_has_games(state, player_id):
            return jsonify({
                "error": "This player already has games. Withdraw them instead of removing them.",
            }), 400
        state["players"] = [p for p in state["players"] if p["id"] != player_id]
        store.save_state(state)
    return jsonify(_manage_payload(state))


@bp.route("/api/events/chess/manage/rounds", methods=["POST"])
@_rate_limit(60, 60)
def manage_generate_round():
    guard = _require_ajax()
    if guard:
        return guard
    _user, error = _require_manager()
    if error:
        return error
    with store.lock():
        state = store.load_state()
        rounds = state["rounds"]
        if len(rounds) >= cfg.MAX_ROUNDS:
            return jsonify({"error": f"The event is limited to {cfg.MAX_ROUNDS} rounds."}), 400
        if rounds and not swiss.round_complete(rounds[-1]):
            return jsonify({"error": "Enter every result for the current round first."}), 400
        try:
            matches = swiss.generate_round(state)
        except ValueError as exc:
            return jsonify({"error": str(exc)}), 400
        for match in matches:
            match["id"] = store.new_id("m")
        rounds.append({
            "number": len(rounds) + 1,
            "created_at": time(),
            "matches": matches,
        })
        store.save_state(state)
    return jsonify(_manage_payload(state))


@bp.route("/api/events/chess/manage/rounds/<int:number>", methods=["DELETE"])
@_rate_limit(60, 60)
def manage_delete_round(number):
    guard = _require_ajax()
    if guard:
        return guard
    _user, error = _require_manager()
    if error:
        return error
    with store.lock():
        state = store.load_state()
        rounds = state["rounds"]
        if not rounds or rounds[-1]["number"] != number:
            return jsonify({"error": "Only the latest round can be deleted."}), 400
        if any(match.get("result") for match in rounds[-1]["matches"]):
            return jsonify({"error": "Clear this round's results before deleting it."}), 400
        rounds.pop()
        store.save_state(state)
    return jsonify(_manage_payload(state))


@bp.route("/api/events/chess/manage/matches/<match_id>", methods=["PATCH"])
@_rate_limit(120, 60)
def manage_update_match(match_id):
    guard = _require_ajax()
    if guard:
        return guard
    _user, error = _require_manager()
    if error:
        return error
    body = _json_body()
    with store.lock():
        state = store.load_state()
        found = _find_match(state, match_id)
        if found is None:
            return jsonify({"error": "Not found"}), 404
        _rnd, match = found

        if body.get("flip"):
            # Keep the result attached to the player rather than the colour.
            match["white"], match["black"] = match["black"], match["white"]
            if match["result"] == "white":
                match["result"] = "black"
            elif match["result"] == "black":
                match["result"] = "white"

        if "bye" in body:
            requested = body.get("bye")
            if requested in (None, "", "none"):
                match["bye"] = None
                match["result"] = None
            else:
                player_id = str(requested).strip()
                if player_id not in {p["id"] for p in state["players"]}:
                    return jsonify({"error": "Unknown player."}), 400
                match["white"] = None
                match["black"] = None
                match["result"] = None
                match["bye"] = player_id

        if "result" in body:
            result = body.get("result")
            if result in (None, "", "none"):
                match["result"] = None
            elif result not in _RESULTS:
                return jsonify({"error": "Invalid result."}), 400
            elif not match["white"] or not match["black"]:
                return jsonify({"error": "Assign both players before setting a result."}), 400
            else:
                match["result"] = result

        store.save_state(state)
    return jsonify(_manage_payload(state))


@bp.route("/api/events/chess/manage/matches/swap", methods=["POST"])
@_rate_limit(60, 60)
def manage_swap_slots():
    guard = _require_ajax()
    if guard:
        return guard
    _user, error = _require_manager()
    if error:
        return error
    body = _json_body()
    source = body.get("from") if isinstance(body.get("from"), dict) else {}
    target = body.get("to") if isinstance(body.get("to"), dict) else {}
    if source.get("slot") not in _SLOTS or target.get("slot") not in _SLOTS:
        return jsonify({"error": "Unknown slot."}), 400
    with store.lock():
        state = store.load_state()
        first = _find_match(state, str(source.get("match_id") or ""))
        second = _find_match(state, str(target.get("match_id") or ""))
        if first is None or second is None:
            return jsonify({"error": "Not found"}), 404
        match_a, match_b = first[1], second[1]
        if match_a is match_b and source["slot"] == target["slot"]:
            return jsonify({"error": "Pick two different slots."}), 400
        match_a[source["slot"]], match_b[target["slot"]] = (
            match_b[target["slot"]],
            match_a[source["slot"]],
        )
        for match in (match_a, match_b):
            match["result"] = None
        store.save_state(state)
    return jsonify(_manage_payload(state))


@bp.route("/api/events/chess/manage/reset", methods=["POST"])
@_rate_limit(30, 60)
def manage_reset():
    guard = _require_ajax()
    if guard:
        return guard
    _user, error = _require_manager()
    if error:
        return error
    body = _json_body()
    scope = str(body.get("scope") or "results").strip().lower()
    if scope not in ("results", "all"):
        return jsonify({"error": "Unknown reset scope."}), 400
    with store.lock():
        state = store.load_state()
        if scope == "all":
            state = store.blank_state()
        else:
            for rnd in state["rounds"]:
                for match in rnd["matches"]:
                    match["result"] = None
        store.save_state(state)
    return jsonify(_manage_payload(state))
