import json
from guild_info import db, forum

# A body may be a plain string or a list of caller-chosen segments. To persist
# segment choices through the queue without ambiguity (a real body could itself
# look like JSON), segmented bodies are stored with this NUL-prefixed sentinel.
_SEG_SENTINEL = "\u0000seg\u0000"
# When a request also carries per-message image attachments, the body is stored
# as a JSON object {"segments": [...], "attachments": [...]} behind this second
# sentinel so segments and their images replay together at approval time.
_SEGX_SENTINEL = "\u0000segx\u0000"

def _encode_body(body, attachments=None) -> str | None:
    """Serialize a body (str or list of segments) for the requests table.

    When *attachments* is provided (a list parallel to the body segments) the
    body and attachments are stored together so they survive the queue intact.
    """
    if attachments is not None:
        if isinstance(body, (list, tuple)):
            segs = list(body)
        elif body is None:
            segs = []
        else:
            segs = [body]
        payload = {"segments": segs, "attachments": list(attachments)}
        return _SEGX_SENTINEL + json.dumps(payload, ensure_ascii=False)
    if body is None:
        return None
    if isinstance(body, (list, tuple)):
        return _SEG_SENTINEL + json.dumps(list(body), ensure_ascii=False)
    return str(body)

def _decode_body(stored):
    """Inverse of :func:`_encode_body`.

    Returns ``None``, a ``{"segments", "attachments"}`` dict (segx blob), a list
    of segments (seg blob), or a plain string.
    """
    if stored is None:
        return None
    if isinstance(stored, str) and stored.startswith(_SEGX_SENTINEL):
        try:
            return json.loads(stored[len(_SEGX_SENTINEL):])
        except ValueError:
            return stored[len(_SEGX_SENTINEL):]
    if isinstance(stored, str) and stored.startswith(_SEG_SENTINEL):
        try:
            return json.loads(stored[len(_SEG_SENTINEL):])
        except ValueError:
            return stored[len(_SEG_SENTINEL):]
    return stored

def _unpack_body(stored):
    """Decode a stored body into ``(body, attachments)`` for the forum helpers.

    *body* is a segments list or string; *attachments* is the parallel
    per-message image list, or ``None`` when the request stored no images.
    """
    decoded = _decode_body(stored)
    if isinstance(decoded, dict):
        return decoded.get("segments"), decoded.get("attachments")
    return decoded, None

def _staged_files(stored) -> list:
    """Collect staged (not-yet-sent) upload filenames referenced by a request."""
    _, attachments = _unpack_body(stored)
    out: list = []
    for msg_imgs in (attachments or []):
        for img in (msg_imgs or []):
            if isinstance(img, dict) and img.get("file"):
                out.append(img["file"])
    return out

def _body_view(stored) -> dict:
    """Decode a stored body into display fields: ``segments`` + joined ``body``.

    Includes ``attachments`` (parallel to ``segments``) when the request carried
    per-message images.
    """
    decoded = _decode_body(stored)
    attachments = None
    if isinstance(decoded, dict):
        attachments = decoded.get("attachments")
        decoded = decoded.get("segments")
    if decoded is None:
        view = {"segments": [], "body": ""}
    elif isinstance(decoded, (list, tuple)):
        segs = [("" if s is None else str(s)) for s in decoded]
        view = {"segments": segs, "body": "".join(segs)}
    else:
        view = {"segments": [decoded], "body": decoded}
    if attachments is not None:
        view["attachments"] = attachments
    return view

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

def _log_details(action: str, *, thread_id=None, title=None, body=None,
                 attachments=None) -> dict:
    """Build a rich audit-log detail dict for a content action.

    Captures which parts a combined edit touched and the message/image counts so
    the Logs view shows what actually changed instead of a bare action name.
    """
    details: dict = {"action": action}
    if thread_id:
        details["thread_id"] = str(thread_id)
    if title is not None and str(title) != "":
        details["title"] = title
    if action == "edit":
        changed = []
        if title is not None:
            changed.append("title")
        if body is not None or attachments is not None:
            changed.append("body")
        if changed:
            details["changed"] = changed
    if body is not None:
        segs = list(body) if isinstance(body, (list, tuple)) else [body]
        details["messages"] = len(segs)
    if attachments is not None:
        details["images"] = sum(len(m) for m in attachments
                                if isinstance(m, (list, tuple)))
    return details

def execute_action(action: str, *, thread_id: str | None = None,
                   title: str | None = None, body=None, attachments=None) -> dict:
    """Run a single forum action. Returns the forum helper dict (may hold ``error``).

    *attachments* (when not ``None``) is a per-message image list parallel to the
    body segments; it is forwarded to the create/edit helpers.
    """
    if action == "create":
        return forum.create_post(title, body, attachments)
    if action == "edit_body":
        return forum.edit_body(thread_id, body, attachments)
    if action == "edit_title":
        return forum.edit_title(thread_id, title)
    if action == "edit":  # combined title and/or body
        last: dict = {"id": str(thread_id)}
        if title is not None:
            last = forum.edit_title(thread_id, title)
            if last.get("error"):
                return last
        if body is not None or attachments is not None:
            last = forum.edit_body(thread_id, body, attachments)
            if last.get("error"):
                return last
        return last
    if action == "delete":
        return forum.delete_post(thread_id)
    return {"error": f"Unknown action: {action}"}

def direct_action(action: str, actor: str, *, thread_id: str | None = None,
                  title: str | None = None, body=None, attachments=None) -> dict:
    """Execute a forum action immediately (full-rights tier) and log it."""
    result = execute_action(action, thread_id=thread_id, title=title, body=body,
                            attachments=attachments)
    details = _log_details(action, thread_id=result.get("id") or thread_id,
                           title=title, body=body, attachments=attachments)
    if result.get("error"):
        details["error"] = result["error"]
        db.log_action(actor, "action_failed", thread_id, details)
    else:
        if result.get("warning"):
            details["warning"] = result["warning"]
        db.log_action(actor, "action_executed", result.get("id") or thread_id, details)
        # A deleted post takes its pending requests with it
        if action == "delete" and thread_id:
            _cancel_thread_requests(thread_id, actor)
    return result

def submit_request(action: str, *, thread_id: str | None = None,
                   title: str | None = None, body=None, attachments=None,
                   prev_title: str | None = None, prev_body: str | None = None,
                   requester_id: str, requester_name: str | None = None) -> dict:
    """Enqueue a pending request (Parliament tier) and log the submission."""
    req = db.create_request(
        action, thread_id=thread_id, title=title,
        body=_encode_body(body, attachments),
        prev_title=prev_title, prev_body=prev_body,
        requested_by_id=requester_id, requested_by_name=requester_name,
    )
    db.log_action(
        requester_name or requester_id, "request_submitted", req["id"],
        _log_details(action, thread_id=thread_id,
                     title=title if title is not None else prev_title,
                     body=body, attachments=attachments),
    )
    return _public_request(req)


def get_queue() -> list:
    """Pending requests, with bodies decoded for display."""
    return [_public_request(r) for r in db.get_pending_requests()]

def get_logs(page: int = 1, per_page: int = 50) -> dict:
    return db.get_logs(page=page, per_page=per_page)

def approve_request(request_id: str, actor: str, edited_title=None,
                    edited_body=None, edited_attachments=None) -> dict:
    """Approve a pending request, optionally editing its content first.

    Executes the underlying forum action; marks the request approved on success
    or failed otherwise. When the approver leaves the body untouched
    (``edited_body is None``), the request's stored segments *and* attachments
    are replayed so images survive. Returns ``{"ok": True, ...}`` or
    ``{"error": ...}``.
    """
    req = db.get_request(request_id)
    if not req:
        return {"error": "Request not found"}
    if req["status"] != "pending":
        return {"error": "Request is not pending"}

    action = req["action"]
    title = edited_title if edited_title is not None else req.get("title")
    if edited_body is not None or edited_attachments is not None:
        body = edited_body
        attachments = edited_attachments
    else:
        body, attachments = _unpack_body(req.get("body"))
    thread_id = req.get("thread_id")

    log_title = title if title is not None else req.get("prev_title")
    result = execute_action(action, thread_id=thread_id, title=title, body=body,
                            attachments=attachments)
    if result.get("error"):
        db.resolve_request(request_id, "failed", actor, deny_reason=result["error"])
        fail_details = _log_details(action, thread_id=thread_id, title=log_title,
                                    body=body, attachments=attachments)
        fail_details["error"] = result["error"]
        db.log_action(actor, "request_failed", request_id, fail_details)
        return {"error": result["error"]}

    result_thread = result.get("id") or thread_id
    db.resolve_request(request_id, "approved", actor, result_thread_id=result_thread)
    ok_details = _log_details(action, thread_id=result_thread, title=log_title,
                              body=body, attachments=attachments)
    ok_details["edited"] = edited_title is not None or edited_body is not None
    if result.get("warning"):
        ok_details["warning"] = result["warning"]
    db.log_action(actor, "request_approved", request_id, ok_details)
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
    deny_details = _log_details(
        req["action"], thread_id=req.get("thread_id"),
        title=req.get("title") if req.get("title") else req.get("prev_title"),
    )
    deny_details["reason"] = reason
    db.log_action(actor, "request_denied", request_id, deny_details)
    # The post was never created/edited, so any staged uploads are now orphaned
    for f in _staged_files(req.get("body")):
        forum._delete_staged(f)
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
