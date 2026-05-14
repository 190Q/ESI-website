import html as _html
import sys
import threading

_pw_instance = None
_pw_browser = None
_pw_lock = threading.Lock()

CARD_WIDTH = 400


def _num(n):
    """Format an integer with comma separators."""
    return f"{int(n):,}"

_ICONS = {
    "check": (
        '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" '
        'stroke-linecap="round" stroke-linejoin="round">'
        '<polyline points="20 6 9 17 4 12"/></svg>'
    ),
    "warning": (
        '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" '
        'stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 '
        '1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>'
        '<line x1="12" y1="9" x2="12" y2="13"/>'
        '<line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
    ),
    "trophy": (
        '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.8" '
        'stroke-linecap="round" stroke-linejoin="round">'
        '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>'
        '<path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>'
        '<path d="M4 22h16"/>'
        '<path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/>'
        '<path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/>'
        '<path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>'
    ),
    "x": (
        '<svg viewBox="0 0 24 24" fill="none" stroke-width="2.5" '
        'stroke-linecap="round">'
        '<line x1="18" y1="6" x2="6" y2="18"/>'
        '<line x1="6" y1="6" x2="18" y2="18"/></svg>'
    ),
    "ban": (
        '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" '
        'stroke-linecap="round">'
        '<circle cx="12" cy="12" r="10"/>'
        '<line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>'
    ),
    "clock": (
        '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" '
        'stroke-linecap="round" stroke-linejoin="round">'
        '<circle cx="12" cy="12" r="10"/>'
        '<polyline points="12 6 12 12 16 14"/></svg>'
    ),
}

_TYPES = {
    "bid_placed": {
        "badge": "LEADING", "badge_color": "#4a9a5a",
        "icon": "check", "icon_color": "#4a9a5a",
        "title": "Bid Placed",
        "action": "BID CONFIRMED", "action_bg": "#1a4a3a",
        "amount_color": "#c9a227",
    },
    "outbid": {
        "badge": "OUTBID", "badge_color": "#c98a30",
        "icon": "warning", "icon_color": "#c98a30",
        "title": "You Were Outbid",
        "action": "OUTBID", "action_bg": "#5a2a1a",
        "amount_color": "#c98a30",
    },
    "auction_won": {
        "badge": "WON", "badge_color": "#c9a227",
        "icon": "trophy", "icon_color": "#c9a227",
        "title": "Congratulations",
        "action": "AUCTION WON", "action_bg": "#3a3010",
        "amount_color": "#c9a227",
    },
    "auction_lost": {
        "badge": "LOST", "badge_color": "#7a7a50",
        "icon": "x", "icon_color": "#7a7a50",
        "title": "Auction Ended",
        "action": "AUCTION ENDED", "action_bg": "#2a2a20",
        "amount_color": "#7a7a50",
    },
    "auction_cancelled": {
        "badge": "VOID", "badge_color": "#a04040",
        "icon": "ban", "icon_color": "#a04040",
        "title": "Auction Cancelled",
        "action": "CANCELLED", "action_bg": "#4a1515",
        "amount_color": "#7a7a50",
    },
    "ending_soon": {
        "badge": "ENDING", "badge_color": "#c9a227",
        "icon": "clock", "icon_color": "#c9a227",
        "title": "Ending Soon",
        "action": "ENDING SOON", "action_bg": "#3a3010",
        "amount_color": "#c9a227",
    },
    "snipe_extension": {
        "badge": "EXTENDED", "badge_color": "#c9a227",
        "icon": "clock", "icon_color": "#c9a227",
        "title": "Auction Extended",
        "action": "EXTENDED", "action_bg": "#3a3010",
        "amount_color": "#c9a227",
    },
    "disqualified": {
        "badge": "VOID", "badge_color": "#a04040",
        "icon": "x", "icon_color": "#a04040",
        "title": "Disqualified",
        "action": "DISQUALIFIED", "action_bg": "#4a1515",
        "amount_color": "#a04040",
    },
    "no_winner": {
        "badge": "CLOSED", "badge_color": "#7a7a50",
        "icon": "x", "icon_color": "#7a7a50",
        "title": "No Winner",
        "action": "AUCTION ENDED", "action_bg": "#2a2a20",
        "amount_color": "#7a7a50",
    },
    "purchase_rejected": {
        "badge": "REJECTED", "badge_color": "#a04040",
        "icon": "ban", "icon_color": "#a04040",
        "title": "Purchase Rejected",
        "action": "REJECTED", "action_bg": "#4a1515",
        "amount_color": "#a04040",
    },
    "donation_rejected": {
        "badge": "REJECTED", "badge_color": "#a04040",
        "icon": "ban", "icon_color": "#a04040",
        "title": "Donation Rejected",
        "action": "REJECTED", "action_bg": "#4a1515",
        "amount_color": "#a04040",
    },
    "bid_removed": {
        "badge": "REMOVED", "badge_color": "#a04040",
        "icon": "ban", "icon_color": "#a04040",
        "title": "Bid Removed",
        "action": "REMOVED", "action_bg": "#4a1515",
        "amount_color": "#a04040",
    },
    "purchase_fulfilled": {
        "badge": "FULFILLED", "badge_color": "#4a9a5a",
        "icon": "check", "icon_color": "#4a9a5a",
        "title": "Order Fulfilled",
        "action": "FULFILLED", "action_bg": "#1a4a3a",
        "amount_color": "#4a9a5a",
    },
    "donation_confirmed": {
        "badge": "CONFIRMED", "badge_color": "#4a9a5a",
        "icon": "check", "icon_color": "#4a9a5a",
        "title": "Donation Confirmed",
        "action": "CONFIRMED", "action_bg": "#1a4a3a",
        "amount_color": "#4a9a5a",
    },
}

# Uses $PLACEHOLDER markers replaced via str.replace to avoid CSS {} conflicts.
_TEMPLATE = r'''<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:transparent;font-family:'Segoe UI',system-ui,-apple-system,sans-serif}

.card{
  width:400px;
  background:#111a0f;
  border:1px solid rgba(201,162,39,0.22);
  border-radius:12px;
  overflow:hidden;
}
.inner{padding:22px 24px 0}

/* top row */
.top{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
.shop-lbl{font-size:11px;font-weight:600;letter-spacing:2.5px;text-transform:uppercase;color:#c9a227;opacity:.75}
.badge{font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;
  padding:3px 10px;border:1.5px solid;border-radius:4px}

/* icon */
.ico{width:44px;height:44px;border-radius:8px;display:flex;align-items:center;
  justify-content:center;margin-bottom:14px}
.ico svg{width:22px;height:22px}

/* text */
.title{font-size:20px;font-weight:700;color:#e0dcc8;margin-bottom:2px}
.sub{font-size:13px;color:#7a7a5a;margin-bottom:14px}
.amt{font-size:34px;font-weight:700;line-height:1.1;margin-bottom:2px}
.amt-lbl{font-size:11px;color:#5a5a42;margin-bottom:18px}

/* divider */
.div{height:1px;background:rgba(201,162,39,0.15);margin-bottom:14px}

/* stats grid */
.stats{display:grid;grid-template-columns:1fr 1fr;gap:10px 20px;margin-bottom:20px}
.st-lbl{font-size:9px;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:#5a5a42;margin-bottom:2px}
.st-val{font-size:14px;font-weight:600;color:#d0cbb8}

/* action bar */
.act{padding:13px 24px;text-align:center;font-size:12px;font-weight:700;
  letter-spacing:1.5px;text-transform:uppercase;color:#e0dcc8}

/* footer */
.foot{padding:8px 24px 14px;text-align:center;font-size:8px;letter-spacing:2.5px;
  text-transform:uppercase;color:#3a3a28}
</style>
</head>
<body>
<div class="card">
  <div class="inner">
    <div class="top">
      <span class="shop-lbl">ESI SHOP</span>
      <span class="badge" style="border-color:$BADGE_COLOR;color:$BADGE_COLOR">$BADGE_TEXT</span>
    </div>
    <div class="ico" style="background:$ICON_BG">
      $ICON_SVG
    </div>
    <div class="title">$TITLE</div>
    <div class="sub">$SUBTITLE</div>
    <div class="amt" style="color:$AMOUNT_COLOR">$AMOUNT_DISPLAY</div>
    <div class="amt-lbl">$AMOUNT_LABEL</div>
    <div class="div"></div>
    <div class="stats">
$STATS_HTML
    </div>
  </div>
  <div class="act" style="background:$ACTION_BG">$ACTION_TEXT</div>
  <div class="foot">EMPIRE OF SINDRIA &mdash; OFFICIAL NOTIFICATION</div>
</div>
</body></html>'''

def _build_html(
    cfg: dict,
    item_name: str,
    amount: int,
    amount_label: str,
    fields: list[tuple[str, str]],
) -> str:
    esc = _html.escape
    icon_color = cfg["icon_color"]
    icon_svg = _ICONS.get(cfg["icon"], "")
    # Inject stroke colour into the SVG
    icon_svg = icon_svg.replace("<svg ", f'<svg stroke="{icon_color}" ')

    # Compute a low-opacity background tint from the icon colour
    # Parse hex to rgb
    hc = icon_color.lstrip("#")
    r, g, b = int(hc[0:2], 16), int(hc[2:4], 16), int(hc[4:6], 16)
    icon_bg = f"rgba({r},{g},{b},0.08)"

    stats_html = ""
    for label, value in fields:
        stats_html += (
            f'      <div><div class="st-lbl">{esc(label)}</div>'
            f'<div class="st-val">{esc(value)}</div></div>\n'
        )

    html = _TEMPLATE
    html = html.replace("$BADGE_TEXT", esc(cfg["badge"]))
    html = html.replace("$BADGE_COLOR", cfg["badge_color"])
    html = html.replace("$ICON_BG", icon_bg)
    html = html.replace("$ICON_SVG", icon_svg)
    html = html.replace("$TITLE", esc(cfg["title"]))
    html = html.replace("$SUBTITLE", esc(item_name))
    html = html.replace("$AMOUNT_DISPLAY", esc(f"{_num(amount)} EP"))
    html = html.replace("$AMOUNT_COLOR", cfg["amount_color"])
    html = html.replace("$AMOUNT_LABEL", esc(amount_label))
    html = html.replace("$STATS_HTML", stats_html)
    html = html.replace("$ACTION_TEXT", esc(cfg["action"]))
    html = html.replace("$ACTION_BG", cfg["action_bg"])
    return html

def _screenshot_html(html: str) -> bytes | None:
    """Render HTML to PNG bytes using a headless Chromium page."""
    global _pw_instance, _pw_browser
    try:
        with _pw_lock:
            if _pw_instance is None:
                from playwright.sync_api import sync_playwright  # noqa: lazy
                _pw_instance = sync_playwright().start()
                _pw_browser = _pw_instance.chromium.launch(headless=True)
            page = _pw_browser.new_page(viewport={"width": CARD_WIDTH, "height": 1})
            page.set_content(html, wait_until="load")
            height = page.evaluate("() => document.body.scrollHeight")
            page.set_viewport_size({"width": CARD_WIDTH, "height": height})
            png = page.screenshot(type="png")
            page.close()
            return png
    except Exception as exc:
        print(f"[DM_CARDS] Render failed: {exc}", file=sys.stderr)
        return None

def render_card(
    card_type: str,
    item_name: str = "",
    amount: int = 0,
    amount_label: str = "amount",
    fields: list[tuple[str, str]] | None = None,
) -> bytes | None:
    """Render a notification card to PNG bytes.

    Parameters
    ----------
    card_type : str
        One of the keys in ``_TYPES``.
    item_name : str
        Displayed as the subtitle line.
    amount : int
        The large EP number.
    amount_label : str
        Tiny label below the amount (default "amount").
    fields : list of (label, value) tuples
        Two-column stats section below the divider.

    Returns
    -------
    bytes or None
        PNG image bytes, or None if rendering fails or card_type is unknown.
    """
    cfg = _TYPES.get(card_type)
    if not cfg:
        print(f"[DM_CARDS] Unknown card type: {card_type!r}", file=sys.stderr)
        return None
    html = _build_html(cfg, item_name, amount, amount_label, fields or [])
    return _screenshot_html(html)
