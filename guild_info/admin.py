import json
from guild_info import db, forum

# A body may be a plain string or a list of caller-chosen segments. To persist
# segment choices through the queue without ambiguity (a real body could itself
# look like JSON), segmented bodies are stored with this NUL-prefixed sentinel.
_SEG_SENTINEL = "\u0000seg\u0000"

def _encode_body(body) -> str | None:
    """Serialize a body (str or list of segments) for the requests table."""
    if body is None:
        return None
    if isinstance(body, (list, tuple)):
        return _SEG_SENTINEL + json.dumps(list(body), ensure_ascii=False)
    return str(body)

def _decode_body(stored):
    """Inverse of :func:`_encode_body`. Returns a list (segments) or a string."""
    if stored is None:
        return None
    if isinstance(stored, str) and stored.startswith(_SEG_SENTINEL):
        try:
            return json.loads(stored[len(_SEG_SENTINEL):])
        except ValueError:
            return stored[len(_SEG_SENTINEL):]
    return stored

def _body_view(stored) -> dict:
    """Decode a stored body into display fields: ``segments`` + joined ``body``."""
    decoded = _decode_body(stored)
    if decoded is None:
        return {"segments": [], "body": ""}
    if isinstance(decoded, (list, tuple)):
        segs = [("" if s is None else str(s)) for s in decoded]
        return {"segments": segs, "body": "".join(segs)}
    return {"segments": [decoded], "body": decoded}

def list_posts() -> dict:
    """List posts, flagging any that have a pending request (edit-locked)."""
    result = forum.list_posts()
    posts = result.get("posts")
    if isinstance(posts, list):
        pending = db.get_pending_thread_ids()
        for p in posts:
            p["pending_request"] = str(p.get("id")) in pending
    return result

def get_post(thread_id: str) -> dict:
    return forum.get_post(thread_id)

def thread_has_pending_request(thread_id: str | None) -> bool:
    """True if a post already has a pending request (so further edits are locked)."""
    return bool(thread_id) and bool(db.get_pending_requests_for_thread(str(thread_id)))

def thread_has_pending_delete(thread_id: str | None) -> bool:
    """True if a deletion of this post is already pending approval."""
    if not thread_id:
        return False
    return any(r.get("action") == "delete"
               for r in db.get_pending_requests_for_thread(str(thread_id)))

def _cancel_thread_requests(thread_id, actor: str, exclude_id: str | None = None) -> None:
    """Cancel any other pending requests for a thread (its post is gone) and log it."""
    if not thread_id:
        return
    for c in db.cancel_pending_requests_for_thread(str(thread_id), actor, exclude_id=exclude_id):
        db.log_action(actor, "request_cancelled", c["id"],
                      {"action": c.get("action"), "thread_id": str(thread_id),
                       "reason": "post deleted"})

def execute_action(action: str, *, thread_id: str | None = None,
                   title: str | None = None, body=None) -> dict:
    """Run a single forum action. Returns the forum helper dict (may hold ``error``)."""
    if action == "create":
        return forum.create_post(title, body)
    if action == "edit_body":
        return forum.edit_body(thread_id, body)
    if action == "edit_title":
        return forum.edit_title(thread_id, title)
    if action == "edit":  # combined title and/or body
        last: dict = {"id": str(thread_id)}
        if title is not None:
            last = forum.edit_title(thread_id, title)
            if last.get("error"):
                return last
        if body is not None:
            last = forum.edit_body(thread_id, body)
            if last.get("error"):
                return last
        return last
    if action == "delete":
        return forum.delete_post(thread_id)
    return {"error": f"Unknown action: {action}"}

def direct_action(action: str, actor: str, *, thread_id: str | None = None,
                  title: str | None = None, body=None) -> dict:
    """Execute a forum action immediately (full-rights tier) and log it."""
    result = execute_action(action, thread_id=thread_id, title=title, body=body)
    if result.get("error"):
        db.log_action(actor, "action_failed", thread_id,
                      {"action": action, "error": result["error"]})
    else:
        db.log_action(actor, "action_executed", result.get("id") or thread_id,
                      {"action": action, "title": title,
                       "warning": result.get("warning")})
        # A deleted post takes its pending requests with it
        if action == "delete" and thread_id:
            _cancel_thread_requests(thread_id, actor)
    return result

def submit_request(action: str, *, thread_id: str | None = None,
                   title: str | None = None, body=None,
                   prev_title: str | None = None, prev_body: str | None = None,
                   requester_id: str, requester_name: str | None = None) -> dict:
    """Enqueue a pending request (Parliament tier) and log the submission."""
    req = db.create_request(
        action, thread_id=thread_id, title=title, body=_encode_body(body),
        prev_title=prev_title, prev_body=prev_body,
        requested_by_id=requester_id, requested_by_name=requester_name,
    )
    db.log_action(requester_name or requester_id, "request_submitted", req["id"],
                  {"action": action, "thread_id": thread_id, "title": title})
    return _public_request(req)


def get_queue() -> list:
    """Pending requests, with bodies decoded for display."""
    return [_public_request(r) for r in db.get_pending_requests()]

def get_logs(page: int = 1, per_page: int = 50) -> dict:
    return db.get_logs(page=page, per_page=per_page)

def approve_request(request_id: str, actor: str, edited_title=None,
                    edited_body=None) -> dict:
    """Approve a pending request, optionally editing its content first.

    Executes the underlying forum action; marks the request approved on success
    or failed otherwise. Returns ``{"ok": True, ...}`` or ``{"error": ...}``.
    """
    req = db.get_request(request_id)
    if not req:
        return {"error": "Request not found"}
    if req["status"] != "pending":
        return {"error": "Request is not pending"}

    action = req["action"]
    title = edited_title if edited_title is not None else req.get("title")
    body = edited_body if edited_body is not None else _decode_body(req.get("body"))
    thread_id = req.get("thread_id")

    result = execute_action(action, thread_id=thread_id, title=title, body=body)
    if result.get("error"):
        db.resolve_request(request_id, "failed", actor, deny_reason=result["error"])
        db.log_action(actor, "request_failed", request_id,
                      {"action": action, "error": result["error"]})
        return {"error": result["error"]}

    result_thread = result.get("id") or thread_id
    db.resolve_request(request_id, "approved", actor, result_thread_id=result_thread)
    db.log_action(actor, "request_approved", request_id,
                  {"action": action, "thread_id": result_thread,
                   "edited": edited_title is not None or edited_body is not None,
                   "warning": result.get("warning")})
    # Approving a delete removes the post, so drop any other pending requests for it
    if action == "delete" and thread_id:
        _cancel_thread_requests(thread_id, actor, exclude_id=request_id)
    return {"ok": True, "request_id": request_id, "result": result}

def deny_request(request_id: str, actor: str, reason: str) -> dict:
    """Deny a pending request. Returns the requester so the route can DM them."""
    reason = (reason or "").strip()
    if not reason:
        return {"error": "Reason is required"}
    req = db.get_request(request_id)
    if not req:
        return {"error": "Request not found"}
    if req["status"] != "pending":
        return {"error": "Request is not pending"}

    db.resolve_request(request_id, "denied", actor, deny_reason=reason)
    db.log_action(actor, "request_denied", request_id,
                  {"action": req["action"], "reason": reason})
    return {
        "ok": True,
        "request_id": request_id,
        "requester_id": req.get("requested_by_id"),
        "requester_name": req.get("requested_by_name"),
        "action": req.get("action"),
        "title": req.get("title"),
        "reason": reason,
    }

def _public_request(req: dict) -> dict:
    """Shape a stored request row for API responses (decode the body)."""
    out = dict(req)
    out.update(_body_view(req.get("body")))
    return out

# Privilege-escalation gate
def is_privilege_approved(discord_id: str) -> bool:
    """True if the user is approved to use the Guild Info page."""
    return db.is_privilege_approved(discord_id)

def ensure_privilege_request(discord_id: str, username: str | None = None) -> dict | None:
    """Create a pending privilege request for a newly-detected privileged user."""
    req = db.ensure_privilege_request(discord_id, username)
    if req:
        db.log_action(username or discord_id, "privilege_requested", discord_id,
                      {"discord_id": discord_id, "username": username})
    return req

def get_privilege_queue() -> list:
    """Pending privilege requests, for the approver queue view."""
    return db.get_pending_privilege_requests()

def approve_privilege_request(request_id: str, actor: str) -> dict:
    """Grant Guild Info access for a pending privilege request."""
    req = db.get_privilege_request(request_id)
    if not req:
        return {"error": "Request not found"}
    if req["status"] != "pending":
        return {"error": "Request is not pending"}
    discord_id = req["discord_id"]
    db.set_privilege_approved(discord_id, actor)
    db.resolve_privilege_request(request_id, "approved", actor)
    db.log_action(actor, "privilege_approved", discord_id,
                  {"discord_id": discord_id, "username": req.get("username")})
    return {"ok": True, "request_id": request_id,
            "discord_id": discord_id, "username": req.get("username")}

def deny_privilege_request(request_id: str, actor: str) -> dict:
    """Deny a pending privilege request. Returns the requester so the route can DM them."""
    req = db.get_privilege_request(request_id)
    if not req:
        return {"error": "Request not found"}
    if req["status"] != "pending":
        return {"error": "Request is not pending"}
    discord_id = req["discord_id"]
    db.resolve_privilege_request(request_id, "denied", actor)
    db.log_action(actor, "privilege_denied", discord_id,
                  {"discord_id": discord_id, "username": req.get("username")})
    return {"ok": True, "request_id": request_id,
            "discord_id": discord_id, "username": req.get("username")}
