(function () {
  'use strict';

  const state = window.state;
  const GraphShared = window.GraphShared;
  const GUILD_PREFIX = 'ESI';

  const _userRoles = (window.state && window.state.user && window.state.user.roles) || [];
  const canClear = _userRoles.includes('1396112289832243282') || _userRoles.includes('554514823191199747');

  // preload guild levels + territories (cached for offline)
  DataCache.cachedFetch('/api/guild/levels').then(function (r) { window.guildLevels = r.data; }).catch(function () {});
  DataCache.cachedFetch('/api/guild/territories').then(function (r) { window.guildTerritories = r.data; }).catch(function () {});

  /* graph config */
  const guildGraphState = { data: null, compareData: null, compareUsername: null, compareLoading: false, graphReady: false, compareCache: {}, debugLogged: false, compareDebugLogged: {}, memberLookup: {} };
  const GUILD_GRAPH_METRICS = [
    { key: 'playerCount',  label: 'Active Players',  decimals: 0 },
    { key: 'wars',         label: 'Wars',            decimals: 0 },
    { key: 'guildRaids',   label: 'Guild Raids',     decimals: 0 },
    { key: 'newMembers',   label: 'New Members',     decimals: 0 },
    { key: 'totalMembers', label: 'Total Members',   decimals: 0 },
  ];
  const GUILD_COMPARE_METRICS = [
    { key: 'wars',       label: 'Wars',        decimals: 0 },
    { key: 'guildRaids', label: 'Guild Raids',  decimals: 0 },
  ];
  const METRICS_DEBUG_ENABLED = /^(1|true|yes|on)$/i.test(
    (new URLSearchParams(window.location.search).get('metricsDebug') || '').trim()
  );

  const GUILD_SERIES_COLORS = [
    { line: '#D4A017', fill: 'rgba(212,160,23,0.08)', point: '#F0C040' },
    { line: '#3BA55C', fill: 'rgba(59,165,92,0.08)',  point: '#5FD87A' },
    { line: '#5865F2', fill: 'rgba(88,101,242,0.08)', point: '#8A94F7' },
  ];
  const MAX_METRICS = 3;

  /* apply settings defaults */
  var _guildDefaultMetric = (window.esiSettings && window.esiSettings.get('guildDefaultMetric')) || 'playerCount';
  var _guildDefaultRange  = (window.esiSettings && window.esiSettings.get('guildDefaultRange'))  || 30;
  _guildDefaultRange = Math.max(2, Math.min(60, parseInt(_guildDefaultRange, 10) || 30));
  var _guildInitMetric = (GUILD_GRAPH_METRICS.some(m => m.key === _guildDefaultMetric)) ? _guildDefaultMetric : 'playerCount';

  const guildGraph = {
    metrics:          [_guildInitMetric],
    days:             _guildDefaultRange,
    canvas:           document.getElementById('guildGraphCanvas'),
    range:            document.getElementById('guildGraphRange'),
    daysLbl:          document.getElementById('guildGraphDaysLabel'),
    rowsWrap:         document.getElementById('guildGraphMetricRows'),
    addBtn:           document.getElementById('guildBtnAddMetric'),
    legendWrap:       document.getElementById('guildGraphLegend'),
    summaryWrap:      document.getElementById('guildGraphSummaries'),
    compareTrigger:   document.getElementById('guildCompareTrigger'),
    compareInputArea: document.getElementById('guildCompareInputArea'),
    compareInput:     document.getElementById('guildComparePlayerInput'),
    compareClearBtn:  document.getElementById('guildBtnCompareClear'),
    comparePill:      document.getElementById('guildComparePill'),
    comparePillName:  document.getElementById('guildComparePillName'),
    compareStatus:    document.getElementById('guildCompareStatus'),
    hoverModel:       null,
    selectedDayOffset: null,
  };

  function formatGuildGraphValue(metricKey, value) {
    if (!Number.isFinite(value)) return 'N/A';
    const metric = GUILD_GRAPH_METRICS.find(m => m.key === metricKey);
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

  function ensureGuildGraphTooltip(canvas) {
    return GraphShared.ensureTooltip(canvas);
  }

  function ensureGuildGraphHoverGuides(canvas) {
    return GraphShared.ensureHoverGuides(canvas);
  }

  function hideGuildGraphHoverGuides(guides) {
    GraphShared.hideHoverGuides(guides);
  }

  function updateGuildGraphHoverGuides(guides, model, hoverPoint) {
    GraphShared.updateHoverGuides(guides, model, hoverPoint);
  }

  function resolveGuildGraphSelectedIndex(dayOffset, maxLen) {
    return GraphShared.resolveSelectedIndex(dayOffset, maxLen);
  }

  function updateGuildGraphPinnedGuide(guides, model) {
    return GraphShared.updatePinnedGuide(guides, model, guildGraph.selectedDayOffset);
  }

  function positionGuildGraphTooltip(tooltip, wrap, x, y) {
    GraphShared.positionTooltip(tooltip, wrap, x, y);
  }

  function initGuildGraphHover() {
    const canvas = guildGraph.canvas;
    if (!canvas) return;
    const tooltip = ensureGuildGraphTooltip(canvas);
    const guides = ensureGuildGraphHoverGuides(canvas);

    function hideHover() {
      tooltip.style.display = 'none';
      hideGuildGraphHoverGuides(guides);
    }

    canvas.addEventListener('mouseleave', hideHover);
    canvas.addEventListener('mousemove', function (e) {
      const model = guildGraph.hoverModel;
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
      updateGuildGraphHoverGuides(guides, model, { index: hoverIndex, x: hoverX });

      const rows = [];
      model.series.forEach(series => {
        const p = series.points[hoverIndex];
        if (!p) return;
        const metric = GUILD_GRAPH_METRICS.find(m => m.key === series.key);
        const metricLabel = metric ? metric.label : series.key;
        const playerLabel = series.player ? series.player : null;
        rows.push({
          label: playerLabel ? `${metricLabel} · ${playerLabel}` : metricLabel,
          value: formatGuildGraphValue(series.key, p.value),
          color: series.color,
          dashed: series.dashed,
        });
      });

      if (!rows.length) {
        tooltip.style.display = 'none';
        hideGuildGraphHoverGuides(guides);
        return;
      }

      tooltip.innerHTML = rows.map(r => `
      <div class="graph-hover-row">
        <span class="graph-hover-swatch" style="background:${r.color};${r.dashed ? 'opacity:0.5' : ''}"></span>
        <span class="graph-hover-label">${r.label}</span>
        <span class="graph-hover-value">${r.value}</span>
      </div>`).join('');
      tooltip.style.display = 'block';
      const offsetX = Number.isFinite(model.canvasOffsetX) ? model.canvasOffsetX : 0;
      const offsetY = Number.isFinite(model.canvasOffsetY) ? model.canvasOffsetY : 0;
      positionGuildGraphTooltip(tooltip, guides.wrap, mx + offsetX, my + offsetY);
    });
    canvas.addEventListener('click', function (e) {
      const model = guildGraph.hoverModel;
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
      guildGraph.selectedDayOffset = guildGraph.selectedDayOffset === selectedOffset ? null : selectedOffset;
      refreshGuildGraph();
    });
  }

  initGuildGraphHover();

  /* lazy load: only fetch when guild panel is first shown */
  const API_BASE = window.location.origin;

  function cacheGuildMetricsDebug(resp) {
    if (!resp || !resp.debug) return;
    const guildDebug = {
      intervals: Array.isArray(resp.debug.intervals) ? resp.debug.intervals : [],
      dailyGuildRaids: Array.isArray(resp.debug.dailyGuildRaids) ? resp.debug.dailyGuildRaids : [],
    };
    window.guildStatsDebugCache = guildDebug;
    window.playtimeDebugCache = window.playtimeDebugCache || {};
    window.playtimeDebugCache.guild = guildDebug;
    if (resp.debug.rules) window.playtimeDebugCache.rules = resp.debug.rules;
  }

  function cacheGuildCompareMetricsPayload(username, resp) {
    if (!username || !resp) return;
    const key = username.toLowerCase();
    const metrics = resp.metrics || {};
    const existing = (window.playtimeCache && window.playtimeCache[key]) || {};
    window.playtimeCache = window.playtimeCache || {};
    window.playtimeCache[key] = Object.assign({}, existing, {
      username: resp.username || existing.username || username,
      dates: Array.isArray(resp.playtimeDates) ? resp.playtimeDates : (existing.dates || []),
      metricDates: Array.isArray(resp.metricDates) ? resp.metricDates : (existing.metricDates || []),
      data: Array.isArray(metrics.playtime) ? metrics.playtime : (existing.data || []),
      wars: Array.isArray(metrics.wars) ? metrics.wars : (existing.wars || []),
      guildRaids: Array.isArray(metrics.guildRaids) ? metrics.guildRaids : (existing.guildRaids || []),
    });
  }

  function cacheGuildCompareMetricsDebug(username, resp) {
    if (!resp || !resp.debug || !username) return;
    const key = username.toLowerCase();
    window.playtimeDebugCache = window.playtimeDebugCache || {};
    window.playtimeDebugCache.members = window.playtimeDebugCache.members || {};
    window.playtimeDebugCache.members[key] = {
      guildRaids: Array.isArray(resp.debug.guildRaids) ? resp.debug.guildRaids : [],
    };
    if (resp.debug.rules) window.playtimeDebugCache.rules = resp.debug.rules;
  }

  function maybeLogGuildDebug() {
    if (!METRICS_DEBUG_ENABLED || guildGraphState.debugLogged) return;
    guildGraphState.debugLogged = true;
  }

  function maybeLogGuildCompareDebug(username) {
    if (!METRICS_DEBUG_ENABLED || !username) return;
    const key = username.toLowerCase();
    if (guildGraphState.compareDebugLogged[key]) return;
    guildGraphState.compareDebugLogged[key] = true;
  }
  let guildLoaded = false;
  var _guildStatsTotalsP = null;

  function tryLoad() {
    if (!guildLoaded) loadGuild();
  }

  // If page starts on #guild
  if (document.getElementById('panel-guild').classList.contains('active')) {
    tryLoad();
  }

  document.querySelector('[data-panel="guild"]').addEventListener('click', () => {
    setTimeout(tryLoad, 0);
  });

  /* redraw when the panel becomes visible (canvas is 0-width while hidden) */
  new MutationObserver(function () {
    if (document.getElementById('panel-guild').classList.contains('active') && guildGraphState.data) {
      refreshGuildGraph();
    }
  }).observe(document.getElementById('panel-guild'), { attributes: true, attributeFilter: ['class'] });

  /* api */
  async function apiFetch(path) {
    const res = await fetch(API_BASE + path);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `Server error ${res.status}`);
    }
    return res.json();
  }

  async function loadGuild() {
    guildLoaded = true;
    const isRefetch = !!state.guildApiData;

    // try sessionStorage first
    const guildCacheUrl = '/api/guild/prefix/' + encodeURIComponent(GUILD_PREFIX);
    const cachedGuild = !isRefetch ? DataCache.readCache(guildCacheUrl) : null;

    // show cached data immediately if it exists
    if (cachedGuild && !isRefetch) {
      state.guildApiData = cachedGuild;
      document.getElementById('guildLoading').style.display = 'none';
      document.getElementById('guildError').style.display = 'none';
      renderGuild(cachedGuild);
    }

    var _guildFetchToast = null;
    var _gDone = 0, _gTotal = 0;
    const skipLoading = isRefetch || !!cachedGuild;
    if (!skipLoading) {
      setGuildLoading(true);
    } else if (typeof window.showProgressToast === 'function') {
      _guildFetchToast = window.showProgressToast('Fetching guild data\u2026');
      _guildFetchToast.addItem('api', 'Wynncraft API');
      _guildFetchToast.addItem('stats', 'Stats Database');
      _guildFetchToast.addItem('logs', 'Member Logs');
      _guildFetchToast.addItem('aspects', 'Aspects Data');
      _guildFetchToast.addItem('activity', 'Activity Data');
      _gTotal = 5;
    }
    var _gFinishMsgs = {
      success: '\u2713 Guild data loaded',
      fail:    '\u2715 Failed to load guild data',
      partial: '\u26a0 Guild data partially loaded',
    };
    function _gCheckDone() {
      _gDone++;
      if (_gDone >= _gTotal && _guildFetchToast) _guildFetchToast.finish(_gFinishMsgs);
    }

    // aspects data loaded at page start
    if (_guildFetchToast) {
      (window.aspectsDataPromise || Promise.resolve()).then(function () {
        if (_guildFetchToast) _guildFetchToast.updateItem('aspects', 'success');
        _gCheckDone();
      });
    }

    // kick off DB-backed fetches immediately
    _guildStatsTotalsP = DataCache.cachedFetch('/api/guild/stats')
      .then(function (r) { if (_guildFetchToast) _guildFetchToast.updateItem('stats', 'success'); _gCheckDone(); return r.data; })
      .catch(function () { if (_guildFetchToast) _guildFetchToast.updateItem('stats', 'error'); _gCheckDone(); return {}; });
    loadAndRenderGuildLogs()
      .then(function (ok) { if (_guildFetchToast) _guildFetchToast.updateItem('logs', ok ? 'success' : 'error'); _gCheckDone(); });
    // graph is DB-backed, loads on its own
    var _gGraphP = initGuildGraph();
    if (_guildFetchToast) {
      _gGraphP.then(function (ok) {
        if (_guildFetchToast) _guildFetchToast.updateItem('activity', ok ? 'success' : 'error');
        _gCheckDone();
      });
    }

    try {
      const data = await apiFetch(guildCacheUrl);
      DataCache.writeCache(guildCacheUrl, data);
      state.guildApiData = data;
      renderGuild(data);
      document.getElementById('guildLoading').style.display = 'none';
      if (_guildFetchToast) _guildFetchToast.updateItem('api', 'success');
      _gCheckDone();
    } catch (err) {
      if (_guildFetchToast) _guildFetchToast.updateItem('api', 'error');
      _gCheckDone();
      if (skipLoading && !_guildFetchToast) {
        if (typeof window.showToast === 'function') {
          window.showToast('\u26a0 ' + friendlyGuildError(err.message), 'error');
        }
      }
      if (!skipLoading) {
        // show failure state
        document.getElementById('guildLoading').style.display = 'none';
        document.getElementById('guildCardName').textContent = 'Unavailable';
        document.getElementById('guildCardPrefix').textContent = '';
        document.getElementById('guildCardLevel').textContent = '\u2014';
        document.getElementById('guildCardOnline').textContent = '\u25cf Unavailable';
        document.getElementById('guildCardOnline').className = 'status-pill offline';
        document.getElementById('guildCardXpRow').innerHTML = '';
        document.getElementById('guildCardMembers').textContent = '\u2014';
        document.getElementById('guildCardWars').textContent = '\u2014';
        document.getElementById('guildCardFounded').textContent = '\u2014';
        document.getElementById('guildCardOwner').textContent = '';
        document.getElementById('guildOwedCards').innerHTML = '';
        var failLabels = ['Guild Level','Members','Online Now','Total Wars','Guild Raids','Founded','Mobs Killed','Quests Completed','Chests Found','Content Done'];
        document.getElementById('guildStatsGrid').innerHTML = failLabels.map(function (lbl) {
          return '<div class="stat-list-row"><span class="stat-list-label">' + lbl + '</span><span class="stat-list-value" style="color:var(--text-faint)">\u2014</span></div>';
        }).join('');
        document.getElementById('guildMembersTotal').textContent = '\u2014';
        document.getElementById('guildMembersList').innerHTML = '';
        if (typeof window.showToast === 'function') {
          window.showToast('\u26a0 ' + friendlyGuildError(err.message), 'error', { persistent: true });
        }
      }
    }
  }

  function setGuildLoading(loading) {
    document.getElementById('guildLoading').style.display = loading ? 'flex' : 'none';
    document.getElementById('guildError').style.display   = 'none';
    if (loading) {
      // show layout immediately with placeholder text
      var contentEl = document.getElementById('guildContent');
      contentEl.style.display = 'block';
      document.getElementById('guildCardName').textContent = 'Loading\u2026';
      document.getElementById('guildCardPrefix').textContent = '';
      document.getElementById('guildCardLevel').innerHTML = 'Level <strong style="color:var(--text-faint)">\u2026</strong>';
      document.getElementById('guildCardOnline').textContent = '\u25cf Loading';
      document.getElementById('guildCardOnline').className = 'status-pill';
      document.getElementById('guildCardXpRow').innerHTML = '<span style="color:var(--text-faint);font-style:italic">Loading\u2026</span>';
      document.getElementById('guildCardMembers').innerHTML = '<strong style="color:var(--text-faint)">\u2026</strong> Members';
      document.getElementById('guildCardWars').innerHTML = '<strong style="color:var(--text-faint)">\u2026</strong> Wars';
      document.getElementById('guildCardFounded').innerHTML = 'Founded <strong style="color:var(--text-faint)">\u2026</strong>';
      document.getElementById('guildCardOwner').innerHTML = '♛ Owner: <strong style="color:var(--text-faint)">\u2026</strong>';
      // owed card placeholders
      document.getElementById('guildOwedCards').innerHTML =
        '<div class="owed-card"><div class="owed-value" style="color:var(--text-faint)">\u2026</div><div class="owed-label">Loading</div></div>' +
        '<div class="owed-card"><div class="owed-value" style="color:var(--text-faint)">\u2026</div><div class="owed-label">Loading</div></div>' +
        '<div class="owed-card"><div class="owed-value" style="color:var(--text-faint)">\u2026</div><div class="owed-label">Loading</div></div>';
      // stats placeholders
      var guildStatsLabels = ['Guild Level','Members','Online Now','Total Wars','Guild Raids','Founded','Mobs Killed','Quests Completed','Chests Found','Content Done'];
      var statsGrid = document.getElementById('guildStatsGrid');
      statsGrid.innerHTML = guildStatsLabels.map(function (lbl) {
        return '<div class="stat-list-row"><span class="stat-list-label">' + lbl + '</span><span class="stat-list-value" style="color:var(--text-faint);font-style:italic">\u2026</span></div>';
      }).join('');
      document.getElementById('guildRaidsCard').style.display = 'none';
      // members placeholder
      document.getElementById('guildMembersTotal').textContent = 'Loading\u2026';
      document.getElementById('guildMembersList').innerHTML = '<div style="padding:16px 20px;color:var(--text-faint);font-style:italic;font-weight:500;">Loading members\u2026</div>';
      // graph handles its own loading
      var splitEl = document.querySelector('#guildContent .guild-split-layout');
      if (splitEl) splitEl.style.display = '';
      switchGuildView('global');
    }
  }

  function setGuildError(msg) {
    document.getElementById('guildLoading').style.display = 'none';
    document.getElementById('guildError').style.display   = 'block';
    document.getElementById('guildError').textContent     = '\u26a0 ' + msg;
    document.getElementById('guildContent').style.display = 'none';
  }

  function friendlyGuildError(msg) {
    var text = String(msg || '').trim();
    var lower = text.toLowerCase();
    if (!text) return 'Could not load guild data. Try again shortly.';
    if (lower.includes('429') || lower.includes('rate limit'))
      return 'Wynncraft is rate-limiting requests. Please wait a moment.';
    if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('too long'))
      return 'Wynncraft took too long to respond. Try again shortly.';
    if (lower.includes('could not reach') || lower.includes('network') || lower.includes('failed to fetch') || lower.includes('max retries') || lower.includes('connectionpool'))
      return 'Could not reach Wynncraft right now. Try again shortly.';
    if (lower.includes('server error') || lower.includes('502') || lower.includes('503'))
      return 'Wynncraft is having issues right now. Try again shortly.';
    return text.length > 80 ? text.substring(0, 77) + '\u2026' : text;
  }

  /* helpers */
  function fmt(n)     { return n == null ? 'N/A' : Number(n).toLocaleString(); }
  function fmtDate(iso) {
    if (!iso) return 'N/A';
    return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function capFirst(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
  }

  /* flatten members into a sorted array */
  function flattenMembers(members) {
    const out = [];
    const ROLE_ORDER = ['owner','chief','strategist','captain','recruiter','recruit'];
    for (const role of ROLE_ORDER) {
      const group = members[role];
      if (!group || typeof group !== 'object') continue;
      for (const [name, data] of Object.entries(group)) {
        out.push({ name, role, ...data });
      }
    }
    out.sort((a, b) => (a.contributionRank || 999) - (b.contributionRank || 999));
    return out;
  }

  function resolveGuildMemberName(username) {
    const key = (username || '').trim().toLowerCase();
    if (!key) return null;
    return guildGraphState.memberLookup[key] || null;
  }

  /* total guild raids across all members */
  function aggregateGuildRaids(flatMembers) {
    const totals = {};
    let grandTotal = 0;
    for (const m of flatMembers) {
      const raids = m.guildRaids;
      if (!raids) continue;
      grandTotal += raids.total || 0;
      for (const [raidName, count] of Object.entries(raids.list || {})) {
        totals[raidName] = (totals[raidName] || 0) + count;
      }
    }
    return { total: grandTotal, list: totals };
  }

  /* count online */
  function countOnline(flatMembers) {
    return flatMembers.filter(m => m.online).length;
  }

  function getOnlinePlayers(flatMembers) {
    const ROLE_ORDER = ['owner', 'chief', 'strategist', 'captain', 'recruiter', 'recruit'];
    return flatMembers
      .filter(m => m.online)
      .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
      .map(m => m.name);
  }

  /* render */
  function renderGuild(data) {
    const members     = data.members || {};
    const flatMembers = flattenMembers(members);
    const memberLookup = {};
    flatMembers.forEach(function (m) { memberLookup[m.name.toLowerCase()] = m.name; });
    guildGraphState.memberLookup = memberLookup;
    const onlinePlayers = getOnlinePlayers(flatMembers);
    const onlineCount = onlinePlayers.length;
    const raidsAgg    = aggregateGuildRaids(flatMembers);

    /* guild card */
    renderGuildCard(data, flatMembers, onlineCount, onlinePlayers);

    /* owed cards */
    const aspectsData = window.aspectsData || { total_aspects: 0, members: {} };
    const owedAspects = Object.values(aspectsData.members || {}).reduce((s, m) => s + (flatMembers.some(fm => fm.name === m.name) ? (m.owed || 0) : 0), 0);
    const territories = Object.keys((window.guildTerritories || {}).territories || {}).length;
    // only show ESI members in the owed list
    const RANK_PRIORITY = { owner: 6, chief: 5, strategist: 4, captain: 3, recruiter: 2, recruit: 1 };
    const guildMemberNames = new Set(flatMembers.map(fm => fm.name));

    const owedPlayers = Object.values(aspectsData.members || {})
      .filter(m => m.owed > 0 && guildMemberNames.has(m.name))
      .sort((a, b) => {
        if (b.owed !== a.owed) return b.owed - a.owed;
        const memberA = flatMembers.find(fm => fm.name === a.name);
        const memberB = flatMembers.find(fm => fm.name === b.name);
        return (RANK_PRIORITY[memberB?.role] || 0) - (RANK_PRIORITY[memberA?.role] || 0);
      });

    document.getElementById('guildOwedCards').innerHTML = `
      <div class="owed-card owed-card-clickable" id="owedAspectsCard">
        <div class="owed-icon"><img src="/images/aspect_icon.avif" alt="aspect" style="width:32px;height:32px;image-rendering:pixelated"></div>
        <div class="owed-value">${owedAspects}<span style="font-size:1rem;color:var(--text-dim)"> / 120</span></div>
        <div class="owed-label">Aspects Owed</div>
      </div>
      <div class="owed-card">
        <div class="owed-icon"><img src="/images/point_icon.png" alt="point" style="width:32px;height:32px;image-rendering:pixelated"></div>
        <div class="owed-value">Coming soon</div>
        <div class="owed-label">ESI Points</div>
      </div>
      <div class="owed-card owed-card-clickable" id="territoriesCard">
        <div class="owed-icon"><img src="/images/territory_icon.png" alt="territory" style="width:32px;height:32px;image-rendering:pixelated"></div>
        <div class="owed-value">${fmt(territories)}</div>
        <div class="owed-label">Territories</div>
      </div>`;

    // popup
    const existingPopup = document.getElementById('owedAspectsPopup');
    if (existingPopup) existingPopup.remove();
    const existingOverlay = document.getElementById('owedAspectsOverlay');
    if (existingOverlay) existingOverlay.remove();

    // mutable copy so clears show up right away
    const localAspectsData = JSON.parse(JSON.stringify(aspectsData));

    function getOwedPlayers() {
      return Object.entries(localAspectsData.members || {})
        .filter(([, m]) => m.owed > 0 && guildMemberNames.has(m.name))
        .sort(([, a], [, b]) => {
          if (b.owed !== a.owed) return b.owed - a.owed;
          const memberA = flatMembers.find(fm => fm.name === a.name);
          const memberB = flatMembers.find(fm => fm.name === b.name);
          return (RANK_PRIORITY[memberB?.role] || 0) - (RANK_PRIORITY[memberA?.role] || 0);
        });
    }

    function getTotalOwed() {
      return Object.values(localAspectsData.members || {}).reduce((s, m) => s + (guildMemberNames.has(m.name) ? (m.owed || 0) : 0), 0);
    }

    function owedColor(n) {
      return n >= 105 ? '#e74c3c' : n >= 60 ? '#e67e22' : n >= 30 ? '#f1c40f' : 'var(--online)';
    }

    const popup = document.createElement('div');
    popup.id = 'owedAspectsPopup';
    popup.className = 'owed-aspects-popup';
    document.body.appendChild(popup);

    const overlay = document.createElement('div');
    overlay.id = 'owedAspectsOverlay';
    overlay.className = 'owed-aspects-overlay';
    document.body.appendChild(overlay);

    function renderOwedPopup() {
      const total = getTotalOwed();
      const players = getOwedPlayers();
      popup.innerHTML = `
        <div class="owed-aspects-popup-header">
          <img src="/images/aspect_icon.avif" alt="aspect" style="width:16px;height:16px;image-rendering:pixelated;vertical-align:middle;margin-right:6px">Aspects Owed
            <span class="owed-aspects-popup-count" style="color:${owedColor(total)}">${total}/120</span>
          </span>
          <button class="owed-aspects-popup-close" id="owedAspectsClose">✕</button>
        </div>
        <div class="owed-aspects-popup-list">
          ${players.length
            ? players.map(([uuid, m]) => {
                const memberInfo = flatMembers.find(fm => fm.name === m.name);
                const role = memberInfo ? memberInfo.role : null;
                const badge = role ? `<span class="guild-rank-badge guild-rank-${role}">${capFirst(role)}</span>` : '';
                return `
                <div class="owed-aspects-row" data-uuid="${uuid}">
                  <span class="owed-aspects-player-name guild-log-name-link" data-username="${m.name}">${m.name}</span>${badge}
                  <div class="owed-aspects-right">
                    <span class="owed-aspects-player-count">${m.owed} owed</span>
                    ${canClear ? `<button class="owed-aspects-clear-btn" data-uuid="${uuid}" title="Clear aspects for ${m.name}">Clear</button>` : ''}
                  </div>
                </div>`;
              }).join('')
            : '<div class="owed-aspects-empty">No aspects owed</div>'
          }
        </div>`;

      popup.querySelectorAll('.guild-log-name-link').forEach(el => {
        el.addEventListener('click', () => { closeOwedPopup(); window.goToPlayer(el.dataset.username) });
      });

      popup.querySelectorAll('.owed-aspects-clear-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          const uuid = btn.dataset.uuid;
          const member = localAspectsData.members[uuid];
          if (!member) return;

          btn.disabled = true;
          btn.textContent = '...';

          try {
            const res = await fetch('/api/guild/aspects/clear', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ uuid }),
            });
            if (!res.ok) throw new Error('Server error ' + res.status);

            // update local state
            member.owed = 0;
            localAspectsData.total_aspects = getTotalOwed();
            window.aspectsData = localAspectsData;

            // update the card
            const cardVal = document.querySelector('#owedAspectsCard .owed-value');
            if (cardVal) cardVal.innerHTML = `${localAspectsData.total_aspects}<span style="font-size:1rem;color:var(--text-dim)"> / 120</span>`;

            renderOwedPopup();
          } catch (err) {
            btn.disabled = false;
            btn.textContent = 'Clear';
            btn.classList.add('owed-aspects-clear-btn--error');
            btn.title = 'Failed: ' + err.message;
            setTimeout(() => {
              btn.classList.remove('owed-aspects-clear-btn--error');
              btn.title = 'Clear aspects for ' + member.name;
            }, 2000);
          }
        });
      });

      document.getElementById('owedAspectsClose').addEventListener('click', e => {
        e.stopPropagation();
        closeOwedPopup();
      });
    }

    function openOwedPopup() {
      renderOwedPopup();
      popup.classList.add('open');
      overlay.classList.add('open');
      document.body.classList.add('popup-scroll-lock');
    }
    function closeOwedPopup() {
      popup.classList.remove('open');
      overlay.classList.remove('open');
      document.body.classList.remove('popup-scroll-lock');
    }

    document.getElementById('owedAspectsCard').addEventListener('click', openOwedPopup);
    overlay.addEventListener('click', closeOwedPopup);

    // territories popup
    const existingTerrPopup = document.getElementById('territoriesPopup');
    if (existingTerrPopup) existingTerrPopup.remove();
    const existingTerrOverlay = document.getElementById('territoriesOverlay');
    if (existingTerrOverlay) existingTerrOverlay.remove();

    const terrPopup = document.createElement('div');
    terrPopup.id = 'territoriesPopup';
    terrPopup.className = 'owed-aspects-popup';
    document.body.appendChild(terrPopup);

    const terrOverlay = document.createElement('div');
    terrOverlay.id = 'territoriesOverlay';
    terrOverlay.className = 'owed-aspects-overlay';
    document.body.appendChild(terrOverlay);

    function fmtTerrTimestamp(iso) {
      if (!iso) return 'Unknown';
      return new Date(iso).toLocaleString('en-GB', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    }

    function renderTerrPopup() {
      const terrData   = window.guildTerritories || {};
      const history    = (terrData.history || []).slice().reverse();
      const current    = terrData.territories || {};
      const lastUpdate = terrData.last_update ? fmtTerrTimestamp(terrData.last_update) : 'Unknown';

      terrPopup.innerHTML = `
        <div class="owed-aspects-popup-header">
          <img src="/images/territory_icon.png" alt="territory" style="width:16px;height:16px;image-rendering:pixelated;vertical-align:middle;margin-right:6px">
          Territories
          <span class="owed-aspects-popup-count" style="color:var(--text-dim);font-size:0.85rem;margin-left:0.4rem">· ${fmt(Object.keys(current).length)} held · updated ${lastUpdate}</span>
          <button class="owed-aspects-popup-close" id="territoriesClose">✕</button>
        </div>
        <div class="owed-aspects-popup-list">
          ${history.length
            ? history.map(e => {
                const isCapture = e.type === 'Territory Captured';
                const color     = isCapture ? 'var(--online)' : '#e74c3c';
                const arrow     = isCapture ? '▲' : '▼';
                return `
                <div class="owed-aspects-row">
                  <span style="color:${color};font-weight:700;margin-right:0.5rem;flex-shrink:0">${arrow}</span>
                  <span class="territory-name">${e.territory}</span>
                  <div class="owed-aspects-right" style="flex-direction:column;align-items:flex-end;gap:0.1rem">
                    <span style="font-size:0.78rem;color:var(--text-dim)">${isCapture ? 'from' : 'to'} ${isCapture ? e.from_guild : e.to_guild}</span>
                    <span style="font-size:0.75rem;color:var(--text-faint)">${fmtTerrTimestamp(e.timestamp)}</span>
                  </div>
                </div>`;
              }).join('')
            : '<div class="owed-aspects-empty">No territory history</div>'
          }
        </div>`;

      document.getElementById('territoriesClose').addEventListener('click', e => {
        e.stopPropagation();
        closeTerrPopup();
      });
    }

    function openTerrPopup() {
      renderTerrPopup();
      terrPopup.classList.add('open');
      terrOverlay.classList.add('open');
      document.body.classList.add('popup-scroll-lock');
    }
    function closeTerrPopup() {
      terrPopup.classList.remove('open');
      terrOverlay.classList.remove('open');
      document.body.classList.remove('popup-scroll-lock');
    }

    document.getElementById('territoriesCard').addEventListener('click', openTerrPopup);
    terrOverlay.addEventListener('click', closeTerrPopup);

    /* stats grid */
    const statsGrid = document.getElementById('guildStatsGrid');
    statsGrid.innerHTML = '';

    (_guildStatsTotalsP || DataCache.cachedFetch('/api/guild/stats').then(function (r) { return r.data; }).catch(function () { return {}; })).then(totals => {
      const stats = [
        { label: 'Guild Level',     val: fmt(data.level) + (data.xpPercent != null ? `  <span style="color:var(--text-faint);font-size:0.8em">(${data.xpPercent}%)</span>` : '') },
        { label: 'Members',          val: `${fmt(members.total || flatMembers.length)}` },
        { label: 'Online Now',       val: fmt(onlineCount) },
        { label: 'Total Wars',       val: fmt(data.wars) },
        { label: 'Guild Raids',      val: fmt(raidsAgg.total) },
        { label: 'Founded',          val: fmtDate(data.created) },
        { label: 'Mobs Killed',      val: totals.mobsKilled      != null ? fmt(totals.mobsKilled)      : 'N/A' },
        { label: 'Quests Completed', val: totals.questsCompleted != null ? fmt(totals.questsCompleted) : 'N/A' },
        { label: 'Chests Found',     val: totals.chestsFound     != null ? fmt(totals.chestsFound)     : 'N/A' },
        { label: 'Content Done',     val: totals.contentDone     != null ? fmt(totals.contentDone)     : 'N/A' },
      ];
      statsGrid.innerHTML = '';
      stats.forEach(s => {
        const el = document.createElement('div');
        el.className = 'stat-list-row';
        el.innerHTML = `<span class="stat-list-label">${s.label}</span><span class="stat-list-value">${s.val}</span>`;
        statsGrid.appendChild(el);
      });
    });

    /* guild raids */
    renderGuildRaids(raidsAgg);

    /* members list */
    renderGuildMembers(flatMembers);

    /* show content */
    document.getElementById('guildContent').style.display = 'block';
    switchGuildView('global');
  }

  function renderGuildCard(data, flatMembers, onlineCount, onlinePlayers) {
    const members = data.members || {};
    const totalMembers = members.total || flatMembers.length;

    /* name + prefix */
    document.getElementById('guildCardName').textContent = data.name || 'Unknown Guild';
    document.getElementById('guildCardPrefix').textContent = '[' + (data.prefix || '???') + ']';

    /* level */
    const lvlEl = document.getElementById('guildCardLevel');
    lvlEl.innerHTML = 'Level <strong>' + fmt(data.level) + '</strong>';

    /* online count */
    const onlineEl = document.getElementById('guildCardOnline');
    onlineEl.textContent = '● ' + fmt(onlineCount) + ' Online';
    onlineEl.className = 'status-pill ' + (onlineCount > 0 ? 'online' : 'offline');
    const existingBodyTooltip = document.getElementById('guildOnlineBodyTooltip');
    if (existingBodyTooltip) existingBodyTooltip.remove();

    if (onlinePlayers && onlinePlayers.length > 0) {
      onlineEl.classList.add('has-online-tooltip');

      const tooltipEl = document.createElement('div');
      tooltipEl.id = 'guildOnlineBodyTooltip';
      tooltipEl.className = 'guild-online-tooltip';
      tooltipEl.style.cssText = 'display:none;position:fixed;z-index:9999;flex-direction:column;align-items:flex-start;';

      const tooltipTitleEl = document.createElement('span');
      tooltipTitleEl.className = 'guild-online-tooltip-title';
      tooltipTitleEl.textContent = 'Online Players';
      tooltipEl.appendChild(tooltipTitleEl);

      onlinePlayers.forEach(function (name) {
        const playerEl = document.createElement('span');
        playerEl.className = 'guild-online-tooltip-item';
        playerEl.textContent = name;
        playerEl.style.cursor = 'pointer';
        playerEl.addEventListener('click', function () { window.goToPlayer(name); });
        tooltipEl.appendChild(playerEl);
      });

      document.body.appendChild(tooltipEl);

      var hideTimer = null;
      var tooltipVisible = false;

      function positionOnlineTooltip() {
        var navBarEl   = document.querySelector('.navbar');
        var navH       = navBarEl ? navBarEl.offsetHeight : 64;
        var rect = onlineEl.getBoundingClientRect();

        // hide if the pill scrolled off-screen
        if (rect.bottom < navH || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
          hideOnlineTooltip();
          return;
        }

        var margin = 8;
        var top  = rect.bottom + 6;
        var left = rect.left;

        // cap height to what's available below the pill
        var availH = window.innerHeight - top - margin;
        tooltipEl.style.maxHeight = Math.max(availH, 80) + 'px';
        tooltipEl.style.overflowY = 'auto';

        var tw = tooltipEl.offsetWidth;
        if (left + tw > window.innerWidth - margin) left = window.innerWidth - tw - margin;
        if (left < margin) left = margin;

        tooltipEl.style.top  = top  + 'px';
        tooltipEl.style.left = left + 'px';
      }

      function showOnlineTooltip() {
        clearTimeout(hideTimer);
        if (!tooltipVisible) {
          tooltipEl.style.display = 'flex';
          tooltipVisible = true;
          window.addEventListener('scroll', positionOnlineTooltip, true);
        }
        positionOnlineTooltip();
      }

      function hideOnlineTooltip() {
        clearTimeout(hideTimer);
        if (!tooltipVisible) return;
        tooltipEl.style.display = 'none';
        tooltipVisible = false;
        window.removeEventListener('scroll', positionOnlineTooltip, true);
      }

      function scheduleHide() {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(hideOnlineTooltip, 120);
      }

      onlineEl.addEventListener('mouseenter', showOnlineTooltip);
      onlineEl.addEventListener('mouseleave', scheduleHide);
      tooltipEl.addEventListener('mouseenter', function () { clearTimeout(hideTimer); });
      tooltipEl.addEventListener('mouseleave', scheduleHide);

      var guildPanel = document.getElementById('panel-guild');
      if (guildPanel) {
        new MutationObserver(function () {
          if (!guildPanel.classList.contains('active')) hideOnlineTooltip();
        }).observe(guildPanel, { attributes: true, attributeFilter: ['class'] });
      }
    }

    /* xp bar */
    const xpRow = document.getElementById('guildCardXpRow');
    const xpPct   = data.xpPercent != null ? data.xpPercent : 0;
    const level   = data.level || 1;
    const GUILD_LEVELS = window.guildLevels || {};
    const xpNeeded = GUILD_LEVELS[String(level)] || null;
    const xpDone   = xpNeeded != null ? Math.round(xpNeeded * xpPct / 100) : null;
    const xpLeft   = xpNeeded != null ? xpNeeded - xpDone : null;
    const raidsLeft = xpNeeded != null ? Math.ceil((100 - xpPct) / 0.1) : null;

    function fmtXp(n) {
      if (n == null) return 'N/A';
      if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
      if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
      if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
      return n.toLocaleString();
    }

    const tooltipText = xpLeft != null
      ? `${fmtXp(xpLeft)} XP left <span style="color:var(--gold-light);font-weight:700"> • </span>${raidsLeft.toLocaleString()} raids to level up`
      : '';

    xpRow.innerHTML = `
      <span>XP Progress: <strong style="color:var(--gold-light)">${xpPct}%</strong></span>
      <div class="xp-bar-wrap" style="position:relative;">
        <div class="xp-bar-track" style="cursor: default;">
          <div class="xp-bar-fill" style="width:${xpPct}%"></div>
        </div>
        ${tooltipText ? `<div class="xp-bar-tooltip">${tooltipText}</div>` : ''}
      </div>`;
    
    if (tooltipText) {
      const xpTooltipEl = document.createElement('div');
      xpTooltipEl.className = 'xp-bar-tooltip';
      xpTooltipEl.innerHTML = tooltipText;
      document.body.appendChild(xpTooltipEl);

      const xpTrack = xpRow.querySelector('.xp-bar-track');
      xpTrack.addEventListener('mouseenter', () => { xpTooltipEl.style.display = 'block'; });
      xpTrack.addEventListener('mousemove', (e) => {
        const margin = 8;
        let left = e.clientX + 14;
        let top  = e.clientY + 14;
        if (left + xpTooltipEl.offsetWidth + margin > window.innerWidth) {
          left = e.clientX - xpTooltipEl.offsetWidth - 14;
        }
        if (top + xpTooltipEl.offsetHeight + margin > window.innerHeight) {
          top = e.clientY - xpTooltipEl.offsetHeight - 14;
        }
        xpTooltipEl.style.left = left + 'px';
        xpTooltipEl.style.top  = top  + 'px';
      });
      xpTrack.addEventListener('mouseleave', () => { xpTooltipEl.style.display = 'none'; });
    }

    /* detail stats */
    document.getElementById('guildCardMembers').innerHTML = '<strong>' + fmt(totalMembers) + '</strong> Members';
    document.getElementById('guildCardWars').innerHTML = '<strong>' + fmt(data.wars) + '</strong> Wars';
    document.getElementById('guildCardFounded').innerHTML = 'Founded <strong>' + fmtDate(data.created) + '</strong>';

    /* owner */
    const ownerEl = document.getElementById('guildCardOwner');
    let ownerName = null;
    const ownerGroup = (data.members || {}).owner;
    if (ownerGroup && typeof ownerGroup === 'object') {
      ownerName = Object.keys(ownerGroup)[0] || null;
    }
    ownerEl.innerHTML = ownerName
      ? '♛ Owner: <strong>' + ownerName + '</strong>'
      : '';
  }

  function renderGuildRaids(raidsAgg) {
    const card = document.getElementById('guildRaidsCard');
    if (!raidsAgg.total) { card.style.display = 'none'; return; }
    card.style.display = 'block';
    document.getElementById('guildRaidsTotal').textContent = 'Total: ' + fmt(raidsAgg.total);
    let html = '<div class="raid-list">';
    for (const [name, count] of Object.entries(raidsAgg.list)) {
      html += `<div class="raid-list-row"><span class="raid-list-name">${name}</span><span class="raid-list-count">${fmt(count)}</span></div>`;
    }
    document.getElementById('guildRaidsList').innerHTML = html + '</div>';
  }

  function renderGuildMembers(flatMembers) {
    document.getElementById('guildMembersTotal').textContent = flatMembers.length + ' members';
    let html = '';
    flatMembers.forEach((m, i) => {
      const rankClass = i === 0 ? 'top1' : i === 1 ? 'top2' : i === 2 ? 'top3' : '';
      html += `
        <div class="guild-member-row">
          <span class="guild-member-rank-num ${rankClass}">#${m.contributionRank || (i + 1)}</span>
          <span class="guild-member-name guild-log-name-link" data-username="${m.name}">${m.name}</span>
          <span class="guild-rank-badge guild-rank-${m.role}">${capFirst(m.role)}</span>
          <span class="guild-member-contrib">${fmt(m.contributed)} XP</span>
          <span class="guild-member-raids">⚜ ${fmt(m.guildRaids ? m.guildRaids.total : 0)}</span>
        </div>`;
    });
    document.getElementById('guildMembersList').innerHTML = html;
    document.getElementById('guildMembersList').querySelectorAll('.guild-log-name-link').forEach(function(el) {
      el.addEventListener('click', function() { window.goToPlayer(el.dataset.username); });
    });
  }

  function renderGuildMetricRows() {
    guildGraph.rowsWrap.innerHTML = '';
    const available = isGuildComparing() ? GUILD_COMPARE_METRICS : GUILD_GRAPH_METRICS;

    // snap metrics to whatever's available right now
    guildGraph.metrics = guildGraph.metrics.filter(k => available.some(m => m.key === k));
    if (!guildGraph.metrics.length) guildGraph.metrics = [available[0].key];

    guildGraph.metrics.forEach((key, i) => guildGraph.rowsWrap.appendChild(buildGuildMetricRow(key, i, available)));
    guildGraph.addBtn.style.display = isGuildComparing() || guildGraph.metrics.length >= Math.min(MAX_METRICS, available.length) ? 'none' : '';
  }

  /* guild logs */
  async function loadAndRenderGuildLogs() {
    try {
      var result = await DataCache.cachedFetch('/api/guild/member-history');
      renderGuildLogs(result.data);
      return true;
    } catch (err) {
      document.getElementById('guildLogsList').innerHTML =
        '<div style="color:var(--text-dim);padding:1rem">Could not load logs: ' + err.message + '</div>';
      return false;
    }
  }

  function renderGuildLogs(events) {
    const ICONS = { member_joined: '✚', member_left: '➜]', rank_change_promote: '▲', rank_change_demote: '▼', level_change: '📊' };
    const rankBadge = (r) => r ? `<span class="guild-rank-badge guild-rank-${r}">${capFirst(r)}</span>` : '';

    function fmtTimestamp(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      const now = new Date();
      const diffMs = now - d;
      const diffH = Math.floor(diffMs / 3600000);
      if (diffH < 24) return diffH + 'h ago';
      return Math.floor(diffH / 24) + 'd ago';
    }

    // filter noise, newest first
    const filtered = events
      .filter(e => e.type !== 'member_count_change')
      .slice()
      .reverse();

    let html = '';
    for (const e of filtered) {
      const icon = e.type === 'rank_change'
        ? (isHigherRank(e.new_rank, e.old_rank) ? ICONS.rank_change_promote : ICONS.rank_change_demote)
        : (ICONS[e.type] || '•');
      const time = fmtTimestamp(e.timestamp);
      let desc = '';

      if (e.type === 'member_joined') {
        desc = `<span class="guild-log-name guild-log-name-link" data-username="${e.username}">${e.username}</span> joined the guild as ${rankBadge(e.rank || 'recruit')}`;
      } else if (e.type === 'member_left') {
        desc = `<span class="guild-log-name guild-log-name-link" data-username="${e.username}">${e.username}</span> ${rankBadge(e.rank)} left the guild`;
      } else if (e.type === 'rank_change') {
        const isPromotion = isHigherRank(e.new_rank, e.old_rank);
        desc = `<span class="guild-log-name guild-log-name-link" data-username="${e.username}">${e.username}</span> was ${isPromotion ? 'promoted' : 'demoted'} ${rankBadge(e.old_rank)} → ${rankBadge(e.new_rank)}`;
      } else if (e.type === 'level_change') {
        desc = `<span style="color:var(--gold-light);font-weight:700">${e.guild_name || 'Empire of Sindria'}</span> has reached <span style="color:var(--gold-light);font-weight:700">Level ${e.new}</span>`;
      }

      if (!desc) continue;
      html += `
        <div class="guild-log-entry log-${e.type === 'rank_change' ? (isHigherRank(e.new_rank, e.old_rank) ? 'promote' : 'demote') : e.type === 'member_joined' ? 'join' : e.type === 'member_left' ? 'leave' : e.type.replace('member_', '')}">
          <div class="guild-log-icon">${icon}</div>
          <div class="guild-log-body">
            <div class="guild-log-desc">${desc}</div>
            <div class="guild-log-time">${time}</div>
          </div>
        </div>`;
    }
    document.getElementById('guildLogsList').innerHTML = html || '<div style="color:var(--text-dim);padding:1rem">No log entries found.</div>';
    document.getElementById('guildLogsList').querySelectorAll('.guild-log-name-link').forEach(function (el) {
      el.style.cursor = 'pointer';
      el.addEventListener('click', function () { window.goToPlayer(this.dataset.username); });
    });
  }

  // returns true if newRank is higher than oldRank
  function isHigherRank(newRank, oldRank) {
    const RANKS = ['recruit', 'recruiter', 'captain', 'strategist', 'chief', 'owner'];
    return RANKS.indexOf(newRank) > RANKS.indexOf(oldRank);
  }

  /* view toggle */
  document.getElementById('guildViewGlobal').addEventListener('click', () => switchGuildView('global'));
  document.getElementById('guildViewLogs').addEventListener('click',  () => switchGuildView('logs'));

  function switchGuildView(v) {
    document.getElementById('guildViewGlobal').classList.toggle('active', v === 'global');
    document.getElementById('guildViewLogs').classList.toggle('active',   v === 'logs');
    document.getElementById('guildGlobalView').style.display = v === 'global' ? 'block' : 'none';
    document.getElementById('guildLogsView').style.display   = v === 'logs'   ? 'block' : 'none';
  }

  /* activity graph */
  function buildGuildMetricRow(metricKey, index, available) {
    available = available || (isGuildComparing() ? GUILD_COMPARE_METRICS : GUILD_GRAPH_METRICS);
    const row = document.createElement('div');
    row.className     = 'graph-metric-row';
    row.dataset.index = index;

    const dot = document.createElement('span');
    dot.className        = 'metric-color-dot';
    dot.style.background = GUILD_SERIES_COLORS[index].line;
    row.appendChild(dot);

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
      const prev = guildGraph.metrics[index];
      const conflictIndex = guildGraph.metrics.indexOf(this.value);
      if (conflictIndex !== -1 && conflictIndex !== index) {
        guildGraph.metrics[conflictIndex] = prev;
      }
      guildGraph.metrics[index] = this.value;
      renderGuildMetricRows();
      refreshGuildGraph();
    });
    row.appendChild(sel);

    if (guildGraph.metrics.length > 1) {
      const btn       = document.createElement('button');
      btn.className   = 'btn-remove-metric';
      btn.textContent = '\u00d7';
      btn.title       = 'Remove metric';
      btn.addEventListener('click', () => removeGuildMetric(index));
      row.appendChild(btn);
    }
    return row;
  }

  function renderGuildMetricRows() {
    guildGraph.rowsWrap.innerHTML = '';
    const available = isGuildComparing() ? GUILD_COMPARE_METRICS : GUILD_GRAPH_METRICS;

    guildGraph.metrics = guildGraph.metrics.filter(k => available.some(m => m.key === k));
    if (!guildGraph.metrics.length) guildGraph.metrics = [available[0].key];
    if (isGuildComparing()) guildGraph.metrics = [guildGraph.metrics[0]];

    guildGraph.metrics.forEach((key, i) => guildGraph.rowsWrap.appendChild(buildGuildMetricRow(key, i, available)));
    guildGraph.addBtn.style.display = isGuildComparing() || guildGraph.metrics.length >= Math.min(MAX_METRICS, available.length) ? 'none' : '';
  }

  function addGuildMetric() {
    if (isGuildComparing()) return;
    const available = GUILD_GRAPH_METRICS;
    if (guildGraph.metrics.length >= Math.min(MAX_METRICS, available.length)) return;
    const used = new Set(guildGraph.metrics);
    const next = available.find(m => !used.has(m.key)) || available[0];
    guildGraph.metrics.push(next.key);
    renderGuildMetricRows();
    refreshGuildGraph();
  }

  function removeGuildMetric(index) {
    if (guildGraph.metrics.length <= 1) return;
    guildGraph.metrics.splice(index, 1);
    renderGuildMetricRows();
    refreshGuildGraph();
  }

  /* apply saved range default to slider */
  guildGraph.range.value = _guildDefaultRange;
  guildGraph.daysLbl.textContent = _guildDefaultRange + 'd';

  guildGraph.addBtn.addEventListener('click', addGuildMetric);
  guildGraph.range.addEventListener('input', function () {
    guildGraph.days = parseInt(this.value);
    guildGraph.daysLbl.textContent = guildGraph.days + 'd';
    refreshGuildGraph();
  });

  /* guild graph compare */
  function isGuildComparing() {
    return !!(guildGraphState.compareData && guildGraphState.compareUsername);
  }

  function setGuildCompareStatus(msg, isError) {
    if (isError) {
      if (msg && typeof window.showToast === 'function') window.showToast('⚠ ' + msg, 'warn');
      guildGraph.compareStatus.textContent = '';
      guildGraph.compareStatus.className = 'compare-status';
      return;
    }
    guildGraph.compareStatus.textContent = msg;
    guildGraph.compareStatus.className = 'compare-status' + (msg ? ' loading' : '');
  }

  function setGuildCompareEnabled(enabled, loadingText) {
    const hint = loadingText || 'Loading activity data…';
    guildGraph.compareTrigger.style.pointerEvents = enabled ? '' : 'none';
    guildGraph.compareTrigger.style.opacity = enabled ? '' : '0.45';
    guildGraph.compareTrigger.style.cursor = enabled ? '' : 'not-allowed';
    guildGraph.compareTrigger.title = enabled ? '' : hint;
    guildGraph.compareInput.disabled = !enabled;
    if (!enabled && !isGuildComparing()) {
      guildGraph.compareInputArea.style.display = 'none';
      guildGraph.compareTrigger.style.display = '';
      setGuildCompareStatus(hint, false);
    } else if (enabled && !guildGraphState.compareLoading && !isGuildComparing()) {
      setGuildCompareStatus('', false);
    }
  }
  setGuildCompareEnabled(false, 'Loading activity data…');

  function cancelGuildCompareInput() {
    guildGraph.compareInputArea.style.display = 'none';
    guildGraph.compareTrigger.style.display   = '';
    setGuildCompareStatus('', false);
  }

  function clearGuildComparePlayer() {
    guildGraphState.compareData     = null;
    guildGraphState.compareUsername = null;
    guildGraph.comparePill.style.display      = 'none';
    guildGraph.compareInputArea.style.display = 'none';
    guildGraph.compareTrigger.style.display   = '';
    setGuildCompareStatus('', false);
    renderGuildMetricRows();
    refreshGuildGraph();
  }

  async function fetchGuildCompareData(username) {
    const key = username.toLowerCase();
    if (guildGraphState.compareCache[key]) {
      maybeLogGuildCompareDebug(username);
      return guildGraphState.compareCache[key];
    }
    const memberCache = window.playtimeCache && window.playtimeCache[key];
    const hasCachedMetrics = !!(memberCache && GUILD_COMPARE_METRICS.some(m => Array.isArray(memberCache[m.key]) && memberCache[m.key].length));
    let data = {};
    if (hasCachedMetrics) {
      GUILD_COMPARE_METRICS.forEach(m => {
        data[m.key] = pad60(memberCache[m.key] || []);
      });
    } else {
      try {
        const query = METRICS_DEBUG_ENABLED ? '?debug=1' : '';
        const res = await apiFetch(`/api/player/${encodeURIComponent(username)}/metrics-history${query}`);
        cacheGuildCompareMetricsPayload(username, res);
        cacheGuildCompareMetricsDebug(username, res);
        const memberData = (window.playtimeCache && window.playtimeCache[key]) || {};
        GUILD_COMPARE_METRICS.forEach(m => {
          data[m.key] = pad60(memberData[m.key] || []);
        });
      } catch (_) {
        GUILD_COMPARE_METRICS.forEach(m => { data[m.key] = Array(60).fill(0); });
      }
    }
    guildGraphState.compareCache[key] = data;
    maybeLogGuildCompareDebug(username);
    return data;
  }

  async function loadGuildComparePlayer(username) {
    if (!guildGraphState.graphReady || !guildGraphState.data) {
      setGuildCompareStatus('Wait for activity data to finish loading.', true);
      return;
    }
    const guildMemberName = resolveGuildMemberName(username);
    if (!guildMemberName) {
      setGuildCompareStatus('Only current guild members can be compared here.', true);
      return;
    }
    guildGraphState.compareLoading = true;
    setGuildCompareStatus('Loading…', false);
    try {
      guildGraphState.compareData     = await fetchGuildCompareData(guildMemberName);
      guildGraphState.compareUsername = guildMemberName;

      guildGraph.compareInputArea.style.display = 'none';
      guildGraph.compareTrigger.style.display   = 'none';
      guildGraph.comparePill.style.display      = '';
      guildGraph.comparePillName.textContent    = guildMemberName;
      setGuildCompareStatus('', false);

      // switch to a compare-compatible metric
      const currentMetric = guildGraph.metrics[0];
      const nextMetric = GUILD_COMPARE_METRICS.some(m => m.key === currentMetric)
        ? currentMetric
        : GUILD_COMPARE_METRICS[0].key;
      guildGraph.metrics = [nextMetric];
      renderGuildMetricRows();
      refreshGuildGraph();
      maybeLogGuildCompareDebug(guildMemberName);
    } catch (err) {
      setGuildCompareStatus('Could not load player data.', true);
    } finally {
      guildGraphState.compareLoading = false;
    }
  }

  guildGraph.compareTrigger.addEventListener('click', function () {
    if (!guildGraphState.graphReady || !guildGraphState.data) {
      setGuildCompareStatus('Wait for activity data to finish loading.', true);
      return;
    }
    guildGraph.compareTrigger.style.display   = 'none';
    guildGraph.compareInputArea.style.display = '';
    guildGraph.compareInput.value = '';
    setGuildCompareStatus('', false);
    guildGraph.compareInput.focus();
  });

  guildGraph.compareInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      if (!guildGraphState.graphReady || !guildGraphState.data) {
        setGuildCompareStatus('Wait for activity data to finish loading.', true);
        return;
      }
      const name = this.value.trim();
      if (!name) return;
      loadGuildComparePlayer(name);
    }
    if (e.key === 'Escape') cancelGuildCompareInput();
  });

  guildGraph.compareInput.addEventListener('blur', function () {
    setTimeout(function () {
      if (!guildGraphState.compareUsername && !guildGraphState.compareLoading && guildGraph.compareInputArea.style.display !== 'none') {
        cancelGuildCompareInput();
      }
    }, 200);
  });

  guildGraph.compareClearBtn.addEventListener('click', clearGuildComparePlayer);

  function pad60(arr) {
    return Array(Math.max(0, 60 - arr.length)).fill(0).concat(arr);
  }

  function setGuildGraphLoading(loading) {
    const canvas = guildGraph.canvas;
    const wrap   = canvas ? canvas.parentElement : null;
    if (!wrap) return;
    let loader = wrap.querySelector('.graph-loader');
    if (loading) {
      canvas.style.opacity = '0.3';
      if (!loader) {
        loader = document.createElement('div');
        loader.className = 'graph-loader';
        loader.textContent = 'Loading\u2026';
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

  async function initGuildGraph() {
    const canvas   = guildGraph.canvas;
    const wrap     = canvas ? canvas.parentElement : null;
    guildGraphState.graphReady = false;
    guildGraphState.data = null;
    setGuildCompareEnabled(false, 'Loading activity data\u2026');
    setGuildGraphLoading(true);

    function setGraphMessage(msg) {}
    function clearGraphMessage() {}

    // Hide add button and metric rows until data is ready
    guildGraph.addBtn.style.display = 'none';
    guildGraph.rowsWrap.innerHTML   = '';

    // Poll guild metrics-history until ready
    const MAX_ATTEMPTS = 40; // 40 × 3s = 2 min max
    let gs = null;
    const query = METRICS_DEBUG_ENABLED ? '?debug=1' : '';
    const path = `/api/guild/prefix/${encodeURIComponent(GUILD_PREFIX)}/metrics-history${query}`;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      try {
        const resp = await apiFetch(path);
        cacheGuildMetricsDebug(resp);
        const metricDates = Array.isArray(resp.metricDates) ? resp.metricDates : (Array.isArray(resp.dates) ? resp.dates : []);
        const metrics = (resp && resp.metrics) ? resp.metrics : {};
        const hasHistory = metricDates.length > 0 || GUILD_GRAPH_METRICS.some(m => Array.isArray(metrics[m.key]) && metrics[m.key].length);
        if (hasHistory) {
          gs = { metricDates: metricDates };
          GUILD_GRAPH_METRICS.forEach(m => {
            gs[m.key] = Array.isArray(metrics[m.key]) ? metrics[m.key] : [];
          });
          window.guildStatsCache = gs;
          break;
        }
      } catch (e) {
        // keep polling
      }
      // Wait 3s but tick the message every second
      for (let s = 1; s <= 3; s++) {
        await new Promise(r => setTimeout(r, 1000));
        setGraphMessage(`Loading activity data… (${i * 3 + s}s)`);
      }
    }

    if (!gs) {
      setGuildGraphLoading(false);
      setGuildCompareEnabled(false, 'Activity data unavailable.');
      return false;
    }

    setGuildGraphLoading(false);

    const data = {};
    GUILD_GRAPH_METRICS.forEach(m => {
      data[m.key] = gs[m.key] ? pad60(gs[m.key]) : Array(60).fill(0);
    });
    guildGraphState.data     = data;
    guildGraph.selectedDayOffset = null;
    guildGraph.days          = parseInt(guildGraph.range.value);
    guildGraph.daysLbl.textContent = guildGraph.days + 'd';
    renderGuildMetricRows();
    refreshGuildGraph();
    guildGraphState.graphReady = true;
    setGuildCompareEnabled(true);
    maybeLogGuildDebug();
    return true;
  }

  function refreshGuildGraph() {
    if (!guildGraphState.data) return;
    const hasCompare = isGuildComparing();
    const rawSeries  = [];

    guildGraph.metrics.forEach((key, i) => {
      rawSeries.push({
        key,
        data:   guildGraphState.data[key] ? guildGraphState.data[key].slice(60 - guildGraph.days) : [],
        color:  GUILD_SERIES_COLORS[i],
        player: 'Guild',
        dashed: false,
      });
      if (hasCompare) {
        rawSeries.push({
          key,
          data:   guildGraphState.compareData[key] ? guildGraphState.compareData[key].slice(60 - guildGraph.days) : [],
          color:  GUILD_SERIES_COLORS[i],
          player: guildGraphState.compareUsername,
          dashed: true,
        });
      }
    });
    const maxLen = Math.max(0, ...rawSeries.map(s => (s.data && s.data.length) || 0));
    const selectedEndIndex = resolveGuildGraphSelectedIndex(guildGraph.selectedDayOffset, maxLen);

    drawGuildGraph(guildGraph.canvas, rawSeries);
    updateGuildLegend(rawSeries);
    updateGuildSummaries(rawSeries, selectedEndIndex);
  }

  function fmtYLabel(n) {
    if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (Math.abs(n) >= 1000) return Math.round(n / 1000) + 'K';
    return String(Math.round(n * 10) / 10).replace('.', ',');
  }

  function drawGuildGraph(canvas, seriesList) {
    guildGraph.hoverModel = GraphShared.drawGraphCanvas(canvas, seriesList, {
      height: 220,
      selectedDayOffset: guildGraph.selectedDayOffset,
      formatYAxisLabel: fmtYLabel,
    });
  }

  function updateGuildLegend(seriesList) {
    guildGraph.legendWrap.innerHTML = '';
    if (isGuildComparing()) {
      const compareLegend = document.createElement('span');
      compareLegend.className = 'graph-legend-player-pair';
      compareLegend.innerHTML = `
        <span class="graph-legend-item"><span class="legend-line legend-line-player-solid"></span><span class="legend-player-tag">Guild</span></span>
        <span class="graph-legend-item"><span class="legend-line dashed legend-line-player-dashed"></span><span class="legend-player-tag compare">${guildGraphState.compareUsername}</span></span>`;
      guildGraph.legendWrap.appendChild(compareLegend);
      return;
    }
    const seenKeys = new Set();
    seriesList.forEach(s => {
      if (seenKeys.has(s.key)) return;
      seenKeys.add(s.key);
      const m    = GUILD_GRAPH_METRICS.find(x => x.key === s.key) || GUILD_COMPARE_METRICS.find(x => x.key === s.key);
      const item = document.createElement('span');
      item.className = 'graph-legend-item';
      item.innerHTML = `<span class="legend-line" style="background:${s.color.line}"></span> ${m ? m.label : s.key}`;
      guildGraph.legendWrap.appendChild(item);
    });
  }

  function updateGuildSummaries(seriesList, selectedEndIndex) {
    guildGraph.summaryWrap.innerHTML = '';
    const hasCompare = isGuildComparing();

    function appendSection(s, showLabel) {
      const data = s.data;
      if (!data || !data.length) return;
      const m   = GUILD_GRAPH_METRICS.find(x => x.key === s.key) || GUILD_COMPARE_METRICS.find(x => x.key === s.key);
      const dec = m ? m.decimals : 0;
      const f   = v => dec === 0 ? Math.round(v).toLocaleString() : v.toFixed(dec).replace('.', ',');
      const stats = GraphShared.computeSummaryStats(data, selectedEndIndex);
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
          <div class="graph-stat-item"><span class="graph-stat-val positive">+${f(sum)}</span><span class="graph-stat-lbl">Total Δ</span></div>
        </div>`;
      guildGraph.summaryWrap.appendChild(section);
    }

    if (!hasCompare) {
      seriesList.forEach(s => appendSection(s, true));
    } else {
      [{ label: 'Guild', dashed: false }, { label: guildGraphState.compareUsername, dashed: true }].forEach(p => {
        const header = document.createElement('div');
        header.className = 'graph-summary-player-header';
        const lineClass = p.dashed ? 'player-line-sample dashed' : 'player-line-sample player-line-sample-solid';
        header.innerHTML = `<span class="${lineClass}"></span>${p.label}`;
        guildGraph.summaryWrap.appendChild(header);
        seriesList.filter(s => !!s.dashed === p.dashed).forEach(s => appendSection(s, false));
      });
    }
  }

  window.addEventListener('resize', () => { if (guildGraphState.data) refreshGuildGraph(); });

  // init share buttons for all graph panels
  if (window.GraphShared && window.GraphShared.initShareButtons) {
    window.GraphShared.initShareButtons();
  }

})();
