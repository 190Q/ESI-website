"""guild_info.forum - direct Discord API helpers for the guild-info forum.

A forum "post" is a thread whose root message id equals the thread id. Because a
single Discord message is capped at 2000 characters, a post body may span
multiple messages: the root message plus zero or more follow-up messages posted
into the thread, in order.

The body is therefore modelled as a list of *segments* (one per message). Call
sites may pass either:
  * a single string  -> auto-split on natural boundaries (paragraph, line, then
    space) into <=2000-char segments, preserving all characters so it
    round-trips; or
  * a list of strings -> caller-chosen split points (e.g. from a future "choose
    where to split" UI). Each provided segment is still auto-split further if it
    exceeds the per-message limit.

These helpers talk to Discord with the bot token and return plain dicts (an
``error`` key signals failure). No Flask here.
"""

import json
import mimetypes
import os
import re
import threading
import time
import requests
from config import (
    DISCORD_API, DISCORD_TOKEN,
    _GUILD_INFO_SERVER_ID, _GUILD_INFO_FORUM_CHANNEL_ID,
)

_TIMEOUT = 15
# Discord limits: forum thread name <= 100 chars, message content <= 2000 chars
_MAX_TITLE = 100
_MAX_BODY = 2000

_STAGE_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "images", "guild-info"
)

_bot_id_lock = threading.Lock()
_bot_id_cache: dict = {"id": None}

# Guild roles/channels change rarely; cache the lookup maps used to resolve
# mention tokens (<@&id>, <#id>) into display names
_meta_lock = threading.Lock()
_roles_cache: dict = {"at": 0.0, "data": None}
_channels_cache: dict = {"at": 0.0, "data": None}
_META_TTL = 300  # seconds

_member_lock = threading.Lock()
_member_cache: dict = {}   # user_id -> {"at": ts, "name": str | None}
_MEMBER_TTL = 600  # seconds


def _headers() -> dict:
    return {"Authorization": f"Bot {DISCORD_TOKEN}", "Content-Type": "application/json"}

def _auth_headers() -> dict:
    """Authorization only - for multipart calls where `requests` sets the type."""
    return {"Authorization": f"Bot {DISCORD_TOKEN}"}

def _err(resp, fallback: str) -> dict:
    """Build an error dict from a failed Discord response."""
    msg = fallback
    try:
        data = resp.json()
        if isinstance(data, dict) and data.get("message"):
            msg = data["message"]
    except Exception:
        pass
    return {"error": msg, "status": getattr(resp, "status_code", None)}

def _bot_user_id() -> str | None:
    """Return the bot's own user id (cached). None on failure."""
    with _bot_id_lock:
        if _bot_id_cache["id"]:
            return _bot_id_cache["id"]
    try:
        r = requests.get(f"{DISCORD_API}/users/@me", headers=_headers(), timeout=_TIMEOUT)
        if not r.ok:
            return None
        bid = r.json().get("id")
    except requests.RequestException:
        return None
    with _bot_id_lock:
        _bot_id_cache["id"] = bid
    return bid

def _get_guild_roles() -> dict:
    """Return ``{role_id: {"name", "color"}}`` for the guild (cached, best-effort).

    ``color`` is a ``#rrggbb`` string or ``None`` when the role has no colour.
    """
    now = time.time()
    with _meta_lock:
        if _roles_cache["data"] is not None and now - _roles_cache["at"] < _META_TTL:
            return _roles_cache["data"]
    out: dict = {}
    try:
        r = requests.get(
            f"{DISCORD_API}/guilds/{_GUILD_INFO_SERVER_ID}/roles",
            headers=_headers(), timeout=_TIMEOUT,
        )
        if r.ok:
            for role in (r.json() or []):
                color = role.get("color") or 0
                out[str(role.get("id"))] = {
                    "name": role.get("name") or "role",
                    "color": ("#%06x" % color) if color else None,
                }
    except requests.RequestException:
        return _roles_cache["data"] or {}
    with _meta_lock:
        _roles_cache["at"] = now
        _roles_cache["data"] = out
    return out

def _get_guild_channels() -> dict:
    """Return ``{channel_id: name}`` for the guild (cached, best-effort)."""
    now = time.time()
    with _meta_lock:
        if _channels_cache["data"] is not None and now - _channels_cache["at"] < _META_TTL:
            return _channels_cache["data"]
    out: dict = {}
    try:
        r = requests.get(
            f"{DISCORD_API}/guilds/{_GUILD_INFO_SERVER_ID}/channels",
            headers=_headers(), timeout=_TIMEOUT,
        )
        if r.ok:
            for ch in (r.json() or []):
                out[str(ch.get("id"))] = ch.get("name") or "channel"
    except requests.RequestException:
        return _channels_cache["data"] or {}
    with _meta_lock:
        _channels_cache["at"] = now
        _channels_cache["data"] = out
    return out

def _get_member_name(user_id: str) -> str | None:
    """Resolve a user id to a display name (server nick > global name > username).

    Tries the guild member endpoint first (so we get the server nickname), then
    falls back to the global user endpoint. Cached briefly; ``None`` if unknown.
    """
    now = time.time()
    with _member_lock:
        hit = _member_cache.get(user_id)
        if hit and now - hit["at"] < _MEMBER_TTL:
            return hit["name"]
    name = None
    try:
        r = requests.get(
            f"{DISCORD_API}/guilds/{_GUILD_INFO_SERVER_ID}/members/{user_id}",
            headers=_headers(), timeout=_TIMEOUT,
        )
        if r.ok:
            m = r.json() or {}
            user = m.get("user") or {}
            name = m.get("nick") or user.get("global_name") or user.get("username")
        else:
            ur = requests.get(
                f"{DISCORD_API}/users/{user_id}",
                headers=_headers(), timeout=_TIMEOUT,
            )
            if ur.ok:
                user = ur.json() or {}
                name = user.get("global_name") or user.get("username")
    except requests.RequestException:
        with _member_lock:
            return (_member_cache.get(user_id) or {}).get("name")
    with _member_lock:
        _member_cache[user_id] = {"at": now, "name": name}
    return name

def _resolve_mentions(body_msgs: list, body_text: str) -> dict:
    """Build id->name maps for the users/roles/channels referenced in a post.

    Only ids actually present in the body text are resolved, so the payload
    stays small: users via the guild member API (seeded by any message mention
    arrays), roles/channels via the cached guild lookups.
    """
    users: dict = {}
    for m in body_msgs:
        for u in (m.get("mentions") or []):
            member = u.get("member") or {}
            nm = member.get("nick") or u.get("global_name") or u.get("username")
            if nm:
                users[str(u.get("id"))] = nm
    # Resolve every <@id> actually in the body
    for uid in set(re.findall(r"<@!?(\d+)>", body_text)):
        if uid not in users:
            users[uid] = _get_member_name(uid) or "unknown-user"
    roles: dict = {}
    channels: dict = {}
    role_ids = set(re.findall(r"<@&(\d+)>", body_text))
    chan_ids = set(re.findall(r"<#(\d+)>", body_text))
    if role_ids:
        all_roles = _get_guild_roles()
        for rid in role_ids:
            roles[rid] = all_roles.get(rid) or {"name": "role", "color": None}
    if chan_ids:
        all_channels = _get_guild_channels()
        for cid in chan_ids:
            channels[cid] = all_channels.get(cid) or "channel"
    return {"mentions": users, "roles": roles, "channels": channels}

# Body splitting logic
def split_body(text: str, max_len: int = _MAX_BODY) -> list:
    """Split *text* into chunks of at most *max_len* characters.

    Breaks on the last paragraph break, then line break, then space inside the
    window so words/lines are not cut mid-token where avoidable. The separator
    is kept at the end of the chunk so ``"".join(split_body(t)) == t`` (no
    characters are lost). A single token longer than *max_len* is hard-cut.
    """
    text = "" if text is None else str(text)
    if len(text) <= max_len:
        return [text]

    chunks: list = []
    remaining = text
    while len(remaining) > max_len:
        window = remaining[:max_len]
        cut = max_len
        for sep in ("\n\n", "\n", " "):
            idx = window.rfind(sep)
            if idx > 0:
                cut = idx + len(sep)  # keep the separator in this chunk
                break
        chunks.append(remaining[:cut])
        remaining = remaining[cut:]
    if remaining:
        chunks.append(remaining)
    return chunks

def normalize_segments(body) -> list:
    """Normalize a body into a list of message segments (each <= ``_MAX_BODY``).

    *body* may be a single string (auto-split) or a list of caller-chosen
    segments (each further auto-split if oversized). Empty segments are dropped;
    at least one (possibly empty) segment is always returned.
    """
    if isinstance(body, (list, tuple)):
        segments: list = []
        for part in body:
            segments.extend(split_body("" if part is None else str(part)))
    else:
        segments = split_body("" if body is None else str(body))
    segments = [s for s in segments if s != ""]
    return segments or [""]

def _body_is_empty(segments: list) -> bool:
    return not any((s or "").strip() for s in segments)

def _atts_empty(seg_atts) -> bool:
    return not any(isinstance(a, (list, tuple)) and len(a) for a in (seg_atts or []))

def _normalize_with_attachments(body, attachments):
    """Like :func:`normalize_segments` but keeps a per-message attachment list
    aligned 1:1 with the returned segments.

    *attachments* is a list parallel to the provided body segments. When a
    provided segment is auto-split, its images ride on the last resulting piece.
    Empty text segments are dropped unless they carry images (Discord allows an
    attachment-only message). Always returns at least one segment.
    """
    parts = list(body) if isinstance(body, (list, tuple)) else [body]
    atts = list(attachments) if isinstance(attachments, (list, tuple)) else []
    out_segs: list = []
    out_atts: list = []
    for i, part in enumerate(parts):
        pieces = split_body("" if part is None else str(part))
        part_att = atts[i] if i < len(atts) else None
        for j, piece in enumerate(pieces):
            out_segs.append(piece)
            out_atts.append(part_att if j == len(pieces) - 1 else None)
    segs: list = []
    seg_atts: list = []
    for s, a in zip(out_segs, out_atts):
        if s != "" or (isinstance(a, (list, tuple)) and len(a)):
            segs.append(s)
            seg_atts.append(a)
    if not segs:
        return [""], [None]
    return segs, seg_atts

def _guess_ct(name: str) -> str:
    return mimetypes.guess_type(name or "")[0] or "application/octet-stream"

def _read_staged(name):
    """Return ``(safe_name, bytes)`` for a staged upload, or ``None`` if missing."""
    raw = "" if name is None else str(name)
    safe = os.path.basename(raw)
    if not safe or safe != raw:
        return None
    path = os.path.join(_STAGE_DIR, safe)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, "rb") as fh:
            return safe, fh.read()
    except OSError:
        return None

def _delete_staged(name) -> None:
    """Best-effort removal of a staged upload once it's been sent to Discord."""
    try:
        safe = os.path.basename("" if name is None else str(name))
        if safe:
            path = os.path.join(_STAGE_DIR, safe)
            if os.path.isfile(path):
                os.unlink(path)
    except OSError:
        pass

def _build_message_files(images):
    """Build the Discord attachment payload for one message.

    *images* is a list whose items are either ``{"id": <discord_id>}`` (keep an
    existing attachment) or ``{"file": <staged>, "name": ...}`` (a freshly
    uploaded image to send). Returns ``(attachments_meta, files, staged_names)``;
    *files* feeds ``requests(..., files=...)`` and *staged_names* are consumed
    staged files to delete on success.
    """
    meta: list = []
    files: list = []
    staged: list = []
    idx = 0
    for img in (images or []):
        if not isinstance(img, dict):
            continue
        if img.get("id"):                       # keep an existing Discord attachment
            meta.append({"id": str(img["id"])})
            continue
        rd = _read_staged(img.get("file"))
        if not rd:
            continue
        fname, data = rd
        display = img.get("name") or fname
        meta.append({"id": idx, "filename": display})
        files.append((f"files[{idx}]", (display, data, _guess_ct(display))))
        staged.append(img.get("file"))
        idx += 1
    return meta, files, staged

def _post_message(thread_id: str, content: str, images=None):
    """POST a follow-up message. Returns ``(response, staged_names)``."""
    meta, files, staged = _build_message_files(images)
    if files or meta:
        payload = {"content": content, "attachments": meta}
        return requests.post(
            f"{DISCORD_API}/channels/{thread_id}/messages",
            data={"payload_json": json.dumps(payload)}, files=files or None,
            headers=_auth_headers(), timeout=_TIMEOUT,
        ), staged
    return requests.post(
        f"{DISCORD_API}/channels/{thread_id}/messages",
        json={"content": content}, headers=_headers(), timeout=_TIMEOUT,
    ), staged

def _edit_message(thread_id: str, message_id: str, content: str, images=None):
    """PATCH a message. When *images* is not ``None`` its attachments become
    authoritative (kept ids stay, others are removed, new files added); when it
    is ``None`` existing attachments are left untouched. Returns
    ``(response, staged_names)``.
    """
    if images is None:
        return requests.patch(
            f"{DISCORD_API}/channels/{thread_id}/messages/{message_id}",
            json={"content": content}, headers=_headers(), timeout=_TIMEOUT,
        ), []
    meta, files, staged = _build_message_files(images)
    payload = {"content": content, "attachments": meta}
    return requests.patch(
        f"{DISCORD_API}/channels/{thread_id}/messages/{message_id}",
        data={"payload_json": json.dumps(payload)}, files=files or None,
        headers=_auth_headers(), timeout=_TIMEOUT,
    ), staged

def _delete_message(thread_id: str, message_id: str):
    return requests.delete(
        f"{DISCORD_API}/channels/{thread_id}/messages/{message_id}",
        headers=_headers(), timeout=_TIMEOUT,
    )

def _list_body_messages(thread_id: str) -> list | None:
    """Return the post's body messages in chronological order (root first).

    Only bot-authored messages count as body parts so user replies are ignored.
    If the bot id can't be resolved, only the root message (id == thread_id) is
    trusted. Returns ``None`` on a hard API failure.
    """
    bot_id = _bot_user_id()
    try:
        collected: list = []
        before = None
        for _ in range(20):  # safety cap (~2000 messages)
            params = {"limit": 100}
            if before:
                params["before"] = before
            r = requests.get(
                f"{DISCORD_API}/channels/{thread_id}/messages",
                params=params, headers=_headers(), timeout=_TIMEOUT,
            )
            if not r.ok:
                return None if not collected else collected
            batch = r.json()
            if not batch:
                break
            collected.extend(batch)
            if len(batch) < 100:
                break
            before = batch[-1]["id"]
    except requests.RequestException:
        return None

    collected.reverse()  # ascending (oldest first); root message is oldest
    if bot_id:
        return [m for m in collected
                if str((m.get("author") or {}).get("id")) == str(bot_id)]
    return [m for m in collected if str(m.get("id")) == str(thread_id)]

def _thread_summary(t: dict) -> dict:
    meta = t.get("thread_metadata") or {}
    # Discord's message_count excludes the thread's initial (root) message
    mc = t.get("message_count")
    return {
        "id": str(t.get("id")),
        "title": t.get("name") or "",
        "archived": bool(meta.get("archived")),
        "locked": bool(meta.get("locked")),
        "message_count": (mc + 1) if isinstance(mc, int) else mc,
        "created_at": meta.get("create_timestamp"),
    }

def list_posts(include_archived: bool = True) -> dict:
    """List bot-owned posts in the guild-info forum.

    Combines the guild's active threads (filtered to the forum channel) with the
    forum's public archived threads, de-duplicates, and keeps only threads owned
    by the bot. Returns ``{"posts": [...]}`` or ``{"error": ...}``.
    """
    if not DISCORD_TOKEN:
        return {"error": "Discord bot token is not configured"}

    forum = _GUILD_INFO_FORUM_CHANNEL_ID
    bot_id = _bot_user_id()
    collected: list = []

    try:
        r = requests.get(
            f"{DISCORD_API}/guilds/{_GUILD_INFO_SERVER_ID}/threads/active",
            headers=_headers(), timeout=_TIMEOUT,
        )
        if r.ok:
            for t in (r.json().get("threads") or []):
                if str(t.get("parent_id")) == str(forum):
                    collected.append(t)
        elif r.status_code not in (403, 404):
            return _err(r, "Failed to list active posts")
    except requests.RequestException as exc:
        return {"error": str(exc)}

    if include_archived:
        try:
            r = requests.get(
                f"{DISCORD_API}/channels/{forum}/threads/archived/public",
                headers=_headers(), timeout=_TIMEOUT,
            )
            if r.ok:
                collected.extend(r.json().get("threads") or [])
        except requests.RequestException:
            pass  # archived listing is best-effort

    seen: dict = {}
    for t in collected:
        tid = str(t.get("id"))
        if tid in seen:
            continue
        # Only surface posts the bot can actually manage (edit root message)
        if bot_id and str(t.get("owner_id")) != str(bot_id):
            continue
        seen[tid] = _thread_summary(t)

    posts = sorted(seen.values(), key=lambda p: (p.get("title") or "").casefold())
    return {"posts": posts}

def _public_attachments(atts) -> list:
    """Shape Discord attachment dicts for the client (id, name, url, type, size)."""
    out = []
    for a in (atts or []):
        if not isinstance(a, dict):
            continue
        out.append({
            "id": str(a.get("id")),
            "name": a.get("filename") or "",
            "url": a.get("url") or "",
            "content_type": a.get("content_type") or "",
            "size": a.get("size"),
        })
    return out

def get_post(thread_id: str) -> dict:
    """Fetch a single post's title + body (as segments and joined text)."""
    if not DISCORD_TOKEN:
        return {"error": "Discord bot token is not configured"}
    try:
        tr = requests.get(
            f"{DISCORD_API}/channels/{thread_id}",
            headers=_headers(), timeout=_TIMEOUT,
        )
        if not tr.ok:
            return _err(tr, "Failed to fetch post")
        t = tr.json()
    except requests.RequestException as exc:
        return {"error": str(exc)}

    body_msgs = _list_body_messages(thread_id) or []
    segments = [m.get("content") or "" for m in body_msgs]
    attachments = [_public_attachments(m.get("attachments") or []) for m in body_msgs]
    message_ids = [str(m.get("id")) for m in body_msgs]
    meta = t.get("thread_metadata") or {}
    body_text = "".join(segments)
    maps = _resolve_mentions(body_msgs, body_text)
    return {
        "id": str(t.get("id")),
        "title": t.get("name") or "",
        "segments": segments,
        "attachments": attachments,
        "body": body_text,
        "message_ids": message_ids,
        "archived": bool(meta.get("archived")),
        # id -> display-name maps so the client can render mentions like Discord
        "mentions": maps["mentions"],
        "roles": maps["roles"],
        "channels": maps["channels"],
    }

def create_post(title: str, body, attachments=None) -> dict:
    """Create a forum post: root message + follow-up messages for extra segments.

    Each segment may carry images (parallel *attachments* list); they are sent
    as native Discord attachments on their message.
    """
    if not DISCORD_TOKEN:
        return {"error": "Discord bot token is not configured"}
    title = (title or "").strip()
    if not title:
        return {"error": "Title is required"}
    segments, seg_atts = _normalize_with_attachments(body, attachments)
    if _body_is_empty(segments) and _atts_empty(seg_atts):
        return {"error": "Body is required"}

    staged_all: list = []
    try:
        root_meta, root_files, root_staged = _build_message_files(seg_atts[0])
        if root_files or root_meta:
            payload = {"name": title[:_MAX_TITLE],
                       "message": {"content": segments[0], "attachments": root_meta}}
            r = requests.post(
                f"{DISCORD_API}/channels/{_GUILD_INFO_FORUM_CHANNEL_ID}/threads",
                data={"payload_json": json.dumps(payload)}, files=root_files or None,
                headers=_auth_headers(), timeout=_TIMEOUT,
            )
        else:
            r = requests.post(
                f"{DISCORD_API}/channels/{_GUILD_INFO_FORUM_CHANNEL_ID}/threads",
                json={"name": title[:_MAX_TITLE], "message": {"content": segments[0]}},
                headers=_headers(), timeout=_TIMEOUT,
            )
        if not r.ok:
            return _err(r, "Failed to create post")
        data = r.json()
    except requests.RequestException as exc:
        return {"error": str(exc)}
    staged_all.extend(root_staged)

    thread_id = str(data.get("id"))
    root_id = str((data.get("message") or {}).get("id") or thread_id)
    message_ids = [root_id]
    failed = 0
    for i in range(1, len(segments)):
        try:
            mr, staged = _post_message(thread_id, segments[i], seg_atts[i])
            if mr.ok:
                message_ids.append(str(mr.json().get("id")))
                staged_all.extend(staged)
            else:
                failed += 1
        except requests.RequestException:
            failed += 1

    if not failed:
        for s in staged_all:
            _delete_staged(s)
    result = {"id": thread_id, "title": data.get("name") or title,
              "message_ids": message_ids, "segment_count": len(segments)}
    if failed:
        result["warning"] = f"Post created but {failed} follow-up message(s) failed"
    return result

def _message_unchanged(existing_msg: dict, seg: str, imgs, manage: bool) -> bool:
    """True when an existing message already matches the desired segment.

    Lets :func:`edit_body` skip messages that didn't change, so editing one
    message of a multi-message post doesn't re-PATCH (and risk rate-limiting)
    every other message.
    """
    if (existing_msg.get("content") or "") != (seg or ""):
        return False
    if not manage:
        # Attachments are left untouched, so matching content is enough
        return True
    have = [str(a.get("id")) for a in (existing_msg.get("attachments") or [])]
    want: list = []
    for img in (imgs or []):
        if not isinstance(img, dict):
            continue
        if img.get("id"):
            want.append(str(img["id"]))
        else:
            return False   # a freshly staged upload always counts as a change
    return want == have

def edit_body(thread_id: str, body, attachments=None) -> dict:
    """Replace a post's body, reconciling existing messages with new segments.

    Edits existing bot messages in place, creates follow-ups for extra segments,
    and deletes leftover follow-up messages (never the root). When *attachments*
    is provided (parallel to the body segments) each message's attachments are
    made authoritative; otherwise existing attachments are left untouched. Only
    works for bot-authored posts.
    """
    if not DISCORD_TOKEN:
        return {"error": "Discord bot token is not configured"}
    manage = attachments is not None
    segments, seg_atts = _normalize_with_attachments(body, attachments)
    if _body_is_empty(segments) and _atts_empty(seg_atts):
        return {"error": "Body is required"}

    existing = _list_body_messages(thread_id)
    if existing is None:
        return {"error": "Failed to load existing post messages"}
    if not existing:
        # No root found (unexpected) - fall back to editing the root by id
        existing = [{"id": str(thread_id)}]

    message_ids: list = []
    staged_all: list = []
    failed = 0
    try:
        for i, seg in enumerate(segments):
            imgs = seg_atts[i] if manage else None
            if i < len(existing):
                em = existing[i]
                mid = str(em["id"])
                # Only edit messages that actually changed
                if _message_unchanged(em, seg, imgs, manage):
                    message_ids.append(mid)
                    continue
                er, staged = _edit_message(thread_id, mid, seg, imgs)
                if i == 0 and not er.ok:
                    return _err(er, "Failed to edit post body")
                if not er.ok:
                    failed += 1
                else:
                    staged_all.extend(staged)
                message_ids.append(mid)
            else:
                mr, staged = _post_message(thread_id, seg, imgs)
                if mr.ok:
                    message_ids.append(str(mr.json().get("id")))
                    staged_all.extend(staged)
                else:
                    failed += 1
        # Delete any leftover follow-up messages (index 0 / root is always kept)
        for extra in existing[len(segments):]:
            try:
                _delete_message(thread_id, str(extra["id"]))
            except requests.RequestException:
                failed += 1
    except requests.RequestException as exc:
        return {"error": str(exc)}

    if not failed:
        for s in staged_all:
            _delete_staged(s)
    result = {"id": str(thread_id), "message_ids": message_ids,
              "segment_count": len(segments)}
    if failed:
        result["warning"] = f"Body updated but {failed} message operation(s) failed"
    return result

def edit_title(thread_id: str, title: str) -> dict:
    """Rename a post (thread name)."""
    if not DISCORD_TOKEN:
        return {"error": "Discord bot token is not configured"}
    title = (title or "").strip()
    if not title:
        return {"error": "Title is required"}
    try:
        r = requests.patch(
            f"{DISCORD_API}/channels/{thread_id}",
            json={"name": title[:_MAX_TITLE]},
            headers=_headers(), timeout=_TIMEOUT,
        )
        if not r.ok:
            return _err(r, "Failed to rename post")
        return {"id": str(thread_id)}
    except requests.RequestException as exc:
        return {"error": str(exc)}

def delete_post(thread_id: str) -> dict:
    """Delete a post (thread)."""
    if not DISCORD_TOKEN:
        return {"error": "Discord bot token is not configured"}
    try:
        r = requests.delete(
            f"{DISCORD_API}/channels/{thread_id}",
            headers=_headers(), timeout=_TIMEOUT,
        )
        if not r.ok and r.status_code != 404:
            return _err(r, "Failed to delete post")
        return {"id": str(thread_id)}
    except requests.RequestException as exc:
        return {"error": str(exc)}
