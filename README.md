# ESI Dashboard

A guild management dashboard for **Empire of Sindria**, a guild on the MMORPG [Wynncraft](https://wynncraft.com/). It pulls live and historical data from the Wynncraft API, tracks player and guild activity over time, and gives higher-ranked members the tools they need to manage the guild without having to dig through spreadsheets.

---

## What it does

The dashboard is split into a few main sections, accessible from a collapsible sidebar:

- **Player Stats**: look up any player's rank history, playtime, and in-game metrics (wars, dungeons, raids, mobs killed, etc.) with interactive graphs. Supports comparing two players side-by-side.
- **Guild Stats**: guild-wide graphs for active player count, wars, guild raids, and member growth. Also shows territory and level data.
- **Bot Panel**: shows the status and health of the four background trackers (API, Playtime, Guild, Claim), along with their last-run times and database info.
- **Inactivity** *(Parliament and above)*: track which members have declared inactivity, with start/end dates and reasons. Add, edit, or remove entries.
- **Promotions** *(Juror and above)*: promotion tracking tools.

Authentication is done through Discord OAuth2. The management sections are gated by guild role, regular members only see the public stats panels.

---

## Stack

**Frontend**
- Plain HTML/CSS/JS, no framework
- Custom CSS across multiple files (`base.css`, `player.css`, `guild.css`, etc.)
- Canvas-based graphs via a shared `GraphShared` module
- Google Fonts (Cinzel, Crimson Pro)

**Backend**
- Python + Flask
- SQLite databases for historical data
- In-memory caching with TTLs and threading locks to avoid hammering the Wynncraft API
- Discord OAuth2 for login/session management
- Rate limiting on activity endpoints (per-IP, 30s window)

---

## Setup

### Requirements

- Python 3.10+
- Node.js 18+ and npm

### Installation

1. **Install Python dependencies**

```bash
pip install flask requests
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
DISCORD_REDIRECT_URI=http://localhost:5000/auth/callback
```

> **Do not commit your `.env` file.** It is already in `.gitignore` (make sure it stays that way).

There is also a `.flask_secret` file used to sign sessions, which is auto-generated on first run if it doesn't exist. Don't commit that either.

4. **Run the server**

```bash
python server.py
```

Then open [http://localhost:5000](http://localhost:5000).

---

## Project structure

```
ESI-website/
├── index.html
├── server.py
├── css/
│   ├── base.css
│   ├── bot.css
│   ├── graph-shared.css
│   ├── guild.css
│   ├── inactivity.css
│   ├── player.css
│   └── promotions.css
└── js/
    ├── app.js               # core state, auth, nav
    ├── bot.js               # bot panel logic
    ├── data-cache.js        # client-side fetch cache
    ├── graph-shared.js      # shared canvas graph utilities
    ├── guild.js             # guild stats panel
    ├── inactivity.js        # inactivity management panel
    ├── player.js            # player stats panel
    ├── promotions.js        # promotions panel
    ├── toast.js             # toast notification system
    └── activity_prefetch.js # background activity data prefetching
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
| GET | `/api/bot/info` | Bot Discord profile 🔒 |
| GET | `/api/bot/health` | Memory, CPU, and command stats 🔒 |
| GET | `/api/bot/discord` | Discord guild member/channel counts 🔒 |
| GET | `/api/bot/databases` | Database folder sizes and date ranges 🔒 |

---

## Notes

- The dashboard is built specifically for ESI — the guild prefix is hardcoded in a few places (`'ESI'` in `guild.js`). If you want to adapt this for another guild, search for that string and update accordingly.
- Historical data is stored in SQLite `.db` files that are expected to exist on the server. The paths to these are configured internally in `server.py`. The databases are not included in this repo.
- The bot trackers (API, Playtime, Guild, Claim) are separate processes not included here, this repo is just the web dashboard that reads from the data they collect.
