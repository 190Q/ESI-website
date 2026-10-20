"""events package - auto-discovering temporary event hook modules.

Any ``*.py`` file placed in this folder is imported at startup.  Event modules can
register hooks by exposing these top-level lists:

* ``leaderboard_row_hooks`` - callables ``fn(row)`` that mutate a leaderboard
  player dict (keys include ``username``, ``points``, ``clean_ep``, ``rank``).
* ``ep_balance_hooks`` - callables ``fn(balance, uuid, is_high_rank)`` that
  mutate an EP balance dict (keys include ``clean_ep``, ``total_ep``,
  ``spendable_clean``).

Each module can be switched off without deleting or editing it, by setting
``enabled`` to ``false`` for its file name in ``data/event_toggles.json``::

    {"raid_event": {"enabled": false}}

A missing file, or a missing entry, means enabled.  A switched-off module is
still imported (so it can be inspected and listed) but none of its hooks are
registered, so the app behaves as if the event did not exist.  Import errors in
individual files are swallowed so deleting a file never breaks the app.
"""

from __future__ import annotations

import importlib
import os
import pkgutil
from typing import Any, Callable

from config import _EVENT_TOGGLES_JSON, _load_json_file, _save_json_file

_EVENT_DIR = os.path.dirname(os.path.abspath(__file__))
_SKIPPED_MODULES = ("__init__", "loader")

LEADERBOARD_ROW_HOOKS: list[Callable[[dict], Any]] = []
EP_BALANCE_HOOKS: list[Callable[[dict, str, bool], Any]] = []

# every module that imported, switched on or not: {name: module}
EVENT_MODULES: dict[str, Any] = {}


def list_event_modules() -> list[str]:
    """Return the name of every event module in this package (sorted)."""
    return sorted(
        name
        for _finder, name, _ispkg in pkgutil.iter_modules([_EVENT_DIR])
        if name not in _SKIPPED_MODULES
    )


def load_toggles() -> dict:
    """Return the toggle config from ``data/event_toggles.json`` (``{}`` if absent)."""
    data = _load_json_file(_EVENT_TOGGLES_JSON)
    return data if isinstance(data, dict) else {}


def _entry_enabled(entry: Any) -> bool:
    if isinstance(entry, dict):
        return bool(entry.get("enabled", True))
    if isinstance(entry, bool):
        return entry
    return True


def is_event_enabled(name: str) -> bool:
    """Return whether the event module *name* is switched on."""
    return _entry_enabled(load_toggles().get(name))


def set_event_enabled(name: str, enabled: bool) -> dict:
    """Switch the event module *name* on or off, returning its new entry."""
    toggles = load_toggles()
    entry = toggles.get(name)
    if not isinstance(entry, dict):
        entry = {}
    entry["enabled"] = bool(enabled)
    toggles[name] = entry
    _save_json_file(_EVENT_TOGGLES_JSON, toggles)
    return entry


def _load_event_modules() -> None:
    """Import every module in this package and collect the enabled hook lists."""
    toggles = load_toggles()
    for name in list_event_modules():
        try:
            mod = importlib.import_module(f"events.{name}")
        except Exception:
            continue
        EVENT_MODULES[name] = mod
        if not _entry_enabled(toggles.get(name)):
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
