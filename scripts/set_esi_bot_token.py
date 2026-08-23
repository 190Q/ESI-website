"""
Update the ESI-Bot's Discord token, and the ESI-Bot's token alone.

This script edits exactly one key (DISCORD_TOKEN) in exactly one file: the
.env belonging to the ESI-Bot project (resolved the same way panel.py and
config.py resolve it, via ESI_BOT_DIR / the "../ESI-Bot" sibling checkout).
It never touches this website's own .env or Q-bot's .env, which is the
whole point - previous token mix-ups came from bot processes accidentally
inheriting an unrelated project's DISCORD_TOKEN.

The token itself is never accepted as a plain command-line argument (it
would otherwise leak into shell history and `ps` output). Instead:
  - By default you're prompted interactively with input hidden (getpass).
  - Or pass --token-stdin to pipe it in from a secret manager, e.g.:
        my-secret-tool get esi-bot-token | python3 scripts/set_esi_bot_token.py --token-stdin

A timestamped backup of the .env is written before any change, and the
new value is read back and compared after writing to confirm it landed
correctly. The token is only ever printed masked (first 6 / last 4 chars).

Examples:
    # Show whether ESI-Bot's .env currently has a token set (masked), no changes
    python3 scripts/set_esi_bot_token.py --show

    # Interactive, hidden-input change with a confirmation prompt
    python3 scripts/set_esi_bot_token.py

    # Non-interactive, piping the token in (e.g. from a secret manager)
    printf '%s' "$NEW_TOKEN" | python3 scripts/set_esi_bot_token.py --token-stdin -y
"""

from __future__ import annotations

import argparse
import getpass
import os
import re
import shutil
import sys
from datetime import datetime

from dotenv import get_key, set_key


def _project_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


ROOT = _project_root()
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from config import _ESI_BOT_DIR, BOT_SCREEN_SESSION  # noqa: E402

_ENV_KEY = "DISCORD_TOKEN"


def _mask(token: str | None) -> str:
    token = token or ""
    if not token:
        return "(not set)"
    if len(token) <= 10:
        return "*" * len(token)
    return f"{token[:6]}\u2026{token[-4:]}"


def _looks_like_bot_token(token: str) -> bool:
    token = (token or "").strip()
    return token.count(".") >= 2 and bool(re.fullmatch(r"[A-Za-z0-9_\-\.]{30,}", token))


def confirm(prompt: str, assume_yes: bool) -> bool:
    if assume_yes:
        return True
    try:
        ans = input(f"{prompt} [y/N]: ").strip().lower()
    except EOFError:
        return False
    return ans in ("y", "yes")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Update ONLY the ESI-Bot's DISCORD_TOKEN, in the ESI-Bot's own .env.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--show",
        action="store_true",
        help="Only show whether DISCORD_TOKEN is currently set (masked) and exit. No changes made.",
    )
    parser.add_argument(
        "--token-stdin",
        action="store_true",
        help="Read the new token from stdin (one line) instead of an interactive hidden prompt.",
    )
    parser.add_argument(
        "--yes",
        "-y",
        action="store_true",
        help="Skip the interactive confirmation prompt.",
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Do not write a timestamped backup of .env before modifying it.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Skip the basic Discord-bot-token shape sanity check.",
    )
    args = parser.parse_args()

    env_path = os.path.join(_ESI_BOT_DIR, ".env")
    print(f"ESI-Bot dir:  {_ESI_BOT_DIR}")
    print(f"Target file:  {env_path}")

    if not os.path.isfile(env_path):
        print(
            f"[ERROR] {env_path} does not exist. This script only edits an "
            "existing ESI-Bot .env file - it will not guess at, or create, "
            "one in the wrong place. Create it manually first if this is a "
            "fresh checkout.",
            file=sys.stderr,
        )
        return 2

    current = get_key(env_path, _ENV_KEY)

    if args.show:
        print(f"{_ENV_KEY} = {_mask(current)}")
        return 0

    if args.token_stdin:
        new_token = sys.stdin.readline().rstrip("\r\n")
    elif sys.stdin.isatty():
        new_token = getpass.getpass("New ESI-Bot Discord token (input hidden): ")
    else:
        print(
            "[ERROR] No TTY available for a hidden prompt. "
            "Pipe the token in with --token-stdin instead.",
            file=sys.stderr,
        )
        return 2

    new_token = (new_token or "").strip()
    if not new_token:
        print("[ERROR] Empty token, aborting.", file=sys.stderr)
        return 2

    if not args.force and not _looks_like_bot_token(new_token):
        print(
            "[ERROR] That doesn't look like a Discord bot token "
            "(expected dot-separated segments, 30+ characters total). "
            "Pass --force to bypass this check if you're sure.",
            file=sys.stderr,
        )
        return 2

    print(f"Current {_ENV_KEY}: {_mask(current)}")
    print(f"New     {_ENV_KEY}: {_mask(new_token)}")
    print(f"Affected screen session: {BOT_SCREEN_SESSION} (restart it after this to apply the change)")

    if not confirm("Write this token to ESI-Bot's .env now?", args.yes):
        print("Aborted.")
        return 0

    if not args.no_backup:
        backup_path = f"{env_path}.bak.{datetime.now().strftime('%Y%m%d%H%M%S')}"
        shutil.copy2(env_path, backup_path)
        print(f"Backup written: {backup_path}")

    ok, _, _ = set_key(env_path, _ENV_KEY, new_token, quote_mode="always")
    if not ok:
        print("[ERROR] Failed to update .env.", file=sys.stderr)
        return 1

    verify = get_key(env_path, _ENV_KEY)
    if verify != new_token:
        print(
            "[ERROR] Verification read-back did not match what was written. "
            "Please check the file manually before restarting the bot.",
            file=sys.stderr,
        )
        return 1

    try:
        os.chmod(env_path, 0o600)
    except OSError:
        pass

    print(f"{_ENV_KEY} updated in ESI-Bot's .env.")
    print(
        f"Restart the bot for it to take effect, e.g. via the control panel, "
        f"or: screen -S {BOT_SCREEN_SESSION} -X quit   (then start it again)"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
