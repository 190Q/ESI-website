(function () {
  'use strict';

  // Panels under the "General" category that should display the banner
  var GENERAL_PANELS = ['panel-player', 'panel-guild', 'panel-bot'];
  // Persisted list of event IDs the user has collapsed
  var COLLAPSE_KEY   = 'esi.collapsedPins';
  var BANNER_CLASS   = 'pinned-banner';
  var STACK_CLASS    = 'pinned-banner-stack';
  var COLLAPSED_MOD  = 'pinned-banner--collapsed';

  // Cached pinned-event list returned by /api/events/pinned
  var _events   = [];
  var _fetched  = false;
  var _loading  = false;

  /* analytics */
  var _meta = typeof Map === 'function' ? new Map() : null;
  var _io   = null;

  function metaFor(el) {
    if (!_meta) return { at: Date.now(), impression: false, visible: false };
    var m = _meta.get(el);
    if (!m) {
      m = { at: Date.now(), impression: false, visible: false };
      _meta.set(el, m);
    }
    return m;
  }


  var BANNER_STATUSES = ['upcoming', 'ongoing', 'completed', 'cancelled'];
  var BANNER_AUDIENCES = ['public', 'guild_only'];

  function activeGeneralPanel() {
    for (var i = 0; i < GENERAL_PANELS.length; i++) {
      var panel = document.getElementById(GENERAL_PANELS[i]);
      if (panel && panel.classList.contains('active')) {
        return GENERAL_PANELS[i].replace('panel-', '');
      }
    }
    return '';
  }

  function bannerSlot(el) {
    var parent = el && el.parentNode;
    if (!parent || !parent.children) return 0;
    var index = Array.prototype.indexOf.call(parent.children, el);
    return index >= 0 ? Math.min(10, index + 1) : 0;
  }

  function bannerContext(el) {
    var ctx = {};
    if (!el) return ctx;
    var status = el.dataset ? el.dataset.status : '';
    if (BANNER_STATUSES.indexOf(status) !== -1) ctx.status = status;
    var audience = el.dataset ? el.dataset.audience : '';
    if (BANNER_AUDIENCES.indexOf(audience) !== -1) ctx.audience = audience;
    var slot = bannerSlot(el);
    if (slot) ctx.slot = slot;
    var panel = activeGeneralPanel();
    if (panel) ctx.panel = panel;
    return ctx;
  }

  function trackBanner(action, eventId, ms, el) {
    try {
      if (!window.ESITrack) return;
      var props = { action: action, banner: String(eventId || '').slice(0, 40) };
      if (typeof ms === 'number' && isFinite(ms) && ms >= 0) {
        props.ms = Math.round(ms);
      }
      var ctx = bannerContext(el);
      Object.keys(ctx).forEach(function (key) { props[key] = ctx[key]; });
      window.ESITrack.event('banner', props);
    } catch (e) { /* analytics must never break the banner */ }
  }

  function trackLink(target, external) {
    try {
      if (!window.ESITrack) return;
      window.ESITrack.event('link', {
        target: String(target || '').slice(0, 120),
        external: !!external,
      });
    } catch (e) { /* analytics must never break the banner */ }
  }

  /* helpers */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getCollapsed() {
    try {
      var raw = localStorage.getItem(COLLAPSE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveCollapsed(arr) {
    try {
      localStorage.setItem(COLLAPSE_KEY, JSON.stringify(arr));
    } catch (e) { /* storage might be disabled - just no-op */ }
  }

  function isCollapsed(eventId) {
    if (!eventId) return false;
    return getCollapsed().indexOf(eventId) !== -1;
  }

  function setCollapsed(eventId, collapsed) {
    if (!eventId) return;
    var arr = getCollapsed();
    var idx = arr.indexOf(eventId);
    if (collapsed && idx === -1) {
      arr.push(eventId);
      saveCollapsed(arr);
    } else if (!collapsed && idx !== -1) {
      arr.splice(idx, 1);
      saveCollapsed(arr);
    }
  }

  function fmtDateTime(stored) {
    if (!stored) return '';
    var d = (window.ESI_TZ && window.ESI_TZ.serverStoredToDate)
      ? window.ESI_TZ.serverStoredToDate(stored)
      : (typeof stored === 'number' ? new Date(stored * 1000) : new Date(stored));
    if (!d || isNaN(d.getTime())) return esc(stored);
    return d.toLocaleString('en-GB', {
      day: 'numeric', month: 'short',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function ordinal(n) {
    var v = Math.max(1, Math.floor(Number(n) || 1));
    var s = ['th', 'st', 'nd', 'rd'];
    var mod100 = v % 100;
    var suffix = (mod100 >= 11 && mod100 <= 13) ? 'th' : (s[v % 10] || 'th');
    return v + suffix;
  }

  // Compact prize summary
  function formatPrizesShort(prizes) {
    if (!Array.isArray(prizes) || !prizes.length) return '';
    var byPos = {};
    prizes.forEach(function (p) {
      if (!p) return;
      var raw = Number(p.position);
      var pos = isFinite(raw) && raw >= 0 ? raw : 1;
      if (!byPos[pos]) byPos[pos] = [];
      byPos[pos].push(p);
    });
    var positions = Object.keys(byPos).map(Number).sort(function (a, b) {
      if (a === 0) return 1;
      if (b === 0) return -1;
      return a - b;
    });
    if (!positions.length) return '';
    var top = byPos[positions[0]];
    var summary = top.map(function (p) {
      if (p.type === 'esi_points') {
        var n = Number(p.value || 0);
        if (!n) return 'ESI Points';
        return n.toLocaleString() + ' ESI Points';
      }
      return p.value || (p.type === 'item' ? 'Item' : 'Other');
    }).join(' + ');
    var more = positions.length > 1 ? ' \u00b7 +' + (positions.length - 1) + ' more place' + (positions.length > 2 ? 's' : '') : '';
    var label = positions[0] === 0
      ? 'Participation Prize'
      : ordinal(positions[0]) + ' place';
    return label + ': ' + summary + more;
  }

  // Auto-link bare http(s)/www URLs by rewriting them into [url](url)
  function autoLinkBareUrls(src) {
    if (!src) return src;
    var BARE_URL_RE = /(\bhttps?:\/\/[^\s<>)\]'"]+)/g;
    var WWW_URL_RE  = /(^|[\s(])(www\.[^\s<>)\]'"]+)/g;
    var SPLIT_RE = /(```[\s\S]*?```|`[^`]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))/g;
    var parts = src.split(SPLIT_RE);
    return parts.map(function (part, idx) {
      if (idx % 2 === 1) return part; // preserved token
      return part
        .replace(BARE_URL_RE, '[$1]($1)')
        .replace(WWW_URL_RE, '$1[$2](https://$2)');
    }).join('');
  }

  // Sanitised rendering of the event description
  function renderDescriptionHtml(src) {
    if (!src) return '';
    var processed = autoLinkBareUrls(src);
    var rendered = typeof window.renderMarkdown === 'function'
      ? window.renderMarkdown(processed)
      : esc(processed).replace(/\n/g, '<br>');
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(rendered, {
        ADD_TAGS: ['details', 'summary'],
        ADD_ATTR: ['target', 'rel', 'style'],
      });
    }
    // DOMPurify hasn't loaded yet - fall back to plain escaped text
    return esc(processed).replace(/\n/g, '<br>');
  }

  function renderBannerHtml(ev, collapsed) {
    var status = (ev.status || 'upcoming').toLowerCase();
    var ongoing = status === 'ongoing';
    var audience = (ev.audience || 'public').toLowerCase();
    var guildOnly = audience === 'guild_only';

    // Small audience hint so guild members can tell which bucket this pin is
    var audienceHint = guildOnly
      ? '<span class="pinned-banner-audience" title="Only Sindrian guild members can see this event">' +
          '\ud83d\udd12 Guild only' +
        '</span>'
      : '';

    // Full-state "when" text adapts based on status
    var whenText;
    if (ongoing) {
      whenText = ev.ends_at
        ? 'Ends ' + fmtDateTime(ev.ends_at)
        : 'Happening now';
    } else {
      whenText = ev.starts_at ? 'Starts ' + fmtDateTime(ev.starts_at) : '';
    }


    var startText = ongoing
      ? whenText
      : (ev.starts_at ? 'Starts ' + fmtDateTime(ev.starts_at) : '');

    var prizeText = formatPrizesShort(ev.prizes || []);
    var descHtml = renderDescriptionHtml(ev.description || '');

    var toggleLabel = collapsed ? 'Expand banner' : 'Collapse banner';
    var toggleBtn =
      '<button class="pinned-banner-toggle" type="button"' +
        ' aria-label="' + toggleLabel + '" title="' + toggleLabel + '"' +
        ' aria-expanded="' + (collapsed ? 'false' : 'true') + '">' +
        '<span class="pinned-banner-toggle-icon" aria-hidden="true">\u25B4</span>' +
      '</button>';


    return '<div class="pinned-banner-body">' +
        '<div class="pinned-banner-head">' +
          audienceHint +
          (whenText ? '<span class="pinned-banner-when">' + esc(whenText) + '</span>' : '') +
        '</div>' +
        '<button type="button" class="pinned-banner-title pinned-banner-title-link"' +
          ' data-event-id="' + esc(ev.id) + '"' +
          ' title="View on Events page">' +
          esc(ev.name || 'Untitled event') +
        '</button>' +
        (startText ? '<div class="pinned-banner-when pinned-banner-when--compact">' + esc(startText) + '</div>' : '') +
        (prizeText ? '<div class="pinned-banner-prize">\ud83c\udfc6 ' + esc(prizeText) + '</div>' : '') +
        (descHtml ? '<div class="pinned-banner-desc">' + descHtml + '</div>' : '') +
      '</div>' +
      toggleBtn;
  }

  function _bannerEnabled() {
    try {
      var s = JSON.parse(localStorage.getItem('esi_settings'));
      return !s || s.showPinnedBanner !== false;
    } catch (e) { return true; }
  }

  // Always show every pinned event - users can collapse rather than remove
  function pickEventsToShow() {
    if (!_bannerEnabled()) return [];
    return _events.slice();
  }

  function clearBanners() {
    if (_io) { _io.disconnect(); _io = null; }
    if (_meta) _meta.clear();
    // Remove the stack container
    var stacks = document.querySelectorAll('.' + STACK_CLASS);
    for (var i = 0; i < stacks.length; i++) {
      stacks[i].parentNode && stacks[i].parentNode.removeChild(stacks[i]);
    }
    var existing = document.querySelectorAll('.' + BANNER_CLASS);
    for (var j = 0; j < existing.length; j++) {
      existing[j].parentNode && existing[j].parentNode.removeChild(existing[j]);
    }
  }

  // True when one of the General-category panels is currently visible
  function isGeneralPanelActive() {
    for (var i = 0; i < GENERAL_PANELS.length; i++) {
      var p = document.getElementById(GENERAL_PANELS[i]);
      if (p && p.classList.contains('active')) return true;
    }
    return false;
  }

  function updateBannerVisibility() {
    var stack = document.querySelector('.' + STACK_CLASS);
    if (!stack) return;
    if (!_bannerEnabled()) { stack.style.display = 'none'; return; }
    var shown = isGeneralPanelActive();
    stack.style.display = shown ? 'flex' : 'none';
    if (shown) reportImpressions(stack);
  }

  function reportImpressions(stack) {
    var banners = stack.querySelectorAll('.' + BANNER_CLASS);
    for (var i = 0; i < banners.length; i++) {
      var meta = metaFor(banners[i]);
      if (meta.impression) continue;
      meta.impression = true;
      trackBanner('impression', banners[i].dataset.eventId, Date.now() - meta.at, banners[i]);
    }
  }

  function observeVisibility() {
    if (typeof IntersectionObserver === 'undefined') return null;
    if (_io) return _io;
    _io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.isIntersecting) continue;
        var meta = metaFor(entry.target);
        if (meta.visible) continue;
        meta.visible = true;
        trackBanner('visible', entry.target.dataset.eventId, Date.now() - meta.at, entry.target);
      }
    }, { threshold: 0.5 });
    return _io;
  }

  // Watch the panels' class attribute
  var _panelObserver = null;
  function watchPanelClassChanges() {
    if (_panelObserver || typeof MutationObserver === 'undefined') return;
    _panelObserver = new MutationObserver(updateBannerVisibility);
    var panels = document.querySelectorAll('.panel');
    panels.forEach(function (panel) {
      _panelObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });
    });
  }

  function injectBanners(events) {
    clearBanners();
    events = Array.isArray(events) ? events : [];
    if (!events.length) return;

    // Single fixed-positioned shell that all individual banners stack inside
    var stack = document.createElement('div');
    stack.className = STACK_CLASS;

    events.forEach(function (ev) {
      var banner = document.createElement('div');
      var status = (ev.status || 'upcoming').toLowerCase();
      var audience = (ev.audience || 'public').toLowerCase();
      var collapsed = isCollapsed(ev.id);
      banner.className = BANNER_CLASS +
        (status === 'ongoing' ? ' ' + BANNER_CLASS + '--ongoing' : '') +
        (audience === 'guild_only' ? ' ' + BANNER_CLASS + '--guild-only' : '') +
        (collapsed ? ' ' + COLLAPSED_MOD : '');
      banner.dataset.eventId = ev.id;
      banner.dataset.status   = status;
      banner.dataset.audience = audience;
      // ev fields are sanitised inside renderBannerHtml
      banner.innerHTML = renderBannerHtml(ev, collapsed);
      bindToggle(banner, ev);
      stack.appendChild(banner);
      var io = observeVisibility();
      if (io) io.observe(banner);
    });

    document.body.appendChild(stack);
    updateBannerVisibility();
    watchPanelClassChanges();
  }

  function bindToggle(banner, ev) {
    var titleBtn = banner.querySelector('.pinned-banner-title-link');
    if (titleBtn) {
      titleBtn.addEventListener('click', function () {
        trackBanner('click', ev.id, Date.now() - metaFor(banner).at, banner);
        if (typeof window.evpFocusEvent === 'function') {
          window.evpFocusEvent(ev.id);
        } else if (typeof window.switchToPanel === 'function') {
          window.switchToPanel('events');
        }
      });
    }

    var desc = banner.querySelector('.pinned-banner-desc');
    if (desc) {
      desc.addEventListener('click', function (event) {
        var anchor = event.target && event.target.closest
          ? event.target.closest('a')
          : null;
        if (!anchor) return;
        var href = anchor.getAttribute('href') || anchor.textContent || '';
        trackLink(href, /^https?:/i.test(href));
      });
    }

    var toggleBtn = banner.querySelector('.pinned-banner-toggle');
    if (!toggleBtn) return;
    toggleBtn.addEventListener('click', function () {
      var nextCollapsed = !banner.classList.contains(COLLAPSED_MOD);
      setCollapsed(ev.id, nextCollapsed);
      banner.classList.toggle(COLLAPSED_MOD, nextCollapsed);
      trackBanner(nextCollapsed ? 'collapse' : 'expand', ev.id, Date.now() - metaFor(banner).at, banner);
      var label = nextCollapsed ? 'Expand banner' : 'Collapse banner';
      toggleBtn.setAttribute('aria-label', label);
      toggleBtn.setAttribute('title', label);
      toggleBtn.setAttribute('aria-expanded', nextCollapsed ? 'false' : 'true');
    });
  }

  function refreshBanners() {
    injectBanners(pickEventsToShow());
  }

  function fetchPinned() {
    if (_loading) return;
    _loading = true;
    fetch('/api/events/pinned', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) {
        _events = Array.isArray(data) ? data : [];
        _fetched = true;
        // Clean up collapsed entries for events that aren't pinned anymore
        var pinnedIds = _events.map(function (e) { return e.id; });
        var collapsed = getCollapsed().filter(function (id) {
          return pinnedIds.indexOf(id) !== -1;
        });
        saveCollapsed(collapsed);
        refreshBanners();
      })
      .catch(function () { /* network errors are non-fatal */ })
      .finally(function () { _loading = false; });
  }

  // Initial fetch: wait for the React panels to be present in the DOM
  function bootstrap() {
    fetchPinned();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

  // events.js dispatches this event after pin/unpin so the banner refreshes
  window.addEventListener('esi:pinned-events-changed', fetchPinned);

  // Public API for debugging / settings UI
  window.esiPinnedBanner = {
    refresh: fetchPinned,
    applyVisibility: function () {
      if (_fetched) refreshBanners();
      else fetchPinned();
    },
    reset: function () {
      saveCollapsed([]);
      refreshBanners();
    },
  };
})();
