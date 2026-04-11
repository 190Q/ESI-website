(function () {
  'use strict';

  /* ── Tracker definitions ── */
  var TRACKERS = [
    { name: 'API Tracker',      interval: 300, color: '#5865F2' },
    { name: 'Playtime Tracker', interval: 300, color: '#9B59B6' },
    { name: 'Guild Tracker',    interval: 30,  color: '#D4A017' },
    { name: 'Claim Tracker',    interval: 3,   color: '#3BA55C' },
  ];

  var trackerTimers = {};
  var botInitialized = false;
  var botStartTime = Date.now();

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
      _botToast.addItem('snapshot', 'Discord Server');
      _botToast.addItem('db',       'Databases');
      _bTotal = 4;
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

    // These don't need data
    initTrackers();
    startUptimeTicker();
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

    statusEl.className   = 'status-pill online';
    statusEl.textContent = '● Online';
    latencyEl.textContent = 'Latency: ' + status.latency + 'ms';
    uptimeEl.textContent  = 'Uptime: ' + formatDuration(Date.now() - botStartTime);
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
      var elapsed = Date.now() - botStartTime;
      var str = formatDuration(elapsed);
      var uptimeEl = document.getElementById('botUptime');
      if (uptimeEl) uptimeEl.textContent = 'Uptime: ' + str;
      var tEl = document.getElementById('trackerHeaderUptime');
      if (tEl) tEl.textContent = str;
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

  function initTrackers() {
    var list = document.getElementById('trackerList');
    var html = '';

    for (var i = 0; i < TRACKERS.length; i++) {
      var t = TRACKERS[i];
      trackerTimers[i] = 0; // all start at the same time
      html += '<div class="tracker-item">' +
        '<div class="tracker-header">' +
        '<span class="tracker-name">' + t.name + '</span>' +
        '<span class="tracker-time" id="trackerTime' + i + '">0s</span></div>' +
        '<div class="tracker-bar-track">' +
        '<div class="tracker-bar-fill" id="trackerBar' + i + '" style="width:0%;background:linear-gradient(90deg,' + t.color + '88,' + t.color + ')"></div></div>' +
        '<div class="tracker-interval">Every ' + formatInterval(t.interval) + '</div></div>';
    }

    list.innerHTML = html;
    setInterval(tickTrackers, 1000);
    tickTrackers();
  }

  function tickTrackers() {
    for (var i = 0; i < TRACKERS.length; i++) {
      var t = TRACKERS[i];
      trackerTimers[i]--;
      if (trackerTimers[i] <= 0) {
        trackerTimers[i] = t.interval;
      }
      var remaining = trackerTimers[i];
      var pct = ((t.interval - remaining) / t.interval) * 100;
      var timeEl = document.getElementById('trackerTime' + i);
      var barEl  = document.getElementById('trackerBar' + i);
      if (timeEl) timeEl.textContent = formatCountdown(remaining);
      if (barEl)  barEl.style.width  = pct + '%';
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


})();
