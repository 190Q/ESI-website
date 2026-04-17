"""
main.py — Gateway server.
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
            # Skip whitelisted peers (e.g. loopback nginx upstream).
            if ip and ip not in BAN_WHITELIST:
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
_SPA_PANELS              = ("player", "guild", "bot", "inactivity", "promotions")

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


@app.before_request
def _gate_requests():
    # reject banned IPs immediately
    if _HAS_BAN and is_banned(request.remote_addr):
        abort(403)
    path = request.path
    # HTTP/1.0 direct to the gateway (no upstream proxy header) is a scanner
    # fingerprint, real browsers are 1.1+, and nginx/Cloudflare always set
    # X-Forwarded-For.  Insta-blacklist.
    protocol = request.environ.get("SERVER_PROTOCOL", "")
    if protocol == "HTTP/1.0" and not request.headers.get("X-Forwarded-For"):
        if _HAS_BAN and request.remote_addr:
            blacklist_ip(
                request.remote_addr,
                reason=f"Non-human pattern: direct {protocol} request",
            )
        abort(403)
    # WordPress probe → instant permanent blacklist
    if _WORDPRESS_PATH_RE.search(path):
        if _HAS_BAN and request.remote_addr:
            blacklist_ip(
                request.remote_addr,
                reason=f"WordPress probe: {path}",
            )
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
    ip = request.remote_addr or "unknown"
    # record strikes for the ip ban system
    if _HAS_BAN:
        if response.status_code == 403:
            record_strike(ip, "blocked")
        elif response.status_code == 429:
            record_strike(ip, "rate_limit")
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
