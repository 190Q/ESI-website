(function () {
  'use strict';

  var A = window.ESIAnalytics;
  var _state = A.state;
  var writeState = A.writeState;
  var USE_DEMO_DATA = A.USE_DEMO_DATA;
  var el = A.el;
  var fmtInt = A.fmtInt;
  var fmtDuration = A.fmtDuration;
  var fmtPct = A.fmtPct;
  var fmtDateTime = A.fmtDateTime;
  var deltaPct = A.deltaPct;
  var sumOf = A.sumOf;
  var avgOf = A.avgOf;
  var rng = A.rng;
  var demoBase = A.demoBase;
  var trendSeries = A.trendSeries;
  var sparkline = A.sparkline;
  var timeSeriesChart = A.timeSeriesChart;
  var rankedRows = A.rankedRows;
  var card = A.card;
  var segmented = A.segmented;
  var dataTable = A.dataTable;
  var analyticsPanel = A.analyticsPanel;
  var analyticsFoot = A.analyticsFoot;
  var miniStrip = A.miniStrip;
  var rankedCard = A.rankedCard;
  var donutCard = A.donutCard;
  var panelKpiStrip = A.panelKpiStrip;
  var csvName = A.csvName;

  function loadAudience(range) {
    if (USE_DEMO_DATA) return Promise.resolve(buildAudienceDemo(range));
    return fetch('/panel/api/analytics/audience?range=' + encodeURIComponent(range), {
      credentials: 'same-origin',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function buildAudienceDemo(range) {
    var base = demoBase(range);
    var rand = rng(7717 + range.length * 349);
    var labels = base.labels;
    var visitors = base.traffic.visitors;
    var n = labels.length;

    function series(start, spread, trend) {
      var out = [];
      for (var i = 0; i < n; i++) {
        var t = n > 1 ? i / (n - 1) : 0;
        out.push(Math.max(0, Math.round(start * (1 + trend * t) + (rand() - 0.5) * spread)));
      }
      return out;
    }

    var totalVisitors = sumOf(visitors);
    var newSeries = visitors.map(function (v) { return Math.round(v * 0.58); });
    var returningSeries = visitors.map(function (v, i) { return Math.max(0, v - newSeries[i]); });
    var sessions = visitors.map(function (v) { return Math.round(v * (1.4 + rand() * 0.4)); });
    var logins = series(38, 22, 0.15);
    var totalSessions = sumOf(sessions);
    var totalNew = sumOf(newSeries);
    var totalReturning = sumOf(returningSeries);

    var avgDuration = 262;
    var pagesPerSession = 3.42;
    var bounceRate = 42.1;

    var activeSeries = [];
    for (var m = 0; m < 60; m++) {
      activeSeries.push(Math.max(0, Math.round(46 + Math.sin(m / 7) * 9 + (rand() - 0.5) * 10)));
    }
    var activeWindow = {
      now: activeSeries[activeSeries.length - 1],
      peak: Math.max.apply(null, activeSeries),
      low: Math.min.apply(null, activeSeries),
      avg: avgOf(activeSeries),
      prev: Math.max(1, Math.round(avgOf(activeSeries) * 0.86)),
      series: activeSeries,
    };
    var neverLoggedIn = { count: 128, total: 410 };
    var loginAttempts = sumOf(logins) + 24;
    var loginSuccesses = sumOf(logins);
    var loginFailures = loginAttempts - loginSuccesses;

    return {
      demo: true,
      range: range,
      generatedAt: new Date().toISOString(),
      labels: labels,
      kpis: {
        visitors:      { value: totalVisitors, prev: Math.round(totalVisitors * 0.87), series: visitors, format: fmtInt, invert: false },
        newVisitors:   { value: totalNew, prev: Math.round(totalNew * 0.91), series: newSeries, format: fmtInt, invert: false },
        returning:     { value: totalReturning, prev: Math.round(totalReturning * 0.82), series: returningSeries, format: fmtInt, invert: false },
        sessions:      { value: totalSessions, prev: Math.round(totalSessions * 0.89), series: sessions, format: fmtInt, invert: false },
        duration:      { value: avgDuration, prev: 238, series: trendSeries(avgDuration, n, 0.12, rand), format: fmtDuration, invert: false },
        pagesPerSession: { value: pagesPerSession, prev: 3.11, series: trendSeries(pagesPerSession, n, 0.1, rand), format: function (v) { return v.toFixed(2); }, invert: false },
        bounceRate:    { value: bounceRate, prev: 46.8, series: trendSeries(bounceRate, n, 0.1, rand), format: function (v) { return fmtPct(v, 1); }, invert: true },
        logins:        { value: loginSuccesses, prev: Math.round(loginSuccesses * 0.9), series: logins, format: fmtInt, invert: false },
        loginSuccessRate: { value: (loginSuccesses / loginAttempts) * 100, prev: 92.4, series: trendSeries((loginSuccesses / loginAttempts) * 100, n, 0.03, rand), format: function (v) { return fmtPct(v, 1); }, invert: false },
        countries:     { value: 34, prev: 31, series: trendSeries(34, n, 0.08, rand), format: fmtInt, invert: false },
      },
      visitorSeries: { total: visitors, new: newSeries, returning: returningSeries },
      split: [
        { label: 'New',       value: totalNew },
        { label: 'Returning', value: totalReturning },
      ],
      frequency: [
        { label: '1 visit',  value: Math.round(totalVisitors * 0.48) },
        { label: '2-5',      value: Math.round(totalVisitors * 0.34) },
        { label: '6-10',     value: Math.round(totalVisitors * 0.12) },
        { label: '11+',      value: Math.round(totalVisitors * 0.06) },
      ],
      sources: [
        { label: 'Direct',   value: 4210 },
        { label: 'Discord',  value: 2840 },
        { label: 'Search',   value: 1120 },
        { label: 'Referral', value: 460 },
      ],
      utm: [
        { campaign: 'wynnpiece-launch',   source: 'discord', medium: 'social', sessions: 1240, conversion: 8.4 },
        { campaign: 'guild-anniversary',  source: 'discord', medium: 'social', sessions: 860,  conversion: 12.1 },
        { campaign: 'aspect-hunt-night',  source: 'discord', medium: 'social', sessions: 410,  conversion: 5.2 },
        { campaign: 'shop-restock',       source: 'discord', medium: 'social', sessions: 240,  conversion: 3.8 },
      ],
      activeWindow: activeWindow,
      durationBuckets: [
        { label: '< 30s',    value: Math.round(totalSessions * 0.18) },
        { label: '30s - 2m', value: Math.round(totalSessions * 0.27) },
        { label: '2 - 10m',  value: Math.round(totalSessions * 0.34) },
        { label: '10 - 30m', value: Math.round(totalSessions * 0.15) },
        { label: '> 30m',    value: Math.round(totalSessions * 0.06) },
      ],
      pagesBuckets: [
        { label: '1 page', value: Math.round(totalSessions * 0.42) },
        { label: '2-3',    value: Math.round(totalSessions * 0.31) },
        { label: '4-6',    value: Math.round(totalSessions * 0.18) },
        { label: '7+',     value: Math.round(totalSessions * 0.09) },
      ],
      bounceByEntry: [
        { label: '/',              value: 38.2 },
        { label: '/player/<user>', value: 44.6 },
        { label: '/guild',         value: 47.8 },
        { label: '/events',        value: 51.3 },
        { label: '/shop',          value: 56.1 },
      ],
      devices: [
        { label: 'Desktop', value: 5940 },
        { label: 'Mobile',  value: 2180 },
        { label: 'Tablet',  value: 380 },
      ],
      os: [
        { label: 'Windows', value: 3810 },
        { label: 'macOS',   value: 1620 },
        { label: 'Android', value: 1420 },
        { label: 'iOS',     value: 980 },
        { label: 'Linux',   value: 610 },
        { label: 'Other',   value: 60 },
      ],
      browsers: [
        { label: 'Chrome',  value: 4820 },
        { label: 'Firefox', value: 1610 },
        { label: 'Safari',  value: 1180 },
        { label: 'Edge',    value: 690 },
        { label: 'Opera',   value: 190 },
        { label: 'Other',   value: 60 },
      ],
      screens: [
        { label: '1920 x 1080', value: 3420 },
        { label: '2560 x 1440', value: 1480 },
        { label: '1366 x 768',  value: 1120 },
        { label: '1440 x 900',  value: 760 },
        { label: '390 x 844',   value: 690 },
        { label: '2560 x 1600', value: 420 },
      ],
      viewports: [
        { label: '1920 x 937',  value: 2810 },
        { label: '1512 x 850',  value: 1240 },
        { label: '1366 x 655',  value: 980 },
        { label: '390 x 664',   value: 690 },
        { label: '2560 x 1300', value: 620 },
        { label: 'Other',       value: 1330 },
      ],
      connection: [
        { label: '4g',       value: 4210 },
        { label: 'wifi',     value: 3180 },
        { label: '5g',       value: 740 },
        { label: '3g',       value: 260 },
        { label: 'slow-2g',  value: 70 },
      ],
      locales: [
        { label: 'en-GB', value: 4120 },
        { label: 'en-US', value: 1840 },
        { label: 'nl-NL', value: 1120 },
        { label: 'de-DE', value: 880 },
        { label: 'fr-FR', value: 640 },
        { label: 'Other', value: 690 },
      ],
      timezones: [
        { label: 'Europe/Brussels',   value: 2340 },
        { label: 'Europe/Amsterdam',  value: 1180 },
        { label: 'Europe/Berlin',     value: 940 },
        { label: 'Europe/Paris',      value: 760 },
        { label: 'America/New_York',  value: 690 },
        { label: 'Other',             value: 2790 },
      ],
      memory: [
        { label: '8 GB',  value: 2840 },
        { label: '16 GB', value: 2210 },
        { label: '4 GB',  value: 1480 },
        { label: '32 GB', value: 980 },
        { label: '2 GB',  value: 620 },
        { label: 'Unknown', value: 380 },
      ],
      cores: [
        { label: '8 cores',  value: 3120 },
        { label: '4 cores',  value: 1980 },
        { label: '16 cores', value: 1420 },
        { label: '2 cores',  value: 740 },
        { label: '12 cores', value: 680 },
        { label: '32 cores', value: 320 },
      ],
      bots: [
        { label: 'Human', value: 7420 },
        { label: 'Bot',   value: 1180 },
      ],
      crawlers: [
        { label: 'Googlebot',  value: 480 },
        { label: 'Bingbot',    value: 210 },
        { label: 'AhrefsBot',  value: 160 },
        { label: 'SemrushBot', value: 140 },
        { label: 'Discordbot', value: 120 },
        { label: 'Other',      value: 70 },
      ],
      privacy: {
        dnt: 1240,
        gpc: 310,
        consent: [
          { label: 'Granted',  value: 2840 },
          { label: 'Declined', value: 180 },
          { label: 'Not asked yet', value: 5580 },
        ],
      },
      regions: [
        { label: 'Belgium',       value: 2140 },
        { label: 'Netherlands',   value: 1180 },
        { label: 'Germany',       value: 940 },
        { label: 'France',        value: 760 },
        { label: 'United States', value: 690 },
        { label: 'Other',         value: 2790 },
      ],
      regionTable: [
        { region: 'Belgium',       sessions: 3010, visitors: 2140, share: 25.2, bounce: 38.4 },
        { region: 'Netherlands',   sessions: 1660, visitors: 1180, share: 13.9, bounce: 41.2 },
        { region: 'Germany',       sessions: 1320, visitors: 940,  share: 11.1, bounce: 43.7 },
        { region: 'France',        sessions: 1070, visitors: 760,  share: 9.0,  bounce: 45.1 },
        { region: 'United States', sessions: 970,  visitors: 690,  share: 8.1,  bounce: 49.6 },
        { region: 'Other',         sessions: 3920, visitors: 2790, share: 32.7, bounce: 44.8 },
      ],
      cities: [
        { label: 'Brussels',   value: 980 },
        { label: 'Amsterdam',  value: 620 },
        { label: 'Antwerp',    value: 410 },
        { label: 'Berlin',     value: 380 },
        { label: 'Paris',      value: 340 },
        { label: 'Rotterdam',  value: 290 },
        { label: 'Other',      value: 5570 },
      ],
      auth: {
        funnel: [
          { label: 'Login started',  value: loginAttempts },
          { label: 'OAuth redirect', value: loginAttempts - 10 },
          { label: 'Callback',       value: loginAttempts - 16 },
          { label: 'Session issued', value: loginSuccesses },
        ],
        attempts: loginAttempts,
        successes: loginSuccesses,
        failures: loginFailures,
        abandoned: 10,
        callbackErrors: 3,
        loginSeries: logins,
        failureReasons: [
          { label: 'OAuth state mismatch',   value: 9 },
          { label: 'User denied access',     value: 6 },
          { label: 'Token exchange failed',  value: 3 },
          { label: 'Guild lookup failed',    value: 2 },
        ],
        logouts: [
          { label: 'Manual',        value: 186 },
          { label: 'Idle timeout',  value: 94 },
          { label: 'Session expiry', value: 41 },
        ],
        logoutTotal: 321,
        idleTimeoutRate: 29.3,
        reauthRate: 12.4,
        sessionHealth: [
          { label: 'Avg session',    value: '18m 40s' },
          { label: 'Median session', value: '9m 12s' },
          { label: 'Idle timeouts',  value: '29.3%' },
          { label: 'Re-auth rate',   value: '12.4%' },
        ],
        ranks: [
          { label: 'Citizen',    value: 214 },
          { label: 'Below Citizen', value: 36 },
          { label: 'Juror',      value: 62 },
          { label: 'Parliament', value: 38 },
          { label: 'Congress',   value: 21 },
          { label: 'Archduke',   value: 14 },
          { label: 'Grand Duke', value: 6 },
          { label: 'Emperor',    value: 1 },
        ],
        neverLoggedIn: neverLoggedIn,
        activeAccounts: [
          { account: '190Q',      rank: 'Emperor',    logins: 84, sessions: 96,  lastSeen: '2026-09-30T13:41:00Z' },
          { account: 'Sindria',   rank: 'Grand Duke', logins: 61, sessions: 72,  lastSeen: '2026-09-29T21:12:00Z' },
          { account: 'Valaendor', rank: 'Archduke',   logins: 47, sessions: 58,  lastSeen: '2026-09-30T09:03:00Z' },
          { account: 'Meridia',   rank: 'Congress',   logins: 33, sessions: 41,  lastSeen: '2026-09-28T18:55:00Z' },
          { account: 'Kestrel',   rank: 'Parliament', logins: 28, sessions: 35,  lastSeen: '2026-09-27T11:20:00Z' },
          { account: 'Halcyon',   rank: 'Juror',      logins: 19, sessions: 24,  lastSeen: '2026-09-30T07:44:00Z' },
        ],
        panelActivity: [
          { label: 'Account modal opened', value: 640 },
          { label: 'Settings changed',     value: 218 },
          { label: 'Theme changed',        value: 96 },
          { label: 'Font changed',         value: 41 },
        ],
        devLogin: 0,
      },
    };
  }

  // Tiny inline sparkline. Non-uniform scaling is fine at this size.

  var AUDIENCE_TABS = [
    { id: 'visitors', label: 'Visitors' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'devices',  label: 'Devices' },
    { id: 'regions',  label: 'Regions' },
    { id: 'auth',     label: 'Auth' },
  ];

  var VISITOR_METRICS = [
    { id: 'total',     label: 'Total' },
    { id: 'new',       label: 'New' },
    { id: 'returning', label: 'Returning' },
  ];

  function buildAudience(container) {
    return analyticsPanel({
      container: container,
      label: 'Audience',
      tabKey: 'audience',
      tabs: AUDIENCE_TABS,
      load: loadAudience,
      exportRows: audienceExportRows,
      exportName: function (d, tab) { return csvName('audience', tab); },
      render: renderAudience,
    });
  }

  function renderAudience(ctx) {
    if (ctx.tab === 'sessions') audienceSessionsTab(ctx);
    else if (ctx.tab === 'devices') audienceDevicesTab(ctx);
    else if (ctx.tab === 'regions') audienceRegionsTab(ctx);
    else if (ctx.tab === 'auth') audienceAuthTab(ctx);
    else audienceVisitorsTab(ctx);
    ctx.content.appendChild(analyticsFoot(ctx.data));
  }

  function audienceExportRows(d, tab) {
    if (tab === 'sessions') {
      var s = [['bucket', 'sessions']];
      d.labels.forEach(function (l, i) { s.push([l, d.kpis.sessions.series[i]]); });
      return s;
    }
    if (tab === 'devices') {
      var dev = [['device', 'sessions']];
      d.devices.forEach(function (x) { dev.push([x.label, x.value]); });
      return dev;
    }
    if (tab === 'regions') {
      var reg = [['region', 'sessions', 'visitors', 'share_pct', 'bounce_pct']];
      d.regionTable.forEach(function (r) { reg.push([r.region, r.sessions, r.visitors, r.share, r.bounce]); });
      return reg;
    }
    if (tab === 'auth') {
      var a = [['stage', 'value']];
      d.auth.funnel.forEach(function (f) { a.push([f.label, f.value]); });
      return a;
    }
    var v = [['bucket', 'total', 'new', 'returning']];
    d.labels.forEach(function (l, i) {
      v.push([l, d.visitorSeries.total[i], d.visitorSeries.new[i], d.visitorSeries.returning[i]]);
    });
    return v;
  }

  /* Visitors tab */
  function audienceVisitorsTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'visitors',    label: 'Unique visitors', cls: 'an-c2', hint: 'Distinct visitors in range' },
      { id: 'newVisitors', label: 'New',             cls: 'an-c1', hint: 'First ever visit' },
      { id: 'returning',   label: 'Returning',       cls: 'an-c4', hint: 'Seen before' },
      { id: 'sessions',    label: 'Sessions',        cls: 'an-c3', hint: 'Total sessions' },
    ]));

    var metric = VISITOR_METRICS.filter(function (m) { return m.id === _state.visitorMetric; })[0] || VISITOR_METRICS[0];
    var row = el('div', 'an-grid');

    var picker = segmented(VISITOR_METRICS.map(function (m) {
      return { id: m.id, label: m.label };
    }), metric.id, function (id) {
      _state.visitorMetric = id;
      writeState();
      ctx.rerender();
    });
    picker.classList.add('an-seg--sm');

    var chart = card({
      title: 'Visitors over time',
      span: 8,
      tools: [picker],
      exportRows: function () {
        var rows = [['bucket', 'total', 'new', 'returning']];
        d.labels.forEach(function (l, i) {
          rows.push([l, d.visitorSeries.total[i], d.visitorSeries.new[i], d.visitorSeries.returning[i]]);
        });
        return rows;
      },
      exportName: csvName('audience', 'visitors-over-time'),
    });
    chart.body.appendChild(timeSeriesChart({
      labels: d.labels,
      series: [{ name: metric.label, values: d.visitorSeries[metric.id], area: true }],
      formatValue: fmtInt,
      height: 288,
      ariaLabel: metric.label + ' visitors over time',
    }));
    row.appendChild(chart.root);

    row.appendChild(donutCard({
      title: 'New vs returning', span: 4, items: d.split, unit: 'segment',
      exportName: csvName('audience', 'new-vs-returning'),
    }).root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    row2.appendChild(rankedCard({
      title: 'Visit frequency', span: 4, items: d.frequency, cls: 'an-c2', unit: 'visits',
      foot: 'Visits per visitor over the range.',
      exportName: csvName('audience', 'visit-frequency'),
    }).root);
    row2.appendChild(donutCard({
      title: 'Referrer source', span: 4, items: d.sources, unit: 'source',
      exportName: csvName('audience', 'referrers'),
    }).root);
    row2.appendChild(donutCard({
      title: 'Bot vs human', span: 4, items: d.bots, unit: 'class',
      exportName: csvName('audience', 'bot-vs-human'),
    }).root);
    ctx.content.appendChild(row2);

    var row3 = el('div', 'an-grid');
    var utm = card({
      title: 'UTM campaigns',
      span: 12,
      foot: 'Campaign tagging on links posted to Discord.',
      exportRows: function () {
        var rows = [['campaign', 'source', 'medium', 'sessions', 'conversion_pct']];
        d.utm.forEach(function (u) { rows.push([u.campaign, u.source, u.medium, u.sessions, u.conversion]); });
        return rows;
      },
      exportName: csvName('audience', 'utm'),
    });
    utm.body.appendChild(dataTable({
      columns: [
        { key: 'campaign',   label: 'Campaign',   ident: true },
        { key: 'source',     label: 'Source' },
        { key: 'medium',     label: 'Medium' },
        { key: 'sessions',   label: 'Sessions',   num: true, format: fmtInt },
        { key: 'conversion', label: 'Conversion', num: true, format: function (v) { return fmtPct(v, 1); } },
      ],
      rows: d.utm,
    }));
    row3.appendChild(utm.root);
    ctx.content.appendChild(row3);
  }

  /* Sessions tab */
  function audienceSessionsTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'sessions',        label: 'Sessions',       cls: 'an-c3', hint: 'Total sessions' },
      { id: 'duration',        label: 'Avg duration',   cls: 'an-c2', hint: 'Mean session length' },
      { id: 'pagesPerSession', label: 'Pages / session', cls: 'an-c4', hint: 'Mean pages viewed' },
      { id: 'bounceRate',      label: 'Bounce rate',    cls: 'an-c5', hint: 'Single-interaction sessions' },
    ]));

    var row = el('div', 'an-grid');
    var chart = card({
      title: 'Sessions over time',
      span: 8,
      exportRows: function () {
        var rows = [['bucket', 'sessions']];
        d.labels.forEach(function (l, i) { rows.push([l, d.kpis.sessions.series[i]]); });
        return rows;
      },
      exportName: csvName('audience', 'sessions-over-time'),
    });
    chart.body.appendChild(timeSeriesChart({
      labels: d.labels,
      series: [{ name: 'Sessions', values: d.kpis.sessions.series, area: true }],
      formatValue: fmtInt,
      height: 288,
      ariaLabel: 'Sessions over time',
    }));
    row.appendChild(chart.root);

    var win = d.activeWindow;
    var active = card({
      title: 'Active now',
      span: 4,
      foot: 'Concurrent sessions over the last 60 minutes.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['active_sessions', win.now],
          ['peak_last_hour', win.peak],
          ['average_last_hour', Math.round(win.avg)],
          ['low_last_hour', win.low],
          ['previous_hour_average', win.prev],
        ];
      },
      exportName: csvName('audience', 'active-now'),
    });
    active.body.classList.add('an-card-body--col');

    var headline = el('div', 'an-active');
    headline.appendChild(el('div', 'an-active-value', fmtInt(win.now)));
    headline.appendChild(el('div', 'an-active-label', 'Active sessions'));
    var change = deltaPct(win.now, win.prev);
    if (change != null) {
      var flat = Math.abs(change) < 0.05;
      var deltaRow = el('div', 'an-kpi-delta is-' + (flat ? 'flat' : (change > 0 ? 'up' : 'down')));
      deltaRow.appendChild(el('span', 'an-kpi-arrow', flat ? '\u2014' : (change > 0 ? '\u25b2' : '\u25bc')));
      deltaRow.appendChild(el('span', null, Math.abs(change).toFixed(1) + '%'));
      deltaRow.appendChild(el('span', 'an-kpi-delta-note', 'vs previous hour'));
      headline.appendChild(deltaRow);
    }
    active.body.appendChild(headline);

    var stats = el('div', 'an-kv');
    [
      { label: 'Peak, last hour',    value: fmtInt(win.peak) },
      { label: 'Average, last hour', value: fmtInt(Math.round(win.avg)) },
      { label: 'Low, last hour',     value: fmtInt(win.low) },
      { label: 'Previous hour avg',  value: fmtInt(win.prev) },
    ].forEach(function (s) {
      var statRow = el('div', 'an-kv-row');
      statRow.appendChild(el('span', 'an-kv-key', s.label));
      statRow.appendChild(el('span', 'an-kv-val', s.value));
      stats.appendChild(statRow);
    });
    active.body.appendChild(stats);

    row.appendChild(active.root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    row2.appendChild(rankedCard({
      title: 'Session duration', span: 4, items: d.durationBuckets, cls: 'an-c2', unit: 'bucket',
      foot: 'Sessions by time on site.',
      exportName: csvName('audience', 'session-duration'),
    }).root);
    row2.appendChild(rankedCard({
      title: 'Pages per session', span: 4, items: d.pagesBuckets, cls: 'an-c4', unit: 'bucket',
      exportName: csvName('audience', 'pages-per-session'),
    }).root);
    row2.appendChild(rankedCard({
      title: 'Bounce by entry page', span: 4, items: d.bounceByEntry, cls: 'an-c5', unit: 'entry_page',
      foot: 'Share of single-page sessions.',
      format: function (v) { return fmtPct(v, 1); },
      exportName: csvName('audience', 'bounce-by-entry'),
    }).root);
    ctx.content.appendChild(row2);
  }

  /* Devices tab */
  function audienceDevicesTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'sessions',    label: 'Sessions',       cls: 'an-c3', hint: 'Total sessions' },
      { id: 'visitors',    label: 'Unique visitors', cls: 'an-c2', hint: 'Distinct visitors' },
      { id: 'bounceRate',  label: 'Bounce rate',    cls: 'an-c5', hint: 'Single-interaction sessions' },
      { id: 'duration',    label: 'Avg duration',   cls: 'an-c1', hint: 'Mean session length' },
    ]));

    var row = el('div', 'an-grid');
    row.appendChild(donutCard({
      title: 'Device type', span: 4, items: d.devices, unit: 'device',
      exportName: csvName('audience', 'device-type'),
    }).root);
    row.appendChild(donutCard({
      title: 'Operating system', span: 4, items: d.os, unit: 'os',
      exportName: csvName('audience', 'os'),
    }).root);
    row.appendChild(rankedCard({
      title: 'Browser', span: 4, items: d.browsers, cls: 'an-c3', unit: 'browser',
      exportName: csvName('audience', 'browsers'),
    }).root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    row2.appendChild(rankedCard({
      title: 'Screen resolution', span: 4, items: d.screens, cls: 'an-c1', unit: 'resolution',
      exportName: csvName('audience', 'screen-resolution'),
    }).root);
    row2.appendChild(rankedCard({
      title: 'Viewport size', span: 4, items: d.viewports, cls: 'an-c2', unit: 'viewport',
      foot: 'Screen minus browser chrome.',
      exportName: csvName('audience', 'viewport-size'),
    }).root);
    row2.appendChild(rankedCard({
      title: 'Connection type', span: 4, items: d.connection, cls: 'an-c4', unit: 'connection',
      foot: 'From navigator.connection where available.',
      exportName: csvName('audience', 'connection'),
    }).root);
    ctx.content.appendChild(row2);

    var row3 = el('div', 'an-grid');
    row3.appendChild(rankedCard({
      title: 'Language', span: 4, items: d.locales, cls: 'an-c1', unit: 'locale',
      exportName: csvName('audience', 'language'),
    }).root);
    row3.appendChild(rankedCard({
      title: 'Timezone', span: 4, items: d.timezones, cls: 'an-c3', unit: 'timezone',
      exportName: csvName('audience', 'timezone'),
    }).root);
    row3.appendChild(rankedCard({
      title: 'Device memory', span: 4, items: d.memory, cls: 'an-c2', unit: 'memory',
      foot: 'navigator.deviceMemory.',
      exportName: csvName('audience', 'device-memory'),
    }).root);
    ctx.content.appendChild(row3);

    var row4 = el('div', 'an-grid');
    row4.appendChild(rankedCard({
      title: 'CPU cores', span: 4, items: d.cores, cls: 'an-c4', unit: 'cores',
      foot: 'navigator.hardwareConcurrency.',
      exportName: csvName('audience', 'cpu-cores'),
    }).root);
    row4.appendChild(donutCard({
      title: 'Bot vs human', span: 4, items: d.bots, unit: 'class',
      exportName: csvName('audience', 'bot-vs-human'),
    }).root);
    row4.appendChild(rankedCard({
      title: 'Crawlers', span: 4, items: d.crawlers, cls: 'an-c6', unit: 'crawler',
      foot: 'Named bots behind the automated traffic.',
      exportName: csvName('audience', 'crawlers'),
    }).root);
    ctx.content.appendChild(row4);

    var row5 = el('div', 'an-grid');
    var priv = card({
      title: 'Privacy signals',
      span: 12,
      foot: 'Do Not Track and Global Privacy Control are honoured; consent state is recorded before any non-essential measurement.',
      exportRows: function () {
        var rows = [['signal', 'value']];
        rows.push(['do_not_track', d.privacy.dnt]);
        rows.push(['global_privacy_control', d.privacy.gpc]);
        d.privacy.consent.forEach(function (c) { rows.push(['consent:' + c.label, c.value]); });
        return rows;
      },
      exportName: csvName('audience', 'privacy-signals'),
    });
    priv.body.appendChild(miniStrip([
      { label: 'Do Not Track', value: fmtInt(d.privacy.dnt) },
      { label: 'Global Privacy Control', value: fmtInt(d.privacy.gpc) },
      { label: 'Consent granted', value: fmtInt(d.privacy.consent[0].value) },
    ]));
    priv.body.appendChild(rankedRows(d.privacy.consent, { cls: 'an-c2' }));
    row5.appendChild(priv.root);
    ctx.content.appendChild(row5);
  }

  /* Regions tab */
  function audienceRegionsTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'visitors',  label: 'Unique visitors', cls: 'an-c2', hint: 'Distinct visitors' },
      { id: 'sessions',  label: 'Sessions',        cls: 'an-c3', hint: 'Total sessions' },
      { id: 'countries', label: 'Regions seen',    cls: 'an-c4', hint: 'Distinct countries in range' },
      { id: 'bounceRate', label: 'Bounce rate',    cls: 'an-c5', hint: 'Single-interaction sessions' },
    ]));

    var row = el('div', 'an-grid');
    var table = card({
      title: 'Regions',
      span: 8,
      foot: 'Country level only. City precision is deliberately not stored.',
      exportRows: function () {
        var rows = [['region', 'sessions', 'visitors', 'share_pct', 'bounce_pct']];
        d.regionTable.forEach(function (r) { rows.push([r.region, r.sessions, r.visitors, r.share, r.bounce]); });
        return rows;
      },
      exportName: csvName('audience', 'regions'),
    });
    table.body.appendChild(dataTable({
      columns: [
        { key: 'region',   label: 'Region' },
        { key: 'sessions', label: 'Sessions', num: true, format: fmtInt },
        { key: 'visitors', label: 'Visitors', num: true, format: fmtInt },
        { key: 'bounce',   label: 'Bounce',   num: true, format: function (v) { return fmtPct(v, 1); } },
        { key: 'share',    label: 'Share',    num: true, bar: true, format: function (v) { return fmtPct(v, 1); } },
      ],
      rows: d.regionTable,
    }));
    row.appendChild(table.root);
    row.appendChild(donutCard({
      title: 'Region split', span: 4, items: d.regions, unit: 'region',
      exportName: csvName('audience', 'region-split'),
    }).root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    row2.appendChild(rankedCard({
      title: 'Cities', span: 6, items: d.cities, cls: 'an-c1', unit: 'city',
      exportName: csvName('audience', 'cities'),
    }).root);

    var how = card({
      title: 'How this is derived',
      span: 6,
      foot: 'See the Privacy Policy for the full retention schedule.',
      exportRows: function () {
        return [
          ['field', 'treatment'],
          ['ip_address', 'Last octet / last 80 bits zeroed before storage'],
          ['region', 'Coarse country lookup, kept separate from the access log'],
          ['city', 'Aggregated only, never linked to a session'],
          ['retention', 'Access log rows pruned after 14 days'],
        ];
      },
      exportName: csvName('audience', 'geo-method'),
    });
    var notes = [
      'IP addresses are truncated before they are written to disk, so the stored value can never identify a household.',
      'Country is resolved from a separate coarse lookup and stored on its own, never alongside the truncated IP.',
      'City figures are aggregated to the region before they reach this panel.',
      'Access log rows are deleted after 14 days; only the aggregates on this page survive longer.',
    ];
    var list = el('ul', 'an-notes');
    notes.forEach(function (text) { list.appendChild(el('li', null, text)); });
    how.body.appendChild(list);
    row2.appendChild(how.root);
    ctx.content.appendChild(row2);
  }

  /* Auth tab */
  function audienceAuthTab(ctx) {
    var d = ctx.data;
    var a = d.auth;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'logins',           label: 'Logins',       cls: 'an-c2', hint: 'Successful Discord logins' },
      { id: 'loginSuccessRate', label: 'Success rate', cls: 'an-c1', hint: 'Completed of started' },
      { id: 'visitors',         label: 'Unique visitors', cls: 'an-c3', hint: 'Distinct visitors' },
      { id: 'sessions',         label: 'Sessions',     cls: 'an-c4', hint: 'Total sessions' },
    ]));

    var row = el('div', 'an-grid');
    row.appendChild(rankedCard({
      title: 'Login funnel', span: 6, items: a.funnel, cls: 'an-c2', unit: 'stage',
      foot: a.attempts + ' started, ' + a.successes + ' completed.',
      exportName: csvName('audience', 'login-funnel'),
    }).root);
    row.appendChild(donutCard({
      title: 'Login outcome', span: 6, unit: 'outcome',
      items: [
        { label: 'Success',           value: a.successes },
        { label: 'Failed',            value: a.failures },
        { label: 'Abandoned',         value: a.abandoned },
      ],
      foot: a.callbackErrors + ' OAuth callback errors.',
      exportName: csvName('audience', 'login-outcome'),
    }).root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    var chart = card({
      title: 'Logins over time',
      span: 8,
      exportRows: function () {
        var rows = [['bucket', 'logins']];;
        d.labels.forEach(function (l, i) { rows.push([l, a.loginSeries[i]]); });
        return rows;
      },
      exportName: csvName('audience', 'logins-over-time'),
    });
    chart.body.appendChild(timeSeriesChart({
      labels: d.labels,
      series: [{ name: 'Logins', values: a.loginSeries, area: true }],
      formatValue: fmtInt,
      height: 288,
      ariaLabel: 'Logins over time',
    }));
    row2.appendChild(chart.root);
    row2.appendChild(rankedCard({
      title: 'Failure reasons', span: 4, items: a.failureReasons, cls: 'an-c5', unit: 'reason',
      exportName: csvName('audience', 'login-failures'),
    }).root);
    ctx.content.appendChild(row2);

    var row3 = el('div', 'an-grid');
    row3.appendChild(rankedCard({
      title: 'Active users by rank', span: 4, items: a.ranks, cls: 'an-c4', unit: 'rank',
      exportName: csvName('audience', 'active-by-rank'),
    }).root);
    row3.appendChild(donutCard({
      title: 'Logout reasons', span: 4, items: a.logouts, unit: 'reason',
      foot: a.logoutTotal + ' logouts in range.',
      exportName: csvName('audience', 'logout-reasons'),
    }).root);

    var health = card({
      title: 'Session health',
      span: 4,
      foot: 'The idle timeout fires after 3 hours of inactivity.',
      exportRows: function () {
        var rows = [['metric', 'value']];
        a.sessionHealth.forEach(function (s) { rows.push([s.label, s.value]); });
        return rows;
      },
      exportName: csvName('audience', 'session-health'),
    });
    var healthList = el('div', 'an-kv');
    a.sessionHealth.forEach(function (s) {
      var kv = el('div', 'an-kv-row');
      kv.appendChild(el('span', 'an-kv-key', s.label));
      kv.appendChild(el('span', 'an-kv-val', s.value));
      healthList.appendChild(kv);
    });
    health.body.appendChild(healthList);
    row3.appendChild(health.root);
    ctx.content.appendChild(row3);

    var row4 = el('div', 'an-grid');
    var accounts = card({
      title: 'Most active accounts',
      span: 8,
      exportRows: function () {
        var rows = [['account', 'rank', 'logins', 'sessions', 'last_seen']];
        a.activeAccounts.forEach(function (x) { rows.push([x.account, x.rank, x.logins, x.sessions, x.lastSeen]); });
        return rows;
      },
      exportName: csvName('audience', 'active-accounts'),
    });
    accounts.body.appendChild(dataTable({
      columns: [
        { key: 'account',  label: 'Account' },
        { key: 'rank',     label: 'Rank' },
        { key: 'logins',   label: 'Logins',   num: true, format: fmtInt },
        { key: 'sessions', label: 'Sessions', num: true, format: fmtInt },
        { key: 'lastSeen', label: 'Last seen', format: fmtDateTime },
      ],
      rows: a.activeAccounts,
    }));
    row4.appendChild(accounts.root);

    var never = card({
      title: 'Never logged in',
      span: 4,
      foot: 'Guild members who have never completed a Discord login.',
      exportRows: function () {
        return [['metric', 'value'], ['never_logged_in', a.neverLoggedIn.count], ['guild_members', a.neverLoggedIn.total]];
      },
      exportName: csvName('audience', 'never-logged-in'),
    });
    never.body.appendChild(miniStrip([
      { label: 'Never logged in', value: fmtInt(a.neverLoggedIn.count) },
      { label: 'Guild members',   value: fmtInt(a.neverLoggedIn.total) },
      { label: 'Coverage',        value: fmtPct(((a.neverLoggedIn.total - a.neverLoggedIn.count) / a.neverLoggedIn.total) * 100, 1) },
    ]));
    never.body.appendChild(rankedRows([
      { label: 'Has logged in',   value: a.neverLoggedIn.total - a.neverLoggedIn.count },
      { label: 'Never logged in', value: a.neverLoggedIn.count },
    ], { cls: 'an-c6' }));
    row4.appendChild(never.root);
    ctx.content.appendChild(row4);

    var row5 = el('div', 'an-grid');
    var activity = card({
      title: 'Panel activity',
      span: 12,
      foot: a.devLogin === 0
        ? 'Dev-login has never fired - correct for production.'
        : 'Dev-login has fired ' + a.devLogin + ' times - investigate immediately.',
      exportRows: function () {
        var rows = [['action', 'count']];
        a.panelActivity.forEach(function (p) { rows.push([p.label, p.value]); });
        rows.push(['dev_login', a.devLogin]);
        return rows;
      },
      exportName: csvName('audience', 'panel-activity'),
    });
    activity.body.appendChild(rankedRows(a.panelActivity, { cls: 'an-c4' }));
    var devLine = el('div', 'an-card-note');
    devLine.textContent = 'Dev-login usage: ' + a.devLogin + ' (expected 0 in production) - ' +
      (a.devLogin === 0 ? 'OK' : 'ALERT');
    activity.body.appendChild(devLine);
    row5.appendChild(activity.root);
    ctx.content.appendChild(row5);
  }

  A.registerPanel('analytics-audience', { build: buildAudience });

  window.ESIPanel.registerItem({
    section: 'analytics',
    order: 3,
    id: 'analytics-audience',
    type: 'analytics',
    label: 'Audience',
    icon: 'users',
    subtitle: 'Visitors, sessions, devices and logins.',
  });
})();
