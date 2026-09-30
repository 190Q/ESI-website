(function () {
  'use strict';

  var A = window.ESIAnalytics;
  var el = A.el;
  var card = A.card;
  var dataTable = A.dataTable;
  var rankedCard = A.rankedCard;
  var rankedRows = A.rankedRows;
  var panelKpiStrip = A.panelKpiStrip;
  var csvName = A.csvName;
  var analyticsPanel = A.analyticsPanel;
  var analyticsFoot = A.analyticsFoot;
  var timeSeriesChart = A.timeSeriesChart;
  var fmtInt = A.fmtInt;
  var fmtPct = A.fmtPct;
  var rng = A.rng;
  var demoBase = A.demoBase;
  var trendSeries = A.trendSeries;
  var USE_DEMO_DATA = A.USE_DEMO_DATA;

  function loadData(range) {
    if (USE_DEMO_DATA) return Promise.resolve(buildDataDemo(range));
    return fetch('/panel/api/analytics/rollups?range=' + encodeURIComponent(range), {
      credentials: 'same-origin',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function buildDataDemo(range) {
    var base = demoBase(range);
    var rand = rng(4073 + range.length * 887);
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

    var activeSeries = series(1240, 380, 0.15);
    var dau = 1240;
    var wau = 3820;
    var mau = 9420;

    // Busiest hours, for scheduling events and maintenance.
    var peakHours = [
      { label: '19:00', value: 412 },
      { label: '20:00', value: 386 },
      { label: '18:00', value: 341 },
      { label: '21:00', value: 296 },
      { label: '13:00', value: 248 },
      { label: '12:00', value: 214 },
    ];

    var mostUsed = [
      { label: 'Player panel',  value: 6420 },
      { label: 'Guild panel',   value: 4180 },
      { label: 'Events panel',  value: 2960 },
      { label: 'Player lookup', value: 2840 },
      { label: 'Shop panel',    value: 1740 },
      { label: 'Pinned banner', value: 1280 },
    ];

    var leastUsed = [
      { label: 'WynnPiece page',   value: 62 },
      { label: 'Guild info',       value: 86 },
      { label: 'Creator studio',   value: 124 },
      { label: 'Events manage',    value: 186 },
      { label: 'Inactivity panel', value: 214 },
      { label: 'Shop admin',       value: 268 },
    ];

    var retention = { day1: 42.6, day7: 24.1, day30: 11.8 };

    var cohorts = [
      { cohort: '1 Sep',  users: 412, day1: 44.2, day7: 26.1, day30: 12.4 },
      { cohort: '8 Sep',  users: 386, day1: 43.1, day7: 24.8, day30: 11.6 },
      { cohort: '15 Sep', users: 441, day1: 45.6, day7: 27.3, day30: 13.1 },
      { cohort: '22 Sep', users: 468, day1: 46.8, day7: 28.4, day30: 0 },
      { cohort: '29 Sep', users: 392, day1: 47.4, day7: 0,    day30: 0 },
    ];

    // Of the sessions that logged in, how many opened each panel.
    var adoption = [
      { panel: 'Player',     sessions: 6819, adopted: 5480, rate: 80.4 },
      { panel: 'Guild',      sessions: 6819, adopted: 4180, rate: 61.3 },
      { panel: 'Events',     sessions: 6819, adopted: 2960, rate: 43.4 },
      { panel: 'Shop',       sessions: 6819, adopted: 1740, rate: 25.5 },
      { panel: 'Bot',        sessions: 6819, adopted: 860,  rate: 12.6 },
      { panel: 'Promotions', sessions: 6819, adopted: 540,  rate: 7.9 },
      { panel: 'Inactivity', sessions: 6819, adopted: 410,  rate: 6.0 },
    ];

    // Visit -> login -> panel -> action.
    var conversion = [
      { step: 'Visit',         value: 12480 },
      { step: 'Login',         value: 2860 },
      { step: 'Open a panel',  value: 2410 },
      { step: 'Take an action', value: 1180 },
    ];
    var conversionRates = [];
    for (var c = 1; c < conversion.length; c++) {
      conversionRates.push({
        step: conversion[c - 1].step + ' \u2192 ' + conversion[c].step,
        rate: (conversion[c].value / conversion[c - 1].value) * 100,
      });
    }

    return {
      demo: true,
      range: range,
      generatedAt: new Date().toISOString(),
      labels: labels,

      kpis: {
        dau: { value: dau, prev: 1112, series: activeSeries, format: fmtInt, invert: false },
        wau: { value: wau, prev: 3480, series: trendSeries(wau, n, 0.16, rand), format: fmtInt, invert: false },
        mau: { value: mau, prev: 8720, series: trendSeries(mau, n, 0.1, rand), format: fmtInt, invert: false },

        day1:  { value: retention.day1,  prev: 40.8, series: trendSeries(retention.day1, n, 0.1, rand),  format: function (v) { return fmtPct(v, 1); }, invert: false },
        day7:  { value: retention.day7,  prev: 22.4, series: trendSeries(retention.day7, n, 0.14, rand), format: function (v) { return fmtPct(v, 1); }, invert: false },
        day30: { value: retention.day30, prev: 10.2, series: trendSeries(retention.day30, n, 0.18, rand), format: function (v) { return fmtPct(v, 1); }, invert: false },
      },

      activeSeries: activeSeries,
      peakHours: peakHours,
      mostUsed: mostUsed,
      leastUsed: leastUsed,
      retention: retention,
      cohorts: cohorts,
      adoption: adoption,
      conversion: conversion,
      conversionRates: conversionRates,
    };
  }

  var DATA_TABS = [
    { id: 'activity',  label: 'Activity' },
    { id: 'retention', label: 'Retention & funnels' },
  ];

  function buildData(container) {
    return analyticsPanel({
      container: container,
      label: 'Data',
      tabKey: 'data',
      tabs: DATA_TABS,
      load: loadData,
      exportRows: dataExportRows,
      exportName: function (d, tab) { return csvName('data', tab); },
      render: renderData,
    });
  }

  function renderData(ctx) {
    if (ctx.tab === 'retention') dataRetentionTab(ctx);
    else dataActivityTab(ctx);
    ctx.content.appendChild(analyticsFoot(ctx.data));
  }

  function dataExportRows(d, tab) {
    if (tab === 'retention') {
      var c = [['cohort', 'users', 'day_1_pct', 'day_7_pct', 'day_30_pct']];
      d.cohorts.forEach(function (x) { c.push([x.cohort, x.users, x.day1, x.day7, x.day30]); });
      return c;
    }
    var a = [['bucket', 'daily_active_users']];
    d.labels.forEach(function (l, i) { a.push([l, d.activeSeries[i]]); });
    return a;
  }

  /* Activity tab */
  function dataActivityTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'dau', label: 'Daily active users',   cls: 'an-c1', hint: 'Distinct users active in a day' },
      { id: 'wau', label: 'Weekly active users',  cls: 'an-c2', hint: 'Distinct users active in a week' },
      { id: 'mau', label: 'Monthly active users', cls: 'an-c4', hint: 'Distinct users active in a month' },
    ]));

    var row = el('div', 'an-grid');
    var chart = card({
      title: 'Active users over time',
      span: 8,
      exportRows: function () {
        var rows = [['bucket', 'daily_active_users']];
        d.labels.forEach(function (l, i) { rows.push([l, d.activeSeries[i]]); });
        return rows;
      },
      exportName: csvName('data', 'active-users'),
    });
    chart.body.appendChild(timeSeriesChart({
      labels: d.labels,
      series: [{ name: 'Daily active users', values: d.activeSeries, area: true }],
      formatValue: fmtInt,
      height: 288,
      ariaLabel: 'Daily active users over time',
    }));
    row.appendChild(chart.root);

    row.appendChild(rankedCard({
      title: 'Peak usage hours', span: 4, items: d.peakHours, cls: 'an-c2', unit: 'hour',
      foot: 'Busiest hours, for scheduling events and maintenance.',
      exportName: csvName('data', 'peak-hours'),
    }).root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    row2.appendChild(rankedCard({
      title: 'Most used features', span: 6, items: d.mostUsed, cls: 'an-c1', unit: 'feature',
      exportName: csvName('data', 'most-used'),
    }).root);
    row2.appendChild(rankedCard({
      title: 'Least used features', span: 6, items: d.leastUsed, cls: 'an-c5', unit: 'feature',
      exportName: csvName('data', 'least-used'),
    }).root);
    ctx.content.appendChild(row2);
  }

  /* Retention and funnels tab */
  function dataRetentionTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'day1',  label: '1-day retention',  cls: 'an-c1', hint: 'Share of users who came back the next day' },
      { id: 'day7',  label: '7-day retention',  cls: 'an-c2', hint: 'Share of users who came back within a week' },
      { id: 'day30', label: '30-day retention', cls: 'an-c4', hint: 'Share of users who came back within a month' },
    ]));

    var row = el('div', 'an-grid');
    var cohorts = card({
      title: 'Retention cohorts',
      span: 12,
      foot: 'Each row is a group of users by first visit, and the share still returning after 1, 7 and 30 days.',
      exportRows: function () {
        var rows = [['cohort', 'users', 'day_1_pct', 'day_7_pct', 'day_30_pct']];
        d.cohorts.forEach(function (c) { rows.push([c.cohort, c.users, c.day1, c.day7, c.day30]); });
        return rows;
      },
      exportName: csvName('data', 'retention-cohorts'),
    });
    cohorts.body.appendChild(dataTable({
      columns: [
        { key: 'cohort', label: 'Cohort' },
        { key: 'users',  label: 'Users',  num: true, format: fmtInt },
        { key: 'day1',   label: 'Day 1',  num: true, format: function (v) { return v ? fmtPct(v, 1) : '\u2014'; } },
        { key: 'day7',   label: 'Day 7',  num: true, format: function (v) { return v ? fmtPct(v, 1) : '\u2014'; } },
        { key: 'day30',  label: 'Day 30', num: true, format: function (v) { return v ? fmtPct(v, 1) : '\u2014'; } },
      ],
      rows: d.cohorts,
    }));
    row.appendChild(cohorts.root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    var adoption = card({
      title: 'Feature adoption by panel',
      span: 6,
      foot: 'Of the sessions that logged in, how many opened each panel.',
      exportRows: function () {
        var rows = [['panel', 'sessions', 'adopted', 'rate_pct']];
        d.adoption.forEach(function (a) { rows.push([a.panel, a.sessions, a.adopted, a.rate]); });
        return rows;
      },
      exportName: csvName('data', 'feature-adoption'),
    });
    adoption.body.appendChild(dataTable({
      columns: [
        { key: 'panel',    label: 'Panel' },
        { key: 'adopted',  label: 'Adopted', num: true, format: fmtInt },
        { key: 'rate',     label: 'Rate',    num: true, bar: true, format: function (v) { return fmtPct(v, 1); } },
      ],
      rows: d.adoption,
    }));
    row2.appendChild(adoption.root);

    var funnel = card({
      title: 'Conversion funnel',
      span: 6,
      foot: 'Visit through to taking an action.',
      exportRows: function () {
        var rows = [['step', 'count']];
        d.conversion.forEach(function (c) { rows.push([c.step, c.value]); });
        d.conversionRates.forEach(function (r) { rows.push(['rate:' + r.step, r.rate.toFixed(2)]); });
        return rows;
      },
      exportName: csvName('data', 'conversion-funnel'),
    });
    funnel.body.appendChild(rankedRows(d.conversion.map(function (c) {
      return { label: c.step, value: c.value };
    }), { cls: 'an-c2' }));
    var rates = el('div', 'an-kv');
    d.conversionRates.forEach(function (r) {
      var kv = el('div', 'an-kv-row');
      kv.appendChild(el('span', 'an-kv-key', r.step));
      kv.appendChild(el('span', 'an-kv-val', fmtPct(r.rate, 1)));
      rates.appendChild(kv);
    });
    funnel.body.appendChild(rates);
    row2.appendChild(funnel.root);
    ctx.content.appendChild(row2);
  }

  A.registerPanel('analytics-data', { build: buildData });

  window.ESIPanel.registerItem({
    section: 'analytics',
    order: 7,
    id: 'analytics-data',
    type: 'analytics',
    label: 'Data',
    icon: 'download',
    subtitle: 'Active users, retention and funnels.',
  });
})();
