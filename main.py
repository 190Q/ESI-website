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

import os
import requests
from flask import Flask, request, Response, jsonify, send_from_directory, abort
from werkzeug.middleware.proxy_fix import ProxyFix

from config import (
    _BASE_DIR, _UPLOAD_DIR, GATEWAY_PORT, ROUTES_URL,
)

os.makedirs(_UPLOAD_DIR, exist_ok=True)

app = Flask(__name__, static_folder=_BASE_DIR, static_url_path="")
# trust one layer of X-Forwarded-* from nginx / Cloudflare
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)

# static file gating

_ALLOWED_STATIC_PREFIXES = ("/css/", "/js/", "/images/", "/assets/")
_ALLOWED_STATIC_FILES    = ("/index.html", "/favicon.ico")


@app.before_request
def _gate_requests():
    path = request.path
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
    # block everything else (server.py, .env, .db, data files, etc.)
    abort(403)


# security headers

@app.after_request
def _security_headers(response):
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'sha256-ZcKinPTE0IEcBn4hHbqEikOw2x8h4OweeMeXEJ25TS8='; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
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

if __name__ == "__main__":
    print()
    print("  ESI Dashboard Gateway")
    print("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")
    print(f"  Gateway    :5000  \u2192  http://0.0.0.0:{GATEWAY_PORT}")
    print(f"  Routes     :5001  \u2192  {ROUTES_URL}")
    print(f"  Cache      :5002  \u2192  http://127.0.0.1:5002")
    print()
    print("  Press Ctrl+C to stop")
    print()
    app.run(host="0.0.0.0", port=GATEWAY_PORT, debug=False, threaded=True)
