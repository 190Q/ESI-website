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

  var DATA_KPI_SPEC = {
    dau:   { format: fmtInt, invert: false },
    wau:   { format: fmtInt, invert: false },
    mau:   { format: fmtInt, invert: false },
    day1:  { format: function (v) { return fmtPct(v, 1); }, invert: false },
    day7:  { format: function (v) { return fmtPct(v, 1); }, invert: false },
    day30: { format: function (v) { return fmtPct(v, 1); }, invert: false },
  };

  function loadData(range) {
    return fetch('/panel/api/analytics/rollups?range=' + encodeURIComponent(range), {
      credentials: 'same-origin',
      cache: 'no-store',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      d.labels = A.bucketLabels(d.buckets, range);
      Object.keys(DATA_KPI_SPEC).forEach(function (id) {
        var kpi = d.kpis && d.kpis[id];
        if (!kpi) return;
        kpi.format = DATA_KPI_SPEC[id].format;
        kpi.invert = DATA_KPI_SPEC[id].invert;
      });
      return d;
    });
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
      { id: 'dau', label: 'Daily active members',   cls: 'an-c1', hint: 'Distinct logged-in members active in a day' },
      { id: 'wau', label: 'Weekly active members',  cls: 'an-c2', hint: 'Distinct logged-in members active in a week' },
      { id: 'mau', label: 'Monthly active members', cls: 'an-c4', hint: 'Distinct logged-in members active in a month' },
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
      series: [{ name: 'Daily active members', values: d.activeSeries, area: true }],
      formatValue: fmtInt,
      height: 288,
      ariaLabel: 'Daily active members over time',
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
    cohorts.body.appendChild(el('div', 'an-card-note',
      'Cohorts cover logged-in members only. The visitor hash is salted per day, so anonymous visitors cannot be followed across a week by design. ' +
      'Day 30 needs 60 days of history, and raw rows are pruned at 30, so it reads 0 until the nightly rollup has been running that long.'));
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
