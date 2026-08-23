"""
security_gate.py - Shared request-gating security logic for public-facing
Flask services.

This mirrors the protections main.py's gateway already applies (Cloudflare-
aware real-IP resolution, banned HTTP methods, request-smuggling detection,
injection/traversal payload detection, scanner/WordPress-probe detection,
and malformed-HTTP insta-blacklisting), extracted into a standalone module
so a *new* service (currently just panel.py) can opt into identical
defenses without importing or modifying main.py itself.

main.py's own gate is left completely untouched - this module exists purely
so new services don't have to reinvent (or under-implement) the same
protections. It only depends on ip_ban.py / access_logger.py / config.py,
none of which start any server as an import side effect, so it's safe to
import from a standalone process.
"""

import ipaddress
import re
import sys
import threading
from time import time

from flask import abort, request
from werkzeug.serving import WSGIRequestHandler

try:
    from ip_ban import is_banned, record_strike, blacklist_ip, BAN_WHITELIST
    HAS_BAN = True
except ImportError:
    HAS_BAN = False
    BAN_WHITELIST = set()

try:
    from access_logger import log_blocked
    HAS_LOGGER = True
except ImportError:
    HAS_LOGGER = False


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


def is_cloudflare_peer(ip: str) -> bool:
    if not ip:
        return False
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _CLOUDFLARE_NETS)


def real_client_ip() -> str:
    """Return the true client IP, honouring Cloudflare's CF-Connecting-IP.

    Falls back to X-Forwarded-For (first entry, only trusted from a
    loopback or Cloudflare peer) and finally request.remote_addr.
    """
    peer = request.environ.get("REMOTE_ADDR") or request.remote_addr
    if is_cloudflare_peer(peer):
        cf = request.headers.get("CF-Connecting-IP")
        if cf:
            return cf.strip()
    trusted_peer = peer in ("127.0.0.1", "::1") or is_cloudflare_peer(peer)
    xff = request.headers.get("X-Forwarded-For")
    if xff and trusted_peer:
        return xff.split(",")[0].strip()
    return request.remote_addr


# WordPress-probe detection: any hit on one of these paths is almost
# certainly an automated scanner. Fuck WordPress.
WORDPRESS_PATH_RE = re.compile(
    r"(?:^|/)(?:"
    r"wp-admin|wp-login|wp-content|wp-includes|wp-config|wp-json|"
    r"wp-cron|wp-signup|wp-trackback|wp-mail|wp-links-opml|"
    r"xmlrpc\.php|wlwmanifest\.xml|wordpress"
    r")",
    re.IGNORECASE,
)

# Generic exploit-scanner probe detection
SCANNER_PATH_RE = re.compile(
    r"(?:^|/)(?:"
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
    r"joomla|drupal|magento|phpbb|vbulletin|typo3|"
    r"administrator(?=$|[/?])|"
    r"admin(?:\.php|/login|/index|/config)|"
    r"login\.(?:php|asp|aspx|jsp|action|esp)|"
    r"cpanel(?=$|[/?])|whm(?=$|[/?])|webmail(?=$|[/?])|roundcube|"
    r"\+CSCOE\+|"
    r"global-protect(?=$|[/?])|"
    r"config\.(?:php|inc|bak|old|ya?ml)|"
    r"web\.config|"
    r"docker-compose\.ya?ml|dockerfile(?=$|[/?])|"
    r"\.env(?=\.|$|[/?])|"
    r"\.git/(?:config|HEAD|index|logs)|"
    r"\.svn/|\.hg/|\.bzr/|"
    r"\.aws/credentials|\.ssh/(?:id_rsa|authorized_keys)|"
    r"package(?:-lock)?\.json(?=$|[/?])|"
    r"composer\.(?:json|lock)(?=$|[/?])|"
    r"requirements\.txt(?=$|[/?])|"
    r"yarn\.lock(?=$|[/?])|"
    r"Gemfile(?:\.lock)?(?=$|[/?])|"
    r"pom\.xml(?=$|[/?])|"
    r"(?:backup|dump|db|database|site|www|public_html)\."
    r"(?:sql|zip|tar|tar\.gz|tgz|gz|7z|rar|bak|old)|"
    r"graphql(?:-console|iql)?(?=$|[/?])|"
    r"swagger(?:-ui)?(?=$|[/?.])|"
    r"openapi(?:\.json|\.ya?ml)?(?=$|[/?])|"
    r"api-docs(?=$|[/?])|"
    r"actuator(?=$|[/?])|"
    r"mcp(?=$|[/?])|"
    r"sse(?=$|[/?])|"
    r"latest/meta-data|"
    r"metadata/instance|"
    r"computeMetadata/|"
    r"containers/json|"
    r"api/v1/(?:pods|nodes|secrets|namespaces|services)|"
    r"trace\.axd|elmah\.axd|"
    r"ReportServer(?=$|[/?])|"
    r"_profiler(?=$|[/?])|_debugbar(?=$|[/?])|phpinfo\.php|"
    r"shell\.(?:php|jsp|aspx?)|"
    r"cmd\.(?:php|jsp|aspx?)|"
    r"eval-stdin\.php|"
    r"etc/passwd|etc/shadow|proc/self/environ"
    r")",
    re.IGNORECASE,
)

# Debugger / profiler trigger probes in the URL or query string
DEBUG_PROBE_RE = re.compile(
    r"(?:"
    r"XDEBUG_SESSION_START=|"
    r"XDEBUG_SESSION=|"
    r"XDEBUG_PROFILE=|"
    r"XDEBUG_TRIGGER=|"
    r"start_debug=1|"
    r"debug_host=|"
    r"debug_port=|"
    r"debug_session_id=|"
    r"_profiler_open_file=|"
    r"_debugbar="
    r")",
    re.IGNORECASE,
)

# URL-level injection / traversal payloads (checked against raw path+query)
INJECTION_RE = re.compile(
    r"(?:"
    r"\.\./\.\./|%2e%2e%2f|%252e%252e|"
    r"%00|"
    r"\bunion\s+(?:all\s+)?select\b|"
    r"\bor\s+1\s*=\s*1\b|"
    r"'\s*or\s*'1'\s*=\s*'1|"
    r";\s*drop\s+table\s|"
    r"\bsleep\s*\(\s*\d+\s*\)|"
    r"\bbenchmark\s*\(|"
    r"information_schema\b|"
    r"<\s*script\b|"
    r"javascript\s*:|"
    r"onerror\s*=|onload\s*=|"
    r"<\s*iframe\b|"
    r"169\.254\.169\.254|"
    r"metadata\.google\.internal|"
    r"169\.254\.170\.2|"
    r";\s*(?:cat|wget|curl|nc|bash|sh|python|perl)\s|"
    r"\|\s*(?:cat|wget|curl|nc|bash|sh)\s|"
    r"\$\(\s*(?:cat|wget|curl|nc|id|whoami)\b|"
    r"`(?:cat|wget|curl|nc|id|whoami)\b|"
    r"\{\{\s*[^}]*[._|][^}]*\}\}|"
    r"\$\{[^}]*\}"
    r")",
    re.IGNORECASE,
)

# HTTP methods that are never legitimately serve
BANNED_METHODS = frozenset({
    "TRACE", "TRACK", "CONNECT", "DEBUG",
    "PROPFIND", "MKCOL", "COPY", "MOVE", "LOCK", "UNLOCK",
})


def register_security_gate(app, service_name="service"):
    """Attach the shared before/after-request security gate to *app*.

    Rejects already-banned IPs, banned HTTP methods, request smuggling,
    injection/traversal payloads, dotfiles, and known scanner/WordPress
    probe paths. On violations, blacklists the offending IP (fail2ban-style,
    shared with the main site via ip_ban.py) and logs it (access_logger.py).
    """

    @app.before_request
    def _security_gate():
        ip = real_client_ip()
        peer = request.environ.get("REMOTE_ADDR") or request.remote_addr
        cf_skip = is_cloudflare_peer(peer) and ip == peer
        if cf_skip:
            ip = None

        def _do_blacklist(reason: str) -> None:
            if HAS_BAN and ip:
                blacklist_ip(ip, reason=f"[{service_name}] {reason}")

        path = request.path

        if HAS_BAN and ip and is_banned(ip):
            abort(403)
        if request.method.upper() in BANNED_METHODS:
            _do_blacklist(f"Banned method: {request.method}")
            abort(403)
        if request.headers.get("Transfer-Encoding") and request.headers.get("Content-Length"):
            _do_blacklist("Request smuggling: CL + TE")
            abort(400)
        try:
            qs = request.query_string.decode("utf-8", "replace")
        except Exception:
            qs = ""
        raw = path + ("?" + qs if qs else "")
        if INJECTION_RE.search(raw):
            _do_blacklist(f"Injection payload: {path}")
            abort(403)
        if "/." in path or path.startswith("."):
            abort(403)
        if WORDPRESS_PATH_RE.search(path):
            _do_blacklist(f"WordPress probe: {path}")
            abort(403)
        if SCANNER_PATH_RE.search(path):
            _do_blacklist(f"Scanner probe: {path}")
            abort(403)
        if DEBUG_PROBE_RE.search(raw):
            _do_blacklist(f"Debugger probe: {path}?{qs}" if qs else f"Debugger probe: {path}")
            abort(403)

    @app.after_request
    def _security_gate_after(response):
        ip = real_client_ip() or "unknown"
        peer = request.environ.get("REMOTE_ADDR") or request.remote_addr
        strike_ip = ip if not (is_cloudflare_peer(peer) and ip == peer) else None
        if HAS_BAN and strike_ip:
            if response.status_code == 403:
                record_strike(strike_ip, "blocked")
            elif response.status_code == 429:
                record_strike(strike_ip, "rate_limit")
        if HAS_LOGGER and response.status_code == 403:
            log_blocked(
                ip=ip,
                method=request.method,
                path=request.path,
                status_code=403,
                user_agent=request.headers.get("User-Agent"),
                referrer=request.headers.get("Referer"),
            )
        return response


class BanningWSGIRequestHandler(WSGIRequestHandler):
    """Werkzeug request handler that insta-blacklists malformed-HTTP peers.

    Identical strategy to main.py's _BanningWSGIRequestHandler: parse-level
    errors (bad HTTP version, raw TLS bytes on an HTTP port, etc.) never
    reach Flask, so we intercept them here, before the request is ever
    routed.
    """

    _MALFORMED_CODES = {400, 505}

    def send_error(self, code, message=None, explain=None):
        if code in self._MALFORMED_CODES and HAS_BAN:
            ip = None
            try:
                ip = self.client_address[0]
            except Exception:
                pass
            if ip and ip not in BAN_WHITELIST and not is_cloudflare_peer(ip):
                try:
                    blacklist_ip(ip, reason=f"Malformed HTTP (code {code}): {message!r}")
                except Exception:
                    pass
        return super().send_error(code, message, explain)
