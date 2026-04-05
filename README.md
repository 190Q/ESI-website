# ESI Dashboard

A guild management dashboard for [**Empire of Sindria**](discord.gg/sindria), a guild on the MMORPG [Wynncraft](https://wynncraft.com/). It pulls live and historical data from the Wynncraft API, tracks player and guild activity over time, and gives higher-ranked members the tools they need to manage the guild without having to dig through spreadsheets.

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
- Flask and the `requests` library

```bash
pip install flask requests
```

### Environment variables

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

### Running locally

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

The server exposes both internal routes (dashboard-only, checked via `Referer` header) and a set of public routes usable without the dashboard:

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/player/<username>` | Player data from Wynncraft API |
| GET | `/api/player/<username>/rank-history` | Historical rank data |
| GET | `/api/player/<username>/playtime-history` | Playtime over time |
| GET | `/api/player/<username>/metrics-history` | Stats over time (wars, dungeons, etc.) |
| GET | `/api/guild/stats` | Current guild statistics |
| GET | `/api/guild/activity` | Bulk guild activity data |
| GET | `/api/guild/member-history` | Member count over time |
| GET | `/api/guild/levels` | Guild level data |
| GET | `/api/guild/territories` | Territory data |
| GET | `/api/bot/info` | Bot tracker info |
| GET | `/api/bot/health` | Bot health check |
| GET | `/api/bot/status` | Public bot status |
| GET | `/api/inactivity` | List inactivity entries *(auth required)* |
| POST | `/api/inactivity` | Add inactivity entry *(Parliament / Valaendor only)* |
| PATCH | `/api/inactivity/<discord_id>` | Edit inactivity entry *(Parliament / Valaendor only)* |
| DELETE | `/api/inactivity/<discord_id>` | Remove inactivity entry *(Parliament / Valaendor only)* |

Public routes (accessible without the dashboard being the referrer) live under `/api/player/rank-history/<username>`, `/api/player/playtime/<username>`, `/api/player/metrics/<username>`, and `/api/bot/status`.

---

## Notes

- The dashboard is built specifically for ESI — the guild prefix is hardcoded in a few places (`'ESI'` in `guild.js`). If you want to adapt this for another guild, search for that string and update accordingly.
- Historical data is stored in SQLite `.db` files that are expected to exist on the server. The paths to these are configured internally in `server.py`. The databases are not included in this repo.
- The bot trackers (API, Playtime, Guild, Claim) are separate processes not included here, this repo is just the web dashboard that reads from the data they collect.
