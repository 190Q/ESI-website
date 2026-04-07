(function () {
  'use strict';

  /*
     promotion tracks:
     - recruiter: recruit who joined at least 4 days before last saturday
     - captain:   recruiter with 25+ raids or 50+ wars since joining
  */

  var _members   = [];
  var _filter    = '';
  var _settingsPromTab = (window.esiSettings && window.esiSettings.get('promotionsTab')) || 'recruiter';
  var _activeTab = (_settingsPromTab === 'captain') ? 'captain' : 'recruiter';
  var _promActiveToast = null;
  var _promLoading = false;
  var _promFetched = false;

  var panel = document.getElementById('panel-promotions');

  /* panel activation */
  var observer = new MutationObserver(function () {
    if (panel.classList.contains('active')) load();
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  if (panel.classList.contains('active')) load();

  /* --- date helpers --- */

  function lastSaturday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    var dow = d.getDay(); // 0=Sun … 6=Sat
    var daysBack = dow === 6 ? 0 : (dow + 1);
    d.setDate(d.getDate() - daysBack);
    return d;
  }

  function cutoffSaturday() {
    var d = lastSaturday();
    d.setDate(d.getDate() - 4);
    return d;
  }
  
  function nextSaturday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    var dow = d.getDay();
    var daysUntil = dow === 6 ? 7 : (6 - dow);
    d.setDate(d.getDate() + daysUntil);
    return d;
  }

  function nextCutoffSaturday() {
    var d = nextSaturday();
    d.setDate(d.getDate() - 4);
    return d;
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function daysSince(iso) {
    return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  }

  /* sum wars/raids from the cache starting from their join date */
  function sumMetricSinceJoin(username, metricKey, joinedIso) {
    if (!joinedIso) return 0;
    var cache = window.playtimeCache && window.playtimeCache[username.toLowerCase()];
    if (!cache) return 0;
    var dates  = cache.metricDates || cache.dates || [];
    var values = cache[metricKey] || [];
    if (!dates.length || !values.length) return 0;
    var joinDate = new Date(joinedIso);
    joinDate.setUTCHours(0, 0, 0, 0);
    var sum = 0;
    var len = Math.min(dates.length, values.length);
    for (var i = 0; i < len; i++) {
      var dStr = dates[i];
      var d = new Date(dStr.indexOf('T') !== -1 ? dStr : dStr + 'T00:00:00Z');
      if (d >= joinDate) sum += (values[i] || 0);
    }
    return Math.round(sum);
  }

  /* --- member processing (shared by cache pre-render + fresh fetch) --- */
  function processMembers(localPlayers, guildData) {
    var wynnMap = {};
    var members = (guildData && guildData.members) ? guildData.members : {};
    Object.entries(members).forEach(function (rankEntry) {
      var rankName  = rankEntry[0].toLowerCase();
      var rankGroup = rankEntry[1];
      if (!rankGroup || typeof rankGroup !== 'object') return;
      Object.entries(rankGroup).forEach(function (memberEntry) {
        wynnMap[memberEntry[0].toLowerCase()] = {
          joined:      memberEntry[1].joined || null,
          wynnRank:    rankName,
          contributed: typeof memberEntry[1].contributed === 'number' ? memberEntry[1].contributed : 0,
        };
      });
    });

    var cutoff     = cutoffSaturday();
    var nextCutoff = nextCutoffSaturday();

    return localPlayers.filter(function (p) {
      return !!wynnMap[p.username.toLowerCase()];
    }).map(function (p) {
      var wynn       = wynnMap[p.username.toLowerCase()];
      var joined     = wynn.joined || null;
      var wynnRank   = wynn.wynnRank || (p.guild_rank || '').toLowerCase();
      var joinedDate = null;
      if (joined) {
          joinedDate = new Date(joined);
          joinedDate.setHours(0, 0, 0, 0);
      }
      var raids = sumMetricSinceJoin(p.username, 'guildRaids', joined);
      var wars  = sumMetricSinceJoin(p.username, 'wars', joined);

      return {
        username:          p.username,
        discord_id:        p.discord_id,
        guild_rank:        wynnRank,
        joined:            joined,
        joinedDate:        joinedDate,
        contributed:       wynn.contributed || 0,
        recruiterEligible: wynnRank === 'recruit' && joinedDate !== null && joinedDate <= cutoff,
        recruiterSoon:     wynnRank === 'recruit' && joinedDate !== null && joinedDate > cutoff && joinedDate <= nextCutoff,
        raids:             raids,
        wars:              wars,
        captainEligible:   wynnRank === 'recruiter' && (raids >= 25 || wars >= 50),
      };
    });
  }

  /* --- load --- */
  function load() {
    if (_promLoading) return;
    _promLoading = true;
    var hasExistingData = !!document.getElementById('promShell');

    // show cached data right away so the page isn't empty
    if (!hasExistingData) {
      var cachedPlayers = DataCache.readCache('/api/inactivity/players');
      var cachedGuild   = DataCache.readCache('/api/guild/prefix/ESI');
      if (cachedPlayers) {
        _members = processMembers(cachedPlayers, cachedGuild || {});
        buildShell();
        hasExistingData = true;
      }
    }

    if (_promActiveToast) { _promActiveToast.dismiss(); _promActiveToast = null; }
    var _promToast = null;
    if (hasExistingData && !_promFetched && typeof window.showProgressToast === 'function') {
      _promToast = window.showProgressToast('Fetching promotions data\u2026');
      _promActiveToast = _promToast;
      _promToast.addItem('players', 'Player Database');
      _promToast.addItem('guild', 'Wynncraft API');
    }
    var _promMsgs = { success: '\u2713 Promotions data loaded', fail: '\u2715 Failed to load promotions data', partial: '\u26a0 Promotions data partially loaded' };

    Promise.all([
      DataCache.cachedFetch('/api/inactivity/players', { credentials: 'same-origin' })
        .then(function (r) { if (_promToast) _promToast.updateItem('players', 'success'); return { ok: true, status: 200, data: r.data }; })
        .catch(function () { if (_promToast) _promToast.updateItem('players', 'error'); return { ok: false, status: 401, data: null }; }),
      DataCache.cachedFetch('/api/guild/prefix/ESI')
        .then(function (r) { if (_promToast) _promToast.updateItem('guild', 'success'); return r.data; })
        .catch(function () { if (_promToast) _promToast.updateItem('guild', 'error'); return {}; }),
      window.playtimePrefetchReady || Promise.resolve(),
    ])
      .then(function (rs) {
        if (!rs[0].ok) { if (!hasExistingData) renderGate(rs[0].status); if (_promToast) _promToast.finish(_promMsgs); return null; }
        return [rs[0].data || [], rs[1]];
      })
      .then(function (results) {
        if (!results) return;
        _members = processMembers(results[0], results[1]);

        if (!document.getElementById('promShell')) buildShell();
        else renderTable();
        if (_promToast) _promToast.finish(_promMsgs);
        _promFetched = true;
      })
      .catch(function () { if (_promToast) _promToast.finish(_promMsgs); if (!hasExistingData) renderGate(0); })
      .finally(function () { _promLoading = false; });
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
        '<h1 class="panel-title">&#x2B06; Promotions</h1>' +
        '<p class="panel-subtitle">Track member promotion eligibility</p>' +
      '</div>' +
      '<div class="inac-empty">' + msg + '</div>';
  }

  /* --- shell --- */
  function buildShell() {
    var cutoff    = cutoffSaturday();
    var cutoffStr = cutoff.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

    panel.innerHTML =
      '<div class="panel-header" id="promShell">' +
        '<h1 class="panel-title">&#x2B06; Promotions</h1>' +
        '<p class="panel-subtitle">Track member promotion eligibility</p>' +
      '</div>' +

      '<div class="prom-criteria-row">' +
        '<div class="info-card prom-criteria-card">' +
          '<div class="info-card-header">&#x2192; Recruiter [★]</div>' +
          '<div class="prom-criteria-body">' +
            '<div class="prom-criteria-item">' +
              '<span>Joined on or before <strong>' + cutoffStr + '</strong><br><span class="prom-criteria-note">at least 4 days before last Saturday</span></span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="info-card prom-criteria-card">' +
          '<div class="info-card-header">&#x2192; Captain [★★]</div>' +
          '<div class="prom-criteria-body">' +
            '<div class="prom-criteria-item">' +
              '<span><strong>25 raids</strong> since joining</span>' +
            '</div>' +
            '<div class="prom-criteria-or">or</div>' +
            '<div class="prom-criteria-item">' +
              '<span><strong>50 wars</strong> since joining</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="info-card">' +
        '<div class="info-card-header prom-table-header">' +
          '<div class="prom-tabs">' +
            '<button class="prom-tab active" data-tab="recruiter">&#x2192; Recruiter</button>' +
            '<button class="prom-tab" data-tab="captain">&#x2192; Captain</button>' +
          '</div>' +
          '<div style="display:flex;gap:8px;align-items:center">' +
            '<label for="promSearch" class="sr-only">Search members</label>' +
            '<input type="text" id="promSearch" class="inac-input" placeholder="Search…" style="width:150px;padding:5px 10px;font-size:0.8rem" aria-label="Search members" />' +
          '</div>' +
        '</div>' +
        '<div id="promTableWrap"></div>' +
      '</div>';

    document.getElementById('promSearch').addEventListener('input', function () {
      _filter = this.value.trim().toLowerCase();
      renderTable();
    });
    panel.querySelectorAll('.prom-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        panel.querySelectorAll('.prom-tab').forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        _activeTab = this.dataset.tab;
        renderTable();
      });
    });

    var criteriaRow = panel.querySelector('.prom-criteria-row');
    var sentinel = document.createElement('div');
    sentinel.style.cssText = 'height:1px;margin-top:-1px;pointer-events:none;';
    criteriaRow.parentElement.insertBefore(sentinel, criteriaRow);

    var stickyObserver = new IntersectionObserver(function(entries) {
      var isStuck = !entries[0].isIntersecting;
      criteriaRow.style.paddingTop = isStuck ? '2.9em' : '0px';
    }, { threshold: [1] });

    stickyObserver.observe(sentinel);

    renderTable();
  }

  /* --- table render --- */
  function renderTable() {
    var wrap = document.getElementById('promTableWrap');
    if (!wrap) return;

    var rows = _members.filter(function (m) {
      return _activeTab === 'recruiter' ? m.guild_rank === 'recruit' : m.guild_rank === 'recruiter';
    });

    if (_filter) {
      rows = rows.filter(function (m) { return m.username.toLowerCase().indexOf(_filter) !== -1; });
    }

    /* eligible first, then by join date */
    rows.sort(function (a, b) {
      var ae = _activeTab === 'recruiter' ? a.recruiterEligible : a.captainEligible;
      var be = _activeTab === 'recruiter' ? b.recruiterEligible : b.captainEligible;
      if (ae !== be) return ae ? -1 : 1;
      if (a.joinedDate && b.joinedDate) return a.joinedDate - b.joinedDate;
      return a.username.localeCompare(b.username);
    });

    if (!rows.length) {
      wrap.innerHTML = '<div class="inac-empty">No members in this rank.</div>';
      return;
    }

    var thead, tbody;

    if (_activeTab === 'recruiter') {
      thead =
        '<tr>' +
          '<th class="prom-th">Member</th>' +
          '<th class="prom-th">Joined</th>' +
          '<th class="prom-th">Days in Guild</th>' +
          '<th class="prom-th">Status</th>' +
        '</tr>';

      tbody = rows.map(function (m) {
        var eligible  = m.recruiterEligible;
        var days      = m.joined ? daysSince(m.joined) : null;
        var daysHtml  = days !== null ? days + 'd' : '—';
        var joinedStr = m.joined ? fmtDate(m.joined) : '—';

        return '<tr class="prom-row' + (eligible ? ' prom-row-eligible' : '') + '">' +
          '<td class="prom-td prom-name prom-name-link" data-username="' + m.username + '" data-joined="' + (m.joined || '') + '">' + m.username + '</td>' +
          '<td class="prom-td prom-meta">' + joinedStr + '</td>' +
          '<td class="prom-td prom-meta">' + daysHtml + '</td>' +
          '<td class="prom-td">' +
            (eligible
              ? '<span class="prom-status eligible">&#x2713; Eligible</span>'
              : (m.recruiterSoon
                  ? '<span class="prom-status soon">Eligible Saturday</span>'
                  : '<span class="prom-status">Waiting</span>')) +
          '</td>' +
        '</tr>';
      }).join('');

    } else {
      thead =
        '<tr>' +
          '<th class="prom-th">Member</th>' +
          '<th class="prom-th">Joined</th>' +
          '<th class="prom-th prom-th-stat">Raids <span class="prom-th-req">/ 25</span></th>' +
          '<th class="prom-th prom-th-stat">Wars <span class="prom-th-req">/ 50</span></th>' +
          '<th class="prom-th">Status</th>' +
        '</tr>';

      tbody = rows.map(function (m) {
        var eligible  = m.captainEligible;
        var raidsMet  = m.raids >= 25;
        var warsMet   = m.wars  >= 50;
        var joinedStr = m.joined ? fmtDate(m.joined) : '—';

        return '<tr class="prom-row' + (eligible ? ' prom-row-eligible' : '') + '">' +
          '<td class="prom-td prom-name prom-name-link" data-username="' + m.username + '">' + m.username + '</td>' +
          '<td class="prom-td prom-meta">' + joinedStr + '</td>' +
          '<td class="prom-td prom-meta prom-stat-cell"><span class="prom-stat' + (raidsMet ? ' met' : '') + ' prom-stat-link" data-username="' + m.username + '" data-metric="guildRaids" data-joined="' + (m.joined || '') + '">' + m.raids + '</span></td>' +
          '<td class="prom-td prom-meta prom-stat-cell"><span class="prom-stat' + (warsMet  ? ' met' : '') + ' prom-stat-link" data-username="' + m.username + '" data-metric="wars" data-joined="' + (m.joined || '') + '">' + m.wars  + '</span></td>' +
          '<td class="prom-td">' +
            (eligible
              ? '<span class="prom-status eligible">&#x2713; Eligible</span>'
              : '<span class="prom-status">&#x2014;</span>') +
          '</td>' +
        '</tr>';
      }).join('');
    }

    wrap.innerHTML =
      '<table class="prom-table">' +
        '<thead>' + thead + '</thead>' +
        '<tbody>' + tbody + '</tbody>' +
      '</table>';
    
    wrap.querySelectorAll('.prom-name-link').forEach(function (el) {
      el.addEventListener('click', function () {
        var joined = this.dataset.joined;
        var opts = null;
        if (joined) {
          var daysInGuild = Math.min(60, daysSince(joined));
          opts = { graphFocus: { rangeDays: Math.max(2, daysInGuild) } };
        }
        window.goToPlayer(this.dataset.username, opts);
      });
    });
    wrap.querySelectorAll('.prom-stat-link').forEach(function (el) {
      el.addEventListener('click', function () {
        var username = this.dataset.username;
        var metric   = this.dataset.metric;
        var joined   = this.dataset.joined;
        var daysInGuild = joined ? Math.min(60, daysSince(joined)) : 60;
        window.goToPlayer(username, {
          graphMetrics: [metric],
          graphFocus: { rangeDays: Math.max(2, daysInGuild) },
        });
      });
    });
  }

})();