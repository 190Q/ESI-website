"""
main.py - Gateway server.
Runs on port 5000. Serves static files and reverse-proxies
/api/* and /auth/* requests to the routes service on port 5001.

This process is the public-facing entry point and should rarely
need restarting.  Restart routes.py or cache.py independently
without taking the site offline.

    python main.py
"""

import mimetypes
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")
mimetypes.add_type("image/x-icon", ".ico")

import base64
import hashlib
import html as _html
import os
import re
import sys
import time
from urllib.parse import quote as _urlquote, unquote as _urlunquote

import requests
from flask import Flask, request, Response, jsonify, send_from_directory, abort, g
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.serving import WSGIRequestHandler

from config import (
    _BASE_DIR, _UPLOAD_DIR, GATEWAY_PORT, ROUTES_URL, _GATEWAY_SECRET, DEV_MODE,
    _PUBLIC_ORIGIN,
)


# CSP inline-script hash computation
#
# Vite embeds small bootstrap <script> blocks directly inside index.html. Each
# time the frontend is rebuilt the script content (and therefore its hash) may
# change, which would break CSP. Compute the hashes at startup from the file
# on disk so a rebuild never requires editing this file.

_INLINE_SCRIPT_RE = re.compile(
    rb"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>",
    re.DOTALL | re.IGNORECASE,
)


def _compute_inline_script_hashes():
    path = os.path.join(_BASE_DIR, "index.html")
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


_INLINE_SCRIPT_HASHES = _compute_inline_script_hashes()
_inline_script_cache = {"hashes": _INLINE_SCRIPT_HASHES, "mtime": 0}


def _get_inline_script_hashes():
    """Return CSP hashes, recomputing if index.html changed on disk."""
    path = os.path.join(_BASE_DIR, "index.html")
    try:
        mt = os.path.getmtime(path)
    except OSError:
        return _inline_script_cache["hashes"]
    if mt != _inline_script_cache["mtime"]:
        _inline_script_cache["hashes"] = _compute_inline_script_hashes()
        _inline_script_cache["mtime"] = mt
    return _inline_script_cache["hashes"]


def _get_wynnpiece_custom_link_definition(path: str):
    try:
        from wynnpiece.wynnpiece import get_custom_link_definition
    except Exception:
        return None
    try:
        return get_custom_link_definition(path)
    except Exception:
        return None


def _load_wynnpiece_blocked_default_links():
    """Default (non-custom) links that a custom link overrides. Direct browser
    access to these is blocked so users must go through the custom link. The
    set is derived from the wynnpiece progression definitions, not hardcoded."""
    try:
        from wynnpiece.wynnpiece import get_blocked_default_links
    except Exception:
        return frozenset()
    try:
        return frozenset(get_blocked_default_links() or ())
    except Exception:
        return frozenset()


_WYNNPIECE_BLOCKED_DEFAULT_LINKS = _load_wynnpiece_blocked_default_links()

_proxy_session = requests.Session()
_proxy_adapter = requests.adapters.HTTPAdapter(
    pool_connections=50,
    pool_maxsize=50,
    max_retries=1,
)
_proxy_session.mount("http://", _proxy_adapter)
_proxy_session.mount("https://", _proxy_adapter)


def _proxy_to_routes_path(path: str, pass_query: bool = True):
    url = f"{ROUTES_URL}{path}"
    if pass_query and request.query_string:
        url += f"?{request.query_string.decode('utf-8')}"
    headers = {}
    for key, value in request.headers:
        if key.lower() in ("host", "accept-encoding", "x-forwarded-for"):
            continue
        headers[key] = value
    headers["X-Forwarded-For"] = request.remote_addr or ""
    headers["X-Forwarded-Proto"] = request.scheme
    headers["X-Forwarded-Host"] = request.host
    headers["X-Gateway-Secret"] = _GATEWAY_SECRET
    headers["X-Real-Client-IP"] = _real_client_ip() or request.remote_addr or ""
    if path.startswith("/api/wynnpiece/file/") or path.startswith("/api/wynnpiece/page/"):
        req_timeout = (10, 600)
    elif path.startswith("/api/player/") or path.startswith("/api/guild/"):
        req_timeout = 45
    else:
        req_timeout = 30
    try:
        resp = _proxy_session.request(
            method=request.method,
            url=url,
            headers=headers,
            data=request.get_data(),
            allow_redirects=False,
            timeout=req_timeout,
            stream=True,
        )
    except requests.ConnectionError:
        return jsonify({
            "error": "Service temporarily unavailable",
            "message": "The API service is restarting. Please try again in a moment.",
        }), 503
    except requests.Timeout:
        return jsonify({"error": "Service timeout"}), 504
    excluded = {"transfer-encoding", "connection", "keep-alive"}
    response_headers = [
        (k, v) for k, v in resp.raw.headers.items()
        if k.lower() not in excluded
    ]

    def generate():
        try:
            for chunk in resp.iter_content(chunk_size=65536):
                if chunk:
                    yield chunk
        finally:
            resp.close()

    return Response(generate(), resp.status_code, response_headers)


def _proxy_external_url(url: str, pass_query: bool = True):
    final_url = url
    if pass_query and request.query_string:
        sep = "&" if "?" in final_url else "?"
        final_url += f"{sep}{request.query_string.decode('utf-8')}"
    headers = {}
    accept = request.headers.get("Accept")
    user_agent = request.headers.get("User-Agent")
    if accept:
        headers["Accept"] = accept
    if user_agent:
        headers["User-Agent"] = user_agent
    try:
        resp = requests.request(
            method=request.method,
            url=final_url,
            headers=headers,
            allow_redirects=True,
            timeout=30,
        )
    except requests.RequestException:
        return jsonify({"error": "Upstream link is unavailable"}), 502
    excluded = {"transfer-encoding", "connection", "keep-alive"}
    response_headers = [
        (k, v) for k, v in resp.raw.headers.items()
        if k.lower() not in excluded
    ]
    return Response(resp.content, resp.status_code, response_headers)


def _serve_custom_link(path: str):
    link = _get_wynnpiece_custom_link_definition(path)
    if not isinstance(link, dict):
        return None
    target = str(link.get("target") or "").strip()
    pass_query = bool(link.get("pass_query", True))
    if not target:
        return None
    _track_server("link", {
        "target": target,
        "external": target.startswith(("http://", "https://")),
    })
    if target.startswith("/api/") or target.startswith("/auth/"):
        return _proxy_to_routes_path(target, pass_query=pass_query)
    if target.startswith("http://") or target.startswith("https://"):
        return _proxy_external_url(target, pass_query=pass_query)
    rel = target.lstrip("/").replace("\\", "/")
    if ".." in rel.split("/"):
        return jsonify({"error": "Forbidden"}), 403
    abs_target = os.path.join(_BASE_DIR, rel)
    if not os.path.isfile(abs_target):
        return jsonify({"error": "Not found"}), 404
    return send_from_directory(os.path.dirname(abs_target), os.path.basename(abs_target))


# access logger
try:
    from access_logger import log_blocked as _log_blocked, cleanup_old_logs
    _HAS_LOGGER = True
except ImportError:
    _HAS_LOGGER = False

# analytics: every served request goes here, including successful ones
try:
    from analytics import (
        record_request as _record_request,
        record_server_event as _record_server_event,
        normalise_route as _normalise_route,
        cleanup_old_analytics,
        rollup_recent as _rollup_recent,
        ensure_session_cookie as _ensure_session_cookie,
        set_session_cookie as _set_session_cookie,
        SESSION_COOKIE as _ANALYTICS_SESSION_COOKIE,
    )
except ImportError:
    _record_request = None
    _record_server_event = None
    _normalise_route = None
    cleanup_old_analytics = None
    _rollup_recent = None
    _ensure_session_cookie = None
    _set_session_cookie = None
    _ANALYTICS_SESSION_COOKIE = "esi_sid"

_ANALYTICS_SKIP_PREFIXES = ("/api/track",)


def _track_server(kind, props=None):
    """Record an event the gateway observed directly. Never raises.

    Unlike the beacon these hooks cannot be forged by a client, so they carry
    no token. The gateway already knows the page, the session and the IP.
    """
    if _record_server_event is None:
        return False
    try:
        return _record_server_event(
            kind,
            props=props,
            path=_normalise_route(request.path),
            session_cookie=request.cookies.get(_ANALYTICS_SESSION_COOKIE),
            ip=_real_client_ip(),
        )
    except Exception:
        return False

# ip ban system
try:
    from ip_ban import (
        is_banned, record_strike, cleanup_ban_history,
        blacklist_ip, BAN_WHITELIST,
    )
    _HAS_BAN = True
except ImportError:
    _HAS_BAN = False
    BAN_WHITELIST = set()

import ipaddress

# Cloudflare edge IP ranges
_CLOUDFLARE_NETS = [
    ipaddress.ip_network(n) for n in (
        "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22",
        "103.31.4.0/22",   "141.101.64.0/18", "108.162.192.0/18",
        "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22",
        "198.41.128.0/17", "162.158.0.0/15",  "104.16.0.0/13",
        "104.24.0.0/14",   "172.64.0.0/13",   "131.0.72.0/22",
        "2400:cb00::/32",  "2606:4700::/32",  "2803:f800::/32",
        "2405:b500::/32",  "2405:8100::/32",  "2a06:98c0::/29",
        "2c0f:f248::/32",
    )
]


def _is_cloudflare_peer(ip: str) -> bool:
    if not ip:
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _CLOUDFLARE_NETS)


def _real_client_ip():
    """Return the true client IP, honouring Cloudflare's CF-Connecting-IP.

    Falls back to X-Forwarded-For (first entry) and finally to
    request.remote_addr so behaviour is unchanged when no CDN is in front.
    """
    # Only trust CF-Connecting-IP when the TCP peer is actually Cloudflare
    peer = request.environ.get("REMOTE_ADDR") or request.remote_addr
    if _is_cloudflare_peer(peer):
        cf = request.headers.get("CF-Connecting-IP")
        if cf:
            return cf.strip()
    # Only trust X-Forwarded-For from nginx (loopback) or Cloudflare
    trusted_peer = peer in ("127.0.0.1", "::1") or _is_cloudflare_peer(peer)
    xff = request.headers.get("X-Forwarded-For")
    if xff and trusted_peer:
        return xff.split(",")[0].strip()
    return request.remote_addr


def _request_country():
    """The visitor's two-letter country, or None.

    Taken from Cloudflare's CF-IPCountry, and only trusted when the TCP peer is
    one of the proxies in front of the app - nginx on loopback or a genuine
    Cloudflare edge. A direct client could set the header freely, so anywhere
    else it is ignored. Only the country is ever stored; the IP is not.
    """
    peer = request.environ.get("REMOTE_ADDR") or request.remote_addr
    trusted_peer = peer in ("127.0.0.1", "::1") or _is_cloudflare_peer(peer)
    if not trusted_peer:
        return None
    code = (request.headers.get("CF-IPCountry") or "").strip().upper()
    if len(code) != 2 or code in ("XX", "T1"):
        return None
    return code


def _log_cf_skip(peer: str, reason: str) -> None:
    """Print a notice that a blacklist was suppressed because the TCP peer
    was a Cloudflare edge (blacklisting it would block real visitors).
    """
    if _record_server_event is not None:
        try:
            _record_server_event("feature", {"action": "run", "name": "cf-skip"})
        except Exception:
            pass
    print(
        f"[IP-BAN] Skipped blacklist for Cloudflare edge peer {peer} "
        f"(no usable CF-Connecting-IP): {reason}",
        file=sys.stderr,
        flush=True,
    )


class _BanningWSGIRequestHandler(WSGIRequestHandler):
    """Werkzeug request handler that insta-blacklists malformed-HTTP peers.

    Parse-level errors (bad version, raw TLS bytes on an HTTP port, HTTP/2
    preface on an HTTP/1 server, etc.) are emitted by
    BaseHTTPRequestHandler.send_error BEFORE the request ever reaches Flask,
    so we intercept them here.  Codes 400 and 505 at this layer always mean
    the client sent something no real browser would send.
    """

    _MALFORMED_CODES = {400, 505}

    def send_error(self, code, message=None, explain=None):
        if code in self._MALFORMED_CODES and _HAS_BAN:
            ip = None
            try:
                ip = self.client_address[0]
            except Exception:
                pass
            # Never blacklist loopback upstreams or Cloudflare edges
            if ip and ip not in BAN_WHITELIST:
                if _is_cloudflare_peer(ip):
                    print(
                        f"[IP-BAN] Skipped blacklist for Cloudflare edge peer "
                        f"{ip}: Malformed HTTP (code {code}): {message!r}",
                        file=sys.stderr,
                        flush=True,
                    )
                else:
                    try:
                        blacklist_ip(
                            ip,
                            reason=f"Malformed HTTP (code {code}): {message!r}",
                        )
                    except Exception:
                        pass
        return super().send_error(code, message, explain)

os.makedirs(_UPLOAD_DIR, exist_ok=True)

# also copy Flask/werkzeug console output to logs/gateway.log
import logging
_log_dir = os.path.join(_BASE_DIR, "logs")
os.makedirs(_log_dir, exist_ok=True)
_file_handler = logging.FileHandler(os.path.join(_log_dir, "gateway.log"))
_file_handler.setFormatter(logging.Formatter("%(asctime)s  %(message)s"))
_wz_logger = logging.getLogger("werkzeug")
_wz_logger.addHandler(_file_handler)
_wz_logger.addHandler(logging.StreamHandler())  # keep console output
_wz_logger.setLevel(logging.INFO)

app = Flask(__name__, static_folder=_BASE_DIR, static_url_path="")
# trust one layer of X-Forwarded-* from nginx / Cloudflare
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

# static file gating

_ALLOWED_STATIC_PREFIXES = ("/css/", "/js/", "/images/", "/assets/", "/public/", "/wynnpiece/")
_ALLOWED_STATIC_FILES    = ("/index.html", "/favicon.ico", "/wynnpiece", "/wynnpiece/manage")
_SPA_PANELS              = ("player", "guild", "bot", "inactivity", "promotions", "events", "shop", "shop-admin", "events-manage", "guild-health")

# WordPress-probe detection: any hit on one of these paths is almost
# certainly an automated scanner looking for a WP install to exploit.
# We run no WordPress here, so such requests get the IP instantly
# permanently blacklisted.
_WORDPRESS_PATH_RE = re.compile(
    r"(?:^|/)(?:"
    r"wp-admin|wp-login|wp-content|wp-includes|wp-config|wp-json|"
    r"wp-cron|wp-signup|wp-trackback|wp-mail|wp-links-opml|"
    r"xmlrpc\.php|wlwmanifest\.xml|wordpress"
    r")",
    re.IGNORECASE,
)

# Generic exploit-scanner probe detection
_SCANNER_PATH_RE = re.compile(
    r"(?:^|/)(?:"
    # shortlist
    r"odinhttpcall\d*|"
    r"sdk(?=$|[/?])|"
    r"HNAP1|"
    r"bot-connect\.js|"
    r"evox/about|"
    r"boaform|"
    r"phpmyadmin|phpMyAdmin|adminer|pma(?=$|[/?])|"
    r"manager/html|"
    r"solr/|"
    r"robots\.txt(?=$|[/?])|"
    # CMS fingerprints (other than WP)
    r"joomla|drupal|magento|phpbb|vbulletin|typo3|"
    # admin / login / webmail probes
    r"administrator(?=$|[/?])|"
    r"admin(?:\.php|/login|/index|/config)|"
    r"login\.(?:php|asp|aspx|jsp|action|esp)|"
    r"cpanel(?=$|[/?])|whm(?=$|[/?])|webmail(?=$|[/?])|roundcube|"
    # VPN / remote access portal probes
    r"\+CSCOE\+|"
    r"global-protect(?=$|[/?])|"
    # config / secret files
    r"config\.(?:php|inc|bak|old|ya?ml)|"
    r"web\.config|"
    r"docker-compose\.ya?ml|dockerfile(?=$|[/?])|"
    r"\.env(?=\.|$|[/?])|"
    r"\.git/(?:config|HEAD|index|logs)|"
    r"\.svn/|\.hg/|\.bzr/|"
    r"\.aws/credentials|\.ssh/(?:id_rsa|authorized_keys)|"
    # package / build manifests (this app serves none at the URL root)
    r"package(?:-lock)?\.json(?=$|[/?])|"
    r"composer\.(?:json|lock)(?=$|[/?])|"
    r"requirements\.txt(?=$|[/?])|"
    r"yarn\.lock(?=$|[/?])|"
    r"Gemfile(?:\.lock)?(?=$|[/?])|"
    r"pom\.xml(?=$|[/?])|"
    # backup archives at the site root
    r"(?:backup|dump|db|database|site|www|public_html)\."
    r"(?:sql|zip|tar|tar\.gz|tgz|gz|7z|rar|bak|old)|"
    # API / framework discovery
    r"graphql(?:-console|iql)?(?=$|[/?])|"
    r"swagger(?:-ui)?(?=$|[/?.])|"
    r"openapi(?:\.json|\.ya?ml)?(?=$|[/?])|"
    r"api-docs(?=$|[/?])|"
    r"actuator(?=$|[/?])|"
    # MCP (Model Context Protocol) server endpoint probes
    r"mcp(?=$|[/?])|"
    r"sse(?=$|[/?])|"
    # cloud metadata endpoints
    r"latest/meta-data|"
    r"metadata/instance|"
    r"computeMetadata/|"
    # kubernetes / docker runtime APIs
    r"containers/json|"
    r"api/v1/(?:pods|nodes|secrets|namespaces|services)|"
    # IIS / ASP debug artefacts
    r"trace\.axd|elmah\.axd|"
    r"ReportServer(?=$|[/?])|"
    # framework debug / profiler panels
    r"_profiler(?=$|[/?])|_debugbar(?=$|[/?])|phpinfo\.php|"
    # common RCE / uploaded-shell filenames
    r"shell\.(?:php|jsp|aspx?)|"
    r"cmd\.(?:php|jsp|aspx?)|"
    r"eval-stdin\.php|"
    # unix system files / LFI targets
    r"etc/passwd|etc/shadow|proc/self/environ"
    r")",
    re.IGNORECASE,
)

# Debugger / profiler trigger probes in the URL or query string
_DEBUG_PROBE_RE = re.compile(
    r"(?:"
    # Xdebug session / profiler / trace triggers
    r"XDEBUG_SESSION_START=|"
    r"XDEBUG_SESSION=|"
    r"XDEBUG_PROFILE=|"
    r"XDEBUG_TRIGGER=|"
    # Zend debugger triggers
    r"start_debug=1|"
    r"debug_host=|"
    r"debug_port=|"
    r"debug_session_id=|"
    # Symfony profiler / Laravel debugbar
    r"_profiler_open_file=|"
    r"_debugbar="
    r")",
    re.IGNORECASE,
)

# URL-level injection / traversal payloads (checked against raw path+query)
_INJECTION_RE = re.compile(
    r"(?:"
    # path traversal (raw and URL-encoded)
    r"\.\./\.\./|%2e%2e%2f|%252e%252e|"
    r"%00|"
    # SQL injection
    r"\bunion\s+(?:all\s+)?select\b|"
    r"\bor\s+1\s*=\s*1\b|"
    r"'\s*or\s*'1'\s*=\s*'1|"
    r";\s*drop\s+table\s|"
    r"\bsleep\s*\(\s*\d+\s*\)|"
    r"\bbenchmark\s*\(|"
    r"information_schema\b|"
    # XSS
    r"<\s*script\b|"
    r"javascript\s*:|"
    r"onerror\s*=|onload\s*=|"
    r"<\s*iframe\b|"
    # SSRF targets (cloud / link-local)
    r"169\.254\.169\.254|"
    r"metadata\.google\.internal|"
    r"169\.254\.170\.2|"
    # command injection
    r";\s*(?:cat|wget|curl|nc|bash|sh|python|perl)\s|"
    r"\|\s*(?:cat|wget|curl|nc|bash|sh)\s|"
    r"\$\(\s*(?:cat|wget|curl|nc|id|whoami)\b|"
    r"`(?:cat|wget|curl|nc|id|whoami)\b|"
    # SSTI
    r"\{\{\s*[^}]*[._|][^}]*\}\}|"
    r"\$\{[^}]*\}"
    r")",
    re.IGNORECASE,
)

# HTTP methods we never legitimately serve
_BANNED_METHODS = frozenset({
    "TRACE", "TRACK", "CONNECT", "DEBUG",
    "PROPFIND", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK",
})


@app.before_request
def _gate_requests():
    g._analytics_t0 = time.perf_counter()
    ip = _real_client_ip()
    # Never blacklist the Cloudflare edge itself - that would kill every
    # legitimate visitor routed through the same POP.
    peer = request.environ.get("REMOTE_ADDR") or request.remote_addr
    cf_skip = _is_cloudflare_peer(peer) and ip == peer
    if cf_skip:
        # CF header missing despite CF peer → treat as unknown, don't ban.
        ip = None

    def _do_blacklist(reason: str) -> None:
        """Blacklist the real client IP, or log a Cloudflare-skip notice."""
        # Remembered so the analytics row can say why the request was blocked.
        g._analytics_block_reason = reason
        if _HAS_BAN and ip:
            blacklist_ip(ip, reason=reason)
        elif cf_skip:
            _log_cf_skip(peer, reason)

    path = request.path

    _is_wp = path.startswith("/wynnpiece") or path.startswith("/api/wynnpiece")

    # reject banned IPs immediately
    if _HAS_BAN and ip and is_banned(ip):
        g._analytics_block_reason = "Already banned"
        print(
            f"[IP-BAN] gate: already-banned hit  ip={ip}  method={request.method}  path={request.path}",
            file=sys.stderr,
            flush=True,
        )
        abort(403)
    # HTTP methods only scanners / attackers send (XST, WebDAV, proxy abuse)
    if request.method.upper() in _BANNED_METHODS:
        print(
            f"[IP-BAN] gate: banned-method trigger  ip={ip}  peer={peer}  "
            f"method={request.method}  cf_skip={cf_skip}  has_ban={_HAS_BAN}",
            file=sys.stderr,
            flush=True,
        )
        _do_blacklist(f"Banned method: {request.method}")
        abort(403)
    # Request smuggling: both Content-Length and Transfer-Encoding present
    if request.headers.get("Transfer-Encoding") and request.headers.get("Content-Length"):
        _do_blacklist("Request smuggling: CL + TE")
        abort(400)
    # Injection / traversal payload in URL or query string (always checked)
    try:
        qs = request.query_string.decode("utf-8", "replace")
    except Exception:
        qs = ""
    raw = path + ("?" + qs if qs else "")
    if _INJECTION_RE.search(raw):
        _do_blacklist(f"Injection payload: {path}")
        abort(403)
    # block dotfiles (always)
    if "/." in path or path.startswith("."):
        g._analytics_block_reason = "Dotfile"
        abort(403)
    if not _is_wp:
        # HTTP/1.0 direct to the gateway (no upstream proxy header) is a scanner
        # fingerprint, real browsers are 1.1+, and nginx/Cloudflare always set
        # X-Forwarded-For.  Insta-blacklist.
        protocol = request.environ.get("SERVER_PROTOCOL", "")
        if protocol == "HTTP/1.0" and not request.headers.get("X-Forwarded-For"):
            _do_blacklist(f"Non-human pattern: direct {protocol} request")
            abort(403)
        # WordPress probe → instant permanent blacklist
        if _WORDPRESS_PATH_RE.search(path):
            _do_blacklist(f"WordPress probe: {path}")
            abort(403)
        # Generic exploit-scanner probe -> instant permanent blacklist
        if _SCANNER_PATH_RE.search(path):
            _do_blacklist(f"Scanner probe: {path}")
            abort(403)
        # Debugger / profiler trigger probe (Xdebug / Zend / Symfony / Laravel)
        if _DEBUG_PROBE_RE.search(raw):
            _do_blacklist(f"Debugger probe: {path}?{qs}" if qs else f"Debugger probe: {path}")
            abort(403)
    # API and auth go through the proxy routes below
    if path.startswith(("/api/", "/auth/")):
        # A default link that a custom link overrides must not be reachable
        # directly; users can only reach it through the custom link (which is
        # served internally by _serve_custom_link and bypasses this check).
        norm = path if path == "/" else path.rstrip("/")
        if norm in _WYNNPIECE_BLOCKED_DEFAULT_LINKS:
            abort(404)
        return
    # uploads have their own explicit route
    if path.startswith("/uploads/"):
        return
    # allow root and known static paths
    if path == "/":
        return
    if path in _ALLOWED_STATIC_FILES:
        return
    if any(path.startswith(p) for p in _ALLOWED_STATIC_PREFIXES):
        # block sensitive files inside allowed prefixes
        if path.startswith("/wynnpiece/") and path.rsplit(".", 1)[-1] in ("db", "py", "db-shm", "db-wal"):
            abort(403)
        # block specific sensitive wynnpiece files by name
        if path.startswith("/wynnpiece/"):
            basename = path.rsplit("/", 1)[-1].lower()
            if basename in ("event_state.json", "managers.json", "wynnpiece.db", "config.py", "wynnpiece.py", "routes.py", "__init__.py"):
                abort(403)
        # block direct access to wynnpiece attachments (served via gated route)
        if path.startswith("/wynnpiece/attachments/"):
            abort(403)
        custom = _serve_custom_link(path)
        if custom is not None:
            return custom
        return
    # allow SPA panel routes (e.g. /player/190Q, /guild, /bot)
    stripped = path.strip("/").split("/")[0]
    if stripped in _SPA_PANELS:
        return
    custom = _serve_custom_link(path)
    if custom is not None:
        return custom
    # Unknown browser paths should render a not-found page
    if request.method in ("GET", "HEAD"):
        abort(404)
    abort(403)


# logging + security headers


def _ensure_analytics_session(response):
    """Return this visitor's analytics session id, minting the cookie if needed.

    /api/track is skipped: routes.py mints the cookie for those paths itself,
    and two Set-Cookie headers for the same name would race, leaving the
    beacon token bound to an id the browser never stored.
    """
    if _ensure_session_cookie is None:
        return None
    if request.path.startswith(_ANALYTICS_SKIP_PREFIXES):
        return None
    sid, fresh = _ensure_session_cookie(request.cookies.get(_ANALYTICS_SESSION_COOKIE))
    if fresh:
        _set_session_cookie(response, fresh, secure=not DEV_MODE)
    return sid


def _record_analytics(response, session_sid=None):
    """Feed one served request into the analytics store. Never raises.

    Runs for every response, including the ones the gate rejects, so the
    Traffic and Health panels see failures as well as successes.
    """
    if _record_request is None:
        return
    try:
        path = request.path
        if path.startswith(_ANALYTICS_SKIP_PREFIXES):
            return

        started = getattr(g, "_analytics_t0", None)
        duration_ms = None
        if started is not None:
            duration_ms = (time.perf_counter() - started) * 1000.0

        # Streaming proxy responses have no computed length
        size = None
        try:
            size = response.calculate_content_length()
        except Exception:
            size = None
        if size is None:
            declared = response.headers.get("Content-Length")
            if declared and declared.isdigit():
                size = int(declared)

        status = response.status_code
        block_reason = getattr(g, "_analytics_block_reason", None)
        if status == 403 and not block_reason:
            block_reason = "Permission denied"
        _record_request(
            method=request.method,
            path=path,
            status=status,
            duration_ms=duration_ms,
            response_bytes=size,
            cache=response.headers.get("X-Cache"),
            ip=_real_client_ip(),
            user_agent=request.headers.get("User-Agent"),
            session_cookie=session_sid,
            blocked=(status == 403),
            block_reason=block_reason,
            country=_request_country(),
            dnt=(request.headers.get("DNT") or "").strip() == "1",
            gpc=(request.headers.get("Sec-GPC") or "").strip() == "1",
        )
    except Exception:
        pass


@app.after_request
def _after_request(response):
    ip = _real_client_ip() or "unknown"
    # Don't feed strikes against the Cloudflare edge itself.
    peer = request.environ.get("REMOTE_ADDR") or request.remote_addr
    strike_ip = ip if not (_is_cloudflare_peer(peer) and ip == peer) else None
    # record strikes for the ip ban system (skip for wynnpiece paths)
    _is_wp = request.path.startswith("/wynnpiece") or request.path.startswith("/api/wynnpiece")
    _is_beacon = request.path.startswith(_ANALYTICS_SKIP_PREFIXES)
    if _HAS_BAN and strike_ip and not _is_wp and not _is_beacon:
        if response.status_code == 403:
            record_strike(strike_ip, "blocked")
        elif response.status_code == 429:
            record_strike(strike_ip, "rate_limit")
    # only log blocked requests to DB + access.log (skip for wynnpiece)
    if _HAS_LOGGER and response.status_code == 403 and not _is_wp:
        _log_blocked(
            ip=ip,
            method=request.method,
            path=request.path,
            status_code=403,
            user_agent=request.headers.get("User-Agent"),
            referrer=request.headers.get("Referer"),
        )
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        f"script-src 'self' {_get_inline_script_hashes()}; "
        "style-src 'self' 'unsafe-inline'; "
        "font-src 'self' data:; "
        "img-src 'self' https://cdn.discordapp.com https://visage.surgeplay.com https://crafatar.com https://mc-heads.net data:; "
        "connect-src 'self';"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    _record_analytics(response, _ensure_analytics_session(response))
    return response


# static routes

@app.route("/")
def index():
    return send_from_directory(_BASE_DIR, "index.html")


_OG_PLAYER_PATH_RE = re.compile(r"^/player/([^/]+)$")
_OG_USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{1,16}$")


def _og_scope(path):
    """Return (card_type, name) for preview-enabled paths, else (None, None)."""
    match = _OG_PLAYER_PATH_RE.match(path)
    if match:
        name = _urlunquote(match.group(1))
        if _OG_USERNAME_RE.match(name):
            return "player", name
        return None, None
    if path.rstrip("/") == "/guild":
        return "guild", None
    return None, None


def _og_meta_for(card_type, name):
    """Ask the routes service for preview metadata. Never raises."""
    params = {"type": card_type}
    if name:
        params["name"] = name
    try:
        resp = requests.get(
            f"{ROUTES_URL}/api/og/meta",
            params=params,
            headers={
                "X-Gateway-Secret": _GATEWAY_SECRET,
                "X-Real-Client-IP": _real_client_ip() or "",
                "User-Agent": "ESI-Dashboard-Gateway/1.0",
            },
            timeout=6,
        )
        if resp.ok:
            data = resp.json()
            if isinstance(data, dict):
                return data
    except (requests.RequestException, ValueError):
        pass
    return None


def _og_origin():
    """Absolute origin for preview URLs (configured domain wins over Host)."""
    if _PUBLIC_ORIGIN:
        return _PUBLIC_ORIGIN
    return request.host_url.rstrip("/")


def _inject_og_meta(html, card_type, name, meta):
    """Add title/description/Open Graph tags to the SPA shell."""
    esc = _html.escape
    origin = _og_origin()

    title = str(meta.get("title") or "Empire of Sindria dashboard")
    description = str(meta.get("description") or "")
    found = bool(meta.get("found"))
    image_available = bool(meta.get("image_available"))

    if card_type == "player":
        canonical = "/player/" + _urlquote(name or "")
        og_type = "profile"
        image_url = f"{origin}/api/og/player/{_urlquote(name or '')}.png"
    else:
        canonical = "/guild"
        og_type = "website"
        image_url = f"{origin}/api/og/guild.png"

    tags = [
        f'<meta name="description" content="{esc(description, quote=True)}">',
        f'<meta property="og:type" content="{esc(og_type, quote=True)}">',
        '<meta property="og:site_name" content="Empire of Sindria">',
        f'<meta property="og:title" content="{esc(title, quote=True)}">',
        f'<meta property="og:description" content="{esc(description, quote=True)}">',
        f'<meta property="og:url" content="{esc(origin + canonical, quote=True)}">',
        '<meta name="twitter:card" content="summary_large_image">',
        f'<meta name="twitter:title" content="{esc(title, quote=True)}">',
        f'<meta name="twitter:description" content="{esc(description, quote=True)}">',
    ]
    if found and image_available:
        tags.append(f'<meta property="og:image" content="{esc(image_url, quote=True)}">')
        tags.append('<meta property="og:image:width" content="1200">')
        tags.append('<meta property="og:image:height" content="630">')
        tags.append(f'<meta name="twitter:image" content="{esc(image_url, quote=True)}">')

    block = "\n  " + "\n  ".join(tags) + "\n"

    html = re.sub(
        r"<title>.*?</title>",
        lambda _m: f"<title>{esc(title)}</title>",
        html,
        count=1,
        flags=re.DOTALL | re.IGNORECASE,
    )
    if "</head>" in html:
        html = html.replace("</head>", block + "</head>", 1)
    return html


def _serve_spa(_path=None):
    """Serve the SPA shell for panel deep-links, with preview tags where relevant."""
    card_type, name = _og_scope(request.path)
    if card_type is None:
        return send_from_directory(_BASE_DIR, "index.html")

    meta = _og_meta_for(card_type, name)
    if not meta:
        return send_from_directory(_BASE_DIR, "index.html")

    try:
        with open(os.path.join(_BASE_DIR, "index.html"), "r", encoding="utf-8") as fh:
            html = fh.read()
    except OSError:
        return send_from_directory(_BASE_DIR, "index.html")

    return Response(
        _inject_og_meta(html, card_type, name, meta),
        status=200,
        mimetype="text/html",
    )


_SPA_ROUTE_DEFS = (
    ("/player",               "spa_player"),
    ("/player/",              "spa_player_root",   {"_path": ""}),
    ("/player/<path:_path>",  "spa_player_path"),
    ("/guild",                "spa_guild"),
    ("/bot",                  "spa_bot"),
    ("/inactivity",           "spa_inactivity"),
    ("/promotions",           "spa_promotions"),
    ("/guild-health",         "spa_guild_health"),
    ("/events",               "spa_events"),
    ("/events/",              "spa_events_root",   {"_path": ""}),
    ("/events/<path:_path>",  "spa_events_path"),
    ("/shop",                 "spa_shop"),
    ("/shop/",                "spa_shop_root",     {"_path": ""}),
    ("/shop/<path:_path>",    "spa_shop_path"),
    ("/shop-admin",           "spa_shop_admin"),
    ("/events-manage",        "spa_events_manage"),
    ("/guild/info",           "spa_guild_info"),
)
for _spa_rule, _spa_endpoint, *_spa_extra in _SPA_ROUTE_DEFS:
    _spa_defaults = _spa_extra[0] if _spa_extra else None
    app.add_url_rule(
        _spa_rule,
        endpoint=_spa_endpoint,
        view_func=_serve_spa,
        defaults=_spa_defaults,
    )


# Wynn Piece special-event landing page (standalone, not part of the SPA)
@app.route("/wynnpiece")
@app.route("/wynnpiece/")
def wynnpiece():
    return send_from_directory(
        os.path.join(_BASE_DIR, "wynnpiece", "html"),
        "wynnpiece.html",
    )


@app.route("/wynnpiece/manage")
@app.route("/wynnpiece/manage/")
def wynnpiece_manage():
    return send_from_directory(
        os.path.join(_BASE_DIR, "wynnpiece", "html"),
        "manage.html",
    )



_ALLOWED_UPLOAD_EXTENSIONS = frozenset({
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif',
    'pdf', 'txt', 'csv', 'json',
    'zip', 'gz', 'tar',
})

_DOWNLOAD_KINDS = {
    'pdf': 'pdf', 'csv': 'csv', 'json': 'json',
    'png': 'image', 'jpg': 'image', 'jpeg': 'image', 'gif': 'image',
    'webp': 'image', 'avif': 'image',
    'zip': 'archive', 'gz': 'archive', 'tar': 'archive',
}

@app.route("/uploads/<string:filename>")
def serve_upload(filename):
    safe = os.path.basename(filename)
    if safe != filename:
        abort(400)
    ext = safe.rsplit('.', 1)[-1].lower() if '.' in safe else ''
    if ext not in _ALLOWED_UPLOAD_EXTENSIONS:
        abort(403)
    resp = send_from_directory(_UPLOAD_DIR, filename, as_attachment=True)
    resp.headers['Content-Type'] = 'application/octet-stream'
    resp.headers['Content-Disposition'] = f'attachment; filename="{safe}"'
    _track_server("download", {"file": safe, "kind": _DOWNLOAD_KINDS.get(ext, 'other')})
    return resp


# reverse proxy to routes service

def _proxy_to_routes():
    """Forward the current request to the routes service and return the response."""
    return _proxy_to_routes_path(request.path, pass_query=True)


@app.route("/api/", defaults={"_path": ""}, methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
@app.route("/api/<path:_path>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
def proxy_api(_path):
    return _proxy_to_routes()


@app.route("/auth/", defaults={"_path": ""}, methods=["GET", "POST"])
@app.route("/auth/<path:_path>", methods=["GET", "POST"])
def proxy_auth(_path):
    return _proxy_to_routes()


# error handlers

@app.errorhandler(403)
def forbidden(e):
    return jsonify({"error": "Forbidden"}), 403

@app.errorhandler(404)
def not_found(e):
    if request.path.startswith(("/api/", "/auth/")):
        return jsonify({"error": "Not found"}), 404
    if "text/html" in (request.headers.get("Accept") or ""):
        return send_from_directory(_BASE_DIR, "404.html"), 404
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(503)
def service_unavailable(e):
    return jsonify({
        "error": "Service temporarily unavailable",
        "message": "The API service is restarting. Please try again in a moment.",
    }), 503


# startup

def _log_cleanup_loop():
    import threading
    while True:
        threading.Event().wait(3600)
        try:
            cleanup_old_logs()
        except Exception:
            pass
        if _rollup_recent is not None:
            try:
                _rollup_recent()
            except Exception:
                pass
        if cleanup_old_analytics is not None:
            try:
                cleanup_old_analytics()
            except Exception:
                pass
        if _HAS_BAN:
            try:
                cleanup_ban_history()
            except Exception:
                pass


if __name__ == "__main__":
    if _HAS_LOGGER or cleanup_old_analytics is not None:
        import threading as _t
        _t.Thread(target=_log_cleanup_loop, daemon=True).start()

    print()
    print("  ESI Dashboard Gateway")
    print("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")
    print(f"  Gateway    :5000  \u2192  http://0.0.0.0:{GATEWAY_PORT}")
    print(f"  Routes     :5001  \u2192  {ROUTES_URL}")
    print(f"  Cache      :5002  \u2192  http://127.0.0.1:5002")
    print()
    print("  Press Ctrl+C to stop")
    print()
    app.run(
        host="0.0.0.0",
        port=GATEWAY_PORT,
        debug=False,
        threaded=True,
        request_handler=_BanningWSGIRequestHandler,
    )
