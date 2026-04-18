(function () {
  'use strict';

  /* ── Tracker definitions ── */
  var TRACKERS = [
    { name: 'Activity Data Refresh',    interval: 600, color: '#eb7d34' },
    { name: 'API Tracker',      interval: 300, color: '#5865F2' },
    { name: 'Playtime Tracker', interval: 300, color: '#9B59B6' },
    { name: 'Guild Tracker',    interval: 30,  color: '#D4A017' },
    { name: 'Claim Tracker',    interval: 3,   color: '#3BA55C' },
  ];

  var trackerTimers = {};
  var botInitialized = false;
  var botUptimeSeconds = 0;
  var botUptimeKnown = false;
  var trackerUptimeSeconds = 0;
  var trackerUptimeKnown = false;

  /* ── Observe panel activation ── */
  var panel = document.getElementById('panel-bot');
  var observer = new MutationObserver(function () {
    if (panel.classList.contains('active') && !botInitialized) {
      botInitialized = true;
      initBot();
    }
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['class'] });

  /* If the panel is already active on page load (e.g. refresh while on bot tab) */
  if (panel.classList.contains('active')) {
    botInitialized = true;
    initBot();
  }

  /* ── Init ── */
  function initBot() {
    var loadingEl = document.getElementById('botLoading');
    var errorEl   = document.getElementById('botError');
    var contentEl = document.getElementById('botContent');

    // Show content layout with loading placeholders
    loadingEl.style.display = 'none';
    errorEl.style.display   = 'none';
    contentEl.style.display = 'block';

    // Set placeholders so the layout looks correct before data arrives
    var avatarEl = document.getElementById('botAvatar');
    avatarEl.style.visibility = 'hidden';
    document.getElementById('botName').textContent = 'Loading\u2026';
    document.getElementById('botIdBadge').textContent = '';
    document.getElementById('botStatusPill').textContent = '';
    document.getElementById('botLatency').textContent = '';
    document.getElementById('botUptime').textContent = '';
    document.getElementById('botGuildSnapshot').innerHTML =
      '<div class="info-card-header">Discord Server</div>' +
      '<div style="padding:16px 20px;color:var(--text-faint);font-style:italic;font-weight:500;">Loading\u2026</div>';

    // Progress toast
    var _botToast = null;
    var _bDone = 0, _bTotal = 0;
    if (typeof window.showProgressToast === 'function') {
      _botToast = window.showProgressToast('Fetching bot data\u2026');
      _botToast.addItem('info',     'Bot Info');
      _botToast.addItem('status',   'Bot Status');
      _botToast.addItem('trackers', 'Trackers');
      _botToast.addItem('snapshot', 'Discord Server');
      _botToast.addItem('db',       'Databases');
      _botToast.addItem('cucks',    'Cuck List');
      _bTotal = 6;
    }
    var _bMsgs = { success: '\u2713 Bot data loaded', fail: '\u2715 Failed to load bot data', partial: '\u26a0 Bot data partially loaded' };
    function _bCheckDone() { _bDone++; if (_bDone >= _bTotal && _botToast) _botToast.finish(_bMsgs); }

    // File-based reads (cached for offline fallback)
    var statusP = DataCache.cachedFetch('/api/bot/status')
      .then(function(r) { if (_botToast) _botToast.updateItem('status', 'success'); _bCheckDone(); return r.data || { online: true, latency: 42 }; })
      .catch(function() { if (_botToast) _botToast.updateItem('status', 'error'); _bCheckDone(); return { online: true, latency: 42 }; });

    var dbP = DataCache.cachedFetch('/api/bot/databases')
      .then(function(r) { if (_botToast) _botToast.updateItem('db', 'success'); _bCheckDone(); return r.data || { total_size: 0, folders: {} }; })
      .catch(function() { if (_botToast) _botToast.updateItem('db', 'error'); _bCheckDone(); return { total_size: 0, folders: {} }; });

    var cucksP = DataCache.cachedFetch('/api/bot/ip-bans')
      .then(function(r) { if (_botToast) _botToast.updateItem('cucks', 'success'); _bCheckDone(); return r.data || { available: false, total_blacklists: 0, total_temp_bans: 0, categories: [] }; })
      .catch(function() { if (_botToast) _botToast.updateItem('cucks', 'error'); _bCheckDone(); return { available: false, total_blacklists: 0, total_temp_bans: 0, categories: [] }; });

    // Bot info: use cached version instantly if available, refresh in background
    var cachedInfo = DataCache.readCache('/api/bot/info');
    var infoP;
    if (cachedInfo) {
      infoP = Promise.resolve(cachedInfo);
      if (_botToast) _botToast.updateItem('info', 'success');
      _bCheckDone();
      // Refresh cache in background for next visit
      fetch('/api/bot/info')
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) { if (data) DataCache.writeCache('/api/bot/info', data); })
        .catch(function() {});
    } else {
      infoP = DataCache.cachedFetch('/api/bot/info')
        .then(function(r) { if (_botToast) _botToast.updateItem('info', 'success'); _bCheckDone(); return r.data; })
        .catch(function() { if (_botToast) _botToast.updateItem('info', 'error'); _bCheckDone(); return null; });
    }

    var snapshotP = fetch('/api/bot/discord')
      .then(function(r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function(data) { if (_botToast) _botToast.updateItem('snapshot', 'success'); _bCheckDone(); return data; })
      .catch(function() { if (_botToast) _botToast.updateItem('snapshot', 'error'); _bCheckDone(); return null; });

    var trackersP = fetch('/api/bot/trackers', { cache: 'no-store' })
      .then(function(r) { if (!r.ok) throw new Error(); return r.json(); })
      .then(function(data) { if (_botToast) _botToast.updateItem('trackers', 'success'); _bCheckDone(); return data; })
      .catch(function() { if (_botToast) _botToast.updateItem('trackers', 'error'); _bCheckDone(); return { trackers: [] }; });

    // Render each section as its data arrives
    Promise.all([infoP, statusP]).then(function(results) {
      avatarEl.style.visibility = '';
      renderBotProfile(results[0], results[1]);
    });

    snapshotP.then(function(snapshot) {
      renderGuildSnapshot(snapshot);
    });

    dbP.then(function(data) {
      renderDatabases(data);
    });

    cucksP.then(function(data) {
      renderCuckList(data);
    });

    trackersP.then(function(payload) {
      initTrackers(payload);
    });

    // These don't need data
    startUptimeTicker();
    initCuckModal();
  }


  /* ══════════════════════════════════
     Bot Profile
     ══════════════════════════════════ */

  function renderGuildSnapshot(snapshot) {
    var el = document.getElementById('botGuildSnapshot');
    if (!el || !snapshot || snapshot.error) { if (el) el.style.display = 'none'; return; }

    var boostStars = snapshot.boost_level > 0 ? ' ' + '✦'.repeat(snapshot.boost_level) : '';

    el.innerHTML =
      '<div class="info-card-header">Discord Server</div>' +
      '<div class="bot-health-grid">' +
        '<div class="bot-health-item"><span class="bot-health-label">Members</span><span class="bot-health-value">' + (snapshot.member_count || '—').toLocaleString() + '</span></div>' +
        '<div class="bot-health-item"><span class="bot-health-label">Online</span><span class="bot-health-value" style="color:var(--online)">● ' + (snapshot.online_count || '—').toLocaleString() + '</span></div>' +
        '<div class="bot-health-item"><span class="bot-health-label">Boost Level</span><span class="bot-health-value" style="color:#f47fff">Level ' + snapshot.boost_level + boostStars + '</span></div>' +
        '<div class="bot-health-item"><span class="bot-health-label">Boosts</span><span class="bot-health-value">' + snapshot.boost_count + '</span></div>' +
      '</div>';
  }

  function renderBotProfile(info, status) {
    var avatarEl = document.getElementById('botAvatar');
    var nameEl   = document.getElementById('botName');
    var idEl     = document.getElementById('botIdBadge');

    if (info && !info.error) {
      if (info.avatar) {
        avatarEl.src = 'https://cdn.discordapp.com/avatars/' + info.id + '/' + info.avatar + '.png?size=128';
      } else {
        avatarEl.src = 'https://cdn.discordapp.com/embed/avatars/0.png';
      }
      nameEl.textContent = info.username;
      idEl.textContent   = 'ID: ' + info.id;
    } else {
      nameEl.textContent = 'Bot Unavailable';
      idEl.textContent   = (info && info.error) ? info.error : 'No token configured';
    }

    applyStatus(status);
  }

  function applyStatus(status) {
    var statusEl  = document.getElementById('botStatusPill');
    var latencyEl = document.getElementById('botLatency');
    var uptimeEl  = document.getElementById('botUptime');
    var isOnline = !!(status && status.online);
    var latency = status && typeof status.latency === 'number' ? status.latency : null;
    var uptime = status && typeof status.uptime_seconds === 'number' ? status.uptime_seconds : null;
    if (uptime !== null && uptime >= 0) {
      botUptimeSeconds = Math.floor(uptime);
      botUptimeKnown = true;
    } else {
      botUptimeKnown = false;
    }
    statusEl.className   = 'status-pill ' + (isOnline ? 'online' : 'offline');
    statusEl.textContent = isOnline ? '● Online' : '● Offline';
    latencyEl.textContent = 'Latency: ' + (latency === null ? '—' : latency + 'ms');
    uptimeEl.textContent  = botUptimeKnown
      ? 'Uptime: ' + formatDuration(Math.max(0, botUptimeSeconds) * 1000)
      : 'Offline';
  }

  function formatDuration(ms) {
    var s = Math.floor(ms / 1000);
    var d = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
    if (h > 0) return h + 'h ' + m + 'm';
    if (m > 0) return m + 'm ' + sec + 's';
    return sec + 's';
  }

  function startUptimeTicker() {
    setInterval(function () {
      var uptimeEl = document.getElementById('botUptime');
      if (uptimeEl) {
        if (botUptimeKnown) {
          botUptimeSeconds = Math.max(0, botUptimeSeconds + 1);
          uptimeEl.textContent = 'Uptime: ' + formatDuration(botUptimeSeconds * 1000);
        } else {
          uptimeEl.textContent = 'Offline';
        }
      }
      var bPill = document.getElementById('botStatusPill');
      if (bPill) {
        bPill.className = 'status-pill ' + (botUptimeKnown ? 'online' : 'offline');
        bPill.textContent = (botUptimeKnown ? '\u25CF Online' : '\u25CF Offline');
      }
      var tEl = document.getElementById('trackerHeaderUptime');
      if (tEl) {
        if (trackerUptimeKnown) {
          trackerUptimeSeconds = Math.max(0, trackerUptimeSeconds + 1);
          tEl.textContent = formatDuration(trackerUptimeSeconds * 1000);
        } else {
          tEl.textContent = 'Offline';
        }
      }
      var tPill = document.getElementById('trackerHeaderStatus');
      if (tPill) {
        tPill.className = 'status-pill ' + (trackerUptimeKnown ? 'online' : 'offline');
        tPill.textContent = (trackerUptimeKnown ? '\u25CF Online' : '\u25CF Offline');
      }
    }, 1000);
  }


  /* ══════════════════════════════════
     Databases
     ══════════════════════════════════ */

  function renderDatabases(data) {
    document.getElementById('dbTotalSize').textContent = '(' + formatBytes(data.total_size) + ')';

    var wrap = document.getElementById('dbContent');
    var html = '<div class="db-total-bar">' +
      '<span class="db-total-label">Total Storage</span>' +
      '<span class="db-total-value">' + formatBytes(data.total_size) + '</span></div>';

    var folders = data.folders || {};
    var keys = Object.keys(folders);
    for (var k = 0; k < keys.length; k++) {
      var name   = keys[k];
      var folder = folders[name];
      var fid    = 'db-' + name.replace(/[^a-z0-9]/gi, '_');

      var spanHtml = '';
      if (folder.earliest_date && folder.total_days) {
        var months = (folder.total_days / 30.44).toFixed(1);
        spanHtml = '<div class="db-folder-span">' +
          formatDateLabel(folder.earliest_date) + ' \u2192 ' + formatDateLabel(folder.latest_date) +
          ' &nbsp;\u00B7&nbsp; ' + folder.total_days + ' days (' + months + ' mo)' +
          '</div>';
      }

      html += '<div class="db-subfolder">' +
        '<div class="db-subfolder-header">' +
        '<span class="db-folder-name">\uD83D\uDCC1 databases/' + name + '</span>' +
        '<span class="db-folder-size">' + formatBytes(folder.total_size) +
        '</span></div>' + spanHtml +
        '<div class="db-file-list" id="' + fid + '">';

      html += '</div></div>';
    }

    wrap.innerHTML = html;
  }

  function formatDateLabel(isoDate) {
    if (!isoDate) return '—';
    var parts = isoDate.split('-');
    var d = new Date(parts[0], parts[1] - 1, parts[2]);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  function formatBytes(b) {
    if (!b) return '0 B';
    var sizes = ['B', 'KB', 'MB', 'GB'];
    var i = Math.floor(Math.log(b) / Math.log(1024));
    return parseFloat((b / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
  }

  
  /* ══════════════════════════════════
     Tracker Countdowns
     ══════════════════════════════════ */

  function normalizeRemaining(remaining, interval) {
    var n = Number(remaining);
    if (!isFinite(n)) return interval;
    n = Math.floor(n);
    if (n <= 0) return interval;
    if (n > interval) {
      n = n % interval;
      if (n === 0) n = interval;
    }
    return n;
  }
  function normalizeTrackerName(name) {
    return String(name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function initTrackers(payload) {
    var serverTrackers = Array.isArray(payload) ? payload : (payload && payload.trackers);
    var uptime = payload && !Array.isArray(payload) && typeof payload.uptime_seconds === 'number'
      ? payload.uptime_seconds
      : null;
    if (uptime !== null && uptime >= 0) {
      trackerUptimeSeconds = Math.floor(uptime);
      trackerUptimeKnown = true;
    }
    var list = document.getElementById('trackerList');
    var html = '';
    var remoteByName = {};

    if (Array.isArray(serverTrackers)) {
      for (var j = 0; j < serverTrackers.length; j++) {
        var row = serverTrackers[j];
        if (!row || !row.name) continue;
        var rowName = normalizeTrackerName(row.name);
        if (!rowName) continue;
        remoteByName[rowName] = row;
        // Compatibility for older/newer backend tracker names
        if (rowName === 'activity data') {
          remoteByName['activity data refresh'] = row;
        } else if (rowName === 'activity data refresh') {
          remoteByName['activity data'] = row;
        }
      }
    }

    for (var i = 0; i < TRACKERS.length; i++) {
      var t = TRACKERS[i];
      var remote = remoteByName[normalizeTrackerName(t.name)];
      var remaining = remote && remote.remaining_seconds;
      trackerTimers[i] = normalizeRemaining(remaining, t.interval);
      var initialPct = ((t.interval - trackerTimers[i]) / t.interval) * 100;
      html += '<div class="tracker-item">' +
        '<div class="tracker-header">' +
        '<span class="tracker-name">' + t.name + '</span>' +
        '<span class="tracker-time" id="trackerTime' + i + '">' + formatCountdown(trackerTimers[i]) + '</span></div>' +
        '<div class="tracker-bar-track">' +
        '<div class="tracker-bar-fill" id="trackerBar' + i + '" style="width:' + initialPct + '%;background:linear-gradient(90deg,' + t.color + '88,' + t.color + ')"></div></div>' +
        '<div class="tracker-interval">Every ' + formatInterval(t.interval) + '</div></div>';
    }

    list.innerHTML = html;
    setInterval(tickTrackers, 1000);
    tickTrackers();
  }

  function tickTrackers() {
    for (var i = 0; i < TRACKERS.length; i++) {
      var t = TRACKERS[i];
      var isActivity = t.name === 'Activity Data Refresh';
      // Freeze non-activity countdowns when the tracker screen session is offline
      var frozen = !trackerUptimeKnown && !isActivity;
      var remaining = Number(trackerTimers[i]);
      if (!isFinite(remaining) || remaining <= 0) remaining = t.interval;
      var pct = ((t.interval - remaining) / t.interval) * 100;
      var timeEl = document.getElementById('trackerTime' + i);
      var barEl  = document.getElementById('trackerBar' + i);
      if (timeEl) timeEl.textContent = frozen ? 'Offline' : formatCountdown(remaining);
      if (barEl)  barEl.style.width  = pct + '%';
      if (!frozen) {
        remaining = remaining - 1;
        if (remaining <= 0) remaining = t.interval;
        trackerTimers[i] = remaining;
      }
    }
  }

  function formatCountdown(s) {
    if (s >= 60) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    return s + 's';
  }

  function formatInterval(s) {
    if (s >= 3600) return (s / 3600) + ' hours';
    if (s >= 60)   return (s / 60)   + ' minutes';
    return s + ' seconds';
  }


  /* ══════════════════════════════════
     Cuck List (IP ban summary)
     ══════════════════════════════════ */

  var _cuckData = null;

  function _safeSanitize(html) {
    if (typeof DOMPurify !== 'undefined' && DOMPurify && typeof DOMPurify.sanitize === 'function') {
      return DOMPurify.sanitize(html);
    }
    return html;
  }

  function _escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _formatTs(ts) {
    if (!ts) return '\u2014';
    var d = new Date(ts * 1000);
    if (isNaN(d.getTime())) return '\u2014';
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear() +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function _formatRemaining(sec) {
    var n = Math.max(0, Math.floor(Number(sec) || 0));
    if (n >= 86400) return Math.floor(n / 86400) + 'd ' + Math.floor((n % 86400) / 3600) + 'h';
    if (n >= 3600)  return Math.floor(n / 3600) + 'h ' + Math.floor((n % 3600) / 60) + 'm';
    if (n >= 60)    return Math.floor(n / 60) + 'm ' + (n % 60) + 's';
    return n + 's';
  }

  function renderCuckList(data) {
    var el = document.getElementById('cuckList');
    if (!el) return;
    _cuckData = data || null;

    if (!data || !data.available) {
      el.innerHTML = _safeSanitize(
        '<div class="cuck-list-placeholder">No ban data available.</div>'
      );
      return;
    }

    var cats = Array.isArray(data.categories) ? data.categories : [];
    if (!cats.length) {
      el.innerHTML = _safeSanitize(
        '<div class="cuck-list-placeholder">No bans recorded.</div>'
      );
      return;
    }

    var html = '';
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      var isHeadline = c.key === 'blacklists_all' || c.key === 'temp_bans_all';
      html +=
        '<button type="button" class="cuck-item' + (isHeadline ? ' cuck-item-headline' : '') + '"' +
        ' data-cuck-key="' + _escHtml(c.key) + '">' +
          '<span class="cuck-item-label">' + _escHtml(c.label) + '</span>' +
          '<span class="cuck-item-count">' + _escHtml(c.count || 0) + '</span>' +
        '</button>';
    }

    el.innerHTML = _safeSanitize(html);

    var buttons = el.querySelectorAll('.cuck-item');
    for (var j = 0; j < buttons.length; j++) {
      buttons[j].addEventListener('click', _onCuckItemClick);
    }
  }

  function _onCuckItemClick(e) {
    var key = e.currentTarget.getAttribute('data-cuck-key');
    if (!key || !_cuckData || !Array.isArray(_cuckData.categories)) return;
    var cat = null;
    for (var i = 0; i < _cuckData.categories.length; i++) {
      if (_cuckData.categories[i].key === key) { cat = _cuckData.categories[i]; break; }
    }
    if (!cat) return;
    openCuckModal(cat);
  }

  function _renderTempEntry(e) {
    return '<li class="cuck-entry">' +
      '<div class="cuck-entry-row">' +
        '<span class="cuck-entry-ip">' + _escHtml(e.ip || 'unknown') + '</span>' +
        '<span class="cuck-entry-pill cuck-entry-pill-temp">' + _escHtml(e.jail || 'jail') + '</span>' +
      '</div>' +
      '<div class="cuck-entry-meta">' +
        '<span>Banned: ' + _escHtml(_formatTs(e.banned_at)) + '</span>' +
        '<span>Expires in: ' + _escHtml(_formatRemaining(e.remaining_seconds)) + '</span>' +
        '<span>Count: ' + _escHtml(e.ban_count || 1) + '</span>' +
      '</div>' +
    '</li>';
  }

  function _groupHue(name) {
    var s = String(name || '');
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) >>> 0;
    }
    return h % 360;
  }

  function _groupPillStyle(name) {
    var hue = _groupHue(name);
    return 'color:hsl(' + hue + ',70%,68%);' +
      'border-color:hsl(' + hue + ',50%,38%);' +
      'background:hsla(' + hue + ',60%,35%,0.12);';
  }

  function _shortPill(name) {
    var s = String(name || '').trim();
    if (s.length <= 22) return s;
    return s.slice(0, 20) + '\u2026';
  }

  function _renderBlacklistEntry(e) {
    var pillText = _shortPill(e.group || 'Unspecified');
    return '<li class="cuck-entry">' +
      '<div class="cuck-entry-row">' +
        '<span class="cuck-entry-ip">' + _escHtml(e.ip || 'unknown') + '</span>' +
        '<span class="cuck-entry-pill" style="' + _escHtml(_groupPillStyle(e.group)) + '">' + _escHtml(pillText) + '</span>' +
      '</div>' +
      '<div class="cuck-entry-meta">' +
        '<span>Added: ' + _escHtml(_formatTs(e.added_at)) + '</span>' +
        (e.reason ? '<span class="cuck-entry-reason">Reason: ' + _escHtml(e.reason) + '</span>' : '') +
      '</div>' +
    '</li>';
  }

  function openCuckModal(cat) {
    var backdrop = document.getElementById('cuckModalBackdrop');
    var titleEl  = document.getElementById('cuckModalTitle');
    var bodyEl   = document.getElementById('cuckModalBody');
    if (!backdrop || !titleEl || !bodyEl) return;

    titleEl.textContent = (cat.label || 'Banned IPs') + ' (' + (cat.count || 0) + ')';

    var entries = Array.isArray(cat.entries) ? cat.entries : [];
    var html;
    if (!entries.length) {
      html = '<div class="cuck-modal-empty">No entries in this category.</div>';
    } else {
      var items = [];
      for (var i = 0; i < entries.length; i++) {
        items.push(cat.type === 'temp' ? _renderTempEntry(entries[i]) : _renderBlacklistEntry(entries[i]));
      }
      html = '<ul class="cuck-entry-list">' + items.join('') + '</ul>';
    }

    bodyEl.innerHTML = _safeSanitize(html);

    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeCuckModal() {
    var backdrop = document.getElementById('cuckModalBackdrop');
    if (!backdrop) return;
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  var _cuckModalInitialized = false;
  function initCuckModal() {
    if (_cuckModalInitialized) return;
    var backdrop = document.getElementById('cuckModalBackdrop');
    var closeBtn = document.getElementById('cuckModalClose');
    if (!backdrop || !closeBtn) return;
    _cuckModalInitialized = true;

    closeBtn.addEventListener('click', closeCuckModal);

    var mouseDownOnBackdrop = false;
    backdrop.addEventListener('mousedown', function (e) {
      mouseDownOnBackdrop = e.target === backdrop;
    });
    backdrop.addEventListener('mouseup', function (e) {
      if (mouseDownOnBackdrop && e.target === backdrop) closeCuckModal();
      mouseDownOnBackdrop = false;
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!backdrop.classList.contains('open')) return;
      var others = document.querySelectorAll('.modal-backdrop.open');
      if (others.length === 1 && others[0] === backdrop) closeCuckModal();
    });
  }


})();
