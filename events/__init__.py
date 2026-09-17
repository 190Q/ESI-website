"""events package - auto-discovering temporary event hook modules.

Any ``*.py`` file placed in this folder is imported at startup.  Event modules can
register hooks by exposing these top-level lists:

* ``leaderboard_row_hooks`` - callables ``fn(row)`` that mutate a leaderboard
  player dict (keys include ``username``, ``points``, ``clean_ep``, ``rank``).
* ``ep_balance_hooks`` - callables ``fn(balance, uuid, is_high_rank)`` that
  mutate an EP balance dict (keys include ``clean_ep``, ``total_ep``,
  ``spendable_clean``).

Import errors in individual files are swallowed so deleting a file never breaks
the app.
"""

from __future__ import annotations

import importlib
import os
import pkgutil
from typing import Any, Callable

_EVENT_DIR = os.path.dirname(os.path.abspath(__file__))

LEADERBOARD_ROW_HOOKS: list[Callable[[dict], Any]] = []
EP_BALANCE_HOOKS: list[Callable[[dict, str, bool], Any]] = []


def _load_event_modules() -> None:
    """Import every module in this package and collect declared hook lists."""
    for _finder, name, _ispkg in pkgutil.iter_modules([_EVENT_DIR]):
        if name in ("__init__", "loader"):
            continue
        try:
            mod = importlib.import_module(f"events.{name}")
        except Exception:
            continue

        lb_hooks = getattr(mod, "leaderboard_row_hooks", None)
        if isinstance(lb_hooks, list):
            LEADERBOARD_ROW_HOOKS.extend(lb_hooks)

        ep_hooks = getattr(mod, "ep_balance_hooks", None)
        if isinstance(ep_hooks, list):
            EP_BALANCE_HOOKS.extend(ep_hooks)


def apply_leaderboard_row_hooks(row: dict) -> None:
    """Run all registered leaderboard-row hooks against ``row`` in place."""
    for hook in LEADERBOARD_ROW_HOOKS:
        try:
            hook(row)
        except Exception:
            pass


def apply_ep_balance_hooks(balance: dict, uuid: str, is_high_rank: bool) -> None:
    """Run all registered EP-balance hooks against ``balance`` in place."""
    for hook in EP_BALANCE_HOOKS:
        try:
            hook(balance, uuid, is_high_rank)
        except Exception:
            pass


_load_event_modules()
