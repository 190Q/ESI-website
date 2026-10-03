(function () {
  'use strict';

  var A = window.ESIAnalytics;
  var _state = A.state;
  var writeState = A.writeState;
  var DAY_LABELS = A.DAY_LABELS;
  var METRICS = A.METRICS;
  var el = A.el;
  var fmtInt = A.fmtInt;
  var fmtMs = A.fmtMs;
  var fmtPct = A.fmtPct;
  var deltaPct = A.deltaPct;
  var stamp = A.stamp;
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

  var OVERVIEW_KPI_SPEC = {
    requests:  { format: fmtInt, invert: false },
    visitors:  { format: fmtInt, invert: false },
    activeNow: { format: fmtInt, invert: false },
    logins:    { format: fmtInt, invert: false },
    errorRate: { format: function (v) { return fmtPct(v); },    invert: true  },
    p95:       { format: fmtMs,  invert: true  },
    bannerCtr: { format: function (v) { return fmtPct(v, 1); }, invert: false },
    blocked:   { format: fmtInt, invert: false },
  };

  function loadOverview(range) {
    return fetch('/panel/api/analytics/overview?range=' + encodeURIComponent(range), {
      credentials: 'same-origin',
      cache: 'no-store',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      d.labels = A.bucketLabels(d.buckets, range);
      Object.keys(OVERVIEW_KPI_SPEC).forEach(function (id) {
        var kpi = d.kpis && d.kpis[id];
        if (!kpi) return;
        kpi.format = OVERVIEW_KPI_SPEC[id].format;
        kpi.invert = OVERVIEW_KPI_SPEC[id].invert;
      });
      return d;
    });
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
        { id: 'requests',  label: 'Requests',        cls: 'an-c1', goto: 'analytics-traffic',    tab: 'paths' },
        { id: 'visitors',  label: 'Unique visitors', cls: 'an-c2', goto: 'analytics-audience',   tab: 'visitors' },
        { id: 'activeNow', label: 'Active now',      cls: 'an-c2', goto: 'analytics-audience',   tab: 'sessions' },
        { id: 'logins',    label: 'Logins',          cls: 'an-c3', goto: 'analytics-audience',   tab: 'auth' },
        { id: 'errorRate', label: 'Error rate',      cls: 'an-c5', goto: 'analytics-health',     tab: 'frontend' },
        { id: 'p95',       label: 'p95 latency',     cls: 'an-c3', goto: 'analytics-traffic',    tab: 'latency' },
        { id: 'bannerCtr', label: 'Banner CTR',      cls: 'an-c4', goto: 'analytics-engagement', tab: 'banner' },
        { id: 'blocked',   label: 'Blocked',         cls: 'an-c6', goto: 'analytics-health',     tab: 'security' },
      ].forEach(function (def) {
        var kpi = d.kpis[def.id];
        if (!kpi) return;
        var tile = kpiTile(def.id, kpi, {
          label: def.label, cls: def.cls,
        });
        tile.addEventListener('click', function () {
          if (window.ESIPanel && window.ESIPanel.showPanel) window.ESIPanel.showPanel(def.goto);
          if (def.tab && window.ESIAnalytics && window.ESIAnalytics.selectTab) {
            window.ESIAnalytics.selectTab(def.goto, def.tab);
          }
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

      var regions = card({
        title: 'Regions',
        span: 4,
        foot: 'From the browser timezone, grouped by continent.',
        exportRows: function () {
          var rows = [['region', 'sessions']];
          d.regions.forEach(function (r) { rows.push([r.label, r.value]); });
          return rows;
        },
        exportName: 'esi-analytics_regions_' + _state.range + '_' + stamp() + '.csv',
      });
      if (d.regions.length) {
        regions.body.appendChild(rankedRows(d.regions, { cls: 'an-c2' }));
      } else {
        regions.body.appendChild(el('div', 'an-card-note',
          'No region data in range yet. Region is derived from the browser timezone the beacon reports.'));
      }
      row.appendChild(regions.root);

      var heat = card({
        title: 'Peak hours',
        span: 4,
        foot: 'Requests by weekday and hour, in UTC.',
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

      var topRule = d.security.topRule;
      var sec = card({
        title: 'Security',
        span: 6,
        foot: d.security.byRule.length
          ? 'Top rule: ' + (topRule === 'unspecified' ? 'unrecorded' : topRule) + '.'
          : 'No blocked requests in range.',
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
        d.security.byRule.map(function (r) {
          return { label: r.label === 'unspecified' ? 'Unrecorded' : r.label, value: r.count };
        }),
        { cls: 'an-c6' }
      ));
      row.appendChild(sec.root);

      return row;
    }

    function pollLive() {
      ctx.every(15000, function () {
        var host = content.querySelector('[data-live]');
        if (!host || !host.parentNode) return;
        fetch('/panel/api/analytics/live', { credentials: 'same-origin', cache: 'no-store' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (live) {
            if (!live || !host.parentNode) return;
            renderLive(host, live);
            var spark = host.parentNode.querySelector('.an-spark-fill');
            if (spark && live.series && live.series.length > 1) {
              spark.textContent = '';
              spark.appendChild(sparkline(live.series, 'an-c2'));
            }
          })
          .catch(function () { /* a dropped poll is not worth interrupting for */ });
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
    pollLive();
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
