(function () {
  'use strict';

  // All known statuses
  var STATUSES = [
    { value: 'upcoming',  label: 'Upcoming'  },
    { value: 'ongoing',   label: 'Ongoing'   },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];
  var TAB_STATUSES = [
    { value: 'upcoming',  label: 'Upcoming'  },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  var _events       = [];
  var _activeStatus = 'upcoming';
  var _loading      = false;
  var _fetched      = false;
  var _activeToast  = null;

  var panel = document.getElementById('panel-events');
  if (!panel) return;

  // If the panel becomes active and we have no shell yet, make sure it gets one
  var observer = new MutationObserver(function () {
    if (!panel.classList.contains('active')) return;
    if (!_fetched) {
      loadEvents();
    } else if (!document.getElementById('evpShell')) {
      buildShell();
    }
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['class'] });


  loadEvents();

  // Refresh after admins pin/unpin so the "Pinned" highlight stays in sync
  window.addEventListener('esi:pinned-events-changed', function () {
    loadEvents();
  });

  setInterval(function () { loadEvents(); }, 60 * 1000);

  /* helpers */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
      day: 'numeric', month: 'short', year: 'numeric',
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

  function placeLabel(n) {
    return ordinal(n) + ' place';
  }

  function statusLabel(status) {
    for (var i = 0; i < STATUSES.length; i++) {
      if (STATUSES[i].value === status) return STATUSES[i].label;
    }
    return 'Upcoming';
  }

  function prizeTypeLabel(type) {
    if (type === 'esi_points') return 'ESI Points';
    if (type === 'item')       return 'Item';
    return 'Other';
  }

  function formatPrizeValue(p) {
    if (!p) return '';
    if (p.type === 'esi_points') {
      var n = Number(p.value || 0);
      if (!n) return 'ESI Points';
      return n.toLocaleString() + ' ESI Points';
    }
    if (p.type === 'item') {
      return p.value ? esc(p.value) : 'Item';
    }
    return p.value ? esc(p.value) : 'Other';
  }

  function groupPrizesByPosition(prizes) {
    var groups = {};
    (prizes || []).forEach(function (p) {
      if (!p) return;
      var pos = Number(p.position) || 1;
      if (!groups[pos]) groups[pos] = [];
      groups[pos].push(p);
    });
    return Object.keys(groups)
      .map(Number)
      .sort(function (a, b) { return a - b; })
      .map(function (pos) { return { position: pos, prizes: groups[pos] }; });
  }

  // Auto-link bare http(s)/www URLs by rewriting them into [url](url)
  function autoLinkBareUrls(src) {
    if (!src) return src;
    var BARE_URL_RE = /(\bhttps?:\/\/[^\s<>)\]'"]+)/g;
    var WWW_URL_RE  = /(^|[\s(])(www\.[^\s<>)\]'"]+)/g;
    var SPLIT_RE = /(```[\s\S]*?```|`[^`]+`|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))/g;
    var parts = src.split(SPLIT_RE);
    return parts.map(function (part, idx) {
      if (idx % 2 === 1) return part;
      return part
        .replace(BARE_URL_RE, '[$1]($1)')
        .replace(WWW_URL_RE, '$1[$2](https://$2)');
    }).join('');
  }

  // Render markdown safely via DOMPurify (per project rule)
  function renderDescription(src) {
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
    return rendered;
  }

  // Speaker icon used for the Discord-style voice-channel pill
  function voiceIconSvg() {
    return '<svg class="ev-vc-icon" viewBox="0 0 24 24" width="13" height="13"' +
      ' fill="currentColor" aria-hidden="true">' +
      '<path d="M3 10v4a1 1 0 0 0 1 1h3l5 4V5L7 9H4a1 1 0 0 0-1 1z"/>' +
      '<path d="M16.5 12a4.5 4.5 0 0 0-2.25-3.9v7.8A4.5 4.5 0 0 0 16.5 12z" opacity="0.9"/>' +
      '</svg>';
  }

  function channelDiscordUrl(channelId) {
    var gid = window.ESI_DISCORD_GUILD_ID || '';
    if (!gid || !channelId) return '';
    return 'https://discord.com/channels/' + gid + '/' + channelId;
  }

  /* data */

  function loadEvents() {
    if (_loading) return;
    _loading = true;

    var hasShell = !!document.getElementById('evpShell');

    // Show a loading placeholder shell on the very first load
    if (!hasShell && !_fetched) buildLoadingShell();

    if (_activeToast) { _activeToast.dismiss(); _activeToast = null; }
    var toast = null;
    if (!_fetched && typeof window.showProgressToast === 'function') {
      toast = window.showProgressToast('Fetching events\u2026');
      _activeToast = toast;
      toast.addItem('api', 'Events API');
    }
    var msgs = {
      success: '\u2713 Events loaded',
      fail:    '\u2715 Failed to load events',
    };

    fetch('/api/events/public', { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) {
          if (toast) { toast.updateItem('api', 'error'); toast.finish(msgs); }
          return null;
        }
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        _events = Array.isArray(data) ? data : [];
        _fetched = true;
        updateOngoingIndicator();
        // Always render once data is in
        if (!document.getElementById('evpShell')) buildShell();
        else { renderTabs(); renderList(); }
        if (toast) { toast.updateItem('api', 'success'); toast.finish(msgs); }
      })
      .catch(function () {
        if (toast) { toast.updateItem('api', 'error'); toast.finish(msgs); }
      })
      .finally(function () { _loading = false; });
  }

  // Minimal placeholder rendered while the first fetch is in flight
  function buildLoadingShell() {
    panel.innerHTML =
      '<div class="panel-header">' +
        '<h1 class="panel-title">Events</h1>' +
        '<p class="panel-subtitle">Upcoming, ongoing, and past Sindrian events</p>' +
      '</div>' +
      '<div class="inac-empty" style="font-style:italic;">Loading events\u2026</div>';
  }

  /* sidebar live indicator */

  function updateOngoingIndicator() {
    var navItem = document.querySelector('.nav-item[data-panel="events"]');
    if (!navItem) return;
    var hasOngoing = _events.some(function (ev) {
      return (ev.status || '').toLowerCase() === 'ongoing';
    });
    navItem.classList.toggle('nav-item-has-ongoing', hasOngoing);
  }

  /* shell */

  function buildShell() {
    panel.innerHTML =
      '<div class="panel-header" id="evpShell">' +
        '<h1 class="panel-title">Events</h1>' +
        '<p class="panel-subtitle">Upcoming, ongoing, and past Sindrian events</p>' +
      '</div>' +
      '<div id="evpTopSections"></div>' +
      '<div class="evp-tabs view-selector" id="evpTabs"></div>' +
      '<div class="evp-list-wrap">' +
        '<div id="evpList"></div>' +
      '</div>';

    // Pick the first non-empty tab as the default
    var counts = countByStatus(_filterTabEvents);
    var defaultTab = TAB_STATUSES[0].value;
    for (var i = 0; i < TAB_STATUSES.length; i++) {
      if (counts[TAB_STATUSES[i].value] > 0) { defaultTab = TAB_STATUSES[i].value; break; }
    }
    _activeStatus = defaultTab;

    renderTabs();
    renderList();
  }

  // Events that should be shown inside the tab area
  function _filterTabEvents() {
    return _events.filter(function (ev) {
      if (ev.pinned) return false;
      var st = (ev.status || 'upcoming').toLowerCase();
      if (st === 'ongoing') return false;
      return true;
    });
  }

  // Count events by status
  function countByStatus(source) {
    var counts = { upcoming: 0, ongoing: 0, completed: 0, cancelled: 0 };
    var list = typeof source === 'function' ? source() : _events;
    list.forEach(function (ev) {
      var st = (ev.status || 'upcoming').toLowerCase();
      if (counts[st] === undefined) counts[st] = 0;
      counts[st] += 1;
    });
    return counts;
  }

  function renderTabs() {
    var tabsEl = document.getElementById('evpTabs');
    if (!tabsEl) return;
    var counts = countByStatus(_filterTabEvents);
    tabsEl.innerHTML = TAB_STATUSES.map(function (s) {
      var cls = 'view-btn evp-tab evp-tab-' + s.value +
        (s.value === _activeStatus ? ' active' : '');
      var count = counts[s.value] || 0;
      return '<button type="button" class="' + cls + '"' +
        ' data-status="' + esc(s.value) + '">' +
        esc(s.label) +
        ' <span class="evp-tab-count">' + count + '</span>' +
      '</button>';
    }).join('');
    tabsEl.querySelectorAll('[data-status]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _activeStatus = this.dataset.status;
        renderTabs();
        renderList();
      });
    });
  }

  /* list */


  function renderEventCard(ev) {
      var status   = (ev.status || 'upcoming').toLowerCase();
      var creator  = (ev.created_by || {}).username || '';
      var starts   = ev.starts_at ? fmtDateTime(ev.starts_at) : '';
      var ends     = ev.ends_at   ? fmtDateTime(ev.ends_at)   : '';
      var prizes   = Array.isArray(ev.prizes) ? ev.prizes : [];
      var hasPrize = prizes.length > 0;
      var location = ev.location || '';
      var maxP     = Number(ev.max_participants || 0);
      var isPinned = !!ev.pinned;

      var whenBits = [];
      if (starts) whenBits.push('Starts ' + starts);
      if (ends)   whenBits.push('Ends '   + ends);
      var whenHtml = whenBits.length
        ? '<span class="ev-when">' + whenBits.join(' \u00b7 ') + '</span>'
        : '';

      var channelId = ev.location_channel_id || '';
      var vcUrl     = channelId ? channelDiscordUrl(channelId) : '';
      var vcName    = ev.location || '';

      var metaBits = [];
      if (channelId && vcUrl) {
        metaBits.push(
          '<a class="ev-vc-pill" href="' + esc(vcUrl) + '" target="_blank" rel="noopener"' +
            ' title="Open voice channel in Discord">' +
            voiceIconSvg() +
            '<span>' + esc((vcName || '').replace(/^#/, '')) + '</span>' +
          '</a>'
        );
      } else if (location) {
        metaBits.push('\ud83d\udccd ' + esc(location));
      }
      if (maxP)    metaBits.push('\ud83d\udc65 Max ' + maxP);
      if (creator) metaBits.push('By ' + esc(creator));

      // Group prizes by place so each placement gets its own line
      var prizeGroups = groupPrizesByPosition(prizes);
      var groupsHtml = prizeGroups.map(function (g) {
        var badges = g.prizes.map(function (p) {
          var typeKey = p.type || 'other';
          return '<span class="ev-prize-badge ev-prize-' + esc(typeKey) + '">' +
            '\ud83c\udfc6 ' + esc(prizeTypeLabel(typeKey)) +
            ': ' + formatPrizeValue(p) +
          '</span>';
        }).join('');
        return '<div class="ev-prize-group">' +
          '<span class="ev-prize-place">' + esc(placeLabel(g.position)) + '</span>' +
          '<div class="ev-prize-badges">' + badges + '</div>' +
        '</div>';
      }).join('');

      var descsHtml = prizes
        .filter(function (p) { return p && p.description; })
        .map(function (p) {
          return '<div class="ev-prize-desc">' +
            '<span class="ev-prize-desc-label">' +
              esc(placeLabel(p.position || 1) + ' \u00b7 ' + prizeTypeLabel(p.type)) +
            '</span>' +
            renderDescription(p.description) +
          '</div>';
        }).join('');

      var prizesHtml = hasPrize
        ? '<div class="ev-prizes">' + groupsHtml + '</div>' + descsHtml
        : '<div class="ev-meta-row">' +
            '<span class="ev-prize-badge ev-prize-none">No prize</span>' +
          '</div>';

      var pinnedBadgeHtml = isPinned
        ? '<span class="ev-pinned-badge" title="This event is pinned">\ud83d\udccc Pinned</span>'
        : '';

      var audience = (ev.audience || 'public').toLowerCase();
      var audienceBadgeHtml = audience === 'guild_only'
        ? '<span class="ev-audience-badge ev-audience-guild_only"' +
          ' title="Only Sindrian guild members can see this event">' +
          '\ud83d\udd12 Guild only</span>'
        : '';

      return '<div class="ev-row' + (isPinned ? ' ev-row-pinned' : '') + '">' +
        '<div class="ev-row-head">' +
          '<span class="ev-status ev-status-' + esc(status) + '">' + esc(statusLabel(status)) + '</span>' +
          pinnedBadgeHtml +
          audienceBadgeHtml +
          '<span class="ev-name">' + esc(ev.name || '(untitled)') + '</span>' +
        '</div>' +
        (ev.description
          ? '<div class="ev-description ticket-preview-content">' + renderDescription(ev.description) + '</div>'
          : '') +
        prizesHtml +
        (whenHtml ? '<div class="ev-meta-row">' + whenHtml + '</div>' : '') +
        (metaBits.length ? '<div class="ev-sub-meta">' + metaBits.join(' \u00b7 ') + '</div>' : '') +
      '</div>';
  }


  function renderTopSections() {
    var topEl = document.getElementById('evpTopSections');
    if (!topEl) return;

    var pinned = _events.filter(function (ev) { return !!ev.pinned; });
    var pinnedIds = pinned.map(function (ev) { return ev.id; });
    var ongoing = _events.filter(function (ev) {
      if (pinnedIds.indexOf(ev.id) !== -1) return false;
      return (ev.status || '').toLowerCase() === 'ongoing';
    });

    var html = '';
    if (pinned.length) {
      html +=
        '<section class="evp-section evp-section-pinned">' +
          '<h2 class="evp-section-title evp-section-title-pinned">' +
            '\ud83d\udccc Pinned' +
          '</h2>' +
          '<div class="evp-section-body">' +
            pinned.map(renderEventCard).join('') +
          '</div>' +
        '</section>';
    }
    if (ongoing.length) {
      html +=
        '<section class="evp-section evp-section-ongoing">' +
          '<h2 class="evp-section-title evp-section-title-ongoing">' +
            '<span class="evp-live-dot" aria-hidden="true"></span> Ongoing' +
          '</h2>' +
          '<div class="evp-section-body">' +
            ongoing.map(renderEventCard).join('') +
          '</div>' +
        '</section>';
    }

    topEl.innerHTML = html;
  }

  function renderList() {
    renderTopSections();

    var listEl = document.getElementById('evpList');
    if (!listEl) return;

    var tabEvents = _filterTabEvents().filter(function (ev) {
      return (ev.status || 'upcoming').toLowerCase() === _activeStatus;
    });

    if (tabEvents.length) {
      listEl.innerHTML =
        '<div class="evp-section-body">' +
          tabEvents.map(renderEventCard).join('') +
        '</div>';
    } else {
      listEl.innerHTML =
        '<div class="inac-empty" style="font-weight:500;">' +
          'No ' + esc(statusLabel(_activeStatus).toLowerCase()) + ' events.' +
        '</div>';
    }
  }
})();
