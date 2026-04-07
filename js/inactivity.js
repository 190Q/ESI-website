(function () {
  'use strict';

  var MONTHS       = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var _allUsers    = {};
  var _exemptions  = [];
  var _editingId   = null;
  var _settingsCheckerType  = (window.esiSettings && window.esiSettings.get('checkerType'))  || 'first';
  var _settingsCheckerHours = (window.esiSettings && window.esiSettings.get('checkerHours'));
  var _settingsCheckerTab   = (window.esiSettings && window.esiSettings.get('checkerTab'))   || 'inactive';
  var _checkerType  = _settingsCheckerType;
  var _checkerWeek  = null;
  var _checkerHours = _settingsCheckerHours != null ? _settingsCheckerHours : 2;
  var _checkerTab   = _settingsCheckerTab;
  var _players      = []; // all guild members from player_stats
  var _metricsFetchPromises = {};
  var _inacActiveToast = null;
  var _inacLoading = false;
  var _inacFetched = false;

  function cacheMetricsHistory(username, payload) {
    if (!username || !payload) return;
    var uLow = username.toLowerCase();
    var metrics = payload.metrics || {};
    window.playtimeCache = window.playtimeCache || {};
    window.playtimeCache[uLow] = {
      username: payload.username || username,
      dates: Array.isArray(payload.playtimeDates) ? payload.playtimeDates : (Array.isArray(payload.dates) ? payload.dates : []),
      metricDates: Array.isArray(payload.metricDates) ? payload.metricDates : (Array.isArray(payload.dates) ? payload.dates : []),
      data: Array.isArray(metrics.playtime) ? metrics.playtime : [],
      wars: Array.isArray(metrics.wars) ? metrics.wars : [],
      guildRaids: Array.isArray(metrics.guildRaids) ? metrics.guildRaids : [],
    };
  }

  function fetchMetricsHistory(username) {
    var name = (username || '').trim();
    if (!name) return Promise.resolve();
    var uLow = name.toLowerCase();
    if (_metricsFetchPromises[uLow]) return _metricsFetchPromises[uLow];
    _metricsFetchPromises[uLow] = fetch('/api/player/' + encodeURIComponent(name) + '/metrics-history', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (payload) { if (payload) cacheMetricsHistory(name, payload); })
      .catch(function () {})
      .finally(function () { delete _metricsFetchPromises[uLow]; });
    return _metricsFetchPromises[uLow];
  }

  function ensureMetricsCached(usernames) {
    var seen = {};
    var tasks = [];
    (usernames || []).forEach(function (name) {
      var n = (name || '').trim();
      if (!n) return;
      var uLow = n.toLowerCase();
      if (seen[uLow]) return;
      seen[uLow] = true;
      var cached = window.playtimeCache && window.playtimeCache[uLow];
      var hasPlaytime = !!(cached && Array.isArray(cached.data) && cached.data.length);
      if (!hasPlaytime) tasks.push(fetchMetricsHistory(n));
    });
    return Promise.all(tasks).then(function () {});
  }

  var panel = document.getElementById('panel-inactivity');

  var observer = new MutationObserver(function () {
    if (panel.classList.contains('active')) loadInactivity();
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['class'] });

  if (panel.classList.contains('active')) loadInactivity();

  window.inactivityOnLogin = function () {
    _inacLoading = false; // force reload after login
    if (panel.classList.contains('active')) loadInactivity();
  };

  /* --- data fetch --- */

  function loadInactivity() {
    if (_inacLoading) return;
    _inacLoading = true;
    var hasExistingData = !!document.getElementById('inacList');

    // on fresh load, show cached data immediately so the page isn't blank
    if (!hasExistingData) {
      var preCachedMain = DataCache.readCache('/api/inactivity');
      var preCachedAll  = DataCache.readCache('/api/inactivity?all=1');
      if (preCachedMain !== null) {
        _allUsers = {};
        (preCachedAll || []).forEach(function (u) {
          if (u && u.username) _allUsers[u.username.toLowerCase()] = u;
        });
        buildShell();
        updateDatalist();
        renderList(preCachedMain);
        hasExistingData = true;
      }
    }

    if (_inacActiveToast) { _inacActiveToast.dismiss(); _inacActiveToast = null; }
    var _inacToast = null;
    if (hasExistingData && !_inacFetched && typeof window.showProgressToast === 'function') {
      _inacToast = window.showProgressToast('Fetching inactivity data\u2026');
      _inacActiveToast = _inacToast;
      _inacToast.addItem('api', 'Inactivity API');
    }
    var _inacMsgs = { success: '\u2713 Inactivity data loaded', fail: '\u2715 Failed to load inactivity data' };

    Promise.all([
      fetch('/api/inactivity',       { credentials: 'same-origin' }),
      fetch('/api/inactivity?all=1', { credentials: 'same-origin' }),
    ])
    .then(function (rs) {
      if (!rs[0].ok) { if (!hasExistingData) renderGate(rs[0].status); if (_inacToast) { _inacToast.updateItem('api', 'error'); _inacToast.finish(_inacMsgs); } return null; }
      if (!rs[0].ok || !rs[1].ok) throw new Error('Server error');
      return Promise.all([rs[0].json(), rs[1].json()]).then(function (data) {
        DataCache.writeCache('/api/inactivity', data[0]);
        DataCache.writeCache('/api/inactivity?all=1', data[1]);
        return data;
      });
    })
    .then(function (data) {
      if (!data) return;
      _allUsers = {};
      (data[1] || []).forEach(function (u) {
        if (u && u.username) _allUsers[u.username.toLowerCase()] = u;
      });
      if (!document.getElementById('inacList')) buildShell();
      updateDatalist();
      renderList(data[0]);
      if (_inacToast) { _inacToast.updateItem('api', 'success'); _inacToast.finish(_inacMsgs); }
      _inacFetched = true;
    })
    .catch(function () {
      if (_inacToast) { _inacToast.updateItem('api', 'error'); _inacToast.finish(_inacMsgs); }
      var cachedMain = DataCache.readCache('/api/inactivity');
      var cachedAll  = DataCache.readCache('/api/inactivity?all=1');
      if (cachedMain !== null) {
        _allUsers = {};
        (cachedAll || []).forEach(function (u) {
          if (u && u.username) _allUsers[u.username.toLowerCase()] = u;
        });
        if (!document.getElementById('inacList')) buildShell();
        updateDatalist();
        renderList(cachedMain);
      } else if (!hasExistingData) {
        renderGate(0);
      }
    })
    .finally(function () { _inacLoading = false; });
  }

  /* --- login gate --- */

  function renderGate(status) {
    var loggedIn = window.state && window.state.loggedIn;
    var msg = !loggedIn
      ? 'You must be logged in to access this page.'
      : (status === 403
          ? 'You do not have permission to view this page.'
          : 'Failed to load data. Please try again.');
    panel.innerHTML =
      '<div class="panel-header">' +
        '<h1 class="panel-title">&#x23F1; Inactivity</h1>' +
        '<p class="panel-subtitle">Manage member inactivity records</p>' +
      '</div>' +
      '<div class="inac-empty">' + msg + '</div>';
  }

  /* --- shell --- */

  function buildShell() {
    var weekOptions = buildWeekOptions();
    var weeksHtml = weekOptions.map(function (w) {
      var isPerm = w.label === 'Permanent';
      return '<label class="inac-week-opt' + (isPerm ? ' inac-week-perm' : '') + '">' +
        '<input type="checkbox" class="inac-week-cb" value="' + w.value + '"' +
        ' aria-label="' + w.label + '"' +
        (isPerm ? ' id="inacPermCb"' : '') + ' />' +
        '<span>' + w.label + '</span>' +
      '</label>';
    }).join('');

    panel.innerHTML =
      '<div class="panel-header">' +
        '<h1 class="panel-title">&#x23F1; Inactivity</h1>' +
        '<p class="panel-subtitle">Manage member inactivity records</p>' +
      '</div>' +
      '<div class="inac-split-layout">' +
        '<div class="inac-left-col">' +
          '<div class="info-card">' +
            '<div class="info-card-header">Inactivity Checker</div>' +
            '<div class="inac-checker-body">' +
              '<div class="inac-checker-toggle">' +
                '<button class="inac-checker-btn active" id="inacBtnFirst">First Check</button>' +
                '<button class="inac-checker-btn" id="inacBtnSecond">Second Check</button>' +
              '</div>' +
              '<div id="inacCheckerWeeks"></div>' +
              '<div id="inacCheckerResults"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="inac-right-col">' +
          '<div class="info-card">' +
            '<div class="info-card-header">Add Inactivity Exemption</div>' +
            '<div class="inac-form">' +
              '<div class="inac-field">' +
                '<label class="inac-label" for="inacUsername">Minecraft Username</label>' +
                '<input type="text" class="inac-input" id="inacUsername" placeholder="e.g. 190Q" list="inacUserList" autocomplete="off" aria-label="Minecraft username" />' +
                '<datalist id="inacUserList"></datalist>' +
              '</div>' +
              '<div class="inac-field">' +
                '<label class="inac-label" for="inacReason">Reason</label>' +
                '<input type="text" class="inac-input" id="inacReason" placeholder="e.g. Exams" aria-label="Inactivity reason" />' +
              '</div>' +
              '<div class="inac-field">' +
                '<label class="inac-label">Duration</label>' +
                '<div class="inac-weeks" id="inacWeeks">' + weeksHtml + '</div>' +
              '</div>' +
              '<div id="inacBtnRow" style="display:flex;gap:8px;margin-top:2px">' +
                '<button class="inac-btn inac-btn-approve" id="inacSubmit" style="flex:1;justify-content:center">+ Add Exemption</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="info-card" style="margin-top:16px">' +
            '<div class="collapsible-header" onclick="toggleCollapse(this)">' +
              'Exemptions <span id="inacCount" style="color:var(--text-faint);font-size:0.85em;font-family:\'Crimson Pro\',serif"></span>' +
              '<span class="collapsible-arrow">&#x25BC;</span>' +
            '</div>' +
            '<div class="collapsible-body"><div id="inacList"></div></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById('inacSubmit').addEventListener('click', submitExemption);
    initChecker();

    /* edit helpers */
    window._inacStartEdit = function (discordId) {
      var entry = null;
      for (var i = 0; i < _exemptions.length; i++) {
        if (_exemptions[i].discord_id === discordId) { entry = _exemptions[i]; break; }
      }
      if (!entry) return;
      _editingId = discordId;
      document.getElementById('inacUsername').value = entry.username;
      var reasonEl = document.getElementById('inacReason');
      if (reasonEl) reasonEl.value = entry.reason || '';
      selectWeeks(entry.weeks || []);
      var submitBtn = document.getElementById('inacSubmit');
      submitBtn.textContent = '\u270e Save Changes';
      submitBtn.className   = 'inac-btn inac-btn-primary';
      if (!document.getElementById('inacCancel')) {
        var cancelBtn = document.createElement('button');
        cancelBtn.id        = 'inacCancel';
        cancelBtn.className = 'inac-btn inac-btn-secondary';
        cancelBtn.textContent = '\u2715 Cancel';
        cancelBtn.addEventListener('click', window._inacCancelEdit);
        document.getElementById('inacBtnRow').appendChild(cancelBtn);
      }
      document.getElementById('inacUsername').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      document.getElementById('inacUsername').focus();
    };

    window._inacCancelEdit = function () {
      _editingId = null;
      document.getElementById('inacUsername').value = '';
      document.getElementById('inacReason').value   = '';
      selectWeeks([]);
      var submitBtn = document.getElementById('inacSubmit');
      submitBtn.textContent = '+ Add Exemption';
      submitBtn.className   = 'inac-btn inac-btn-approve';
      var cancelBtn = document.getElementById('inacCancel');
      if (cancelBtn) cancelBtn.remove();
    };

    /* autofill from existing data */
    function applyAutofill(val) {
      var uLow = val.trim().toLowerCase();
      var u = _allUsers[uLow];
      if (!u) {
        // not in the list, go back to add mode
        if (_editingId) window._inacCancelEdit();
        return;
      }
      var reasonEl = document.getElementById('inacReason');
      if (reasonEl) reasonEl.value = u.reason || '';
      selectWeeks(u.weeks || []);
      // if they already have an entry, switch to edit mode
      var existing = _exemptions.find(function (e) { return e.username.toLowerCase() === uLow; });
      if (existing && existing.discord_id) {
        _editingId = existing.discord_id;
        var submitBtn = document.getElementById('inacSubmit');
        if (submitBtn) {
          submitBtn.textContent = '\u270e Save Changes';
          submitBtn.className   = 'inac-btn inac-btn-primary';
        }
        if (!document.getElementById('inacCancel')) {
          var cancelBtn = document.createElement('button');
          cancelBtn.id        = 'inacCancel';
          cancelBtn.className = 'inac-btn inac-btn-secondary';
          cancelBtn.textContent = '\u2715 Cancel';
          cancelBtn.addEventListener('click', window._inacCancelEdit);
          document.getElementById('inacBtnRow').appendChild(cancelBtn);
        }
      } else if (_editingId) {
        // switched to someone else without an entry, go back to add
        window._inacCancelEdit();
        if (reasonEl) reasonEl.value = u.reason || '';
        selectWeeks(u.weeks || []);
      }
    }
    var unEl = document.getElementById('inacUsername');
    unEl.addEventListener('input',  function () { applyAutofill(this.value); });
    unEl.addEventListener('change', function () { applyAutofill(this.value); });

    /* week chip toggle */
    document.querySelectorAll('#inacWeeks .inac-week-cb').forEach(function (cb) {
      cb.addEventListener('change', function () {
        this.parentElement.classList.toggle('selected', this.checked);
        if (this.id === 'inacPermCb' && this.checked) {
          document.querySelectorAll('#inacWeeks .inac-week-cb:not(#inacPermCb)').forEach(function (o) {
            o.checked = false;
            o.parentElement.classList.remove('selected');
          });
        } else if (this.id !== 'inacPermCb' && this.checked) {
          var perm = document.getElementById('inacPermCb');
          if (perm) { perm.checked = false; perm.parentElement.classList.remove('selected'); }
        }
      });
    });
  }

  /* --- checker --- */

  function initChecker() {
    renderCheckerWeeks();
    Promise.all([
      DataCache.cachedFetch('/api/inactivity/players', { credentials: 'same-origin' })
        .then(function (r) { return r.data; }).catch(function () { return []; }),
      fetch('/api/guild/prefix/ESI').then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; }),
    ])
      .then(function (results) {
        var localPlayers = results[0];
        var guildData    = results[1];
        var wynnMap = {};
        var members = (guildData && guildData.members) ? guildData.members : {};
        Object.entries(members).forEach(function (rankEntry) {
          var rankGroup = rankEntry[1];
          if (!rankGroup || typeof rankGroup !== 'object') return;
          Object.entries(rankGroup).forEach(function (memberEntry) {
            wynnMap[memberEntry[0].toLowerCase()] = true;
          });
        });
        _players = localPlayers.filter(function (p) {
          return !!wynnMap[p.username.toLowerCase()];
        });
        if (_checkerWeek) updateCheckerList();
      })
      .catch(function () {});
    document.getElementById('inacBtnFirst').addEventListener('click', function () {
      _checkerType = 'first'; _checkerWeek = null;
      this.classList.add('active');
      document.getElementById('inacBtnSecond').classList.remove('active');
      renderCheckerWeeks();
    });
    document.getElementById('inacBtnSecond').addEventListener('click', function () {
      _checkerType = 'second'; _checkerWeek = null;
      this.classList.add('active');
      document.getElementById('inacBtnFirst').classList.remove('active');
      renderCheckerWeeks();
    });
  }

  function getCheckerWeeks(type) {
    var now      = new Date();
    var dow      = now.getDay();
    var sinceMon = dow === 0 ? 6 : dow - 1;
    var curMon   = new Date(now);
    curMon.setDate(now.getDate() - sinceMon);
    curMon.setHours(0, 0, 0, 0);
    var weeks = [], i = 0;
    while (weeks.length < 5 && i < 12) {
      var mon = new Date(curMon);
      mon.setDate(curMon.getDate() - i * 7);
      var end = new Date(mon);
      end.setDate(mon.getDate() + (type === 'first' ? 6 : 8)); // Sun or Tue
      end.setHours(23, 59, 59, 0);
      if (end < now) {
        weeks.push({ label: fmtWeek(mon, end), value: fmtDateKey(mon) + '_' + fmtDateKey(end) });
      }
      i++;
    }
    return weeks;
  }

  function renderCheckerWeeks() {
    var weeksEl   = document.getElementById('inacCheckerWeeks');
    var resultsEl = document.getElementById('inacCheckerResults');
    if (!weeksEl) return;
    var weeks = getCheckerWeeks(_checkerType);
    if (!weeks.length) {
      weeksEl.innerHTML = '<div class="inac-checker-hint">No completed weeks yet.</div>';
      if (resultsEl) resultsEl.innerHTML = '';
      return;
    }
    weeksEl.innerHTML = weeks.map(function (w) {
      return '<div class="inac-checker-week' + (w.value === _checkerWeek ? ' selected' : '') + '" data-value="' + w.value + '">' +
        w.label + '</div>';
    }).join('');
    weeksEl.querySelectorAll('.inac-checker-week').forEach(function (el) {
      el.addEventListener('click', function () {
        _checkerWeek = this.dataset.value;
        renderCheckerWeeks();
        renderCheckerResults();
      });
    });
    if (_checkerWeek) renderCheckerResults();
    else if (resultsEl) resultsEl.innerHTML = '<div class="inac-checker-hint">Select a week above.</div>';
  }

  function renderCheckerResults() {
    var resultsEl = document.getElementById('inacCheckerResults');
    if (!resultsEl || !_checkerWeek) return;
    // build the slider once, after that just refresh the list
    if (!document.getElementById('inacHoursSlider')) {
      resultsEl.innerHTML =
        '<div class="graph-control-row inac-hours-row">' +
          '<label class="graph-ctrl-label" for="inacHoursSlider">Min hours</label>' +
          '<input type="range" id="inacHoursSlider" class="graph-range" aria-label="Minimum inactivity hours"' +
            ' min="0" max="10" step="0.5" value="' + _checkerHours + '" />' +
          '<span id="inacHoursVal" class="graph-days-val">' + _checkerHours + 'h</span>' +
        '</div>' +
        '<div class="inac-checker-tabs" id="inacCheckerTabs">' +
          '<button class="inac-checker-tab' + (_checkerTab === 'inactive' ? ' active' : '') + '" data-tab="inactive">Inactive</button>' +
          '<button class="inac-checker-tab' + (_checkerTab === 'active'   ? ' active' : '') + '" data-tab="active">Active</button>' +
          '<button class="inac-checker-tab' + (_checkerTab === 'exempt'   ? ' active' : '') + '" data-tab="exempt">Exempt</button>' +
        '</div>' +
        '<div id="inacCheckerList"></div>' +
        '<div id="inacCopyWarningRow"></div>';
      document.getElementById('inacHoursSlider').addEventListener('input', function () {
        _checkerHours = parseFloat(this.value);
        document.getElementById('inacHoursVal').textContent = _checkerHours + 'h';
        updateCheckerList();
      });
      document.querySelectorAll('#inacCheckerTabs .inac-checker-tab').forEach(function (btn) {
        btn.addEventListener('click', function () {
          _checkerTab = this.dataset.tab;
          document.querySelectorAll('#inacCheckerTabs .inac-checker-tab').forEach(function (b) { b.classList.remove('active'); });
          this.classList.add('active');
          updateCheckerList();
        });
      });
    }
    updateCheckerList();
  }

  function computeWeekPlaytime(username, weekStr) {
    var cacheKey = username.toLowerCase();
    var history  = (window.playtimeCache && window.playtimeCache[cacheKey]) || { dates: [], data: [] };

    var parts     = weekStr.split('_');
    var weekStart = parseLocalDate(parts[0]);
    var weekEnd   = parseLocalDate(parts[1]);
    weekEnd = new Date(weekEnd.getTime() + 24 * 60 * 60 * 1000 - 1); // end of that UTC day

    var days = history.dates || [];
    var data = history.data  || [];
    if (!days.length || !data.length) return 0;

    // sum playtime hours for all days that fall within the week range
    var sum = 0;
    for (var i = 0; i < days.length; i++) {
      var d = parseLocalDate(days[i]);
      if (d >= weekStart && d <= weekEnd) sum += data[i];
    }
    return Math.max(0, Math.round(sum * 10) / 10);
  }

  function renderCheckerRows(listEl, rows, hoursMap, allPlayers, isPartial) {
    if (!rows.length) {
      if (!isPartial) {
        listEl.innerHTML = '<div class="inac-checker-hint">Nothing to show.</div>';
        var copyRowEmpty = document.getElementById('inacCopyWarningRow');
        if (copyRowEmpty) copyRowEmpty.innerHTML = '';
      }
      return;
    }

    listEl.innerHTML = rows.map(function (p) {
      var isPerm = p.permanent;
      var cls    = _checkerTab === 'active' ? 'active' : (_checkerTab === 'exempt' ? 'excused' : 'inactive');
      var extra  = '';
      if (p.exempt || isPerm) {
        extra = '<div class="inac-checker-ex-info">' +
          (isPerm ? '<span class="inac-badge perm">Permanent</span> ' : '<span class="inac-badge">Exempt</span> ') +
          '<span class="inac-reason">' + ((p.exempt && p.exempt.reason) || '') + '</span>' +
        '</div>';
      }
      var kickBtn = '';
      if (_checkerType === 'second' && _checkerTab === 'inactive') {
        kickBtn = '<button class="inac-kick-btn" data-username="' + p.username + '" title="Copy /gu kick ' + p.username + '">\uD83D\uDDD2</button>';
      }
      var hoursDisplay = (p.hours != null && !p.loading)
        ? p.hours.toFixed(1) + 'h'
        : '<span style="color:var(--text-faint);font-size:0.85em">…</span>';
      return '<div class="inac-checker-member ' + cls + '" data-username="' + p.username.toLowerCase() + '">' +
        '<div class="inac-checker-member-top">' +
          '<span class="inac-username inac-username-link" data-username="' + p.username + '">' + p.username + '</span>' +
          '<span class="inac-checker-right">' +
            kickBtn +
            '<span class="inac-checker-hours">' + hoursDisplay + '</span>' +
          '</span>' +
        '</div>' +
        extra +
      '</div>';
    }).join('');

    listEl.querySelectorAll('.inac-username-link').forEach(function (el) {
      el.addEventListener('click', function () {
        var opts = _checkerWeek ? { graphFocus: { week: _checkerWeek } } : null;
        window.goToPlayer(this.dataset.username, opts);
      });
    });
    listEl.querySelectorAll('.inac-kick-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        copyToClipboard('/gu kick ' + this.dataset.username);
        window.showToast('Copied /gu kick ' + this.dataset.username, 'success');
      });
    });

    var copyRow = document.getElementById('inacCopyWarningRow');
    if (copyRow) {
      if (!isPartial && _checkerType === 'first' && _checkerTab === 'inactive' && rows.length > 0) {
        copyRow.innerHTML = '<button class="inac-btn inac-btn-primary" id="inacCopyWarning" style="margin-top:10px;width:100%">' +
          '\uD83D\uDCCB Copy Warning Message</button>';
        document.getElementById('inacCopyWarning').addEventListener('click', function () {
          copyWarningMessage(rows);
        });
      } else if (!isPartial) {
        copyRow.innerHTML = '';
      }
    }
  }

  function updateCheckerList() {
    var listEl = document.getElementById('inacCheckerList');
    if (!listEl || !_checkerWeek) return;

    listEl.innerHTML = '<div class="inac-checker-hint">Loading playtime\u2026</div>';

    var usernames = _players.map(function (p) { return p.username; })
      .concat(_exemptions.map(function (e) { return e.username; }));

    (window.playtimePrefetchReady || Promise.resolve())
    .then(function () { return ensureMetricsCached(usernames); })
    .then(function () {
      if (!_checkerWeek) return;

      // build exempt sets in one pass
      var permanentSet = {};
      var exemptSet    = {};
      var exemptAnySet = {};
      _exemptions.forEach(function (e) {
        var uLow   = e.username.toLowerCase();
        var isPerm = (e.weeks || []).indexOf('permanent') !== -1;
        if (isPerm) permanentSet[uLow] = true;
        if ((e.weeks || []).indexOf(_checkerWeek) >= 0) exemptSet[uLow] = e;
        exemptAnySet[uLow] = true;
      });

      // compute hours from the prefetched cache
      var hoursMap = {};
      _players.forEach(function (p) {
        hoursMap[p.username.toLowerCase()] = computeWeekPlaytime(p.username, _checkerWeek);
      });
      _exemptions.forEach(function (e) {
        var uLow = e.username.toLowerCase();
        if (hoursMap[uLow] == null) {
          hoursMap[uLow] = computeWeekPlaytime(e.username, _checkerWeek);
        }
      });

      var allPlayers = _players.map(function (p) {
        var uLow   = p.username.toLowerCase();
        var ex     = exemptSet[uLow] || null;
        var anyEx  = exemptAnySet[uLow] || false;
        var fullEx = _exemptions.find(function (e) { return e.username.toLowerCase() === uLow; });
        var isPerm = !!(fullEx && (fullEx.weeks || []).indexOf('permanent') !== -1);
        return {
          username:   p.username,
          discord_id: p.discord_id || null,
          hours:      hoursMap[uLow] != null ? hoursMap[uLow] : 0,
          loading:    false,
          exempt:     ex,
          anyExempt:  anyEx,
          permanent:  isPerm,
        };
      });

      var rows;
      if (_checkerTab === 'inactive') {
        rows = allPlayers
          .filter(function (p) { return !p.permanent && !p.exempt && p.hours < _checkerHours; })
          .sort(function (a, b) { return a.hours - b.hours; });
      } else if (_checkerTab === 'active') {
        rows = allPlayers
          .filter(function (p) { return !p.permanent && !p.anyExempt && p.hours >= _checkerHours; })
          .sort(function (a, b) { return b.hours - a.hours; });
      } else { // exempt
        rows = _exemptions.map(function (e) {
          var isPerm = (e.weeks || []).indexOf('permanent') !== -1;
          var uLow   = e.username.toLowerCase();
          return {
            username:  e.username,
            hours:     hoursMap[uLow] != null ? hoursMap[uLow] : 0,
            loading:   false,
            exempt:    e,
            permanent: isPerm,
          };
        }).sort(function (a, b) {
          if (a.permanent !== b.permanent) return a.permanent ? 1 : -1;
          return a.username.localeCompare(b.username);
        });
      }

      // update tab labels with counts
      var inactiveCount = allPlayers.filter(function (p) { return !p.permanent && !p.exempt && p.hours < _checkerHours; }).length;
      var activeCount   = allPlayers.filter(function (p) { return !p.permanent && !p.anyExempt && p.hours >= _checkerHours; }).length;
      var tabsEl = document.getElementById('inacCheckerTabs');
      if (tabsEl) {
        var tabs = tabsEl.querySelectorAll('.inac-checker-tab');
        if (tabs[0]) tabs[0].textContent = 'Inactive (' + inactiveCount + ')';
        if (tabs[1]) tabs[1].textContent = 'Active ('   + activeCount   + ')';
        if (tabs[2]) tabs[2].textContent = 'Exempt ('   + _exemptions.length + ')';
      }

      renderCheckerRows(listEl, rows, hoursMap, allPlayers, /*isPartial=*/false);
    });
  }

  function copyToClipboard(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }

  function copyWarningMessage(inactiveRows) {
    var mentions = [];
    inactiveRows.forEach(function (p) {
      if (p.discord_id) mentions.push('<@' + p.discord_id + '>');
    });
    if (!mentions.length) {
      window.showToast('\u26a0 No Discord IDs found for inactive users.', 'warn');
      return;
    }
    var hoursDisplay = _checkerHours % 1 === 0 ? Math.floor(_checkerHours) : _checkerHours;
    var warningText = mentions.join(' ') +
      ' you have been warned because you haven\'t reached the playtime requirement of ' +
      '**' + hoursDisplay + ' hours** this week, without giving notice.\n\n' +
      'If you wish to stay in the guild or you think this is an error, you have 48 hours to either reach the required playtime or ' +
      'state the reason of your inactivity in <#629912948948598825>/DM a ' +
      '[Recruitment Manager](https://discord.com/channels/554418045397762048/1381292106928095312/1381292106928095312).\n\n' +
      '\u26a0\ufe0f Being active on the Hero beta does not count towards activity \u26a0\ufe0f';
    copyToClipboard(warningText);
    window.showToast('Warning message copied to clipboard!', 'success');
  }

  /* --- week helpers --- */

  function fmtDateKey(d) {
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  function buildWeekOptions() {
    var today    = new Date();
    var dow      = today.getDay();
    var sinceMon = dow === 0 ? 6 : dow - 1;
    var monday   = new Date(today);
    monday.setDate(today.getDate() - sinceMon);
    monday.setHours(0, 0, 0, 0);
    var options = [];
    for (var i = 0; i < 8; i++) {
      var mon = new Date(monday);
      mon.setDate(monday.getDate() + i * 7);
      var tue = new Date(mon);
      tue.setDate(mon.getDate() + 8);
      options.push({ label: fmtWeek(mon, tue), value: fmtDateKey(mon) + '_' + fmtDateKey(tue) });
    }
    options.push({ label: 'Permanent', value: 'permanent' });
    return options;
  }

  function fmtWeek(mon, tue) {
    if (mon.getMonth() === tue.getMonth()) {
      return mon.getDate() + ' \u2013 ' + tue.getDate() + ' ' + MONTHS[mon.getMonth()];
    }
    return mon.getDate() + ' ' + MONTHS[mon.getMonth()] +
           ' \u2013 ' + tue.getDate() + ' ' + MONTHS[tue.getMonth()];
  }

  function fmtWeekValue(w) {
    if (w === 'permanent') return 'Permanent';
    var parts = w.split('_');
    if (parts.length !== 2) return w;
    return fmtWeek(parseLocalDate(parts[0]), parseLocalDate(parts[1]));
  }

  function selectWeeks(weeks) {
    var hasPerm = weeks.indexOf('permanent') !== -1;
    document.querySelectorAll('#inacWeeks .inac-week-cb').forEach(function (cb) {
      var on = hasPerm ? cb.id === 'inacPermCb' : weeks.indexOf(cb.value) !== -1;
      cb.checked = on;
      if (on) cb.parentElement.classList.add('selected');
      else    cb.parentElement.classList.remove('selected');
    });
  }

  function updateDatalist() {
    var dl = document.getElementById('inacUserList');
    if (!dl) return;
    var names = Object.values(_allUsers).map(function (u) { return u.username; });
    names.sort(function (a, b) { return a.toLowerCase().localeCompare(b.toLowerCase()); });
    dl.innerHTML = names.map(function (n) { return '<option value="' + n + '">'; }).join('');
  }

  /* --- helpers --- */

  function parseLocalDate(s) {
    // parse as UTC midnight to match how the server stores dates
    return new Date(s + 'T00:00:00Z');
   }

  function isWeekExpired(w) {
    if (w === 'permanent') return false;
    var parts = w.split('_');
    if (parts.length !== 2) return false;
    var endLocal = parseLocalDate(parts[1]);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    return endLocal < today;
  }

  /* --- render the exemptions list --- */

  function renderList(exemptions) {
    _exemptions = exemptions;
    var countEl = document.getElementById('inacCount');
    var listEl  = document.getElementById('inacList');
    if (!countEl || !listEl) return;
    countEl.textContent = '(' + exemptions.length + ')';
    if (_checkerWeek) updateCheckerList(); // keep checker list in sync
    if (!exemptions.length) {
      listEl.innerHTML = '<div class="inac-empty">No exemptions found.</div>';
      return;
    }
    listEl.innerHTML = exemptions.map(function (e) {
      var weeks = (e.weeks || []).slice().sort(function (a, b) {
        if (a === 'permanent') return 1;
        if (b === 'permanent') return -1;
        return a.split('_')[0] < b.split('_')[0] ? -1 : 1;
      });
      var badgesHtml = weeks.length
        ? weeks.map(function (w) {
            var isPerm   = w === 'permanent';
            var expired  = !isPerm && isWeekExpired(w);
            var cls      = isPerm ? 'inac-badge perm' : (expired ? 'inac-badge expired' : 'inac-badge');
            return '<span class="' + cls + '">' + fmtWeekValue(w) + '</span>';
          }).join('')
        : '<span class="inac-badge expired">No weeks</span>';
      return '<div class="inac-row">' +
        '<div class="inac-row-main">' +
          '<span class="inac-username inac-username-link" data-username="' + e.username + '">' + e.username + '</span>' +
          '<span class="inac-reason">' + (e.reason || '\u2014') + '</span>' +
          '<div class="inac-week-badges">' + badgesHtml + '</div>' +
        '</div>' +
        '<div class="inac-row-btns">' +
          '<button class="inac-edit-btn"   data-id="' + e.discord_id + '" title="Edit">&#x270e;</button>' +
          '<button class="inac-remove-btn" data-id="' + e.discord_id + '" title="Remove">&#x2715;</button>' +
        '</div>' +
      '</div>';
    }).join('');
    listEl.querySelectorAll('.inac-edit-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { window._inacStartEdit(this.dataset.id); });
    });
    listEl.querySelectorAll('.inac-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { removeExemption(this.dataset.id); });
    });
    listEl.querySelectorAll('.inac-username-link').forEach(function (el) {
      el.addEventListener('click', function () { window.goToPlayer(this.dataset.username); });
    });
  }

  /* --- submit / remove --- */

  function submitExemption() {
    var username = (document.getElementById('inacUsername').value || '').trim();
    var reason   = (document.getElementById('inacReason').value   || '').trim();
    var checked  = Array.prototype.slice.call(document.querySelectorAll('#inacWeeks .inac-week-cb:checked'));
    if (!username) { window.showToast('\u26a0 Enter a username.',  'warn'); return; }
    if (!reason)   { reason = "No reason provided" }
    if (!checked.length) { window.showToast('\u26a0 Select a duration.', 'warn'); return; }
    var weeks = checked.map(function (cb) { return cb.value; });
    var btn   = document.getElementById('inacSubmit');
    btn.disabled = true;
    var url    = _editingId ? '/api/inactivity/' + _editingId : '/api/inactivity';
    var method = _editingId ? 'PATCH' : 'POST';
    var body   = _editingId
      ? { reason: reason, weeks: weeks }
      : { username: username, reason: reason, weeks: weeks };
    fetch(url, {
      method:      method,
      credentials: 'same-origin',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify(body),
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      btn.disabled = false;
      if (data.error) { window.showToast('Error: ' + data.error, 'error'); return; }
      window.showToast(
        (_editingId ? 'Updated ' : 'Added ') + data.username + '.',
        'success'
      );
      if (window._inacCancelEdit) window._inacCancelEdit();
      loadInactivity();
    })
    .catch(function () { btn.disabled = false; window.showToast('Request failed.', 'error'); });
  }

  function removeExemption(discordId) {
    fetch('/api/inactivity/' + discordId, { method: 'DELETE', credentials: 'same-origin' })
    .then(function (r) { return r.json(); })
    .then(function () { window.showToast('Exemption removed.', 'info'); loadInactivity(); })
    .catch(function () { window.showToast('Failed to remove.', 'error'); });
  }

})();
