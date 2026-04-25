(function () {
  'use strict';

  // Panels under the "General" category that should display the banner
  var GENERAL_PANELS = ['panel-player', 'panel-guild', 'panel-bot'];
  // Persisted list of event IDs the user has dismissed
  var DISMISS_KEY    = 'esi.dismissedPins';
  var BANNER_CLASS   = 'pinned-banner';

  // Cached pinned-event list returned by /api/events/pinned
  var _events  = [];
  var _fetched = false;

  /* helpers */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getDismissed() {
    try {
      var raw = localStorage.getItem(DISMISS_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveDismissed(arr) {
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(arr));
    } catch (e) { /* storage might be disabled - just no-op */ }
  }

  function dismissEvent(eventId) {
    if (!eventId) return;
    var arr = getDismissed();
    if (arr.indexOf(eventId) === -1) {
      arr.push(eventId);
      saveDismissed(arr);
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

  // Sanitised rendering of the event description
  function renderDescriptionHtml(src) {
    if (!src) return '';
    var rendered = typeof window.renderMarkdown === 'function'
      ? window.renderMarkdown(src)
      : esc(src).replace(/\n/g, '<br>');
    if (typeof DOMPurify !== 'undefined') {
      return DOMPurify.sanitize(rendered, {
        ADD_TAGS: ['details', 'summary'],
        ADD_ATTR: ['target', 'rel'],
      });
    }
    // DOMPurify hasn't loaded yet - fall back to plain escaped text
    return esc(src).replace(/\n/g, '<br>');
  }

  function renderBannerHtml(ev) {
    var status = (ev.status || 'upcoming').toLowerCase();
    var ongoing = status === 'ongoing';

    // Eyebrow + time text adapt based on status
    var eyebrow;
    if (ongoing) {
      eyebrow = '<span class="pinned-banner-eyebrow pinned-banner-eyebrow--live">' +
        '<span class="pinned-banner-live-dot" aria-hidden="true"></span>' +
        'Live now' +
      '</span>';
    } else {
      eyebrow = '<span class="pinned-banner-eyebrow">Pinned event</span>';
    }

    var whenText;
    if (ongoing) {
      whenText = ev.ends_at
        ? 'Ends ' + fmtDateTime(ev.ends_at)
        : 'Happening now';
    } else {
      whenText = ev.starts_at ? 'Starts ' + fmtDateTime(ev.starts_at) : '';
    }

    var prizeText = formatPrizesShort(ev.prizes || []);
    var descHtml = renderDescriptionHtml(ev.description || '');

    return '<div class="pinned-banner-body">' +
        '<div class="pinned-banner-head">' +
          eyebrow +
          (whenText ? '<span class="pinned-banner-when">' + esc(whenText) + '</span>' : '') +
        '</div>' +
        '<div class="pinned-banner-title">' + esc(ev.name || 'Untitled event') + '</div>' +
        (prizeText ? '<div class="pinned-banner-prize">\ud83c\udfc6 ' + esc(prizeText) + '</div>' : '') +
        (descHtml ? '<div class="pinned-banner-desc">' + descHtml + '</div>' : '') +
      '</div>' +
      '<button class="pinned-banner-close" type="button" aria-label="Dismiss banner" title="Dismiss">\u2715</button>';
  }

  // Find the first non-dismissed pinned event, or null
  function pickEventToShow() {
    if (!_events.length) return null;
    var dismissed = getDismissed();
    for (var i = 0; i < _events.length; i++) {
      if (dismissed.indexOf(_events[i].id) === -1) return _events[i];
    }
    return null;
  }

  function clearBanners() {
    var existing = document.querySelectorAll('.' + BANNER_CLASS);
    for (var i = 0; i < existing.length; i++) {
      existing[i].parentNode && existing[i].parentNode.removeChild(existing[i]);
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
    var banner = document.querySelector('.' + BANNER_CLASS);
    if (!banner) return;
    banner.style.display = isGeneralPanelActive() ? 'flex' : 'none';
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

  function injectBanners(ev) {
    clearBanners();
    if (!ev) return;
    var banner = document.createElement('div');
    var status = (ev.status || 'upcoming').toLowerCase();
    banner.className = BANNER_CLASS +
      (status === 'ongoing' ? ' ' + BANNER_CLASS + '--ongoing' : '');
    banner.dataset.eventId = ev.id;
    banner.dataset.status   = status;
    // ev fields are sanitised inside renderBannerHtml
    banner.innerHTML = renderBannerHtml(ev);
    var closeBtn = banner.querySelector('.pinned-banner-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function () {
        dismissEvent(ev.id);
        // After dismissing, attempt to show the next non-dismissed pin
        injectBanners(pickEventToShow());
      });
    }
    document.body.appendChild(banner);
    updateBannerVisibility();
    watchPanelClassChanges();
  }

  function refreshBanners() {
    injectBanners(pickEventToShow());
  }

  function fetchPinned() {
    return fetch('/api/events/pinned', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) {
        _events = Array.isArray(data) ? data : [];
        _fetched = true;
        // Clean up dismissed entries for events that aren't pinned anymore
        var pinnedIds = _events.map(function (e) { return e.id; });
        var dismissed = getDismissed().filter(function (id) {
          return pinnedIds.indexOf(id) !== -1;
        });
        saveDismissed(dismissed);
        refreshBanners();
      })
      .catch(function () { /* network errors are non-fatal */ });
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
      saveDismissed([]);
      refreshBanners();
    },
  };
})();
