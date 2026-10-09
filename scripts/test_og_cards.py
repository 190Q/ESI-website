"""
scripts/test_og_cards.py - render the link-preview cards so you can eyeball them.

Renders the Open Graph cards produced by ``og_cards.py`` straight to PNG files
in a folder you can open, bypassing the on-disk render cache so every run shows
the current styling.

By default it renders the guild card from live data (falling back to sample data
if Wynncraft can't be reached) plus a sample player card. Pass ``--player NAME``
to render real players instead.

Run:
    python scripts/test_og_cards.py
    python scripts/test_og_cards.py --player Salted --player 190Q
    python scripts/test_og_cards.py --sample --open
    python scripts/test_og_cards.py --out previews --open
"""

from __future__ import annotations

import argparse
import os
import struct
import sys
import time

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BASE_DIR not in sys.path:
    sys.path.insert(0, _BASE_DIR)

try:
    import og_cards
except Exception as exc:  # pragma: no cover - import failure is fatal here
    print(f"ERROR: could not import og_cards.py: {exc}")
    sys.exit(2)


GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
GREY = "\033[90m"
RESET = "\033[0m"


# A stand-in player, used when no --player is given or a live lookup fails.
# The UUID is a placeholder so the avatar renders; real runs use the real one.
SAMPLE_PLAYER = {
    "username": "Sample Player",
    "uuid": "069a79f4-44e9-4726-a5be-fca90e38aaf5",
    "guild_name": "Empire of Sindria",
    "guild_prefix": "ESI",
    "guild_rank": "Chief",
    "guild_rank_stars": "",
    "online": True,
    "total_level": 106,
    "playtime_hours": 1234.5,
    "wars": 4321,
    "guild_raids": 321,
}

SAMPLE_PLAYER_NO_GUILD = {
    "username": "Wanderer",
    "uuid": "069a79f4-44e9-4726-a5be-fca90e38aaf5",
    "guild_name": "",
    "guild_prefix": "",
    "guild_rank": "",
    "guild_rank_stars": "",
    "online": False,
    "total_level": 42,
    "playtime_hours": 87.0,
    "wars": 12,
    "guild_raids": 0,
}

SAMPLE_GUILD = {
    "name": "Empire of Sindria",
    "prefix": "ESI",
    "level": 78,
    "xp_percent": 42.5,
    "members": 122,
    "online": 9,
    "wars": 5678,
    "territories": 12,
}


def _png_size(data: bytes) -> tuple[int, int]:
    if len(data) < 24 or data[:8] != b"\x89PNG\r\n\x1a\n":
        return (0, 0)
    return struct.unpack(">II", data[16:24])


def _load_live_payloads():
    """Import the payload builders from routes.py. Returns (player_fn, guild_fn)."""
    try:
        import routes  # noqa: PLC0415 - deliberately lazy and optional
    except Exception as exc:
        print(f"{YELLOW}  live data unavailable ({type(exc).__name__}: {exc}){RESET}")
        return None, None
    return (
        getattr(routes, "_og_player_payload", None),
        getattr(routes, "_og_guild_payload", None),
    )


def _write(out_dir: str, name: str, png: bytes) -> str:
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, name)
    with open(path, "wb") as fh:
        fh.write(png)
    return path


def _render(out_dir: str, filename: str, label: str, builder, data: dict) -> bool:
    t0 = time.time()
    png = og_cards._screenshot_html(builder(data))
    elapsed = int((time.time() - t0) * 1000)
    if not png:
        print(f"  {RED}FAIL{RESET}  {label} - render returned nothing "
              "(is Chromium installed? try: playwright install chromium)")
        return False
    path = _write(out_dir, filename, png)
    w, h = _png_size(png)
    print(f"  {GREEN} OK {RESET}  {label}  {GREY}{w}x{h}, {len(png):,} bytes, "
          f"{elapsed}ms{RESET}")
    print(f"        {path}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--player", action="append", default=[], metavar="NAME",
                        help="render a real player card (repeatable)")
    parser.add_argument("--no-guild", action="store_true",
                        help="skip the guild card")
    parser.add_argument("--no-samples", action="store_true",
                        help="skip the built-in sample cards")
    parser.add_argument("--sample", action="store_true",
                        help="force sample data, never hit the network")
    parser.add_argument("--out", default=os.path.join(_BASE_DIR, "data", "og_card_previews"),
                        help="output folder (default: %(default)s)")
    parser.add_argument("--open", action="store_true",
                        help="open the output folder when finished")
    opts = parser.parse_args()

    if not og_cards.is_available():
        print(f"{RED}Playwright is not available.{RESET}")
        print("Install it with:  pip install playwright && playwright install chromium")
        return 1

    out_dir = os.path.abspath(opts.out)
    print(f"ESI link-preview card preview")
    print(f"{GREY}output: {out_dir}{RESET}")
    print()

    live_player = live_guild = None
    if not opts.sample:
        live_player, live_guild = _load_live_payloads()

    rendered = 0
    failed = 0

    # ---- guild card --------------------------------------------------------
    if not opts.no_guild:
        data = SAMPLE_GUILD
        label = "guild card (sample)"
        if live_guild is not None:
            try:
                live = live_guild()
            except Exception as exc:
                live = None
                print(f"{YELLOW}  guild lookup failed ({type(exc).__name__}: {exc}){RESET}")
            if live:
                data = live
                label = f"guild card ({live.get('name')} [{live.get('prefix')}])"
        if _render(out_dir, "guild.png", label, og_cards._build_guild_html, data):
            rendered += 1
        else:
            failed += 1

    # ---- requested players -------------------------------------------------
    for name in opts.player:
        data = None
        label = f"player card ({name})"
        if live_player is not None:
            try:
                data = live_player(name)
            except Exception as exc:
                print(f"{YELLOW}  lookup failed for {name} "
                      f"({type(exc).__name__}: {exc}){RESET}")
        if not data:
            print(f"  {YELLOW}SKIP{RESET}  {name} - not found (using nothing)")
            failed += 1
            continue
        safe = "".join(c for c in name if c.isalnum() or c in "-_") or "player"
        if _render(out_dir, f"player_{safe}.png", label,
                   og_cards._build_player_html, data):
            rendered += 1
        else:
            failed += 1

    # ---- sample players ----------------------------------------------------
    if not opts.no_samples and not opts.player:
        if _render(out_dir, "player_sample.png", "player card (sample, in guild)",
                   og_cards._build_player_html, SAMPLE_PLAYER):
            rendered += 1
        else:
            failed += 1
        if _render(out_dir, "player_sample_no_guild.png",
                   "player card (sample, no guild / offline)",
                   og_cards._build_player_html, SAMPLE_PLAYER_NO_GUILD):
            rendered += 1
        else:
            failed += 1

    print()
    print(f"{rendered} card(s) rendered" + (f", {failed} failed" if failed else ""))
    print(f"Open the folder to view them: {out_dir}")

    if opts.open:
        try:
            if sys.platform == "win32":
                os.startfile(out_dir)  # type: ignore[attr-defined]
            elif sys.platform == "darwin":
                os.system(f'open "{out_dir}"')
            else:
                os.system(f'xdg-open "{out_dir}" >/dev/null 2>&1')
        except Exception as exc:
            print(f"{YELLOW}could not open the folder: {exc}{RESET}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
