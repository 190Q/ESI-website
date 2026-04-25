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
import os
import re
import sys
import requests
from flask import Flask, request, Response, jsonify, send_from_directory, abort
from werkzeug.middleware.proxy_fix import ProxyFix
from werkzeug.serving import WSGIRequestHandler

from config import (
    _BASE_DIR, _UPLOAD_DIR, GATEWAY_PORT, ROUTES_URL,
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
        digest = hashlib.sha256(match.group(1)).digest()
        b64 = base64.b64encode(digest).decode("ascii")
        parts.append(f"'sha256-{b64}'")
    return " ".join(parts)


_INLINE_SCRIPT_HASHES = _compute_inline_script_hashes()

# access logger
try:
    from access_logger import log_blocked as _log_blocked, cleanup_old_logs
    _HAS_LOGGER = True
except ImportError:
    _HAS_LOGGER = False

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
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        # first entry is the original client when the chain is trusted
        return xff.split(",")[0].strip()
    return request.remote_addr


def _log_cf_skip(peer: str, reason: str) -> None:
    """Print a notice that a blacklist was suppressed because the TCP peer
    was a Cloudflare edge (blacklisting it would block real visitors).
    """
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

_ALLOWED_STATIC_PREFIXES = ("/css/", "/js/", "/images/", "/assets/", "/public/")
_ALLOWED_STATIC_FILES    = ("/index.html", "/favicon.ico")
_SPA_PANELS              = ("player", "guild", "bot", "inactivity", "promotions", "events")

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
        if _HAS_BAN and ip:
            blacklist_ip(ip, reason=reason)
        elif cf_skip:
            _log_cf_skip(peer, reason)

    # reject banned IPs immediately
    if _HAS_BAN and ip and is_banned(ip):
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
    path = request.path
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
    # Injection / traversal payload in URL or query string
    try:
        qs = request.query_string.decode("utf-8", "replace")
    except Exception:
        qs = ""
    raw = path + ("?" + qs if qs else "")
    if _INJECTION_RE.search(raw):
        _do_blacklist(f"Injection payload: {path}")
        abort(403)
    # Debugger / profiler trigger probe (Xdebug / Zend / Symfony / Laravel)
    if _DEBUG_PROBE_RE.search(raw):
        _do_blacklist(f"Debugger probe: {path}?{qs}" if qs else f"Debugger probe: {path}")
        abort(403)
    # block dotfiles
    if "/." in path or path.startswith("."):
        abort(403)
    # API and auth go through the proxy routes below
    if path.startswith(("/api/", "/auth/")):
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
        return
    # allow SPA panel routes (e.g. /player/190Q, /guild, /bot)
    stripped = path.strip("/").split("/")[0]
    if stripped in _SPA_PANELS:
        return
    # block everything else (server.py, .env, .db, data files, etc.)
    abort(403)


# logging + security headers

@app.after_request
def _after_request(response):
    ip = _real_client_ip() or "unknown"
    # Don't feed strikes against the Cloudflare edge itself.
    peer = request.environ.get("REMOTE_ADDR") or request.remote_addr
    strike_ip = ip if not (_is_cloudflare_peer(peer) and ip == peer) else None
    # record strikes for the ip ban system
    if _HAS_BAN and strike_ip:
        if response.status_code == 403:
            record_strike(strike_ip, "blocked")
        elif response.status_code == 429:
            record_strike(strike_ip, "rate_limit")
    # only log blocked requests to DB + access.log
    if _HAS_LOGGER and response.status_code == 403:
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
        f"script-src 'self' {_INLINE_SCRIPT_HASHES}; "
        "style-src 'self' 'unsafe-inline'; "
        "font-src 'self'; "
        "img-src 'self' https://cdn.discordapp.com https://visage.surgeplay.com https://crafatar.com https://mc-heads.net data:; "
        "connect-src 'self';"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# static routes

@app.route("/")
def index():
    return send_from_directory(_BASE_DIR, "index.html")


@app.route("/player/", defaults={"_path": ""})
@app.route("/player/<path:_path>")
@app.route("/guild")
@app.route("/bot")
@app.route("/inactivity")
@app.route("/promotions")
@app.route("/events")
@app.route("/events/", defaults={"_path": ""})
@app.route("/events/<path:_path>")
def spa_route(_path=None):
    return send_from_directory(_BASE_DIR, "index.html")


@app.route("/uploads/<string:filename>")
def serve_upload(filename):
    safe = os.path.basename(filename)
    if safe != filename:
        abort(400)
    return send_from_directory(_UPLOAD_DIR, filename, as_attachment=True)


# reverse proxy to routes service

def _proxy_to_routes():
    """Forward the current request to the routes service and return the response."""
    # build target URL with path + query string
    url = f"{ROUTES_URL}{request.path}"
    if request.query_string:
        url += f"?{request.query_string.decode('utf-8')}"

    # forward headers (except Host and Accept-Encoding to avoid gzip issues)
    headers = {}
    for key, value in request.headers:
        if key.lower() in ("host", "accept-encoding"):
            continue
        headers[key] = value

    # add proxy identification headers
    headers["X-Forwarded-For"] = request.remote_addr or ""
    headers["X-Forwarded-Proto"] = request.scheme
    headers["X-Forwarded-Host"] = request.host

    try:
        resp = requests.request(
            method=request.method,
            url=url,
            headers=headers,
            data=request.get_data(),
            allow_redirects=False,
            timeout=30,
        )
    except requests.ConnectionError:
        return jsonify({
            "error": "Service temporarily unavailable",
            "message": "The API service is restarting. Please try again in a moment.",
        }), 503
    except requests.Timeout:
        return jsonify({"error": "Service timeout"}), 504

    # build Flask response, preserving all headers including multiple Set-Cookie
    excluded = {"transfer-encoding", "connection", "keep-alive"}
    response_headers = [
        (k, v) for k, v in resp.raw.headers.items()
        if k.lower() not in excluded
    ]
    return Response(resp.content, resp.status_code, response_headers)


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
        if _HAS_BAN:
            try:
                cleanup_ban_history()
            except Exception:
                pass


if __name__ == "__main__":
    if _HAS_LOGGER:
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
