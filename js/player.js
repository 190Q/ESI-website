(function () {
  'use strict';

  const state = window.state;
  const GraphShared = window.GraphShared;

  const _userRoles = (window.state && window.state.user && window.state.user.roles) || [];
  const canClear = _userRoles.includes('1396112289832243282') || _userRoles.includes('554514823191199747');

  /* graph config */
  const graphState = { data: null, compareData: null, compareUsername: null, compareInGuild: null, compareLoading: false, graphReady: false, graphCache: {}, debugLogged: {}, debugFetchTried: {} };
  const GRAPH_METRICS = [
    { key: 'playtime',    label: 'Playtime',      min: 0.5, max: 8,    decimals: 1 },
    { key: 'wars',        label: 'Wars',          min: 0,   max: 10,   decimals: 0 },
    { key: 'guildRaids',  label: 'Guild Raids',   min: 0,   max: 4,    decimals: 0 },
    { key: 'mobsKilled',  label: 'Mobs Killed',   min: 100, max: 3000, decimals: 0 },
    { key: 'chestsFound', label: 'Chests Found',  min: 5,   max: 150,  decimals: 0 },
    { key: 'questsDone',  label: 'Quests Done',   min: 0,   max: 5,    decimals: 0 },
    { key: 'totalLevel',  label: 'Total Level',   min: 0,   max: 3,    decimals: 0 },
    { key: 'contentDone', label: 'Content Done',  min: 0,   max: 2,    decimals: 1 },
    { key: 'dungeons',    label: 'Dungeons',      min: 0,   max: 8,    decimals: 0 },
    { key: 'raids',       label: 'Raids',         min: 0,   max: 5,    decimals: 0 },
    { key: 'worldEvents', label: 'World Events',  min: 0,   max: 10,   decimals: 0 },
    { key: 'caves',       label: 'Caves',         min: 0,   max: 3,    decimals: 0 },
  ];
  const METRICS_DEBUG_ENABLED = /^(1|true|yes|on)$/i.test(
    (new URLSearchParams(window.location.search).get('metricsDebug') || '').trim()
  );
  let pendingGraphFocus = null;
  let pendingGraphMetrics = null;

  /* dom refs */
  const searchBtn   = document.getElementById('searchPlayerBtn');
  const playerInput = document.getElementById('playerInput');

  /* apply default player from settings */
  var _defaultPlayer = (window.esiSettings && window.esiSettings.get('defaultPlayer')) || '';
  if (_defaultPlayer) playerInput.value = _defaultPlayer;
  else if (!playerInput.value) playerInput.value = '190Q';

  /* events */
  searchBtn.addEventListener('click', () => {
    const username = playerInput.value.trim();
    if (username) { lookupPlayer(username); updateHash(); }
  });
  playerInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const username = playerInput.value.trim();
      if (username) { lookupPlayer(username); updateHash(); }
    }
  });

  document.getElementById('viewGlobal').addEventListener('click',    () => switchView('global'));
  document.getElementById('viewCharacter').addEventListener('click', () => switchView('character'));
  document.getElementById('viewRankHistory').addEventListener('click', () => switchView('rankHistory'));

  function switchView(v) {
    state.currentView = v;
    document.getElementById('viewGlobal').classList.toggle('active',       v === 'global');
    document.getElementById('viewCharacter').classList.toggle('active',    v === 'character');
    document.getElementById('viewRankHistory').classList.toggle('active',  v === 'rankHistory');
    document.getElementById('globalView').style.display       = v === 'global'      ? 'block' : 'none';
    document.getElementById('characterView').style.display    = v === 'character'   ? 'block' : 'none';
    document.getElementById('rankHistoryView').style.display  = v === 'rankHistory' ? 'block' : 'none';
    if (v === 'rankHistory') renderRankHistory();
  }

  function _updateViewSelector() {
    var sel = document.querySelector('#playerContent .view-selector');
    if (!sel) return;
    var visible = Array.from(sel.querySelectorAll('.view-btn'))
      .filter(function (b) { return b.style.display !== 'none'; }).length;
    sel.style.display = visible > 1 ? '' : 'none';
  }

  function renderRankHistory() {
    const el = document.getElementById('rankHistoryContent');
    const data = state.rankHistory;
    if (!el) return;
    if (!data || !data.rank_changes || !data.rank_changes.length) {
      el.innerHTML = '<div class="info-card"><div class="info-card-header">Rank History</div>' +
        '<div style="padding:16px 20px;color:var(--text-faint);font-style:italic">No rank history available.</div></div>';
      return;
    }
    const capFirst = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
    const fmtTs = iso => {
      if (!iso) return 'Unknown';
      return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    };
    let rows = '';
    let changes = data.rank_changes;
    if (data.joined) {
      const joinTime = new Date(data.joined).getTime();
      changes = changes.filter(c => c.timestamp && new Date(c.timestamp).getTime() >= joinTime);
    }
    const RANK_ORDER = ['recruit', 'recruiter', 'captain', 'strategist', 'chief', 'owner'];
    changes.slice().reverse().forEach(c => {
      const isPromotion = RANK_ORDER.indexOf(c.to) > RANK_ORDER.indexOf(c.from);
      const icon = isPromotion ? '▲' : '▼';
      const iconColor = isPromotion ? 'var(--gold-light)' : 'var(--warn)';
      rows += `<div class="rank-history-entry">
        <span class="rank-history-icon" style="color:${iconColor}">${icon}</span>
        <span class="guild-rank-badge guild-rank-${c.from}">${capFirst(c.from)}</span>
        <span style="color:var(--text-faint);margin:0 4px">→</span>
        <span class="guild-rank-badge guild-rank-${c.to}">${capFirst(c.to)}</span>
        <span class="rank-history-date">${fmtTs(c.timestamp)}</span>
      </div>`;
    });
    if (data.joined) {
      rows += `<div class="rank-history-entry">
        <span class="rank-history-icon" style="color:var(--online)">✚</span>
        <span class="rank-history-label">Joined guild</span>
        <span class="rank-history-date">${fmtTs(data.joined)}</span>
      </div>`;
    }
    el.innerHTML = `<div class="info-card">
      <div class="info-card-header">Rank History</div>
      <div class="rank-history-list">${rows}</div>
    </div>`;
  }

  document.getElementById('charSelect').addEventListener('change', function () {
    renderCharacter(this.value);
  });

  /* api */
  const API_BASE = window.location.origin;

  async function apiFetch(path) {
    const res = await fetch(API_BASE + path);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Server error ${res.status}`);
    }
    return res.json();
  }
  function parseDateKeyUtc(dateKey) {
    if (typeof dateKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
    const d = new Date(dateKey + 'T00:00:00Z');
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function toUtcDateKey(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    const raw = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return y + '-' + m + '-' + day;
  }

  function getUtcDayOffset(dateObj) {
    if (!dateObj || Number.isNaN(dateObj.getTime())) return NaN;
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const targetUtc = Date.UTC(dateObj.getUTCFullYear(), dateObj.getUTCMonth(), dateObj.getUTCDate());
    return Math.round((todayUtc - targetUtc) / 86400000);
  }

  function normalizeGraphFocus(graphFocus) {
    if (!graphFocus || typeof graphFocus !== 'object') return null;
    if (typeof graphFocus.week === 'string') {
      const parts = graphFocus.week.split('_');
      if (parts.length !== 2) return null;
      const startDate = parseDateKeyUtc(parts[0]);
      const endDate = parseDateKeyUtc(parts[1]);
      if (!startDate || !endDate) return null;
      const startOffset = getUtcDayOffset(startDate);
      const endOffset = getUtcDayOffset(endDate);
      if (!Number.isFinite(startOffset) || !Number.isFinite(endOffset)) return null;
      const olderOffset = Math.max(startOffset, endOffset);
      const newerOffset = Math.min(startOffset, endOffset);
      if (olderOffset < 0) return null;
      return {
        rangeDays: olderOffset + 1,
        selectedDayOffset: Math.max(0, newerOffset),
        weekStartKey: parts[0],
        weekEndKey: parts[1],
      };
    }
    if (!Number.isFinite(graphFocus.rangeDays)) return null;
    return {
      rangeDays: Math.max(2, Math.round(graphFocus.rangeDays)),
      selectedDayOffset: Number.isFinite(graphFocus.selectedDayOffset) ? Math.max(0, Math.round(graphFocus.selectedDayOffset)) : null,
    };
  }

  function consumePendingGraphFocus() {
    const focus = pendingGraphFocus;
    pendingGraphFocus = null;
    return focus;
  }

  function consumePendingGraphMetrics() {
    const metrics = pendingGraphMetrics;
    pendingGraphMetrics = null;
    return metrics;
  }

  function resolveGraphFocusFromWeekData(graphFocus, username) {
    if (!graphFocus || !graphFocus.weekStartKey || !graphFocus.weekEndKey || !username) return null;
    const cache = window.playtimeCache && window.playtimeCache[username.toLowerCase()];
    if (!cache) return null;
    const dates = Array.isArray(cache.dates) && cache.dates.length
      ? cache.dates
      : (Array.isArray(cache.metricDates) ? cache.metricDates : []);
    const data = Array.isArray(cache.data) ? cache.data : [];
    const rawLen = Math.min(dates.length, data.length);
    if (!rawLen) return null;

    let first = -1;
    let last = -1;
    for (let i = 0; i < rawLen; i++) {
      const dayKey = toUtcDateKey(dates[i]);
      if (!dayKey) continue;
      if (dayKey >= graphFocus.weekStartKey && dayKey <= graphFocus.weekEndKey) {
        if (first === -1) first = i;
        last = i;
      }
    }
    if (first === -1 || last === -1) return null;

    const padCount = Math.max(0, 60 - rawLen);
    const paddedStart = padCount + first;
    const paddedEnd = padCount + last;
    if (paddedStart > 59 || paddedEnd > 59) return null;

    return {
      rangeDays: Math.max(2, 60 - paddedStart),
      selectedDayOffset: Math.max(0, 59 - paddedEnd),
    };
  }

  function applyPendingGraphFocus(graphFocus, maxDataPoints, username) {
    if (!graphFocus) return;
    const resolved = resolveGraphFocusFromWeekData(graphFocus, username) || graphFocus;
    const rangeMin = parseInt(compareGraph.range.min, 10) || 2;
    const rangeMaxRaw = parseInt(compareGraph.range.max, 10) || 60;
    const dataCap = Number.isFinite(maxDataPoints) && maxDataPoints > 0 ? Math.round(maxDataPoints) : rangeMaxRaw;
    const rangeMax = Math.max(rangeMin, Math.min(rangeMaxRaw, dataCap));
    const rangeDays = Math.max(rangeMin, Math.min(rangeMax, Math.round(resolved.rangeDays)));
    compareGraph.days = rangeDays;
    compareGraph.range.value = String(rangeDays);
    compareGraph.daysLbl.textContent = rangeDays + 'd';
    if (resolved.selectedDayOffset != null) {
      compareGraph.selectedDayOffset = Math.max(0, Math.min(rangeDays - 1, Math.round(resolved.selectedDayOffset)));
    }
  }

  async function lookupPlayer(username, options) {
    if (!username) return;
    searchBtn.disabled = true;
    searchBtn.textContent = '\uD83D\uDD0D\uFE0E Looking up\u2026';
    pendingGraphFocus = normalizeGraphFocus(options && options.graphFocus);
    pendingGraphMetrics = options && Array.isArray(options.graphMetrics) ? options.graphMetrics : null;

    // if re-fetching the same player, keep the old UI up while it's loading
    const isRefetch = !!(state.playerData && state.playerData.username &&
      state.playerData.username.toLowerCase() === username.toLowerCase());

    // same player and graph already loaded then just switch the metric/focus, skip all fetches
    if (isRefetch && graphState.graphReady && graphState.data && (pendingGraphFocus || pendingGraphMetrics)) {
      var focus   = consumePendingGraphFocus();
      var metrics = consumePendingGraphMetrics();
      if (focus) {
        applyPendingGraphFocus(focus, graphState.data.playtime ? graphState.data.playtime.length : 60, username);
      }
      if (metrics && metrics.length) {
        var available = getAvailableMetrics();
        var valid = metrics.filter(function (k) { return available.some(function (m) { return m.key === k; }); });
        if (valid.length) compareGraph.metrics = valid;
      }
      renderMetricRows();
      refreshCompareGraph();
      searchBtn.disabled = false;
      searchBtn.textContent = '\uD83D\uDD0D\uFE0E Look Up';
      return;
    }

    // check sessionStorage first (survives page refresh)
    const playerCacheUrl = '/api/player/' + encodeURIComponent(username);
    const cachedPlayer = !isRefetch ? DataCache.readCache(playerCacheUrl) : null;

    // show cached data instantly so there's no flash of loading state
    if (cachedPlayer && !isRefetch) {
      state.playerData = cachedPlayer;
      state.guildData = null;
      document.getElementById('playerLoading').style.display = 'none';
      document.getElementById('playerError').style.display = 'none';
      renderPlayer(cachedPlayer, null);
      if (cachedPlayer.guild && cachedPlayer.guild.prefix) {
        var cg = DataCache.readCache('/api/guild/prefix/' + encodeURIComponent(cachedPlayer.guild.prefix));
        if (cg) { state.guildData = cg; updatePlayerGuildXp(cachedPlayer, cg); }
      }
    }

    const skipLoading = isRefetch || !!cachedPlayer;

    // kill any old progress toast
    if (state._fetchToast) { state._fetchToast.dismiss(); state._fetchToast = null; }

    var _pDone = 0, _pTotal = 0;
    delete graphState.graphCache[username.toLowerCase()];
    if (!skipLoading) {
      setPlayerLoading(true, username);
    } else if (typeof window.showProgressToast === 'function') {
      var pt = window.showProgressToast('Fetching player data\u2026');
      pt.addItem('api', 'Wynncraft API');
      pt.addItem('graph', 'Activity Data');
      pt.addItem('aspects', 'Aspects Data');
      _pTotal = 3;
      state._fetchToast = pt;
    }

    var _finishMsgs = {
      success: '\u2713 Player data loaded',
      fail:    '\u2715 Failed to load player data',
      partial: '\u26a0 Player data partially loaded',
    };
    function _pCheckDone() {
      _pDone++;
      if (_pDone >= _pTotal && state._fetchToast) { state._fetchToast.finish(_finishMsgs); state._fetchToast = null; }
    }

    // aspects data loads at page start
    if (state._fetchToast) {
      (window.aspectsDataPromise || Promise.resolve()).then(function () {
        if (state._fetchToast) state._fetchToast.updateItem('aspects', 'success');
        _pCheckDone();
      });
    }

    // graph loads independently from the profile API call
    var graphP = initGraphIndependent(username, skipLoading);
    if (graphP && state._fetchToast) {
      graphP.then(function (ok) {
        if (state._fetchToast) state._fetchToast.updateItem('graph', ok ? 'success' : 'error');
        _pCheckDone();
      });
    }

    // profile/stats API call (doesn't block the graph)
    try {
      const _playerRes = await fetch(API_BASE + playerCacheUrl);
      if (!_playerRes.ok) {
        const _body = await _playerRes.json().catch(() => ({}));
        throw new Error(_body.message || `Server error ${_playerRes.status}`);
      }
      const player = await _playerRes.json();
      const _isFallback = !!_playerRes.headers.get('X-Wynncraft-Fallback');
      if (_isFallback && typeof window.showToast === 'function') {
        window.showToast('\u26a0 Full player data unavailable \u2014 character data may be missing.', 'warn');
      }
      DataCache.writeCache(playerCacheUrl, player);
      if (state._fetchToast) state._fetchToast.updateItem('api', 'success');

      state.playerData = player;
      state.guildData  = null;
      renderPlayer(player, null, _isFallback);
      document.getElementById('playerLoading').style.display = 'none';

      // rank history for ESI members
      if (isEsiGuildMember(player) && state._rankHistoryP) {
        if (state._fetchToast) { state._fetchToast.addItem('rankHistory', 'Rank History'); _pTotal++; }
        state._rankHistoryP.then(function (ok) {
          if (state._fetchToast) state._fetchToast.updateItem('rankHistory', ok ? 'success' : 'error');
          _pCheckDone();
        });
      }

      // guild data in the background, doesn't block the render
      if (player.guild && player.guild.prefix) {
        if (state._fetchToast) { state._fetchToast.addItem('guild', 'Guild Data'); _pTotal++; }
        var guildCacheUrl = '/api/guild/prefix/' + encodeURIComponent(player.guild.prefix);
        apiFetch(guildCacheUrl)
          .then(function (guild) {
            DataCache.writeCache(guildCacheUrl, guild);
            state.guildData = guild;
            updatePlayerGuildXp(player, guild);
            if (state._fetchToast) state._fetchToast.updateItem('guild', 'success');
            _pCheckDone();
          })
          .catch(function () {
            if (state._fetchToast) state._fetchToast.updateItem('guild', 'error');
            _pCheckDone();
          });
      }
      _pCheckDone(); // api done
    } catch (err) {
      var _hadProgressToast = !!state._fetchToast;
      if (state._fetchToast) state._fetchToast.updateItem('api', 'error');
      _pCheckDone(); // api done (failed) — may null state._fetchToast
      // only show a standalone error toast if there wasn't already a progress toast
      if (!_hadProgressToast && skipLoading && typeof window.showToast === 'function') {
        window.showToast('\u26a0 ' + friendlyPlayerLookupError(err.message, username), 'error');
      }
      if (!skipLoading) {
        // replace loading state with failure placeholders
        document.getElementById('playerLoading').style.display = 'none';
        document.getElementById('playerName').textContent = username;
        document.getElementById('playerOnlineStatus').textContent = '\u25cf Unavailable';
        document.getElementById('playerOnlineStatus').className = 'status-pill offline';
        document.getElementById('playerLastSeen').textContent = '';
        document.getElementById('playerFirstJoin').textContent = '';
        document.getElementById('playerGuild').textContent = '';
        document.getElementById('playerGuild').parentElement.style.display = 'none';
        document.getElementById('guildXpRow').innerHTML = '';
        document.getElementById('owedCards').innerHTML = '';
        document.getElementById('owedCards').style.display = 'none';
        var failLabels = ['Playtime','Wars','Mobs Killed','Chests Found','Quests Done','Total Level','Content Done','Dungeons','Raids','Guild Raids','World Events','Caves'];
        document.getElementById('globalStatsGrid').innerHTML = failLabels.map(function (lbl) {
          return '<div class="stat-list-row"><span class="stat-list-label">' + lbl + '</span><span class="stat-list-value" style="color:var(--text-faint)">\u2014</span></div>';
        }).join('');
        if (typeof window.showToast === 'function') {
          window.showToast('\u26a0 ' + friendlyPlayerLookupError(err.message, username), 'error', { persistent: true });
        }
      }
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = '\uD83D\uDD0D\uFE0E Look Up';
    }
  }

  function setPlayerLoading(loading, username) {
    document.getElementById('playerLoading').style.display = loading ? 'flex' : 'none';
    document.getElementById('playerError').style.display   = 'none';
    if (loading) {
      // show the layout immediately with placeholder text everywhere
      var contentEl = document.getElementById('playerContent');
      contentEl.style.display = 'block';
      var skinEl = document.getElementById('playerSkin');
      skinEl.style.visibility = 'hidden';
      skinEl.removeAttribute('src');
      document.getElementById('playerName').textContent = 'Loading\u2026';
      document.getElementById('playerRankBadge').style.display = 'none';
      document.getElementById('playerOnlineStatus').textContent = '\u25cf Loading';
      document.getElementById('playerOnlineStatus').className = 'status-pill';
      document.getElementById('playerLastSeen').textContent = 'Loading\u2026';
      document.getElementById('playerFirstJoin').textContent = 'Loading\u2026';
      document.getElementById('playerGuild').textContent = 'Loading\u2026';
      document.getElementById('playerGuild').parentElement.style.display = '';
      document.getElementById('playerGuildRank').textContent = '';
      document.getElementById('guildXpRow').innerHTML = '<span style="color:var(--text-faint);font-style:italic">Loading\u2026</span>';
      // owed cards placeholders
      var owedEl = document.getElementById('owedCards');
      owedEl.style.display = '';
      owedEl.innerHTML =
        '<div class="owed-card"><div class="owed-value" style="color:var(--text-faint)">\u2026</div><div class="owed-label">Loading</div></div>' +
        '<div class="owed-card"><div class="owed-value" style="color:var(--text-faint)">\u2026</div><div class="owed-label">Loading</div></div>';
      // stats grid placeholders
      var statsLabels = ['Playtime','Wars','Mobs Killed','Chests Found','Quests Done','Total Level','Content Done','Dungeons','Raids','Guild Raids','World Events','Caves'];
      var globalGrid = document.getElementById('globalStatsGrid');
      globalGrid.innerHTML = statsLabels.map(function (lbl) {
        return '<div class="stat-list-row"><span class="stat-list-label">' + lbl + '</span><span class="stat-list-value" style="color:var(--text-faint);font-style:italic">\u2026</span></div>';
      }).join('');
      document.getElementById('globalRaidsCard').style.display = 'none';
      document.getElementById('globalDungeonsCard').style.display = 'none';
      // hide view buttons until real data arrives
      document.querySelector('#playerContent .view-selector').style.display = 'none';
      document.getElementById('viewRankHistory').style.display = 'none';
      document.getElementById('characterView').style.display = 'none';
      document.getElementById('rankHistoryView').style.display = 'none';
      // graph handles its own loading state
      var splitEl = document.querySelector('#playerContent .player-split-layout');
      if (splitEl) splitEl.style.display = '';
      setGraphLoading(true);
      setPlayerCompareEnabled(false, 'Loading activity data\u2026');
      compareGraph.daysLbl.textContent = parseInt(compareGraph.range.value) + 'd';
      switchView('global');
    }
  }

  function setPlayerError(msg) {
    document.getElementById('playerLoading').style.display = 'none';
    document.getElementById('playerError').style.display   = 'block';
    document.getElementById('playerError').textContent     = '\u26a0 ' + msg;
    document.getElementById('playerContent').style.display = 'none';
  }

  /* helpers */
  function fmt(n)      { return n == null ? 'N/A' : Number(n).toLocaleString(); }
  function fmtHours(h) { return h == null ? 'N/A' : Number(h).toFixed(1).replace('.', ',') + ' hrs'; }
  function fmtDate(iso) {
    if (!iso) return 'N/A';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function fmtRelative(iso) {
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function isEsiGuildMember(player) {
    if (!player || !player.guild) return false;
    const guildPrefix = (player.guild.prefix || '').toUpperCase();
    const guildName   = (player.guild.name   || '').toLowerCase();
    return guildPrefix === 'ESI' || guildName === 'empire of sindria';
  }

  function friendlyApiError(msg, subject) {
    var text = String(msg || '').trim();
    var lower = text.toLowerCase();
    var label = subject || 'data';
    if (!text) return 'Could not fetch ' + label + '. Please try again.';
    if (lower.includes('not found') || lower.includes('404'))
      return label.charAt(0).toUpperCase() + label.slice(1) + ' was not found. Check the name and try again.';
    if (lower.includes('too many requests') || lower.includes('rate limit') || lower.includes('429'))
      return 'Too many requests. Please slow down and try again.';
    if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('too long'))
      return 'Wynncraft took too long to respond. Try again shortly.';
    if (lower.includes('could not reach') || lower.includes('network') || lower.includes('failed to fetch') || lower.includes('max retries') || lower.includes('connectionpool'))
      return 'Could not reach Wynncraft right now. Try again shortly.';
    if (lower.includes('server error') || lower.includes('502') || lower.includes('503'))
      return 'Wynncraft is having issues right now. Try again shortly.';
    // keep it short for the toast
    return text.length > 80 ? text.substring(0, 77) + '\u2026' : text;
  }

  function friendlyPlayerLookupError(msg, username) {
    return friendlyApiError(msg, username ? '"' + username + '"' : 'player data');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, ch => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[ch]);
  }

  /* render player */
  function renderPlayer(p, guild, isFallback) {
    /* skin */
    const skinEl = document.getElementById('playerSkin');
    skinEl.style.visibility = '';
    skinEl.src = `https://crafatar.com/avatars/${p.uuid}?size=80&overlay`;
    skinEl.onerror = () => { skinEl.src = `https://mc-heads.net/avatar/${p.username}/80`; };

    /* name */
    document.getElementById('playerName').textContent = p.username || 'N/A';

    /* rank badge */
    const rankEl  = document.getElementById('playerRankBadge');
    const support = (p.supportRank || 'player').toLowerCase();
    if (support == 'player') {
      rankEl.style.display = 'none';
    } else {
      rankEl.style.display = '';
      rankEl.textContent = support.replace('plus', '+').toUpperCase();
      rankEl.className   = 'profile-rank-badge rank-' + support;
    }

    /* online/offline */
    const onlineEl = document.getElementById('playerOnlineStatus');
    if (p.online) {
      onlineEl.innerHTML  = '● Online';
      onlineEl.className  = 'status-pill online';
    } else {
      onlineEl.innerHTML  = '● Offline';
      onlineEl.className  = 'status-pill offline';
    }

    /* last seen + first join */
    const lastSeenEl = document.getElementById('playerLastSeen');
    if (!p.online && p.lastJoin) {
      lastSeenEl.textContent = 'Last seen: ' + fmtRelative(p.lastJoin) + ' (' + fmtDate(p.lastJoin) + ')';
    } else if (p.online && p.server) {
      lastSeenEl.textContent = 'Server: ' + p.server;
    } else {
      lastSeenEl.textContent = '';
    }
    document.getElementById('playerFirstJoin').textContent = 'First joined: ' + fmtDate(p.firstJoin);

    /* guild info */
    const guildEl     = document.getElementById('playerGuild');
    const guildRankEl = document.getElementById('playerGuildRank');
    const guildXpRow  = document.getElementById('guildXpRow');
    if (p.guild) {
      guildEl.parentElement.style.display = '';
      guildXpRow.style.display = '';
      guildEl.textContent = '⚜ ' + (p.guild.name || p.guild.prefix);
      // only make the guild name clickable if it's ESI
      if ((p.guild.prefix || '').toUpperCase() === 'ESI' || (p.guild.name || '').toLowerCase() === 'empire of sindria') {
        guildEl.style.cursor = 'pointer';
        guildEl.classList.add('guild-log-name-link');
        guildEl.onclick = function() {
          const guildNavBtn = document.querySelector('[data-panel="guild"]');
          if (guildNavBtn) guildNavBtn.click();
          else if (window.switchToPanel) window.switchToPanel('guild');
          history.pushState(null, '', '/guild');
        };
      } else {
        guildEl.style.cursor = '';
        guildEl.classList.remove('guild-log-name-link');
        guildEl.onclick = null;
      }
      const stars = p.guild.rankStars ? ' ' + p.guild.rankStars : '';
      guildRankEl.textContent = (p.guild.rank || '') + stars;

      // if they're a recruit/recruiter in ESI, clicking the rank goes to promotions
      const isEsi = (p.guild.prefix || '').toUpperCase() === 'ESI' || (p.guild.name || '').toLowerCase() === 'empire of sindria';
      const isRecruit   = (p.guild.rank || '').toLowerCase() === 'recruit';
      const isRecruiter = (p.guild.rank || '').toLowerCase() === 'recruiter';

      var canViewPromotions = typeof window.hasJurorPlus === 'function' && window.hasJurorPlus();
      if (isEsi && (isRecruit || isRecruiter) && canViewPromotions) {
        guildRankEl.style.cursor = 'pointer';
        guildRankEl.style.textDecorationColor = 'rgba(212,160,23,0.4)';
        guildRankEl.onclick = function() {
          if (window.switchToPanel) window.switchToPanel('promotions');
          history.pushState(null, '', '/promotions');
          setTimeout(function() {
            // Switch to correct tab
            var tab = isRecruiter ? 'captain' : 'recruiter';
            var tabBtn = document.querySelector('.prom-tab[data-tab="' + tab + '"]');
            if (tabBtn) tabBtn.click();
            // Fill search
            var searchEl = document.getElementById('promSearch');
            if (searchEl) {
              searchEl.value = p.username;
              searchEl.dispatchEvent(new Event('input'));
            }
          }, 150);
        };
      } else {
        guildRankEl.style.cursor = '';
        guildRankEl.style.textDecoration = '';
        guildRankEl.onclick = null;
      }

      if (guild && guild.members) {
        let memberData = null;
        for (const roleGroup of Object.values(guild.members)) {
          if (typeof roleGroup === 'object' && !Array.isArray(roleGroup)) {
            for (const [name, data] of Object.entries(roleGroup)) {
              if (name === p.username) { memberData = data; break; }
            }
          }
          if (memberData) break;
        }
        if (memberData) {
          const contrib    = memberData.contributed || 0;
          const contribRnk = memberData.contributionRank || 'N/A';
          const joinedStr  = memberData.joined ? ' &nbsp;·&nbsp; Joined: <strong style="color:var(--gold-light)">' + fmtDate(memberData.joined) + '</strong>' : '';
          guildXpRow.innerHTML = `
            <span>Guild XP Contributed: <strong style="color:var(--gold-light)">${fmt(contrib)}</strong>
            &nbsp;·&nbsp; Contribution Rank: <strong style="color:var(--gold-light)">#${contribRnk}</strong>${joinedStr}</span>`;
        } else {
          guildXpRow.innerHTML = '';
        }
      } else if (guild) {
        guildXpRow.innerHTML = '';
      }
    } else {
      guildEl.parentElement.style.display = 'none';
      guildXpRow.style.display = 'none';
    }

    /* track guild membership for metric filtering */
    state.playerInGuild = isEsiGuildMember(p);

    /* re-render metric rows now that guild membership is known */
    if (graphState.graphReady) renderMetricRows();

    /* rank history button (ESI members only) */
    const rankHistBtn = document.getElementById('viewRankHistory');
    if (rankHistBtn) {
      rankHistBtn.style.display = 'none';
      state._rankHistoryP = null;
      if (isEsiGuildMember(p)) {
        state._rankHistoryP = fetch('/api/player/' + encodeURIComponent(p.username) + '/rank-history')
          .then(r => r.ok ? r.json() : { rank_changes: [] })
          .then(data => {
            if (data.rank_changes && data.rank_changes.length) {
              rankHistBtn.style.display = '';
              _updateViewSelector();
              state.rankHistory = data;
            } else {
              state.rankHistory = null;
            }
            return true;
          })
          .catch(() => { state.rankHistory = null; return false; });
      } else {
        state.rankHistory = null;
      }
    }

    /* global stats */
    const g = p.globalData || {};
    const globalGrid = document.getElementById('globalStatsGrid');
    globalGrid.innerHTML = '';
    const globalStats = [
      { val: fmtHours(p.playtime),                        label: 'Playtime'     },
      { val: fmt(g.wars),                                  label: 'Wars'         },
      { val: fmt(g.mobsKilled),                            label: 'Mobs Killed'  },
      { val: fmt(g.chestsFound),                           label: 'Chests Found' },
      { val: fmt(g.completedQuests),                       label: 'Quests Done'  },
      { val: fmt(g.totalLevel),                            label: 'Total Level'  },
      { val: fmt(g.contentCompletion),                      label: 'Content Done' },
      { val: fmt(g.dungeons  ? g.dungeons.total  : null),  label: 'Dungeons'     },
      { val: fmt(g.raids     ? g.raids.total     : null),  label: 'Raids'        },
      { val: fmt(g.guildRaids ? g.guildRaids.total : null), label: 'Guild Raids'  },
      { val: fmt(g.worldEvents),                           label: 'World Events' },
      { val: fmt(g.caves),                                  label: 'Caves'        },
    ];
    globalStats.forEach(s => {
      const el = document.createElement('div');
      el.className = 'stat-list-row';
      el.innerHTML = `<span class="stat-list-label">${s.label}</span><span class="stat-list-value">${s.val}</span>`;
      globalGrid.appendChild(el);
    });

    /* owed cards */
    const owedEl = document.getElementById('owedCards');
    if (isEsiGuildMember(p)) {
      const aspectsData = window.aspectsData || { members: {} };
      const playerUuid  = Object.entries(aspectsData.members || {}).find(([, m]) => m.name === p.username);
      const playerAspectsUuid  = playerUuid ? playerUuid[0] : null;
      const playerEntry = playerUuid ? playerUuid[1] : null;
      owedEl.style.display = '';

      // mutable copy so clears show up right away
      const localAspectsData = JSON.parse(JSON.stringify(aspectsData));

      function getPlayerOwed() {
        const entry = playerAspectsUuid && localAspectsData.members[playerAspectsUuid];
        return entry ? (entry.owed || 0) : 0;
      }

      function owedColor(n) {
        return n >= 105 ? '#e74c3c' : n >= 60 ? '#e67e22' : n >= 30 ? '#f1c40f' : 'var(--online)';
      }

      owedEl.innerHTML = `
        <div class="owed-card owed-card-clickable" id="playerOwedAspectsCard">
          <div class="owed-icon"><img src="/images/aspect_icon.avif" alt="aspect" style="width:32px;height:32px;image-rendering:pixelated"></div>
          <div class="owed-value" id="playerOwedAspectsVal">${fmt(getPlayerOwed())}</div>
          <div class="owed-label">Owed Aspects</div>
        </div>
        <div class="owed-card">
          <div class="owed-icon"><img src="/images/point_icon.png" alt="point" style="width:32px;height:32px;image-rendering:pixelated"></div>
          <div class="owed-value">Coming soon</div>
          <div class="owed-label">ESI Points</div>
        </div>`;

      // clean up any leftover popup from the previous lookup
      const existingPopup   = document.getElementById('playerOwedAspectsPopup');
      const existingOverlay = document.getElementById('playerOwedAspectsOverlay');
      if (existingPopup)   existingPopup.remove();
      if (existingOverlay) existingOverlay.remove();

      const popup = document.createElement('div');
      popup.id = 'playerOwedAspectsPopup';
      popup.className = 'owed-aspects-popup';
      document.body.appendChild(popup);

      const overlay = document.createElement('div');
      overlay.id = 'playerOwedAspectsOverlay';
      overlay.className = 'owed-aspects-overlay';
      document.body.appendChild(overlay);

      function renderPlayerOwedPopup() {
        const owed = getPlayerOwed();
        const name = p.username;
        popup.innerHTML = `
          <div class="owed-aspects-popup-header">
            <span class="owed-aspects-popup-title">
              <img src="/images/aspect_icon.avif" alt="aspect" style="width:16px;height:16px;image-rendering:pixelated;vertical-align:middle;margin-right:6px">Aspects Owed
              <span class="owed-aspects-popup-count" style="color:${owedColor(owed)}">${owed}</span>
            </span>
            <button class="owed-aspects-popup-close" id="playerOwedAspectsClose">✕</button>
          </div>
          <div class="owed-aspects-popup-list">
            ${playerAspectsUuid && owed > 0
              ? `<div class="owed-aspects-row">
                    <span class="owed-aspects-player-name">${name}</span>
                    <div class="owed-aspects-right">
                      <span class="owed-aspects-player-count">${owed} owed</span>
                      ${canClear ? `<button class="owed-aspects-clear-btn" id="playerOwedClearBtn" title="Clear aspects for ${name}">Clear</button>` : ''}
                    </div>
                  </div>`
              : '<div class="owed-aspects-empty">No aspects owed</div>'
            }
          </div>`;

        document.getElementById('playerOwedAspectsClose').addEventListener('click', e => {
          e.stopPropagation();
          closePlayerOwedPopup();
        });

        const clearBtn = document.getElementById('playerOwedClearBtn');
        if (clearBtn) {
          clearBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            clearBtn.disabled = true;
            clearBtn.textContent = '...';
            try {
              const res = await fetch('/api/guild/aspects/clear', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uuid: playerAspectsUuid }),
              });
              if (!res.ok) throw new Error('Server error ' + res.status);

              localAspectsData.members[playerAspectsUuid].owed = 0;
              window.aspectsData = localAspectsData;

              // update the card immediately
              const cardVal = document.getElementById('playerOwedAspectsVal');
              if (cardVal) cardVal.textContent = '0';

              renderPlayerOwedPopup();
            } catch (err) {
              clearBtn.disabled = false;
              clearBtn.textContent = 'Clear';
              clearBtn.classList.add('owed-aspects-clear-btn--error');
              clearBtn.title = 'Failed: ' + err.message;
              setTimeout(() => {
                clearBtn.classList.remove('owed-aspects-clear-btn--error');
                clearBtn.title = 'Clear aspects for ' + p.username;
              }, 2000);
            }
          });
        }
      }

      function openPlayerOwedPopup()  {
        renderPlayerOwedPopup();
        popup.classList.add('open');
        overlay.classList.add('open');
        document.body.classList.add('popup-scroll-lock');
      }
      function closePlayerOwedPopup() {
        popup.classList.remove('open');
        overlay.classList.remove('open');
        document.body.classList.remove('popup-scroll-lock');
      }

      document.getElementById('playerOwedAspectsCard').addEventListener('click', openPlayerOwedPopup);
      overlay.addEventListener('click', closePlayerOwedPopup);

    } else {
      owedEl.style.display = 'none';
      owedEl.innerHTML = '';
    }

    /* dungeons + raids */
    renderGlobalSection('globalDungeons', 'globalDungeonsCard', 'globalDungeonsTotal', g.dungeons);
    const combinedRaids = combineRaidData(g.raids, g.guildRaids);
    renderGlobalRaidSection('globalRaids', 'globalRaidsCard', 'globalRaidsTotal', combinedRaids);

    /* characters */
    const chars   = isFallback ? {} : (p.characters || {});
    const hasChars = Object.keys(chars).length > 0;
    if (isFallback) {
      document.getElementById('viewCharacter').style.display = 'none';
      document.getElementById('characterView').style.display = 'none';
    } else {
      document.getElementById('viewCharacter').style.display = hasChars ? '' : 'none';
    }
    _updateViewSelector();
    buildCharSelect(chars);

    document.getElementById('playerContent').style.display = 'block';
    switchView('global');
  }

  /* raid/dungeon helpers */
  function combineRaidData(raids, guildRaids) {
    const hasRaids = raids      && raids.list      && Object.keys(raids.list).length      > 0;
    const hasGuild = guildRaids && guildRaids.list && Object.keys(guildRaids.list).length > 0;
    if (!hasRaids && !hasGuild) return null;
    const list = {};
    if (hasRaids) {
      for (const [name, count] of Object.entries(raids.list)) {
        list[name] = { total: count, guild: 0 };
      }
    }
    if (hasGuild) {
      for (const [name, count] of Object.entries(guildRaids.list)) {
        if (list[name]) { list[name].guild = count; }
        else            { list[name] = { total: count, guild: count }; }
      }
    }
    return {
      list,
      total:      (raids      && raids.total)      || 0,
      guildTotal: (guildRaids && guildRaids.total) || 0,
    };
  }

  function renderGlobalSection(containerId, cardId, totalId, data) {
    const card      = document.getElementById(cardId);
    const container = document.getElementById(containerId);
    const totalEl   = document.getElementById(totalId);
    if (!data || !data.list || Object.keys(data.list).length === 0) { card.style.display = 'none'; return; }
    card.style.display  = 'block';
    totalEl.textContent = 'Total: ' + fmt(data.total);
    let html = '<div class="raid-list">';
    for (const [name, count] of Object.entries(data.list)) {
      html += `<div class="raid-list-row"><span class="raid-list-name">${name}</span><span class="raid-list-count">${fmt(count)}</span></div>`;
    }
    container.innerHTML = html + '</div>';
  }

  function renderGlobalRaidSection(containerId, cardId, totalId, data) {
    const card      = document.getElementById(cardId);
    const container = document.getElementById(containerId);
    const totalEl   = document.getElementById(totalId);
    if (!data || !data.list || Object.keys(data.list).length === 0) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    let totalText = 'Total: ' + fmt(data.total);
    if (data.guildTotal) totalText += ' · Guild: ' + fmt(data.guildTotal);
    totalEl.textContent = totalText;
    let html = '<div class="raid-list">';
    for (const [name, entry] of Object.entries(data.list)) {
      const pct       = entry.total > 0 ? Math.round((entry.guild / entry.total) * 100) : 0;
      const guildInfo = entry.guild > 0
        ? `<span class="raid-list-guild">${fmt(entry.guild)} guild (${pct}%)</span>`
        : '';
      html += `<div class="raid-list-row"><span class="raid-list-name">${name}</span><span class="raid-list-counts"><span class="raid-list-count">${fmt(entry.total)}</span>${guildInfo}</span></div>`;
    }
    container.innerHTML = html + '</div>';
  }

  /* character selector */
  function buildCharSelect(characters) {
    const sel      = document.getElementById('charSelect');
    sel.innerHTML  = '';
    const charList = Object.entries(characters);

    charList.sort((a, b) => {
      const aActive = state.playerData && state.playerData.activeCharacter === a[0] ? 1 : 0;
      const bActive = state.playerData && state.playerData.activeCharacter === b[0] ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return (b[1].level || 0) - (a[1].level || 0);
    });

    charList.forEach(([uuid, char]) => {
      const type   = char.type || 'Unknown';
      const reskin = char.reskin   ? ` (${char.reskin})` : '';
      const lvl    = char.level    || '?';
      const gm     = char.gamemode && char.gamemode.length ? ` [${char.gamemode.join(',')}]` : '';
      const nick   = char.nickname ? ` "${char.nickname}"` : '';
      const active = state.playerData && state.playerData.activeCharacter === uuid ? '★ ' : '';
      const opt    = document.createElement('option');
      opt.value       = uuid;
      opt.textContent = `${active}${type}${reskin}${nick} Lv.${lvl}${gm}`;
      sel.appendChild(opt);
    });

    if (charList.length > 0) renderCharacter(charList[0][0]);
  }

  function renderCharacter(uuid) {
    const chars = state.playerData && state.playerData.characters;
    if (!chars || !chars[uuid]) return;
    const c         = chars[uuid];
    const container = document.getElementById('charDetails');

    const type  = c.type   || 'Unknown';
    const reskin = c.reskin || null;
    const gm    = c.gamemode && c.gamemode.length ? c.gamemode : null;
    const nick  = c.nickname || null;

    /* stats */
    const mainStats = [
      { label: 'Level',       val: c.level || '?'                       },
      { label: 'Total Level', val: fmt(c.totalLevel)                    },
      { label: 'Playtime',    val: fmtHours(c.playtime)                 },
      { label: 'Wars',        val: fmt(c.wars)                          },
      { label: 'Logins',      val: fmt(c.logins)                        },
      { label: 'Deaths',      val: fmt(c.deaths)                        },
      { label: 'Content %',   val: fmt(c.contentCompletion)             },
      { label: 'Mobs Killed', val: fmt(c.mobsKilled)                    },
      { label: 'Chests',      val: fmt(c.chestsFound)                   },
      { label: 'Caves',       val: fmt(c.caves)                         },
      { label: 'PvP Kills',   val: fmt(c.pvp ? c.pvp.kills   : null)    },
      { label: 'PvP Deaths',  val: fmt(c.pvp ? c.pvp.deaths  : null)    },
    ];
    const statsHtml = mainStats.map(s => `
      <div class="stat-list-row">
        <span class="stat-list-label">${s.label}</span>
        <span class="stat-list-value">${s.val}</span>
      </div>`).join('');

    /* professions */
    const profs    = c.professions || {};
    const profRows = Object.entries(profs).map(([name, data]) => {
      const lvl = data.level      || 1;
      const xp  = data.xpPercent  || 0;
      return `<tr>
        <td>${name}</td>
        <td>
          <div class="prof-level-bar">
            <span class="prof-level-num">${lvl}</span>
            <div class="prof-bar-track"><div class="prof-bar-fill" style="width:${xp}%"></div></div>
            <span style="font-size:0.72rem;color:var(--text-faint);min-width:32px;text-align:right">${String(xp).replace('.', ',')}%</span>
          </div>
        </td>
      </tr>`;
    }).join('');

    /* dungeons */
    const dungData  = c.dungeons || {};
    const dungCells = dungData.list && Object.keys(dungData.list).length > 0
      ? Object.entries(dungData.list).map(([n, v]) =>
          `<div class="raid-list-row"><span class="raid-list-name">${n}</span><span class="raid-list-count">${fmt(v)}</span></div>`
        ).join('')
      : '<div style="padding:14px 16px;color:var(--text-faint);font-style:italic;font-family:\'Crimson Pro\',serif">None recorded</div>';

    /* raids */
    const raidData  = c.raids || {};
    const raidCells = raidData.list && Object.keys(raidData.list).length > 0
      ? Object.entries(raidData.list).map(([n, v]) =>
          `<div class="raid-list-row"><span class="raid-list-name">${n}</span><span class="raid-list-count">${fmt(v)}</span></div>`
        ).join('')
      : '<div style="padding:14px 16px;color:var(--text-faint);font-style:italic;font-family:\'Crimson Pro\',serif">None recorded</div>';

    const questCount = c.quests ? c.quests.length : 0;

    container.innerHTML = `
      <div class="char-profile-card">
        <div class="char-type-row">
          <span class="char-class-name">${type}${reskin ? ' / ' + reskin : ''}</span>
          ${nick ? `<span class="char-badge">"${nick}"</span>` : ''}
          ${gm   ? gm.map(g => `<span class="char-badge ironman">${g}</span>`).join('') : ''}
        </div>
        <div style="font-size:0.85rem;color:var(--text-dim);display:flex;gap:20px;flex-wrap:wrap">
          <span>Quests: <strong style="color:var(--gold-light)">${questCount}</strong></span>
          ${fmt(c.discoveries) !== 'N/A' ? `<span>Discoveries: <strong style="color:var(--gold-light)">${fmt(c.discoveries)}</strong></span>` : ''}
          ${fmt(c.worldEvents)  !== 'N/A' ? `<span>World Events: <strong style="color:var(--gold-light)">${fmt(c.worldEvents)}</strong></span>`  : ''}
        </div>
      </div>

      <div class="global-stats-list">${statsHtml}</div>

      <div class="info-card">
        <div class="collapsible-header" onclick="toggleCollapse(this)">
          Professions <span class="collapsible-arrow">▼</span>
        </div>
        <div class="collapsible-body">
          <table class="prof-table">${profRows}</table>
        </div>
      </div>

      ${dungData.list && Object.keys(dungData.list).length > 0 ? `
      <div class="info-card">
        <div class="collapsible-header" onclick="toggleCollapse(this)">
          Dungeons &nbsp;<span style="color:var(--text-faint);font-size:0.85em">Total: ${fmt(dungData.total || 0)}</span>
          <span class="collapsible-arrow">▼</span>
        </div>
        <div class="collapsible-body">
          <div class="raid-list">${dungCells}</div>
        </div>
      </div>` : ''}

      ${raidData.list && Object.keys(raidData.list).length > 0 ? `
      <div class="info-card">
        <div class="collapsible-header" onclick="toggleCollapse(this)">
          Raids &nbsp;<span style="color:var(--text-faint);font-size:0.85em">Total: ${fmt(raidData.total || 0)}</span>
          <span class="collapsible-arrow">▼</span>
        </div>
        <div class="collapsible-body">
          <div class="raid-list">${raidCells}</div>
        </div>
      </div>` : ''}
    `;
  }

  /* update guild XP once guild data comes in */
  function updatePlayerGuildXp(p, guild) {
    const guildXpRow = document.getElementById('guildXpRow');
    if (!guildXpRow || !p.guild) return;
    if (guild && guild.members) {
      let memberData = null;
      for (const roleGroup of Object.values(guild.members)) {
        if (typeof roleGroup === 'object' && !Array.isArray(roleGroup)) {
          for (const [name, data] of Object.entries(roleGroup)) {
            if (name === p.username) { memberData = data; break; }
          }
        }
        if (memberData) break;
      }
      if (memberData) {
        const contrib    = memberData.contributed || 0;
        const contribRnk = memberData.contributionRank || 'N/A';
        const joinedStr  = memberData.joined ? ' &nbsp;·&nbsp; Joined: <strong style="color:var(--gold-light)">' + fmtDate(memberData.joined) + '</strong>' : '';
        guildXpRow.innerHTML = `
          <span>Guild XP Contributed: <strong style="color:var(--gold-light)">${fmt(contrib)}</strong>
          &nbsp;·&nbsp; Contribution Rank: <strong style="color:var(--gold-light)">#${contribRnk}</strong>${joinedStr}</span>`;
      }
    }
  }

  /* collapsible toggle (used by onclick in the html) */
  window.toggleCollapse = function (header) {
    header.classList.toggle('open');
    const body = header.nextElementSibling;
    if (body) body.classList.toggle('open');
  };

  function formatPlayerGraphValue(metricKey, value) {
    if (!Number.isFinite(value)) return 'N/A';
    const metric = GRAPH_METRICS.find(m => m.key === metricKey);
    if (!metric) return Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
    if (metric.decimals > 0) {
      return Number(value).toLocaleString(undefined, {
        minimumFractionDigits: metric.decimals,
        maximumFractionDigits: metric.decimals,
      });
    }
    const rounded = Math.round(value);
    if (Math.abs(value - rounded) < 0.001) return rounded.toLocaleString();
    return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function ensureGraphTooltip(canvas) {
    return GraphShared.ensureTooltip(canvas);
  }

  function ensureGraphHoverGuides(canvas) {
    return GraphShared.ensureHoverGuides(canvas);
  }

  function hideGraphHoverGuides(guides) {
    GraphShared.hideHoverGuides(guides);
  }

  function updateGraphHoverGuides(guides, model, hoverPoint) {
    GraphShared.updateHoverGuides(guides, model, hoverPoint);
  }

  function resolveGraphSelectedIndex(dayOffset, maxLen) {
    return GraphShared.resolveSelectedIndex(dayOffset, maxLen);
  }

  function updateGraphPinnedGuide(guides, model) {
    return GraphShared.updatePinnedGuide(guides, model, compareGraph.selectedDayOffset);
  }

  function positionGraphTooltip(tooltip, wrap, x, y) {
    GraphShared.positionTooltip(tooltip, wrap, x, y);
  }

  function initCompareGraphHover() {
    const canvas = compareGraph.canvas;
    if (!canvas) return;
    const tooltip = ensureGraphTooltip(canvas);
    const guides = ensureGraphHoverGuides(canvas);

    function hideHover() {
      tooltip.style.display = 'none';
      hideGraphHoverGuides(guides);
    }

    canvas.addEventListener('mouseleave', hideHover);
    canvas.addEventListener('mousemove', function (e) {
      const model = compareGraph.hoverModel;
      if (!model || !model.series.length) { hideHover(); return; }

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const inPlot =
        mx >= model.pad.left &&
        mx <= model.pad.left + model.plotW &&
        my >= model.pad.top &&
        my <= model.pad.top + model.plotH;
      if (!inPlot) { hideHover(); return; }

      const maxLen = Math.max(1, model.maxLen || 1);
      let hoverIndex = 0;
      if (maxLen > 1) {
        hoverIndex = Math.round(((mx - model.pad.left) / model.plotW) * (maxLen - 1));
        hoverIndex = Math.max(0, Math.min(maxLen - 1, hoverIndex));
      }
      const hoverX = model.pad.left + (maxLen === 1 ? model.plotW / 2 : (hoverIndex / (maxLen - 1)) * model.plotW);
      updateGraphHoverGuides(guides, model, { index: hoverIndex, x: hoverX });

      const rows = [];
      model.series.forEach(series => {
        const p = series.points[hoverIndex];
        if (!p) return;
        const metric = GRAPH_METRICS.find(m => m.key === series.key);
        const metricLabel = metric ? `${metric.label}` : series.key;
        const playerLabel = model.hasCompare ? ` · ${series.player}` : '';
        rows.push({
          label: metricLabel + playerLabel,
          value: formatPlayerGraphValue(series.key, p.value),
          color: series.color,
          dashed: !!series.dashed,
        });
      });

      if (!rows.length) {
        tooltip.style.display = 'none';
        hideGraphHoverGuides(guides);
        return;
      }

      tooltip.innerHTML = rows.map(r => `
        <div class="graph-hover-row">
          <span class="graph-hover-swatch${r.dashed ? ' dashed' : ''}" style="${r.dashed ? 'color:' + r.color : 'background:' + r.color}"></span>
          <span class="graph-hover-label">${escapeHtml(r.label)}</span>
          <span class="graph-hover-value">${escapeHtml(r.value)}</span>
        </div>`).join('');
      tooltip.style.display = 'block';
      const offsetX = Number.isFinite(model.canvasOffsetX) ? model.canvasOffsetX : 0;
      const offsetY = Number.isFinite(model.canvasOffsetY) ? model.canvasOffsetY : 0;
      positionGraphTooltip(tooltip, guides.wrap, mx + offsetX, my + offsetY);
    });
    canvas.addEventListener('click', function (e) {
      const model = compareGraph.hoverModel;
      if (!model || !model.series.length) return;

      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const inPlot =
        mx >= model.pad.left &&
        mx <= model.pad.left + model.plotW &&
        my >= model.pad.top &&
        my <= model.pad.top + model.plotH;
      if (!inPlot) return;

      const maxLen = Math.max(1, model.maxLen || 1);
      let selectedIndex = 0;
      if (maxLen > 1) {
        selectedIndex = Math.round(((mx - model.pad.left) / model.plotW) * (maxLen - 1));
        selectedIndex = Math.max(0, Math.min(maxLen - 1, selectedIndex));
      }
      const selectedOffset = Math.max(0, (maxLen - 1) - selectedIndex);
      compareGraph.selectedDayOffset = compareGraph.selectedDayOffset === selectedOffset ? null : selectedOffset;
      refreshCompareGraph();
    });
  }


  /* activity graph */
  const SERIES_COLORS = [
    { line: '#D4A017', fill: 'rgba(212,160,23,0.08)', point: '#F0C040', name: 'Gold'  },
    { line: '#3BA55C', fill: 'rgba(59,165,92,0.08)',  point: '#5FD87A', name: 'Green' },
    { line: '#5865F2', fill: 'rgba(88,101,242,0.08)', point: '#8A94F7', name: 'Blue'  },
  ];
  const MAX_METRICS = 3;

  /* apply settings defaults */
  var _defaultMetric = (window.esiSettings && window.esiSettings.get('defaultGraphMetric')) || '';
  var _defaultRange  = (window.esiSettings && window.esiSettings.get('defaultGraphRange'))  || 30;
  _defaultRange = Math.max(2, Math.min(60, parseInt(_defaultRange, 10) || 30));
  var _initMetric = (_defaultMetric && GRAPH_METRICS.some(m => m.key === _defaultMetric)) ? _defaultMetric : 'playtime';

  const compareGraph = {
    metrics:       [_initMetric],
    days:          _defaultRange,
    canvas:        document.getElementById('graphCanvas'),
    range:         document.getElementById('graphDaysRange'),
    daysLbl:       document.getElementById('graphDaysLabel'),
    rowsWrap:      document.getElementById('graphMetricRows'),
    addBtn:        document.getElementById('btnAddMetric'),
    legendWrap:    document.getElementById('graphLegend'),
    summaryWrap:   document.getElementById('graphSummaries'),
    compareTrigger:  document.getElementById('compareTrigger'),
    compareInputArea:document.getElementById('compareInputArea'),
    compareInput:    document.getElementById('comparePlayerInput'),
    comparePill:     document.getElementById('comparePill'),
    comparePillName: document.getElementById('comparePillName'),
    compareClearBtn: document.getElementById('btnCompareClear'),
    compareStatus:   document.getElementById('compareStatus'),
    hoverModel:      null,
    selectedDayOffset: null,
  };
  function setPlayerCompareEnabled(enabled, loadingText) {
    const hint = loadingText || 'Loading activity data…';
    compareGraph.compareTrigger.style.pointerEvents = enabled ? '' : 'none';
    compareGraph.compareTrigger.style.opacity = enabled ? '' : '0.45';
    compareGraph.compareTrigger.style.cursor = enabled ? '' : 'not-allowed';
    compareGraph.compareTrigger.title = enabled ? '' : hint;
    compareGraph.compareInput.disabled = !enabled;
    if (!enabled && !isComparing()) {
      compareGraph.compareInputArea.style.display = 'none';
      compareGraph.compareTrigger.style.display = '';
      setCompareStatus(hint, false);
    } else if (enabled && !graphState.compareLoading && !isComparing()) {
      setCompareStatus('', false);
    }
  }

  initCompareGraphHover();
  setPlayerCompareEnabled(false, 'Loading activity data…');

  /* apply saved range default to the slider */
  compareGraph.range.value = _defaultRange;
  compareGraph.daysLbl.textContent = _defaultRange + 'd';

  function getAvailableMetrics() {
    const compareLocksToPlaytime = isComparing() && graphState.compareInGuild === false;
    const allowGuildMetrics = state.playerInGuild && !compareLocksToPlaytime;
    return allowGuildMetrics ? GRAPH_METRICS : GRAPH_METRICS.filter(m => m.key === 'playtime');
  }

  function buildMetricRow(metricKey, index) {
    const row = document.createElement('div');
    row.className    = 'graph-metric-row';
    row.dataset.index = index;

    const dot = document.createElement('span');
    dot.className        = 'metric-color-dot';
    dot.style.background = SERIES_COLORS[index].line;
    row.appendChild(dot);

    const available = getAvailableMetrics();
    if (available.length <= 1) {
      const lbl = document.createElement('span');
      lbl.className = 'graph-metric-label';
      const m = available.find(x => x.key === metricKey) || available[0];
      lbl.textContent = m.label;
      row.appendChild(lbl);
    } else {
      const sel = document.createElement('select');
      sel.className = 'graph-select';
      available.forEach(m => {
        const opt       = document.createElement('option');
        opt.value       = m.key;
        opt.textContent = m.label;
        sel.appendChild(opt);
      });
      sel.value = metricKey;
      sel.addEventListener('change', function () {
        // swap if another row already uses this metric
        const prev = compareGraph.metrics[index];
        const conflictIndex = compareGraph.metrics.indexOf(this.value);
        if (conflictIndex !== -1 && conflictIndex !== index) {
          compareGraph.metrics[conflictIndex] = prev;
        }
        compareGraph.metrics[index] = this.value;
        renderMetricRows();
        refreshCompareGraph();
      });
      row.appendChild(sel);
    }

    if (compareGraph.metrics.length > 1) {
      const btn       = document.createElement('button');
      btn.className   = 'btn-remove-metric';
      btn.textContent = '\u00d7';
      btn.title       = 'Remove this metric';
      btn.addEventListener('click', () => removeMetric(index));
      row.appendChild(btn);
    }
    return row;
  }

  function isComparing() {
    return !!(graphState.compareData && graphState.compareUsername);
  }

  function renderMetricRows() {
    compareGraph.rowsWrap.innerHTML = '';
    const available = getAvailableMetrics();

    // Hide the entire metric row area when locked to playtime-only
    const lockedToPlaytime = available.length <= 1;
    compareGraph.rowsWrap.style.display = lockedToPlaytime ? 'none' : '';
    compareGraph.addBtn.style.display   = lockedToPlaytime || isComparing() || compareGraph.metrics.length >= Math.min(MAX_METRICS, available.length) ? 'none' : '';

    if (!lockedToPlaytime) {
      compareGraph.metrics.forEach((key, i) => compareGraph.rowsWrap.appendChild(buildMetricRow(key, i)));
    }
  }

  function addMetric() {
    const available = getAvailableMetrics();
    if (compareGraph.metrics.length >= Math.min(MAX_METRICS, available.length)) return;
    const used = new Set(compareGraph.metrics);
    const next = available.find(m => !used.has(m.key)) || available[0];
    compareGraph.metrics.push(next.key);
    renderMetricRows();
    refreshCompareGraph();
  }

  function removeMetric(index) {
    if (compareGraph.metrics.length <= 1) return;
    compareGraph.metrics.splice(index, 1);
    renderMetricRows();
    refreshCompareGraph();
  }

  compareGraph.addBtn.addEventListener('click', addMetric);
  compareGraph.range.addEventListener('input', function () {
    compareGraph.days = parseInt(this.value);
    compareGraph.daysLbl.textContent = compareGraph.days + 'd';
    refreshCompareGraph();
  });
  compareGraph.daysLbl.textContent = parseInt(compareGraph.range.value) + 'd';

  /* compare player */
  compareGraph.compareTrigger.addEventListener('click', function () {
    if (!graphState.graphReady || !graphState.data) {
      setCompareStatus('Wait for activity data to finish loading.', true);
      return;
    }
    compareGraph.compareTrigger.style.display  = 'none';
    compareGraph.compareInputArea.style.display = '';
    compareGraph.compareInput.value = '';
    setCompareStatus('', false);
    compareGraph.compareInput.focus();
  });

  compareGraph.compareInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      if (!graphState.graphReady || !graphState.data) {
        setCompareStatus('Wait for activity data to finish loading.', true);
        return;
      }
      const name = this.value.trim();
      if (!name) return;
      if (state.playerData && name.toLowerCase() === state.playerData.username.toLowerCase()) {
        setCompareStatus('Pick a different player to compare.', true);
        return;
      }
      loadComparePlayer(name);
    }
    if (e.key === 'Escape') cancelCompareInput();
  });

  compareGraph.compareInput.addEventListener('blur', function () {
    setTimeout(function () {
      if (!graphState.compareUsername && !graphState.compareLoading && compareGraph.compareInputArea.style.display !== 'none') {
        cancelCompareInput();
      }
    }, 200);
  });

  compareGraph.compareClearBtn.addEventListener('click', clearComparePlayer);

  function cancelCompareInput() {
    compareGraph.compareInputArea.style.display = 'none';
    compareGraph.compareTrigger.style.display   = '';
    setCompareStatus('', false);
  }

  function setCompareStatus(msg, isError) {
    if (isError) {
      if (msg && typeof window.showToast === 'function') {
        window.showToast('⚠ ' + msg, 'warn');
      }
      compareGraph.compareStatus.textContent = '';
      compareGraph.compareStatus.className = 'compare-status';
      return;
    }
    compareGraph.compareStatus.textContent = msg;
    compareGraph.compareStatus.className = 'compare-status' + (msg ? ' loading' : '');
  }

  async function loadComparePlayer(username) {
    if (!graphState.graphReady || !graphState.data) {
      setCompareStatus('Wait for activity data to finish loading.', true);
      return;
    }
    graphState.compareLoading = true;
    setCompareStatus('Loading\u2026', false);
    try {
      const comparePlayer = await apiFetch('/api/player/' + encodeURIComponent(username));
      graphState.compareInGuild  = isEsiGuildMember(comparePlayer);
      graphState.compareData = await fetchGraphData(username, graphState.compareInGuild);
      graphState.compareUsername = username;

      compareGraph.compareInputArea.style.display = 'none';
      compareGraph.compareTrigger.style.display   = 'none';
      compareGraph.comparePill.style.display      = '';
      compareGraph.comparePillName.textContent    = username;
      setCompareStatus('', false);

      const availableMetrics = getAvailableMetrics();
      const currentMetric = compareGraph.metrics[0];
      const nextMetric = availableMetrics.some(m => m.key === currentMetric)
        ? currentMetric
        : availableMetrics[0].key;
      compareGraph.metrics = [nextMetric];
      renderMetricRows();
      refreshCompareGraph();
    } catch (err) {
      setCompareStatus(friendlyPlayerLookupError(err.message, username), true);
    } finally {
      graphState.compareLoading = false;
    }
  }

  function clearComparePlayer() {
    graphState.compareData     = null;
    graphState.compareUsername = null;
    graphState.compareInGuild  = null;

    /* reset compare UI */
    compareGraph.comparePill.style.display      = 'none';
    compareGraph.compareInputArea.style.display = 'none';
    compareGraph.compareTrigger.style.display   = '';
    setCompareStatus('', false);

    renderMetricRows();
    refreshCompareGraph();
  }

  function pad60(arr) {
    return Array(Math.max(0, 60 - arr.length)).fill(0).concat(arr);
  }

  function cachePlayerMetricsPayload(username, resp) {
    if (!username || !resp) return;
    const key = username.toLowerCase();
    const metrics = resp.metrics || {};
    const cached = {
      username: resp.username || username,
      dates: Array.isArray(resp.playtimeDates) ? resp.playtimeDates : (Array.isArray(resp.dates) ? resp.dates : []),
      metricDates: Array.isArray(resp.metricDates) ? resp.metricDates : (Array.isArray(resp.dates) ? resp.dates : []),
      data: Array.isArray(metrics.playtime) ? metrics.playtime : [],
    };
    GRAPH_METRICS.forEach(m => {
      if (m.key === 'playtime') return;
      cached[m.key] = Array.isArray(metrics[m.key]) ? metrics[m.key] : [];
    });
    window.playtimeCache = window.playtimeCache || {};
    window.playtimeCache[key] = cached;
  }

  function cachePlayerMetricsDebugPayload(username, resp) {
    if (!resp || !resp.debug || !username) return;
    const key = username.toLowerCase();
    window.playtimeDebugCache = window.playtimeDebugCache || {};
    window.playtimeDebugCache.members = window.playtimeDebugCache.members || {};
    window.playtimeDebugCache.members[key] = {
      guildRaids: Array.isArray(resp.debug.guildRaids) ? resp.debug.guildRaids : [],
    };
    if (resp.debug.rules) window.playtimeDebugCache.rules = resp.debug.rules;
  }

  function maybeLogPlayerMetricsDebug(username) {
    if (!METRICS_DEBUG_ENABLED || !username) return;
    const key = username.toLowerCase();
    if (graphState.debugLogged[key]) return;
    graphState.debugLogged[key] = true;
  }

  async function fetchGraphData(username, inGuildExpected) {
    const key = username.toLowerCase();
    if (graphState.graphCache[key]) {
      return graphState.graphCache[key];
    }

    // wait for the bulk prefetch to finish first
    if (window.playtimePrefetchReady) await window.playtimePrefetchReady;

    const cached = window.playtimeCache && window.playtimeCache[key];
    let playtimeArr = [];

    if (cached) {
      playtimeArr = cached.data || [];
    } else {
      try {
        const res = await apiFetch(`/api/player/${encodeURIComponent(username)}/playtime-history`);
        playtimeArr = res.data || [];
      } catch (_) {}
    }

    const data = {};
    GRAPH_METRICS.forEach(m => {
      if (m.key === 'playtime') {
        data[m.key] = pad60(playtimeArr);
      } else if (cached && Array.isArray(cached[m.key]) && cached[m.key].length) {
        data[m.key] = pad60(cached[m.key]);
      } else {
        data[m.key] = Array(60).fill(0);
      }
    });
    graphState.graphCache[key] = data;
    return data;
  }

  function setGraphLoading(loading) {
    const canvas   = compareGraph.canvas;
    const wrap     = canvas ? canvas.parentElement : null;
    if (!wrap) return;
    let loader = wrap.querySelector('.graph-loader');
    if (loading) {
      canvas.style.opacity = '0.3';
      if (!loader) {
        loader = document.createElement('div');
        loader.className = 'graph-loader';
        loader.textContent = 'Loading…';
        loader.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:0.9rem;color:var(--text-dim);pointer-events:none;';
        wrap.style.position = 'relative';
        wrap.appendChild(loader);
      }
      loader.style.display = 'flex';
    } else {
      canvas.style.opacity = '';
      if (loader) loader.style.display = 'none';
    }
  }

  async function initGraph() {
    const graphFocus = consumePendingGraphFocus();
    const requestedMetrics = consumePendingGraphMetrics();
    compareGraph.days = parseInt(compareGraph.range.value);
    compareGraph.daysLbl.textContent = compareGraph.days + 'd';
    const username = state.playerData && state.playerData.username;
    graphState.graphReady = false;
    graphState.data = null;

    // hide controls while loading
    compareGraph.addBtn.style.display = 'none';
    compareGraph.rowsWrap.innerHTML   = '';

    compareGraph.metrics = [_initMetric];
    compareGraph.selectedDayOffset = null;
    clearComparePlayer();
    setPlayerCompareEnabled(false, 'Loading activity data…');

    setGraphLoading(true);
    try {
      graphState.data = await fetchGraphData(username || '', state.playerInGuild);
      applyPendingGraphFocus(
        graphFocus,
        graphState.data && graphState.playtime ? graphState.data.playtime.length : 60,
        username || ''
      );
      if (requestedMetrics && requestedMetrics.length) {
        const available = getAvailableMetrics();
        const valid = requestedMetrics.filter(k => available.some(m => m.key === k));
        if (valid.length) compareGraph.metrics = valid;
      }
      renderMetricRows();
      refreshCompareGraph();
      graphState.graphReady = true;
      setPlayerCompareEnabled(true);
    } finally {
      setGraphLoading(false);
      if (!graphState.graphReady) {
        setPlayerCompareEnabled(false, 'Activity data unavailable.');
      }
    }
  }

  /* Run graph initialization independently — not tied to API call */
  function initGraphIndependent(username, isRefetch) {
    var graphFocus = consumePendingGraphFocus();
    var requestedMetrics = consumePendingGraphMetrics();

    if (!isRefetch) {
      graphState.graphReady = false;
      graphState.data = null;
      compareGraph.metrics = [_initMetric];
      compareGraph.selectedDayOffset = null;
      compareGraph.addBtn.style.display = 'none';
      compareGraph.rowsWrap.innerHTML = '';
      clearComparePlayer();
      setPlayerCompareEnabled(false, 'Loading activity data\u2026');
      setGraphLoading(true);
    }

    return fetchGraphData(username, true).then(function (data) {
      graphState.data = data;
      compareGraph.days = parseInt(compareGraph.range.value);
      compareGraph.daysLbl.textContent = compareGraph.days + 'd';
      if (!isRefetch) {
        applyPendingGraphFocus(
          graphFocus,
          data && data.playtime ? data.playtime.length : 60,
          username
        );
        if (requestedMetrics && requestedMetrics.length) {
          var available = getAvailableMetrics();
          var valid = requestedMetrics.filter(function (k) { return available.some(function (m) { return m.key === k; }); });
          if (valid.length) compareGraph.metrics = valid;
        }
        renderMetricRows();
      } else {
        var hasNewFocus = !! graphFocus;
        var hasNewMetrics = !! (requestedMetrics && requestedMetrics.length);
        if (hasNewFocus) {
          applyPendingGraphFocus(
            graphFocus,
            data && data.playtime ? data.playtime.length : 60,
            username
          )
        }
        if (hasNewMetrics) {
          var available = getAvailableMetrics();
          var valid = requestedMetrics.filter(function (k) { return available.some(function (m) { return m.key === k; }); });
          if (valid.length) compareGraph.metrics = valid;
        }
        if (hasNewFocus || hasNewMetrics) renderMetricRows();
      }
      refreshCompareGraph();
      graphState.graphReady = true;
      setPlayerCompareEnabled(true);
      return true;
    }).catch(function () {
      if (!isRefetch) {
        setPlayerCompareEnabled(false, 'Activity data unavailable.');
      }
      return false;
    }).finally(function () {
      if (!isRefetch) {
        setGraphLoading(false);
      }
    });
  }

  function seededRand(s) { var x = Math.sin(s * 9301 + 49297) * 49297; return x - Math.floor(x); }
  function expandData(daily, mult) {
    if (mult <= 1 || daily.length < 2) return daily;
    var out = [];
    for (var i = 0; i < daily.length - 1; i++) {
      var a = daily[i], b = daily[i + 1], diff = Math.abs(b - a) || 1;
      for (var j = 0; j < mult; j++) {
        out.push(Math.max(0, a + (b - a) * (j / mult) + (seededRand(i * mult + j + a) - 0.5) * diff * 0.3));
      }
    }
    out.push(daily[daily.length - 1]);
    return out;
  }

  function refreshCompareGraph() {
    if (!graphState.data) return;
    const hasCompare = !!(graphState.compareData && graphState.compareUsername);
    const mainName   = (state.playerData && state.playerData.username) || 'Player';
    const rawSeries  = [];

    compareGraph.metrics.forEach((key, i) => {
      let mainArr;
      mainArr = graphState.data[key].slice(60 - compareGraph.days);

      rawSeries.push({
        key,
        data:   mainArr,
        color:  SERIES_COLORS[i],
        player: mainName,
        dashed: false,
      });

      if (hasCompare) {
        let cmpArr;
        cmpArr = graphState.compareData[key].slice(60 - compareGraph.days);

        rawSeries.push({
          key,
          data:   cmpArr,
          color:  SERIES_COLORS[i],
          player: graphState.compareUsername,
          dashed: true,
        });
      }
    });
    const maxLen = Math.max(0, ...rawSeries.map(s => (s.data && s.data.length) || 0));
    const selectedEndIndex = resolveGraphSelectedIndex(compareGraph.selectedDayOffset, maxLen);

    const drawSeries = rawSeries.map(s => ({ ...s, data: expandData(s.data, 1) }));
    drawCompareGraph(compareGraph.canvas, drawSeries);
    updateCompareLegend(rawSeries, hasCompare, mainName);
    updateCompareSummaries(rawSeries, hasCompare, mainName, selectedEndIndex);
  }

  function drawCompareGraph(canvas, seriesList) {
    compareGraph.hoverModel = GraphShared.drawGraphCanvas(canvas, seriesList, {
      height: 220,
      xLabelMinGap: 28,
      selectedDayOffset: compareGraph.selectedDayOffset,
      formatYAxisLabel: function (val) {
        return String(Math.round(val * 10) / 10).replace('.', ',');
      },
    });
  }

  function updateCompareLegend(seriesList, hasCompare, mainName) {
    const wrap = compareGraph.legendWrap;
    wrap.innerHTML = '';

    /* Deduplicate by metric key — show one legend entry per metric */
    const seenKeys = new Set();
    seriesList.forEach(s => {
      if (seenKeys.has(s.key)) return;
      seenKeys.add(s.key);
      const m    = GRAPH_METRICS.find(x => x.key === s.key);
      const item = document.createElement('span');
      item.className = 'graph-legend-item';
      item.innerHTML = `<span class="legend-line" style="background:${s.color.line}"></span> ${m ? m.label : s.key}`;
      wrap.appendChild(item);
    });

    /* If comparing, add player key indicators */
    if (hasCompare) {
      const sep = document.createElement('span');
      sep.className = 'graph-legend-player-pair graph-legend-player-pair--right';
      sep.innerHTML = `
        <span class="graph-legend-item"><span class="legend-line legend-line-player-solid"></span><span class="legend-player-tag">${mainName}</span></span>
        <span class="graph-legend-item"><span class="legend-line dashed legend-line-player-dashed"></span><span class="legend-player-tag compare">${graphState.compareUsername}</span></span>`;
      wrap.appendChild(sep);
    }
  }

  function updateCompareSummaries(seriesList, hasCompare, mainName, selectedEndIndex) {
    const wrap = compareGraph.summaryWrap;
    wrap.innerHTML = '';

    if (!hasCompare) {
      /* Single-player mode — original layout grouped by metric */
      seriesList.forEach(s => {
        appendSummarySection(wrap, s, true, selectedEndIndex);
      });
    } else {
      /* Two-player mode — group by player */
      const players = [
        { name: mainName,                    dashed: false },
        { name: graphState.compareUsername,   dashed: true  },
      ];
      players.forEach(p => {
        const header = document.createElement('div');
        header.className = 'graph-summary-player-header';
        const lineClass = p.dashed ? 'player-line-sample dashed' : 'player-line-sample player-line-sample-solid';
        header.innerHTML = `<span class="${lineClass}"></span>${p.name}`;
        wrap.appendChild(header);
        seriesList.filter(s => !!s.dashed === p.dashed).forEach(s => {
          appendSummarySection(wrap, s, false, selectedEndIndex);
        });
      });
    }
  }

  function appendSummarySection(wrap, s, showLabel, selectedEndIndex) {
    const data = s.data;
    if (!data || data.length === 0) return;
    const m   = GRAPH_METRICS.find(x => x.key === s.key);
    const dec = m ? m.decimals : 1;
    const f   = v => dec === 0 ? Math.round(v).toLocaleString() : v.toFixed(dec).replace('.', ',');
    const stats = GraphShared.computeSummaryStats(data, selectedEndIndex, { stripLeadingZeroes: true });
    if (!stats) return;
    const latest = stats.latest;
    const sum = stats.sum;
    const avg = stats.avg;
    const median = stats.median;
    const latestLabel = stats.latestLabel;

    const section = document.createElement('div');
    section.className = 'graph-summary-section';
    const labelHtml = showLabel === false
      ? ''
      : `<div class="graph-summary-label"><span class="metric-color-dot" style="background:${s.color.line}"></span>${m ? m.label : s.key}</div>`;
    section.innerHTML = `
      ${labelHtml}
      <div class="graph-summary">
        <div class="graph-stat-item"><span class="graph-stat-val">${f(latest)}</span><span class="graph-stat-lbl">${latestLabel}</span></div>
        <div class="graph-stat-item"><span class="graph-stat-val">${f(avg)}</span><span class="graph-stat-lbl">Average</span></div>
        <div class="graph-stat-item"><span class="graph-stat-val">${f(median)}</span><span class="graph-stat-lbl">Median</span></div>
        <div class="graph-stat-item"><span class="graph-stat-val positive">+${f(sum)}</span><span class="graph-stat-lbl">Total \u0394</span></div>
      </div>`;
    wrap.appendChild(section);
  }

  window.addEventListener('resize', () => { if (graphState.data) refreshCompareGraph(); });

  /* Path routing */
  function updateHash() {
    const activeNav = document.querySelector('.nav-item.active');
    const panel     = activeNav ? activeNav.dataset.panel : 'player';
    let path        = '/' + panel;
    if (panel === 'player' && playerInput.value.trim()) {
      path += '/' + encodeURIComponent(playerInput.value.trim());
    }
    if (window.location.pathname !== path) history.pushState(null, '', path);
  }

  function navigateFromPath() {
    var pathname = window.location.pathname;
    // strip leading slash and split
    var stripped = pathname.replace(/^\//, '');
    var parts    = stripped.split('/');
    var panel    = parts[0] || 'player';
    var username = parts[1] ? decodeURIComponent(parts[1]) : null;
    if (panel === 'player' && username) {
      var currentPlayer = state.playerData ? state.playerData.username : '';
      playerInput.value = username;
      // look up if it's a different player than what's already loaded
      if (username.toLowerCase() !== currentPlayer.toLowerCase()) {
        lookupPlayer(username);
      }
    } else if (panel === 'player') {
      playerInput.value = '';
    }
    if (window.switchToPanel) window.switchToPanel(panel);
  }

  window.addEventListener('popstate', navigateFromPath);

  /* Auto-lookup when panel becomes active with no data loaded, or redraw graph */
  var playerPanel = document.getElementById('panel-player');
  new MutationObserver(function () {
    if (playerPanel.classList.contains('active')) {
      if (!state.playerData) {
        var username = playerInput.value.trim();
        if (username) lookupPlayer(username);
      } else if (graphState.data) {
        // Graph may have loaded while panel was hidden (canvas width was 0) — redraw
        refreshCompareGraph();
      }
    }
  }).observe(playerPanel, { attributes: true, attributeFilter: ['class'] });

  /* Init */
  window.lookupPlayer = lookupPlayer;
  window.updateHash   = updateHash;
  navigateFromPath();

  // init share buttons for all graph panels
  if (window.GraphShared && window.GraphShared.initShareButtons) {
    window.GraphShared.initShareButtons();
  }

})();
