(function () {
  'use strict';

  var A = window.ESIAnalytics;
  var el = A.el;
  var card = A.card;
  var dataTable = A.dataTable;
  var rankedCard = A.rankedCard;
  var rankedRows = A.rankedRows;
  var miniStrip = A.miniStrip;
  var panelKpiStrip = A.panelKpiStrip;
  var csvName = A.csvName;
  var analyticsPanel = A.analyticsPanel;
  var analyticsFoot = A.analyticsFoot;
  var timeSeriesChart = A.timeSeriesChart;
  var fmtInt = A.fmtInt;
  var fmtPct = A.fmtPct;
  var fmtMs = A.fmtMs;

  var HEALTH_KPI_SPEC = {
    jsErrors:       { format: fmtInt, invert: true },
    rejections:     { format: fmtInt, invert: true },
    failedRequests: { format: fmtInt, invert: true },
    notFoundViews:  { format: fmtInt, invert: true },
    brokenAssets:   { format: fmtInt, invert: true },
    cspViolations:  { format: fmtInt, invert: true },
    retries:        { format: fmtInt, invert: true },
    gaveUp:         { format: fmtInt, invert: true },
    blocked:        { format: fmtInt, invert: true },
    bansIssued:     { format: fmtInt, invert: true },
    rateLimited:    { format: fmtInt, invert: true },
    bruteForce:     { format: fmtInt, invert: true },
  };

  function loadHealth(range) {
    return fetch('/panel/api/analytics/health?range=' + encodeURIComponent(range), {
      credentials: 'same-origin',
      cache: 'no-store',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      d.labels = A.bucketLabels(d.buckets, range);
      Object.keys(HEALTH_KPI_SPEC).forEach(function (id) {
        var kpi = d.kpis && d.kpis[id];
        if (!kpi) return;
        kpi.format = HEALTH_KPI_SPEC[id].format;
        kpi.invert = HEALTH_KPI_SPEC[id].invert;
      });
      return d;
    });
  }

  var HEALTH_TABS = [
    { id: 'errors',   label: 'Errors' },
    { id: 'frontend', label: 'Frontend' },
    { id: 'security', label: 'Security' },
  ];

  function buildHealth(container) {
    return analyticsPanel({
      container: container,
      label: 'Health & Security',

      tabKey: 'health',
      tabs: HEALTH_TABS,
      load: loadHealth,
      exportRows: healthExportRows,
      exportName: function (d, tab) { return csvName('health', tab); },
      render: renderHealth,
    });
  }

  function renderHealth(ctx) {
    if (ctx.tab === 'frontend') healthFrontendTab(ctx);
    else if (ctx.tab === 'security') healthSecurityTab(ctx);
    else healthErrorsTab(ctx);
    ctx.content.appendChild(analyticsFoot(ctx.data));
  }

  function healthExportRows(d, tab) {
    if (tab === 'frontend') {
      var f = [['build', 'sessions', 'js_errors', 'failed_requests', 'errors_per_session']];
      d.errorsByBuild.forEach(function (b) {
        f.push([b.build, b.sessions, b.jsErrors, b.failedRequests, b.perSession]);
      });
      return f;
    }
    if (tab === 'security') {
      var s = [['reason', 'blocked']];
      d.blockedReasons.forEach(function (r) { s.push([r.label, r.value]); });
      return s;
    }
    var e = [['message', 'file', 'line', 'build', 'count']];
    d.jsErrorList.forEach(function (x) { e.push([x.message, x.file, x.line, x.build, x.count]); });
    d.cspList.forEach(function (x) { e.push(['csp: ' + x.label, '', '', '', x.value]); });
    return e;
  }

  function healthErrorsTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'jsErrors',       label: 'JS errors',            cls: 'an-c5', hint: 'Client-side errors thrown' },
      { id: 'rejections',     label: 'Unhandled rejections', cls: 'an-c5', hint: 'Promises that rejected with no handler' },
      { id: 'failedRequests', label: 'Failed requests',      cls: 'an-c6', hint: 'fetch and XHR calls that failed' },
      { id: 'notFoundViews',  label: '404 views',            cls: 'an-c3', hint: 'Not-found pages served' },
      { id: 'cspViolations',  label: 'CSP violations',       cls: 'an-c6', hint: 'Scripts or styles the browser blocked' },
    ]));

    var row = el('div', 'an-grid');
    var chart = card({
      title: 'Errors over time',
      span: 8,
      exportRows: function () {
        var rows = [['bucket', 'js_errors']];
        d.labels.forEach(function (l, i) { rows.push([l, d.errorSeries[i]]); });
        return rows;
      },
      exportName: csvName('health', 'errors-over-time'),
    });
    chart.body.appendChild(timeSeriesChart({
      labels: d.labels,
      series: [{ name: 'JS errors', values: d.errorSeries, area: true }],
      formatValue: fmtInt,
      height: 288,
      ariaLabel: 'JS errors over time',
    }));
    row.appendChild(chart.root);

    var toasts = card({
      title: 'API errors and toasts',
      span: 4,
      foot: 'Errors surfaced to the user and the toasts raised in response.',
      exportRows: function () {
        var rows = [['metric', 'value'], ['api_errors_surfaced', d.toasts.apiErrors], ['toasts_shown', d.toasts.toastsShown]];
        d.toasts.top.forEach(function (t) { rows.push(['toast:' + t.label, t.value]); });
        return rows;
      },
      exportName: csvName('health', 'toasts'),
    });
    toasts.body.appendChild(miniStrip([
      { label: 'API errors', value: fmtInt(d.toasts.apiErrors) },
      { label: 'Toasts shown', value: fmtInt(d.toasts.toastsShown) },
    ]));
    toasts.body.appendChild(rankedRows(d.toasts.top, { cls: 'an-c6' }));
    row.appendChild(toasts.root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    var js = card({
      title: 'Client-side errors',
      span: 12,
      foot: 'Each row is one distinct error, with where it threw and the build it came from.',
      exportRows: function () {
        var rows = [['message', 'file', 'line', 'build', 'count']];
        d.jsErrorList.forEach(function (x) { rows.push([x.message, x.file, x.line, x.build, x.count]); });
        return rows;
      },
      exportName: csvName('health', 'js-errors'),
    });
    js.body.appendChild(dataTable({
      columns: [
        { key: 'message', label: 'Message' },
        { key: 'file',    label: 'File',  ident: true },
        { key: 'line',    label: 'Line',  num: true },
        { key: 'build',   label: 'Build' },
        { key: 'count',   label: 'Count', num: true, format: fmtInt },
      ],
      rows: d.jsErrorList,
    }));
    row2.appendChild(js.root);
    ctx.content.appendChild(row2);

    var row3 = el('div', 'an-grid');
    var failed = card({
      title: 'Failed requests',
      span: 12,
      foot: 'fetch and XHR calls that did not come back with a usable response.',
      exportRows: function () {
        var rows = [['url', 'status', 'duration_ms', 'count']];
        d.failedRequestList.forEach(function (f) { rows.push([f.url, f.status, f.duration, f.count]); });
        return rows;
      },
      exportName: csvName('health', 'failed-requests'),
    });
    failed.body.appendChild(dataTable({
      columns: [
        { key: 'url',      label: 'URL',       ident: true },
        { key: 'status',   label: 'Status' },
        { key: 'duration', label: 'Duration',  num: true, format: fmtMs },
        { key: 'count',    label: 'Count',     num: true, format: fmtInt },
      ],
      rows: d.failedRequestList,
    }));
    row3.appendChild(failed.root);
    ctx.content.appendChild(row3);

    var row4 = el('div', 'an-grid');
    row4.appendChild(rankedCard({
      title: 'Unhandled rejections', span: 6, items: d.rejectionList, cls: 'an-c5', unit: 'reason',
      exportName: csvName('health', 'rejections'),
    }).root);
    row4.appendChild(rankedCard({
      title: '404 paths', span: 6, items: d.notFoundPaths, cls: 'an-c3', unit: 'path',
      foot: 'Paths behind the not-found responses.',
      exportName: csvName('health', '404-paths'),
    }).root);
    row4.appendChild(rankedCard({
      title: 'CSP violations', span: 6, items: d.cspList, cls: 'an-c6', unit: 'directive',
      foot: 'Blocked by Content-Security-Policy. Text after the dash is the start of the blocked script.',
      exportName: csvName('health', 'csp-violations'),
    }).root);
    ctx.content.appendChild(row4);
  }

  function healthFrontendTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'brokenAssets', label: 'Broken assets', cls: 'an-c5', hint: 'Images and assets that failed to load' },
      { id: 'retries',      label: 'Retries',       cls: 'an-c6', hint: 'Failed calls to a URL the browser asked for again' },
      { id: 'gaveUp',       label: 'Gave up',       cls: 'an-c5', hint: 'URLs that failed three times running' },
    ]));

    var row = el('div', 'an-grid');
    row.appendChild(rankedCard({
      title: 'Broken assets', span: 6, items: d.brokenAssets, cls: 'an-c5', unit: 'asset',
      foot: 'Images and assets that failed to load.',
      exportName: csvName('health', 'broken-assets'),
    }).root);
    row.appendChild(rankedCard({
      title: 'Where users gave up', span: 6, items: d.gaveUp, cls: 'an-c5', unit: 'flow',
      foot: 'Flows abandoned after the retries ran out.',
      exportName: csvName('health', 'gave-up'),
    }).root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    row2.appendChild(rankedCard({
      title: 'Builds in use', span: 12, items: d.builds, cls: 'an-c1', unit: 'build',
      foot: 'Frontend build per session, read from the hashed bundle name.',
      exportName: csvName('health', 'builds'),
    }).root);
    ctx.content.appendChild(row2);

    var row3 = el('div', 'an-grid');
    var byBuild = card({
      title: 'Errors by build',
      span: 12,
      foot: 'Compare releases. Errors per session is JS errors plus failed requests, divided by sessions.',
      exportRows: function () {
        var rows = [['build', 'sessions', 'js_errors', 'failed_requests', 'errors_per_session']];
        d.errorsByBuild.forEach(function (b) {
          rows.push([b.build, b.sessions, b.jsErrors, b.failedRequests, b.perSession]);
        });
        return rows;
      },
      exportName: csvName('health', 'errors-by-build'),
    });
    byBuild.body.appendChild(dataTable({
      columns: [
        { key: 'build',          label: 'Build' },
        { key: 'sessions',       label: 'Sessions',        num: true, format: fmtInt },
        { key: 'jsErrors',       label: 'JS errors',       num: true, format: fmtInt },
        { key: 'failedRequests', label: 'Failed requests', num: true, format: fmtInt },
        { key: 'perSession',     label: 'Per session',     num: true, format: function (v) { return Number(v).toFixed(2); } },
      ],
      rows: d.errorsByBuild,
    }));
    row3.appendChild(byBuild.root);
    ctx.content.appendChild(row3);
  }

  function healthSecurityTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'blocked',     label: 'Blocked requests', cls: 'an-c5', hint: 'Requests stopped by the gate' },
      { id: 'bansIssued',  label: 'IPs banned',       cls: 'an-c6', hint: 'Bans issued in range' },
      { id: 'rateLimited', label: 'Rate limited',     cls: 'an-c4', hint: '429 responses' },
      { id: 'bruteForce',  label: 'Brute force',      cls: 'an-c5', hint: 'Repeated failed login attempts' },
    ]));

    var row = el('div', 'an-grid');
    row.appendChild(rankedCard({
      title: 'Blocked by reason', span: 6, items: d.blockedReasons, cls: 'an-c5', unit: 'reason',
      exportName: csvName('health', 'blocked-reasons'),
    }).root);
    row.appendChild(rankedCard({
      title: 'Ban triggers', span: 6, items: d.banTriggers, cls: 'an-c6', unit: 'rule',
      foot: 'Bans issued, by the rule that triggered them.',
      exportName: csvName('health', 'ban-triggers'),
    }).root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    var chart = card({
      title: 'Blocked over time',
      span: 8,
      exportRows: function () {
        var rows = [['bucket', 'blocked']];
        d.labels.forEach(function (l, i) { rows.push([l, d.blockedSeries[i]]); });
        return rows;
      },
      exportName: csvName('health', 'blocked-over-time'),
    });
    chart.body.appendChild(timeSeriesChart({
      labels: d.labels,
      series: [{ name: 'Blocked', values: d.blockedSeries, area: true }],
      formatValue: fmtInt,
      height: 288,
      ariaLabel: 'Blocked requests over time',
    }));
    row2.appendChild(chart.root);

    var enforce = card({
      title: 'Enforcement',
      span: 4,
      foot: 'Strike counts are held in memory only, so they cannot be reported over a range.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['rate_limited_429', d.kpis.rateLimited.value],
          ['ips_banned', d.kpis.bansIssued.value],
        ];
      },
      exportName: csvName('health', 'enforcement'),
    });
    enforce.body.appendChild(miniStrip([
      { label: 'Rate limited', value: fmtInt(d.kpis.rateLimited.value) },
      { label: 'IPs banned',   value: fmtInt(d.kpis.bansIssued.value) },
    ]));
    row2.appendChild(enforce.root);
    ctx.content.appendChild(row2);

    var row3 = el('div', 'an-grid');
    row3.appendChild(rankedCard({
      title: 'Top offending paths', span: 4, items: d.offendingPaths, cls: 'an-c5', unit: 'path',
      exportName: csvName('health', 'offending-paths'),
    }).root);
    row3.appendChild(rankedCard({
      title: 'Top offending user agents', span: 4, items: d.offendingAgents, cls: 'an-c6', unit: 'agent',
      foot: 'Grouped by user-agent class, not the full string.',
      exportName: csvName('health', 'offending-agents'),
    }).root);
    ctx.content.appendChild(row3);

    var row4 = el('div', 'an-grid');
    var cf = card({
      title: 'Cloudflare skips',
      span: 6,
      foot: 'Requests from a Cloudflare edge with no usable CF-Connecting-IP, so the real client could not be resolved.',
      exportRows: function () {
        return [['metric', 'value'], ['cloudflare_skips', d.cfSkips]];
      },
      exportName: csvName('health', 'cloudflare-skips'),
    });
    cf.body.appendChild(miniStrip([
      { label: 'Skips', value: fmtInt(d.cfSkips) },
    ]));
    row4.appendChild(cf.root);

    var malformed = card({
      title: 'Malformed HTTP',
      span: 6,
      foot: 'Rejected at the WSGI layer before the request reached the app.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['total', d.malformed.total],
          ['400_bad_request', d.malformed.badRequest],
          ['505_version_not_supported', d.malformed.versionNotSupported],
        ];
      },
      exportName: csvName('health', 'malformed-http'),
    });
    malformed.body.appendChild(miniStrip([
      { label: '400', value: fmtInt(d.malformed.badRequest) },
      { label: '505', value: fmtInt(d.malformed.versionNotSupported) },
      { label: 'Total', value: fmtInt(d.malformed.total) },
    ]));
    row4.appendChild(malformed.root);
    ctx.content.appendChild(row4);

    var row5 = el('div', 'an-grid');
    var anomalies = card({
      title: 'Traffic anomalies',
      span: 12,
      foot: 'Buckets whose request count sits two or more standard deviations from the mean of the range.',
      exportRows: function () {
        var rows = [['bucket', 'requests', 'baseline', 'z_score']];
        d.anomalies.forEach(function (a) { rows.push([a.bucket, a.requests, a.baseline, a.z]); });
        return rows;
      },
      exportName: csvName('health', 'anomalies'),
    });
    anomalies.body.appendChild(dataTable({
      columns: [
        { key: 'bucket',   label: 'Bucket' },
        { key: 'requests', label: 'Requests', num: true, format: fmtInt },
        { key: 'baseline', label: 'Baseline', num: true, format: fmtInt },
        { key: 'z',        label: 'Z-score',  num: true, format: function (v) { return v.toFixed(1); } },
      ],
      rows: d.flaggedAnomalies.length ? d.flaggedAnomalies : d.anomalies.slice(0, 5),
    }));
    row5.appendChild(anomalies.root);
    ctx.content.appendChild(row5);
  }

  A.registerPanel('analytics-health', { build: buildHealth });

  window.ESIPanel.registerItem({
    section: 'analytics',
    order: 6,
    id: 'analytics-health',
    type: 'analytics',
    label: 'Health & Security',
    icon: 'shield',
    subtitle: 'Errors, performance and abuse controls.',
  });
})();
