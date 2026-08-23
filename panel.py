"""
panel.py - Standalone control panel service.
Runs on its own port/screen session, completely independent of
main.py / routes.py / cache.py. It can start/stop/restart those
services (and the bot screens) even when all of them are down, since it
never imports any of them - only config.py, ip_ban.py, access_logger.py,
and security_gate.py (none of which start a server as an import
side effect).

    python panel.py
"""

import ast
import base64
import functools
import hashlib
import json
import os
import re
import secrets
import shlex
import sqlite3
import subprocess
import sys
import tempfile
import threading
from collections import deque
from datetime import datetime, timedelta
from time import sleep, time
from urllib.parse import urlencode

import requests
from flask import Flask, abort, jsonify, redirect, request, send_from_directory, session
from werkzeug.middleware.proxy_fix import ProxyFix

from config import (
    _BASE_DIR, _ESI_BOT_DIR, _QBOT_DIR,
    DISCORD_API, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID,
    DISCORD_TOKEN, PANEL_PORT, PANEL_REDIRECT_URI, PANEL_ALLOWED_IPS,
    BOT_SCREEN_SESSION, TRACKER_SCREEN_SESSION,
    GATEWAY_PORT, ROUTES_PORT, CACHE_PORT,
    _TICKET_GUILD_ID, _STAFF_ROLE_DEFS,
    DEV_MODE,
)
from security_gate import register_security_gate, real_client_ip, BanningWSGIRequestHandler

_STATIC_DIR = os.path.join(_BASE_DIR, "panel_static")
_LOG_DIR = os.path.join(_BASE_DIR, "logs")
os.makedirs(_LOG_DIR, exist_ok=True)


# ---------------------------------------------------------------------------
# Compute inline-script hashes from panel_static/index.html so CSP survives
# frontend rebuilds without ever needing 'unsafe-inline' - same mechanism
# routes.py uses for the main site's index.html.
# ---------------------------------------------------------------------------

_INLINE_SCRIPT_RE = re.compile(
    rb"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>",
    re.DOTALL | re.IGNORECASE,
)


def _compute_inline_script_hashes():
    path = os.path.join(_STATIC_DIR, "index.html")
    try:
        with open(path, "rb") as fh:
            html = fh.read()
    except OSError:
        return ""
    parts = []
    for match in _INLINE_SCRIPT_RE.finditer(html):
        content = match.group(1).replace(b"\r\n", b"\n")
        digest = hashlib.sha256(content).digest()
        b64 = base64.b64encode(digest).decode("ascii")
        parts.append(f"'sha256-{b64}'")
    return " ".join(parts)


_inline_script_cache = {"hashes": _compute_inline_script_hashes(), "mtime": 0}


def _get_inline_script_hashes():
    """Return CSP hashes, recomputing if index.html changed on disk."""
    path = os.path.join(_STATIC_DIR, "index.html")
    try:
        mt = os.path.getmtime(path)
    except OSError:
        return _inline_script_cache["hashes"]
    if mt != _inline_script_cache["mtime"]:
        _inline_script_cache["hashes"] = _compute_inline_script_hashes()
        _inline_script_cache["mtime"] = mt
    return _inline_script_cache["hashes"]


# ---------------------------------------------------------------------------
# Panel-only secret key. Deliberately NOT shared with the main site's
# .flask_secret: if the panel were ever compromised, an attacker holding a
# shared secret could forge session cookies for the main site too. A
# separate secret keeps the blast radius contained to the panel itself.
# ---------------------------------------------------------------------------

def _get_panel_secret_key():
    key = os.environ.get("PANEL_SECRET_KEY")
    if key:
        return key
    key_path = os.path.join(_BASE_DIR, ".panel_secret")
    if os.path.exists(key_path):
        with open(key_path) as f:
            return f.read().strip()
    key = secrets.token_hex(32)
    fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(key)
    return key


app = Flask(__name__)
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.secret_key = _get_panel_secret_key()
app.config.update(
    SESSION_COOKIE_NAME="esi_panel_session",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=not DEV_MODE,
    PERMANENT_SESSION_LIFETIME=timedelta(minutes=30),
)

register_security_gate(app, service_name="panel")

_SESSION_IDLE_TIMEOUT = 30 * 60  # 30 min - tighter than the main site's 3h


# ---------------------------------------------------------------------------
# Controllable services registry - the ONLY things panel.py is allowed to
# touch. Every action dispatches through this fixed dict; nothing here is
# ever built from user-supplied input.
# ---------------------------------------------------------------------------

SERVICES = {
    "gateway": {"kind": "website", "screen": "esi-website-gateway", "reload_arg": "gateway", "label": "Website Gateway", "port": GATEWAY_PORT, "command": "python3 main.py"},
    "routes":  {"kind": "website", "screen": "esi-website-routes",  "reload_arg": "routes",  "label": "Website Routes", "port": ROUTES_PORT, "command": "python3 routes.py"},
    "cache":   {"kind": "website", "screen": "esi-website-cache",   "reload_arg": "cache",   "label": "Website Cache", "port": CACHE_PORT, "command": "python3 cache.py"},
    "q-bot":   {"kind": "bot", "screen": "q-bot", "dir": _QBOT_DIR, "script": "bot.py", "label": "Q-Bot", "port": None, "command": "python3 bot.py"},
    "esi-bot": {"kind": "bot", "screen": BOT_SCREEN_SESSION, "dir": _ESI_BOT_DIR, "script": "bot.py", "label": "ESI-Bot", "port": None, "command": "python3 bot.py"},
    "esi-bot-trackers": {
        "kind": "bot", "screen": TRACKER_SCREEN_SESSION,
        "dir": os.path.join(_ESI_BOT_DIR, "trackers"), "script": "main.py",
        "label": "ESI-Bot Trackers", "port": None, "command": "python3 main.py",
    },
}

_RELOAD_SCRIPT = os.path.join(_BASE_DIR, "scripts", "screen-reload.sh")


def _log_path(spec):
    return os.path.join(_LOG_DIR, f"{spec['screen']}.log")


# ---------------------------------------------------------------------------
# subprocess helpers - list-form args only, never shell=True, never built
# from anything other than the fixed SERVICES dict above.
# ---------------------------------------------------------------------------

def _run(args, timeout=8, cwd=None):
    try:
        proc = subprocess.run(
            args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, timeout=timeout, check=False, cwd=cwd, shell=False,
        )
        return proc.returncode, proc.stdout or "", proc.stderr or ""
    except (OSError, subprocess.SubprocessError) as exc:
        return None, "", str(exc)


def _screen_pid(name):
    code, out, err = _run(["screen", "-ls"])
    if code is None:
        return None
    text = (out or "") + "\n" + (err or "")
    m = re.search(rf"^\s*(\d+)\.{re.escape(name)}\s", text, re.MULTILINE)
    return int(m.group(1)) if m else None


def _uptime_seconds(name):
    pid = _screen_pid(name)
    if not pid:
        return None
    code, out, _ = _run(["ps", "-o", "etimes=", "-p", str(pid)])
    if code is None:
        return None
    m = re.search(r"\d+", out or "")
    return int(m.group(0)) if m else None


def _read_hardcopy(name):
    if not name:
        return ""
    fd, tmp_path = tempfile.mkstemp(prefix="esi_panel_", suffix=".log")
    os.close(fd)
    try:
        code, _, _ = _run(["screen", "-S", name, "-X", "hardcopy", "-h", tmp_path], timeout=6)
        if code != 0:
            return ""
        with open(tmp_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    except OSError:
        return ""
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


def _read_log_tail(spec, max_lines=600, max_bytes=200_000):
    """Tail the service's persistent log file (written by screen-reload.sh /
    _start_bot's tee wrapper). Falls back to a screen hardcopy snapshot for
    services that haven't been (re)started since log redirection was added,
    AND for any currently running instance that was started some other way
    (e.g. a manual `screen -dm python3 bot.py` outside the panel/scripts) -
    detected by the log file's mtime predating the running process's start
    time, since such a process never writes to that file and the panel
    would otherwise show its stale, frozen contents forever."""
    path = _log_path(spec)
    if os.path.isfile(path):
        uptime = _uptime_seconds(spec["screen"])
        if uptime is not None:
            try:
                if os.path.getmtime(path) < (time() - uptime) - 2:
                    return _read_hardcopy(spec["screen"])
            except OSError:
                pass
        try:
            size = os.path.getsize(path)
            with open(path, "rb") as f:
                if size > max_bytes:
                    f.seek(size - max_bytes)
                    f.readline()  # drop the (likely partial) first line
                data = f.read()
            lines = data.decode("utf-8", errors="ignore").splitlines()
            return "\n".join(lines[-max_lines:])
        except OSError:
            pass
    return _read_hardcopy(spec["screen"])


# ---------------------------------------------------------------------------
# Process-tree resource metrics. `screen -ls` only reports the PID of the
# screen manager itself, so we walk its full descendant tree (screen -> bash
# -> python3) with a single `ps` call and sum CPU/RSS across it. Note: ps's
# %cpu is a lifetime average since the process started, not an instantaneous
# rate - good enough to spot a leak/spike trend, not a precise live gauge.
# ---------------------------------------------------------------------------

def _list_processes():
    code, out, _ = _run(["ps", "-eo", "pid,ppid,pcpu,rss,comm", "--no-headers"], timeout=5)
    if code != 0:
        return []
    rows = []
    for line in (out or "").splitlines():
        parts = line.split(None, 4)
        if len(parts) < 5:
            continue
        try:
            rows.append((int(parts[0]), int(parts[1]), float(parts[2]), int(parts[3]), parts[4]))
        except ValueError:
            continue
    return rows


def _descendant_metrics(root_pid):
    if not root_pid:
        return None
    rows = _list_processes()
    children, by_pid = {}, {}
    for pid, ppid, pcpu, rss, comm in rows:
        children.setdefault(ppid, []).append(pid)
        by_pid[pid] = (pcpu, rss, comm)
    if root_pid not in by_pid:
        return None
    stack, seen = [root_pid], set()
    total_cpu, total_rss_kb, leaf_pid = 0.0, 0, root_pid
    while stack:
        pid = stack.pop()
        if pid in seen:
            continue
        seen.add(pid)
        pcpu, rss, comm = by_pid.get(pid, (0.0, 0, ""))
        total_cpu += pcpu
        total_rss_kb += rss
        if comm.startswith("python"):
            leaf_pid = pid
        stack.extend(children.get(pid, []))
    return {
        "pid": leaf_pid,
        "cpu_percent": round(total_cpu, 1),
        "memory_mb": round(total_rss_kb / 1024, 1),
    }


# ---------------------------------------------------------------------------
# Request-rate parsing - only meaningful for the 3 website services, whose
# Flask dev servers log werkzeug-style access lines to their log file.
# ---------------------------------------------------------------------------

_ACCESS_LOG_RE = re.compile(r'\[(\d{2}/\w{3}/\d{4} \d{2}:\d{2}:\d{2})\] "[A-Z]+ \S+ HTTP/\d\.\d" \d{3}')


def _request_rate(spec, window_seconds=300):
    if spec["kind"] != "website":
        return None
    path = _log_path(spec)
    if not os.path.isfile(path):
        return None
    try:
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            if size > 262_144:
                f.seek(size - 262_144)
                f.readline()
            data = f.read()
    except OSError:
        return None
    cutoff = datetime.now() - timedelta(seconds=window_seconds)
    count = 0
    for match in _ACCESS_LOG_RE.finditer(data.decode("utf-8", errors="ignore")):
        try:
            ts = datetime.strptime(match.group(1), "%d/%b/%Y %H:%M:%S")
        except ValueError:
            continue
        if ts >= cutoff:
            count += 1
    return round(count / (window_seconds / 60), 1)


_METRICS_HISTORY: dict = {}
_METRICS_HISTORY_LEN = 40  # ~10 min of history at the 15s poll interval
_metrics_lock = threading.Lock()


def _service_status(key, spec):
    pid = _screen_pid(spec["screen"])
    running = pid is not None
    uptime = _uptime_seconds(spec["screen"]) if running else None
    metrics = _descendant_metrics(pid) if running else None
    if running:
        sample = {
            "ts": int(time()),
            "cpu": (metrics or {}).get("cpu_percent", 0),
            "mem_mb": (metrics or {}).get("memory_mb", 0),
        }
        with _metrics_lock:
            hist = _METRICS_HISTORY.setdefault(key, deque(maxlen=_METRICS_HISTORY_LEN))
            hist.append(sample)
            history = list(hist)
    else:
        history = list(_METRICS_HISTORY.get(key, []))
    return {
        "key": key,
        "label": spec.get("label", key),
        "kind": spec["kind"],
        "running": running,
        "uptime_seconds": uptime,
        "started_at": int(time() - uptime) if uptime is not None else None,
        "pid": (metrics or {}).get("pid") if running else None,
        "memory_mb": (metrics or {}).get("memory_mb") if running else None,
        "cpu_percent": (metrics or {}).get("cpu_percent") if running else None,
        "port": spec.get("port"),
        "command": spec.get("command", ""),
        "screen": spec["screen"],
        "request_rate": _request_rate(spec) if running else None,
        "history": history,
    }


_BOT_ENV_ALLOWLIST = ("PATH", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL", "TERM", "SHELL")


def _bot_env():
    """Build a clean, minimal environment for launching bot screens instead
    of inheriting panel.py's own process environment wholesale.

    panel.py loads ESI-website/.env via config.py's load_dotenv(), which
    (like every dotenv call) sets those values as REAL OS environment
    variables on panel.py's own process - not just an internal config dict.
    subprocess.Popen inherits the parent's full environment by default, so a
    naive `os.environ.copy()` here would leak the website's own DISCORD_TOKEN
    (and anything else in ESI-website/.env) into the spawned bot's process.

    That leak is actively harmful, not just untidy: each bot's own bot.py
    calls load_dotenv() with no arguments, which by default NEVER overrides
    a variable that already exists in the environment. If DISCORD_TOKEN is
    already present (leaked from panel.py, holding the *website's* token),
    the bot silently keeps that inherited value instead of loading its own
    token from its own .env - so the bot logs into Discord's gateway as the
    website's bot identity instead of its own. This only ever happened via
    panel-triggered starts (never a manual SSH start) because only panel.py's
    own process, not a fresh shell, ever had that variable set in the first
    place.

    To make this whole class of bug impossible (now and for any future .env
    key, not just DISCORD_TOKEN), start from an explicit allowlist of the
    bare OS/shell variables screen/bash/python3 need to run at all, and let
    each bot's own .env be the sole source of its own secrets."""
    env = {k: v for k, v in os.environ.items() if k in _BOT_ENV_ALLOWLIST}
    venv = os.environ.get("VIRTUAL_ENV")
    if venv:
        venv_bin = os.path.join(venv, "bin") + os.pathsep
        if env.get("PATH", "").startswith(venv_bin):
            env["PATH"] = env["PATH"][len(venv_bin):]
    return env


def _start_bot(spec):
    if _screen_pid(spec["screen"]) is not None:
        return 0, "already running", ""
    if not os.path.isdir(spec["dir"]):
        return None, "", f"Directory not found: {spec['dir']}"
    try:
        subprocess.Popen(
            ["screen", "-S", spec["screen"], "-dm", "-h", "100000", "python3", spec["script"]],
            cwd=spec["dir"], shell=False, env=_bot_env(),
        )
        return 0, "started", ""
    except OSError as exc:
        return None, "", str(exc)


def _stop_service(spec):
    return _run(["screen", "-S", spec["screen"], "-X", "quit"], timeout=8)


def _wait_until_stopped(spec, timeout=10, interval=0.4):
    """Actively poll until the screen session is actually gone, instead of
    guessing a fixed delay. screen -X quit returns as soon as the quit
    command is issued - it does not wait for the process (or screen's own
    session bookkeeping) to fully clear. Starting a replacement while the
    old session still shows up makes _start_bot's running-check silently
    no-op ("already running"), which is why restart could appear to do
    nothing even though stop+start each work fine on their own."""
    deadline = time() + timeout
    while time() < deadline:
        if _screen_pid(spec["screen"]) is None:
            return True
        sleep(interval)
    return _screen_pid(spec["screen"]) is None


def _reload_website(spec):
    if not os.path.isfile(_RELOAD_SCRIPT):
        return None, "", f"Reload script not found: {_RELOAD_SCRIPT}"
    return _run(["sh", _RELOAD_SCRIPT, spec["reload_arg"]], timeout=30)


def _do_action(key, action):
    spec = SERVICES[key]
    if action == "logs":
        return 0, _read_log_tail(spec), ""
    if spec["kind"] == "website":
        if action in ("start", "restart"):
            return _reload_website(spec)
        if action == "stop":
            return _stop_service(spec)
    else:  # bot
        if action == "start":
            return _start_bot(spec)
        if action == "stop":
            return _stop_service(spec)
        if action == "restart":
            _stop_service(spec)
            _wait_until_stopped(spec, timeout=10)
            return _start_bot(spec)
    return None, "", f"Unsupported action {action!r} for kind {spec['kind']!r}"


_SCRIPTS_DIR = os.path.join(_BASE_DIR, "scripts")

_SCRIPTS = {
    "ban-ip": {"path": os.path.join(_SCRIPTS_DIR, "ban_ip.py"), "label": "Ban / Blacklist IPs"},
    "gdpr-delete": {"path": os.path.join(_SCRIPTS_DIR, "gdpr_delete.py"), "label": "GDPR: Delete User Data"},
    "gdpr-export": {"path": os.path.join(_SCRIPTS_DIR, "gdpr_export.py"), "label": "GDPR: Export User Data"},
    "gdpr-list": {"path": os.path.join(_SCRIPTS_DIR, "gdpr_list.py"), "label": "GDPR: List Users With Data"},
    "gdpr-rectify": {"path": os.path.join(_SCRIPTS_DIR, "gdpr_rectify.py"), "label": "GDPR: Rectify User Data"},
    "gdpr-restrict": {"path": os.path.join(_SCRIPTS_DIR, "gdpr_restrict.py"), "label": "GDPR: Restrict User Processing"},
    "grant-knight-bonus": {"path": os.path.join(_SCRIPTS_DIR, "grant_knight_bonus.py"), "label": "Grant Knight EP Bonus"},
    "send-cycle-announcement": {"path": os.path.join(_SCRIPTS_DIR, "send_cycle_announcement.py"), "label": "Send Cycle Announcement"},
    "test-local": {"path": os.path.join(_SCRIPTS_DIR, "test_local.py"), "label": "Run Local Test Suite"},
}


def _script_screen_name(key):
    return f"panel-script-{key}"


def _script_spec(key):
    return {"screen": _script_screen_name(key)}


def _script_docstring_summary(path):
    """First non-empty line of the script's module docstring, for the list view."""
    try:
        with open(path, "r", encoding="utf-8") as f:
            src = f.read()
        tree = ast.parse(src)
        doc = ast.get_docstring(tree) or ""
    except (OSError, SyntaxError, ValueError):
        return ""
    for line in doc.splitlines():
        line = line.strip()
        if line:
            return line
    return ""


_HELP_SECTION_RE = re.compile(r"^(positional arguments|options|optional arguments):\s*$")
_HELP_OPTION_START_RE = re.compile(r"^ {2}(-\S.*)$")
_HELP_POSITIONAL_START_RE = re.compile(r"^ {2}(\S.*)$")
_HELP_ALIAS_SPLIT_RE = re.compile(r",\s*(?=-)")


def _split_header_and_help(line):
    m = re.match(r"^(\S(?:.*?\S)?)(?: {2,}(.*))?$", line.strip())
    if not m:
        return line.strip(), None
    return m.group(1), m.group(2)


def _parse_option_header(header):
    """'--ban IP' -> (['--ban'], ['IP']); '-h, --help' -> (['-h','--help'], []);
    '--set KEY VALUE' -> (['--set'], ['KEY','VALUE']);
    '--format {pretty,sql,python}' -> (['--format'], ['{pretty,sql,python}'])."""
    flags, metavar_str = [], None
    for segment in _HELP_ALIAS_SPLIT_RE.split(header):
        parts = segment.strip().split(None, 1)
        if not parts:
            continue
        flags.append(parts[0])
        if len(parts) > 1 and metavar_str is None:
            metavar_str = parts[1]
    if metavar_str is None:
        metavars = []
    elif metavar_str.startswith("{"):
        metavars = [metavar_str]
    else:
        metavars = metavar_str.split()
    return flags, metavars


def _parse_argparse_help(text):
    positionals, flags = [], []
    section, current = None, None

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        header_match = _HELP_SECTION_RE.match(stripped)
        if header_match:
            section = header_match.group(1)
            current = None
            continue
        if section not in ("positional arguments", "options", "optional arguments"):
            continue
        if not stripped:
            section, current = None, None
            continue
        if not line.startswith("  "):
            break  # unindented text (epilog, etc.) - stop parsing entirely

        if section == "positional arguments":
            m = _HELP_POSITIONAL_START_RE.match(line)
            if m:
                name, inline_help = _split_header_and_help(m.group(1))
                current = {"name": name, "help": inline_help or ""}
                positionals.append(current)
                continue
        else:
            m = _HELP_OPTION_START_RE.match(line)
            if m:
                header, inline_help = _split_header_and_help(m.group(1))
                flag_names, metavars = _parse_option_header(header)
                current = {
                    "flags": flag_names,
                    "metavars": metavars,
                    "takes_value": bool(metavars),
                    "help": inline_help or "",
                }
                flags.append(current)
                continue

        if current is not None:
            extra = stripped
            current["help"] = (current["help"] + " " + extra).strip() if current["help"] else extra

    return {"positionals": positionals, "flags": flags}


_SCRIPT_HELP_CACHE: dict = {}
_script_help_lock = threading.Lock()


def _get_script_help(key):
    spec = _SCRIPTS.get(key)
    if not spec:
        return None
    path = spec["path"]
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None
    with _script_help_lock:
        cached = _SCRIPT_HELP_CACHE.get(key)
        if cached and cached["mtime"] == mtime:
            return cached["data"]
    code, out, _err = _run(["python3", path, "--help"], timeout=10, cwd=_BASE_DIR)
    if code != 0:
        return None
    data = _parse_argparse_help(out)
    with _script_help_lock:
        _SCRIPT_HELP_CACHE[key] = {"mtime": mtime, "data": data}
    return data


_SCRIPT_ARG_MAX_LEN = 500


def _validate_script_args(key, payload):
    """Re-validate a run request against the script's own freshly-parsed
    --help output. Returns (argv_tail, error_message) - never trusts the
    client's flag names/values beyond checking them against this allowlist.
    Values may not start with '-' so they can never be reinterpreted as a
    different option once placed into argv."""
    help_data = _get_script_help(key)
    if help_data is None:
        return None, "Could not determine this script's flags (--help failed)."

    argv = []

    positionals = payload.get("positionals")
    if not isinstance(positionals, list):
        positionals = []
    if len(positionals) > len(help_data["positionals"]):
        return None, "Too many positional arguments."
    for value in positionals:
        value = str(value)
        if not value or len(value) > _SCRIPT_ARG_MAX_LEN or value.startswith("-"):
            return None, f"Invalid positional argument: {value!r}"
        argv.append(value)

    known_flags = {}
    for entry in help_data["flags"]:
        for name in entry["flags"]:
            known_flags[name] = entry

    submitted = payload.get("flags")
    if not isinstance(submitted, list):
        submitted = []
    for item in submitted:
        if not isinstance(item, dict):
            return None, "Malformed flag entry."
        name = str(item.get("name", ""))
        entry = known_flags.get(name)
        if entry is None:
            return None, f"Unknown flag: {name!r}"
        canonical = entry["flags"][0]  # never trust the client's own spelling
        if not entry["takes_value"]:
            argv.append(canonical)
            continue
        values = item.get("values")
        if values is None and "value" in item:
            values = [item["value"]]
        if not isinstance(values, list):
            values = []
        expected = max(1, len(entry["metavars"]))
        if len(values) != expected:
            return None, f"Flag {name!r} expects {expected} value(s)."
        argv.append(canonical)
        for v in values:
            v = str(v)
            if len(v) > _SCRIPT_ARG_MAX_LEN or v.startswith("-"):
                return None, f"Invalid value for {name!r}: {v!r}"
            argv.append(v)

    return argv, None


def _start_script(key, argv_tail):
    spec = _script_spec(key)
    if _screen_pid(spec["screen"]) is not None:
        return None, "", "This script is already running."
    script_path = _SCRIPTS[key]["path"]
    log_path = _log_path(spec)
    try:
        open(log_path, "w").close()  # fresh log per run
    except OSError:
        pass
    quoted = " ".join(shlex.quote(a) for a in [script_path, *argv_tail])
    bash_cmd = (
        f"exec > >(tee -a {shlex.quote(log_path)}) 2>&1; "
        f"cd {shlex.quote(_BASE_DIR)} && python3 {quoted}; "
        'echo "[DONE] exit code: $?"'
    )
    try:
        subprocess.Popen(
            ["screen", "-S", spec["screen"], "-dm", "-h", "100000", "bash", "-c", bash_cmd],
            shell=False,
        )
        return 0, "started", ""
    except OSError as exc:
        return None, "", str(exc)


def _stop_script(key):
    spec = _script_spec(key)
    return _run(["screen", "-S", spec["screen"], "-X", "quit"], timeout=8)


# ---------------------------------------------------------------------------
# Audit log - every access attempt and every action, kept separate from the
# main site's tables.
# ---------------------------------------------------------------------------

_AUDIT_DB = os.path.join(_LOG_DIR, "panel_audit.db")
_audit_local = threading.local()


def _audit_db():
    conn = getattr(_audit_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(_AUDIT_DB, timeout=10, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ts          REAL NOT NULL,
                ip          TEXT,
                actor_id    TEXT,
                actor_name  TEXT,
                action      TEXT NOT NULL,
                service     TEXT,
                result      TEXT,
                detail      TEXT
            )
        """)
        conn.commit()
        _audit_local.conn = conn
    return conn


def _audit(action, service=None, user=None, result="ok", detail=""):
    try:
        conn = _audit_db()
        conn.execute(
            "INSERT INTO audit_log (ts, ip, actor_id, actor_name, action, service, result, detail)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                time(), real_client_ip(),
                (user or {}).get("id"), (user or {}).get("username"),
                action, service, result, (detail or "")[:1000],
            ),
        )
        conn.commit()
    except sqlite3.Error:
        pass


# ---------------------------------------------------------------------------
# Privilege model
# ---------------------------------------------------------------------------

def _is_owner(user) -> bool:
    """Same rule as routes.py's _is_owner_user - matches the OWNER env var
    against the logged-in Discord user's ID, username, or username#tag."""
    owner = str(os.environ.get("OWNER") or "").strip()
    if not owner or not isinstance(user, dict):
        return False
    user_id = str(user.get("id") or "").strip()
    owner_id = owner.strip("<@!>").strip() if owner.startswith("<@") else owner
    if owner_id and owner_id == user_id:
        return True
    owner_l = owner.lower()
    username = str(user.get("username") or "").strip().lower()
    discriminator = str(user.get("discriminator") or "").strip()
    tag = f"{username}#{discriminator}".lower() if username and discriminator else ""
    return owner_l in {username, tag}


_staff_cache: dict = {}
_STAFF_TTL = 300


def _staff_role_name(user) -> str | None:
    """Look up the user's highest matching role on the ticket server
    (Bot Owner / Developer / User Support). Cached per-user for _STAFF_TTL
    seconds - _access_level() (and therefore this) runs on every
    require_access-gated request, including the /panel/api/services poll
    that fires every 15s. Without caching, if _is_owner() ever fails to
    match (env drift, wrong ID, etc.) this would hit Discord's live API
    with the bot's own token every 15s indefinitely for as long as the
    panel tab stays open - exactly the kind of pattern Discord's abuse
    detection flags a token for."""
    if not isinstance(user, dict) or not DISCORD_TOKEN or not _TICKET_GUILD_ID:
        return None
    user_id = str(user.get("id") or "")
    if not user_id:
        return None
    now = time()
    cached = _staff_cache.get(user_id)
    if cached and now - cached["ts"] < _STAFF_TTL:
        return cached["role"]
    role = None
    try:
        resp = requests.get(
            f"{DISCORD_API}/guilds/{_TICKET_GUILD_ID}/members/{user_id}",
            headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
            timeout=8,
        )
        if resp.ok:
            member_roles = set(resp.json().get("roles", []))
            for rd in _STAFF_ROLE_DEFS:
                if rd["role_id"] in member_roles:
                    role = rd["name"]
                    break
    except requests.RequestException:
        pass
    _staff_cache[user_id] = {"role": role, "ts": now}
    return role


def _access_level(user) -> str | None:
    if _is_owner(user):
        return "owner"
    role = _staff_role_name(user)
    if role == "Developer":
        return "developer"
    if role == "User Support":
        return "support"
    return None


_ACCESS_RANK = {"support": 1, "developer": 2, "owner": 3}


def require_access(min_level="owner"):
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            user = session.get("user")
            if not user:
                return jsonify({"error": "Authentication required"}), 401
            level = _access_level(user)
            if not level or _ACCESS_RANK.get(level, 0) < _ACCESS_RANK.get(min_level, 999):
                _audit("access_denied", user=user, result="forbidden", detail=request.path)
                return jsonify({"error": "Insufficient permissions"}), 403
            return fn(*args, **kwargs)
        return wrapper
    return deco


def require_csrf(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        token = request.headers.get("X-CSRF-Token", "")
        expected = session.get("csrf_token", "")
        if not expected or not secrets.compare_digest(token, expected):
            return jsonify({"error": "Invalid or missing CSRF token"}), 403
        return fn(*args, **kwargs)
    return wrapper


# ---------------------------------------------------------------------------
# In-memory rate limiter for action endpoints (defense against accidental /
# malicious rapid double-restarts). Separate from the main site's limiter.
# ---------------------------------------------------------------------------

_rate_state: dict = {}
_rate_lock = threading.Lock()


def _rate_limited(bucket_key, max_calls, window=60):
    """Core token-bucket check, reusable outside the decorator below so
    endpoints can apply different limits to different sub-buckets of the
    same route (e.g. per-action limits on a single <action> URL param)."""
    now = time()
    with _rate_lock:
        calls = _rate_state.setdefault(bucket_key, [])
        calls[:] = [t for t in calls if now - t < window]
        if len(calls) >= max_calls:
            return True
        calls.append(now)
        return False


def rate_limit(max_calls, window=60):
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            bucket_key = (real_client_ip() or "unknown", fn.__name__)
            if _rate_limited(bucket_key, max_calls, window):
                return jsonify({"error": "Too many requests"}), 429
            return fn(*args, **kwargs)
        return wrapper
    return deco


# ---------------------------------------------------------------------------
# Request hooks
# ---------------------------------------------------------------------------

@app.before_request
def _panel_ip_allowlist():
    if PANEL_ALLOWED_IPS:
        ip = real_client_ip()
        if ip not in PANEL_ALLOWED_IPS:
            abort(404)


@app.before_request
def _panel_session_idle_timeout():
    session.permanent = True
    last = session.get("_last_active")
    now = time()
    if last and now - last > _SESSION_IDLE_TIMEOUT and session.get("user"):
        session.clear()
    session["_last_active"] = now


@app.after_request
def _panel_security_headers(response):
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        f"script-src 'self' {_get_inline_script_hashes()}; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' https://cdn.discordapp.com data:; connect-src 'self';"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if not DEV_MODE:
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response


# ---------------------------------------------------------------------------
# Auth routes
# ---------------------------------------------------------------------------

@app.route("/panel/auth/login")
@rate_limit(20, 60)
def panel_login():
    if not PANEL_REDIRECT_URI:
        return jsonify({"error": "PANEL_REDIRECT_URI is not configured"}), 500
    state = secrets.token_urlsafe(16)
    session["oauth_state"] = state
    params = urlencode({
        "client_id":     DISCORD_CLIENT_ID,
        "redirect_uri":  PANEL_REDIRECT_URI,
        "response_type": "code",
        "scope":         "identify",
        "state":         state,
    })
    return redirect(f"https://discord.com/oauth2/authorize?{params}")


@app.route("/panel/auth/callback")
def panel_callback():
    error = request.args.get("error")
    if error:
        return redirect("/panel/?auth=error")
    code = request.args.get("code")
    state = request.args.get("state")
    saved_state = session.pop("oauth_state", None)
    if not state or state != saved_state:
        return redirect("/panel/?auth=error")
    try:
        token_resp = requests.post(
            f"{DISCORD_API}/oauth2/token",
            data={
                "client_id":     DISCORD_CLIENT_ID,
                "client_secret": DISCORD_CLIENT_SECRET,
                "grant_type":    "authorization_code",
                "code":          code,
                "redirect_uri":  PANEL_REDIRECT_URI,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
        token_resp.raise_for_status()
        access_token = token_resp.json()["access_token"]
        user_resp = requests.get(
            f"{DISCORD_API}/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        user_resp.raise_for_status()
        discord_user = user_resp.json()
    except (requests.RequestException, KeyError) as exc:
        print(f"[PANEL-AUTH] OAuth callback error: {exc}", file=sys.stderr)
        return redirect("/panel/?auth=error")

    nick = None
    if DISCORD_GUILD_ID and DISCORD_TOKEN:
        try:
            member_resp = requests.get(
                f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/members/{discord_user['id']}",
                headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
                timeout=10,
            )
            if member_resp.ok:
                nick = member_resp.json().get("nick")
        except requests.RequestException:
            pass

    session.clear()
    session.permanent = True
    user_data = {
        "id":            discord_user["id"],
        "username":      discord_user["username"],
        "nick":          nick,
        "discriminator": discord_user.get("discriminator", "0"),
        "avatar":        discord_user.get("avatar"),
    }
    session["user"] = user_data
    session["_last_active"] = time()
    session["csrf_token"] = secrets.token_urlsafe(32)
    _audit("login", user=user_data, result=_access_level(user_data) or "denied")
    return redirect("/panel/")


@app.route("/panel/auth/logout", methods=["POST"])
def panel_logout():
    user = session.get("user")
    if user:
        _audit("logout", user=user)
    session.clear()
    return jsonify({"ok": True})


@app.route("/panel/auth/session")
def panel_auth_session():
    user = session.get("user")
    if not user:
        return jsonify({"loggedIn": False})
    level = _access_level(user)
    return jsonify({
        "loggedIn": True,
        "user": {
            "id": user["id"], "username": user["username"], "nick": user.get("nick"),
            "avatar": user.get("avatar"),
        },
        "accessLevel": level,
        "csrfToken": session.get("csrf_token"),
    })


# ---------------------------------------------------------------------------
# Panel UI
# ---------------------------------------------------------------------------

@app.route("/panel/")
@app.route("/panel")
def panel_index():
    return send_from_directory(_STATIC_DIR, "index.html")


@app.route("/panel/static/<path:filename>")
def panel_static(filename):
    return send_from_directory(_STATIC_DIR, filename)


# ---------------------------------------------------------------------------
# Service control API - everything below requires owner access.
# ---------------------------------------------------------------------------

@app.route("/panel/api/services")
@require_access("owner")
def panel_list_services():
    return jsonify({"services": [_service_status(k, v) for k, v in SERVICES.items()]})


_ACTION_RATE_LIMITS = {"start": 10, "stop": 10, "restart": 10, "logs": 60}


@app.route("/panel/api/services/<key>/<action>", methods=["POST"])
@require_access("owner")
@require_csrf
def panel_service_action(key, action):
    if key not in SERVICES:
        abort(404)
    if action not in ("start", "stop", "restart", "logs"):
        abort(404)
    bucket_key = (real_client_ip() or "unknown", "panel_service_action", action)
    if _rate_limited(bucket_key, _ACTION_RATE_LIMITS[action], 60):
        return jsonify({"error": "Too many requests"}), 429
    user = session.get("user")
    code, out, err = _do_action(key, action)
    ok = code == 0
    _audit(action, service=key, user=user, result="ok" if ok else "error", detail=err)
    if action == "logs":
        return jsonify({"ok": ok, "output": out[-4000:]})
    return jsonify({
        "ok": ok,
        "returncode": code,
        "stdout": (out or "")[-2000:],
        "stderr": (err or "")[-2000:],
        "status": _service_status(key, SERVICES[key]),
    })


@app.route("/panel/api/services/<key>/events")
@require_access("owner")
def panel_service_events(key):
    if key not in SERVICES:
        abort(404)
    try:
        conn = _audit_db()
        rows = conn.execute(
            "SELECT ts, actor_name, action, result, detail FROM audit_log"
            " WHERE service = ? AND action IN ('start','stop','restart')"
            " ORDER BY ts DESC LIMIT 8",
            (key,),
        ).fetchall()
    except sqlite3.Error:
        rows = []
    return jsonify({"events": [
        {"ts": r[0], "actor": r[1], "action": r[2], "result": r[3], "detail": r[4]}
        for r in rows
    ]})


@app.route("/panel/api/services/<key>/download-log")
@require_access("owner")
@rate_limit(10, 60)
def panel_download_log(key):
    if key not in SERVICES:
        abort(404)
    spec = SERVICES[key]
    path = _log_path(spec)
    if not os.path.isfile(path):
        return jsonify({"error": "No log file yet"}), 404
    _audit("download_log", service=key, user=session.get("user"))
    resp = send_from_directory(_LOG_DIR, os.path.basename(path), as_attachment=True)
    resp.headers["Content-Disposition"] = f'attachment; filename="{key}.log"'
    return resp


@app.route("/panel/api/scripts")
@require_access("owner")
def panel_list_scripts():
    items = [
        {
            "key": key,
            "label": spec["label"],
            "description": _script_docstring_summary(spec["path"]),
        }
        for key, spec in _SCRIPTS.items()
    ]
    items.sort(key=lambda s: s["label"].lower())
    return jsonify({"scripts": items})


@app.route("/panel/api/scripts/<key>/help")
@require_access("owner")
def panel_script_help(key):
    if key not in _SCRIPTS:
        abort(404)
    help_data = _get_script_help(key)
    if help_data is None:
        return jsonify({"error": "Failed to read this script's --help output"}), 500
    return jsonify({
        "key": key,
        "label": _SCRIPTS[key]["label"],
        "description": _script_docstring_summary(_SCRIPTS[key]["path"]),
        "positionals": help_data["positionals"],
        "flags": help_data["flags"],
        "running": _screen_pid(_script_screen_name(key)) is not None,
    })


_SCRIPT_RUN_RATE_LIMIT = 5


@app.route("/panel/api/scripts/<key>/run", methods=["POST"])
@require_access("owner")
@require_csrf
def panel_script_run(key):
    if key not in _SCRIPTS:
        abort(404)
    bucket_key = (real_client_ip() or "unknown", "panel_script_run", key)
    if _rate_limited(bucket_key, _SCRIPT_RUN_RATE_LIMIT, 60):
        return jsonify({"error": "Too many requests"}), 429
    payload = request.get_json(silent=True) or {}
    argv_tail, err = _validate_script_args(key, payload)
    if err:
        return jsonify({"ok": False, "error": err}), 400
    user = session.get("user")
    code, _out, run_err = _start_script(key, argv_tail)
    ok = code == 0
    _audit(
        "script_run", service=key, user=user, result="ok" if ok else "error",
        detail=(run_err or " ".join(argv_tail)),
    )
    if not ok:
        status = 409 if run_err == "This script is already running." else 500
        return jsonify({"ok": False, "error": run_err or "Failed to start"}), status
    return jsonify({"ok": True})


@app.route("/panel/api/scripts/<key>/logs")
@require_access("owner")
def panel_script_logs(key):
    if key not in _SCRIPTS:
        abort(404)
    bucket_key = (real_client_ip() or "unknown", "panel_script_logs", key)
    if _rate_limited(bucket_key, 60, 60):
        return jsonify({"error": "Too many requests"}), 429
    spec = _script_spec(key)
    return jsonify({
        "output": _read_log_tail(spec),
        "running": _screen_pid(spec["screen"]) is not None,
    })


@app.route("/panel/api/scripts/<key>/stop", methods=["POST"])
@require_access("owner")
@require_csrf
@rate_limit(10, 60)
def panel_script_stop(key):
    if key not in _SCRIPTS:
        abort(404)
    user = session.get("user")
    code, _out, err = _stop_script(key)
    ok = code == 0
    _audit("script_stop", service=key, user=user, result="ok" if ok else "error", detail=err)
    return jsonify({"ok": ok})


@app.errorhandler(404)
def _panel_not_found(e):
    return jsonify({"error": "Not found"}), 404


@app.errorhandler(429)
def _panel_rate_limited(e):
    return jsonify({"error": "Too many requests"}), 429


if __name__ == "__main__":
    if not str(os.environ.get("OWNER") or "").strip():
        print("  WARNING: OWNER is not set - nobody will pass the owner check.", file=sys.stderr)
    if not PANEL_REDIRECT_URI:
        print("  WARNING: PANEL_REDIRECT_URI is not set - login will fail.", file=sys.stderr)
    print()
    print("  ESI Control Panel")
    print("  " + "\u2500" * 40)
    print(f"  Listening on 127.0.0.1:{PANEL_PORT}")
    print("  Press Ctrl+C to stop")
    print()
    app.run(
        host="127.0.0.1",
        port=PANEL_PORT,
        debug=False,
        threaded=True,
        request_handler=BanningWSGIRequestHandler,
    )
