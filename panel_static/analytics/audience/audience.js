(function () {
  'use strict';

  var A = window.ESIAnalytics;
  var _state = A.state;
  var writeState = A.writeState;
  var el = A.el;
  var fmtInt = A.fmtInt;
  var fmtDuration = A.fmtDuration;
  var fmtPct = A.fmtPct;
  var fmtDateTime = A.fmtDateTime;
  var deltaPct = A.deltaPct;
  var sumOf = A.sumOf;
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

  var AUDIENCE_KPI_SPEC = {
    visitors:      { format: fmtInt, invert: false },
    newVisitors:   { format: fmtInt, invert: false },
    returning:     { format: fmtInt, invert: false },
    sessions:      { format: fmtInt, invert: false },
    duration:      { format: fmtDuration, invert: false },
    pagesPerSession: { format: function (v) { return v == null ? '\u2014' : v.toFixed(2); }, invert: false },
    bounceRate:    { format: function (v) { return fmtPct(v, 1); }, invert: true },
    logins:        { format: fmtInt, invert: false },
    loginSuccessRate: { format: function (v) { return fmtPct(v, 1); }, invert: false },
    countries:     { format: fmtInt, invert: false },
  };

  function loadAudience(range) {
    return fetch('/panel/api/analytics/audience?range=' + encodeURIComponent(range), {
      credentials: 'same-origin',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      d.labels = A.bucketLabels(d.buckets, range);
      Object.keys(AUDIENCE_KPI_SPEC).forEach(function (id) {
        var kpi = d.kpis && d.kpis[id];
        if (!kpi) return;
        kpi.format = AUDIENCE_KPI_SPEC[id].format;
        kpi.invert = AUDIENCE_KPI_SPEC[id].invert;
      });
      return d;
    });
  }

  // Tiny inline sparkline. Non-uniform scaling is fine at this size.

  var AUDIENCE_TABS = [
    { id: 'visitors', label: 'Visitors' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'devices',  label: 'Devices' },
    { id: 'regions',  label: 'Regions' },
    { id: 'auth',     label: 'Auth' },
    { id: 'accounts', label: 'Accounts' },
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
    else if (ctx.tab === 'accounts') audienceAccountsTab(ctx);
    else audienceVisitorsTab(ctx);
    ctx.content.appendChild(analyticsFoot(ctx.data));
  }

  function audienceExportRows(d, tab) {
    if (tab === 'accounts') {
      var acc = [['account', 'rank', 'logins', 'logouts', 'sessions', 'events',
                  'panel_views', 'active_seconds', 'first_seen', 'last_seen']];
      d.accounts.list.forEach(function (a) {
        acc.push([a.account, a.rank, a.logins, a.logouts, a.sessions, a.events,
                  a.panelViews, a.activeSeconds, a.firstSeen || '', a.lastSeen || '']);
      });
      return acc;
    }
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
      foot: 'Campaign tagging on links posted to Discord. Arrivals counts landing page views carrying that campaign.',
      exportRows: function () {
        var rows = [['campaign', 'source', 'medium', 'arrivals']];
        d.utm.forEach(function (u) { rows.push([u.campaign, u.source, u.medium, u.arrivals]); });
        return rows;
      },
      exportName: csvName('audience', 'utm'),
    });
    utm.body.appendChild(dataTable({
      columns: [
        { key: 'campaign', label: 'Campaign', ident: true },
        { key: 'source',   label: 'Source' },
        { key: 'medium',   label: 'Medium' },
        { key: 'arrivals', label: 'Arrivals', num: true, format: fmtInt },
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
      foot: 'From navigator.connection. \u201cUnknown\u201d means the browser does not expose it.',
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
      foot: 'Read from the request headers, so nothing has to be collected from the visitors who set them.',
      exportRows: function () {
        return [
          ['signal', 'value'],
          ['do_not_track', d.privacy.dnt],
          ['global_privacy_control', d.privacy.gpc],
        ];
      },
      exportName: csvName('audience', 'privacy-signals'),
    });
    priv.body.appendChild(miniStrip([
      { label: 'Do Not Track', value: fmtInt(d.privacy.dnt) },
      { label: 'Global Privacy Control', value: fmtInt(d.privacy.gpc) },
    ]));
    priv.body.appendChild(el('div', 'an-card-note',
      'Do Not Track is honoured by not measuring at all, so those visitors appear only in this server-side count. ' +
      'The site has no consent prompt, so there is no granted or declined state to report.'));
    row5.appendChild(priv.root);
    ctx.content.appendChild(row5);
  }

  /* Regions tab */
  function audienceRegionsTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'visitors',  label: 'Unique visitors', cls: 'an-c2', hint: 'Distinct visitors' },
      { id: 'sessions',  label: 'Sessions',        cls: 'an-c3', hint: 'Total sessions' },
      { id: 'countries', label: 'Regions seen',    cls: 'an-c4', hint: 'Distinct regions in range' },
      { id: 'bounceRate', label: 'Bounce rate',    cls: 'an-c5', hint: 'Single-interaction sessions' },
    ]));

    var row = el('div', 'an-grid');
    var table = card({
      title: 'Regions',
      span: 8,
      foot: 'Continent level, derived from the browser timezone.',
      exportRows: function () {
        var rows = [['region', 'sessions', 'visitors', 'share_pct', 'bounce_pct']];
        d.regionTable.forEach(function (r) { rows.push([r.region, r.sessions, r.visitors, r.share, r.bounce]); });
        return rows;
      },
      exportName: csvName('audience', 'regions'),
    });
    if (d.regionTable.length) {
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
    } else {
      table.body.appendChild(el('div', 'an-card-note',
        'No region data in range yet. Region is derived from the browser timezone the beacon reports, grouped by continent.'));
    }
    row.appendChild(table.root);
    row.appendChild(donutCard({
      title: 'Region split', span: 4, items: d.regions, unit: 'region',
      exportName: csvName('audience', 'region-split'),
    }).root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');

    var how = card({
      title: 'How this is derived',
      span: 12,
      foot: 'See the Privacy Policy for the full retention schedule.',
      exportRows: function () {
        return [
          ['field', 'treatment'],
          ['ip_address', 'Never stored. Only a salted hash whose salt rotates daily'],
          ['region', "Continent part of the browser's IANA timezone, from the beacon"],
          ['city', 'Not collected'],
          ['retention', 'Raw request rows pruned after 30 days'],
        ];
      },
      exportName: csvName('audience', 'geo-method'),
    });
    var notes = [
      'The IP address is never written to disk. Uniqueness is measured with a salted hash whose salt rotates at midnight, so a visitor cannot be followed across days.',
      "Region is the continent part of the browser's IANA timezone reported by the beacon (Europe/Brussels becomes Europe). It is a coarse proxy for where someone is, and it needs no IP lookup at all.",
      'City is not collected at all, so there is no city breakdown on this page.',
      'Raw request rows are pruned after 30 days. Only the aggregates on this page survive longer.',
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
      foot: 'Session length measured from the request log.',
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

    var acc = d.accounts;
    var row4 = el('div', 'an-grid');
    var accounts = card({
      title: 'Most active accounts',
      span: 8,
      foot: 'From the site user store, ranked by activity in range.',
      exportRows: function () {
        var rows = [['account', 'rank', 'logins', 'sessions', 'last_seen']];
        acc.list.slice(0, 8).forEach(function (x) {
          rows.push([x.account, x.rank, x.logins, x.sessions, x.lastSeen || '']);
        });
        return rows;
      },
      exportName: csvName('audience', 'active-accounts'),
    });
    accounts.body.appendChild(dataTable({
      columns: [
        { key: 'account',  label: 'Account' },
        { key: 'rank',     label: 'Guild rank' },
        { key: 'logins',   label: 'Logins',   num: true, format: fmtInt },
        { key: 'sessions', label: 'Sessions', num: true, format: fmtInt },
        { key: 'lastSeen', label: 'Last active', format: function (v) { return v ? fmtDateTime(v) : '\u2014'; } },
      ],
      rows: acc.list.slice(0, 8),
    }));
    row4.appendChild(accounts.root);

    var never = card({
      title: 'Never logged in',
      span: 4,
      foot: 'Guild members with no row in the site user store.',
      exportRows: function () {
        return [['metric', 'value'], ['never_logged_in', acc.members.never], ['guild_members', acc.members.total]];
      },
      exportName: csvName('audience', 'never-logged-in'),
    });
    if (!acc.members.available) {
      never.body.appendChild(el('div', 'an-card-note',
        'Unavailable: the Discord bot token or guild is not configured, so the member list cannot be read.'));
    } else {
      never.body.appendChild(miniStrip([
        { label: 'Never logged in', value: fmtInt(acc.members.never) },
        { label: 'Guild members',   value: fmtInt(acc.members.total) },
        { label: 'Logged in',       value: fmtInt(acc.members.loggedIn) },
      ]));
      never.body.appendChild(rankedRows([
        { label: 'Has logged in',   value: acc.members.loggedIn },
        { label: 'Never logged in', value: acc.members.never },
      ], { cls: 'an-c6' }));
    }
    row4.appendChild(never.root);
    ctx.content.appendChild(row4);

    var row5 = el('div', 'an-grid');
    var activity = card({
      title: 'Panel activity',
      span: 12,
      foot: a.devLogin === 0
        ? 'No /auth/dev-login requests in range.'
        : 'Dev-login has fired ' + a.devLogin + ' times in range.',
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
    devLine.textContent = 'Dev-login usage: ' + a.devLogin + ' in range - ' +
      (a.devLogin === 0 ? 'none' : 'ALERT');
    activity.body.appendChild(devLine);
    row5.appendChild(activity.root);
    ctx.content.appendChild(row5);
  }

  /* Accounts tab - everyone who has ever logged in, with range activity. */
  function audienceAccountsTab(ctx) {
    var acc = ctx.data.accounts;

    var summary = card({
      title: 'Accounts',
      span: 12,
      foot: 'Every account in the site user store, with activity in the selected range.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['total_accounts', acc.total],
          ['active_in_range', acc.activeInRange],
          ['with_activity', acc.withActivity],
          ['logged_in_now', acc.loggedInNow],
          ['linked_to_minecraft', acc.linked],
          ['restricted', acc.restricted],
          ['logins_in_range', acc.totalLogins],
        ];
      },
      exportName: csvName('audience', 'accounts-summary'),
    });
    summary.body.appendChild(miniStrip([
      { label: 'Total accounts',  value: fmtInt(acc.total) },
      { label: 'Active in range', value: fmtInt(acc.activeInRange) },
      { label: 'Logged in now',   value: fmtInt(acc.loggedInNow) },
      { label: 'Linked',          value: fmtInt(acc.linked) },
      { label: 'Restricted',      value: fmtInt(acc.restricted) },
    ]));
    var summaryRow = el('div', 'an-grid');
    summaryRow.appendChild(summary.root);
    ctx.content.appendChild(summaryRow);

    var row = el('div', 'an-grid');
    row.appendChild(rankedCard({
      title: 'Most active', span: 6,
      items: acc.list.slice(0, 8).map(function (a) {
        return { label: a.account, value: a.events + a.logins };
      }),
      cls: 'an-c1', unit: 'actions',
      foot: 'Events and logins in range.',
      exportName: csvName('audience', 'most-active-accounts'),
    }).root);
    var least = acc.list.slice().sort(function (a, b) {
      return (a.events + a.logins) - (b.events + b.logins);
    });
    row.appendChild(rankedCard({
      title: 'Least active', span: 6,
      items: least.slice(0, 8).reverse().map(function (a) {
        return { label: a.account, value: a.events + a.logins };
      }),
      cls: 'an-c6', unit: 'actions',
      foot: 'Accounts with the fewest actions in range.',
      exportName: csvName('audience', 'least-active-accounts'),
    }).root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    var table = card({
      title: 'All accounts, ranked by activity',
      span: 12,
      foot: 'Ranked by events and logins in range. Names prefer the linked Minecraft username. Logins come from the site sign-in hook.',
      exportRows: function () {
        var rows = [['pos', 'account', 'discord', 'guild_rank', 'linked', 'tokens',
                     'logins', 'events', 'sessions', 'panel_views', 'active_seconds',
                     'last_seen']];
        acc.list.forEach(function (a) {
          rows.push([a.pos, a.account, a.discord, a.rank, a.linked ? 'yes' : 'no',
                     a.tokens, a.logins, a.events, a.sessions, a.panelViews,
                     a.activeSeconds, a.lastSeen || '']);
        });
        return rows;
      },
      exportName: csvName('audience', 'accounts'),
    });
    if (acc.list.length) {
      table.body.appendChild(dataTable({
        tableClass: 'an-table--wrap',
        columns: [
          { key: 'pos',           label: '#',           num: true },
          { key: 'account',       label: 'Account' },
          { key: 'discord',       label: 'Discord' },
          { key: 'rank',          label: 'Guild rank' },
          { key: 'tokens',        label: 'Tokens',      num: true, format: fmtInt },
          { key: 'logins',        label: 'Logins',      num: true, format: fmtInt },
          { key: 'events',        label: 'Events',      num: true, format: fmtInt },
          { key: 'sessions',      label: 'Sessions',    num: true, format: fmtInt },
          { key: 'panelViews',    label: 'Panel views', num: true, format: fmtInt },
          { key: 'activeSeconds', label: 'Active time', num: true, format: fmtDuration },
          { key: 'lastSeen',      label: 'Last active', format: function (v) { return v ? fmtDateTime(v) : '\u2014'; } },
        ],
        rows: acc.list,
      }));
    } else {
      table.body.appendChild(el('div', 'an-card-note',
        'No accounts yet. The list is built from the site user store, so it fills in as people log in.'));
    }
    row2.appendChild(table.root);
    ctx.content.appendChild(row2);
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
