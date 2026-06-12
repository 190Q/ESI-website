"""
config.py - Shared configuration, constants, and utility functions.
Imported by main.py, routes.py, and cache.py.
"""

import os
import sys
import json
import secrets

from dotenv import load_dotenv

# paths

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Load production / default values first
load_dotenv(os.path.join(_BASE_DIR, ".env"))
# then optionally override with local-only settings (e.g. localhost redirect
# URI, a dev Discord app, etc). Create a `.env.local` file next to `.env` to
# switch this project into local-testing mode without touching `.env`.
# `.env.local` is gitignored so it never lands on the production server.
load_dotenv(os.path.join(_BASE_DIR, ".env.local"), override=True)

def _resolve_esi_bot_dir():
    """Resolve which local ESI-Bot checkout should provide runtime data."""
    env_dir = (os.environ.get("ESI_BOT_DIR") or "").strip()
    if env_dir:
        return env_dir

    sibling = os.path.join(os.path.dirname(_BASE_DIR), "ESI-Bot")
    parent_sibling = os.path.join(os.path.dirname(os.path.dirname(_BASE_DIR)), "ESI-Bot")
    if os.path.isdir(parent_sibling):
        return parent_sibling
    if os.path.isdir(sibling):
        return sibling
    return sibling


_ESI_BOT_DIR = _resolve_esi_bot_dir()
_DATA_FOLDER            = os.path.join(_ESI_BOT_DIR, "data")
_ASPECTS_JSON           = os.path.join(_DATA_FOLDER, "aspects.json")
_INACTIVITY_JSON        = os.path.join(_DATA_FOLDER, "inactivity_exemptions.json")
_USERNAME_MATCHES_JSON  = os.path.join(_DATA_FOLDER, "username_matches.json")
_TRACKED_GUILD_JSON     = os.path.join(_DATA_FOLDER, "tracked_guild.json")
_GUILD_LEVELS_JSON      = os.path.join(_DATA_FOLDER, "guild_levels.json")
_GUILD_TERRITORIES_JSON = os.path.join(_DATA_FOLDER, "guild_territories.json")
_API_TRACKING_DIR       = os.path.join(_ESI_BOT_DIR, "databases", "api_tracking")
_POINTS_DB              = os.path.join(_ESI_BOT_DIR, "databases", "esi_points.db")
_SNIPES_DB              = os.path.join(_ESI_BOT_DIR, "databases", "claim_snipes.db")

_USER_DB_PATH           = os.path.join(_BASE_DIR, "user_data.db")
_UPLOAD_DIR             = os.path.join(_BASE_DIR, "uploads")

_WEBSITE_DATA_DIR       = os.path.join(_BASE_DIR, "data")
os.makedirs(_WEBSITE_DATA_DIR, exist_ok=True)
if sys.platform != "win32":
    os.chmod(_WEBSITE_DATA_DIR, 0o700)
_APPLICATIONS_JSON      = os.path.join(_WEBSITE_DATA_DIR, "applications.json")
_EVENTS_JSON            = os.path.join(_WEBSITE_DATA_DIR, "events.json")
_SHOP_ITEMS_JSON        = os.path.join(_WEBSITE_DATA_DIR, "shop_items.json")
_SHOP_DB                = os.path.join(_WEBSITE_DATA_DIR, "databases", "shop.db")
_GUILD_INFO_DB          = os.path.join(_WEBSITE_DATA_DIR, "databases", "guild_info.db")


def _detect_server_tz_name():
    env = (os.environ.get("ESI_SERVER_TIMEZONE") or os.environ.get("TZ") or "").strip()
    if env:
        return env
    try:
        link = os.readlink("/etc/localtime")
        marker = "zoneinfo/"
        idx = link.find(marker)
        if idx >= 0:
            return link[idx + len(marker):]
    except OSError:
        pass
    try:
        with open("/etc/timezone", "r", encoding="utf-8") as fh:
            name = fh.read().strip()
            if name:
                return name
    except OSError:
        pass
    return "UTC"

_SERVER_TIMEZONE = _detect_server_tz_name()

# Verify secret files have restricted permissions (Linux only).
# Warns at startup if .env or .flask_secret are readable by other users.

def _check_secret_file_perms():
    if sys.platform == 'win32':
        return
    import stat
    for name in ('.env', '.env.local', '.flask_secret', 'ip_whitelist.txt'):
        path = os.path.join(_BASE_DIR, name)
        if not os.path.isfile(path):
            continue
        try:
            mode = os.stat(path).st_mode
            if mode & (stat.S_IRGRP | stat.S_IROTH):
                print(
                    f"  \033[93mWARNING: {name} is readable by group/others "
                    f"(mode {oct(mode & 0o777)}). Run: chmod 600 {path}\033[0m",
                    file=sys.stderr,
                )
        except OSError:
            pass

_check_secret_file_perms()

# API URLs and tokens

WYNN_BASE             = "https://api.wynncraft.com/v3"
DISCORD_API           = "https://discord.com/api/v10"
DISCORD_TOKEN         = os.environ.get("DISCORD_TOKEN", "")
DISCORD_CLIENT_ID     = os.environ.get("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
DISCORD_GUILD_ID      = os.environ.get("DISCORD_GUILD_ID", "")
DISCORD_REDIRECT_URI  = os.environ.get("DISCORD_REDIRECT_URI", "")
GITHUB_TOKEN          = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO           = os.environ.get("GITHUB_REPO", "190Q/ESI-website")
HEADERS               = {"User-Agent": "ESI-Dashboard/1.0"}

# cache TTLs

CACHE_TTL              = 120
PLAYTIME_CACHE_TTL     = 300
BULK_PLAYTIME_REFRESH  = 600

# service ports

GATEWAY_PORT = 5000
ROUTES_PORT  = 5001
CACHE_PORT   = 5002
ROUTES_URL   = f"http://127.0.0.1:{ROUTES_PORT}"
CACHE_URL    = f"http://127.0.0.1:{CACHE_PORT}"

# Internal proxy secret, shared between Gateway and Routes
_GATEWAY_SECRET = os.environ.get("ESI_GATEWAY_SECRET", "").strip()
if not _GATEWAY_SECRET:
    _GATEWAY_SECRET = secrets.token_urlsafe(48)
    os.environ["ESI_GATEWAY_SECRET"] = _GATEWAY_SECRET

# dev-mode: when true, /auth/dev-login is enabled so user can impersonate any
# Discord user while running the site locally. Auto-detected from a localhost
# redirect URI (typically set by .env.local) or force-enabled via DEV_MODE=1.
# NEVER set this on a production deployment.
_DEV_MODE_EXPLICIT = str(os.environ.get("DEV_MODE") or "").strip().lower() in {"1", "true", "yes", "on"}
_DEV_MODE_AUTO = (
    DISCORD_REDIRECT_URI.startswith("http://localhost")
    or DISCORD_REDIRECT_URI.startswith("http://127.0.0.1")
)
DEV_MODE = _DEV_MODE_EXPLICIT or _DEV_MODE_AUTO

# Safety check: refuse to run if DEV_MODE was force-enabled but the redirect
# URI points to a real (non-localhost) domain.  This prevents accidentally
# shipping DEV_MODE=1 in a production .env file.
if _DEV_MODE_EXPLICIT and not _DEV_MODE_AUTO and DISCORD_REDIRECT_URI:
    print(
        "\n  \033[91mFATAL: DEV_MODE=1 is set but DISCORD_REDIRECT_URI points to a "
        "non-localhost domain.\033[0m\n"
        f"  DISCORD_REDIRECT_URI = {DISCORD_REDIRECT_URI}\n\n"
        "  This is almost certainly a misconfiguration. DEV_MODE enables\n"
        "  /auth/dev-login which allows impersonating any user.\n\n"
        "  Either remove DEV_MODE from .env or set DISCORD_REDIRECT_URI\n"
        "  to a localhost URL.\n",
        file=sys.stderr,
    )
    sys.exit(1)

# discord role IDs

_ROLE_VALAENDOR  = "728858956575014964"
_ROLE_PARLIAMENT = "600185623474601995"
_ROLE_CONGRESS   = "1346436714901536858"
_ROLE_JUROR      = "954566591520063510"
_ROLE_CITIZEN    = "554889169705500672"

_ROLE_GRAND_DUKE = "1396112289832243282"
_ROLE_ARCHDUKE   = "554514823191199747"
_ROLE_EMPEROR    = "554506531949772812"

# Ticket-server staff roles
_TICKET_GUILD_ID = "1448532791686860923"
_STAFF_ROLE_DEFS = [
    {"role_id": "1448533030091227227", "name": "Bot Owner",    "color": "#ec00ad"},
    {"role_id": "1464696049896788104", "name": "Developer",    "color": "#0896d3"},
    {"role_id": "1464695189380530423", "name": "User Support", "color": "#4933c5"},
]

# Events-panel roles
_ROLE_PRIDE             = "683448131148447929"
_ROLE_EVENT_MANAGER     = "1390342794056569033"

# Non-guild roles
_ROLE_VETERAN = "914422269802070057"
_ROLE_EX_CIT  = "706338091312349195"
_ROLE_ENVOY   = "554896955638153216"

_PARLIAMENT_PLUS = {_ROLE_PARLIAMENT, _ROLE_VALAENDOR}
_JUROR_PLUS      = {_ROLE_JUROR, _ROLE_CONGRESS, _ROLE_PARLIAMENT, _ROLE_VALAENDOR}
_CHIEF_PLUS      = {_ROLE_GRAND_DUKE, _ROLE_ARCHDUKE}
_CITIZEN_PLUS    = {_ROLE_CITIZEN}

# Shop donation settings
_DONATION_LE_TO_EP_RATE     = 15     # 1 LE = 15 dirty EP
_DONATION_MAX_EP_PER_CYCLE  = None   # set to an int to cap dirty EP from donations per cycle (None = no cap)

# Any of these roles grants access to the Manage Events page
_EVENTS_ACCESS     = {_ROLE_PRIDE, _ROLE_EVENT_MANAGER, _ROLE_PARLIAMENT}
# These roles can manage any event
_EVENTS_MANAGE_ANY = {_ROLE_EVENT_MANAGER, _ROLE_PARLIAMENT}
# Roles that reveal the Guild Info management page in the client nav
_GUILD_INFO_ACCESS = {_ROLE_PARLIAMENT, _ROLE_EMPEROR}

# Discord badge roles colour
_BADGE_ROLES_COLOUR = {
    "[name]":   "#de1b1b",
    "Onyx":     "#6d32ab",
    "Diamond":  "#33c3e7",
    "Platinum": "#8fcef4",
    "Gold":     "#ffb600",
    "Silver":   "#c0eeed",
    "Bronze":   "#b68344",
}

# Badge tier thresholds
QUEST_BADGE_TIERS = [
    (350, "[Name] Badge"),
    (225, "Onyx"),
    (150, "Diamond"),
    (90,  "Platinum"),
    (50,  "Gold"),
    (25,  "Silver"),
    (10,  "Bronze"),
]
RECRUITED_BADGE_TIERS = [
    (250, "[Name] Badge"),
    (150, "Onyx"),
    (80,  "Diamond"),
    (50,  "Platinum"),
    (25,  "Gold"),
    (10,  "Silver"),
    (5,   "Bronze"),
]
WAR_BADGE_TIERS = [
    (10000, "Alle_Sandstorm War Badge"),
    (6000,  "Onyx"),
    (3000,  "Diamond"),
    (1500,  "Platinum"),
    (750,   "Gold"),
    (300,   "Silver"),
    (100,   "Bronze"),
]
GRAID_BADGE_TIERS = [
    (6000, "[Name] Badge"),
    (3500, "Onyx"),
    (2000, "Diamond"),
    (1000, "Platinum"),
    (500,  "Gold"),
    (100,  "Silver"),
    (50,   "Bronze"),
]
EVENT_BADGE_TIERS = [
    (100, "[Name] Badge"),
    (75,  "Onyx"),
    (55,  "Diamond"),
    (35,  "Platinum"),
    (20,  "Gold"),
    (10,  "Silver"),
    (3,   "Bronze"),
]

# Discord role IDs for each badge tier
BADGE_ROLES = {
    "War Badges": {
        "10k":  "1426633275635404981",
        "6k":   "1426633206857465888",
        "3k":   "1426633036736368861",
        "1.5k": "1426632920528846880",
        "750":  "1426633144093638778",
        "300":  "1426632862207049778",
        "100":  "1426632780615385098",
    },
    "Quest Badges": {
        "350": "1426636141242617906",
        "225": "1426636108321525891",
        "150": "1426636066856898593",
        "90":  "1426636018664341675",
        "50":  "1426635982614040676",
        "25":  "1426635948992761988",
        "10":  "1426635880462024937",
    },
    "Recruitment Badges": {
        "250": "1426637291706912788",
        "150": "1426637244109946920",
        "80":  "1426637209301160039",
        "50":  "1426637168071282808",
        "25":  "1426637134378303619",
        "10":  "1426637094339608586",
        "5":   "1426636993630175447",
    },
    "Raid Badges": {
        "6k":   "1426634664025526405",
        "3.5k": "1426634622791323938",
        "2k":   "1426634579644514347",
        "1k":   "1426634531284324353",
        "500":  "1426634469401432194",
        "100":  "1426634408370114773",
        "50":   "1426634317970542613",
    },
    "Event Badges": {
        "100": "1440682465717915779",
        "75":  "1440682471086751815",
        "55":  "1440682473641083011",
        "35":  "1440682477055115304",
        "20":  "1440682480846897232",
        "10":  "1440682485548711997",
        "3":   "1440682762133569730",
    },
}

# Per-category label used in the Discord role name
_BADGE_SINGULAR = {
    "War Badges":         "War",
    "Quest Badges":       "Quest",
    "Recruitment Badges": "Recruitment",
    "Raid Badges":        "Raid",
    "Event Badges":       "Event",
}

# Maps badge category → key returned by /api/me/badge-progress
_BADGE_COUNT_KEY = {
    "War Badges":         "wars",
    "Quest Badges":       "quests",
    "Recruitment Badges": "recruited",
    "Raid Badges":        "guild_raids",
    "Event Badges":       "events",
}

# Map each category's ordered values
_BADGE_TIER_DEFS = {
    "War Badges":         WAR_BADGE_TIERS,
    "Quest Badges":       QUEST_BADGE_TIERS,
    "Recruitment Badges": RECRUITED_BADGE_TIERS,
    "Raid Badges":        GRAID_BADGE_TIERS,
    "Event Badges":       EVENT_BADGE_TIERS,
}

# Values in BADGE_ROLES are insertion-ordered
def _build_badge_catalog():
    catalog = []
    for category, role_map in BADGE_ROLES.items():
        tier_defs = _BADGE_TIER_DEFS.get(category, [])
        singular  = _BADGE_SINGULAR.get(category, category.rstrip("s"))
        count_key = _BADGE_COUNT_KEY.get(category, "")
        tiers = []
        value_items = list(role_map.items())
        for idx, (value, role_id) in enumerate(value_items):
            threshold = tier_defs[idx][0] if idx < len(tier_defs) else 0
            tier_name = tier_defs[idx][1] if idx < len(tier_defs) else "No badge"
            is_top = tier_name not in _BADGE_ROLES_COLOUR
            colour_key = "[name]" if is_top else tier_name
            colour = _BADGE_ROLES_COLOUR.get(colour_key, "#b68344")
            # Standard tiers
            if is_top:
                label = f"{tier_name} ({value})"
            else:
                label = f"{tier_name} {singular} ({value})"
            tiers.append({
                "role_id":   role_id,
                "value":     value,
                "threshold": threshold,
                "tier_name": tier_name,
                "colour":    colour,
                "label":     label,
            })
        catalog.append({
            "key":      category,
            "label":    category,
            "singular": singular,
            "countKey": count_key,
            "tiers":    tiers,
        })
    return catalog


# Medal role IDs and metadata
_MEDAL_ROLES = [
    {"role_id": "1478086881303335013", "name": "Sindrian Eagle",       "abbr": "SE",  "icon": "sindrian_eagle.png"},
    {"role_id": "1478087139509141545", "name": "Order of Sindria",     "abbr": "SO",  "icon": "order_of_sindria.png"},
    {"role_id": "1478087334288167134", "name": "Medal of Valliance",   "abbr": "MV",  "icon": "valliance.png"},
    {"role_id": "1478087563179855983", "name": "Medal of Brilliance",  "abbr": "MB",  "icon": "brilliance.png"},
    {"role_id": "1478087998951129180", "name": "Medal of Inspiration", "abbr": "MI",  "icon": "inspiration.png"},
    {"role_id": "1478088545351762021", "name": "Medal of Benevolence", "abbr": "MBe", "icon": "benevolence.png"},
    {"role_id": "1478088685084741735", "name": "Medal of Fellowship",  "abbr": "MF",  "icon": "fellowship.png"},
    {"role_id": "1478088817700245605", "name": "Medal of Allegiance",  "abbr": "MA",  "icon": "allegiance.png"},
]


def _medals_for_client():
    return [
        {
            "role_id": m["role_id"],
            "name":    m["name"],
            "abbr":    m["abbr"],
            "icon":    f"/images/medals/{m['icon']}",
        }
        for m in _MEDAL_ROLES
    ]

# application forms
_APPLICATION_FORMS = {
    "congress": {
        "title": "Sindrian Congress Application",
        "requireRank": "viscount",
        "requirements": [
            "Must be at least Viscount rank.",
        ],
        "questions": [
            "Have you contributed in policy changes in other guilds/communities, and if so, what?",
            "As things stand, do you believe yourself mature enough to hold discussions and listen to differing opinions?",
            "Are there any major issues you see within the guild, and if so, how would you address them?",
            "Are you willing to put in time to help develop policies in the guild's best interest?",
        ],
    },
    "pride": {
        "title": "Sindrian Pride Application",
        "requireRank": None,
        "requireCitizen": True,
        "requirements": [
            "Must have the Sindrian Citizen role.",
        ],
        "questions": [
            "Why do you want to join Sindrian Pride?",
            "If you were present for any, what events have you liked in the past, and why?",
            "Have you ever helped organise an event before, both in and outside of ESI? If so, what kind?",
            "If you have attended events before, do you have any constructive criticism?",
            "Do you have any current event ideas?",
        ],
    },
    "viscount": {
        "title": "Viscount Application",
        "requireRank": "knight",
        "requirements": [
            "Have a war count of 50, OR a raid count of 25, OR actively host events.",
            "Application is optional - you can also be promoted without one.",
        ],
        "questions": [
            "Please explain, in your own words, what FFAs are, and how alliances function.",
            "Do you have any current warring experience? Have you interacted with the mechanics of aura dodging yet?",
            "In what situation does one ping Sindrian Vanguard and Sindrian Crusader, respectively?",
            "Have you assisted in or hosted any community related events? Are there any you would like to organize in the future?",
            "What do you think your responsibilities as viscount would be, and how would you go about them?",
        ],
    },
    "count": {
        "title": "Count Application",
        "requireRank": "viscount",
        "requirements": [
            "Show an interest in learning Economy.",
        ],
        "questions": [
            "Do you have any experience regarding guild economy management, and would you be willing to put effort into learning (more) about it?",
            "Have you actively involved yourself in defending our claim or organizing FFAs?",
            "Do you have any experience hosting community events, and have you hosted any within ESI so far?",
            "How active would you say you are when participating in guild raids?",
            "Do you consider yourself responsible and reasonable enough to be a potential future representative of this guild?",
        ],
    },
    "grand_duke": {
        "title": "Grand Duke Application",
        "requireRank": "duke",
        "requirements": [
            "Have at least 2 war builds (Solo, Healer, Tank, DPS).",
            "Have completed advanced eco courses + exam.",
            "Be capable of warring when necessary.",
            "Display a sufficient level of maturity, leadership skills, and contribution to the guild.",
        ],
        "questions": [
            "Are you active in any Wynn-related discords other than ESI? If so, how do you typically behave in such servers?",
            "As things stand, do you believe yourself mature enough to act as a potential representative of ESI to other guilds?",
            "What is/are your current war build(s)?",
            "How involved have you been in ESI's community? Are there any changes you would suggest on the discord management side of things?",
            "As a chief of ESI, what kind of person do you want to be in the guild? Do you have a specific role you want to fulfill?",
        ],
    },
}

# Discord servers and channels for application posting
_PARLI_SERVER_ID   = "802999599060221992"
_PARLI_PARLI_ROLE  = "804211709166354432"   # Parliament role in the parli server
_DEV_SERVER_ID     = "1442126799369670770"

# Guild Info forum target
if DEV_MODE:
    _GUILD_INFO_SERVER_ID        = "1442126799369670770"
    _GUILD_INFO_FORUM_CHANNEL_ID = "1514643396013330482"
else:
    _GUILD_INFO_SERVER_ID        = "554418045397762048"
    _GUILD_INFO_FORUM_CHANNEL_ID = "1381289736903065662"

_APPLICATION_DISCORD = {
    "congress": {
        "server":      _PARLI_SERVER_ID,
        "channel":     "804268052194787349",
        "dev_channel": "1500652489379414016",
        "poll_hours":  24,
    },
    "pride": {
        "server":      DISCORD_GUILD_ID,
        "channel":     "830884793230426142",
        "dev_channel": "1500652489379414016",
        "poll_hours":  24,
        "ping_role":   _ROLE_EVENT_MANAGER,
    },
    "viscount": {
        "server":      DISCORD_GUILD_ID,
        "channel":     "1402383960046043146",
        "dev_channel": "1500654682765262909",
        "poll_hours":  24,
    },
    "count": {
        "server":      DISCORD_GUILD_ID,
        "channel":     "1443193393328164964",
        "dev_channel": "1500654682765262909",
        "poll_hours":  24,
    },
    "grand_duke": {
        "server":      _PARLI_SERVER_ID,
        "channel":     "804268052194787349",
        "dev_channel": "1500652489379414016",
        "poll_hours":  48,
        "use_thread":  True,
    },
}

# Rank names ordered highest-first (must match rankRoles order) for rank checks
_RANK_HIERARCHY = ["emperor", "archduke", "grand duke", "duke", "count", "viscount", "knight", "squire"]


def _user_has_min_rank(user_roles, min_rank_name):
    """Check if the user's roles include min_rank_name or any rank above it."""
    if not min_rank_name:
        return True
    target = min_rank_name.lower()
    try:
        target_idx = _RANK_HIERARCHY.index(target)
    except ValueError:
        return False
    rank_ids = [r["id"] for r in _CLIENT_CONFIG["rankRoles"]]
    for i, rid in enumerate(rank_ids):
        if i <= target_idx and rid in (user_roles or []):
            return True
    return False


# client config (exposed via /api/config)

_CLIENT_CONFIG = {
    "roles": {
        "valaendor":  _ROLE_VALAENDOR,
        "parliament": _ROLE_PARLIAMENT,
        "congress":   _ROLE_CONGRESS,
        "juror":      _ROLE_JUROR,
        "citizen":    _ROLE_CITIZEN,
    },
    "permissions": {
        "parliamentPlus":  list(_PARLIAMENT_PLUS),
        "jurorPlus":       list(_JUROR_PLUS),
        "chiefPlus":       list(_CHIEF_PLUS),
        "eventsAccess":    list(_EVENTS_ACCESS),
        "eventsManageAny": list(_EVENTS_MANAGE_ANY),
        "guildInfoAccess": list(_GUILD_INFO_ACCESS),
        "creatorApplyRoles": [_ROLE_CITIZEN],
    },
    "staffRoles": [],
    "rankRoles": [
        {
            "id": "554506531949772812",
            "name": "Emperor",
            "color": "#5c11ad",
            "icon": "\u265a",
            "ingame": "Owner \u2606\u2606\u2606\u2606\u2606",
            "desc": "Guild owner. Final say on all major decisions and the face of ESI.",
            "fullDesc": "The Emperor is the guild's owner and the one who makes all of the decisions within the guild. While they delegate tasks to Parliament, they ultimately have the final say on any major choices. They are primarily responsible for representing the guild to the rest of Wynn, acting as the face of the guild as well as deciding upon which guilds are allies or enemies.",
            "promotion": None
        },
        {
            "id": "554514823191199747",
            "name": "Archduke",
            "color": "#b5fff6",
            "icon": "\u2656",
            "ingame": "Chief \u2606\u2606\u2606\u2606",
            "desc": "Senior members integral to the guild. Most authority after the Emperor.",
            "fullDesc": "Archdukes are the glue that keeps the guild together and have the most authority among all ranks. The reasons for a promotion varies according to Parliament's criteria, but Archdukes are generally senior members who are integral to the guild and have demonstrated commitment and care towards its well-being - persistence in warring, being a bedrock of the community, initiative in hosting events. The title of Archduke is not one given lightly; it is less of a \u201cgoal\u201d and more of a \u201csignifier\u201d of invaluable contributions.",
            "promotion": {"method": "handpicked", "hint": "Hand-picked by Parliament."}},
        {
            "id": "1396112289832243282",
            "name": "Grand Duke",
            "color": "#74cac0",
            "icon": "\u2656", "ingame":
            "Chief \u2606\u2606\u2606\u2606",
            "desc": "In-game Chief. Stands out in both war and community involvement.",
            "fullDesc": "Grand Dukes are members who greatly stand out among their peers. They are promoted to in-game Chiefs, which grants the highest amount of perms save for the Owner. They show great involvement in both war and community and demonstrate exemplary behaviour. This may be a temporary rank to prepare you for Archduke, but depending on the person, it may also be more permanent.",
            "promotion": {"method": "apply", "hint": "Hand-picked or via Grand Duke application.", "formType": "grand_duke"}},
        {
            "id": "591765870272053261",
            "name": "Duke",
            "color": "#35deac",
            "icon": "\u2656",
            "ingame": "Strategist \u2606\u2606\u2606",
            "desc": "High Ranked. Economy and tribute perms, HR guild bank access.",
            "fullDesc": "Dukes are the beginnings of the guild's High Ranked. They are prominent figures within the community as well as the battlefront. They gain access to HR Guild Bank (policy: \u201cnever take, only borrow\u201d), as well as HR-exclusive channels. As permanent in-game strategists, they have economy and tribute perms. At this point you will be seen as a guild representative, so respectful conduct towards other guilds is expected.",
            "promotion": {"method": "vote", "hint": "Voted by Parliament after completing eco course as Count."}},
        {
            "id": "1391424890938195998",
            "name": "Count",
            "color": "#3ac770",
            "icon": "\u2656",
            "ingame": "Captain \u2606\u2606 \u00b7 Strategist \u2606\u2606\u2606",
            "desc": "Trial Duke. Learning economy management and HQ-level war builds.",
            "fullDesc": "A Count is a temporary rank granted to those being considered as future Dukes. During this time you perfect your war knowledge and learn to manage Guild Economy. After a few weeks, the head Eco Professors will decide whether to promote you to Duke or revert you back to Viscount. This is also the rank at which you gain access to HQ builds.",
            "promotion": {"method": "apply", "hint": "Be an active warrer with at least one war build and interest in eco.", "formType": "count"}},
        {
            "id": "591769392828776449",
            "name": "Viscount",
            "color": "#59e365",
            "icon": "\u2656",
            "ingame": "Captain \u2606\u2606",
            "desc": "Can initiate wars. Gains access to introductory war builds.",
            "fullDesc": "A Viscount has the ability to initiate wars and the knowledge to use this power wisely. At this rank you gain access to introductory war builds. Viscounts are expected to keep warring, raiding, or hosting community events, but are encouraged to branch out to other parts of the guild. After this rank, you are unable to rank up based on community contributions alone.",
            "promotion": {"method": "apply", "hint": "50 wars OR 25 raids OR active event hosting. Application optional.", "formType": "viscount"}},
        {
            "id": "688438690137243892",
            "name": "Knight",
            "color": "#93e688",
            "icon": "\u2658",
            "ingame": "Recruiter \u2606",
            "desc": "Confirmed guild member. Guild bank access, can join wars and raids.",
            "fullDesc": "Knights have been confirmed as members of the guild and gain access to the guild bank and armoury channels on Discord. This lets them sign up for Sindrian Vanguard and Sindrian Crusader for war notifications. As the newest members to the war front, they make up the backbone of the Nobility's military power. Joining wars or guild raids is a good way to learn the basics.",
            "promotion": {"method": "auto", "hint": "Automatic after ~1 week of good activity. Voted by Jurors."}},
        {
            "id": "681030746651230351",
            "name": "Squire",
            "color": "#c7edc0",
            "icon": "\u2659",
            "ingame": "Recruit",
            "desc": "Trial period for new recruits to get settled into the community.",
            "fullDesc": "Squire is the very first role in the guild. As a brand-new recruit, this is a starting point to help you get settled into the community. This role functions as a trial period - after a week, Jurors (prominent community members) will vote on whether to approve you as a full member (Knight), welcoming you into the ranks of Nobility.",
            "promotion": None
        },
    ],
    "echelonRoles": [
        {
            "id": _ROLE_VALAENDOR,
            "name": "Valaendor",
            "color": "#7744b6",
            "icon": "\u265b",
            "desc": "Closely advises the Emperor and can act as de-facto leader in their absence. Bestowed during guild anniversaries.",
            "fullDesc": "Members of the Sindrian royal family who closely advise the Emperor alongside Parliament, acting as the Emperor's right hand. They have some of the most important responsibilities within the guild and can act as de-facto leader in the Emperor's absence. Role only bestowed during the guild's (half) anniversary."},
        {
            "id": _ROLE_PARLIAMENT, "name": "Parliament",
            "color": "#afb3d1",
            "icon": "\u265b",
            "desc": "Governing body that assists the Emperor with decision-making and monitors the guild for misconduct.",
            "fullDesc": "Parliament consists of members who are exemplary within the guild, trusted enough to discuss matters regarding its wellbeing and ensure everything runs in a safe and stable manner. It is not a role you can expect to get into via solely doing your duties. Parliament functions as the governing body, regularly called upon to assist the Emperor with decision-making as well as monitoring the discord for misconduct. Each member has a dedicated role: War Leader, Discord Manager, Quest Master, Recruitment Manager, Guild Treasurer, Raid Manager."},
        {
            "id": _ROLE_CONGRESS,
            "name": "Congress",
            "color": "#7289da",
            "icon": "\U0001F732",
            "desc": "Creative body of active members who suggest improvements, write bills, debate and vote on them. Viscount+ to apply.",
            "fullDesc": "The Sindrian Congress consists of some of the most active community members, best connected to the guild at large. Unlike other bodies, you do not need to have been in the guild for a long time. Members are expected to change relatively frequently depending on activity. Congress is the main \u201cidea body\u201d - in charge of suggesting improvements or bringing issues to Parliament's attention. They write bills, debate them, and vote on them.",
            "applyForm": "congress"},
        {
            "id": _ROLE_JUROR,
            "name": "Juror",
            "color": "#ffc332",
            "icon": "\u2696",
            "desc": "Court of Judges. Hand-picked members who review new applicants and vote on inductions.",
            "fullDesc": "The Court of Judges is the main judiciary body of the guild, serving as the selection process for new applications. Jurors are hand-picked, considered to be members active enough to interact with applicants and determine whether they would be a good fit, and mature enough to debate the induction of new members."},
        {
            "id": _ROLE_PRIDE,
            "name": "Sindrian Pride",
            "color": "#e91e63",
            "icon": "\u2657",
            "desc": "Event team that organises weekly community events.",
            "fullDesc": "This group of individuals have dedicated themselves towards helping to organise events and are responsible for a large majority of the guild's events. The head organisers are the Event Managers, who run regular events both in the guild's discord and in the event alliance, Adonis. They keep the community tight-knit and entertained in between war efforts.",
            "applyForm": "pride"
        },
    ],
    "citizenRole": {"id": _ROLE_CITIZEN, "name": "Sindrian Citizen", "color": "#4acf5e"},
    "medals":  _medals_for_client(),
    "badges":  _build_badge_catalog(),
    "applicationForms": {k: {"title": v["title"], "requireRank": v["requireRank"], "requireCitizen": bool(v.get("requireCitizen")), "requirements": v.get("requirements", []), "questions": v["questions"]} for k, v in _APPLICATION_FORMS.items()},
    "guildId": DISCORD_GUILD_ID,
    "devMode": DEV_MODE,
    "serverTimezone": _SERVER_TIMEZONE,
}

# metric keys

RESET_SPIKE_MIN_BY_METRIC = {
    "playtime": 8,
    "wars": 15,
    "guildRaids": 25,
    "mobsKilled": 400,
    "chestsFound": 80,
    "questsDone": 20,
    "totalLevel": 20,
    "dungeons": 20,
    "raids": 15,
    "worldEvents": 20,
    "caves": 10,
}

PLAYER_BULK_METRIC_KEYS = [
    "playtime", "wars", "guildRaids", "mobsKilled", "chestsFound",
    "questsDone", "totalLevel", "contentDone", "dungeons", "raids",
    "worldEvents", "caves",
]

GUILD_BULK_METRIC_KEYS = [
    "playerCount", "wars", "guildRaids", "newMembers", "totalMembers", "overflowMembers",
]

# bot / tracker screen session config

BOT_SCREEN_SESSION = (os.environ.get("ESI_BOT_SCREEN_NAME") or "esi-bot").strip()
TRACKER_SCREEN_SESSION = (os.environ.get("ESI_TRACKERS_SCREEN_NAME") or "esi-bot-trackers").strip()

TRACKER_SCREEN_SPECS = [
    {"name": "API Tracker",      "interval": 300, "keywords": ("api tracker", "api_tracking")},
    {"name": "Playtime Tracker", "interval": 300, "keywords": ("playtime tracker", "playtime_tracking")},
    {"name": "Guild Tracker",    "interval": 30,  "keywords": ("guild tracker", "guild_tracking")},
    {"name": "Claim Tracker",    "interval": 3,   "keywords": ("claim tracker", "claim_tracking")},
]

# utility functions

def _safe_number(value):
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return value
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0


def _parse_bool(value) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


_JSON_MAX_SIZE = 10 * 1024 * 1024
_JSON_MAX_STRING_LEN = 2000
_HTML_TAG_RE = __import__('re').compile(r'<[^>]+>')


def _sanitize_string(s, max_len=_JSON_MAX_STRING_LEN):
    """Strip HTML tags, control characters, and clamp length."""
    if not isinstance(s, str):
        return s
    # strip HTML tags
    s = _HTML_TAG_RE.sub('', s)
    # strip control characters (keep newlines and tabs)
    s = ''.join(c for c in s if c in ('\n', '\t') or (ord(c) >= 32))
    # clamp length
    if len(s) > max_len:
        s = s[:max_len]
    return s


def _sanitize_json(obj):
    """Recursively sanitize all strings in a parsed JSON structure."""
    if isinstance(obj, str):
        return _sanitize_string(obj)
    if isinstance(obj, dict):
        return {_sanitize_string(k, 200): _sanitize_json(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize_json(item) for item in obj]
    return obj


def _load_json_file(path):
    if not os.path.exists(path):
        return {}
    try:
        size = os.path.getsize(path)
        if size > _JSON_MAX_SIZE:
            print(f"[ERROR] JSON file too large ({size} bytes): {path}", file=sys.stderr)
            return {}
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        return _sanitize_json(data)
    except json.JSONDecodeError as e:
        print(f"[ERROR] Malformed JSON in {path}: {e}", file=sys.stderr)
        return {}
    except OSError as e:
        print(f"[ERROR] Cannot read {path}: {e}", file=sys.stderr)
        return {}


def _save_json_file(path, data):
    """Write JSON atomically: write to a temp file then rename over the target."""
    import tempfile as _tempfile
    dir_ = os.path.dirname(os.path.abspath(path))
    fd, tmp = _tempfile.mkstemp(dir=dir_, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)
        os.replace(tmp, path)  # atomic on same filesystem
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _mc_username(discord_id, matches):
    """Look up the Minecraft username tied to a Discord ID."""
    entry = matches.get(str(discord_id))
    if entry is None:
        return None
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        return entry.get("username")
    return None


def _get_secret_key():
    """Flask session key - saved to a file so it survives server restarts."""
    key = os.environ.get("FLASK_SECRET_KEY")
    if key:
        return key
    key_path = os.path.join(_BASE_DIR, ".flask_secret")
    if os.path.exists(key_path):
        with open(key_path) as f:
            return f.read().strip()
    key = secrets.token_hex(32)
    fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(key)
    return key


def _get_latest_api_db():
    """Find the newest .db file in the api_tracking folder, or None."""
    from datetime import datetime as _dt
    if not os.path.isdir(_API_TRACKING_DIR):
        return None
    latest_db, latest_dt = None, None
    for name in os.listdir(_API_TRACKING_DIR):
        if not name.startswith("api_"):
            continue
        day_path = os.path.join(_API_TRACKING_DIR, name)
        if not os.path.isdir(day_path):
            continue
        try:
            day_dt = _dt.strptime(name[4:], "%d-%m-%Y")
        except ValueError:
            continue
        files = sorted(f for f in os.listdir(day_path) if f.endswith(".db"))
        if files and (latest_dt is None or day_dt > latest_dt):
            latest_dt = day_dt
            latest_db = os.path.join(day_path, files[-1])
    return latest_db


def _is_player_api_off(snapshot):
    if not snapshot:
        return False
    return all(_safe_number(snapshot.get(k, 0)) == 0 for k in [
        "playtime", "wars", "totalLevel", "mobsKilled",
        "chestsFound", "dungeons", "raids", "worldEvents",
        "caves", "questsDone",
    ])


def _is_reactivation_spike(prev_value, curr_value, seen_non_zero,
                            metric_key=None, prev_snapshot=None, curr_snapshot=None):
    if prev_value is None or curr_value is None:
        return False
    prev_n = _safe_number(prev_value)
    curr_n = _safe_number(curr_value)
    if prev_n != 0 or curr_n <= 0:
        return False
    min_spike = _safe_number(RESET_SPIKE_MIN_BY_METRIC.get(metric_key, 25))
    if curr_n < min_spike:
        return False
    if seen_non_zero:
        return True
    for key in ("playtime", "wars", "totalLevel", "mobsKilled",
                "chestsFound", "dungeons", "raids", "worldEvents",
                "caves", "questsDone"):
        if key == metric_key:
            continue
        if prev_snapshot and _safe_number(prev_snapshot.get(key)) > 0:
            return True
        if curr_snapshot and _safe_number(curr_snapshot.get(key)) > 0:
            return True
    return False
