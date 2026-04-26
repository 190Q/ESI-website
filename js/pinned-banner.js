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

  function fmtDateTime(iso) {
    if (!iso) return '';
    var d;
    if (typeof iso === 'number') {
      d = new Date(iso * 1000);
    } else {
      d = new Date(iso);
    }
    if (isNaN(d.getTime())) return esc(iso);
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
      var pos = Number(p.position) || 1;
      if (!byPos[pos]) byPos[pos] = [];
      byPos[pos].push(p);
    });
    var positions = Object.keys(byPos).map(Number).sort(function (a, b) { return a - b; });
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
    return ordinal(positions[0]) + ' place: ' + summary + more;
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

  // Always show every pinned event - users can collapse rather than remove
  function pickEventsToShow() {
    return _events.slice();
  }

  function clearBanners() {
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
    stack.style.display = isGeneralPanelActive() ? 'flex' : 'none';
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
    });

    document.body.appendChild(stack);
    updateBannerVisibility();
    watchPanelClassChanges();
  }

  function bindToggle(banner, ev) {
    var titleBtn = banner.querySelector('.pinned-banner-title-link');
    if (titleBtn) {
      titleBtn.addEventListener('click', function () {
        if (typeof window.evpFocusEvent === 'function') {
          window.evpFocusEvent(ev.id);
        } else if (typeof window.switchToPanel === 'function') {
          window.switchToPanel('events');
        }
      });
    }

    var toggleBtn = banner.querySelector('.pinned-banner-toggle');
    if (!toggleBtn) return;
    toggleBtn.addEventListener('click', function () {
      var nextCollapsed = !banner.classList.contains(COLLAPSED_MOD);
      setCollapsed(ev.id, nextCollapsed);
      banner.classList.toggle(COLLAPSED_MOD, nextCollapsed);
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
    reset: function () {
      saveCollapsed([]);
      refreshBanners();
    },
  };
})();
