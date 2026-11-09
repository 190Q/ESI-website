"""Configuration for the chess tournament event."""

from __future__ import annotations

import math
import os

from config import _WEBSITE_DATA_DIR

# Discord IDs allowed into /events/manage/chess
MANAGER_IDS = frozenset({
    "967867229410574340",  # 190Q
})

_PACKAGE_DIR = os.path.dirname(os.path.abspath(__file__))

HTML_DIR = os.path.join(_PACKAGE_DIR, "html")
ASSETS_DIR = os.path.join(_PACKAGE_DIR, "static")
STATE_PATH = os.path.join(_WEBSITE_DATA_DIR, "chess_tournament.json")

DEFAULT_TITLE = "ESI Chess Tournament"
DEFAULT_DESCRIPTION = ""

MAX_PLAYERS = 128
MAX_NAME_LEN = 32
MAX_RATING = 4000
MAX_TITLE_LEN = 80
MAX_DESCRIPTION_LEN = 500
MAX_DATETIME_LEN = 32
MAX_ROUNDS = 20

# Empty string means the status is derived from the timestamps and rounds.
STATUS_OVERRIDES = ("", "upcoming", "ongoing", "finished")

ASSET_TYPES = {
    ".css": "text/css",
    ".js": "application/javascript",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
}


def is_manager(discord_id) -> bool:
    """True when *discord_id* is one of this event's managers."""
    if not discord_id:
        return False
    return str(discord_id).strip() in MANAGER_IDS


def default_round_count(player_count) -> int:
    """Swiss rounds for *player_count* players: ceil(log2(n)) + 1, at least 3."""
    try:
        count = int(player_count)
    except (TypeError, ValueError):
        count = 0
    if count < 2:
        return 3
    return max(3, math.ceil(math.log2(count)) + 1)
