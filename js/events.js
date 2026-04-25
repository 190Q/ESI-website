(function () {
  'use strict';

  var STATUSES = [
    { value: 'upcoming',  label: 'Upcoming'  },
    { value: 'ongoing',   label: 'Ongoing'   },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  var AUDIENCES = [
    { value: 'public',     label: 'Public (anyone can view)' },
    { value: 'guild_only', label: 'Sindrian guild members only' },
  ];

  var PRIZE_TYPES = [
    { value: 'esi_points', label: 'ESI Points' },
    { value: 'item',       label: 'Item'       },
    { value: 'other',      label: 'Other'      },
  ];

  var _prizeRowSeq = 0;

  var _events         = [];
  var _editingId      = null;
  var _loading        = false;
  var _fetched        = false;
  var _activeToast    = null;
  var _voiceChannels  = [];
  var _voiceFetched   = false;

  // Persisted collapse state for the manage-events status sections
  var COLLAPSE_KEY = 'esi.eventsManageCollapse';
  var _collapsed = (function () {
    try {
      var raw = localStorage.getItem(COLLAPSE_KEY);
      var parsed = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (e) { /* ignore */ }
    return { upcoming: false, completed: true, cancelled: true };
  })();

  function saveCollapsed() {
    try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(_collapsed)); } catch (e) { /* ignore */ }
  }

  var panel = document.getElementById('panel-events-manage');

  var observer = new MutationObserver(function () {
    if (panel.classList.contains('active')) loadEvents();
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  if (panel.classList.contains('active')) loadEvents();

  // re-trigger a load on login (wired from app.js / session refresh)
  window.eventsOnLogin = function () {
    _loading = false;
    _fetched = false;
    if (panel.classList.contains('active')) loadEvents();
  };

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
    // accept both ISO strings and unix epoch seconds
    var d;
    if (typeof iso === 'number') {
      d = new Date(iso * 1000);
    } else {
      // `datetime-local` input gives us "YYYY-MM-DDTHH:MM" with no timezone:
      // treat those as local time.
      d = new Date(iso);
    }
    if (isNaN(d.getTime())) return esc(iso);
    return d.toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  function isoToDatetimeLocal(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
      + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function prizeTypeLabel(type) {
    for (var i = 0; i < PRIZE_TYPES.length; i++) {
      if (PRIZE_TYPES[i].value === type) return PRIZE_TYPES[i].label;
    }
    return 'Other';
  }

  function statusLabel(status) {
    for (var i = 0; i < STATUSES.length; i++) {
      if (STATUSES[i].value === status) return STATUSES[i].label;
    }
    return 'Upcoming';
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

  // Group prizes by their position so the list view can show one row per place
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
      if (idx % 2 === 1) return part; // preserved token
      return part
        .replace(BARE_URL_RE, '[$1]($1)')
        .replace(WWW_URL_RE, '$1[$2](https://$2)');
    }).join('');
  }

  // Render the given markdown source into sanitised HTML for display
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

  // Build the Write/Preview editor markup for a description field
  function buildMdEditor(opts) {
    var idBase     = opts.idBase;
    var textareaId = opts.textareaId;
    return '<div class="ticket-editor ev-md-editor" data-md-editor="' + esc(idBase) + '">' +
      '<div class="ticket-tabs">' +
        '<button type="button" class="ticket-tab active" data-md-tab="write">Write</button>' +
        '<button type="button" class="ticket-tab"        data-md-tab="preview">Preview</button>' +
      '</div>' +
      '<div class="ticket-write-pane" data-md-pane="write">' +
        '<textarea class="ticket-textarea ticket-body ev-md-textarea"' +
          ' id="' + esc(textareaId) + '"' +
          ' rows="' + (opts.rows || 4) + '"' +
          (opts.maxlength ? ' maxlength="' + opts.maxlength + '"' : '') +
          ' placeholder="' + esc(opts.placeholder || '') + '"' +
          ' aria-label="' + esc(opts.ariaLabel || opts.placeholder || 'Description') + '"></textarea>' +
      '</div>' +
      '<div class="ticket-preview-pane ev-md-preview-pane" data-md-pane="preview" style="display:none">' +
        '<div class="ticket-preview-content" data-md-preview>' +
          '<p class="ticket-preview-empty">Nothing to preview</p>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  // Wire up the Write/Preview tabs for a single editor container
  function wireMdEditor(editorEl) {
    if (!editorEl) return;
    var tabs     = editorEl.querySelectorAll('[data-md-tab]');
    var writePane   = editorEl.querySelector('[data-md-pane="write"]');
    var previewPane = editorEl.querySelector('[data-md-pane="preview"]');
    var previewEl   = editorEl.querySelector('[data-md-preview]');
    var textarea    = editorEl.querySelector('textarea');

    function setTab(name) {
      tabs.forEach(function (t) {
        t.classList.toggle('active', t.dataset.mdTab === name);
      });
      if (name === 'preview') {
        var taHeight = textarea ? textarea.offsetHeight : 0;
        var src = textarea ? textarea.value : '';
        if (src.trim()) {
          previewEl.innerHTML = renderDescription(src);
        } else {
          previewEl.innerHTML = '<p class="ticket-preview-empty">Nothing to preview</p>';
        }
        writePane.style.display   = 'none';
        previewPane.style.display = '';
        if (taHeight) previewPane.style.minHeight = taHeight + 'px';
      } else {
        writePane.style.display   = '';
        previewPane.style.display = 'none';
      }
    }

    tabs.forEach(function (t) {
      t.addEventListener('click', function () { setTab(t.dataset.mdTab); });
    });
  }

  /* voice channel list */

  function ensureVoiceChannels() {
    if (_voiceFetched) return;
    _voiceFetched = true;
    fetch('/api/discord/voice-channels', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : []; })
      .then(function (data) {
        _voiceChannels = Array.isArray(data) ? data : [];
        updateVoiceChannelDatalist();
      })
      .catch(function () {
        _voiceFetched = false;
      });
  }

  function updateVoiceChannelDatalist() {
    var dl = document.getElementById('evVoiceChannelList');
    if (!dl) return;
    if (!_voiceChannels.length) {
      dl.innerHTML = '';
      return;
    }
    dl.innerHTML = _voiceChannels.map(function (c) {
      var value = '#' + (c.name || '');
      return '<option value="' + esc(value) + '"></option>';
    }).join('');
    syncLocationVoiceStyle();
  }

  // Return the voice channel matching the current location input value
  function matchLocationChannel(value) {
    var raw = (value == null ? '' : String(value)).trim();
    if (!raw || !_voiceChannels.length) return null;
    var norm = raw.replace(/^#/, '').trim().toLowerCase();
    if (!norm) return null;
    for (var i = 0; i < _voiceChannels.length; i++) {
      if ((_voiceChannels[i].name || '').toLowerCase() === norm) {
        return _voiceChannels[i];
      }
    }
    return null;
  }

  // Build a Discord deep-link URL for a voice channel id.
  function channelDiscordUrl(channelId) {
    var gid = window.ESI_DISCORD_GUILD_ID || '';
    if (!gid || !channelId) return '';
    return 'https://discord.com/channels/' + gid + '/' + channelId;
  }

  // Speaker icon used for the Discord-style voice-channel pill
  function voiceIconSvg() {
    return '<svg class="ev-vc-icon" viewBox="0 0 24 24" width="13" height="13"' +
      ' fill="currentColor" aria-hidden="true">' +
      '<path d="M3 10v4a1 1 0 0 0 1 1h3l5 4V5L7 9H4a1 1 0 0 0-1 1z"/>' +
      '<path d="M16.5 12a4.5 4.5 0 0 0-2.25-3.9v7.8A4.5 4.5 0 0 0 16.5 12z" opacity="0.9"/>' +
      '</svg>';
  }

  // Toggle the Discord-pill style on the Location input
  function syncLocationVoiceStyle() {
    var el = document.getElementById('evLocation');
    if (!el) return;
    var raw = (el.value || '').trim();
    var match = matchLocationChannel(raw);
    if (match) {
      el.classList.add('ev-location-voice');
      el.dataset.channelId = match.id || '';
      delete el.dataset.channelExpect;
      // normalise display to '#name' so it always shows with the prefix
      var desired = '#' + match.name;
      if (el.value !== desired) el.value = desired;
      return;
    }
    if (raw && el.dataset.channelExpect && raw === el.dataset.channelExpect
        && el.dataset.channelId) {
      el.classList.add('ev-location-voice');
      return;
    }
    el.classList.remove('ev-location-voice');
    delete el.dataset.channelId;
    delete el.dataset.channelExpect;
  }

  /* data fetch */

  function loadEvents() {
    if (_loading) return;
    _loading = true;

    var hasShell = !!document.getElementById('evShell');

    // Show a placeholder header on the first load
    if (!hasShell && !_fetched) renderLoadingShell();

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

    fetch('/api/events', { credentials: 'same-origin' })
      .then(function (r) {
        if (!r.ok) {
          if (!hasShell) renderGate(r.status);
          if (toast) { toast.updateItem('api', 'error'); toast.finish(msgs); }
          return null;
        }
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        _events = Array.isArray(data) ? data : [];
        if (!document.getElementById('evShell')) buildShell();
        else {
          renderList();
        }
        if (toast) { toast.updateItem('api', 'success'); toast.finish(msgs); }
        _fetched = true;
      })
      .catch(function () {
        if (toast) { toast.updateItem('api', 'error'); toast.finish(msgs); }
        if (!hasShell) renderGate(0);
      })
      .finally(function () { _loading = false; });
  }

  // Minimal placeholder rendered while the first fetch is in flight
  function renderLoadingShell() {
    panel.innerHTML =
      '<div class="panel-header">' +
        '<h1 class="panel-title">Manage Events</h1>' +
        '<p class="panel-subtitle">Plan and run guild events</p>' +
      '</div>' +
      '<div class="inac-empty" style="font-style:italic;">Loading events\u2026</div>';
  }

  /* login / permission gate */

  function renderGate(status) {
    var loggedIn = window.state && window.state.loggedIn;
    var msg = !loggedIn
      ? 'You must be logged in to access this page.'
      : (status === 403
          ? 'You do not have permission to view this page.'
          : 'Failed to load data. Please try again.');
    panel.innerHTML =
      '<div class="panel-header">' +
        '<h1 class="panel-title">Manage Events</h1>' +
        '<p class="panel-subtitle">Plan and run guild events</p>' +
      '</div>' +
      '<div class="inac-empty">' + esc(msg) + '</div>';
  }

  /* shell */

  function buildShell() {
    panel.innerHTML =
      '<div class="panel-header" id="evShell">' +
        '<h1 class="panel-title">Manage Events</h1>' +
        '<p class="panel-subtitle">Plan and run guild events</p>' +
      '</div>' +
      '<div class="ev-split-layout">' +
        '<div class="ev-left-col">' +
          '<div class="info-card">' +
            '<div class="info-card-header" id="evFormHeader">Create Event</div>' +
            buildFormHtml() +
          '</div>' +
        '</div>' +
        '<div class="ev-right-col">' +
          '<div class="info-card">' +
            '<div class="info-card-header">Events ' +
              '<span id="evCount" style="color:var(--text-faint);font-size:0.85em;font-family:\'Crimson Pro\',serif"></span>' +
            '</div>' +
            '<div id="evList"></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    wireForm();
    renderList();
  }

  function audienceLabel(value) {
    for (var i = 0; i < AUDIENCES.length; i++) {
      if (AUDIENCES[i].value === value) return AUDIENCES[i].label;
    }
    return AUDIENCES[0].label;
  }

  function buildFormHtml() {
    var statusOpts = STATUSES.map(function (s) {
      return '<option value="' + esc(s.value) + '">' + esc(s.label) + '</option>';
    }).join('');
    var audienceOpts = AUDIENCES.map(function (a) {
      return '<option value="' + esc(a.value) + '">' + esc(a.label) + '</option>';
    }).join('');

    return '<div class="ev-form" id="evForm">' +
      '<div class="ev-field ev-discord-import">' +
        '<label class="inac-label" for="evDiscordImport">Import from Discord event link <span class="ev-discord-import-hint">(optional)</span></label>' +
        '<div class="ev-discord-import-row">' +
          '<input type="text" class="inac-input ev-discord-import-input" id="evDiscordImport"' +
            ' placeholder="Paste a Discord event link to autofill\u2026"' +
            ' aria-label="Discord event link" autocomplete="off" spellcheck="false" />' +
          '<button type="button" class="ev-discord-import-btn"' +
            ' id="evDiscordImportBtn"' +
            ' aria-label="Import from Discord link"' +
            ' title="Import from Discord link">' +
            '<svg class="ev-discord-import-icon" viewBox="0 0 16 16" width="15" height="15"' +
              ' fill="none" stroke="currentColor" stroke-width="1.6"' +
              ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
              '<path d="M8 2v8" />' +
              '<path d="M4.5 6.5L8 10l3.5-3.5" />' +
              '<path d="M3 13h10" />' +
            '</svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="ev-field">' +
        '<label class="inac-label" for="evName">Name</label>' +
        '<input type="text" class="inac-input" id="evName" maxlength="120" placeholder="e.g. Movie Night" aria-label="Event name" />' +
      '</div>' +
      '<div class="ev-field">' +
        '<label class="inac-label" for="evDescription">Description</label>' +
        buildMdEditor({
          idBase:     'evDescription',
          textareaId: 'evDescription',
          rows:       5,
          maxlength:  4000,
          placeholder:'What is this event about?',
          ariaLabel:  'Event description',
        }) +
      '</div>' +
      '<div class="ev-grid-2">' +
        '<div class="ev-field">' +
          '<label class="inac-label" for="evStartsAt">Starts at</label>' +
          '<input type="datetime-local" class="inac-input" id="evStartsAt" aria-label="Starts at" />' +
        '</div>' +
        '<div class="ev-field">' +
          '<label class="inac-label" for="evEndsAt">Ends at</label>' +
          '<input type="datetime-local" class="inac-input" id="evEndsAt" aria-label="Ends at" />' +
        '</div>' +
      '</div>' +
      '<div class="ev-grid-2">' +
        '<div class="ev-field">' +
          '<label class="inac-label" for="evLocation">Location / Voice channel</label>' +
          '<input type="text" class="inac-input" id="evLocation" maxlength="200"' +
            ' placeholder="Pick a voice channel or type a custom location\u2026"' +
            ' list="evVoiceChannelList" aria-label="Location or voice channel" />' +
          '<datalist id="evVoiceChannelList"></datalist>' +
        '</div>' +
        '<div class="ev-field">' +
          '<label class="inac-label" for="evMaxParticipants">Max participants</label>' +
          '<input type="number" class="inac-input" id="evMaxParticipants" min="0" step="1" placeholder="0 = unlimited" aria-label="Max participants" />' +
        '</div>' +
      '</div>' +
      '<div class="ev-field ev-prizes-field">' +
        '<div class="ev-prizes-header">' +
          '<label class="inac-label">Prizes</label>' +
          '<button type="button" class="inac-btn inac-btn-secondary ev-add-prize-btn" id="evAddPrize" aria-label="Add prize">+ Add Prize</button>' +
        '</div>' +
        '<p class="ev-prizes-hint" style="font-weight:500;">Use the place number to set ranking (1 = top, 2 = second, etc). Add multiple rows with the same place to give one person several rewards.</p>' +
        '<div class="ev-prize-list" id="evPrizeList"></div>' +
        '<p class="ev-prize-empty" id="evPrizeEmpty">No prizes set. Click "Add Prize" to add one.</p>' +
      '</div>' +
      '<div class="ev-grid-2">' +
        '<div class="ev-field">' +
          '<label class="inac-label" for="evStatus">Status</label>' +
          '<select class="inac-input ev-select" id="evStatus" aria-label="Event status">' + statusOpts + '</select>' +
        '</div>' +
        '<div class="ev-field">' +
          '<label class="inac-label" for="evAudience">Audience</label>' +
          '<select class="inac-input ev-select" id="evAudience" aria-label="Who can see this event">' + audienceOpts + '</select>' +
        '</div>' +
      '</div>' +
      '<div id="evBtnRow" class="ev-btn-row">' +
        '<button class="inac-btn inac-btn-approve" id="evSubmit" style="flex:1;justify-content:center">Create Event</button>' +
      '</div>' +
    '</div>';
  }

  // Build markup for a single prize row in the form
  function buildPrizeRowHtml(prize) {
    prize = prize || {};
    var rid    = 'evPrize-' + (++_prizeRowSeq);
    var posId  = rid + '-pos';
    var typeId = rid + '-type';
    var valId  = rid + '-val';
    var descId = rid + '-desc';
    var pType  = prize.type || 'esi_points';
    var typeOpts = PRIZE_TYPES.map(function (t) {
      var sel = (t.value === pType) ? ' selected' : '';
      return '<option value="' + esc(t.value) + '"' + sel + '>' + esc(t.label) + '</option>';
    }).join('');
    var pos  = prize.position != null ? prize.position : 1;
    var val  = prize.value != null ? String(prize.value) : '';
    var desc = prize.description || '';
    return '<div class="ev-prize-row" data-prize-row="' + esc(rid) + '">' +
      '<div class="ev-prize-grid">' +
        '<div class="ev-prize-cell ev-prize-cell-pos">' +
          '<label class="inac-label" for="' + esc(posId) + '">Place</label>' +
          '<input type="number" class="inac-input ev-prize-position" id="' + esc(posId) + '"' +
            ' min="1" max="999" step="1" value="' + esc(pos) + '"' +
            ' aria-label="Prize placement (1 = top, 2 = second, etc)" />' +
        '</div>' +
        '<div class="ev-prize-cell ev-prize-cell-type">' +
          '<label class="inac-label" for="' + esc(typeId) + '">Type</label>' +
          '<select class="inac-input ev-select ev-prize-type" id="' + esc(typeId) + '" aria-label="Prize type">' + typeOpts + '</select>' +
        '</div>' +
        '<div class="ev-prize-cell ev-prize-cell-value">' +
          '<label class="inac-label" for="' + esc(valId) + '">Value</label>' +
          '<input type="text" class="inac-input ev-prize-value" id="' + esc(valId) + '"' +
            ' maxlength="500" value="' + esc(val) + '" aria-label="Prize value" />' +
        '</div>' +
      '</div>' +
      '<div class="ev-prize-cell ev-prize-cell-desc">' +
        '<label class="inac-label" for="' + esc(descId) + '">Details (optional)</label>' +
        '<textarea class="inac-input ev-prize-description" id="' + esc(descId) + '"' +
          ' rows="2" maxlength="500" placeholder="Extra prize details (markdown supported)"' +
          ' aria-label="Prize description">' + esc(desc) + '</textarea>' +
      '</div>' +
      '<button type="button" class="inac-remove-btn ev-prize-remove" aria-label="Remove prize" title="Remove prize">&#x2715;</button>' +
    '</div>';
  }

  function wireForm() {
    // Wire up the Write/Preview editors for both description fields
    panel.querySelectorAll('.ev-md-editor').forEach(function (editorEl) {
      wireMdEditor(editorEl);
    });

    // Populate the voice-channel datalist
    updateVoiceChannelDatalist();
    ensureVoiceChannels();

    // Keep the Discord-pill styling in sync with whatever the user types
    var locationEl = document.getElementById('evLocation');
    if (locationEl) {
      locationEl.addEventListener('input',  syncLocationVoiceStyle);
      locationEl.addEventListener('change', syncLocationVoiceStyle);
    }

    var prizeListEl  = document.getElementById('evPrizeList');
    var prizeEmptyEl = document.getElementById('evPrizeEmpty');
    var addBtn       = document.getElementById('evAddPrize');

    function syncPrizeRowValueInput(row) {
      if (!row) return;
      var typeEl  = row.querySelector('.ev-prize-type');
      var valueEl = row.querySelector('.ev-prize-value');
      if (!typeEl || !valueEl) return;
      var t = typeEl.value;
      if (t === 'esi_points') {
        valueEl.type = 'number';
        valueEl.min  = '0';
        valueEl.step = '1';
        valueEl.placeholder = 'e.g. 250';
      } else if (t === 'item') {
        valueEl.type = 'text';
        valueEl.removeAttribute('min');
        valueEl.removeAttribute('step');
        valueEl.placeholder = 'e.g. Mythic weapon';
      } else {
        valueEl.type = 'text';
        valueEl.removeAttribute('min');
        valueEl.removeAttribute('step');
        valueEl.placeholder = 'e.g. Custom reward';
      }
    }

    function syncPrizeEmpty() {
      if (!prizeEmptyEl || !prizeListEl) return;
      var n = prizeListEl.querySelectorAll('.ev-prize-row').length;
      prizeEmptyEl.style.display = n ? 'none' : '';
    }

    function renderPrizeRows(prizes) {
      if (!prizeListEl) return;
      prizeListEl.innerHTML = (prizes || []).map(buildPrizeRowHtml).join('');
      prizeListEl.querySelectorAll('.ev-prize-row').forEach(syncPrizeRowValueInput);
      syncPrizeEmpty();
    }

    function appendPrizeRow(prize) {
      if (!prizeListEl) return;
      var holder = document.createElement('div');
      holder.innerHTML = buildPrizeRowHtml(prize || {});
      var row = holder.firstChild;
      prizeListEl.appendChild(row);
      syncPrizeRowValueInput(row);
      syncPrizeEmpty();
      return row;
    }

    if (addBtn) {
      addBtn.addEventListener('click', function () {
        // pick a default place: one above the current highest
        var maxPos = 0;
        prizeListEl.querySelectorAll('.ev-prize-position').forEach(function (el) {
          var p = parseInt(el.value, 10) || 0;
          if (p > maxPos) maxPos = p;
        });
        var row = appendPrizeRow({ position: maxPos + 1, type: 'esi_points' });
        if (row) {
          var firstInput = row.querySelector('.ev-prize-value');
          if (firstInput) firstInput.focus();
        }
      });
    }

    if (prizeListEl) {
      // Per-row remove button (delegated)
      prizeListEl.addEventListener('click', function (ev) {
        var btn = ev.target.closest('.ev-prize-remove');
        if (!btn) return;
        var row = btn.closest('.ev-prize-row');
        if (row) row.remove();
        syncPrizeEmpty();
      });
      // React to prize-type changes (delegated)
      prizeListEl.addEventListener('change', function (ev) {
        if (!ev.target.classList.contains('ev-prize-type')) return;
        var row = ev.target.closest('.ev-prize-row');
        syncPrizeRowValueInput(row);
      });
    }

    // Expose helpers used by startEdit / resetFormDefaults
    window._evRenderPrizes = renderPrizeRows;
    window._evAppendPrize  = appendPrizeRow;

    syncPrizeEmpty();

    document.getElementById('evSubmit').addEventListener('click', submitEvent);

    wireDiscordImport();

    // edit/cancel helpers are referenced from the list's data-* handlers
    window._evStartEdit   = startEdit;
    window._evCancelEdit  = cancelEdit;
  }

  /* discord event import */

  // Match a Discord event URL on any subdomain (canary/ptb/etc) or a bare numeric ID
  var DISCORD_EVENT_URL_RE = /https?:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/events\/(\d+)\/(\d+)/i;

  function looksLikeDiscordEventRef(s) {
    s = (s || '').trim();
    if (!s) return false;
    if (/^\d{15,}$/.test(s)) return true;
    return DISCORD_EVENT_URL_RE.test(s);
  }

  function wireDiscordImport() {
    var input = document.getElementById('evDiscordImport');
    var btn   = document.getElementById('evDiscordImportBtn');
    if (!input || !btn) return;

    function tryImport() {
      var raw = (input.value || '').trim();
      if (!raw) {
        if (window.showToast) window.showToast('\u26a0 Paste a Discord event link first.', 'warn');
        return;
      }
      if (!looksLikeDiscordEventRef(raw)) {
        if (window.showToast) window.showToast('\u26a0 That doesn\u2019t look like a Discord event link.', 'warn');
        return;
      }
      importFromDiscord(raw);
    }

    btn.addEventListener('click', tryImport);

    // Auto-import the moment the user pastes a recognisable link
    input.addEventListener('paste', function (e) {
      var text = '';
      try {
        text = (e.clipboardData || window.clipboardData).getData('text') || '';
      } catch (err) { /* clipboard access can fail in some browsers */ }
      text = (text || '').trim();
      if (text && looksLikeDiscordEventRef(text)) {
        // Defer so the value lands in the input before we read/clear it
        setTimeout(function () { importFromDiscord(text); }, 0);
      }
    });

    // Pressing Enter in the field triggers the import too
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); tryImport(); }
    });
  }

  var IMPORT_LOADING_CLASS = 'is-loading';

  function importFromDiscord(raw) {
    var input = document.getElementById('evDiscordImport');
    var btn   = document.getElementById('evDiscordImportBtn');
    if (btn) {
      btn.disabled = true;
      btn.classList.add(IMPORT_LOADING_CLASS);
    }
    if (input) input.disabled = true;

    fetch('/api/discord/scheduled-event?url=' + encodeURIComponent(raw),
          { credentials: 'same-origin' })
      .then(function (r) {
        return r.json().then(function (d) { return { ok: r.ok, data: d }; });
      })
      .then(function (res) {
        if (!res.ok) {
          var msg = (res.data && res.data.error) || 'Failed to import Discord event.';
          if (window.showToast) window.showToast('\u26a0 ' + msg, 'error');
          return;
        }
        applyDiscordEvent(res.data || {});
        if (window.showToast) window.showToast('\u2713 Imported from Discord.', 'success');
        if (input) input.value = '';
      })
      .catch(function () {
        if (window.showToast) window.showToast('\u26a0 Request failed.', 'error');
      })
      .finally(function () {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove(IMPORT_LOADING_CLASS);
        }
        if (input) input.disabled = false;
      });
  }

  // Push imported Discord-event data into the form fields
  function applyDiscordEvent(ev) {
    if (!ev) return;
    var nameEl    = document.getElementById('evName');
    var descEl    = document.getElementById('evDescription');
    var startsEl  = document.getElementById('evStartsAt');
    var endsEl    = document.getElementById('evEndsAt');
    var locEl     = document.getElementById('evLocation');

    if (nameEl   && ev.name)        nameEl.value   = ev.name;
    if (descEl   && ev.description) descEl.value   = ev.description;
    if (startsEl && ev.starts_at)   startsEl.value = isoToDatetimeLocal(ev.starts_at);
    if (endsEl   && ev.ends_at)     endsEl.value   = isoToDatetimeLocal(ev.ends_at);

    if (locEl) {
      if (ev.location) {
        locEl.value = ev.location;
      }
      // If Discord told us about a voice channel, remember its id directly
      if (ev.channel_id) {
        locEl.dataset.channelId     = String(ev.channel_id);
        locEl.dataset.channelExpect = ev.location || '';
        ensureVoiceChannels();
      } else {
        delete locEl.dataset.channelId;
        delete locEl.dataset.channelExpect;
      }
      syncLocationVoiceStyle();
    }

    // Refresh the markdown preview for the description if it's open
    var previewEl = panel.querySelector('[data-md-editor="evDescription"] [data-md-preview]');
    if (previewEl && descEl && descEl.value) {
      previewEl.innerHTML = renderDescription(descEl.value);
    }
  }

  function resetFormDefaults() {
    var ids = ['evName','evDescription','evStartsAt','evEndsAt','evLocation',
               'evMaxParticipants','evDiscordImport'];
    ids.forEach(function (id) { var el = document.getElementById(id); if (el) el.value = ''; });
    var status = document.getElementById('evStatus');
    if (status) status.value = 'upcoming';
    var audience = document.getElementById('evAudience');
    if (audience) audience.value = 'public';
    if (typeof window._evRenderPrizes === 'function') window._evRenderPrizes([]);
    // drop the VC pill styling since the Location field is now empty
    syncLocationVoiceStyle();
  }

  /* list render */


  function renderEventCard(ev) {
      var status   = ev.status || 'upcoming';
      var cb       = (ev.created_by || {});
      var creator  = cb.username ? esc(cb.username) : 'Someone';
      var created  = ev.created_at ? fmtDateTime(ev.created_at) : '';
      var starts   = ev.starts_at ? fmtDateTime(ev.starts_at) : '';
      var ends     = ev.ends_at   ? fmtDateTime(ev.ends_at)   : '';
      var prizes   = Array.isArray(ev.prizes) ? ev.prizes : [];
      var hasPrize = prizes.length > 0;
      var location = ev.location || '';
      var maxP     = Number(ev.max_participants || 0);
      var canManage = !!ev.can_manage;
      var canPin    = !!ev.can_pin;
      var isPinned  = !!ev.pinned;

      var whenBits = [];
      if (starts) whenBits.push('Starts ' + starts);
      if (ends)   whenBits.push('Ends '   + ends);
      var whenHtml = whenBits.length
        ? '<span class="ev-when">' + whenBits.join(' \u00b7 ') + '</span>'
        : '';

      var channelId = ev.location_channel_id || '';
      var vcUrl     = channelId ? channelDiscordUrl(channelId) : '';
      var vcName = ev.location || '';
      if (channelId) {
        var normStored = vcName.replace(/^#/, '').trim();
        if (!normStored) {
          for (var k = 0; k < _voiceChannels.length; k++) {
            if (String(_voiceChannels[k].id) === String(channelId)) {
              vcName = '#' + _voiceChannels[k].name;
              break;
            }
          }
        } else if (vcName.indexOf('#') !== 0) {
          vcName = '#' + normStored;
        }
      }

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
      if (maxP)     metaBits.push('\ud83d\udc65 Max ' + maxP);
      metaBits.push('By ' + creator);
      if (created)  metaBits.push(created);

      var pinBtnHtml = canPin
        ? '<button class="ev-pin-btn' + (isPinned ? ' is-pinned' : '') + '"' +
            ' data-id="' + esc(ev.id) + '"' +
            ' data-pinned="' + (isPinned ? '1' : '0') + '"' +
            ' title="' + (isPinned ? 'Unpin event' : 'Pin event') + '"' +
            ' aria-label="' + (isPinned ? 'Unpin event' : 'Pin event') + '">' +
            '\ud83d\udccc' +
          '</button>'
        : '';
      var btnsHtml = (canManage || canPin)
        ? '<div class="ev-row-btns">' +
            pinBtnHtml +
            (canManage
              ? '<button class="inac-edit-btn"   data-id="' + esc(ev.id) + '" title="Edit">&#x270e;</button>' +
                '<button class="inac-remove-btn" data-id="' + esc(ev.id) + '" title="Delete">&#x2715;</button>'
              : '') +
          '</div>'
        : '';

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

      // Per-prize descriptions
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
          btnsHtml +
        '</div>' +
        (ev.description
          ? '<div class="ev-description ticket-preview-content">' + renderDescription(ev.description) + '</div>'
          : '') +
        prizesHtml +
        (whenHtml ? '<div class="ev-meta-row">' + whenHtml + '</div>' : '') +
        '<div class="ev-sub-meta">' + metaBits.join(' \u00b7 ') + '</div>' +
      '</div>';
  }

  function renderList() {
    var listEl  = document.getElementById('evList');
    var countEl = document.getElementById('evCount');
    if (!listEl) return;
    if (countEl) countEl.textContent = '(' + _events.length + ')';

    if (!_events.length) {
      listEl.innerHTML = '<div class="inac-empty" style="font-weight:500;">No events yet. Create the first one!</div>';
      return;
    }

    // Bucket events by status while preserving the server-side ordering
    var groups = { ongoing: [], upcoming: [], completed: [], cancelled: [] };
    _events.forEach(function (ev) {
      var st = (ev.status || 'upcoming').toLowerCase();
      if (!groups[st]) groups[st] = [];
      groups[st].push(ev);
    });

    var html = '';

    // Ongoing: always shown, never collapsible
    if (groups.ongoing.length) {
      html +=
        '<section class="evm-section evm-section-ongoing">' +
          '<div class="evm-section-head evm-section-head-static evm-section-head-ongoing">' +
            '<span class="evm-section-live-dot" aria-hidden="true"></span>' +
            '<span class="evm-section-title">Ongoing</span>' +
            '<span class="evm-section-count">' + groups.ongoing.length + '</span>' +
          '</div>' +
          '<div class="evm-section-body">' +
            groups.ongoing.map(renderEventCard).join('') +
          '</div>' +
        '</section>';
    }

    // Collapsible sections for the other statuses
    var COLLAPSIBLE = [
      { key: 'upcoming',  label: 'Upcoming'  },
      { key: 'completed', label: 'Completed' },
      { key: 'cancelled', label: 'Cancelled' },
    ];
    COLLAPSIBLE.forEach(function (s) {
      var evs = groups[s.key] || [];
      if (!evs.length) return; // skip empty categories
      var open = !_collapsed[s.key];
      html +=
        '<details class="evm-section evm-section-' + s.key + '"' +
          (open ? ' open' : '') + ' data-status="' + esc(s.key) + '">' +
          '<summary class="evm-section-head evm-section-head-' + s.key + '">' +
            '<span class="evm-section-caret" aria-hidden="true">\u25B8</span>' +
            '<span class="evm-section-title">' + esc(s.label) + '</span>' +
            '<span class="evm-section-count">' + evs.length + '</span>' +
          '</summary>' +
          '<div class="evm-section-body">' +
            evs.map(renderEventCard).join('') +
          '</div>' +
        '</details>';
    });

    listEl.innerHTML = html;

    // Persist collapse changes
    listEl.querySelectorAll('details[data-status]').forEach(function (det) {
      det.addEventListener('toggle', function () {
        _collapsed[this.dataset.status] = !this.open;
        saveCollapsed();
      });
    });

    listEl.querySelectorAll('.inac-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { startEdit(this.dataset.id); });
    });
    listEl.querySelectorAll('.inac-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { removeEvent(this.dataset.id); });
    });
    listEl.querySelectorAll('.ev-pin-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        togglePin(this.dataset.id, this.dataset.pinned !== '1');
      });
    });
  }

  function togglePin(eventId, pin) {
    var url    = '/api/events/' + encodeURIComponent(eventId) + '/pin';
    var method = pin ? 'POST' : 'DELETE';
    fetch(url, { method: method, credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (!res.ok) {
          window.showToast('\u26a0 ' + ((res.data && res.data.error) || 'Failed to update pin.'), 'error');
          return;
        }
        window.showToast(pin ? '\ud83d\udccc Event pinned.' : 'Event unpinned.', 'success');
        // Notify the home banner to refresh its pinned-event list
        try {
          window.dispatchEvent(new CustomEvent('esi:pinned-events-changed'));
        } catch (e) { /* CustomEvent may not exist on very old browsers */ }
        loadEvents();
      })
      .catch(function () { window.showToast('\u26a0 Request failed.', 'error'); });
  }

  /* submit / edit / remove */

  function readForm() {
    var locEl       = document.getElementById('evLocation');
    var rawLocation = (locEl && locEl.value || '').trim();
    var match       = matchLocationChannel(rawLocation);
    var location    = match ? '#' + match.name : rawLocation;
    var locationChannelId = match
      ? String(match.id || '')
      : (locEl && locEl.dataset.channelId
          && locEl.dataset.channelExpect
          && locEl.dataset.channelExpect === rawLocation
          ? String(locEl.dataset.channelId)
          : '');

    // Walk the prize-row DOM and collect each entry
    var prizes = [];
    var rows = document.querySelectorAll('#evPrizeList .ev-prize-row');
    rows.forEach(function (row) {
      var posEl  = row.querySelector('.ev-prize-position');
      var typeEl = row.querySelector('.ev-prize-type');
      var valEl  = row.querySelector('.ev-prize-value');
      var dscEl  = row.querySelector('.ev-prize-description');
      var pos = parseInt(posEl ? posEl.value : '1', 10);
      if (!isFinite(pos) || pos < 1) pos = 1;
      prizes.push({
        position:    pos,
        type:        typeEl ? typeEl.value : 'other',
        value:       valEl ? (valEl.value || '').trim() : '',
        description: dscEl ? (dscEl.value || '').trim() : '',
      });
    });

    var audienceEl = document.getElementById('evAudience');
    var audience   = audienceEl ? (audienceEl.value || 'public') : 'public';

    return {
      name:                (document.getElementById('evName').value             || '').trim(),
      description:         (document.getElementById('evDescription').value      || '').trim(),
      starts_at:           (document.getElementById('evStartsAt').value         || '').trim(),
      ends_at:             (document.getElementById('evEndsAt').value           || '').trim(),
      location:            location,
      location_channel_id: locationChannelId,
      max_participants:    parseInt(document.getElementById('evMaxParticipants').value, 10) || 0,
      prizes:              prizes,
      status:              document.getElementById('evStatus').value            || 'upcoming',
      audience:            audience,
    };
  }

  function submitEvent() {
    var body = readForm();
    if (!body.name) { window.showToast('\u26a0 Enter an event name.', 'warn'); return; }

    var btn = document.getElementById('evSubmit');
    btn.disabled = true;
    var url    = _editingId ? '/api/events/' + encodeURIComponent(_editingId) : '/api/events';
    var method = _editingId ? 'PATCH' : 'POST';

    fetch(url, {
      method:      method,
      credentials: 'same-origin',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify(body),
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
      btn.disabled = false;
      if (!res.ok) {
        window.showToast('\u26a0 ' + ((res.data && res.data.error) || 'Failed to save event.'), 'error');
        return;
      }
      window.showToast((_editingId ? 'Updated ' : 'Created ') + (res.data.name || 'event') + '.', 'success');
      cancelEdit();
      loadEvents();
    })
    .catch(function () {
      btn.disabled = false;
      window.showToast('\u26a0 Request failed.', 'error');
    });
  }

  function startEdit(eventId) {
    var ev = null;
    for (var i = 0; i < _events.length; i++) {
      if (_events[i].id === eventId) { ev = _events[i]; break; }
    }
    if (!ev) return;
    _editingId = eventId;

    document.getElementById('evName').value              = ev.name || '';
    document.getElementById('evDescription').value       = ev.description || '';
    document.getElementById('evStartsAt').value          = isoToDatetimeLocal(ev.starts_at);
    document.getElementById('evEndsAt').value            = isoToDatetimeLocal(ev.ends_at);
    // When the event is linked to a voice channel, pre-fill with '#name'
    (function () {
      var locEl = document.getElementById('evLocation');
      if (!locEl) return;
      if (ev.location_channel_id) {
        var match = null;
        for (var j = 0; j < _voiceChannels.length; j++) {
          if (String(_voiceChannels[j].id) === String(ev.location_channel_id)) {
            match = _voiceChannels[j];
            break;
          }
        }
        locEl.value = match ? '#' + match.name : (ev.location || '');
      } else {
        locEl.value = ev.location || '';
      }
      syncLocationVoiceStyle();
    })();
    document.getElementById('evMaxParticipants').value   = ev.max_participants || '';

    if (typeof window._evRenderPrizes === 'function') {
      window._evRenderPrizes(Array.isArray(ev.prizes) ? ev.prizes : []);
    }

    document.getElementById('evStatus').value            = ev.status || 'upcoming';
    var audEl = document.getElementById('evAudience');
    if (audEl) audEl.value = ev.audience || 'public';

    var header = document.getElementById('evFormHeader');
    if (header) header.innerHTML = '&#x270e; Edit Event';

    var submit = document.getElementById('evSubmit');
    submit.textContent = '\u270e Save Changes';
    submit.className   = 'inac-btn inac-btn-primary';

    if (!document.getElementById('evCancel')) {
      var cancel = document.createElement('button');
      cancel.id          = 'evCancel';
      cancel.className   = 'inac-btn inac-btn-secondary';
      cancel.textContent = '\u2715 Cancel';
      cancel.addEventListener('click', cancelEdit);
      document.getElementById('evBtnRow').appendChild(cancel);
    }

    document.getElementById('evName').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    document.getElementById('evName').focus();
  }

  function cancelEdit() {
    _editingId = null;
    resetFormDefaults();
    var header = document.getElementById('evFormHeader');
    if (header) header.innerHTML = 'Create Event';
    var submit = document.getElementById('evSubmit');
    if (submit) {
      submit.textContent = 'Create Event';
      submit.className   = 'inac-btn inac-btn-approve';
    }
    var cancel = document.getElementById('evCancel');
    if (cancel) cancel.remove();
  }

  function removeEvent(eventId) {
    if (!window.confirm('Delete this event? This cannot be undone.')) return;
    fetch('/api/events/' + encodeURIComponent(eventId), {
      method: 'DELETE',
      credentials: 'same-origin',
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
      if (!res.ok) {
        window.showToast('\u26a0 ' + ((res.data && res.data.error) || 'Failed to delete.'), 'error');
        return;
      }
      window.showToast('Event removed.', 'info');
      if (_editingId === eventId) cancelEdit();
      loadEvents();
    })
    .catch(function () { window.showToast('\u26a0 Request failed.', 'error'); });
  }

})();
