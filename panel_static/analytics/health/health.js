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
  var sumOf = A.sumOf;
  var rng = A.rng;
  var demoBase = A.demoBase;
  var trendSeries = A.trendSeries;
  var USE_DEMO_DATA = A.USE_DEMO_DATA;

  function loadHealth(range) {
    if (USE_DEMO_DATA) return Promise.resolve(buildHealthDemo(range));
    return fetch('/panel/api/analytics/health?range=' + encodeURIComponent(range), {
      credentials: 'same-origin',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function buildHealthDemo(range) {
    var base = demoBase(range);
    var rand = rng(8821 + range.length * 691);
    var labels = base.labels;
    var n = labels.length;

    function series(start, spread, trend) {
      var out = [];
      for (var i = 0; i < n; i++) {
        var t = n > 1 ? i / (n - 1) : 0;
        out.push(Math.max(0, Math.round(start * (1 + trend * t) + (rand() - 0.5) * spread)));
      }
      return out;
    }

    var errorSeries = series(22, 18, -0.15);
    var jsErrors = 412;
    var unhandledRejections = 96;
    var failedRequests = 268;
    var notFoundViews = 386;

    // Client-side JS errors: message, stack location and the build they came from.
    var jsErrorList = [
      { message: "TypeError: Cannot read properties of undefined (reading 'username')", file: 'js/player.js', line: 412, build: '2f8c1a', count: 84 },
      { message: 'Uncaught (in promise) Error: NetworkError when attempting to fetch resource.', file: 'js/app.js', line: 1108, build: '2f8c1a', count: 61 },
      { message: "TypeError: Cannot read properties of null (reading 'classList')", file: 'js/pinned-banner.js', line: 219, build: '9d31e4', count: 42 },
      { message: 'RangeError: Invalid time value', file: 'js/events.js', line: 1335, build: '2f8c1a', count: 28 },
      { message: "SyntaxError: Unexpected token '<'", file: 'js/data-cache.js', line: 74, build: '9d31e4', count: 19 },
      { message: 'TypeError: graphState.data is undefined', file: 'js/guild.js', line: 1431, build: '2f8c1a', count: 12 },
    ];

    var rejectionList = [
      { label: 'Failed to fetch', value: 38 },
      { label: 'AbortError: the user aborted a request', value: 24 },
      { label: 'NetworkError when attempting to fetch resource', value: 19 },
      { label: 'TimeoutError: signal timed out', value: 9 },
      { label: 'TypeError: Failed to parse response', value: 6 },
    ];

    // Failed fetch / XHR calls with status and duration.
    var failedRequestList = [
      { url: '/api/guild',              status: 504, duration: 45000, count: 42 },
      { url: '/api/player/190Q/stats',  status: 504, duration: 31200, count: 31 },
      { url: '/api/shop/items',         status: 503, duration: 12400, count: 26 },
      { url: '/api/events/pinned',      status: 500, duration: 980,  count: 24 },
      { url: '/api/player/UnknownUser', status: 404, duration: 1210, count: 19 },
      { url: '/api/guild/member-history', status: 504, duration: 45000, count: 14 },
      { url: '/auth/session',           status: 503, duration: 8600, count: 11 },
    ];

    var toasts = {
      apiErrors: 214,
      toastsShown: 386,
      top: [
        { label: 'Could not load guild data', value: 62 },
        { label: 'Lookup failed',             value: 48 },
        { label: 'Rate limited, try again',   value: 31 },
        { label: 'Saved to clipboard',        value: 24 },
        { label: 'Signed out',                value: 18 },
      ],
    };

    var notFoundPaths = [
      { label: '/favicon-32.png',            value: 96 },
      { label: '/api/player/UnknownUser',    value: 71 },
      { label: '/images/missing-badge.png',  value: 58 },
      { label: '/js/graph-shared.js.map',    value: 41 },
      { label: '/fonts/Cinzel-Bold.woff2',   value: 34 },
      { label: '/robots.txt',                value: 28 },
    ];

    var brokenAssets = [
      { label: '/images/missing-badge.png',  value: 58 },
      { label: '/favicon-32.png',            value: 41 },
      { label: '/images/old-banner.avif',    value: 26 },
      { label: '/fonts/Monocraft-Bold.ttf',  value: 12 },
    ];

    var gaveUp = [
      { label: 'Player lookup',    value: 24 },
      { label: 'Guild lookup',     value: 18 },
      { label: 'Shop checkout',    value: 11 },
      { label: 'Event load',       value: 6 },
      { label: 'Save preferences', value: 4 },
    ];
    var retries = 268;
    var gaveUpTotal = sumOf(gaveUp.map(function (g) { return g.value; }));

    var skeleton = { median: 420, p95: 1180, slowest: 3400 };

    var builds = [
      { label: '2f8c1a', value: 4820 },
      { label: '9d31e4', value: 1610 },
      { label: '7b02ff', value: 380 },
    ];

    // Per-build comparison so releases can be told apart.
    var errorsByBuild = [
      { build: '2f8c1a', sessions: 4820, jsErrors: 254, failedRequests: 168, errorRate: 5.3 },
      { build: '9d31e4', sessions: 1610, jsErrors: 121, failedRequests: 74, errorRate: 7.5 },
      { build: '7b02ff', sessions: 380, jsErrors: 37, failedRequests: 26, errorRate: 9.7 },
    ];

    var blockedSeries = series(180, 90, 0.1);

    // The gate's named rules.
    var blockedReasons = [
      { label: 'Scanner probe',       value: 612 },
      { label: 'WordPress probe',     value: 288 },
      { label: 'Injection payload',   value: 141 },
      { label: 'Banned method',       value: 74 },
      { label: 'HTTP/1.0 fingerprint', value: 52 },
    ];

    var banTriggers = [
      { label: 'Scanner probe',       value: 14 },
      { label: 'WordPress probe',     value: 11 },
      { label: 'Injection payload',   value: 6 },
      { label: 'Banned method',       value: 4 },
      { label: 'HTTP/1.0 fingerprint', value: 2 },
    ];
    var bansIssued = sumOf(banTriggers.map(function (b) { return b.value; }));

    var strikes = 96;
    var rateLimited = 122;
    var bruteForce = 48;

    var bannedStillHitting = {
      ips: 9,
      requests: 214,
      top: [
        { label: '203.0.113.0', value: 68 },
        { label: '198.51.100.0', value: 41 },
        { label: '192.0.2.0',    value: 26 },
      ],
    };

    var cfSkips = 14;

    var malformed = { total: 68, badRequest: 61, versionNotSupported: 7 };

    var offendingPaths = [
      { label: '/wp-login.php',     value: 288 },
      { label: '/.env',             value: 141 },
      { label: '/phpmyadmin',       value: 96 },
      { label: '/xmlrpc.php',       value: 74 },
      { label: '/.git/config',      value: 52 },
      { label: '/admin.php',        value: 38 },
    ];

    var offendingAgents = [
      { label: 'python-requests/2.31', value: 214 },
      { label: 'curl/8.4.0',           value: 168 },
      { label: 'Go-http-client/1.1',   value: 96 },
      { label: 'Nikto/2.5.0',          value: 62 },
      { label: 'masscan/1.3',          value: 41 },
    ];

    var offendingAsns = [
      { label: 'AS14061 DigitalOcean', value: 214 },
      { label: 'AS16509 Amazon',       value: 148 },
      { label: 'AS24940 Hetzner',      value: 121 },
      { label: 'AS16276 OVH',          value: 86 },
      { label: 'AS9009 M247',          value: 42 },
    ];

    // Z-score against the trailing baseline for each bucket.
    var anomalies = [];
    for (var i = 0; i < n; i++) {
      var baseline = 2400;
      var value = base.traffic.requests[i];
      anomalies.push({
        bucket: labels[i],
        requests: value,
        baseline: baseline,
        z: Math.round(((value - baseline) / 420) * 10) / 10,
      });
    }
    var flagged = anomalies.filter(function (a) { return Math.abs(a.z) >= 2; });

    return {
      demo: true,
      range: range,
      generatedAt: new Date().toISOString(),
      labels: labels,

      kpis: {
        jsErrors:      { value: jsErrors, prev: 468, series: errorSeries, format: fmtInt, invert: true },
        rejections:    { value: unhandledRejections, prev: 112, series: trendSeries(unhandledRejections, n, 0.3, rand), format: fmtInt, invert: true },
        failedRequests: { value: failedRequests, prev: 302, series: trendSeries(failedRequests, n, 0.3, rand), format: fmtInt, invert: true },
        notFoundViews: { value: notFoundViews, prev: 342, series: trendSeries(notFoundViews, n, 0.28, rand), format: fmtInt, invert: true },

        brokenAssets:  { value: sumOf(brokenAssets.map(function (b) { return b.value; })), prev: 164, series: trendSeries(sumOf(brokenAssets.map(function (b) { return b.value; })), n, 0.3, rand), format: fmtInt, invert: true },
        retries:       { value: retries, prev: 302, series: trendSeries(retries, n, 0.25, rand), format: fmtInt, invert: true },
        gaveUp:        { value: gaveUpTotal, prev: 76, series: trendSeries(gaveUpTotal, n, 0.3, rand), format: fmtInt, invert: true },
        skeletonMedian: { value: skeleton.median, prev: 486, series: trendSeries(skeleton.median, n, 0.2, rand), format: fmtMs, invert: true },

        blocked:       { value: sumOf(blockedReasons.map(function (b) { return b.value; })), prev: 986, series: blockedSeries, format: fmtInt, invert: true },
        bansIssued:    { value: bansIssued, prev: 31, series: trendSeries(bansIssued, n, 0.4, rand), format: fmtInt, invert: true },
        rateLimited:   { value: rateLimited, prev: 148, series: trendSeries(rateLimited, n, 0.35, rand), format: fmtInt, invert: true },
        bruteForce:    { value: bruteForce, prev: 39, series: trendSeries(bruteForce, n, 0.45, rand), format: fmtInt, invert: true },
      },

      errorSeries: errorSeries,
      jsErrorList: jsErrorList,
      rejectionList: rejectionList,
      failedRequestList: failedRequestList,
      toasts: toasts,
      notFoundPaths: notFoundPaths,

      brokenAssets: brokenAssets,
      gaveUp: gaveUp,
      retries: retries,
      skeleton: skeleton,
      builds: builds,
      errorsByBuild: errorsByBuild,

      blockedSeries: blockedSeries,
      blockedReasons: blockedReasons,
      banTriggers: banTriggers,
      strikes: strikes,
      bannedStillHitting: bannedStillHitting,
      cfSkips: cfSkips,
      malformed: malformed,
      offendingPaths: offendingPaths,
      offendingAgents: offendingAgents,
      offendingAsns: offendingAsns,
      anomalies: anomalies,
      flaggedAnomalies: flagged,
    };
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
      var f = [['build', 'sessions', 'js_errors', 'failed_requests', 'error_rate_pct']];
      d.errorsByBuild.forEach(function (b) {
        f.push([b.build, b.sessions, b.jsErrors, b.failedRequests, b.errorRate]);
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
    return e;
  }

  function healthErrorsTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'jsErrors',       label: 'JS errors',            cls: 'an-c5', hint: 'Client-side errors thrown' },
      { id: 'rejections',     label: 'Unhandled rejections', cls: 'an-c5', hint: 'Promises that rejected with no handler' },
      { id: 'failedRequests', label: 'Failed requests',      cls: 'an-c6', hint: 'fetch and XHR calls that failed' },
      { id: 'notFoundViews',  label: '404 views',            cls: 'an-c3', hint: 'Not-found pages served' },
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
    ctx.content.appendChild(row4);
  }

  function healthFrontendTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'brokenAssets',   label: 'Broken assets', cls: 'an-c5', hint: 'Images and assets that failed to load' },
      { id: 'retries',        label: 'Retries',       cls: 'an-c6', hint: 'Requests the front end retried' },
      { id: 'gaveUp',         label: 'Gave up',       cls: 'an-c5', hint: 'Times a user stopped after retries failed' },
      { id: 'skeletonMedian', label: 'Skeleton time', cls: 'an-c3', hint: 'Median time a loading skeleton was shown' },
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
    var skeleton = card({
      title: 'Skeleton time',
      span: 6,
      foot: 'How long the loading placeholders stayed on screen.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['median_ms', d.skeleton.median],
          ['p95_ms', d.skeleton.p95],
          ['slowest_ms', d.skeleton.slowest],
        ];
      },
      exportName: csvName('health', 'skeleton-time'),
    });
    skeleton.body.appendChild(miniStrip([
      { label: 'Median',  value: fmtMs(d.skeleton.median) },
      { label: 'p95',     value: fmtMs(d.skeleton.p95) },
      { label: 'Slowest', value: fmtMs(d.skeleton.slowest) },
    ]));
    row2.appendChild(skeleton.root);

    row2.appendChild(rankedCard({
      title: 'Builds in use', span: 6, items: d.builds, cls: 'an-c1', unit: 'build',
      foot: 'Frontend build per session.',
      exportName: csvName('health', 'builds'),
    }).root);
    ctx.content.appendChild(row2);

    var row3 = el('div', 'an-grid');
    var byBuild = card({
      title: 'Errors by build',
      span: 12,
      foot: 'Compare releases: error rate is JS errors plus failed requests over sessions.',
      exportRows: function () {
        var rows = [['build', 'sessions', 'js_errors', 'failed_requests', 'error_rate_pct']];
        d.errorsByBuild.forEach(function (b) {
          rows.push([b.build, b.sessions, b.jsErrors, b.failedRequests, b.errorRate]);
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
        { key: 'errorRate',      label: 'Error rate',      num: true, format: function (v) { return fmtPct(v, 1); } },
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
      title: 'Strikes and rate limits',
      span: 4,
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['strikes_recorded', d.strikes],
          ['rate_limited_429', d.kpis.rateLimited.value],
        ];
      },
      exportName: csvName('health', 'enforcement'),
    });
    enforce.body.appendChild(miniStrip([
      { label: 'Strikes recorded', value: fmtInt(d.strikes) },
      { label: 'Rate limited',     value: fmtInt(d.kpis.rateLimited.value) },
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
      exportName: csvName('health', 'offending-agents'),
    }).root);
    row3.appendChild(rankedCard({
      title: 'Top offending ASNs', span: 4, items: d.offendingAsns, cls: 'an-c4', unit: 'asn',
      exportName: csvName('health', 'offending-asns'),
    }).root);
    ctx.content.appendChild(row3);

    var row4 = el('div', 'an-grid');
    var stillHitting = card({
      title: 'Banned IPs still hitting',
      span: 4,
      foot: 'Addresses already banned that keep sending requests. Addresses are truncated.',
      exportRows: function () {
        var rows = [['metric', 'value']];
        rows.push(['distinct_ips', d.bannedStillHitting.ips]);
        rows.push(['requests', d.bannedStillHitting.requests]);
        d.bannedStillHitting.top.forEach(function (t) { rows.push(['ip:' + t.label, t.value]); });
        return rows;
      },
      exportName: csvName('health', 'banned-still-hitting'),
    });
    stillHitting.body.appendChild(miniStrip([
      { label: 'Distinct IPs', value: fmtInt(d.bannedStillHitting.ips) },
      { label: 'Requests',     value: fmtInt(d.bannedStillHitting.requests) },
    ]));
    stillHitting.body.appendChild(rankedRows(d.bannedStillHitting.top, { cls: 'an-c5' }));
    row4.appendChild(stillHitting.root);

    var cf = card({
      title: 'Cloudflare skips',
      span: 4,
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
      span: 4,
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
      foot: 'Buckets whose request count sits two or more standard deviations from the trailing baseline.',
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
