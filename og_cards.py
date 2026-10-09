"""
og_cards.py - Open Graph preview card renderer.

Renders 1200x630 PNG cards for the player and guild pages so that pasting a
dashboard link into Discord (or any chat that unfurls links) shows a
personalised preview instead of the generic site logo.

Everything is best-effort: every public function returns ``None`` instead of
raising, so callers can fall back to a text-only preview.
"""

from __future__ import annotations

import base64
import html as _html
import os
import sys
import threading
import time

import requests

try:
    from config import _BASE_DIR, _OG_CACHE_DIR
except Exception:
    _BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    _OG_CACHE_DIR = os.path.join(_BASE_DIR, "data", "og_cache")


CARD_WIDTH = 1200
CARD_HEIGHT = 630

# How long a rendered card is reused before it is regenerated.
PLAYER_TTL = 3 * 3600
GUILD_TTL = 30 * 60

_MAX_CACHE_ENTRIES = 300


_IMAGE_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; ESI-Dashboard-OGCards/1.0)",
    "Accept": "image/png,image/webp,image/avif,image/*,*/*;q=0.8",
}

_AVATAR_MEM_TTL = 3600
_avatar_mem: dict = {}
_avatar_mem_lock = threading.Lock()


def _http_bytes(url: str, timeout: float = 8.0) -> bytes | None:
    try:
        resp = requests.get(url, timeout=timeout, headers=_IMAGE_HEADERS)
        if resp.ok and resp.content:
            return resp.content
    except requests.RequestException:
        pass
    return None


def _sniff_mime(content: bytes) -> str:
    if content[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if content[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    if content[4:12] in (b"ftypavif", b"ftypavis"):
        return "image/avif"
    if content[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return "image/png"


def _data_uri(content: bytes | None) -> str | None:
    if not content:
        return None
    mime = _sniff_mime(content)
    return f"data:{mime};base64,{base64.b64encode(content).decode('ascii')}"


def _avatar_data_uri(uuid: str | None) -> str | None:
    """Fetch a Minecraft head and inline it, so the render needs no network.

    Uses the same two providers as the site's own avatar proxy (crafatar, then
    mc-heads) and memoises the result in-process.
    """
    uuid = (uuid or "").strip()
    if not uuid:
        return None
    now = time.time()
    with _avatar_mem_lock:
        entry = _avatar_mem.get(uuid)
    if entry and now - entry[0] < _AVATAR_MEM_TTL:
        return entry[1]

    content = _http_bytes(f"https://crafatar.com/avatars/{uuid}?size=256&overlay")
    if content is None:
        content = _http_bytes(f"https://mc-heads.net/avatar/{uuid}/256")
    uri = _data_uri(content)

    with _avatar_mem_lock:
        _avatar_mem[uuid] = (now, uri)
        if len(_avatar_mem) > 500:
            cutoff = now - _AVATAR_MEM_TTL * 2
            for key in [k for k, v in _avatar_mem.items() if v[0] < cutoff]:
                del _avatar_mem[key]
    return uri


_EMBLEM_PATH = os.path.join(_BASE_DIR, "images", "guild_emblem.avif")
_emblem_cache = {"mtime": None, "uri": None}
_emblem_lock = threading.Lock()


def _emblem_data_uri() -> str | None:
    try:
        mtime = os.path.getmtime(_EMBLEM_PATH)
    except OSError:
        return None
    with _emblem_lock:
        if _emblem_cache["mtime"] == mtime:
            return _emblem_cache["uri"]
    try:
        with open(_EMBLEM_PATH, "rb") as fh:
            content = fh.read()
    except OSError:
        return None
    uri = _data_uri(content)
    with _emblem_lock:
        _emblem_cache["mtime"] = mtime
        _emblem_cache["uri"] = uri
    return uri


_FONT_DIR = os.path.join(_BASE_DIR, "public", "fonts")

_FONT_FACES = (
    ("Cinzel Decorative", "normal", 400, "cinzel-decorative-v19-latin-regular.woff2"),
    ("Cinzel Decorative", "normal", 700, "cinzel-decorative-v19-latin-700.woff2"),
    ("Cinzel Decorative", "normal", 900, "cinzel-decorative-v19-latin-900.woff2"),
    ("Cinzel", "normal", 400, "cinzel-v26-latin-regular.woff2"),
    ("Cinzel", "normal", 600, "cinzel-v26-latin-600.woff2"),
    ("Cinzel", "normal", 700, "cinzel-v26-latin-700.woff2"),
    ("Crimson Pro", "normal", 300, "crimson-pro-v28-latin-300.woff2"),
    ("Crimson Pro", "normal", 400, "crimson-pro-v28-latin-regular.woff2"),
    ("Crimson Pro", "normal", 600, "crimson-pro-v28-latin-600.woff2"),
    ("Crimson Pro", "italic", 300, "crimson-pro-v28-latin-300italic.woff2"),
    ("Crimson Pro", "italic", 400, "crimson-pro-v28-latin-italic.woff2"),
)

_fonts_cache = {"css": None}
_fonts_lock = threading.Lock()


def _fonts_css() -> str:
    """The site's default @font-face set, with each woff2 inlined."""
    with _fonts_lock:
        if _fonts_cache["css"] is not None:
            return _fonts_cache["css"]
    rules = []
    for family, style, weight, filename in _FONT_FACES:
        try:
            with open(os.path.join(_FONT_DIR, filename), "rb") as fh:
                payload = fh.read()
        except OSError:
            continue
        if not payload:
            continue
        encoded = base64.b64encode(payload).decode("ascii")
        rules.append(
            "@font-face{"
            f"font-family:'{family}';font-style:{style};font-weight:{weight};"
            "font-display:block;"
            f"src:url(data:font/woff2;base64,{encoded}) format('woff2');"
            "}"
        )
    css = "\n".join(rules)
    with _fonts_lock:
        _fonts_cache["css"] = css
    return css


def _og_int(value) -> int | None:
    try:
        return int(round(float(value)))
    except (TypeError, ValueError):
        return None


def _fmt_int(value) -> str:
    number = _og_int(value)
    return f"{number:,}" if number is not None else "\u2014"


def _fmt_hours(value) -> str:
    try:
        return f"{float(value):,.0f}h"
    except (TypeError, ValueError):
        return "\u2014"


def _stat(label: str, value: str) -> str:
    return (
        '<div class="og-stat">'
        f'<div class="og-stat-label">{_html.escape(label)}</div>'
        f'<div class="og-stat-value">{_html.escape(value)}</div>'
        "</div>"
    )

_CSS = r"""
:root{
  --gold:#D4A017;
  --gold-light:#F0C040;
  --gold-dim:#c28e16;
  --gold-rgb:212,160,23;
  --gold-glow:rgba(var(--gold-rgb),0.25);
  --green-deep:#0F2210;
  --parchment:#0D1A0D;
  --surface:#142114;
  --surface-2:#1C2E1C;
  --surface-3:#243624;
  --navbar-bg-mid:#112211;
  --text-main:#E8D8A0;
  --text-dim:#8faa90;
  --text-faint:#849b6e;
  --border:rgba(var(--gold-rgb),0.18);
  --border-mid:rgba(var(--gold-rgb),0.35);
  --online:#3BA55C;
  --online-rgb:59,165,92;
  --offline-border:#555;
  --offline-text:#888;
  --offline-rgb:100,100,100;
  --radius:6px;
  --font-display:'Cinzel Decorative',serif;
  --font-heading:'Cinzel',serif;
  --font-body:'Crimson Pro',Georgia,serif;
}
$FONTS
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{
  font-family:var(--font-body);
  font-weight:700;
  background:var(--parchment);
  color:var(--text-main);
}
.og-card{
  position:relative;width:1200px;height:630px;overflow:hidden;
  display:flex;flex-direction:column;
  background:var(--surface);
  background-image:radial-gradient(1100px 660px at 88% -20%,
    rgba(var(--gold-rgb),0.10) 0%, rgba(var(--gold-rgb),0) 60%);
  border:1px solid var(--border-mid);
  border-radius:var(--radius);
  color:var(--text-main);
}
.og-card::before{
  content:'';position:absolute;top:0;left:0;right:0;height:2px;z-index:3;
  background:linear-gradient(90deg,transparent,var(--gold),transparent);
}
/* navbar-style header (css/base.css .navbar) */
.og-top{
  position:relative;display:flex;align-items:center;justify-content:space-between;
  gap:24px;padding:17px 44px;
  background:linear-gradient(90deg,var(--green-deep) 0%,var(--navbar-bg-mid) 50%,var(--green-deep) 100%);
  border-bottom:2px solid var(--gold-dim);
}
.og-top::after{
  content:'';position:absolute;left:0;right:0;bottom:-5px;height:3px;opacity:.4;
  background:repeating-linear-gradient(90deg,transparent 0 8px,var(--gold-dim) 8px 10px);
}
.og-brand{display:flex;align-items:center;gap:12px;min-width:0}
.og-brand img{
  height:44px;width:auto;image-rendering:pixelated;
  filter:drop-shadow(0 0 8px var(--gold-glow));
}
.og-brand-text{display:flex;flex-direction:column;line-height:1;min-width:0}
.og-acronym{
  font-family:var(--font-display);font-weight:900;font-size:1.25rem;
  color:var(--gold-light);letter-spacing:0.12em;
  text-shadow:0 0 12px var(--gold-glow);
}
.og-fullname{
  font-family:var(--font-heading);font-weight:400;font-size:0.7rem;
  color:var(--text-dim);letter-spacing:0.18em;text-transform:uppercase;
  margin-top:3px;white-space:nowrap;
}
.og-status{
  flex:0 0 auto;display:inline-flex;align-items:center;gap:6px;
  font-family:var(--font-heading);font-weight:700;font-size:0.78rem;
  letter-spacing:0.06em;padding:4px 12px;border-radius:20px;
}
.og-status.online{
  background:rgba(var(--online-rgb),0.15);
  border:1px solid var(--online);color:var(--online);
}
.og-status.offline{
  background:rgba(var(--offline-rgb),0.1);
  border:1px solid var(--offline-border);color:var(--offline-text);
}
.og-level-chip{
  flex:0 0 auto;font-family:var(--font-heading);font-weight:600;font-size:0.8rem;
  letter-spacing:0.08em;color:var(--gold-light);
  background:var(--gold-glow);border:1px solid var(--border-mid);
  border-radius:20px;padding:5px 16px;
}
.og-body{
  position:relative;display:flex;flex-direction:column;
  flex:1 1 auto;padding:34px 44px 28px;
}
.og-main{flex:1 1 auto;display:flex;align-items:center;gap:28px}
.og-avatar{
  width:148px;height:148px;flex:0 0 148px;
  border:2px solid var(--border-mid);border-radius:var(--radius);
  background:var(--surface-3);overflow:hidden;
  display:flex;align-items:center;justify-content:center;
}
.og-avatar img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}
.og-avatar-fallback{
  font-family:var(--font-display);font-weight:900;font-size:3.4rem;
  color:var(--gold-dim);text-shadow:0 0 14px var(--gold-glow);
}
.og-identity{flex:1 1 auto;min-width:0}
.og-name{
  font-family:var(--font-display);font-weight:700;font-size:2.5rem;
  color:var(--gold-light);text-shadow:0 0 14px var(--gold-glow);
  line-height:1.28;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.og-sub{display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap}
.og-guild-tag{font-family:var(--font-heading);font-weight:600;font-size:0.9rem;color:var(--gold-light)}
.og-guild-rank{
  font-family:var(--font-heading);font-weight:400;font-size:0.78rem;
  color:var(--gold-dim);background:var(--gold-glow);
  border:1px solid var(--border);border-radius:3px;padding:2px 8px;
}
.og-muted{font-family:var(--font-body);font-style:italic;font-size:0.95rem;color:var(--text-dim)}
.og-rule{height:1px;background:var(--border);margin:0}
.og-stats{
  margin-top:26px;display:grid;grid-template-columns:repeat(4,1fr);gap:1px;
  background:rgba(var(--gold-rgb),0.06);
  border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;
}
.og-stat{background:var(--surface);padding:22px 24px;display:flex;flex-direction:column;gap:7px}
.og-stat-label{
  font-family:var(--font-heading);font-weight:400;font-size:0.72rem;
  letter-spacing:0.1em;text-transform:uppercase;color:var(--text-faint);
}
.og-stat-value{
  font-family:var(--font-heading);font-weight:700;font-size:1.65rem;
  color:var(--gold-light);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.og-foot{
  display:flex;align-items:center;justify-content:space-between;
  margin-top:22px;padding-top:16px;border-top:1px solid var(--border);
}
.og-foot-brand{
  font-family:var(--font-display);font-weight:700;font-size:0.78rem;
  color:var(--text-faint);letter-spacing:0.22em;text-transform:uppercase;
}
.og-foot-note{
  font-family:var(--font-heading);font-weight:400;font-size:0.72rem;
  color:var(--text-faint);letter-spacing:0.18em;text-transform:uppercase;
}
"""

_PLAYER_TEMPLATE = r"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>$CSS</style>
</head>
<body>
<div class="og-card">
  <div class="og-top">
    <span class="og-brand">$BRAND_EMBLEM<span class="og-brand-text">
      <span class="og-acronym">ESI</span>
      <span class="og-fullname">Empire of Sindria</span>
    </span></span>
    <span class="og-status $STATUS_CLASS">$STATUS</span>
  </div>
  <div class="og-body">
    <div class="og-main">
      <div class="og-avatar">$AVATAR</div>
      <div class="og-identity">
        <div class="og-name">$NAME</div>
        <div class="og-sub">$SUB</div>
      </div>
    </div>
    <div class="og-rule"></div>
    <div class="og-stats">$STATS</div>
    <div class="og-foot">
      <span class="og-foot-brand">Empire of Sindria</span>
      <span class="og-foot-note">Player Profile</span>
    </div>
  </div>
</div>
</body></html>"""

_GUILD_TEMPLATE = r"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>$CSS</style>
</head>
<body>
<div class="og-card">
  <div class="og-top">
    <span class="og-brand">$BRAND_EMBLEM<span class="og-brand-text">
      <span class="og-acronym">ESI</span>
      <span class="og-fullname">Empire of Sindria</span>
    </span></span>
    <span class="og-level-chip">$LEVEL_CHIP</span>
  </div>
  <div class="og-body">
    <div class="og-main">
      <div class="og-avatar">$AVATAR</div>
      <div class="og-identity">
        <div class="og-name">$NAME</div>
        <div class="og-sub">$SUB</div>
      </div>
    </div>
    <div class="og-rule"></div>
    <div class="og-stats">$STATS</div>
    <div class="og-foot">
      <span class="og-foot-brand">Empire of Sindria</span>
      <span class="og-foot-note">Guild Overview</span>
    </div>
  </div>
</div>
</body></html>"""


def _brand_emblem_html() -> str:
    emblem = _emblem_data_uri()
    return f'<img src="{emblem}" alt="">' if emblem else ""


def _build_player_html(data: dict) -> str:
    esc = _html.escape
    username = str(data.get("username") or "Unknown")
    guild_name = str(data.get("guild_name") or "").strip()
    guild_prefix = str(data.get("guild_prefix") or "").strip()
    guild_rank = str(data.get("guild_rank") or "").strip()
    rank_stars = str(data.get("guild_rank_stars") or "").strip()

    avatar_uri = _avatar_data_uri(data.get("uuid"))
    if avatar_uri:
        avatar_html = f'<img src="{avatar_uri}" alt="">'
    else:
        initial = (username[:1] or "?").upper()
        avatar_html = f'<span class="og-avatar-fallback">{esc(initial)}</span>'

    if guild_name or guild_prefix:
        bits = []
        if guild_name:
            bits.append(f'<span class="og-guild-tag">\u269c {esc(guild_name)}</span>')
        elif guild_prefix:
            bits.append(f'<span class="og-guild-tag">\u269c {esc(guild_prefix)}</span>')
        if guild_rank:
            stars = f" {esc(rank_stars)}" if rank_stars else ""
            bits.append(f'<span class="og-guild-rank">{esc(guild_rank)}{stars}</span>')
        sub = "".join(bits)
    else:
        sub = '<span class="og-muted">Not in a guild</span>'

    online = bool(data.get("online"))

    stats = "".join([
        _stat("Total Level", _fmt_int(data.get("total_level"))),
        _stat("Playtime", _fmt_hours(data.get("playtime_hours"))),
        _stat("Wars", _fmt_int(data.get("wars"))),
        _stat("Guild Raids", _fmt_int(data.get("guild_raids"))),
    ])

    html = _PLAYER_TEMPLATE
    html = html.replace("$CSS", _CSS.replace("$FONTS", _fonts_css()))
    html = html.replace("$BRAND_EMBLEM", _brand_emblem_html())
    html = html.replace("$AVATAR", avatar_html)
    html = html.replace("$NAME", esc(username))
    html = html.replace("$SUB", sub)
    html = html.replace("$STATUS_CLASS", "online" if online else "offline")
    html = html.replace("$STATUS", "Online" if online else "Offline")
    html = html.replace("$STATS", stats)
    return html


def _build_guild_html(data: dict) -> str:
    esc = _html.escape
    name = str(data.get("name") or "Empire of Sindria")
    prefix = str(data.get("prefix") or "ESI")
    level = _og_int(data.get("level"))

    emblem = _emblem_data_uri()
    if emblem:
        avatar_html = f'<img src="{emblem}" alt="">'
    else:
        avatar_html = f'<span class="og-avatar-fallback">{esc((prefix[:2] or "?").upper())}</span>'

    bits = []
    try:
        if data.get("xp_percent") is not None:
            bits.append(
                f'<span class="og-muted">{float(data["xp_percent"]):.0f}% to next level</span>'
            )
    except (TypeError, ValueError):
        pass
    sub = "".join(bits) or '<span class="og-muted">Wynncraft guild</span>'

    stats = "".join([
        _stat("Members", _fmt_int(data.get("members"))),
        _stat("Online Now", _fmt_int(data.get("online"))),
        _stat("Total Wars", _fmt_int(data.get("wars"))),
        _stat("Territories", _fmt_int(data.get("territories"))),
    ])

    html = _GUILD_TEMPLATE
    html = html.replace("$CSS", _CSS.replace("$FONTS", _fonts_css()))
    html = html.replace("$BRAND_EMBLEM", _brand_emblem_html())
    html = html.replace("$AVATAR", avatar_html)
    html = html.replace("$NAME", esc(name))
    html = html.replace("$SUB", sub)
    html = html.replace("$LEVEL_CHIP", f"Level {level}" if level is not None else prefix)
    html = html.replace("$STATS", stats)
    return html


_render_lock = threading.Lock()
_availability: dict = {"checked": False, "ok": False}


def is_available() -> bool:
    """Whether the Playwright renderer can be used at all (import check only)."""
    with _render_lock:
        if _availability["checked"]:
            return bool(_availability["ok"])
    try:
        import playwright.sync_api
        ok = True
    except Exception:
        ok = False
    with _render_lock:
        _availability["checked"] = True
        _availability["ok"] = ok
    return ok


def _screenshot_html(html: str) -> bytes | None:
    """Render one HTML document to PNG bytes. Returns None on any failure."""
    try:
        with _render_lock:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=True)
                try:
                    page = browser.new_page(
                        viewport={"width": CARD_WIDTH, "height": CARD_HEIGHT}
                    )
                    page.set_content(html, wait_until="load")
                    try:
                        page.evaluate("() => document.fonts.ready")
                    except Exception:
                        pass
                    card = page.query_selector(".og-card")
                    return card.screenshot(type="png") if card else None
                finally:
                    browser.close()
    except Exception as exc:
        print(f"[OG_CARDS] Render failed: {exc}", file=sys.stderr)
        return None


def _cache_path(kind: str, key: str) -> str:
    safe = "".join(ch for ch in (key or "") if ch.isalnum() or ch in "-_")[:64]
    return os.path.join(_OG_CACHE_DIR, f"{kind}_{safe or 'default'}.png")


def _read_cached(path: str, ttl: float) -> bytes | None:
    if ttl <= 0:
        return None
    try:
        if time.time() - os.path.getmtime(path) > ttl:
            return None
        with open(path, "rb") as fh:
            return fh.read() or None
    except OSError:
        return None


def _write_cached(path: str, data: bytes) -> None:
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "wb") as fh:
            fh.write(data)
        os.replace(tmp, path)
    except OSError:
        pass


def _prune_cache() -> None:
    """Drop the oldest cards once the cache grows past its cap."""
    try:
        names = [
            os.path.join(_OG_CACHE_DIR, n)
            for n in os.listdir(_OG_CACHE_DIR)
            if n.endswith(".png")
        ]
    except OSError:
        return
    if len(names) <= _MAX_CACHE_ENTRIES:
        return
    try:
        names.sort(key=os.path.getmtime)
    except OSError:
        return
    for path in names[: len(names) - _MAX_CACHE_ENTRIES]:
        try:
            os.remove(path)
        except OSError:
            pass


def _render_cached(kind: str, key: str, ttl: float, builder) -> bytes | None:
    path = _cache_path(kind, key)
    cached = _read_cached(path, ttl)
    if cached:
        return cached
    png = _screenshot_html(builder())
    if png:
        _write_cached(path, png)
        _prune_cache()
    return png


def render_player_card(data: dict, ttl: float = PLAYER_TTL) -> bytes | None:
    """Render (or return a cached) player preview card.

    ``data`` is the normalised dict built by routes.py: username, uuid,
    guild_name, guild_prefix, guild_rank, guild_rank_stars, online,
    total_level, playtime_hours, wars, guild_raids.
    """
    username = str(data.get("username") or "").strip()
    if not username:
        return None
    return _render_cached("player", username.lower(), ttl, lambda: _build_player_html(data))


def render_guild_card(data: dict, ttl: float = GUILD_TTL) -> bytes | None:
    """Render (or return a cached) guild preview card.

    ``data``: name, prefix, level, xp_percent, members, online, wars,
    territories.
    """
    return _render_cached("guild", "esi", ttl, lambda: _build_guild_html(data))
