(function () {
  'use strict';

  var A = window.ESIAnalytics;
  var _state = A.state;
  var writeState = A.writeState;
  var el = A.el;
  var fmtInt = A.fmtInt;
  var fmtMs = A.fmtMs;
  var fmtBytes = A.fmtBytes;
  var fmtPct = A.fmtPct;
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

  var TRAFFIC_KPI_SPEC = {
    requests:     { format: fmtInt,   invert: false },
    bytes:        { format: fmtBytes, invert: false },
    p50:          { format: fmtMs,    invert: true  },
    p95:          { format: fmtMs,    invert: true  },
    p99:          { format: fmtMs,    invert: true  },
    cacheHitRate: { format: function (v) { return fmtPct(v, 1); }, invert: false },
    notFound:     { format: fmtInt,   invert: true  },
    upstream:     { format: fmtInt,   invert: true  },
  };

  function loadTraffic(range) {
    return fetch('/panel/api/analytics/traffic?range=' + encodeURIComponent(range), {
      credentials: 'same-origin',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      d.labels = A.bucketLabels(d.buckets, range);
      Object.keys(TRAFFIC_KPI_SPEC).forEach(function (id) {
        var kpi = d.kpis && d.kpis[id];
        if (!kpi) return;
        kpi.format = TRAFFIC_KPI_SPEC[id].format;
        kpi.invert = TRAFFIC_KPI_SPEC[id].invert;
      });
      return d;
    });
  }

  var TRAFFIC_TABS = [
    { id: 'paths',     label: 'Paths' },
    { id: 'status',    label: 'Status' },
    { id: 'latency',   label: 'Latency' },
    { id: 'bandwidth', label: 'Bandwidth' },
    { id: 'coverage',  label: 'Coverage' },
  ];

  var LATENCY_METRICS = [
    { id: 'p50', label: 'p50', cls: 'an-c2' },
    { id: 'p95', label: 'p95', cls: 'an-c3' },
    { id: 'p99', label: 'p99', cls: 'an-c5' },
  ];

  function buildTraffic(container) {
    return analyticsPanel({
      container: container,
      label: 'Traffic',
      tabKey: 'traffic',
      tabs: TRAFFIC_TABS,
      load: loadTraffic,
      exportRows: trafficExportRows,
      exportName: function (d, tab) { return csvName('traffic', tab); },
      render: renderTraffic,
    });
  }

  function renderTraffic(ctx) {
    if (ctx.tab === 'status') trafficStatusTab(ctx);
    else if (ctx.tab === 'latency') trafficLatencyTab(ctx);
    else if (ctx.tab === 'bandwidth') trafficBandwidthTab(ctx);
    else if (ctx.tab === 'coverage') trafficCoverageTab(ctx);
    else trafficPathsTab(ctx);
    ctx.content.appendChild(analyticsFoot(ctx.data));
  }

  function trafficExportRows(d, tab) {
    if (tab === 'status') {
      var rows = [['status', 'requests']];
      d.byStatus.forEach(function (s) { rows.push([s.label, s.value]); });
      return rows;
    }
    if (tab === 'latency') {
      var lat = [['path', 'method', 'requests', 'p50_ms', 'p95_ms', 'p99_ms']];
      d.topPaths.forEach(function (p) { lat.push([p.path, p.method, p.requests, p.p50, p.p95, p.p99]); });
      return lat;
    }
    if (tab === 'bandwidth') {
      var bw = [['bucket', 'bytes']];
      d.labels.forEach(function (l, i) { bw.push([l, d.bandwidth[i]]); });
      return bw;
    }
    if (tab === 'coverage') {
      var cov = [['asset', 'requests', 'size_bytes', 'transferred_bytes', 'status']];
      d.assets.forEach(function (a) { cov.push([a.path, a.requests, a.bytes, a.transferred, a.status]); });
      return cov;
    }
    var paths = [['path', 'method', 'requests', 'unique', 'avg_ms', 'p50_ms', 'p95_ms', 'p99_ms', 'resp_bytes', 'status']];
    d.topPaths.forEach(function (p) {
      paths.push([p.path, p.method, p.requests, p.unique, p.avgMs, p.p50, p.p95, p.p99, p.bytes, p.status]);
    });
    return paths;
  }

  /* Paths tab */
  function trafficPathsTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'requests',     label: 'Requests',       cls: 'an-c1', hint: 'Total requests in range' },
      { id: 'p95',          label: 'p95 latency',    cls: 'an-c3', hint: '95th percentile response time' },
      { id: 'cacheHitRate', label: 'Cache hit rate', cls: 'an-c2', hint: 'Served from the cache service' },
      { id: 'notFound',     label: '404s',           cls: 'an-c5', hint: 'Not-found responses' },
    ]));

    var total = d.totals.requests || 1;
    var row = el('div', 'an-grid');

    var paths = card({
      title: 'Requests by path',
      span: 12,
      foot: 'Share is of all requests in range.',
      exportRows: function () {
        var rows = [['path', 'method', 'requests', 'unique', 'avg_ms', 'resp_bytes', 'status']];
        d.topPaths.forEach(function (p) {
          rows.push([p.path, p.method, p.requests, p.unique, p.avgMs, p.bytes, p.status]);
        });
        return rows;
      },
      exportName: csvName('traffic', 'paths'),
    });
    paths.body.appendChild(dataTable({
      columns: [
        { key: 'path',     label: 'Path',      ident: true },
        { key: 'method',   label: 'Method' },
        { key: 'requests', label: 'Requests',  num: true, format: fmtInt },
        { key: 'unique',   label: 'Unique',    num: true, format: fmtInt },
        { key: 'avgMs',    label: 'Avg',       num: true, format: fmtMs },
        { key: 'bytes',    label: 'Resp size', num: true, format: fmtBytes },
        { key: 'share',    label: 'Share',     num: true, bar: true, format: function (v) { return fmtPct(v, 1); } },
      ],
      rows: d.topPaths.map(function (p) {
        return Object.assign({}, p, { share: (p.requests / total) * 100 });
      }),
    }));
    row.appendChild(paths.root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    row2.appendChild(donutCard({
      title: 'Methods', span: 4, items: d.byMethod, unit: 'method',
      exportName: csvName('traffic', 'methods'),
    }).root);
    row2.appendChild(rankedCard({
      title: 'Entry pages', span: 4, items: d.entryPages, cls: 'an-c2', unit: 'page',
      foot: 'Where sessions start.',
      exportName: csvName('traffic', 'entry-pages'),
    }).root);
    row2.appendChild(rankedCard({
      title: 'Exit pages', span: 4, items: d.exitPages, cls: 'an-c4', unit: 'page',
      foot: 'Where sessions end.',
      exportName: csvName('traffic', 'exit-pages'),
    }).root);
    ctx.content.appendChild(row2);
  }

  /* Status tab */
  function trafficStatusTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'requests', label: 'Requests',          cls: 'an-c1', hint: 'Total requests in range' },
      { id: 'notFound', label: '404s',              cls: 'an-c5', hint: 'Not-found responses' },
      { id: 'upstream', label: 'Upstream failures', cls: 'an-c5', hint: '5xx and timeouts from the routes service' },
      { id: 'p99',      label: 'p99 latency',       cls: 'an-c3', hint: '99th percentile response time' },
    ]));

    var row = el('div', 'an-grid');
    row.appendChild(donutCard({
      title: 'Response status', span: 4, items: d.byStatus, unit: 'status',
      exportName: csvName('traffic', 'status'),
    }).root);
    row.appendChild(rankedCard({
      title: 'Not found', span: 4, items: d.notFoundPaths, cls: 'an-c5', unit: 'path',
      foot: 'Paths behind the 404s.',
      exportName: csvName('traffic', 'not-found'),
    }).root);
    row.appendChild(rankedCard({
      title: 'Upstream failures', span: 4, items: d.upstreamFailures, cls: 'an-c6', unit: 'failure',
      foot: 'The routes service on :5001.',
      exportName: csvName('traffic', 'upstream'),
    }).root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    var table = card({
      title: 'Status by path',
      span: 12,
      exportRows: function () {
        var rows = [['path', 'method', 'status', 'requests', 'p99_ms']];
        d.topPaths.forEach(function (p) { rows.push([p.path, p.method, p.status, p.requests, p.p99]); });
        return rows;
      },
      exportName: csvName('traffic', 'status-by-path'),
    });
    table.body.appendChild(dataTable({
      columns: [
        { key: 'path',     label: 'Path',     ident: true },
        { key: 'method',   label: 'Method' },
        { key: 'status',   label: 'Status' },
        { key: 'requests', label: 'Requests', num: true, format: fmtInt },
        { key: 'p99',      label: 'p99',      num: true, format: fmtMs },
      ],
      rows: d.topPaths.slice().sort(function (a, b) { return b.requests - a.requests; }),
    }));
    row2.appendChild(table.root);
    ctx.content.appendChild(row2);
  }

  /* Latency tab */
  function trafficLatencyTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'p50',      label: 'p50 latency', cls: 'an-c2', hint: 'Median response time' },
      { id: 'p95',      label: 'p95 latency', cls: 'an-c3', hint: '95th percentile' },
      { id: 'p99',      label: 'p99 latency', cls: 'an-c5', hint: '99th percentile' },
      { id: 'requests', label: 'Requests',    cls: 'an-c1', hint: 'Total sampled' },
    ]));

    var metric = LATENCY_METRICS.filter(function (m) { return m.id === _state.latencyMetric; })[0] || LATENCY_METRICS[1];
    var row = el('div', 'an-grid');

    var picker = segmented(LATENCY_METRICS.map(function (m) {
      return { id: m.id, label: m.label };
    }), metric.id, function (id) {
      _state.latencyMetric = id;
      writeState();
      ctx.rerender();
    });
    picker.classList.add('an-seg--sm');

    var chart = card({
      title: 'Latency over time',
      span: 8,
      tools: [picker],
      exportRows: function () {
        var rows = [['bucket', 'p50_ms', 'p95_ms', 'p99_ms']];
        d.labels.forEach(function (l, i) {
          rows.push([l, d.latencySeries.p50[i], d.latencySeries.p95[i], d.latencySeries.p99[i]]);
        });
        return rows;
      },
      exportName: csvName('traffic', 'latency'),
    });
    chart.body.appendChild(timeSeriesChart({
      labels: d.labels,
      series: [{ name: metric.label, values: d.latencySeries[metric.id], area: true }],
      formatValue: fmtMs,
      height: 288,
      ariaLabel: metric.label + ' latency over time',
    }));
    row.appendChild(chart.root);

    row.appendChild(rankedCard({
      title: 'Response time distribution', span: 4, items: d.latencyBuckets, cls: 'an-c3', unit: 'bucket',
      foot: 'Share of requests by response time.',
      exportName: csvName('traffic', 'latency-distribution'),
    }).root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    var table = card({
      title: 'Percentiles by endpoint',
      span: 12,
      foot: 'Sorted by p95, slowest first.',
      exportRows: function () {
        var rows = [['path', 'method', 'requests', 'p50_ms', 'p95_ms', 'p99_ms']];
        d.topPaths.forEach(function (p) { rows.push([p.path, p.method, p.requests, p.p50, p.p95, p.p99]); });
        return rows;
      },
      exportName: csvName('traffic', 'latency-by-endpoint'),
    });
    table.body.appendChild(dataTable({
      columns: [
        { key: 'path',     label: 'Path',     ident: true },
        { key: 'method',   label: 'Method' },
        { key: 'requests', label: 'Requests', num: true, format: fmtInt },
        { key: 'p50',      label: 'p50',      num: true, format: fmtMs },
        { key: 'p95',      label: 'p95',      num: true, format: fmtMs },
        { key: 'p99',      label: 'p99',      num: true, format: fmtMs },
      ],
      rows: d.topPaths.slice().sort(function (a, b) { return b.p95 - a.p95; }),
    }));
    row2.appendChild(table.root);
    ctx.content.appendChild(row2);
  }

  /* Bandwidth tab */
  function trafficBandwidthTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'bytes',        label: 'Bytes served',   cls: 'an-c4', hint: 'Total response payload' },
      { id: 'requests',     label: 'Requests',       cls: 'an-c1', hint: 'Total requests' },
      { id: 'cacheHitRate', label: 'Cache hit rate', cls: 'an-c2', hint: 'Served from the cache service' },
      { id: 'p95',          label: 'p95 latency',    cls: 'an-c3', hint: '95th percentile' },
    ]));

    var row = el('div', 'an-grid');
    var chart = card({
      title: 'Bytes served over time',
      span: 8,
      exportRows: function () {
        var rows = [['bucket', 'bytes']];
        d.labels.forEach(function (l, i) { rows.push([l, d.bandwidth[i]]); });
        return rows;
      },
      exportName: csvName('traffic', 'bandwidth-over-time'),
    });
    chart.body.appendChild(timeSeriesChart({
      labels: d.labels,
      series: [{ name: 'Bytes', values: d.bandwidth, area: true }],
      formatValue: fmtBytes,
      height: 288,
      ariaLabel: 'Bytes served over time',
    }));
    row.appendChild(chart.root);
    row.appendChild(donutCard({
      title: 'By asset type', span: 4, items: d.bandwidthByType, unit: 'type',
      exportName: csvName('traffic', 'bandwidth-by-type'),
    }).root);
    ctx.content.appendChild(row);

    var endpointBytes = d.topPaths.map(function (p) {
      return Object.assign({}, p, { total: p.bytes * p.requests });
    }).sort(function (a, b) { return b.total - a.total; });
    var endpointTotal = sumOf(endpointBytes.map(function (p) { return p.total; })) || 1;
    endpointBytes.forEach(function (p) { p.share = (p.total / endpointTotal) * 100; });

    var row2 = el('div', 'an-grid');
    var table = card({
      title: 'Bandwidth by endpoint',
      span: 12,
      exportRows: function () {
        var rows = [['path', 'requests', 'resp_bytes', 'total_bytes']];
        endpointBytes.forEach(function (p) { rows.push([p.path, p.requests, p.bytes, p.total]); });
        return rows;
      },
      exportName: csvName('traffic', 'bandwidth-by-endpoint'),
    });
    table.body.appendChild(dataTable({
      columns: [
        { key: 'path',     label: 'Path',        ident: true },
        { key: 'requests', label: 'Requests',    num: true, format: fmtInt },
        { key: 'bytes',    label: 'Resp size',   num: true, format: fmtBytes },
        { key: 'total',    label: 'Bytes served', num: true, format: fmtBytes },
        { key: 'share',    label: 'Share',       num: true, bar: true, format: function (v) { return fmtPct(v, 1); } },
      ],
      rows: endpointBytes,
    }));
    row2.appendChild(table.root);
    ctx.content.appendChild(row2);
  }

  /* Coverage tab */
  function trafficCoverageTab(ctx) {
    var d = ctx.data;
    var row = el('div', 'an-grid');

    row.appendChild(donutCard({
      title: 'Traffic split', span: 4, items: d.trafficSplit, unit: 'bucket',
      foot: 'Where requests land.',
      exportName: csvName('traffic', 'traffic-split'),
    }).root);

    var cacheCard = card({
      title: 'Cache',
      span: 4,
      foot: 'Served by the cache service on :5002.',
      exportRows: function () {
        return [['metric', 'value'], ['hits', d.cache.hits], ['misses', d.cache.misses], ['hit_rate_pct', d.cache.hitRate.toFixed(2)]];
      },
      exportName: csvName('traffic', 'cache'),
    });
    cacheCard.body.appendChild(miniStrip([
      { label: 'Hits',     value: fmtInt(d.cache.hits) },
      { label: 'Misses',   value: fmtInt(d.cache.misses) },
      { label: 'Hit rate', value: fmtPct(d.cache.hitRate, 1) },
    ]));
    cacheCard.body.appendChild(rankedRows([
      { label: 'Hit',  value: d.cache.hits },
      { label: 'Miss', value: d.cache.misses },
    ], { cls: 'an-c2' }));
    row.appendChild(cacheCard.root);

    var routes = card({
      title: 'Route coverage',
      span: 4,
      foot: 'Registered endpoints that were never called in range.',
      exportRows: function () {
        var rows = [['endpoint', 'area']];
        d.routeCoverage.neverCalled.forEach(function (r) { rows.push([r.path, r.note]); });
        return rows;
      },
      exportName: csvName('traffic', 'route-coverage'),
    });
    routes.body.appendChild(miniStrip([
      { label: 'Registered',   value: fmtInt(d.routeCoverage.total) },
      { label: 'Called',       value: fmtInt(d.routeCoverage.called) },
      { label: 'Never called', value: fmtInt(d.routeCoverage.total - d.routeCoverage.called) },
    ]));
    routes.body.appendChild(el('div', 'an-card-note',
      d.routeCoverage.neverCalled.length + ' endpoints never called - listed below.'));
    row.appendChild(routes.root);

    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    var assets = card({
      title: 'Static assets',
      span: 8,
      foot: 'Transferred is after caching; a hit still costs the request.',
      exportRows: function () {
        var rows = [['asset', 'requests', 'size_bytes', 'transferred_bytes', 'cached', 'status']];
        d.assets.forEach(function (a) {
          rows.push([a.path, a.requests, a.bytes, a.transferred, a.cached ? 'yes' : 'no', a.status]);
        });
        return rows;
      },
      exportName: csvName('traffic', 'assets'),
    });
    assets.body.appendChild(dataTable({
      columns: [
        { key: 'path',        label: 'Asset',       ident: true },
        { key: 'requests',    label: 'Requests',    num: true, format: fmtInt },
        { key: 'bytes',       label: 'Size',        num: true, format: fmtBytes },
        { key: 'transferred', label: 'Transferred', num: true, format: fmtBytes },
        { key: 'cached',      label: 'Cached',      format: function (v) { return v ? 'Yes' : 'No'; } },
        { key: 'status',      label: 'Status' },
      ],
      rows: d.assets,
    }));
    row2.appendChild(assets.root);
    row2.appendChild(rankedCard({
      title: 'Asset 404s', span: 4, items: d.asset404, cls: 'an-c5', unit: 'asset',
      foot: 'Assets the front end asks for but does not get.',
      exportName: csvName('traffic', 'asset-404s'),
    }).root);
    ctx.content.appendChild(row2);

    var row3 = el('div', 'an-grid');
    var never = card({
      title: 'Never called',
      span: 12,
      foot: 'Dead endpoints, or ones only reachable from a path nobody uses.',
      exportRows: function () {
        var rows = [['endpoint', 'area']];
        d.routeCoverage.neverCalled.forEach(function (r) { rows.push([r.path, r.note]); });
        return rows;
      },
      exportName: csvName('traffic', 'never-called'),
    });
    never.body.appendChild(dataTable({
      columns: [
        { key: 'path', label: 'Endpoint', ident: true },
        { key: 'note', label: 'Area' },
      ],
      rows: d.routeCoverage.neverCalled,
    }));
    row3.appendChild(never.root);
    ctx.content.appendChild(row3);
  }

  A.registerPanel('analytics-traffic', { build: buildTraffic });

  window.ESIPanel.registerItem({
    section: 'analytics',
    order: 2,
    id: 'analytics-traffic',
    type: 'analytics',
    label: 'Traffic',
    icon: 'activity',
    subtitle: 'Requests, status codes, latency and bandwidth.',
  });
})();
