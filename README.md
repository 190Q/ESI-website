# ESI Dashboard

A guild management dashboard for **Empire of Sindria**, a guild on the MMORPG [Wynncraft](https://wynncraft.com/). It pulls live and historical data from the Wynncraft API, tracks player and guild activity over time, runs the guild's EP shop, and gives higher-ranked members the tools they need to manage the guild without digging through spreadsheets.

The dashboard is **designed to be used in combination with [ESI-Bot](https://github.com/190Q/ESI-Bot)**, the separate Discord bot that collects the guild's historical snapshots, EP, and roster data that the site reads from. That said, it **can also run entirely on its own**: live Wynncraft API lookups, Discord login, events, and the public panels all work without the bot, and only the history, points, and shop features go empty when it isn't present.

---

## What it does

The dashboard is split into panels, reachable from a collapsible sidebar:

- **Player Stats**: look up any player's rank history, playtime, medals, decorations, and in-game metrics (wars, dungeons, raids, mobs killed, quests, etc.) with interactive graphs. Supports comparing two players side-by-side.
- **Guild Stats**: guild-wide graphs for active player count, wars, guild raids, member growth, territory history, aspect debt, and the ESI points leaderboards.
- **Bot Panel**: status and health of the ESI-Bot and its four trackers (API, Playtime, Guild, Claim), plus Discord stats, database sizes, and IP-ban info.
- **Events** *(public)*: the guild's event calendar, with sign-ups, pinned events, and Discord scheduled-event / voice-channel integration.
- **Shop**: guild members spend EP (Experience Points) earned from gameplay cycles to buy items or bid in auctions. Includes a cart, server-side EP balance with clean/dirty split, LE-to-EP donations, per-item cooldowns, refunds, and rank/top-N visibility gating. All Discord DMs use branded image cards.
- **Creator Studio** *(approved Creators)*: members apply to become Creators, then submit item create/edit requests for review and self-fulfil orders for their own items (earning a commission).
- **Manage Shop** *(Chief+ / Parliament+)*: full catalogue CRUD, stock/active overrides, auction management, the fulfilment queue, refunds, user bans/notes/EP adjustments, the death-tax graveyard, per-user shop-admin permissions, and an audit log.
- **Guild Info** *(Parliament / Emperor)*: a queue-based editor for the guild's Discord forum posts. Requests are staged, reviewed, and applied to Discord by the bot token, with before/after snapshots in an audit log.
- **Inactivity** *(Parliament+)*: track members who have declared inactivity, with start/end dates and reasons.
- **Promotions** *(Juror+)*: promotion tracking tools.
- **Settings**: persistent preferences for graph defaults, player lookup, and toast notifications, stored in `localStorage`. Users can also upload custom colour themes and fonts.
- **Control Panel** (separate service, owner-only): an ops dashboard for starting/stopping/reloading the services and bots, running maintenance scripts, and viewing web + bot analytics. Only the `OWNER` Discord account can load or use it — everyone else gets a 404.

Authentication is Discord OAuth2. Public stats and events are open to everyone; management panels are gated by guild role (and the shop has an additional per-user privilege layer).

### Custom themes & fonts

Users can upload their own `.css` files via Settings to override the default colour theme or font. Example files live in `public/examples/`:

- **`public/examples/themes/dark.css`** — a dark colour theme. Override any of the CSS custom properties from `css/themes.css` inside a `[data-theme="your-name"]` selector. Only include the variables you want to change; the rest fall through to the defaults. Includes pattern controls powered by `js/theme-patterns.js` (`--theme-pattern-*`).
- **`public/examples/fonts/cormorant-font.zip`** — a custom font, bundled the way the dashboard expects. Include `@font-face` declarations, then map the three font variables (`--font-display`, `--font-heading`, `--font-body`) inside a `[data-font="your-name"]` selector.

#### Custom fonts

Custom fonts are uploaded as a **`.zip`** holding the `.css` plus the font files (`.woff2`, `.woff`, `.ttf`, `.otf` or `.eot`). Inside the CSS, reference each font by **name only** — the extension and the `format()` are read from the file itself, so neither is needed:

```css
@font-face {
  font-family: 'My Font';
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(my-font-bold);
}
```

`url(my-font-bold)` resolves to `my-font-bold.woff2` (or `.woff`/`.ttf`/…) inside the zip. The dashboard inlines each font as a base64 `data:` URI and stores the finished CSS in `localStorage` (`esi_custom_font_css`), so the font is **never uploaded to or served from the server**. This is why `main.py` and `routes.py` allow `data:` in their `font-src` CSP directive. A self-contained `.css` with no local `url()` references can still be uploaded on its own.

Uploads are rejected with a specific message when the CSS names font files but the upload isn't a `.zip`, when the `.zip` has no `.css` inside, when the `.zip` doesn't contain the named font files, or when the fonts exceed the browser's `localStorage` quota (~5 MB per origin).

`public/examples/fonts/cormorant-font.zip` is built from the `public/examples/fonts/cormorant-font/` folder — re-zip it whenever that folder changes.

The `data-theme` / `data-font` attribute value is used as the display name in the settings dropdown; if absent, the filename is used.

---

## Architecture

The site runs as **four independent Flask processes**. Splitting them means the public gateway can stay up while the API or cache restarts, and the control panel keeps working even when everything else is down.

| Process | Port | Role |
|---|---|---|
| `main.py` — **Gateway** | 5000 | Public entry point. Serves static files and the SPA shell, reverse-proxies `/api/*` and `/auth/*` to the routes service, and applies the security gate (IP bans, scanner/WordPress-probe blocking, injection detection, CSP headers). Also records every served request into analytics. |
| `routes.py` — **Routes** | 5001 | All `/api/*` and `/auth/*` endpoints: Wynncraft API proxying + caching, Discord OAuth, guild/player data, shop, events, guild info, inactivity, promotions, settings, tracking. |
| `cache.py` — **Cache** | 5002 | Periodically crunches bulk playtime / stat deltas for every guild member and exposes them over HTTP, so routes never has to hammer the Wynncraft API or the snapshot databases. |
| `panel.py` — **Control Panel** | 5003 | Standalone owner-only ops dashboard. Own Discord OAuth + `OWNER` access check; the shell and its assets are not served to non-owners. Starts, stops, and reloads the other services and bots (via `screen`), runs maintenance scripts, and serves the analytics views. Never imports the other services, so it works while they're down. |

```
Browser ──▶ Gateway :5000 ──▶ Routes :5001 ──▶ Cache :5002
                │                  │
                └─ static/SPA      └─ Wynncraft API, Discord API,
                   + security         ESI-Bot databases, SQLite
                   + analytics
Owner ────▶ Panel :5003 (independent; controls the processes above, and more)
```

Shared configuration and constants live in `config.py`; the security gate is shared via `security_gate.py`.

---

## Stack

**Frontend**
- React 19 + Vite 6 shell (`frontend/`) for the navbar, sidebar, and the player / guild / bot panels
- The remaining panels are plain HTML/CSS/JS modules under `js/`, mounted into the React shell by `useScriptLoader`
- Custom CSS across multiple files (`base.css`, `player.css`, `guild.css`, `shop.css`, …)
- Canvas-based graphs via a shared `graph-shared.js` module
- Local fonts (Cinzel, Crimson Pro, Inter, Monocraft) under `public/fonts/`

**Backend**
- Python + Flask
- SQLite (WAL mode) for user data, shop, analytics, guild info, and the ESI-Bot's historical data
- In-memory caching with TTLs and threading locks; `cache.py` precomputes bulk data
- Discord OAuth2 for login/session management
- Discord bot API for DMs, role/badge sync, and Guild Info forum posts
- Rate limiting on activity endpoints (per-IP, 30s window)
- Playwright for rendering branded DM notification card images
- Fail2ban-style IP banning, request/security logging, and a first-party analytics pipeline

---

## Setup

### Requirements

- Python 3.10+
- Node.js 18+ and npm
- Linux is assumed for the production scripts (`screen`, `python3`, `bash`). The app also runs on Windows for local development; `config.py` handles Windows paths and there's a PowerShell test wrapper.

### 1. Check out the sibling projects

The dashboard reads its historical data from a local **[ESI-Bot](https://github.com/190Q/ESI-Bot)** checkout and the control panel can manage a local **Q-bot** checkout. Both are resolved as siblings of this repo (or via env vars):

```
coding/
├── ESI-website/     ← this repo
└── ESI-Bot/         ← provides data/ and databases/
```

Set `ESI_BOT_DIR` / `ESI_QBOT_DIR` if your layout differs. Without an ESI-Bot checkout, live player lookups still work but history, points, and shop data will be empty.

### 2. Python environment

```bash
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium       # needed for shop DM cards
```

`requirements.txt` is a full environment freeze (it includes the ESI-Bot's dependencies too), so installing it is the easiest way to get everything at once. Playwright is used lazily — DM cards fall back to plain text if Chromium isn't installed.

### 3. Build the frontend

```bash
cd frontend
npm install
npm run build
cd ..
```

`vite build` writes to `dist/`, then `scripts/sync-build-output.mjs` copies `dist/index.html` → `index.html` and `dist/assets/` → `assets/` in the project root, where the gateway serves them. `assets/` is gitignored, so run a build after every checkout.

For frontend development, `npm run dev` serves the app with HMR (proxying API calls to the running backend).

### 4. Configure environment variables

Create a `.env` at the project root. At minimum you need a Discord application set up at [discord.com/developers](https://discord.com/developers/applications):

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_GUILD_ID=your_guild_id
DISCORD_REDIRECT_URI=https://your-domain.com/auth/callback

# Discord user ID (or @mention) of the site owner — unlocks the control panel
# and the highest shop-admin tier.
OWNER=123456789012345678
```

Common optional variables:

| Variable | Purpose |
|---|---|
| `ESI_BOT_DIR` / `ESI_QBOT_DIR` | Absolute paths to the ESI-Bot / Q-bot checkouts (default: sibling folders). |
| `PANEL_PORT` | Control panel port (default `5003`). |
| `PANEL_ALLOWED_IPS` | Optional comma-separated source-IP allowlist for the panel, on top of Discord auth. |
| `FLASK_SECRET_KEY` | Session key, shared by the website and the control panel (they use one login); auto-generated and persisted to `.flask_secret` if unset. |
| `ESI_GATEWAY_SECRET` | Internal secret shared between the gateway and routes (auto-generated if unset). |
| `ESI_INTERNAL_BULK_TOKEN` | Shared token guarding the internal bulk-cache endpoint. |
| `ESI_RUN_AUCTION_WORKER` | Force the auction-close worker on/off (default: on except in dev mode). |
| `ESI_BOT_SCREEN_NAME` / `ESI_TRACKERS_SCREEN_NAME` | `screen` session names the panel controls (defaults `esi-bot`, `esi-bot-trackers`). |
| `ESI_SERVER_TIMEZONE` / `TZ` | Timezone used when displaying dates (defaults to the system zone). |
| `DEV_MODE` | Enables dev-only routes such as `/auth/dev-login`. Auto-enabled when the redirect URI points at localhost. **Never enable in production.** |
| `GITHUB_TOKEN` / `GITHUB_REPO` | Used for optional GitHub-backed features (default repo `190Q/ESI-website`). |
| `ESI_MAX_GRAIDS_PER_DAY`, `ESI_GRAID_*` | Tuning for the guild-raid delta sanity checks in `cache.py`. |

### 5. Run it

Start each service (in its own terminal, or use the scripts below):

```bash
python3 cache.py      # :5002
python3 routes.py     # :5001
python3 main.py       # :5000  ← open this one
python3 panel.py      # :5003  (optional, owner only)
```

Then open [http://localhost:5000](http://localhost:5000).

### Local testing

`.env` holds the production values and lives only on the server. To run the same code locally without editing `.env`, drop a `.env.local` file next to it — `config.py` loads `.env.local` after `.env` and lets it override any variable. `.env.local` is gitignored.

A minimal `.env.local` only needs to redirect OAuth at localhost:

```env
DISCORD_REDIRECT_URI=http://localhost:5000/auth/callback
```

Register `http://localhost:5000/auth/callback` as an OAuth2 redirect on your Discord application. With a localhost redirect, `DEV_MODE` auto-enables and `/auth/dev-login` lets you impersonate any Discord user locally.

Two test runners are available:

```bash
# HTTP/API smoke + contract tests (needs a running gateway)
python3 scripts/test_local.py --base http://localhost:5000 --verbose
#   Windows wrapper:  .\scripts\test-local.ps1 -Start -Stop

# Full UI interaction tests via Playwright
pip install playwright && playwright install chromium
python3 scripts/test_ui.py --headed --slowmo 250
```

---

## Running the services

The `scripts/` folder has bash helpers for the production server:

| Script | What it does |
|---|---|
| `start.sh` | Start cache → routes → gateway in the foreground; Ctrl+C stops all. |
| `stop.sh` | Kill the three website processes. |
| `reload.sh` | Restart one or all of `cache` / `routes` / `gateway` (`./reload.sh routes`). |
| `screen-start.sh` | Start each service (and the panel) in its own named `screen` session, with logs teed to `logs/`. |
| `screen-reload.sh` | Restart one or all screen sessions (`./screen-reload.sh routes cache`). |
| `screen-stop.sh` | Stop all `esi-website-*` screen sessions. |
| `screen-logs.sh` | Live, filtered, colourised log monitor (attach with `screen -r esi-website-logs`). |

Attach to a service with `screen -r esi-website-routes`, detach with `Ctrl+A D`.

---

## Control panel

`panel.py` is a self-contained ops dashboard for the site owner only. It is fully independent of the website processes, so it can restart them even when they're down.

- **Website**: start/stop/reload the gateway, routes, and cache, with live logs and event feeds.
- **Bots**: start/stop/reload ESI-Bot, Q-Bot, and the ESI-Bot trackers.
- **Analytics**: traffic, audience, engagement, content, health, and data views over `analytics.db`, plus ESI-Bot analytics read directly from the bot's databases and logs.
- **Tools**: run and stop the maintenance scripts in `scripts/` and stream their output.

The panel shares the website's login. It uses the same session cookie and the same `esi_remember` token (a 30-day sliding window stored in `user_data.db`), so signing in on either surface signs you in on both, and when the session lapses the panel silently rebuilds it from that token instead of asking you to log in again. Logging out of the panel also logs you out of the website, since the token is common to both. There is also an optional IP allowlist on top of Discord auth.

---

## Project structure

```
ESI-website/
├── main.py                  # Gateway (:5000) — static + SPA + security + analytics
├── routes.py                # Routes (:5001) — all /api/* and /auth/* endpoints
├── cache.py                 # Cache (:5002) — precomputed bulk playtime/metrics
├── panel.py                 # Control panel (:5003) — ops dashboard
├── config.py                # Shared config, role IDs, badge/medal definitions, helpers
├── security_gate.py         # Shared request-gating security for public services
├── ip_ban.py                # Fail2ban-style IP strikes / bans / blacklist
├── access_logger.py         # Blocked-request logging (anonymised IPs)
├── analytics.py             # Analytics write path (batched, privacy-preserving)
├── analytics_query.py       # Analytics read path (panel queries)
├── bot_analytics.py         # ESI-Bot analytics reader
├── frontend/                # React 19 + Vite shell (source)
├── index.html               # generated by the frontend build
├── assets/                  # generated by the frontend build (gitignored)
├── js/                      # vanilla JS panel modules (player, guild, shop, events, …)
├── css/                     # stylesheets, incl. css/themes/ and css/fonts/
├── images/                  # emblems, icons, medal images
├── public/                  # fonts + example custom themes/fonts
├── shop/                    # guild shop package
│   ├── README.md            # shop architecture docs
│   ├── items.py             # item catalogue loader
│   ├── ep_balance.py        # EP balance computation
│   ├── bin.py               # fixed-price purchases + cart checkout
│   ├── auction.py           # auctions, bidding, settlement, DMs
│   ├── cart.py              # server-side cart persistence
│   ├── donate.py            # LE-to-EP donation tickets
│   ├── orders.py            # order history
│   ├── admin.py             # admin operations
│   ├── creator.py           # Creator applications + item requests
│   ├── leaderboard.py       # per-cycle leaderboard cache
│   ├── death_tax.py         # wipe EP 14 days after leaving
│   ├── knight_bonus.py      # one-time Knight promotion bonus
│   ├── cycle_announcement.py# end-of-cycle Discord announcements
│   ├── state.py             # shop on/off + maintenance settings
│   └── dm_cards.py          # branded DM card renderer (HTML → PNG)
├── guild_info/              # Discord forum post management (db / forum / admin)
├── events/                  # auto-discovered temporary event hook modules
├── wynnpiece/               # standalone Wynn Piece special-event mini-site
├── panel_static/            # control panel frontend (shell + per-panel modules)
├── scripts/                 # start/stop/reload helpers, CLI tools, test runners
├── data/                    # runtime data (JSON + databases/, gitignored)
├── logs/                    # service logs, access.db, ip_bans.db (gitignored)
└── uploads/                 # user uploads (gitignored)
```

### Notable packages

- **`shop/`** — the EP economy: catalogue, purchases, auctions, donations, carts, refunds, the Creator Studio, the death tax, and Knight bonuses. See `shop/README.md` for the full architecture and EP-balance model.
- **`guild_info/`** — manages the guild's Discord forum posts through an approval queue. `forum.py` splits long bodies across multiple Discord messages and rewrites mention tokens; `admin.py` orchestrates create/edit/delete requests; `db.py` stores pending requests and the audit log.
- **`events/`** — any `*.py` file dropped here is auto-imported at startup and may register `leaderboard_row_hooks` / `ep_balance_hooks` to add temporary bonuses (see `events/raid_event.py`).
- **`wynnpiece/`** — a self-contained, obfuscated puzzle/lore mini-site for a limited-time guild event, with its own Flask blueprint, progression state, and build tooling.

---

## Data stores

The dashboard keeps its own state locally and reads the bot's historical data read-only.

**Owned by this app**
- `user_data.db` — sessions, remember-me tokens, GDPR restriction records.
- `data/databases/shop.db` — shop state (purchases, auctions, bids, EP reservations, carts, donations, overrides, creator data, death-tax queue, settings, audit log).
- `data/databases/cemetery.db` — players whose EP was wiped by the death tax.
- `data/databases/analytics.db` — request/event/error analytics.
- `data/databases/guild_info.db` — forum edit requests + audit log.
- `data/*.json` — `shop_items.json`, `events.json`, `applications.json`, `medals.json`, `frontend_metric_masks.json`.
- `logs/access.db`, `logs/ip_bans.db` — blocked requests and ban state.
- `wynnpiece/wynnpiece.db`, `wynnpiece/event_state.json`, `wynnpiece/managers.json`.

**Read from the ESI-Bot checkout** (`ESI_BOT_DIR`)
- `databases/api_tracking/` — daily player/guild snapshots.
- `databases/playtime_tracking/` — daily playtime snapshots.
- `databases/esi_points.db` — earned EP per cycle.
- `databases/claim_snipes.db`, `rank_changes.db`, `recruited_data.db`, and more.
- `data/*.json` — `username_matches.json`, `tracked_guild.json`, `guild_territories.json`, `guild_levels.json`, `inactivity_exemptions.json`, `aspects.json`.

Databases are created automatically on first use (WAL mode). They are **not** included in this repo.

---

## API surface

`routes.py` is the source of truth for the full route list; the table below summarises it by area. Routes marked 🔒 require a Discord login, and 👑 require a specific guild role.

| Area | Representative routes |
|---|---|
| Auth | `/auth/login`, `/auth/callback`, `/auth/session`, `/auth/refresh`, `/auth/logout`, `/auth/dev-login` (dev only) |
| Config | `/api/config`, `/api/appearance-catalog`, `/api/settings`, `/api/settings/default-player` |
| Player | `/api/player/<username>` and `/rank-history`, `/playtime-history`, `/metrics-history`, `/points`, `/medals`, `/decorations`, `/snipes`; public aliases under `/api/player/rank-history|playtime|metrics/<username>` |
| Guild | `/api/guild/stats`, `/statistics`, `/activity`, `/member-history`, `/levels`, `/territories`, `/snipes`, `/aspects` (+`/clear`), `/points`, `/metrics-since-join[/<metric>]`, `/prefix/<prefix>[/metrics-history]`, `/name/<name>` |
| Inactivity | `/api/inactivity` (GET/POST), `/api/inactivity/<discord_id>` (PATCH/DELETE), `/api/inactivity/players` |
| Events | `/api/events` (GET/POST), `/api/events/<id>` (GET/PATCH/DELETE), `/status`, `/pin`, `/api/events/public`, `/api/events/pinned`, `/api/discord/voice-channels`, `/api/discord/scheduled-event` |
| Applications / misc | `/api/applications`, `/api/ticket`, `/api/upload`, `/api/proxy/avatar/<uuid>` |
| Shop (user) | `/api/shop/state`, `/bin`, `/bin/purchase`, `/bin/cart/checkout`, `/cart`, `/auctions`, `/auctions/bid`, `/donate`, `/donations`, `/orders`, `/orders/refund`, `/api/me/ep-balance`, `/api/me/shop-stats`, `/api/me/badge-progress` |
| Creator Studio | `/api/shop/creator-apply[/status]`, `/creator/my-items`, `/creator/my-requests`, `/creator/my-orders`, `/creator/orders/<id>/fulfill\|reject`, `/creator/upload-image`, `/creator/request-item`, `/creator/items/<id>/stock\|active` |
| Shop admin 👑 | `/api/admin/shop/*` — items CRUD/reorder/override/upload-image, auctions start/extend/close/detail, bids remove, queue fulfil/reject/refund, reservations, logs, changes, cemetery, death-tax, users (ban/unban/notes/limits/ep-adjust/permissions), config, state, maintenance-settings, privilege approvals, creators & creator requests |
| Bot | `/api/bot/status`, `/trackers`, `/info`, `/discord`, `/databases`, `/ip-bans` |
| Guild Info 👑 | `/api/admin/guild-info/*` — state, posts CRUD, queue approve/deny, privilege requests, logs |
| Wynn Piece | `/api/wynnpiece/*` — event progression, attachments, feedback, manager tools |
| Tracking | `/api/track/token`, `/api/track` (client analytics beacon) |

The control panel exposes its own routes under `/panel/*` (auth, service control, scripts, and analytics) on port 5003.

---

## Security & privacy

- **IP banning** (`ip_ban.py`): fail2ban-style strikes per jail (10 × 403 in 5 min, 20 × 429 in 5 min), escalating ban durations, and an automatic permanent blacklist after repeated offences. Whitelist entries can be added in `ip_whitelist.txt`.
- **Request gate** (`main.py` / `security_gate.py`): blocks banned methods, malformed HTTP, request smuggling, injection/traversal payloads, WordPress and exploit-scanner probes, and debugger triggers; only trusts `X-Forwarded-For` / `CF-Connecting-IP` from nginx or Cloudflare peers.
- **Security headers**: a strict Content-Security-Policy (with hashes computed from the built `index.html`), `X-Frame-Options: DENY`, `nosniff`, and a strict referrer policy.
- **Analytics privacy** (`analytics.py`): raw IPs are never stored — only a salted hash with a daily-rotating salt, so unique visitors can be counted per day but not tracked across days. `DNT`/`GPC` signals are recorded.
- **Logging**: blocked requests are logged with anonymised IPs (last octet / last 80 bits zeroed) and retained for a limited window.
- **GDPR scripts**: `scripts/gdpr_export.py`, `gdpr_delete.py`, `gdpr_list.py`, `gdpr_rectify.py`, `gdpr_restrict.py` (and `_export_bans.py`) operate directly on `user_data.db` and write to `gdpr_exports/`.

---

## Notes

- This site is meant to be paired with **[ESI-Bot](https://github.com/190Q/ESI-Bot)**, which supplies the historical data it displays — but the bot is not required. Run standalone and the live/public features keep working; only history, points, and shop data will be empty.
- The dashboard is built specifically for ESI. The guild prefix `'ESI'` is hardcoded in a few places (for example `cache.py` and `js/guild.js`); search for it if adapting this for another guild.
- Historical data lives in the ESI-Bot checkout, not this repo. Without it, the site runs but history/points/shop data will be empty.
- The bot trackers (API, Playtime, Guild, Claim) and the ESI-Bot itself are separate processes not included here — this repo is the web dashboard plus the control panel that supervises them.
- `requirements.txt` is a full environment freeze rather than a minimal dependency list; if you want a lean install, the app itself needs Flask, requests, python-dotenv, discord.py, and Playwright.
