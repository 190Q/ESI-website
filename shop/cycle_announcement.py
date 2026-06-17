import json
import os
import random
import re
import sqlite3
import sys
from datetime import datetime as _dt, timedelta as _td, timezone as _tz

import requests as _requests

from config import (
    DISCORD_API,
    DISCORD_TOKEN,
    DEV_MODE,
    _CYCLE_ANNOUNCEMENT,
    _DISCORD_ENV_TARGETS,
    _POINTS_DB,
    _SHOP_DB,
    _USERNAME_MATCHES_JSON,
    _load_json_file,
)
from shop.bin import _get_cycle_bounds, _get_cycle_id
from shop.items import get_item_unfiltered

_ANNOUNCEMENT_ENV = "dev" if DEV_MODE else "prod"
_MEDAL_BY_RANK = {1: "🥇", 2: "🥈", 3: "🥉"}
_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _discord_headers():
    return {"Authorization": f"Bot {DISCORD_TOKEN}", "Content-Type": "application/json"}


def _ensure_cycle_announcement_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cycle_announcements (
            cycle_id      INTEGER NOT NULL,
            environment   TEXT NOT NULL,
            sent_at       TEXT NOT NULL,
            channel_id    TEXT NOT NULL,
            message_count INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (cycle_id, environment)
        )
        """
    )


def _has_cycle_been_announced(cycle_id: int, environment: str | None = None) -> bool:
    env = str(environment or _ANNOUNCEMENT_ENV).strip().lower()
    if not os.path.isfile(_SHOP_DB):
        return False
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        _ensure_cycle_announcement_table(conn)
        row = conn.execute(
            "SELECT 1 FROM cycle_announcements WHERE cycle_id = ? AND environment = ?",
            (cycle_id, env),
        ).fetchone()
        conn.close()
        return row is not None
    except sqlite3.Error:
        return False

def _record_cycle_announcement(
    cycle_id: int,
    channel_id: str,
    message_count: int,
    environment: str | None = None,
) -> None:
    env = str(environment or _ANNOUNCEMENT_ENV).strip().lower()
    try:
        os.makedirs(os.path.dirname(_SHOP_DB), exist_ok=True)
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_cycle_announcement_table(conn)
        conn.execute(
            "INSERT INTO cycle_announcements "
            "(cycle_id, environment, sent_at, channel_id, message_count) "
            "VALUES (?, ?, ?, ?, ?) "
            "ON CONFLICT(cycle_id, environment) DO UPDATE SET "
            "sent_at = excluded.sent_at, "
            "channel_id = excluded.channel_id, "
            "message_count = excluded.message_count",
            (
                cycle_id,
                env,
                _dt.now(_tz.utc).isoformat(),
                channel_id,
                max(1, int(message_count or 1)),
            ),
        )
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        print(f"[CYCLE] Failed to record announcement state for cycle {cycle_id}: {exc}", file=sys.stderr)


def _uuid_to_discord_map() -> dict[str, str]:
    matches = _load_json_file(_USERNAME_MATCHES_JSON) or {}
    out: dict[str, str] = {}
    for discord_id, entry in matches.items():
        did = str(discord_id).strip()
        if not did.isdigit() or not isinstance(entry, dict):
            continue
        uuid = (entry.get("uuid") or "").strip().lower()
        if uuid:
            out[uuid] = did
    return out


def _format_user_ref(uuid: str | None, username: str | None, uuid_map: dict[str, str]) -> str:
    uid = (uuid or "").strip().lower()
    did = uuid_map.get(uid) if uid else None
    if did:
        return f"<@{did}>"
    uname = (username or "").strip()
    if uname:
        return f"`{uname.replace('`', '')}`"
    return "`Unknown`"


def _fetch_cycle_points_rows(cycle_id: int) -> list[dict]:
    if cycle_id <= 0 or not os.path.isfile(_POINTS_DB):
        return []
    try:
        conn = sqlite3.connect(_POINTS_DB, timeout=10)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT uuid, MAX(username) AS username, COALESCE(SUM(points), 0) AS points "
            "FROM esi_points "
            "WHERE cycle_id = ? "
            "GROUP BY uuid "
            "HAVING COALESCE(SUM(points), 0) > 0 ",
            (cycle_id,),
        ).fetchall()

        def _safe_player_table(uuid: str) -> str | None:
            uid = (uuid or "").strip().lower()
            if not _UUID_RE.match(uid):
                return None
            return "player_" + uid.replace("-", "_")

        def _first_reached_timestamp(uuid: str, target_points: int) -> str | None:
            if target_points <= 0:
                return None
            table_name = _safe_player_table(uuid)
            if not table_name:
                return None
            try:
                history_rows = conn.execute(
                    f'SELECT points_gained, timestamp FROM "{table_name}" '
                    "WHERE cycle_id = ? "
                    "ORDER BY timestamp ASC, record_id ASC",
                    (cycle_id,),
                ).fetchall()
            except sqlite3.Error:
                return None

            running_total = 0
            for history_row in history_rows:
                running_total += int(history_row["points_gained"] or 0)
                if running_total >= target_points:
                    timestamp = (history_row["timestamp"] or "").strip()
                    return timestamp or None
            return None
    except sqlite3.Error as exc:
        print(f"[CYCLE] Failed to read points for cycle {cycle_id}: {exc}", file=sys.stderr)
        return []
    out: list[dict] = []
    for row in rows:
        uuid = (row["uuid"] or "").strip().lower()
        points = int(row["points"] or 0)
        out.append(
            {
                "uuid": uuid,
                "username": (row["username"] or "").strip(),
                "points": points,
                "first_reached_at": _first_reached_timestamp(uuid, points),
            }
        )
    conn.close()
    out.sort(
        key=lambda row: (
            -int(row.get("points") or 0),
            row.get("first_reached_at") or "9999-12-31T23:59:59+00:00",
            (row.get("username") or "").lower(),
        )
    )
    return out


def _fetch_cycle_auction_winners(start_iso: str, end_iso: str) -> list[dict]:
    if not os.path.isfile(_SHOP_DB):
        return []
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT b.uuid, MAX(NULLIF(b.username, '')) AS username, "
            "       COUNT(*) AS wins, MAX(b.amount) AS best_bid "
            "FROM bids b "
            "JOIN auctions a ON a.auction_id = b.auction_id "
            "WHERE b.is_winning = 1 "
            "  AND a.status = 'closed' "
            "  AND a.ends_at >= ? "
            "  AND a.ends_at < ? "
            "GROUP BY b.uuid "
            "ORDER BY wins DESC, best_bid DESC, username COLLATE NOCASE ASC",
            (start_iso, end_iso),
        ).fetchall()
        conn.close()
    except sqlite3.Error as exc:
        print(f"[CYCLE] Failed to read cycle auction winners: {exc}", file=sys.stderr)
        return []
    winners = []
    for row in rows:
        winners.append(
            {
                "uuid": (row["uuid"] or "").strip().lower(),
                "username": (row["username"] or "").strip(),
                "wins": int(row["wins"] or 0),
                "best_bid": int(row["best_bid"] or 0),
            }
        )
    return winners


def _fetch_cycle_winning_auctions(start_iso: str, end_iso: str) -> list[dict]:
    if not os.path.isfile(_SHOP_DB):
        return []
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT a.auction_id, a.item_id, a.ends_at, "
            "       b.uuid, MAX(NULLIF(b.username, '')) AS username, "
            "       MAX(b.amount) AS amount "
            "FROM auctions a "
            "JOIN bids b ON b.auction_id = a.auction_id "
            "WHERE b.is_winning = 1 "
            "  AND a.status = 'closed' "
            "  AND a.ends_at >= ? "
            "  AND a.ends_at < ? "
            "GROUP BY a.auction_id, a.item_id, a.ends_at, b.uuid "
            "ORDER BY a.ends_at ASC, amount DESC, username COLLATE NOCASE ASC",
            (start_iso, end_iso),
        ).fetchall()
        conn.close()
    except sqlite3.Error as exc:
        print(f"[CYCLE] Failed to read cycle winning auctions: {exc}", file=sys.stderr)
        return []
    out = []
    for row in rows:
        out.append(
            {
                "auction_id": (row["auction_id"] or "").strip(),
                "item_id": (row["item_id"] or "").strip(),
                "uuid": (row["uuid"] or "").strip().lower(),
                "username": (row["username"] or "").strip(),
                "amount": int(row["amount"] or 0),
            }
        )
    return out


def _fetch_cycle_created_items(start_iso: str, end_iso: str) -> list[dict]:
    if not os.path.isfile(_SHOP_DB):
        return []
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.row_factory = sqlite3.Row
        has_log_table = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='shop_admin_log'"
        ).fetchone()
        if not has_log_table:
            conn.close()
            return []
        rows = conn.execute(
            "SELECT target_id, details FROM shop_admin_log "
            "WHERE action = 'item_created' AND timestamp >= ? AND timestamp < ? "
            "ORDER BY timestamp ASC",
            (start_iso, end_iso),
        ).fetchall()
        conn.close()
    except sqlite3.Error as exc:
        print(f"[CYCLE] Failed to read created-item log entries: {exc}", file=sys.stderr)
        return []

    out: list[dict] = []
    seen_ids: set[str] = set()
    for row in rows:
        details = {}
        raw_details = row["details"]
        if raw_details:
            try:
                details = json.loads(raw_details)
            except json.JSONDecodeError:
                details = {}
        item_id = ((row["target_id"] or details.get("item_id") or "")).strip()
        if item_id in seen_ids:
            continue
        seen_ids.add(item_id)
        name = ((details.get("name") or item_id or "Unnamed item")).strip()
        out.append({"item_id": item_id, "name": name})
    return out


def _split_message_for_discord(content: str, limit: int = 2000) -> list[str]:
    if len(content) <= limit:
        return [content]
    chunks: list[str] = []
    current = ""
    for line in content.split("\n"):
        addition = line if not current else ("\n" + line)
        if len(current) + len(addition) <= limit:
            current += addition
            continue
        if current:
            chunks.append(current)
            current = ""
        if len(line) <= limit:
            current = line
            continue
        # Hard-wrap extremely long lines.
        start = 0
        while start < len(line):
            part = line[start:start + limit]
            chunks.append(part)
            start += limit
    if current:
        chunks.append(current)
    return chunks


def _discord_error_text(err_data: dict, fallback: str) -> str:
    base = (err_data or {}).get("message") or fallback
    errors = (err_data or {}).get("errors")
    if not isinstance(errors, dict):
        return base

    details: list[str] = []

    def _walk(node, path: str = "") -> None:
        if isinstance(node, dict):
            own = node.get("_errors")
            if isinstance(own, list):
                for item in own:
                    if isinstance(item, dict):
                        msg = (item.get("message") or "").strip()
                        if msg:
                            details.append(f"{path or 'payload'}: {msg}")
            for key, value in node.items():
                if key == "_errors":
                    continue
                next_path = f"{path}.{key}" if path else str(key)
                _walk(value, next_path)
        elif isinstance(node, list):
            for idx, value in enumerate(node):
                next_path = f"{path}[{idx}]"
                _walk(value, next_path)

    _walk(errors)
    if details:
        return f"{base} ({'; '.join(details[:4])})"
    return base


def _resolve_cycle_announcement_target(target_environment: str | None = None) -> tuple[str, dict]:
    env = str(target_environment or _ANNOUNCEMENT_ENV).strip().lower()
    if env not in {"dev", "prod"}:
        raise ValueError("target_environment must be 'dev' or 'prod'")
    if env == _ANNOUNCEMENT_ENV:
        return env, dict(_CYCLE_ANNOUNCEMENT)
    env_entry = _DISCORD_ENV_TARGETS.get(env) or {}
    target = env_entry.get("cycle_announcement")
    if not isinstance(target, dict):
        raise ValueError(f"Missing cycle_announcement config for environment '{env}'")
    return env, dict(target)

def _winner_flavor_line(rng: random.Random, winner_ref: str, item_name: str) -> str:
    options = [
        f"Auction result: {winner_ref} claimed {item_name}.",
        f"{winner_ref} closed the cycle by winning {item_name}.",
        f"{winner_ref} secured {item_name}.",
        f"{winner_ref} took {item_name} before anyone else could.",
    ]
    return rng.choice(options)

def _shop_updates_intro_line(rng: random.Random) -> str:
    options = [
        "We've got some hot new wares for sale in the shop! Now, bringing to you:",
        "Fresh shop items just dropped! Now available:",
        "The shop has new additions this cycle. Check out:",
        "New shop drops are in! Now, bringing to you:",
    ]
    return rng.choice(options)


def _build_cycle_message(ended_cycle_id: int, target: dict) -> tuple[str, dict]:
    ended_start, ended_end = _get_cycle_bounds(ended_cycle_id)
    new_start, new_end = _get_cycle_bounds(ended_cycle_id + 1)
    ended_start_iso = ended_start.isoformat()
    ended_end_iso = ended_end.isoformat()

    uuid_map = _uuid_to_discord_map()
    leaderboard_rows = _fetch_cycle_points_rows(ended_cycle_id)
    total_ep = sum(int(row.get("points") or 0) for row in leaderboard_rows)

    winners = _fetch_cycle_auction_winners(ended_start_iso, ended_end_iso)
    winning_auctions = _fetch_cycle_winning_auctions(ended_start_iso, ended_end_iso)
    created_items = _fetch_cycle_created_items(ended_start_iso, ended_end_iso)

    top_user_ref = None
    if leaderboard_rows:
        top_row = leaderboard_rows[0]
        top_user_ref = _format_user_ref(top_row.get("uuid"), top_row.get("username"), uuid_map)

    custom_role_colour_deadline_ts = int((new_start + _td(days=1)).timestamp())

    ep_emoji = target["ep_emoji"]
    citizen_role_id = target["citizen_role_id"]
    flame_role_id = target["flame_role_id"]
    shop_url = target["shop_url"]

    rng = random.Random()
    title = rng.choice(
        [
            "__NEW EP CYCLE__",
            "__CYCLE ROLLOVER__",
            "__A NEW EP CYCLE BEGINS__",
            "__NEXT EP CYCLE STARTED__",
        ]
    )

    leaderboard_lines: list[str] = []
    for rank, row in enumerate(leaderboard_rows[:15], start=1):
        rank_token = _MEDAL_BY_RANK.get(rank, f"#{rank}")
        user_ref = _format_user_ref(row.get("uuid"), row.get("username"), uuid_map)
        leaderboard_lines.append(
            f"> {rank_token} {user_ref} - {int(row.get('points') or 0):,} {ep_emoji}"
        )
    if not leaderboard_lines:
        leaderboard_lines.append("> No EP activity was recorded for this cycle.")
    flavor_lines: list[str] = []
    for win in winning_auctions:
        winner_ref = _format_user_ref(win.get("uuid"), win.get("username"), uuid_map)
        item_id = (win.get("item_id") or "").strip()
        item = get_item_unfiltered(item_id) if item_id else None
        item_name = ((item or {}).get("name") or "").strip() or "an auction item"
        flavor_lines.append(_winner_flavor_line(rng, winner_ref, item_name))

    item_section_lines: list[str] = []
    if created_items:
        item_lines: list[str] = []
        for item in created_items:
            item_name = (item.get("name") or item.get("item_id") or "Unnamed item").strip()
            item_lines.append(f"- {item_name}")
        item_section_lines = [
            "",
            f"{ep_emoji}__**EP Shop Updates**__ {ep_emoji}",
            _shop_updates_intro_line(rng),
            *item_lines,
        ]

    if top_user_ref:
        congrats = f"Congratulations to the <@&{flame_role_id}> {top_user_ref}!"
    else:
        congrats = f"Congratulations to the <@&{flame_role_id}>!"
    lines: list[str] = [
        f"# {ep_emoji} {title} {ep_emoji}",
        f"<@&{citizen_role_id}>",
        "",
    ]
    if flavor_lines:
        lines.extend(flavor_lines)
        lines.append("")
    lines.extend(
        [
            "🔥__**EP Leaderboard**__🔥",
            *leaderboard_lines,
            *item_section_lines,
            "",
            congrats,
            f"We totaled **{total_ep:,} {ep_emoji} this cycle.**",
            "",
            f"The new cycle started on <t:{int(new_start.timestamp())}:F> and will conclude on <t:{int(new_end.timestamp())}:F>.",
            f"If you bought a custom role colour, you have until <t:{custom_role_colour_deadline_ts}:F> to buy it again before the role is removed.",
            "",
            rng.choice(
                [
                    "Happy shopping, everyone :D",
                    "Good luck this cycle, everyone!",
                    "Enjoy the new cycle and happy shopping!",
                ]
            ),
            shop_url,
        ]
    )
    return "\n".join(lines).strip(), {
        "total_ep": total_ep,
        "leaderboard_group_count": min(len(leaderboard_rows), 15),
        "winner_count": len(winners),
        "created_item_count": len(created_items),
    }


def _post_announcement(channel_id: str, content: str, target: dict) -> dict:
    chunks = _split_message_for_discord(content, limit=2000)
    role_ids = list(
        dict.fromkeys(
            [
                str(target["citizen_role_id"]).strip(),
                str(target["flame_role_id"]).strip(),
            ]
        )
    )
    role_ids = [rid for rid in role_ids if rid]
    message_ids: list[str] = []
    for chunk in chunks:
        try:
            resp = _requests.post(
                f"{DISCORD_API}/channels/{channel_id}/messages",
                json={
                    "content": chunk,
                    "allowed_mentions": {
                        "parse": [],
                        "roles": role_ids,
                        "users": [],
                    },
                },
                headers=_discord_headers(),
                timeout=15,
            )
        except _requests.RequestException as exc:
            return {"ok": False, "error": f"Discord request failed: {exc}"}
        if not resp.ok:
            try:
                err_data = resp.json()
                err_text = _discord_error_text(err_data, str(err_data))
            except ValueError:
                err_text = resp.text[:300]
            return {
                "ok": False,
                "error": f"Discord returned {resp.status_code}: {err_text}",
                "status_code": int(resp.status_code),
                "discord_error_text": err_text,
            }
        msg_id = ""
        try:
            msg_id = str((resp.json() or {}).get("id") or "")
        except ValueError:
            msg_id = ""
        if msg_id:
            message_ids.append(msg_id)
    return {"ok": True, "message_ids": message_ids, "chunk_count": len(chunks)}


def send_cycle_end_announcement(
    ended_cycle_id: int,
    *,
    respect_sent: bool = True,
    record_sent: bool = True,
    dry_run: bool = False,
    target_environment: str | None = None,
) -> dict:
    if ended_cycle_id <= 0:
        return {"ok": False, "error": "cycle_id must be a positive integer"}
    try:
        announcement_env, target = _resolve_cycle_announcement_target(target_environment)
    except ValueError as exc:
        return {"ok": False, "error": str(exc)}
    channel_id = target["announcement_channel_id"]
    if respect_sent and _has_cycle_been_announced(ended_cycle_id, environment=announcement_env):
        return {
            "ok": True,
            "skipped": True,
            "reason": "already_announced",
            "cycle_id": ended_cycle_id,
            "target_environment": announcement_env,
        }
    message, stats = _build_cycle_message(ended_cycle_id, target)
    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "cycle_id": ended_cycle_id,
            "channel_id": channel_id,
            "target_environment": announcement_env,
            "announcement_text": message,
            **stats,
        }

    if not DISCORD_TOKEN:
        return {"ok": False, "error": "DISCORD_TOKEN is not configured"}
    result = _post_announcement(channel_id, message, target)
    if not result.get("ok"):
        status_code = int(result.get("status_code") or 0)
        discord_error_text = str(result.get("discord_error_text") or "")
        if (
            record_sent
            and status_code == 403
            and "missing permissions" in discord_error_text.lower()
        ):
            _record_cycle_announcement(
                ended_cycle_id,
                channel_id,
                0,
                environment=announcement_env,
            )
            return {
                "ok": True,
                "skipped": True,
                "reason": "discord_missing_permissions_marked_announced",
                "cycle_id": ended_cycle_id,
                "channel_id": channel_id,
                "target_environment": announcement_env,
                "error": result.get("error") or "Discord returned 403: Missing Permissions",
                **stats,
            }
        return {
            "ok": False,
            "cycle_id": ended_cycle_id,
            "channel_id": channel_id,
            "target_environment": announcement_env,
            "error": result.get("error") or "Failed to post announcement",
            **stats,
        }

    message_count = int(result.get("chunk_count") or 1)
    if record_sent:
        _record_cycle_announcement(
            ended_cycle_id,
            channel_id,
            message_count,
            environment=announcement_env,
        )

    return {
        "ok": True,
        "cycle_id": ended_cycle_id,
        "channel_id": channel_id,
        "target_environment": announcement_env,
        "message_count": message_count,
        "message_ids": result.get("message_ids") or [],
        **stats,
    }


def announce_previous_cycle_if_due() -> dict:
    current_cycle_id = _get_cycle_id()
    ended_cycle_id = current_cycle_id - 1
    if ended_cycle_id <= 0:
        return {"ok": True, "skipped": True, "reason": "no_completed_cycle"}
    return send_cycle_end_announcement(
        ended_cycle_id,
        respect_sent=True,
        record_sent=True,
        dry_run=False,
    )
