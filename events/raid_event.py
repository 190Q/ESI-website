from __future__ import annotations
from datetime import datetime, timezone

EVENT_START = datetime(2026, 10, 3, 0, 0, 0, tzinfo=timezone.utc)
EVENT_END = datetime(2026, 11, 3, 0, 0, 0, tzinfo=timezone.utc)

LOW_RANK_BONUS = 5
HIGH_RANK_BONUS = 5

_POINTS_HR_RANKS = {"strategist", "chief", "owner"}


def _is_event_active(now: datetime | None = None) -> bool:
    if now is None:
        now = datetime.now(timezone.utc)
    return EVENT_START <= now < EVENT_END


def _bonus_for_rank(is_high_rank: bool) -> int:
    return HIGH_RANK_BONUS if is_high_rank else LOW_RANK_BONUS


def _is_high_rank_row(row: dict) -> bool:
    rank = (row.get("rank") or "").strip().lower()
    return rank in _POINTS_HR_RANKS


def _leaderboard_row_hook(row: dict) -> None:
    if not _is_event_active():
        return
    points = int(row.get("points") or 0)
    if points <= 0:
        return
    bonus = _bonus_for_rank(_is_high_rank_row(row))
    if bonus <= 0:
        return
    row["clean_ep"] = int(row.get("clean_ep", 0) or 0) + bonus
    row["points"] = int(row.get("points", 0) or 0) + bonus


def _ep_balance_hook(balance: dict, _uuid: str, is_high_rank: bool) -> None:
    if not _is_event_active():
        return
    bonus = _bonus_for_rank(is_high_rank)
    if bonus <= 0:
        return
    balance["clean_ep"] = int(balance.get("clean_ep", 0) or 0) + bonus
    balance["total_ep"] = int(balance.get("total_ep", 0) or 0) + bonus
    balance["spendable_clean"] = int(balance.get("spendable_clean", 0) or 0) + bonus


leaderboard_row_hooks = [_leaderboard_row_hook]
ep_balance_hooks = [_ep_balance_hook]
