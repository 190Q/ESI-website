import json
import os
import re
import sqlite3
import sys
import threading

from config import _SHOP_ITEMS_JSON, _SHOP_DB


_items_lock = threading.Lock()
_items_by_id: dict = {}          # item_id → merged item dict
_items_list: list = []           # ordered list (same order as JSON)
_loaded = False

# Valid guild ranks for visible_to_ranks (lowercased)
_GUILD_RANKS = {
    "emperor", "archduke", "grand duke", "duke", "count",
    "viscount", "knight", "squire",
}

# Pattern for cycle-based durations like "3c" or "1c"
_CYCLE_RE = re.compile(r"^(\d+)c$", re.IGNORECASE)

def parse_duration(value) -> dict | None:
    """Parse a cooldown / subscription_duration value.

    Returns one of:
      - ``None``                                → no duration
      - ``{"type": "days",         "value": N}``
      - ``{"type": "end_of_cycle"}``
      - ``{"type": "cycles",       "value": N}``
    """
    if value is None:
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return {"type": "days", "value": int(value)}
    if isinstance(value, str):
        v = value.strip().lower()
        if v == "end_of_cycle":
            return {"type": "end_of_cycle"}
        m = _CYCLE_RE.match(v)
        if m:
            return {"type": "cycles", "value": int(m.group(1))}
        # Try plain numeric string
        try:
            return {"type": "days", "value": int(v)}
        except ValueError:
            pass
    return None

def _load_json() -> list:
    """Read and parse the JSON item catalogue from disk."""
    if not os.path.isfile(_SHOP_ITEMS_JSON):
        print(
            f"[SHOP] Item catalogue not found: {_SHOP_ITEMS_JSON}",
            file=sys.stderr,
        )
        return []
    try:
        with open(_SHOP_ITEMS_JSON, encoding="utf-8") as fh:
            data = json.load(fh)
        if not isinstance(data, list):
            print(
                f"[SHOP] Expected JSON array in {_SHOP_ITEMS_JSON}, "
                f"got {type(data).__name__}",
                file=sys.stderr,
            )
            return []
        return data
    except (json.JSONDecodeError, OSError) as exc:
        print(f"[SHOP] Failed to load {_SHOP_ITEMS_JSON}: {exc}", file=sys.stderr)
        return []

def _load_overrides() -> dict:
    """Read item_overrides from shop.db.

    Returns a dict of ``{item_id: {"active": ..., "stock": ...}}``.
    Only non-NULL columns are included so the merge step can distinguish
    "no override" from "explicitly set to a value".
    """
    if not os.path.isfile(_SHOP_DB):
        return {}
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT item_id, active, stock FROM item_overrides"
        ).fetchall()
        conn.close()
    except sqlite3.Error as exc:
        print(f"[SHOP] Failed to read overrides from {_SHOP_DB}: {exc}", file=sys.stderr)
        return {}

    overrides: dict = {}
    for row in rows:
        entry: dict = {}
        if row["active"] is not None:
            entry["active"] = bool(row["active"])
        if row["stock"] is not None:
            entry["stock"] = row["stock"]
        if entry:
            overrides[row["item_id"]] = entry
    return overrides

def _merge(items: list, overrides: dict) -> list:
    """Apply DB overrides on top of JSON defaults.

    Returns a new list of item dicts (the originals are not mutated).
    """
    merged = []
    for item in items:
        item = dict(item)                     # shallow copy
        ov = overrides.get(item.get("id"))
        if ov:
            if "active" in ov:
                item["active"] = ov["active"]
            if "stock" in ov:
                item["stock"] = ov["stock"]
        merged.append(item)
    return merged

def reload() -> None:
    """(Re)load the full item catalogue from JSON + DB.

    Called automatically on first access and can be called manually
    after a Chief updates an override or the JSON file changes.
    """
    global _items_by_id, _items_list, _loaded

    items = _load_json()
    overrides = _load_overrides()
    merged = _merge(items, overrides)

    by_id = {item["id"]: item for item in merged if "id" in item}

    with _items_lock:
        _items_by_id = by_id
        _items_list = merged
        _loaded = True


def _ensure_loaded() -> None:
    if not _loaded:
        reload()

def _is_visible(item: dict, tags: set | None) -> bool:
    """Check whether a user with *tags* is allowed to see *item*.

    *tags* is a **lowercased** set of the user's guild rank tags, e.g.
    ``{"knight"}``.  ``None`` means anonymous / not a guild member.

    ``visible_to_ranks`` rules:
      - ``None`` → visible to everyone.
      - A list of strings → split into includes and ``!``-prefixed excludes.
        * If the user matches ANY exclude → **hidden**.
        * If there are includes, the user must match at least one.
        * If there are ONLY excludes (no includes), everyone not excluded
          can see the item.
      - If *tags* is ``None`` (anonymous), only items with
        ``visible_to_ranks = None`` are shown.
    """
    allowed = item.get("visible_to_ranks")
    if allowed is None:
        return True
    if tags is None:
        return False

    includes: set = set()
    excludes: set = set()
    for entry in allowed:
        e = entry.strip().lower()
        if e.startswith("!"):
            excludes.add(e[1:])
        else:
            includes.add(e)

    # Any exclude match → blocked
    if excludes & tags:
        return False
    # If there are explicit includes, user must match at least one
    if includes:
        return bool(includes & tags)
    # Only excludes were listed and the user didn't match any → visible
    return True

def _resolve_multi_quantity(item: dict) -> dict:
    """Inject ``allow_multi_quantity`` into an item dict (mutates a copy).

    Rules:
    - Only meaningful for bin items.
    - ``max_quantity`` must be a positive integer AND ``cooldown`` must be
      ``None`` for multi-quantity to be enabled.
    - If either condition is unmet, ``allow_multi_quantity`` is ``False``
      and ``max_quantity`` is normalised to ``None`` in the output.
    """
    item = dict(item)
    raw_mq = item.get("max_quantity")
    has_cooldown = parse_duration(item.get("cooldown")) is not None
    valid_mq = (
        isinstance(raw_mq, int)
        and not isinstance(raw_mq, bool)
        and raw_mq > 0
        and not has_cooldown
    )
    item["allow_multi_quantity"] = valid_mq
    item["max_quantity"] = raw_mq if valid_mq else None
    return item


def get_items(tags: set | None = None) -> list:
    """Return every catalogue item visible to a user with *tags*.

    Parameters
    ----------
    tags : set[str] or None
        Lowercased set of the user's applicable tags, e.g.
        ``{"knight", "citizen"}``.  ``None`` means anonymous / unknown 
        only universally-visible items are returned.

    Returns
    -------
    list[dict]
        Shallow copies of the matched item dicts, preserving JSON order.
    """
    _ensure_loaded()
    with _items_lock:
        return [_resolve_multi_quantity(item) for item in _items_list if _is_visible(item, tags)]

def get_item_unfiltered(item_id: str) -> dict | None:
    """Look up a single item by ID with no visibility check.

    Used by internal/admin code that must access items regardless of
    the user's rank (e.g. auction settlement, admin panel).
    """
    _ensure_loaded()
    with _items_lock:
        item = _items_by_id.get(item_id)
    if item is None:
        return None
    return _resolve_multi_quantity(item)


def get_item(item_id: str, tags: set | None = None) -> dict | None:
    """Look up a single item by ID, respecting visibility.

    Returns a shallow copy of the item dict, or ``None`` if the item does
    not exist or the given tags are not allowed to see it.
    """
    _ensure_loaded()
    with _items_lock:
        item = _items_by_id.get(item_id)
    if item is None:
        return None
    if not _is_visible(item, tags):
        return None
    return _resolve_multi_quantity(item)
