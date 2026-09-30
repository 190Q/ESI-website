(function () {
  'use strict';

  var A = window.ESIAnalytics;
  var _state = A.state;
  var writeState = A.writeState;
  var USE_DEMO_DATA = A.USE_DEMO_DATA;
  var DAY_LABELS = A.DAY_LABELS;
  var METRICS = A.METRICS;
  var el = A.el;
  var toast = A.toast;
  var fmtInt = A.fmtInt;
  var fmtMs = A.fmtMs;
  var fmtPct = A.fmtPct;
  var deltaPct = A.deltaPct;
  var rng = A.rng;
  var stamp = A.stamp;
  var demoBase = A.demoBase;
  var trendSeries = A.trendSeries;
  var sparkline = A.sparkline;
  var timeSeriesChart = A.timeSeriesChart;
  var rankedRows = A.rankedRows;
  var donut = A.donut;
  var heatmap = A.heatmap;
  var card = A.card;
  var segmented = A.segmented;
  var dataTable = A.dataTable;
  var kpiTile = A.kpiTile;
  var analyticsPanel = A.analyticsPanel;
  var analyticsFoot = A.analyticsFoot;

  function loadOverview(range) {
    if (USE_DEMO_DATA) return Promise.resolve(buildDemo(range));
    return fetch('/panel/api/analytics/overview?range=' + encodeURIComponent(range), {
      credentials: 'same-origin',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function buildDemo(range) {
    var base = demoBase(range);
    var rand = rng(5231 + range.length * 811);
    var labels = base.labels;
    var n = labels.length;
    var traffic = base.traffic;
    var requests = traffic.requests;
    var visitors = traffic.visitors;
    var errors = traffic.errors;
    var p95 = traffic.p95;
    var blocked = traffic.blocked;
    function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
    function avg(a) { return a.length ? sum(a) / a.length : 0; }

    // 7 x 24 grid with a plausible diurnal and weekend shape.
    var heat = [];
    for (var d = 0; d < 7; d++) {
      var row = [];
      for (var h = 0; h < 24; h++) {
        var peak = Math.exp(-Math.pow((h - 19) / 4.2, 2)) + 0.45 * Math.exp(-Math.pow((h - 13) / 3.2, 2));
        var weekend = d >= 5 ? 1.18 : 1;
        row.push(Math.round(peak * weekend * (60 + rand() * 45)));
      }
      heat.push(row);
    }

    var kpis = {
      requests:  { value: sum(requests), prev: Math.round(sum(requests) * 0.87), series: requests, format: fmtInt, invert: false },
      visitors:  { value: 3812, prev: 3311, series: visitors, format: fmtInt, invert: false },
      activeNow: { value: 47, prev: null, series: trendSeries(47, n, 0.3, rand), format: fmtInt, invert: false },
      logins:    { value: 268, prev: 241, series: trendSeries(268, n, 0.3, rand), format: fmtInt, invert: false },
      errorRate: {
        value: (sum(errors) / Math.max(1, sum(requests))) * 100,
        prev: 0.71, series: errors,
        format: function (v) { return fmtPct(v); }, invert: true,
      },
      p95:       { value: avg(p95), prev: 342, series: p95, format: fmtMs, invert: true },
      bannerCtr: { value: 8.4, prev: 6.1, series: trendSeries(8.4, n, 0.25, rand), format: function (v) { return fmtPct(v, 1); }, invert: false },
      blocked:   { value: sum(blocked), prev: Math.round(sum(blocked) * 0.92), series: blocked, format: fmtInt, invert: false },
    };

    return {
      demo: true,
      range: range,
      generatedAt: new Date().toISOString(),
      labels: labels,
      traffic: { requests: requests, visitors: visitors, errors: errors, p95: p95, blocked: blocked },
      kpis: kpis,
      live: { rpm: 41, sessions: 47, epm: 0.6, p95: 288, series: requests.slice(-30) },
      topPaths: [
        { path: '/api/player/190Q',        views: 18422, unique: 1204, avgMs: 142,  status: '200' },
        { path: '/api/guild',              views: 12930, unique: 986,  avgMs: 168,  status: '200' },
        { path: '/',                       views: 9810,  unique: 2741, avgMs: 12,   status: '200' },
        { path: '/api/events/pinned',      views: 7422,  unique: 1893, avgMs: 24,   status: '200' },
        { path: '/js/pinned-banner.js',    views: 6104,  unique: 1802, avgMs: 3,    status: '200' },
        { path: '/api/shop/items',         views: 4310,  unique: 512,  avgMs: 210,  status: '200' },
        { path: '/api/player/UnknownUser', views: 388,   unique: 71,   avgMs: 1210, status: '404' },
        { path: '/wp-login.php',           views: 214,   unique: 9,    avgMs: 2,    status: '403' },
      ],
      sources: [
        { label: 'Direct',   value: 4210 },
        { label: 'Discord',  value: 2840 },
        { label: 'Search',   value: 1120 },
        { label: 'Referral', value: 460  },
      ],
      panels: [
        { label: 'Player',     views: 6420 },
        { label: 'Guild',      views: 4180 },
        { label: 'Events',     views: 2960 },
        { label: 'Shop',       views: 1740 },
        { label: 'Bot',        views: 860  },
        { label: 'Promotions', views: 540  },
        { label: 'Inactivity', views: 410  },
      ],
      pinned: [
        { event: 'Wynnpiece Treasure Hunt', impressions: 3184, clicks: 412, ctr: 12.9, collapses: 688  },
        { event: 'Guild Anniversary Raid',  impressions: 2410, clicks: 188, ctr: 7.8,  collapses: 1210 },
        { event: 'Aspect Hunt Night',       impressions: 1760, clicks: 96,  ctr: 5.5,  collapses: 902  },
        { event: 'Build Contest',           impressions: 980,  clicks: 24,  ctr: 2.4,  collapses: 731  },
      ],
      devices: [
        { label: 'Desktop', value: 5940 },
        { label: 'Mobile',  value: 2180 },
        { label: 'Tablet',  value: 380  },
      ],
      countries: [
        { label: 'Belgium',       value: 2140 },
        { label: 'Netherlands',   value: 1180 },
        { label: 'Germany',       value: 940  },
        { label: 'France',        value: 760  },
        { label: 'United States', value: 690  },
        { label: 'Other',         value: 2790 },
      ],
      peakHours: heat,
      errors: {
        total: sum(errors),
        top: [
          { label: 'Upstream 503 (routes restarting)',  count: 84 },
          { label: 'TypeError in player.js:412',        count: 41 },
          { label: 'Failed fetch /api/guild (timeout)', count: 27 },
          { label: '404 /api/player/UnknownUser',       count: 19 },
        ],
      },
      security: {
        blocked: sum(blocked),
        banned: 37,
        rateLimited: 122,
        topRule: 'Scanner probe',
        byRule: [
          { label: 'Scanner probe',     count: 612 },
          { label: 'WordPress probe',   count: 288 },
          { label: 'Injection payload', count: 141 },
          { label: 'Banned method',     count: 74  },
        ],
      },
    };
  }

  function buildOverview(container) {
    return analyticsPanel({
      container: container,
      label: 'Overview',
      load: loadOverview,
      exportRows: overviewExportRows,
      exportName: function () {
        return 'esi-analytics_overview_' + _state.range + '_' + stamp() + '.csv';
      },
      render: renderOverview,
    });
  }

  function overviewExportRows(d) {
    var rows = [['metric', 'value', 'previous', 'change_pct', 'range', 'generated_at']];
    Object.keys(d.kpis).forEach(function (id) {
      var k = d.kpis[id];
      var delta = k.prev != null ? deltaPct(k.value, k.prev) : null;
      rows.push([
        id,
        Math.round(k.value * 100) / 100,
        k.prev != null ? Math.round(k.prev * 100) / 100 : '',
        delta != null ? delta.toFixed(2) : '',
        d.range,
        d.generatedAt,
      ]);
    });
    return rows;
  }

  function renderOverview(ctx) {
    var content = ctx.content;
    var render = ctx.rerender;

    function renderLive(host, live) {
      host.textContent = '';
      [
        { label: 'Requests / min',  value: fmtInt(live.rpm) },
        { label: 'Active sessions', value: fmtInt(live.sessions) },
        { label: 'Errors / min',    value: live.epm.toFixed(1) },
        { label: 'p95 latency',     value: fmtMs(live.p95) },
      ].forEach(function (d) {
        var item = el('div', 'an-live-item');
        item.appendChild(el('div', 'an-live-value', d.value));
        item.appendChild(el('div', 'an-live-label', d.label));
        host.appendChild(item);
      });
    }

    function buildKpiStrip(d) {
      var strip = el('div', 'an-kpi-strip');
      [
        { id: 'requests',  label: 'Requests',        cls: 'an-c1', goto: 'analytics-traffic' },
        { id: 'visitors',  label: 'Unique visitors', cls: 'an-c2', goto: 'analytics-audience' },
        { id: 'activeNow', label: 'Active now',      cls: 'an-c2', goto: 'analytics-audience' },
        { id: 'logins',    label: 'Logins',          cls: 'an-c3', goto: 'analytics-audience' },
        { id: 'errorRate', label: 'Error rate',      cls: 'an-c5', goto: 'analytics-health' },
        { id: 'p95',       label: 'p95 latency',     cls: 'an-c3', goto: 'analytics-traffic' },
        { id: 'bannerCtr', label: 'Banner CTR',      cls: 'an-c4', goto: 'analytics-engagement' },
        { id: 'blocked',   label: 'Blocked',         cls: 'an-c6', goto: 'analytics-health' },
      ].forEach(function (def) {
        var kpi = d.kpis[def.id];
        if (!kpi) return;
        var tile = kpiTile(def.id, kpi, {
          label: def.label, cls: def.cls, compare: _state.compare,
        });
        tile.addEventListener('click', function () {
          toast('Detailed breakdown lives on the ' + def.goto.replace('analytics-', '') + ' panel', 'info');
        });
        strip.appendChild(tile);
      });
      return strip;
    }

    function buildChartsRow(d) {
      var row = el('div', 'an-grid');
      var metric = METRICS.filter(function (m) { return m.id === _state.metric; })[0] || METRICS[0];

      var picker = segmented(METRICS.map(function (m) {
        return { id: m.id, label: m.label };
      }), metric.id, function (id) {
        _state.metric = id;
        writeState();
        render();
      });
      picker.classList.add('an-seg--sm');

      var traffic = card({
        title: 'Traffic over time',
        span: 8,
        tools: [picker],
        exportRows: function () {
          var rows = [['bucket', metric.label]];
          d.labels.forEach(function (l, i) { rows.push([l, d.traffic[metric.key][i]]); });
          return rows;
        },
        exportName: 'esi-analytics_traffic_' + _state.range + '_' + stamp() + '.csv',
      });
      traffic.body.appendChild(timeSeriesChart({
        labels: d.labels,
        series: [{ name: metric.label, values: d.traffic[metric.key], cls: metric.cls, area: true }],
        formatValue: metric.format,
        height: 288,
        ariaLabel: metric.label + ' over time',
      }));
      row.appendChild(traffic.root);

      var live = card({
        title: 'Live now',
        span: 4,
        foot: 'Updates every 15 seconds.',
        exportRows: function () {
          return [
            ['metric', 'value'],
            ['requests_per_min', d.live.rpm],
            ['active_sessions', d.live.sessions],
            ['errors_per_min', d.live.epm],
            ['p95_latency_ms', d.live.p95],
          ];
        },
        exportName: 'esi-analytics_live_' + stamp() + '.csv',
      });
      live.body.classList.add('an-card-body--col');
      var liveBody = el('div', 'an-live');
      liveBody.dataset.live = '1';
      live.body.appendChild(liveBody);
      renderLive(liveBody, d.live);
      var liveSpark = el('div', 'an-spark-fill');
      liveSpark.appendChild(sparkline(d.live.series, 'an-c2'));
      live.body.appendChild(liveSpark);
      row.appendChild(live.root);

      return row;
    }

    function buildRow3(d) {
      var row = el('div', 'an-grid');
      var totalViews = d.topPaths.reduce(function (s, p) { return s + p.views; }, 0) || 1;

      var pages = card({
        title: 'Top pages',
        span: 8,
        exportRows: function () {
          var rows = [['path', 'views', 'unique_visitors', 'avg_response_ms', 'status']];
          d.topPaths.forEach(function (p) { rows.push([p.path, p.views, p.unique, p.avgMs, p.status]); });
          return rows;
        },
        exportName: 'esi-analytics_top-pages_' + _state.range + '_' + stamp() + '.csv',
      });
      pages.body.appendChild(dataTable({
        columns: [
          { key: 'path',    label: 'Path',   ident: true },
          { key: 'views',   label: 'Views',  num: true, format: fmtInt },
          { key: 'unique',  label: 'Unique', num: true, format: fmtInt },
          { key: 'avgMs',   label: 'Avg',    num: true, format: fmtMs },
          { key: 'share',   label: 'Share',  num: true, bar: true, format: function (v) { return fmtPct(v, 1); } },
        ],
        rows: d.topPaths.map(function (p) {
          return Object.assign({}, p, { share: (p.views / totalViews) * 100 });
        }),
      }));
      row.appendChild(pages.root);

      var sources = card({
        title: 'Traffic sources',
        span: 4,
        exportRows: function () {
          var rows = [['source', 'sessions']];
          d.sources.forEach(function (s) { rows.push([s.label, s.value]); });
          return rows;
        },
        exportName: 'esi-analytics_sources_' + _state.range + '_' + stamp() + '.csv',
      });
      sources.body.appendChild(donut(d.sources));
      row.appendChild(sources.root);

      return row;
    }

    function buildRow4(d) {
      var row = el('div', 'an-grid');

      var pinned = card({
        title: 'Pinned banner',
        span: 8,
        foot: 'Click-through = title clicks \u00f7 impressions.',
        exportRows: function () {
          var rows = [['event', 'impressions', 'clicks', 'ctr_pct', 'collapses']];
          d.pinned.forEach(function (p) { rows.push([p.event, p.impressions, p.clicks, p.ctr, p.collapses]); });
          return rows;
        },
        exportName: 'esi-analytics_pinned-banner_' + _state.range + '_' + stamp() + '.csv',
      });
      pinned.body.appendChild(dataTable({
        columns: [
          { key: 'event',       label: 'Event' },
          { key: 'impressions', label: 'Impressions', num: true, format: fmtInt },
          { key: 'clicks',      label: 'Clicks',      num: true, format: fmtInt },
          { key: 'ctr',         label: 'CTR',         num: true, format: function (v) { return fmtPct(v, 1); } },
          { key: 'collapses',   label: 'Collapses',   num: true, format: fmtInt },
        ],
        rows: d.pinned,
      }));
      row.appendChild(pinned.root);

      var panels = card({
        title: 'Dashboard panels',
        span: 4,
        exportRows: function () {
          var rows = [['panel', 'views']];
          d.panels.forEach(function (p) { rows.push([p.label, p.views]); });
          return rows;
        },
        exportName: 'esi-analytics_panels_' + _state.range + '_' + stamp() + '.csv',
      });
      panels.body.appendChild(rankedRows(
        d.panels.map(function (p) { return { label: p.label, value: p.views }; }),
        { cls: 'an-c4' }
      ));
      row.appendChild(panels.root);

      return row;
    }

    function buildRow5(d) {
      var row = el('div', 'an-grid');

      var devices = card({
        title: 'Devices',
        span: 4,
        exportRows: function () {
          var rows = [['device', 'sessions']];
          d.devices.forEach(function (x) { rows.push([x.label, x.value]); });
          return rows;
        },
        exportName: 'esi-analytics_devices_' + _state.range + '_' + stamp() + '.csv',
      });
      devices.body.appendChild(donut(d.devices));
      row.appendChild(devices.root);

      var countries = card({
        title: 'Regions',
        span: 4,
        foot: 'Country level only, derived from a truncated IP.',
        exportRows: function () {
          var rows = [['region', 'sessions']];
          d.countries.forEach(function (c) { rows.push([c.label, c.value]); });
          return rows;
        },
        exportName: 'esi-analytics_regions_' + _state.range + '_' + stamp() + '.csv',
      });
      countries.body.appendChild(rankedRows(d.countries, { cls: 'an-c2' }));
      row.appendChild(countries.root);

      var heat = card({
        title: 'Peak hours',
        span: 4,
        foot: 'Requests by weekday and hour.',
        exportRows: function () {
          var header = ['weekday'];
          for (var h = 0; h < 24; h++) header.push(h + ':00');
          var rows = [header];
          d.peakHours.forEach(function (r, idx) { rows.push([DAY_LABELS[idx]].concat(r)); });
          return rows;
        },
        exportName: 'esi-analytics_peak-hours_' + _state.range + '_' + stamp() + '.csv',
      });
      heat.body.appendChild(heatmap(d.peakHours));
      row.appendChild(heat.root);

      return row;
    }

    function buildRow6(d) {
      var row = el('div', 'an-grid');

      var errors = card({
        title: 'Errors',
        span: 6,
        foot: fmtInt(d.errors.total) + ' errors in range.',
        exportRows: function () {
          var rows = [['error', 'count']];
          d.errors.top.forEach(function (e) { rows.push([e.label, e.count]); });
          return rows;
        },
        exportName: 'esi-analytics_errors_' + _state.range + '_' + stamp() + '.csv',
      });
      errors.body.appendChild(rankedRows(
        d.errors.top.map(function (e) { return { label: e.label, value: e.count }; }),
        { cls: 'an-c5' }
      ));
      row.appendChild(errors.root);

      var sec = card({
        title: 'Security',
        span: 6,
        foot: 'Top rule: ' + d.security.topRule + '.',
        exportRows: function () {
          var rows = [['metric', 'value']];
          rows.push(['blocked_requests', d.security.blocked]);
          rows.push(['ips_banned', d.security.banned]);
          rows.push(['rate_limited', d.security.rateLimited]);
          d.security.byRule.forEach(function (r) { rows.push(['rule:' + r.label, r.count]); });
          return rows;
        },
        exportName: 'esi-analytics_security_' + _state.range + '_' + stamp() + '.csv',
      });
      var mini = el('div', 'an-mini-strip');
      [
        { label: 'Blocked',      value: fmtInt(d.security.blocked) },
        { label: 'IPs banned',   value: fmtInt(d.security.banned) },
        { label: 'Rate limited', value: fmtInt(d.security.rateLimited) },
      ].forEach(function (s) {
        var item = el('div', 'an-mini');
        item.appendChild(el('div', 'an-mini-value', s.value));
        item.appendChild(el('div', 'an-mini-label', s.label));
        mini.appendChild(item);
      });
      sec.body.appendChild(mini);
      sec.body.appendChild(rankedRows(
        d.security.byRule.map(function (r) { return { label: r.label, value: r.count }; }),
        { cls: 'an-c6' }
      ));
      row.appendChild(sec.root);

      return row;
    }

    // Live mode is a demo affordance: it jitters the "Live now" card so the
    // polling path is exercised before the API exists.
    function startLive(d) {
      ctx.every(15000, function () {
        var host = content.querySelector('[data-live]');
        if (!host) return;
        var r = rng(Date.now() >>> 0);
        d.live.rpm = Math.max(0, Math.round(d.live.rpm + (r() - 0.5) * 14));
        d.live.sessions = Math.max(0, Math.round(d.live.sessions + (r() - 0.5) * 6));
        d.live.epm = Math.max(0, d.live.epm + (r() - 0.5) * 0.6);
        d.live.p95 = Math.max(40, Math.round(d.live.p95 + (r() - 0.5) * 40));
        renderLive(host, d.live);
      });
    }

    var d = ctx.data;
    content.appendChild(buildKpiStrip(d));
    content.appendChild(buildChartsRow(d));
    content.appendChild(buildRow3(d));
    content.appendChild(buildRow4(d));
    content.appendChild(buildRow5(d));
    content.appendChild(buildRow6(d));
    content.appendChild(analyticsFoot(d));
    if (USE_DEMO_DATA) startLive(d);
  }

  A.registerPanel('analytics-overview', { build: buildOverview });

  window.ESIPanel.registerItem({
    section: 'analytics',
    order: 1,
    id: 'analytics-overview',
    type: 'analytics',
    label: 'Overview',
    icon: 'chart',
    subtitle: 'Key figures at a glance.',
  });
})();
