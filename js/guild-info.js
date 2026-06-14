(function () {
  'use strict';

  var panel = document.getElementById('panel-guild-info');
  if (!panel) return;

  var _PANEL_HEADER =
    '<div class="panel-header">' +
      '<h1 class="panel-title">Guild Info</h1>' +
      '<p class="panel-subtitle">Manage guild information posts</p>' +
    '</div>';

  /* state */
  var _state        = null;   // /state: {access, tier, is_full, can_approve, can_approve_privilege, privilege_pending, privilege_blocked, devMode, ...}
  var _posts        = null;
  var _postsError   = '';
  var _queue        = null;
  var _privReqs     = null;
  var _logs         = null;
  var _logsPage     = 1;
  var _logsHasMore  = false;
  var _activeTab    = 'posts';
  var _shellBuilt   = false;
  var _initDone     = false;
  var _preloadDone  = false;
  var _openView     = null;   // thread id of the currently open View modal (or null)
  var _viewRenderToken = 0;   // bumped on each View render so stale/async renders can bail out
  var _postsAt      = 0;      // ms epoch of the last successful posts fetch
  var _postsSig     = '';     // signature of the last-drawn posts (skip redundant redraws)
  var _queueAt      = 0;      // ms epoch of the last successful queue fetch
  var _queueFilter  = 'all';  // queue pill filter: all | create | edit | delete
  var _queueSort    = 'oldest'; // queue order: oldest (backend default) | newest
  var _logsAt       = 0;      // ms epoch of the last successful logs (page 1) fetch
  var _postCache    = {};     // thread_id -> { id, title, body, segments, archived, at }
  var _TTL          = 120000; // stale-while-revalidate window (2 min): serve cache, refresh quietly after
  var _mdCtx        = {};     // { mentions, roles, channels } id->name maps for the open View body
  var _postsView    = (function () {  // posts layout: 'list' | 'gallery' (remembered across sessions)
    try { return localStorage.getItem('esi_gi_posts_view') === 'gallery' ? 'gallery' : 'list'; }
    catch (e) { return 'list'; }
  })();
  var _galleryFetching = {};  // thread_id -> true while its body is being lazy-loaded for the gallery
  var _galleryIO    = null;   // IntersectionObserver: only fetch previews for cards scrolled into view
  var _galleryQueue = [];     // thread_ids that became visible and are waiting for a fetch slot
  var _galleryActive = 0;     // in-flight gallery preview fetches (throttled by _pumpGallery)

  // Discord limits mirrored from guild_info/forum.py
  var _MAX_TITLE = 100;
  var _MAX_BODY  = 2000;
  var _MAX_IMAGES = 3;                 // images allowed per message (mirror backend)
  var _IMG_EXT  = ['png', 'jpg', 'jpeg', 'gif', 'webp'];

  // Inline icons (sanitised through DOMPurify like the rest of our markup)
  var _ICON_LIST = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none"/></svg>';
  var _ICON_GALLERY = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>';
  var _ICON_MSG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8A8.38 8.38 0 0 1 11.5 3a8.38 8.38 0 0 1 8.5 8.5z"/></svg>';

  /* small helpers */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Rule: never assign user content to innerHTML without sanitising it first
  function setHTML(el, html) {
    if (!el) return;
    el.innerHTML = window.DOMPurify ? window.DOMPurify.sanitize(html) : html;
  }

  function toast(msg, type) { if (window.showToast) window.showToast(msg, type); }

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString();
  }

  function loadingHTML(text) {
    return '<div class="gi-loading"><span class="loading-spinner"></span> ' + esc(text || 'Loading\u2026') + '</div>';
  }
  function emptyHTML(text) {
    return '<div class="gi-empty">' + esc(text || 'Nothing here.') + '</div>';
  }

  /* fetch wrappers (always return {ok,status,data}) */
  function _wrap(r) {
    return r.json().then(
      function (d) { return { ok: r.ok, status: r.status, data: d || {} }; },
      function () { return { ok: r.ok, status: r.status, data: {} }; }
    );
  }
  function apiGet(url) {
    return fetch(url, { credentials: 'same-origin' }).then(_wrap);
  }
  function apiSend(method, url, body) {
    return fetch(url, {
      method: method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(_wrap);
  }
  function apiPost(url, body)  { return apiSend('POST', url, body); }
  function apiPatch(url, body) { return apiSend('PATCH', url, body); }
  function apiDelete(url) {
    return fetch(url, { method: 'DELETE', credentials: 'same-origin' }).then(_wrap);
  }
  // multipart upload (no JSON Content-Type so the browser sets the boundary)
  function apiUpload(url, formData) {
    return fetch(url, { method: 'POST', credentials: 'same-origin', body: formData }).then(_wrap);
  }

  /* body splitting (mirror of guild_info/forum.py split_body)
     Kept faithful so the per-message preview matches what the server will
     produce. A future "choose split points" UI can pass an explicit
     `segments` array instead; the backend already accepts it. */
  function splitBody(text, maxLen) {
    maxLen = maxLen || _MAX_BODY;
    text = text == null ? '' : String(text);
    if (text.length <= maxLen) return [text];
    var chunks = [];
    var remaining = text;
    var seps = ['\n\n', '\n', ' '];
    while (remaining.length > maxLen) {
      var win = remaining.slice(0, maxLen);
      var cut = maxLen;
      for (var i = 0; i < seps.length; i++) {
        var idx = win.lastIndexOf(seps[i]);
        if (idx > 0) { cut = idx + seps[i].length; break; }
      }
      chunks.push(remaining.slice(0, cut));
      remaining = remaining.slice(cut);
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  }

  function _actionLabel(action) {
    return {
      create: 'Create', edit_body: 'Edit body', edit_title: 'Edit title',
      edit: 'Edit', delete: 'Delete',
    }[action] || (action || 'Request');
  }
  // Group the granular actions into the Queue's filter buckets.
  function _queueCat(action) {
    if (action === 'create') return 'create';
    if (action === 'delete') return 'delete';
    if (action === 'privilege' || action === 'privilege_request') return 'privilege';
    return 'edit';   // edit, edit_body, edit_title
  }
  function _logActionLabel(action) {
    return {
      action_executed: 'Executed', action_failed: 'Failed',
      request_submitted: 'Submitted', request_approved: 'Approved',
      request_denied: 'Denied', request_failed: 'Failed',
      request_cancelled: 'Cancelled',
      privilege_requested: 'Access requested', privilege_approved: 'Access granted',
      privilege_denied: 'Access denied',
    }[action] || (action || '');
  }
  function _logActionClass(action) {
    return {
      action_executed: ' gi-log-action--ok', request_approved: ' gi-log-action--ok',
      privilege_approved: ' gi-log-action--ok',
      action_failed: ' gi-log-action--fail', request_failed: ' gi-log-action--fail',
      request_denied: ' gi-log-action--deny', privilege_denied: ' gi-log-action--deny',
      request_cancelled: ' gi-log-action--deny',
    }[action] || '';
  }
  // A combined "edit" with a `changed` list -> "Edit title", "Edit title & body"
  function _logOpLabel(d) {
    if (d.action === 'edit' && Array.isArray(d.changed) && d.changed.length) {
      var names = { title: 'title', body: 'body', images: 'images' };
      var p = d.changed.map(function (k) { return names[k] || k; });
      var joined = p.length > 1 ? (p.slice(0, -1).join(', ') + ' & ' + p[p.length - 1]) : p[0];
      return 'Edit ' + joined;
    }
    return _actionLabel(d.action);
  }
  function _logDetail(e, titleMap) {
    if (!e) return '';
    var d = {};
    if (e.details) {
      try { d = JSON.parse(e.details) || {}; } catch (x) { return String(e.details); }
    }
    var parts = [];
    if (d.action) parts.push(_logOpLabel(d));
    // Which post: an explicit title, else resolved from the posts list by thread id
    var tid = d.thread_id || e.target_id;
    var title = (d.title != null && d.title !== '') ? d.title
              : (titleMap && tid != null ? titleMap[String(tid)] : '');
    if (title) parts.push('\u201c' + title + '\u201d');
    if (d.messages != null && (d.action === 'create' || d.action === 'edit_body' || d.action === 'edit')) {
      parts.push(d.messages + ' message' + (d.messages === 1 ? '' : 's'));
    }
    if (d.images) parts.push(d.images + ' image' + (d.images === 1 ? '' : 's'));
    if (d.edited) parts.push('edited before approval');
    if (!title && d.username) parts.push(d.username);
    if (!title && !d.username && tid != null) parts.push('#' + tid);
    if (d.reason)  parts.push('reason: ' + d.reason);
    if (d.error)   parts.push('error: ' + d.error);
    if (d.warning) parts.push('warning: ' + d.warning);
    return parts.join(' \u00b7 ') || (e.target_id ? ('#' + e.target_id) : '');
  }

  /* nav reveal + badge */
  function _revealNav() {
    window._guildInfoServerAccess = true;
    var nav = document.getElementById('guildInfoNavItem');
    if (nav) nav.style.display = '';
    var manage = document.getElementById('manageSection');
    if (manage) manage.style.display = 'block';
    try {
      var nc = JSON.parse(localStorage.getItem('esi_nav_cache') || '{}');
      nc.guildInfo = true; nc.manage = true;
      localStorage.setItem('esi_nav_cache', JSON.stringify(nc));
    } catch (e) { /* ignore cache errors */ }
  }

  // Privilege requests count toward the badge only for Emperor/OWNER approvers
  function _privBadgeCount() {
    return (_state && _state.can_approve_privilege && Array.isArray(_privReqs)) ? _privReqs.length : 0;
  }

  function _updateNavBadge() {
    var navItem = document.querySelector('[data-panel="guild-info"]');
    if (!navItem) return;
    var count = (_queue || []).length + _privBadgeCount();
    var badge = navItem.querySelector('.nav-upcoming-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'nav-upcoming-badge';
        badge.setAttribute('aria-hidden', 'true');
        navItem.appendChild(badge);
      }
      badge.textContent = count > 9 ? '9+' : String(count);
      navItem.setAttribute('title', count + ' pending request' + (count === 1 ? '' : 's'));
    } else if (badge) {
      badge.remove();
      navItem.removeAttribute('title');
    }
  }

  function _updateQueueTabBadge() {
    var btn = document.querySelector('#giTabs [data-tab="queue"]');
    if (!btn) return;
    var count = (_queue || []).length + _privBadgeCount();
    var badge = btn.querySelector('.gi-tab-badge');
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'gi-tab-badge';
        btn.appendChild(badge);
      }
      badge.textContent = String(count);
    } else if (badge) {
      badge.remove();
    }
  }

  // Access-pending gate for privileged users awaiting approval
  function _applyPrivilegeBlockedState() {
    setHTML(panel,
      _PANEL_HEADER +
      '<div class="auth-gate">' +
        '<div class="auth-gate-card">' +
          '<svg class="auth-gate-icon" viewBox="0 0 24 24" fill="none" ' +
            'stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>' +
          '</svg>' +
          '<div class="auth-gate-title">Access Pending</div>' +
          '<div class="auth-gate-text">' +
            'Your Guild Info privileges are pending approval. You\'ll gain access ' +
            'once an approver has reviewed your request.' +
          '</div>' +
        '</div>' +
      '</div>'
    );
    window._guildInfoPrivBlocked = true;
    var nav = document.getElementById('guildInfoNavItem');
    if (nav) nav.style.display = 'none';
  }

  /* state */
  function fetchState(cb) {
    fetch('/api/admin/guild-info/state', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 403) return null;
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (d) { d.access = true; _state = d; }
        else if (!_state) { _state = { access: false }; }
        if (cb) cb(_state);
      })
      .catch(function () { if (cb) cb(null); });
  }

  // Called eagerly after login
  window.preloadGuildInfoBadge = function () {
    if (_preloadDone) return;
    _preloadDone = true;
    fetchState(function (d) {
      if (!d || !d.access) return;
      if (d.privilege_blocked) return;   // access pending -> keep nav hidden
      _revealNav();
      if (d.can_approve) fetchQueue(function () { _updateNavBadge(); });
    });
  };

  /* modal */
  function showModal(html) {
    _openView = null;
    var m = document.getElementById('giModal');
    var bd = document.getElementById('giModalBackdrop');
    if (!m || !bd) return;
    setHTML(m, html);
    bd.classList.add('open');
    bindClose();
  }
  function setModalContent(html) { setHTML(document.getElementById('giModal'), html); bindClose(); }
  function closeModal() {
    _openView = null;
    _viewRenderToken++;   // stop any in-flight incremental View render
    var bd = document.getElementById('giModalBackdrop');
    if (bd) bd.classList.remove('open');
    var m = document.getElementById('giModal');
    if (m) setHTML(m, '');   // release the (potentially large) rendered post and its images
  }
  function bindClose() {
    var m = document.getElementById('giModal');
    if (!m) return;
    m.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', closeModal);
    });
  }

  /* shell */
  function buildShell() {
    if (_shellBuilt) return;
    _shellBuilt = true;
    var canApprove = !!(_state && _state.can_approve);

    var tabs = '<button class="gi-tab active" data-tab="posts">Posts</button>';
    if (canApprove) tabs += '<button class="gi-tab" data-tab="queue">Queue</button>';
    tabs += '<button class="gi-tab" data-tab="logs">Logs</button>';

    setHTML(panel,
      _PANEL_HEADER +
      '<div class="gi-tabs" id="giTabs">' + tabs + '</div>' +
      '<div id="giContent"></div>' +
      '<div class="gi-modal-backdrop" id="giModalBackdrop"><div class="gi-modal" id="giModal"></div></div>'
    );

    document.getElementById('giTabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.gi-tab');
      if (!btn) return;
      var tab = btn.dataset.tab;
      if (tab === _activeTab) return;
      _activeTab = tab;
      document.querySelectorAll('#giTabs .gi-tab').forEach(function (t) { t.classList.remove('active'); });
      btn.classList.add('active');
      renderTab();
    });

    document.getElementById('giModalBackdrop').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });
  }

  function renderTab() {
    var c = document.getElementById('giContent');
    if (!c) return;
    if (_activeTab === 'queue')      renderQueue(c);
    else if (_activeTab === 'logs')  renderLogs(c);
    else                             renderPosts(c);
  }

  /* Posts tab */
  function _cachePost(p) {
    if (!p || p.id == null) return;
    _postCache[String(p.id)] = {
      id: String(p.id), title: p.title || '', body: p.body || '',
      segments: p.segments || null, attachments: p.attachments || null,
      mentions: p.mentions || null, roles: p.roles || null, channels: p.channels || null,
      archived: !!p.archived, at: Date.now(),
    };
  }

  function fetchPosts(cb) {
    apiGet('/api/admin/guild-info/posts').then(function (res) {
      if (res.ok && res.data && !res.data.error) {
        _posts = res.data.posts || [];
        _postsError = '';
        _postsAt = Date.now();
      } else if (_posts == null) {
        // Preserve any cached posts when a background refresh fails
        _postsError = (res.data && res.data.error) || 'Failed to load posts.';
      }
      if (cb) cb();
    }).catch(function () { if (_posts == null) _postsError = 'Network error.'; if (cb) cb(); });
  }

  function renderPosts(c) {
    if (_posts != null) {                       // serve instantly from cache
      drawPosts(c);
      if (Date.now() - _postsAt > _TTL) {       // refresh quietly when stale
        fetchPosts(function () {
          if (_activeTab === 'posts' && _postsSig !== _postsSignature()) drawPosts(c);
        });
      }
      return;
    }
    setHTML(c, loadingHTML('Loading posts\u2026'));
    fetchPosts(function () {
      if (_activeTab !== 'posts') return;
      drawPosts(c);
    });
  }

  function _postsSignature() {
    return (_posts == null) ? ('E:' + _postsError) : JSON.stringify(_posts);
  }

  function drawPosts(c) {
    _postsSig = _postsSignature();
    if (_galleryIO) { _galleryIO.disconnect(); _galleryIO = null; }   // drop any stale observer
    _galleryQueue = [];
    var head = '<div class="gi-toolbar">' +
      '<div class="gi-view-toggle" id="giViewToggle">' +
        '<button class="gi-view-btn' + (_postsView === 'list' ? ' active' : '') + '" data-view="list" title="List view" aria-label="List view">' + _ICON_LIST + '</button>' +
        '<button class="gi-view-btn' + (_postsView === 'gallery' ? ' active' : '') + '" data-view="gallery" title="Gallery view" aria-label="Gallery view">' + _ICON_GALLERY + '</button>' +
      '</div>' +
      '<button class="gi-btn gi-btn--primary" id="giNewPost">+ New post</button>' +
    '</div>';
    if (_posts == null) {
      setHTML(c, head + emptyHTML(_postsError || 'Could not load posts.'));
    } else if (!_posts.length) {
      setHTML(c, head + emptyHTML('No guild-info posts yet.'));
    } else if (_postsView === 'gallery') {
      setHTML(c, head + _galleryHTML());
      _fillGallery(c);
    } else {
      setHTML(c, head + _listHTML());
    }
    var newBtn = document.getElementById('giNewPost');
    if (newBtn) newBtn.addEventListener('click', function () { openPostEditor(null); });
    var toggle = document.getElementById('giViewToggle');
    if (toggle) toggle.addEventListener('click', function (e) {
      var b = e.target.closest('.gi-view-btn');
      if (!b) return;
      var v = b.getAttribute('data-view');
      if (v === _postsView) return;
      _postsView = v;
      try { localStorage.setItem('esi_gi_posts_view', v); } catch (x) { /* ignore */ }
      drawPosts(c);   // re-render from cached data only; a view switch never refetches
    });
    _wirePostActions(c);
  }

  // Current row-based list layout
  function _listHTML() {
    var rows = _posts.map(function (p) {
      var badges = '';
      if (p.archived) badges += '<span class="gi-pill gi-pill--muted">Archived</span>';
      if (p.locked)   badges += '<span class="gi-pill gi-pill--muted">Locked</span>';
      if (p.pending_request) badges += '<span class="gi-pill gi-pill--pending">Change pending</span>';
      var mc = (p.message_count != null)
        ? '<span class="gi-meta-dim">' + esc(p.message_count) + ' message' + (p.message_count === 1 ? '' : 's') + '</span>'
        : '';
      // A post with a pending request is locked for editing until it's resolved/deleted
      var editBtn = p.pending_request
        ? '<button class="gi-btn gi-btn--sm" data-act="edit" data-id="' + esc(p.id) + '" disabled title="A change to this post is pending approval">Edit</button>'
        : '<button class="gi-btn gi-btn--sm" data-act="edit" data-id="' + esc(p.id) + '">Edit</button>';
      return '<div class="gi-card">' +
          '<div class="gi-card-main">' +
            '<div class="gi-card-title">' + esc(p.title || '(untitled)') + '</div>' +
            '<div class="gi-card-meta">' + badges + mc + '</div>' +
          '</div>' +
          '<div class="gi-card-actions">' +
            '<button class="gi-btn gi-btn--sm" data-act="view" data-id="' + esc(p.id) + '">View</button>' +
            editBtn +
            '<button class="gi-btn gi-btn--sm gi-btn--danger" data-act="delete" data-id="' + esc(p.id) + '">Delete</button>' +
          '</div>' +
        '</div>';
    }).join('');
    return '<div class="gi-list">' + rows + '</div>';
  }

  // Discord forum-style gallery: title + body preview + message count
  function _galleryHTML() {
    var cards = _posts.map(function (p) {
      var editBtn = p.pending_request
        ? '<button class="gi-btn gi-btn--sm" data-act="edit" data-id="' + esc(p.id) + '" disabled title="A change to this post is pending approval">Edit</button>'
        : '<button class="gi-btn gi-btn--sm" data-act="edit" data-id="' + esc(p.id) + '">Edit</button>';
      var count = (p.message_count != null) ? String(p.message_count) : '0';
      return '<div class="gi-gcard" data-id="' + esc(p.id) + '" role="button" tabindex="0">' +
          '<div class="gi-gcard-title">' + esc(p.title || '(untitled)') + '</div>' +
          '<div class="gi-gcard-body" data-preview></div>' +
          '<div class="gi-gcard-foot">' +
            '<span class="gi-gcard-count" title="' + esc(count) + ' message' + (count === '1' ? '' : 's') + '">' + _ICON_MSG + esc(count) + '</span>' +
            '<span class="gi-gcard-actions">' +
              editBtn +
              '<button class="gi-btn gi-btn--sm gi-btn--danger" data-act="delete" data-id="' + esc(p.id) + '">Delete</button>' +
            '</span>' +
          '</div>' +
        '</div>';
    }).join('');
    return '<div class="gi-gallery" id="giGallery">' + cards + '</div>';
  }

  // Render cached previews now; the rest get a loader + fetch only once scrolled into view
  function _fillGallery(c) {
    var ready = (_posts || []).filter(function (p) { return p && p.id != null && _postCache[String(p.id)]; });
    var i = 0;
    function chunk() {
      if (_activeTab !== 'posts' || _postsView !== 'gallery') return;
      var end = Math.min(i + 4, ready.length);
      for (; i < end; i++) {
        var card = c.querySelector('.gi-gcard[data-id="' + _cssId(ready[i].id) + '"]');
        if (card) _renderGalleryPreview(card, _postCache[String(ready[i].id)]);
      }
      if (i < ready.length) requestAnimationFrame(chunk);
    }
    chunk();
    _observeGallery(c);
  }

  // Skeleton loader shown in a card until its body preview arrives
  function _setGalleryLoading(card) {
    var prev = card.querySelector('[data-preview]');
    if (!prev) return;
    prev.classList.remove('gi-gcard-body--empty', 'gi-gcard-body--faded');
    prev.classList.add('gi-gcard-body--loading');
    while (prev.firstChild) prev.removeChild(prev.firstChild);
    for (var i = 0; i < 3; i++) {
      var ln = document.createElement('span');
      ln.className = 'gi-skel-line';
      prev.appendChild(ln);
    }
  }

  function _clearGalleryLoading(card) {
    var prev = card.querySelector('[data-preview]');
    if (!prev) return;
    prev.classList.remove('gi-gcard-body--loading');
    while (prev.firstChild) prev.removeChild(prev.firstChild);
  }

  function _renderGalleryPreview(card, cached) {
    var prev = card.querySelector('[data-preview]');
    if (!prev) return;
    var seg = (cached.segments && cached.segments.length) ? cached.segments[0] : (cached.body || '');
    prev.classList.remove('gi-gcard-body--empty', 'gi-gcard-body--loading');
    var text = _previewText(seg, cached);
    if (!text) {
      prev.textContent = '';
      prev.classList.add('gi-gcard-body--empty');
      return;
    }
    // Keep gallery previews plain text so cards stay cheap to render even with heavy markdown posts
    prev.textContent = text;
  }

  function _previewText(seg, cached) {
    var s = String(seg == null ? '' : seg).slice(0, 800);  // hard cap before any processing
    var ctx = cached || {};
    if (!s.trim()) return '';
    s = s
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/<(a?):(\w{2,32}):(\d+)>/g, function (_m, _anim, name) { return ':' + name + ':'; })
      .replace(/<#(\d+)>/g, function (_m, id) { return '#' + (((ctx.channels || {})[id]) || 'channel'); })
      .replace(/<@&(\d+)>/g, function (_m, id) {
        var r = (ctx.roles || {})[id];
        return '@' + ((r && r.name) || 'role');
      })
      .replace(/<@!?(\d+)>/g, function (_m, id) { return '@' + (((ctx.mentions || {})[id]) || 'user'); })
      .replace(/<\/([\w -]{1,64}):\d+>/g, function (_m, name) { return '/' + name; })
      .replace(/<t:-?\d+(?::[tTdDfFR])?>/g, '')
      .replace(/[*_~`>#|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (s.length <= 240) return s;
    var cut = s.slice(0, 240);
    var sp = cut.lastIndexOf(' ');
    return (sp > 140 ? cut.slice(0, sp) : cut) + '…';
  }

  // Watch cards and only fetch a preview once its card scrolls near the viewport
  function _observeGallery(c) {
    if (!Array.isArray(_posts)) return;
    var cards = [];
    _posts.forEach(function (p) {
      if (!p || p.id == null || _postCache[String(p.id)]) return;
      var card = c.querySelector('.gi-gcard[data-id="' + _cssId(p.id) + '"]');
      if (card) cards.push(card);
    });
    if (!cards.length) return;
    if (!('IntersectionObserver' in window)) {        // old browsers: just queue them all
      cards.forEach(function (card) { _enqueueGalleryFetch(c, card.getAttribute('data-id')); });
      return;
    }
    var root = (c.closest && c.closest('.gi-modal')) || null;   // the modal is the scroll container
    _galleryIO = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        observer.unobserve(en.target);                // each card only needs to load once
        _enqueueGalleryFetch(c, en.target.getAttribute('data-id'));
      });
    }, { root: root, rootMargin: '200px 0px' });
    cards.forEach(function (card) { _galleryIO.observe(card); });
  }

  function _enqueueGalleryFetch(c, id) {
    if (id == null) return;
    id = String(id);
    if (_postCache[id] || _galleryFetching[id] || _galleryQueue.indexOf(id) !== -1) return;
    var card = c.querySelector('.gi-gcard[data-id="' + _cssId(id) + '"]');   // loader only once visible
    if (card) _setGalleryLoading(card);
    _galleryQueue.push(id);
    _pumpGallery(c);
  }

  // Drain the visible-card queue a few at a time (never all at once)
  function _pumpGallery(c) {
    if (_activeTab !== 'posts' || _postsView !== 'gallery') return;   // bail if the view changed
    var MAX = 2;
    while (_galleryActive < MAX && _galleryQueue.length) {
      (function (id) {
        if (_postCache[id] || _galleryFetching[id]) return;
        _galleryFetching[id] = true;
        _galleryActive++;
        apiGet('/api/admin/guild-info/posts/' + encodeURIComponent(id)).then(function (res) {
          if (res.ok && res.data && !res.data.error) _cachePost(res.data);
        }).catch(function () { /* leave it; a later open will retry */ }).then(function () {
          delete _galleryFetching[id];
          _galleryActive--;
          if (_activeTab === 'posts' && _postsView === 'gallery') {
            var card = c.querySelector('.gi-gcard[data-id="' + _cssId(id) + '"]');
            if (card) {
              if (_postCache[id]) _renderGalleryPreview(card, _postCache[id]);
              else _clearGalleryLoading(card);        // fetch failed -> stop the skeleton
            }
          }
          _pumpGallery(c);
        });
      })(_galleryQueue.shift());
    }
  }

  function _cssId(id) { return String(id).replace(/(["\\])/g, '\\$1'); }

  // Shared wiring for both layouts: action buttons + (gallery) click-to-open
  function _wirePostActions(c) {
    c.querySelectorAll('[data-act]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();   // keep a gallery card click from also firing
        var id = btn.getAttribute('data-id');
        var act = btn.getAttribute('data-act');
        var post = (_posts || []).filter(function (p) { return String(p.id) === String(id); })[0] || { id: id };
        if (act === 'view') openPostView(id);
        else if (act === 'edit') openPostEditor(post);
        else if (act === 'delete') confirmDeletePost(post);
      });
    });
    c.querySelectorAll('.gi-gcard').forEach(function (card) {
      function open() { openPostView(card.getAttribute('data-id')); }
      card.addEventListener('click', open);
      card.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); open(); }
      });
    });
  }

  /* Discord-flavoured markdown -> sanitised HTML (read-only View) */
  function _mdEsc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _mdUrl(url) {
    try {
      var u = new URL(url, window.location.origin);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? url : null;
    } catch (e) { return null; }
  }
  function _mdRel(d) {             // relative time for <t:unix:R>
    var s = Math.round((d.getTime() - Date.now()) / 1000);
    var abs = Math.abs(s);
    var units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
    for (var i = 0; i < units.length; i++) {
      if (abs >= units[i][1] || units[i][0] === 'second') {
        var v = Math.round(s / units[i][1]);
        if (window.Intl && Intl.RelativeTimeFormat) {
          return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(v, units[i][0]);
        }
        return v < 0 ? (-v + ' ' + units[i][0] + ' ago') : ('in ' + v + ' ' + units[i][0]);
      }
    }
    return '';
  }
  function _mdTime(unix, style) {  // Discord <t:unix:style> -> localized string
    var d = new Date(unix * 1000);
    if (isNaN(d.getTime())) return '';
    switch (style) {
      case 't': return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      case 'T': return d.toLocaleTimeString();
      case 'd': return d.toLocaleDateString();
      case 'D': return d.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' });
      case 'F': return d.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) +
                       ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      case 'R': return _mdRel(d);
      default:  return d.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' }) +
                       ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
  function _mdStyle(s) {           // bold/italic/underline/strike/spoiler (order matters)
    return String(s)
      .replace(/\|\|([\s\S]+?)\|\|/g, '<span class="gi-spoiler" role="button" tabindex="0">$1</span>')
      .replace(/\*\*\*([\s\S]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
      .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__([\s\S]+?)__/g, '<u>$1</u>')
      .replace(/~~([\s\S]+?)~~/g, '<s>$1</s>')
      .replace(/\*([\s\S]+?)\*/g, '<em>$1</em>')
      .replace(/(^|[^\w*])_([^_\n]+?)_(?![\w])/g, '$1<em>$2</em>');
  }
  function _mdInline(text) {
    var store = [];
    function stash(html) { store.push(html); return '\x00' + (store.length - 1) + '\x00'; }
    var escs = [];
    text = String(text == null ? '' : text).replace(/\\([\\`*_~|>#\[\]()\-.!])/g, function (_m, ch) {
      escs.push(ch); return '\x02' + (escs.length - 1) + '\x02';
    });
    // inline code (double then single backtick) - kept literal
    text = text.replace(/``([^`]+?)``|`([^`]+?)`/g, function (_m, d, s) {
      return stash('<code class="gi-md-code">' + _mdEsc(d != null ? d : s) + '</code>');
    });
    // Discord mentions / custom emoji / timestamps -> stashed pills (pre-escape)
    var ctx = _mdCtx || {};
    text = text
      .replace(/<(a?):(\w{2,32}):(\d+)>/g, function (_m, anim, name, id) {
        var url = 'https://cdn.discordapp.com/emojis/' + id + (anim ? '.gif' : '.png') + '?size=44';
        return stash('<img class="gi-emoji" loading="lazy" decoding="async" src="' + _mdEsc(url) + '" alt=":' + _mdEsc(name) + ':" title=":' + _mdEsc(name) + ':">');
      })
      .replace(/<#(\d+)>/g, function (_m, id) {
        var nm = (ctx.channels && ctx.channels[id]) || 'channel';
        return stash('<span class="gi-mention gi-mention--channel">#' + _mdEsc(nm) + '</span>');
      })
      .replace(/<@&(\d+)>/g, function (_m, id) {
        var r = ctx.roles && ctx.roles[id];
        var nm = (r && r.name) || 'role';
        var st = (r && r.color)
          ? ' style="color:' + r.color + ';background-color:' + r.color + '22;border-color:' + r.color + '55"'
          : '';
        return stash('<span class="gi-mention gi-mention--role"' + st + '>@' + _mdEsc(nm) + '</span>');
      })
      .replace(/<@!?(\d+)>/g, function (_m, id) {
        var nm = (ctx.mentions && ctx.mentions[id]) || 'user';
        return stash('<span class="gi-mention gi-mention--user">@' + _mdEsc(nm) + '</span>');
      })
      .replace(/<\/([\w -]{1,64}):(\d+)>/g, function (_m, name) {
        return stash('<span class="gi-mention gi-mention--cmd">/' + _mdEsc(name) + '</span>');
      })
      .replace(/<t:(-?\d+)(?::([tTdDfFR]))?>/g, function (_m, ts, sty) {
        return stash('<span class="gi-mention gi-mention--time" title="' + _mdEsc(_mdTime(+ts, 'F')) + '">' + _mdEsc(_mdTime(+ts, sty || 'f')) + '</span>');
      })
      .replace(/(^|[^\w@])@(everyone|here)\b/g, function (_m, pre, w) {
        return pre + stash('<span class="gi-mention gi-mention--everyone">@' + w + '</span>');
      });
    text = _mdEsc(text);
    // masked links [label](url)
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, function (m, label, url) {
      var safe = _mdUrl(url);
      return safe ? stash('<a href="' + _mdEsc(safe) + '" target="_blank" rel="noopener noreferrer">' + _mdStyle(label) + '</a>') : m;
    });
    // bare URLs
    text = text.replace(/(^|[\s(])(https?:\/\/[^\s<>()]+)/g, function (m, pre, url) {
      var safe = _mdUrl(url);
      return safe ? pre + stash('<a href="' + _mdEsc(safe) + '" target="_blank" rel="noopener noreferrer">' + _mdEsc(url) + '</a>') : m;
    });
    // inline styling (also applied to masked-link labels above)
    text = _mdStyle(text);
    // restore code/link placeholders, then escaped chars
    text = text.replace(/\x00(\d+)\x00/g, function (_m, i) { return store[+i]; });
    text = text.replace(/\x02(\d+)\x02/g, function (_m, i) { return _mdEsc(escs[+i]); });
    return text;
  }
  function _mdList(lines) {
    var items = [];
    lines.forEach(function (l) {
      var m = l.match(/^(\s*)(?:[-*]|\d+\.)\s+(.*)$/);
      if (m) items.push({ indent: m[1].replace(/\t/g, '  ').length, ordered: /^\s*\d+\./.test(l), content: m[2] });
      else if (items.length) items[items.length - 1].content += '\n' + l.trim();
    });
    var pos = 0;
    function build() {
      var base = items[pos].indent;
      var ordered = items[pos].ordered;
      var html = ordered ? '<ol class="gi-md-list">' : '<ul class="gi-md-list">';
      while (pos < items.length && items[pos].indent >= base) {
        var it = items[pos++];
        var inner = _mdInline(it.content).replace(/\n/g, '<br>');
        var child = (pos < items.length && items[pos].indent > base) ? build() : '';
        html += '<li>' + inner + child + '</li>';
      }
      return html + (ordered ? '</ol>' : '</ul>');
    }
    return items.length ? build() : '';
  }
  function _mdToHtml(src) {
    var lines = String(src == null ? '' : src).replace(/\r\n?/g, '\n').split('\n');
    var out = [], para = [], i = 0;
    function flush() {
      if (!para.length) return;
      out.push('<p>' + _mdInline(para.join('\n')).replace(/\n/g, '<br>') + '</p>');
      para = [];
    }
    while (i < lines.length) {
      var line = lines[i];
      var fence = line.match(/^```(\w*)\s*$/);
      if (fence) {
        flush();
        var buf = []; i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++;
        out.push('<pre class="gi-md-pre"><code>' + _mdEsc(buf.join('\n')) + '</code></pre>');
        continue;
      }
      if (/^>>> /.test(line)) {
        flush();
        var rest = [line.replace(/^>>> /, '')]; i++;
        while (i < lines.length) { rest.push(lines[i]); i++; }
        out.push('<blockquote class="gi-md-quote">' + _mdInline(rest.join('\n')).replace(/\n/g, '<br>') + '</blockquote>');
        continue;
      }
      if (/^> ?/.test(line)) {
        flush();
        var q = [];
        while (i < lines.length && /^> ?/.test(lines[i])) { q.push(lines[i].replace(/^> ?/, '')); i++; }
        out.push('<blockquote class="gi-md-quote">' + _mdInline(q.join('\n')).replace(/\n/g, '<br>') + '</blockquote>');
        continue;
      }
      var h = line.match(/^(#{1,3})\s+(.*\S)\s*$/);
      if (h) {
        flush();
        var lvl = h[1].length;
        out.push('<h' + lvl + ' class="gi-md-h gi-md-h' + lvl + '">' + _mdInline(h[2]) + '</h' + lvl + '>');
        continue;
      }
      if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
        flush();
        var ll = [];
        while (i < lines.length && (/^\s*(?:[-*]|\d+\.)\s+/.test(lines[i]) || (ll.length && /^\s+\S/.test(lines[i])))) { ll.push(lines[i]); i++; }
        out.push(_mdList(ll));
        continue;
      }
      if (/^\s*$/.test(line)) { flush(); i++; continue; }
      para.push(line); i++;
    }
    flush();
    return out.join('');
  }
  function _renderBody(el, text, ctx) {
    if (!el) return;
    _mdCtx = ctx || {};   // mention/role/channel maps consumed by _mdInline
    try {
      if (window.DOMPurify) {
        el.innerHTML = window.DOMPurify.sanitize(_mdToHtml(text), { ADD_ATTR: ['target', 'rel', 'style', 'loading', 'decoding'] });
      } else {
        el.textContent = text == null ? '' : String(text);  // no sanitiser -> safe plain text
      }
      el.querySelectorAll('.gi-spoiler').forEach(function (sp) {
        function reveal() { sp.classList.add('gi-spoiler--shown'); }
        sp.addEventListener('click', reveal);
        sp.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); }
        });
      });
    } catch (e) {
      // A malformed body must never break the whole posts view
      el.textContent = text == null ? '' : String(text);
    }
  }

  // Build a DOM image strip from attachment dicts ({url,name})
  function _buildImageStrip(imgs, cls) {
    if (!imgs || !imgs.length) return null;
    var wrap = document.createElement('div');
    wrap.className = cls || 'gi-view-imgs';
    imgs.forEach(function (im) {
      var src = _mdUrl(im && im.url);
      if (!src) return;
      var a = document.createElement('a');
      a.href = src; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.className = 'gi-view-img';
      var img = document.createElement('img');
      img.src = src;                       // property assignment, never innerHTML
      img.alt = (im && im.name) || '';
      img.loading = 'lazy';
      img.decoding = 'async';
      a.appendChild(img);
      wrap.appendChild(a);
    });
    return wrap.children.length ? wrap : null;
  }

  function _renderPostView(p) {
    // Fall back to splitting the raw body so we never render one giant string
    var segs = (p.segments && p.segments.length) ? p.segments : splitBody(p.body || '', _MAX_BODY);
    var atts = p.attachments || [];
    var segCount = segs.length || 1;
    showModal(
      '<div class="gi-modal-title" id="giViewTitle"></div>' +
      '<div class="gi-modal-sub">' + segCount + ' message' + (segCount === 1 ? '' : 's') +
        (p.archived ? ' \u00b7 archived' : '') + '</div>' +
      '<div class="gi-view-msgs" id="giViewBody"></div>' +
      '<div class="gi-modal-actions"><button class="gi-btn" data-close>Close</button></div>'
    );
    _openView = String(p.id == null ? '' : p.id);
    // title stays plain text; body is rendered as sanitised Discord-style markdown
    var tEl = document.getElementById('giViewTitle'); if (tEl) tEl.textContent = p.title || '(untitled)';
    var host = document.getElementById('giViewBody');
    var ctx = { mentions: p.mentions, roles: p.roles, channels: p.channels };
    // Render a couple of messages per frame so a long post never blocks the main thread
    var token = ++_viewRenderToken;
    var i = 0;
    function renderNext() {
      if (token !== _viewRenderToken || !host || !document.body.contains(host)) return;
      var end = Math.min(i + 2, segs.length);
      for (; i < end; i++) {
        var seg = segs[i];
        var block = document.createElement('div');
        block.className = 'gi-view-msg';
        if (seg != null && String(seg).trim() !== '') {
          var bodyEl = document.createElement('div');
          bodyEl.className = 'gi-body-preview gi-md';
          _renderBody(bodyEl, seg, ctx);
          block.appendChild(bodyEl);
        }
        var strip = _buildImageStrip(atts[i]);
        if (strip) block.appendChild(strip);
        if (block.children.length) host.appendChild(block);
      }
      if (i < segs.length) requestAnimationFrame(renderNext);
    }
    renderNext();
  }

  function openPostView(threadId) {
    var id = String(threadId);
    var cached = _postCache[id];
    if (cached) {                                   // already loaded (e.g. by the gallery): just display it, no refetch
      _renderPostView(cached);                      // (_renderPostView sets _openView)
      return;
    }
    showModal(loadingHTML('Loading\u2026'));
    _openView = id;                                 // set AFTER showModal (which clears _openView)
    apiGet('/api/admin/guild-info/posts/' + encodeURIComponent(id)).then(function (res) {
      if (_openView !== id) return;                 // user already opened/closed something else
      if (!(res.ok && res.data && !res.data.error)) {
        setModalContent(emptyHTML((res.data && res.data.error) || 'Failed to load post.') +
          '<div class="gi-modal-actions"><button class="gi-btn" data-close>Close</button></div>');
        return;
      }
      _cachePost(res.data);
      _renderPostView(res.data);
    }).catch(function () {
      if (_openView !== id) return;
      setModalContent(emptyHTML('Network error.') +
        '<div class="gi-modal-actions"><button class="gi-btn" data-close>Close</button></div>');
    });
  }

  function openPostEditor(post) {
    var isEdit = !!(post && post.id);
    var isParliament = _state && _state.tier === 'parliament';
    var submitLabel = isParliament ? 'Submit for approval' : (isEdit ? 'Save changes' : 'Create post');
    var cached = isEdit ? _postCache[String(post.id)] : null;   // reuse an already-loaded body
    var needFetch = isEdit && !cached;
    var origTitle = '', origSegments = [], origAttachments = [];   // baseline for edit change-detection
    showModal(
      '<div class="gi-modal-title">' + (isEdit ? 'Edit post' : 'New post') + '</div>' +
      (isParliament ? '<div class="gi-modal-sub">This will be queued for approval.</div>' : '') +
      (needFetch ? loadingHTML('Loading current content\u2026') : '') +
      '<div class="gi-form"' + (needFetch ? ' style="display:none"' : '') + ' id="giForm">' +
        '<label class="gi-label">Title</label>' +
        '<input type="text" class="gi-input" id="giTitle" maxlength="' + _MAX_TITLE + '" placeholder="Post title" />' +
        '<label class="gi-label">Messages <span class="gi-label-sub">\u2014 each box is one Discord message</span></label>' +
        '<div class="gi-msgs" id="giMsgs"></div>' +
        '<div class="gi-msgs-bar">' +
          '<button type="button" class="gi-btn gi-btn--sm" id="giAddMsg">+ Add message</button>' +
          '<span class="gi-split-hint" id="giSplitHint"></span>' +
        '</div>' +
        '<div class="gi-modal-actions">' +
          '<button class="gi-btn" data-close>Cancel</button>' +
          '<button class="gi-btn gi-btn--primary" id="giSubmit">' + esc(submitLabel) + '</button>' +
        '</div>' +
      '</div>'
    );
    var titleEl = document.getElementById('giTitle');
    var msgsEl  = document.getElementById('giMsgs');
    var hintEl  = document.getElementById('giSplitHint');
    var addBtn  = document.getElementById('giAddMsg');
    var submitBtn = document.getElementById('giSubmit');

    // Stable identity for one image: existing attachments keep by Discord id
    function _imgKey(im) {
      if (!im) return '';
      if (im.id != null) return 'id:' + im.id;
      if (im.file != null) return 'file:' + im.file;
      return 'url:' + (im.url || '');
    }
    function _imgSig(images) { return (images || []).map(_imgKey); }

    function readRows() {
      return Array.prototype.slice.call(msgsEl.querySelectorAll('.gi-msg')).map(function (row) {
        return { text: row.querySelector('.gi-msg-body').value, images: (row._giImages || []).slice() };
      });
    }
    // The messages that will actually be posted: those with text OR an image
    function cleanRows() {
      return readRows().filter(function (r) { return r.text.trim() !== '' || r.images.length; });
    }

    // Redraw one row's thumbnail strip from row._giImages (DOM only, no innerHTML)
    function renderRowImages(row) {
      var strip = row.querySelector('.gi-msg-imgs');
      if (!strip) return;
      var imgs = row._giImages || [];
      strip.textContent = '';
      imgs.forEach(function (im, idx) {
        var cell = document.createElement('div');
        cell.className = 'gi-msg-img';
        var src = _mdUrl(im && im.url);
        if (src) {
          var image = document.createElement('img');
          image.src = src; image.alt = (im && im.name) || '';   // .src property, never innerHTML
          cell.appendChild(image);
        } else {
          var ph = document.createElement('span');
          ph.className = 'gi-msg-img-ph';
          ph.textContent = (im && im.name) || 'image';
          cell.appendChild(ph);
        }
        var del = document.createElement('button');
        del.type = 'button'; del.className = 'gi-msg-img-del';
        del.title = 'Remove image'; del.setAttribute('aria-label', 'Remove image');
        del.textContent = '\u00d7';
        del.addEventListener('click', function () {
          (row._giImages || []).splice(idx, 1);
          renderRowImages(row); onChange();
        });
        cell.appendChild(del);
        strip.appendChild(cell);
      });
      var addb = row.querySelector('.gi-msg-addimg');
      if (addb) addb.disabled = imgs.length >= _MAX_IMAGES;
      var hint = row.querySelector('.gi-msg-imghint');
      if (hint) hint.textContent = imgs.length ? (imgs.length + ' / ' + _MAX_IMAGES) : '';
    }

    // Validate + upload selected files for one row, then track them as images
    function uploadRowFiles(row, fileList) {
      var files = Array.prototype.slice.call(fileList || []);
      if (!files.length) return;
      row._giImages = row._giImages || [];
      files.forEach(function (file) {
        if ((row._giImages || []).length >= _MAX_IMAGES) {
          toast('\u26a0 Up to ' + _MAX_IMAGES + ' images per message.', 'warn'); return;
        }
        var ext = (file.name.split('.').pop() || '').toLowerCase();
        if (_IMG_EXT.indexOf(ext) === -1) { toast('\u26a0 ' + file.name + ': use PNG, JPG, GIF or WebP.', 'warn'); return; }
        if (file.size > 2 * 1024 * 1024) { toast('\u26a0 ' + file.name + ' is larger than 2 MB.', 'warn'); return; }
        var fd = new FormData(); fd.append('file', file);
        apiUpload('/api/admin/guild-info/posts/upload-image', fd).then(function (res) {
          if (res.ok && res.data && res.data.ok && res.data.file) {
            if ((row._giImages || []).length >= _MAX_IMAGES) return;
            row._giImages.push({ file: res.data.file, name: res.data.name || file.name, url: res.data.url });
            renderRowImages(row); onChange();
          } else {
            toast('\u26a0 ' + ((res.data && res.data.error) || ('Upload failed: ' + file.name)), 'warn');
          }
        }).catch(function () { toast('\u26a0 Upload failed: ' + file.name, 'warn'); });
      });
    }

    // Append one message box (pre-filled with text + images) and wire its events
    function addMessage(text, images, focusIt) {
      var row = document.createElement('div');
      row.className = 'gi-msg';
      row.innerHTML =                       // static skeleton only; no user content
        '<div class="gi-msg-head">' +
          '<span class="gi-msg-n"></span>' +
          '<button type="button" class="gi-msg-del" title="Remove message" aria-label="Remove message">\u00d7</button>' +
        '</div>' +
        '<textarea class="gi-textarea gi-msg-body" rows="5" placeholder="Message content\u2026"></textarea>' +
        '<div class="gi-msg-imgs"></div>' +
        '<div class="gi-msg-imgbar">' +
          '<button type="button" class="gi-btn gi-btn--sm gi-msg-addimg">+ Add image</button>' +
          '<span class="gi-msg-imghint"></span>' +
        '</div>' +
        '<input type="file" class="gi-msg-file" accept="image/png,image/jpeg,image/gif,image/webp" multiple style="display:none" />' +
        '<div class="gi-msg-count"></div>';
      msgsEl.appendChild(row);
      var ta = row.querySelector('.gi-msg-body');
      ta.value = text == null ? '' : String(text);          // .value, never innerHTML
      ta.addEventListener('input', onChange);
      row._giImages = (images || []).slice();
      renderRowImages(row);
      var fileInput = row.querySelector('.gi-msg-file');
      row.querySelector('.gi-msg-addimg').addEventListener('click', function () { fileInput.click(); });
      fileInput.addEventListener('change', function () { uploadRowFiles(row, fileInput.files); fileInput.value = ''; });
      row.querySelector('.gi-msg-del').addEventListener('click', function () {
        if (msgsEl.children.length <= 1) { ta.value = ''; row._giImages = []; renderRowImages(row); }   // keep at least one box
        else msgsEl.removeChild(row);
        onChange();
      });
      if (focusIt) ta.focus();
    }

    // Renumber boxes, refresh per-message + total counters, then gate submit
    function onChange() {
      var rows = Array.prototype.slice.call(msgsEl.querySelectorAll('.gi-msg'));
      var total = 0, count = 0, over = false;
      rows.forEach(function (row, i) {
        var ta = row.querySelector('.gi-msg-body');
        var len = ta.value.length;
        total += len;
        if (ta.value.trim() !== '' || (row._giImages || []).length) count++;
        if (len > _MAX_BODY) over = true;
        var n = row.querySelector('.gi-msg-n');
        if (n) n.textContent = 'Message ' + (i + 1);
        var cnt = row.querySelector('.gi-msg-count');
        if (cnt) {
          cnt.textContent = len.toLocaleString() + ' / ' + _MAX_BODY.toLocaleString();
          cnt.className = 'gi-msg-count' + (len > _MAX_BODY ? ' gi-msg-count--over' : '');
        }
        var del = row.querySelector('.gi-msg-del');
        if (del) del.style.visibility = rows.length > 1 ? '' : 'hidden';
      });
      if (hintEl) {
        var txt = count + ' message' + (count === 1 ? '' : 's') +
                  ' \u00b7 ' + total.toLocaleString() + ' characters';
        if (over) txt += ' \u00b7 a message is over ' + _MAX_BODY.toLocaleString() + ' and will be auto-split';
        hintEl.textContent = txt;
        hintEl.className = 'gi-split-hint' + (over ? ' gi-split-hint--multi' : '');
      }
      recomputeSubmit();
    }

    // Rebuild the boxes from segments + parallel attachments; set the edit baseline
    function loadSegments(segs, atts) {
      msgsEl.innerHTML = '';
      atts = atts || [];
      var rows = (segs || []).map(function (s, i) {
        return { text: String(s == null ? '' : s), images: Array.isArray(atts[i]) ? atts[i].slice() : [] };
      });
      var clean = rows.filter(function (r) { return r.text.trim() !== '' || r.images.length; });
      (clean.length ? clean : [{ text: '', images: [] }]).forEach(function (r) { addMessage(r.text, r.images, false); });
      origSegments = clean.map(function (r) { return r.text; });
      origAttachments = clean.map(function (r) { return _imgSig(r.images); });
      onChange();
    }

    // The submit button is shown only when there is something worth saving
    function _hasSubmittable() {
      var t = titleEl.value.trim();
      var rows = cleanRows();
      if (!t || !rows.length) return false;
      if (!isEdit) return true;
      if (t !== String(origTitle).trim()) return true;
      var segs = rows.map(function (r) { return r.text; });
      if (JSON.stringify(segs) !== JSON.stringify(origSegments)) return true;
      var sigs = rows.map(function (r) { return _imgSig(r.images); });
      return JSON.stringify(sigs) !== JSON.stringify(origAttachments);
    }
    function recomputeSubmit() { if (submitBtn) submitBtn.style.display = _hasSubmittable() ? '' : 'none'; }

    titleEl.addEventListener('input', recomputeSubmit);
    if (addBtn) addBtn.addEventListener('click', function () { addMessage('', [], true); onChange(); });

    submitBtn.addEventListener('click', function () {
      submitPost(isEdit ? post.id : null, titleEl.value, cleanRows(), this, isEdit,
                 { title: origTitle, segments: origSegments, attachments: origAttachments });
    });

    if (isEdit && cached) {                 // populate instantly from cache (no fetch)
      titleEl.value = cached.title || post.title || '';
      origTitle = titleEl.value;
      loadSegments(cached.segments && cached.segments.length ? cached.segments
                   : (cached.body ? [cached.body] : []), cached.attachments);
      titleEl.focus();
    } else if (isEdit) {                    // first time: fetch the body, then cache it
      apiGet('/api/admin/guild-info/posts/' + encodeURIComponent(post.id)).then(function (res) {
        var ld = document.querySelector('#giModal .gi-loading'); if (ld) ld.remove();
        var form = document.getElementById('giForm'); if (form) form.style.display = '';
        if (res.ok && res.data && !res.data.error) {
          _cachePost(res.data);
          titleEl.value = res.data.title || post.title || '';
          origTitle = titleEl.value;
          loadSegments(res.data.segments && res.data.segments.length ? res.data.segments
                       : (res.data.body ? [res.data.body] : []), res.data.attachments);
        } else {
          titleEl.value = post.title || '';
          origTitle = titleEl.value;
          loadSegments([], []);
          toast('\u26a0 Could not load the current body; editing from blank.', 'warn');
        }
        titleEl.focus();
      }).catch(function () {
        var ld = document.querySelector('#giModal .gi-loading'); if (ld) ld.remove();
        var form = document.getElementById('giForm'); if (form) form.style.display = '';
      });
    } else {                                // brand-new post: start with one empty message
      loadSegments([], []);
      titleEl.focus();
    }
  }

  function submitPost(threadId, title, rows, btn, isEdit, orig) {
    title = (title || '').trim();
    if (!title) { toast('\u26a0 Title is required.', 'warn'); return; }
    rows = (rows || []).filter(function (r) { return r.text.trim() !== '' || (r.images && r.images.length); });
    if (!rows.length) { toast('\u26a0 Body is required.', 'warn'); return; }
    var segments = rows.map(function (r) { return r.text; });
    // Existing attachments are kept by Discord id; new uploads carry their staged file
    var attachments = rows.map(function (r) {
      return (r.images || []).map(function (im) {
        return im.id != null
          ? { id: im.id, name: im.name, url: im.url }
          : { file: im.file, name: im.name, url: im.url };
      });
    });
    var sigs = rows.map(function (r) {
      return (r.images || []).map(function (im) {
        return im.id != null ? 'id:' + im.id : (im.file != null ? 'file:' + im.file : 'url:' + (im.url || ''));
      });
    });
    // For edits, only send the fields that actually changed so we never queue a no-op request
    var payload;
    if (isEdit) {
      var o = orig || {};
      payload = {};
      if (title !== String(o.title == null ? '' : o.title).trim()) payload.title = title;
      var segChanged = JSON.stringify(segments) !== JSON.stringify(o.segments || []);
      var attChanged = JSON.stringify(sigs) !== JSON.stringify(o.attachments || []);
      // Body and attachments travel together so the server can make them authoritative
      if (segChanged || attChanged) { payload.segments = segments; payload.attachments = attachments; }
      if (!('title' in payload) && !('segments' in payload)) {
        toast('\u2139 No changes to save.', 'info');
        return;
      }
    } else {
      payload = { title: title, segments: segments, attachments: attachments };
    }
    var origLabel = btn.textContent;
    btn.disabled = true; btn.textContent = 'Working\u2026';
    var req = isEdit
      ? apiPatch('/api/admin/guild-info/posts/' + encodeURIComponent(threadId), payload)
      : apiPost('/api/admin/guild-info/posts', payload);
    req.then(function (res) {
      if (res.ok && (res.data.ok || res.data.id)) {
        if (res.data.queued) {
          // Queued for approval: the post is unchanged for now, so leave the list as-is
          toast('\u2713 Submitted for approval.', 'success');
          _queue = null; _logs = null;         // a new pending request + log entry now exist
          closeModal();
        } else {
          // Direct change (full tier): reflect it in the cached list in place, no refetch
          toast('\u2713 Post ' + (isEdit ? 'updated' : 'created') + '.', 'success');
          if (res.data.warning) toast('\u26a0 ' + res.data.warning, 'warn');
          var savedId = isEdit ? String(threadId) : (res.data.id != null ? String(res.data.id) : null);
          if (savedId != null) {
            var hasImages = attachments.some(function (a) { return a && a.length; });
            if (!isEdit && !hasImages) {
              var cacheSegs = [];
              segments.forEach(function (s) { splitBody(s).forEach(function (piece) { cacheSegs.push(piece); }); });
              _cachePost({ id: savedId, title: title, body: cacheSegs.join('\n\n'),
                           segments: cacheSegs, attachments: [], archived: false });
            } else {
              delete _postCache[savedId];   // body cache may hold stale staged urls
            }
          }
          var msgCount = segments.reduce(function (n, s) { return n + splitBody(s).length; }, 0);
          if (Array.isArray(_posts)) {
            if (isEdit) {
              var entry = _posts.filter(function (p) { return String(p.id) === savedId; })[0];
              if (entry) { entry.title = title; entry.message_count = msgCount; }
            } else if (savedId != null) {
              _posts.push({ id: savedId, title: title, archived: false, locked: false,
                            pending_request: false, message_count: msgCount });
            }
            // Keep the same alphabetical order the server returns
            _posts.sort(function (a, b) {
              var x = (a.title || '').toLowerCase(), y = (b.title || '').toLowerCase();
              return x < y ? -1 : (x > y ? 1 : 0);
            });
          }
          _logs = null;                        // a log entry was created
          closeModal();
          if (_activeTab === 'posts' && Array.isArray(_posts)) drawPosts(document.getElementById('giContent'));
        }
      } else if (res.status === 409) {
        // Someone already has a change pending: reflect the lock in the list
        toast('\u26a0 ' + (res.data.error || 'A change is already pending.'), 'warn');
        closeModal();
        _posts = null;
        if (_activeTab === 'posts') renderPosts(document.getElementById('giContent'));
      } else {
        toast('\u26a0 ' + (res.data.error || 'Failed.'), 'warn');
        btn.disabled = false; btn.textContent = origLabel;
      }
    }).catch(function () {
      toast('\u26a0 Network error.', 'warn');
      btn.disabled = false; btn.textContent = origLabel;
    });
  }

  function confirmDeletePost(post) {
    var isParliament = _state && _state.tier === 'parliament';
    showModal(
      '<div class="gi-modal-title">Delete post</div>' +
      '<div class="gi-modal-text">' + (isParliament
        ? 'Submit a request to delete this post? An approver must confirm it.'
        : 'Permanently delete this post? This cannot be undone.') + '</div>' +
      '<div class="gi-confirm-name" id="giDelName"></div>' +
      '<div class="gi-modal-actions">' +
        '<button class="gi-btn" data-close>Cancel</button>' +
        '<button class="gi-btn gi-btn--danger" id="giDelConfirm">' + (isParliament ? 'Submit request' : 'Delete') + '</button>' +
      '</div>'
    );
    var nameEl = document.getElementById('giDelName');
    if (nameEl) nameEl.textContent = post.title || ('#' + post.id);
    document.getElementById('giDelConfirm').addEventListener('click', function () {
      var b = this, orig = b.textContent;
      b.disabled = true; b.textContent = 'Working\u2026';
      apiDelete('/api/admin/guild-info/posts/' + encodeURIComponent(post.id)).then(function (res) {
        if (res.ok && (res.data.ok || res.data.id)) {
          toast(isParliament ? '\u2713 Delete request submitted.' : '\u2713 Post deleted.', 'success');
          closeModal();
          if (!isParliament) delete _postCache[String(post.id)];   // really gone
          // A delete shifts the queue
          _posts = null; _logs = null; _queue = null;
          if (_state && _state.can_approve) fetchQueue(function () { _updateNavBadge(); _updateQueueTabBadge(); });
          else _updateNavBadge();
          if (_activeTab === 'posts') renderPosts(document.getElementById('giContent'));
        } else {
          toast('\u26a0 ' + (res.data.error || 'Failed.'), 'warn');
          b.disabled = false; b.textContent = orig;
        }
      }).catch(function () { toast('\u26a0 Network error.', 'warn'); b.disabled = false; b.textContent = orig; });
    });
  }

  /* Queue tab (approvers only) */
  function fetchQueue(cb) {
    apiGet('/api/admin/guild-info/queue').then(function (res) {
      if (res.ok && res.data && Array.isArray(res.data.queue)) {
        _queue = res.data.queue; _queueAt = Date.now();
        _privReqs = Array.isArray(res.data.privilege_requests) ? res.data.privilege_requests : [];
      }
      else if (res.status === 403) { _queue = []; _privReqs = []; }
      else if (_queue == null) _queue = [];
      if (cb) cb(res);
    }).catch(function () { if (cb) cb(null); });
  }

  function renderQueue(c) {
    if (_queue != null) {                       // serve instantly from cache
      drawQueue(c);
      if (Date.now() - _queueAt > _TTL) {       // refresh quietly when stale
        fetchQueue(function () { if (_activeTab === 'queue') drawQueue(c); });
      }
      return;
    }
    setHTML(c, loadingHTML('Loading queue\u2026'));
    fetchQueue(function () { if (_activeTab === 'queue') drawQueue(c); });
  }

  // A content request's body of detail: shows what each request would change
  function _qChangeRows(r) {
    var oldT = (r.prev_title != null && String(r.prev_title) !== '') ? r.prev_title : null;
    var oldB = (r.prev_body  != null && String(r.prev_body)  !== '') ? r.prev_body  : null;
    var out = '';
    if (r.action === 'edit_title' && oldT != null) {
      out += '<div class="gi-q-row"><span class="gi-q-k">From</span><span class="gi-q-v gi-q-old" data-otitle></span></div>' +
             '<div class="gi-q-row"><span class="gi-q-k">To</span><span class="gi-q-v" data-title></span></div>';
    } else if (r.action === 'delete' && oldT != null) {
      out += '<div class="gi-q-row"><span class="gi-q-k">Post</span><span class="gi-q-v" data-otitle></span></div>';
    } else if (r.action === 'create' || r.action === 'edit_title') {
      out += '<div class="gi-q-row"><span class="gi-q-k">Title</span><span class="gi-q-v" data-title></span></div>';
    }
    if (r.thread_id) {
      out += '<div class="gi-q-row"><span class="gi-q-k">Thread</span><span class="gi-q-v">' + esc(r.thread_id) + '</span></div>';
    }
    if (r.action === 'edit_body' && oldB != null) {
      out += '<div class="gi-q-row"><span class="gi-q-k">Before</span></div>' +
             '<div class="gi-q-body gi-q-old" data-obody></div>' +
             '<div class="gi-q-row"><span class="gi-q-k">After</span></div>' +
             '<div class="gi-q-body" data-body></div>' +
             '<div class="gi-q-imgs" data-qimgs></div>';
    } else if (r.action === 'create' || r.action === 'edit_body') {
      out += '<div class="gi-q-body" data-body></div>' +
             '<div class="gi-q-imgs" data-qimgs></div>';
    }
    return out;
  }

  function _diffTokens(text) {
    return String(text == null ? '' : text).match(/\s+|\S+/g) || [];
  }

  function _diffOps(oldStr, newStr) {
    var a = _diffTokens(oldStr), b = _diffTokens(newStr);
    var n = a.length, m = b.length;
    if (n * m > 250000) {
      return [{ t: 'del', s: String(oldStr == null ? '' : oldStr) },
              { t: 'ins', s: String(newStr == null ? '' : newStr) }];
    }
    var dp = new Array(n + 1);
    for (var i = 0; i <= n; i++) dp[i] = new Array(m + 1).fill(0);
    for (i = n - 1; i >= 0; i--) {
      for (var j = m - 1; j >= 0; j--) {
        dp[i][j] = (a[i] === b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    var ops = [], x = 0, y = 0;
    while (x < n && y < m) {
      if (a[x] === b[y]) { ops.push({ t: 'eq', s: a[x] }); x++; y++; }
      else if (dp[x + 1][y] >= dp[x][y + 1]) { ops.push({ t: 'del', s: a[x] }); x++; }
      else { ops.push({ t: 'ins', s: b[y] }); y++; }
    }
    while (x < n) { ops.push({ t: 'del', s: a[x] }); x++; }
    while (y < m) { ops.push({ t: 'ins', s: b[y] }); y++; }
    return ops;
  }

  function _fillDiff(el, ops, side) {
    if (!el) return;
    el.textContent = '';
    var changed = side === 'old' ? 'del' : 'ins';
    var cls = side === 'old' ? 'gi-d-del' : 'gi-d-ins';
    ops.forEach(function (o) {
      if (o.t === 'eq') {
        el.appendChild(document.createTextNode(o.s));
      } else if (o.t === changed) {
        var span = document.createElement('span');
        span.className = cls;
        span.textContent = o.s;
        el.appendChild(span);
      }
    });
  }

  function drawQueue(c) {
    _updateNavBadge();
    _updateQueueTabBadge();
    if (_queue == null) { setHTML(c, emptyHTML('Could not load the queue.')); return; }

    // Privilege requests are only shown to Emperor/OWNER approvers
    var privReqs = (_state && _state.can_approve_privilege && Array.isArray(_privReqs)) ? _privReqs : [];

    // Counts per category power the pill badges (shown even when zero)
    var counts = { all: _queue.length + privReqs.length, create: 0, edit: 0, delete: 0, privilege: privReqs.length };
    _queue.forEach(function (r) { counts[_queueCat(r.action)]++; });
    function pill(key, label) {
      return '<button class="gi-q-pill' + (_queueFilter === key ? ' active' : '') +
        '" data-qf="' + key + '">' + label +
        ' <span class="gi-q-count">' + counts[key] + '</span></button>';
    }
    var filters = '<div class="gi-q-filters" id="giQueueFilters">' +
      pill('all', 'All') + pill('create', 'Create') +
      pill('edit', 'Edit') + pill('delete', 'Delete') +
      pill('privilege', 'Privilege') +
      '<span class="gi-q-sort" id="giQueueSort">' +
        (_queueSort === 'newest' ? 'Newest first' : 'Oldest first') +
      '</span>' +
    '</div>';

    // Render order honours the sort toggle (backend default is oldest-first)
    var ordered = _queue.slice().sort(function (a, b) {
      var cmp = String(a.created_at || '').localeCompare(String(b.created_at || ''));
      return _queueSort === 'newest' ? -cmp : cmp;
    });
    var rows = ordered.map(function (r) {
      var cat = _queueCat(r.action);
      var hidden = _queueFilter !== 'all' && _queueFilter !== cat;
      return '<div class="gi-q-card' + (hidden ? ' gi-q-hidden' : '') +
          '" data-id="' + esc(r.id) + '" data-qcat="' + cat +
          '" data-qdate="' + esc(r.created_at) + '">' +
          '<div class="gi-q-head">' +
            '<span class="gi-q-action gi-q-action--' + esc(r.action) + '">' + esc(_actionLabel(r.action)) + '</span>' +
            '<span class="gi-q-who" data-who></span>' +
            '<span class="gi-q-when">' + esc(fmtDate(r.created_at)) + '</span>' +
          '</div>' +
          _qChangeRows(r) +
          '<div class="gi-q-actions">' +
            '<button class="gi-btn gi-btn--sm gi-btn--primary" data-qact="approve" data-id="' + esc(r.id) + '">Review &amp; approve</button>' +
            '<button class="gi-btn gi-btn--sm gi-btn--danger" data-qact="deny" data-id="' + esc(r.id) + '">Deny</button>' +
          '</div>' +
        '</div>';
    }).join('');
    var privRows = privReqs.map(function (p) {
      var hidden = _queueFilter !== 'all' && _queueFilter !== 'privilege';
      return '<div class="gi-q-card' + (hidden ? ' gi-q-hidden' : '') +
          '" data-id="' + esc(p.id) + '" data-qkind="privilege" data-qcat="privilege"' +
          ' data-qdate="' + esc(p.created_at) + '">' +
          '<div class="gi-q-head">' +
            '<span class="gi-q-action gi-q-action--privilege_request">Privilege request</span>' +
            '<span class="gi-q-who" data-pwho></span>' +
            '<span class="gi-q-when">' + esc(fmtDate(p.created_at)) + '</span>' +
          '</div>' +
          '<div class="gi-q-row"><span class="gi-q-k">Wants</span><span class="gi-q-v">Guild Info access</span></div>' +
          '<div class="gi-q-actions">' +
            '<button class="gi-btn gi-btn--sm gi-btn--primary" data-qact="priv-approve" data-id="' + esc(p.id) + '">Approve</button>' +
            '<button class="gi-btn gi-btn--sm gi-btn--danger" data-qact="priv-deny" data-id="' + esc(p.id) + '">Reject</button>' +
          '</div>' +
        '</div>';
    }).join('');
    var listInner = (rows + privRows) || '<div class="gi-empty gi-q-empty">No pending requests.</div>';
    setHTML(c, filters + '<div class="gi-list" id="giQueueList">' + listInner + '</div>');

    // user content -> textContent
    _queue.forEach(function (r) {
      var card = c.querySelector('.gi-q-card[data-id="' + r.id + '"]:not([data-qkind])');
      if (!card) return;
      var whoEl = card.querySelector('[data-who]');   if (whoEl) whoEl.textContent = r.requested_by_name || r.requested_by_id || 'Unknown';
      var tEl   = card.querySelector('[data-title]'); if (tEl) tEl.textContent = r.title || '';
      var otEl  = card.querySelector('[data-otitle]'); if (otEl) otEl.textContent = r.prev_title || '';
      // Body before/after highlights word-level inserts (After) and removals (Before)
      var bEl   = card.querySelector('[data-body]');
      var obEl  = card.querySelector('[data-obody]');
      if (obEl && bEl) {
        var bodyOps = _diffOps(r.prev_body || '', r.body || '');
        _fillDiff(obEl, bodyOps, 'old');
        _fillDiff(bEl, bodyOps, 'new');
      } else {
        if (bEl) bEl.textContent = r.body || '';
        if (obEl) obEl.textContent = r.prev_body || '';
      }
      // Flattened image attachments preview what the request will post
      var imgsEl = card.querySelector('[data-qimgs]');
      if (imgsEl) {
        var flat = [];
        (r.attachments || []).forEach(function (m) { (m || []).forEach(function (im) { if (im) flat.push(im); }); });
        var strip = _buildImageStrip(flat);
        if (strip) imgsEl.appendChild(strip);
      }
    });
    // privilege requests: requester name via textContent (never innerHTML)
    var privCards = c.querySelectorAll('.gi-q-card[data-qkind="privilege"]');
    privReqs.forEach(function (p, i) {
      var card = privCards[i]; if (!card) return;
      var w = card.querySelector('[data-pwho]');
      if (w) w.textContent = p.username || p.discord_id || 'Unknown';
    });

    // filter pills + sort toggle
    var fbar = document.getElementById('giQueueFilters');
    if (fbar) {
      fbar.addEventListener('click', function (e) {
        var p = e.target.closest('.gi-q-pill');
        if (p) {
          _queueFilter = p.dataset.qf;
          fbar.querySelectorAll('.gi-q-pill').forEach(function (x) { x.classList.remove('active'); });
          p.classList.add('active');
          _applyQueueFilter(c);
          return;
        }
        var s = e.target.closest('.gi-q-sort');
        if (s) {
          _queueSort = _queueSort === 'newest' ? 'oldest' : 'newest';
          s.textContent = _queueSort === 'newest' ? 'Newest first' : 'Oldest first';
          _resortQueue();
        }
      });
    }

    c.querySelectorAll('[data-qact]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-id');
        var qact = btn.getAttribute('data-qact');
        if (qact === 'priv-approve') { _approvePrivilege(id, btn); return; }
        if (qact === 'priv-deny')    { _denyPrivilege(id, btn); return; }
        var req = (_queue || []).filter(function (x) { return String(x.id) === String(id); })[0];
        if (!req) return;
        if (qact === 'approve') openApprove(req);
        else openDeny(req);
      });
    });
  }

  // Show/hide cards to match the active pill, then reconcile the empty note
  function _applyQueueFilter(c) {
    var scope = c || document;
    scope.querySelectorAll('.gi-q-card').forEach(function (card) {
      var match = _queueFilter === 'all' || _queueFilter === card.dataset.qcat;
      card.classList.toggle('gi-q-hidden', !match);
    });
    _checkQueueEmpty();
  }

  // Reorder existing card nodes by date without a full re-render
  function _resortQueue() {
    var list = document.getElementById('giQueueList');
    if (!list) return;
    var cards = Array.prototype.slice.call(list.querySelectorAll('.gi-q-card'));
    cards.sort(function (a, b) {
      var cmp = String(a.dataset.qdate || '').localeCompare(String(b.dataset.qdate || ''));
      return _queueSort === 'newest' ? -cmp : cmp;
    });
    cards.forEach(function (card) { list.appendChild(card); });
  }

  // Surface a hint when the active filter leaves no visible cards
  function _checkQueueEmpty() {
    var list = document.getElementById('giQueueList');
    if (!list) return;
    var visible = list.querySelectorAll('.gi-q-card:not(.gi-q-hidden)');
    var empty = list.querySelector('.gi-q-empty');
    if (!visible.length && !empty) {
      var div = document.createElement('div');
      div.className = 'gi-empty gi-q-empty';
      div.textContent = 'No matching requests.';
      list.appendChild(div);
    } else if (visible.length && empty) {
      empty.remove();
    }
  }

  function openApprove(req) {
    var hasTitle = (req.action === 'create' || req.action === 'edit_title');
    var hasBody  = (req.action === 'create' || req.action === 'edit_body');
    var isDelete = req.action === 'delete';
    // Flatten the request's per-message images for a read-only preview
    var attImgs = [];
    (req.attachments || []).forEach(function (m) { (m || []).forEach(function (im) { if (im) attImgs.push(im); }); });
    var attCount = attImgs.length;
    showModal(
      '<div class="gi-modal-title">Approve: ' + esc(_actionLabel(req.action)) + '</div>' +
      '<div class="gi-modal-sub" id="giApWho"></div>' +
      (hasTitle ? '<label class="gi-label">Title</label><input type="text" class="gi-input" id="giApTitle" maxlength="' + _MAX_TITLE + '" />' : '') +
      (hasBody  ? '<label class="gi-label">Body</label><textarea class="gi-textarea" id="giApBody" rows="10"></textarea><div class="gi-split-hint" id="giApHint"></div>' : '') +
      (attCount ? '<label class="gi-label">Images <span class="gi-label-sub">\u2014 ' + attCount + ' attached</span></label>' +
                  '<div id="giApImgs"></div>' +
                  '<div class="gi-ap-imgwarn">Editing the body may change how it splits into messages and can unlink or misalign these images. Approve without editing the body to keep them as submitted.</div>' : '') +
      (isDelete ? '<div class="gi-modal-text">Approving will permanently delete this post.</div>' : '') +
      '<div class="gi-modal-actions">' +
        '<button class="gi-btn" data-close>Cancel</button>' +
        '<button class="gi-btn gi-btn--primary" id="giApConfirm">Approve</button>' +
      '</div>'
    );
    var whoEl = document.getElementById('giApWho');
    if (whoEl) whoEl.textContent = 'Requested by ' + (req.requested_by_name || req.requested_by_id || 'Unknown') + ' \u00b7 ' + fmtDate(req.created_at);
    var titleEl = document.getElementById('giApTitle');
    if (titleEl) titleEl.value = req.title || '';
    var bodyEl = document.getElementById('giApBody');
    if (bodyEl) {
      bodyEl.value = req.body || '';
      var hintEl = document.getElementById('giApHint');
      var uh = function () {
        var n = splitBody(bodyEl.value).length;
        hintEl.textContent = bodyEl.value.length.toLocaleString() + ' characters \u00b7 ' + n + ' message' + (n === 1 ? '' : 's');
        hintEl.className = 'gi-split-hint' + (n > 1 ? ' gi-split-hint--multi' : '');
      };
      bodyEl.addEventListener('input', uh); uh();
    }
    if (attCount) {
      var imgHost = document.getElementById('giApImgs');
      if (imgHost) { var strip = _buildImageStrip(attImgs); if (strip) imgHost.appendChild(strip); }
    }
    document.getElementById('giApConfirm').addEventListener('click', function () {
      var b = this; b.disabled = true; b.textContent = 'Approving\u2026';
      var payload = {};
      if (hasTitle && titleEl) {
        var t = titleEl.value.trim();
        if (!t) { toast('\u26a0 Title cannot be empty.', 'warn'); b.disabled = false; b.textContent = 'Approve'; return; }
        payload.title = t;
      }
      if (hasBody && bodyEl) {
        var newBody = bodyEl.value;
        // An empty body is allowed only when the post keeps image attachments
        if (!newBody.trim() && !attCount) { toast('\u26a0 Body cannot be empty.', 'warn'); b.disabled = false; b.textContent = 'Approve'; return; }
        // Send the body only when it actually changed
        if (newBody !== (req.body || '')) payload.body = newBody;
      }
      apiPost('/api/admin/guild-info/queue/' + encodeURIComponent(req.id) + '/approve', payload).then(function (res) {
        if (res.ok && res.data.ok) {
          toast('\u2713 Approved.', 'success');
          if (res.data.result && res.data.result.warning) toast('\u26a0 ' + res.data.result.warning, 'warn');
          closeModal();
          if (req.thread_id) delete _postCache[String(req.thread_id)];  // body may have changed
          _queue = null; _posts = null; _logs = null;
          renderQueue(document.getElementById('giContent'));
        } else {
          toast('\u26a0 ' + (res.data.error || 'Failed.'), 'warn');
          b.disabled = false; b.textContent = 'Approve';
        }
      }).catch(function () { toast('\u26a0 Network error.', 'warn'); b.disabled = false; b.textContent = 'Approve'; });
    });
  }

  function openDeny(req) {
    showModal(
      '<div class="gi-modal-title">Deny request</div>' +
      '<div class="gi-modal-sub" id="giDenyWho"></div>' +
      '<label class="gi-label">Reason (sent to the requester)</label>' +
      '<textarea class="gi-textarea" id="giDenyReason" rows="4" maxlength="500" placeholder="Why are you denying this?"></textarea>' +
      '<div class="gi-modal-actions">' +
        '<button class="gi-btn" data-close>Cancel</button>' +
        '<button class="gi-btn gi-btn--danger" id="giDenyConfirm">Deny &amp; notify</button>' +
      '</div>'
    );
    var whoEl = document.getElementById('giDenyWho');
    if (whoEl) whoEl.textContent = _actionLabel(req.action) + ' \u00b7 ' + (req.requested_by_name || req.requested_by_id || 'Unknown');
    var reasonEl = document.getElementById('giDenyReason');
    document.getElementById('giDenyConfirm').addEventListener('click', function () {
      var reason = (reasonEl.value || '').trim();
      if (!reason) { toast('\u26a0 A reason is required.', 'warn'); return; }
      var b = this; b.disabled = true; b.textContent = 'Denying\u2026';
      apiPost('/api/admin/guild-info/queue/' + encodeURIComponent(req.id) + '/deny', { reason: reason }).then(function (res) {
        if (res.ok && res.data.ok) {
          toast('\u2713 Request denied; the requester was notified.', 'success');
          closeModal();
          _queue = null; _logs = null;
          renderQueue(document.getElementById('giContent'));
        } else {
          toast('\u26a0 ' + (res.data.error || 'Failed.'), 'warn');
          b.disabled = false; b.textContent = 'Deny & notify';
        }
      }).catch(function () { toast('\u26a0 Network error.', 'warn'); b.disabled = false; b.textContent = 'Deny & notify'; });
    });
  }

  /* Privilege requests (Emperor / OWNER only) */
  function _approvePrivilege(id, btn) {
    var orig = btn.textContent;
    btn.disabled = true; btn.textContent = 'Approving\u2026';
    apiPost('/api/admin/guild-info/privilege-requests/' + encodeURIComponent(id) + '/approve', {}).then(function (res) {
      if (res.ok && res.data.ok) {
        toast('\u2713 Access approved.', 'success');
        _privReqs = (_privReqs || []).filter(function (p) { return String(p.id) !== String(id); });
        _logs = null;
        renderQueue(document.getElementById('giContent'));
      } else {
        toast('\u26a0 ' + (res.data.error || 'Failed.'), 'warn');
        btn.disabled = false; btn.textContent = orig;
      }
    }).catch(function () { toast('\u26a0 Network error.', 'warn'); btn.disabled = false; btn.textContent = orig; });
  }

  function _denyPrivilege(id, btn) {
    var orig = btn.textContent;
    btn.disabled = true; btn.textContent = 'Rejecting\u2026';
    apiPost('/api/admin/guild-info/privilege-requests/' + encodeURIComponent(id) + '/deny', {}).then(function (res) {
      if (res.ok && res.data.ok) {
        toast('\u2713 Request rejected.', 'success');
        _privReqs = (_privReqs || []).filter(function (p) { return String(p.id) !== String(id); });
        _logs = null;
        renderQueue(document.getElementById('giContent'));
      } else {
        toast('\u26a0 ' + (res.data.error || 'Failed.'), 'warn');
        btn.disabled = false; btn.textContent = orig;
      }
    }).catch(function () { toast('\u26a0 Network error.', 'warn'); btn.disabled = false; btn.textContent = orig; });
  }

  /* Logs tab */
  function fetchLogs(page, cb) {
    apiGet('/api/admin/guild-info/logs?page=' + page + '&per_page=50').then(function (res) {
      if (res.ok && res.data && Array.isArray(res.data.entries)) {
        _logs = (page === 1) ? res.data.entries : (_logs || []).concat(res.data.entries);
        _logsHasMore = !!res.data.has_more;
        _logsPage = page;
        if (page === 1) _logsAt = Date.now();
      } else if (page === 1 && _logs == null) {
        _logs = null;
      }
      if (cb) cb(res);
    }).catch(function () { if (page === 1 && _logs == null) _logs = null; if (cb) cb(null); });
  }

  function renderLogs(c) {
    if (_logs != null) {                                     // serve instantly from cache
      drawLogs(c);
      if (_logsPage === 1 && Date.now() - _logsAt > _TTL) {  // refresh quietly when stale
        fetchLogs(1, function () { if (_activeTab === 'logs') drawLogs(c); });
      }
      return;
    }
    setHTML(c, loadingHTML('Loading logs\u2026'));
    _logsPage = 1; _logsHasMore = false;
    fetchLogs(1, function () {
      if (_activeTab !== 'logs') return;
      if (_logs == null) { setHTML(c, emptyHTML('Could not load logs.')); return; }
      drawLogs(c);
    });
  }

  // Build one key/value row for the log detail popup (value via textContent)
  function _logKV(host, key, value) {
    var row = document.createElement('div'); row.className = 'gi-q-row';
    var k = document.createElement('span'); k.className = 'gi-q-k'; k.textContent = key;
    var v = document.createElement('span'); v.className = 'gi-q-v';
    v.textContent = value == null ? '' : String(value);
    row.appendChild(k); row.appendChild(v); host.appendChild(row);
    return v;
  }
  // A label-only row that introduces a body block
  function _logSection(host, label) {
    var row = document.createElement('div'); row.className = 'gi-q-row';
    var k = document.createElement('span'); k.className = 'gi-q-k'; k.textContent = label;
    row.appendChild(k); host.appendChild(row);
  }
  function _logBodyBox(host, extraCls) {
    var box = document.createElement('div');
    box.className = 'gi-q-body' + (extraCls ? (' ' + extraCls) : '');
    host.appendChild(box);
    return box;
  }

  // Detailed "what changed" popup for a single log entry
  function openLogDetail(e, titleMap) {
    var d = {}, raw = null;
    if (e.details) {
      try { d = JSON.parse(e.details) || {}; }
      catch (x) { d = {}; raw = String(e.details); }
    }
    showModal(
      '<div class="gi-modal-title">Log details</div>' +
      '<div class="gi-modal-sub" id="giLogStatus"></div>' +
      '<div class="gi-log-detail" id="giLogDetailBody"></div>' +
      '<div class="gi-modal-actions"><button class="gi-btn" data-close>Close</button></div>'
    );
    var statusEl = document.getElementById('giLogStatus');
    if (statusEl) {
      var badge = document.createElement('span');
      badge.className = 'gi-log-action' + _logActionClass(e.action);
      badge.textContent = _logActionLabel(e.action) || (e.action || '');
      statusEl.appendChild(badge);
    }
    var host = document.getElementById('giLogDetailBody');
    if (!host) return;
    _logKV(host, 'When', fmtDate(e.timestamp));
    if (e.actor) _logKV(host, 'By', e.actor);
    // Unparseable details: show the raw string and stop
    if (raw != null) { _logKV(host, 'Details', raw); return; }
    if (d.action) _logKV(host, 'Change', _logOpLabel(d));
    // Title: before/after when it changed, else a single identifying value
    if (d.before_title != null && d.before_title !== '') {
      _logKV(host, 'From', d.before_title);
      _logKV(host, 'To', d.title || '');
    } else if (d.title != null && d.title !== '') {
      _logKV(host, d.action === 'create' ? 'Title' : 'Post', d.title);
    }
    // Body: word-level diff when both sides exist, else whichever side we have
    var hasBefore = d.before_body != null, hasAfter = d.after_body != null;
    if (hasBefore && hasAfter) {
      var ops = _diffOps(d.before_body, d.after_body);
      _logSection(host, 'Before'); _fillDiff(_logBodyBox(host, 'gi-q-old'), ops, 'old');
      _logSection(host, 'After');  _fillDiff(_logBodyBox(host), ops, 'new');
    } else if (hasAfter) {
      _logSection(host, d.action === 'create' ? 'Body' : 'New');
      _logBodyBox(host).textContent = d.after_body;
    } else if (hasBefore) {
      _logSection(host, 'Removed');
      _logBodyBox(host, 'gi-q-old').textContent = d.before_body;
    }
    // Counts
    if (d.messages != null && (d.action === 'create' || d.action === 'edit_body' || d.action === 'edit')) {
      _logKV(host, 'Msgs', d.messages);
    }
    if (d.images) _logKV(host, 'Images', d.images);
    // Privilege actions carry a user instead of post content
    if (d.username) _logKV(host, 'User', d.username);
    if (d.discord_id) _logKV(host, 'ID', d.discord_id);
    // Flags / notes
    if (d.edited) _logKV(host, 'Edited', 'Before approval');
    if (d.reason) _logKV(host, 'Reason', d.reason);
    if (d.error) _logKV(host, 'Error', d.error);
    if (d.warning) _logKV(host, 'Warning', d.warning);
    // Thread id for content actions (audit trail)
    var tid = d.thread_id || e.target_id;
    if (d.action && tid) _logKV(host, 'Thread', tid);
  }

  function drawLogs(c) {
    if (!_logs.length) { setHTML(c, emptyHTML('No log entries yet.')); return; }
    // Resolve post titles by thread id so edits show which post they touched
    var titleMap = {};
    (_posts || []).forEach(function (p) { if (p && p.id != null) titleMap[String(p.id)] = p.title || ''; });
    var rows = _logs.map(function () {
      return '<div class="gi-log-row">' +
          '<span class="gi-log-time" data-time></span>' +
          '<span class="gi-log-actor" data-actor></span>' +
          '<span class="gi-log-action" data-action></span>' +
          '<span class="gi-log-det" data-det></span>' +
        '</div>';
    }).join('');
    var more = _logsHasMore ? '<div class="gi-log-more"><button class="gi-btn gi-btn--sm" id="giLogsMore">Load more</button></div>' : '';
    setHTML(c, '<div class="gi-logs">' + rows + '</div>' + more);
    var rowEls = c.querySelectorAll('.gi-log-row');
    _logs.forEach(function (e, i) {
      var row = rowEls[i]; if (!row) return;
      var t = row.querySelector('[data-time]');   if (t) t.textContent = fmtDate(e.timestamp);
      var a = row.querySelector('[data-actor]');  if (a) a.textContent = e.actor || '';
      var ac = row.querySelector('[data-action]'); if (ac) { ac.textContent = _logActionLabel(e.action); ac.className = 'gi-log-action' + _logActionClass(e.action); }
      var d = row.querySelector('[data-det]');    if (d) d.textContent = _logDetail(e, titleMap);
      row.style.cursor = 'pointer';
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.title = 'View details';
      row.addEventListener('click', function () { openLogDetail(e, titleMap); });
      row.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openLogDetail(e, titleMap); }
      });
    });
    var moreBtn = document.getElementById('giLogsMore');
    if (moreBtn) moreBtn.addEventListener('click', function () {
      moreBtn.disabled = true; moreBtn.textContent = 'Loading\u2026';
      fetchLogs(_logsPage + 1, function () { if (_activeTab === 'logs') drawLogs(c); });
    });
  }

  /* init */
  function initPanel() {
    if (_initDone) return;
    if (!window.state || !window.state.loggedIn) {
      if (window.renderAuthGate) window.renderAuthGate(panel);
      else setHTML(panel, _PANEL_HEADER + '<div class="gi-login">Log in to manage guild info.</div>');
      return; // retry on next activation / after login reload
    }
    _initDone = true;
    setHTML(panel, _PANEL_HEADER + loadingHTML('Loading…'));
    fetchState(function (d) {
      if (d && d.privilege_blocked) {
        _applyPrivilegeBlockedState();
        _initDone = false; // re-check after approval on next activation
        return;
      }
      if (!d || !d.access) {
        setHTML(panel, _PANEL_HEADER + emptyHTML('You do not have access to Guild Info.'));
        _initDone = false; // allow re-check if roles change later
        return;
      }
      _revealNav();
      buildShell();
      renderTab();
      if (d.can_approve) fetchQueue(function () { _updateNavBadge(); _updateQueueTabBadge(); });
    });
  }

  var observer = new MutationObserver(function () {
    if (panel.classList.contains('active')) initPanel();
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  if (panel.classList.contains('active')) initPanel();

  // Reveal the sidebar entry as early as possible for already-logged-in users.
  if (window.state && window.state.loggedIn) window.preloadGuildInfoBadge();
})();
