# ESI Dashboard

A guild management dashboard for **Empire of Sindria**, a guild on the MMORPG [Wynncraft](https://wynncraft.com/). It pulls live and historical data from the Wynncraft API, tracks player and guild activity over time, and gives higher-ranked members the tools they need to manage the guild without having to dig through spreadsheets.

---

## What it does

The dashboard is split into a few main sections, accessible from a collapsible sidebar:

- **Player Stats**: look up any player's rank history, playtime, and in-game metrics (wars, dungeons, raids, mobs killed, etc.) with interactive graphs. Supports comparing two players side-by-side.
- **Guild Stats**: guild-wide graphs for active player count, wars, guild raids, and member growth. Also shows territory and level data.
- **Shop**: guild members spend EP (Experience Points) earned from gameplay cycles to buy items or bid in auctions. Features a cart system, server-side EP balance with clean/dirty split, LE-to-EP donations, per-item cooldowns, and an admin panel for catalogue management and order fulfillment. All Discord DM notifications use branded image cards.
- **Bot Panel**: shows the status and health of the four background trackers (API, Playtime, Guild, Claim), along with their last-run times and database info.
- **Inactivity** *(Parliament and above)*: track which members have declared inactivity, with start/end dates and reasons. Add, edit, or remove entries.
- **Promotions** *(Juror and above)*: promotion tracking tools.
- **Settings**: persistent preferences for graph defaults, player lookup, and toast notifications... Stored in `localStorage` and accessible from the sidebar. Users can also upload custom colour themes and fonts from the settings modal.

Authentication is done through Discord OAuth2. The management sections are gated by guild role, regular members only see the public stats panels.

### Custom Themes & Fonts

Users can upload their own `.css` files via Settings to override the default colour theme or font. Example files are included in `public/examples/` to use as a starting point:

- **`public/examples/themes/dark.css`** - a dark colour theme. Override any of the CSS custom properties defined in `css/themes.css` inside a `[data-theme="your-name"]` selector. You only need to include the variables you want to change; the rest fall through to the defaults.
- **`public/examples/fonts/cormorant-font/`** - a custom font. Include `@font-face` declarations for your font files, then map the three font variables (`--font-display`, `--font-heading`, `--font-body`) inside a `[data-font="your-name"]` selector.

The `data-theme` / `data-font` attribute value in the CSS is used as the display name in the settings dropdown. If the file doesn't contain one, the filename is used instead.

---

## Stack

**Frontend**
- Plain HTML/CSS/JS, no framework
- Custom CSS across multiple files (`base.css`, `player.css`, `guild.css`, etc.)
- Canvas-based graphs via a shared `GraphShared` module
- Google Fonts (Cinzel, Crimson Pro)

**Backend**
- Python + Flask
- SQLite databases for historical data (+ `shop.db` for shop transactions)
- In-memory caching with TTLs and threading locks to avoid hammering the Wynncraft API
- Discord OAuth2 for login/session management
- Rate limiting on activity endpoints (per-IP, 30s window)
- Playwright for rendering branded DM notification card images

---

## Setup

### Requirements

- Python 3.10+
- Node.js 18+ and npm

### Installation

1. **Install Python dependencies**

```bash
pip install flask requests playwright
playwright install chromium
```

2. **Install and build the frontend**

```bash
cd frontend
npm install
npm run build
cd ..
```

This compiles the React app and outputs the bundled assets (`index.html`, `assets/`) into the project root, where `server.py` serves them.

3. **Configure environment variables**

Create a `.env` file at the project root. You need a Discord application set up at [discord.com/developers](https://discord.com/developers/applications):

```env
DISCORD_TOKEN=your_bot_token
DISCORD_CLIENT_ID=your_client_id
DISCORD_CLIENT_SECRET=your_client_secret
DISCORD_GUILD_ID=your_guild_id
DISCORD_REDIRECT_URI=https://your-domain.com/auth/callback
```

4. **Run the server**

```bash
python server.py
```

Then open [http://localhost:5000](http://localhost:5000).

### Switching between production and localhost

`.env` holds the production values and lives only on the server. To run the
same code locally without editing `.env`, drop a `.env.local` file next to it —
`config.py` loads `.env.local` after `.env` and lets it override any variable.

```bash
cp .env.local.example .env.local
# edit .env.local if you want a separate dev Discord app
```

A minimal `.env.local` only needs to redirect OAuth at localhost:

```env
DISCORD_REDIRECT_URI=http://localhost:5000/auth/callback
```

Make sure `http://localhost:5000/auth/callback` is registered as an OAuth2
redirect on your Discord application. `.env.local` is gitignored so it never
reaches the production server — delete it (or just don't create it there) and
the app automatically falls back to the production values in `.env`.

---

## Project structure

```
ESI-website/
├── server.py                # Flask backend
├── index.html               # generated by Vite build
├── assets/                  # generated by Vite build (JS/CSS bundles)
├── images/
│   ├── guild_emblem.avif
│   ├── aspect_icon.avif
│   ├── point_icon.png
│   ├── territory_icon.png
│   └── favicon.ico
├── frontend/                # React source (Vite)
│   ├── vite.config.js
│   ├── package.json
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── useScriptLoader.js
│       └── components/
│           ├── AccountModal.jsx
│           ├── BotPanel.jsx
│           ├── CollapsibleCard.jsx
│           ├── GuildPanel.jsx
│           ├── Icons.jsx
│           ├── LoadingState.jsx
│           ├── Navbar.jsx
│           ├── PlayerPanel.jsx
│           ├── SettingsModal.jsx
│           ├── Sidebar.jsx
│           └── SupportModal.jsx
├── shop/                    # guild shop backend package
│   ├── README.md            # shop architecture docs
│   ├── items.py             # item catalogue loader
│   ├── ep_balance.py        # EP balance computation
│   ├── bin.py               # fixed-price purchases + cart checkout
│   ├── auction.py           # auction bidding, settlement, DMs
│   ├── cart.py              # server-side cart persistence
│   ├── donate.py            # LE-to-EP donation tickets
│   ├── orders.py            # order history
│   ├── admin.py             # admin operations
│   └── dm_cards.py          # branded DM card renderer (HTML → PNG)
├── js/                      # shared vanilla JS modules
│   ├── app.js
│   ├── bot.js
│   ├── data-cache.js
│   ├── graph-shared.js
│   ├── guild.js
│   ├── inactivity.js
│   ├── player.js
│   ├── promotions.js
│   ├── shop.js              # shop frontend (bin + auctions + cart)
│   ├── shop-admin.js        # shop admin panel
│   ├── toast.js
│   └── activity_prefetch.js
├── css/
│   ├── shop.css
│   ├── shop-admin.css
└── css/
    ├── base.css
    ├── bot.css
    ├── graph-shared.css
    ├── guild.css
    ├── inactivity.css
    ├── player.css
    └── promotions.css
```

---

## API routes

Routes marked 🔒 require a valid Discord login session. Routes marked 👑 additionally require a specific guild role.

### Auth

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/auth/login` | Redirect to Discord OAuth2 |
| GET | `/auth/callback` | OAuth2 callback, sets session |
| GET | `/auth/session` | Returns current session state |
| GET | `/auth/refresh` | Re-fetches roles/profile from Discord |
| GET | `/auth/logout` | Clears session |
| POST | `/auth/mock-login` | Dev-only mock login (skips OAuth) |

### Player

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/player/<username>` | Live player data from Wynncraft API 🔒 |
| GET | `/api/player/<username>/rank-history` | Rank changes from tracked guild data 🔒 |
| GET | `/api/player/<username>/playtime-history` | Playtime over time (last 60 days) 🔒 |
| GET | `/api/player/<username>/metrics-history` | Stat deltas over time (wars, dungeons, etc.) 🔒 |
| GET | `/api/player/<username>/points` | ESI points breakdown (current / previous / both cycles) with LE + history |
| GET | `/api/player/rank-history/<username>` | Public rank history (no auth required) |
| GET | `/api/player/playtime/<username>` | Public playtime history (no auth required) |
| GET | `/api/player/metrics/<username>` | Public metrics snapshot (no auth required) |

### Guild

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/guild/stats` | Summed stats across all members from latest snapshot 🔒 |
| GET | `/api/guild/activity` | Bulk playtime + metric deltas for all members (rate-limited, public) |
| GET | `/api/guild/member-history` | Member join/leave event history 🔒 |
| GET | `/api/guild/levels` | Guild level data 🔒 |
| GET | `/api/guild/territories` | Territory holdings and history (public) |
| GET | `/api/guild/aspects` | Aspect debt data 🔒 |
| POST | `/api/guild/aspects/clear` | Clear a member's aspect debt 👑 Parliament+ |
| GET | `/api/guild/points` | ESI points leaderboards for current / previous / both cycles (with LE totals) |
| GET | `/api/guild/prefix/<prefix>` | Live guild data by tag from Wynncraft API 🔒 |
| GET | `/api/guild/name/<name>` | Live guild data by full name from Wynncraft API 🔒 |
| GET | `/api/guild/prefix/<prefix>/metrics-history` | Guild-wide metric deltas over time 🔒 |

### Inactivity

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/inactivity` | List inactivity entries 👑 Parliament+ |
| POST | `/api/inactivity` | Add inactivity entry 👑 Parliament+ |
| PATCH | `/api/inactivity/<discord_id>` | Edit inactivity entry 👑 Parliament+ |
| DELETE | `/api/inactivity/<discord_id>` | Remove inactivity entry 👑 Parliament+ |
| GET | `/api/inactivity/players` | List all guild members from DB 👑 Juror+ |

### Bot

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/bot/status` | Online/offline status and latency (public) |
| GET | `/api/bot/trackers` | Tracker countdowns parsed from tracker screen output (public) |
| GET | `/api/bot/info` | Bot Discord profile 🔒 |
| GET | `/api/bot/discord` | Discord guild member/channel counts 🔒 |
| GET | `/api/bot/databases` | Database folder sizes and date ranges 🔒 |

### Shop

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/shop/bin` | Item listing with balance and cooldowns 🔒 |
| POST | `/api/shop/bin/purchase` | Single item purchase 🔒 |
| POST | `/api/shop/bin/cart/checkout` | Multi-item cart checkout 🔒 |
| GET/PUT | `/api/shop/cart` | Cart persistence 🔒 |
| GET | `/api/shop/auctions` | Active + recent auctions 🔒 |
| POST | `/api/shop/auctions/bid` | Place a bid 🔒 |
| POST | `/api/shop/donate` | Submit LE donation 🔒 |
| GET | `/api/shop/donations` | Donation history 🔒 |
| GET | `/api/shop/orders` | Full order history 🔒 |
| GET | `/api/me/ep-balance` | EP balance breakdown 🔒 |

### Shop Admin

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/shop/items` | Full catalogue 👑 Chief+ |
| POST | `/api/admin/shop/items` | Create item 👑 Parliament+ |
| PUT | `/api/admin/shop/items/<id>` | Edit item 👑 Parliament+ |
| DELETE | `/api/admin/shop/items/<id>` | Delete item 👑 Parliament+ |
| POST | `/api/admin/shop/items/<id>/override` | Toggle active / set stock 👑 Chief+ |
| POST | `/api/admin/shop/items/upload-image` | Upload item image 👑 Parliament+ |
| POST | `/api/admin/shop/auctions/start` | Start an auction 👑 Chief+ |
| POST | `/api/admin/shop/auctions/<id>/extend` | Adjust end time 👑 Parliament+ |
| POST | `/api/admin/shop/auctions/<id>/close` | Cancel auction 👑 Parliament+ |
| POST | `/api/admin/shop/bids/<id>/remove` | Remove a bid 👑 Parliament+ |
| GET | `/api/admin/shop/queue` | Pending purchases + donations 👑 Chief+ |
| POST | `/api/admin/shop/queue/fulfill` | Fulfill a ticket 👑 Chief+ |
| POST | `/api/admin/shop/queue/reject` | Reject a ticket 👑 Chief+ |

### Settings

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/settings/default-player` | Returns the logged-in user's Minecraft username from `username_matches.json` 🔒 |

---

## Notes

- The dashboard is built specifically for ESI, the guild prefix is hardcoded in a few places (`'ESI'` in `guild.js`). If you want to adapt this for another guild, search for that string and update accordingly.
- Historical data is stored in SQLite `.db` files that are expected to exist on the server. The paths to these are configured internally in `server.py`. The databases are not included in this repo.
- The bot trackers (API, Playtime, Guild, Claim) are separate processes not included here, this repo is just the web dashboard that reads from the data they collect.
