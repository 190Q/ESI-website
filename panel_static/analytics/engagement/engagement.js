(function () {
  'use strict';

  var A = window.ESIAnalytics;
  var el = A.el;
  var card = A.card;
  var dataTable = A.dataTable;
  var donutCard = A.donutCard;
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
  var fmtDuration = A.fmtDuration;

  var ENGAGEMENT_KPI_SPEC = {
    panelViews:    { format: fmtInt, invert: false },
    panelSwitches: { format: fmtInt, invert: false },
    deepLinks:     { format: fmtInt, invert: false },
    avgPanelTime:  { format: fmtDuration, invert: false },
    impressions:   { format: fmtInt, invert: false },
    bannerCtr:     { format: function (v) { return fmtPct(v, 1); }, invert: false },
    collapseRate:  { format: function (v) { return fmtPct(v, 1); }, invert: true },
    bannerClicks:  { format: fmtInt, invert: false },
    listViews:     { format: fmtInt, invert: false },
    eventViews:    { format: fmtInt, invert: false },
    eventPins:     { format: fmtInt, invert: false },
  };

  function loadEngagement(range) {
    return fetch('/panel/api/analytics/engagement?range=' + encodeURIComponent(range), {
      credentials: 'same-origin',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      d.labels = A.bucketLabels(d.buckets, range);
      Object.keys(ENGAGEMENT_KPI_SPEC).forEach(function (id) {
        var kpi = d.kpis && d.kpis[id];
        if (!kpi) return;
        kpi.format = ENGAGEMENT_KPI_SPEC[id].format;
        kpi.invert = ENGAGEMENT_KPI_SPEC[id].invert;
      });
      return d;
    });
  }

  var ENGAGEMENT_TABS = [
    { id: 'panels', label: 'Panels' },
    { id: 'banner', label: 'Pinned banner' },
    { id: 'events', label: 'Events' },
  ];

  function buildEngagement(container) {
    return analyticsPanel({
      container: container,
      label: 'Engagement',
      tabKey: 'engagement',
      tabs: ENGAGEMENT_TABS,
      load: loadEngagement,
      exportRows: engagementExportRows,
      exportName: function (d, tab) { return csvName('engagement', tab); },
      render: renderEngagement,
    });
  }

  function renderEngagement(ctx) {
    if (ctx.tab === 'banner') engagementBannerTab(ctx);
    else if (ctx.tab === 'events') engagementEventsTab(ctx);
    else engagementPanelsTab(ctx);
    ctx.content.appendChild(analyticsFoot(ctx.data));
  }

  function engagementExportRows(d, tab) {
    if (tab === 'banner') {
      var b = [['event', 'status', 'audience', 'impressions', 'visible', 'clicks', 'ctr_pct', 'collapses', 'collapse_rate_pct', 'reexpands', 'unique_users', 'repeat_users', 'avg_dwell_s']];
      d.pinned.forEach(function (p) {
        b.push([p.event, p.status, p.audience, p.impressions, p.visible, p.clicks,
          p.ctr.toFixed(2), p.collapses, p.collapseRate.toFixed(2), p.reexpands,
          p.uniqueUsers, p.repeatUsers, p.dwell]);
      });
      return b;
    }
    if (tab === 'events') {
      var e = [['event', 'views', 'from_banner', 'from_list', 'pins']];
      d.eventList.forEach(function (x) {
        e.push([x.event, x.views, x.fromBanner, x.fromList, x.pins]);
      });
      return e;
    }
    var p = [['panel', 'views', 'sessions']];
    d.panels.forEach(function (x) { p.push([x.label, x.views, x.sessions]); });
    return p;
  }

  /* Panels tab */

  function engagementPanelsTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'panelViews',    label: 'Panel views',       cls: 'an-c1', hint: 'Every panel open in range' },
      { id: 'panelSwitches', label: 'Panel switches',    cls: 'an-c2', hint: 'Panel to panel moves' },
      { id: 'deepLinks',     label: 'Deep-link entries', cls: 'an-c4', hint: 'Sessions that started on a panel URL' },
      { id: 'avgPanelTime',  label: 'Avg time in panel', cls: 'an-c3', hint: 'Active page time per panel view' },
    ]));

    var row = el('div', 'an-grid');
    var chart = card({
      title: 'Panel views over time',
      span: 8,
      exportRows: function () {
        var rows = [['bucket', 'panel_views']];
        d.labels.forEach(function (l, i) { rows.push([l, d.panelSeries[i]]); });
        return rows;
      },
      exportName: csvName('engagement', 'panel-views-over-time'),
    });
    chart.body.appendChild(timeSeriesChart({
      labels: d.labels,
      series: [{ name: 'Panel views', values: d.panelSeries, area: true }],
      formatValue: fmtInt,
      height: 288,
      ariaLabel: 'Panel views over time',
    }));
    row.appendChild(chart.root);

    row.appendChild(donutCard({
      title: 'Deep link vs landing on /', span: 4, items: d.entryTypes, unit: 'entry',
      exportName: csvName('engagement', 'entry-type'),
    }).root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    var table = card({
      title: 'Panels',
      span: 12,
      exportRows: function () {
        var rows = [['panel', 'views', 'sessions']];
        d.panels.forEach(function (p) { rows.push([p.label, p.views, p.sessions]); });
        return rows;
      },
      exportName: csvName('engagement', 'panels'),
    });
    table.body.appendChild(dataTable({
      columns: [
        { key: 'label',    label: 'Panel' },
        { key: 'views',    label: 'Views',    num: true, format: fmtInt },
        { key: 'sessions', label: 'Sessions', num: true, format: fmtInt },
        { key: 'share',    label: 'Share',    num: true, bar: true, format: function (v) { return fmtPct(v, 1); } },
      ],
      rows: d.panels.map(function (p) {
        return Object.assign({}, p, { share: (p.views / (d.kpis.panelViews.value || 1)) * 100 });
      }),
    }));
    row2.appendChild(table.root);
    ctx.content.appendChild(row2);

    var row3 = el('div', 'an-grid');
    var flow = card({
      title: 'Panel to panel',
      span: 6,
      foot: 'Where people go next, most common first.',
      exportRows: function () {
        var rows = [['from', 'to', 'moves']];
        d.flow.forEach(function (f) { rows.push([f.from, f.to, f.moves]); });
        return rows;
      },
      exportName: csvName('engagement', 'panel-flow'),
    });
    flow.body.appendChild(dataTable({
      columns: [
        { key: 'from',  label: 'From' },
        { key: 'to',    label: 'To' },
        { key: 'moves', label: 'Moves', num: true, format: fmtInt },
      ],
      rows: d.flow,
    }));
    row3.appendChild(flow.root);

    var depth = card({
      title: 'Session depth',
      span: 6,
      foot: 'Scroll depth is the share of sessions that reached each mark.',
      exportRows: function () {
        var rows = [['metric', 'value']];
        rows.push(['tab_hidden_events', d.depth.tabHidden]);
        rows.push(['active_seconds', d.depth.activeSeconds]);
        rows.push(['idle_seconds', d.depth.idleSeconds]);
        d.depth.scroll.forEach(function (s) { rows.push(['scroll_' + s.label, s.value]); });
        d.depth.firstUse.forEach(function (f) { rows.push(['first_use:' + f.label, f.value]); });
        return rows;
      },
      exportName: csvName('engagement', 'session-depth'),
    });
    depth.body.appendChild(miniStrip([
      { label: 'Active / session', value: fmtDuration(d.depth.activeSeconds) },
      { label: 'Idle / session',   value: fmtDuration(d.depth.idleSeconds) },
      { label: 'Tabbed away',      value: fmtInt(d.depth.tabHidden) },
    ]));
    depth.body.appendChild(rankedRows(d.depth.scroll, { cls: 'an-c3' }));
    depth.body.appendChild(el('div', 'an-card-note', 'First-ever use of a panel, by feature.'));
    depth.body.appendChild(rankedRows(d.depth.firstUse, { cls: 'an-c2' }));
    row3.appendChild(depth.root);
    ctx.content.appendChild(row3);

    var row4 = el('div', 'an-grid');
    row4.appendChild(rankedCard({
      title: 'Navigation clicks', span: 4, items: d.navClicks, cls: 'an-c1', unit: 'source',
      exportName: csvName('engagement', 'nav-clicks'),
    }).root);
    row4.appendChild(rankedCard({
      title: 'Footer links', span: 4, items: d.footerClicks, cls: 'an-c4', unit: 'link',
      exportName: csvName('engagement', 'footer-links'),
    }).root);
    var appearance = card({
      title: 'Appearance changes',
      span: 4,
      foot: 'Theme and font changes made from the settings modal.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['theme_switches', d.appearance.themeSwitches],
          ['font_changes', d.appearance.fontChanges],
          ['custom_themes_added', d.appearance.customThemes],
          ['custom_fonts_added', d.appearance.customFonts],
        ];
      },
      exportName: csvName('engagement', 'appearance-changes'),
    });
    appearance.body.appendChild(miniStrip([
      { label: 'Theme switches', value: fmtInt(d.appearance.themeSwitches) },
      { label: 'Font changes',   value: fmtInt(d.appearance.fontChanges) },
      { label: 'Custom added',   value: fmtInt(d.appearance.customThemes + d.appearance.customFonts) },
    ]));
    row4.appendChild(appearance.root);
    ctx.content.appendChild(row4);

    var row5 = el('div', 'an-grid');
    row5.appendChild(donutCard({
      title: 'Theme in use', span: 4, items: d.themes, unit: 'theme',
      exportName: csvName('engagement', 'themes'),
    }).root);
    row5.appendChild(donutCard({
      title: 'Font pack in use', span: 4, items: d.fonts, unit: 'font',
      exportName: csvName('engagement', 'fonts'),
    }).root);
    ctx.content.appendChild(row5);
  }

  /* Pinned banner tab */

  function engagementBannerTab(ctx) {
    var d = ctx.data;
    var b = d.banner;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'impressions',  label: 'Impressions',   cls: 'an-c1', hint: 'Times a pinned banner was rendered' },
      { id: 'bannerCtr',    label: 'Click-through', cls: 'an-c2', hint: 'Title clicks over impressions' },
      { id: 'collapseRate', label: 'Collapse rate', cls: 'an-c5', hint: 'Collapses over impressions' },
      { id: 'bannerClicks', label: 'Title clicks',  cls: 'an-c4', hint: 'Clicks through to the event' },
    ]));

    var row = el('div', 'an-grid');
    var table = card({
      title: 'Pinned events',
      span: 12,
      foot: 'Visible counts impressions where the banner was actually on screen, not just rendered.',
      exportRows: function () {
        var rows = [['event', 'status', 'audience', 'impressions', 'visible', 'clicks', 'ctr_pct', 'collapses', 'collapse_rate_pct', 'reexpands', 'unique_users', 'repeat_users', 'avg_dwell_s']];
        d.pinned.forEach(function (p) {
          rows.push([p.event, p.status, p.audience, p.impressions, p.visible, p.clicks,
            p.ctr.toFixed(2), p.collapses, p.collapseRate.toFixed(2), p.reexpands,
            p.uniqueUsers, p.repeatUsers, p.dwell]);
        });
        return rows;
      },
      exportName: csvName('engagement', 'pinned-events'),
    });
    table.body.appendChild(dataTable({
      columns: [
        { key: 'event',        label: 'Event' },
        { key: 'impressions',  label: 'Impressions', num: true, format: fmtInt },
        { key: 'visible',      label: 'Visible',     num: true, format: fmtInt },
        { key: 'clicks',       label: 'Clicks',      num: true, format: fmtInt },
        { key: 'ctr',          label: 'CTR',         num: true, format: function (v) { return fmtPct(v, 1); } },
        { key: 'collapses',    label: 'Collapses',   num: true, format: fmtInt },
        { key: 'collapseRate', label: 'Collapse',    num: true, format: function (v) { return fmtPct(v, 1); } },
        { key: 'reexpands',    label: 'Re-expands',  num: true, format: fmtInt },
        { key: 'uniqueUsers',  label: 'Unique',      num: true, format: fmtInt },
        { key: 'repeatUsers',  label: 'Repeat',      num: true, format: fmtInt },
        { key: 'dwell',        label: 'Dwell',       num: true, format: function (v) { return v.toFixed(1) + 's'; } },
      ],
      rows: d.pinned,
    }));
    row.appendChild(table.root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    row2.appendChild(donutCard({
      title: 'Interaction by panel', span: 4, items: d.bannerByPanel, unit: 'panel',
      foot: 'The banner only shows on the General panels.',
      exportName: csvName('engagement', 'banner-by-panel'),
    }).root);
    row2.appendChild(rankedCard({
      title: 'Stack position', span: 4, items: d.bannerSlots, cls: 'an-c2', unit: 'slot',
      foot: 'Which slot in the stack was interacted with.',
      exportName: csvName('engagement', 'banner-slots'),
    }).root);
    row2.appendChild(donutCard({
      title: 'Device', span: 4, items: d.bannerByDevice, unit: 'device',
      exportName: csvName('engagement', 'banner-devices'),
    }).root);
    ctx.content.appendChild(row2);

    var row3 = el('div', 'an-grid');
    row3.appendChild(rankedCard({
      title: 'Impressions by audience', span: 4, items: d.bannerByAudience, cls: 'an-c4', unit: 'audience',
      foot: 'Guild-only pins carry a badge.',
      exportName: csvName('engagement', 'banner-audience'),
    }).root);
    row3.appendChild(rankedCard({
      title: 'Interaction rate by status', span: 4, items: d.bannerStatusRate, cls: 'an-c1', unit: 'status',
      foot: 'Clicks as a share of impressions.',
      format: function (v) { return fmtPct(v, 1); },
      exportName: csvName('engagement', 'banner-status'),
    }).root);
    row3.appendChild(donutCard({
      title: 'Banner setting', span: 4, items: d.bannerToggle, unit: 'setting',
      foot: 'Sessions with the banner switched on or off.',
      exportName: csvName('engagement', 'banner-toggle'),
    }).root);
    ctx.content.appendChild(row3);

    var row4 = el('div', 'an-grid');
    var fetchCard = card({
      title: 'Banner activity',
      span: 4,
      foot: 'Fetches of /api/events/pinned and the pin changes that invalidate them.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['pinned_fetches', d.bannerFetch.fetches],
          ['pin_change_events', d.bannerFetch.changedEvents],
          ['unique_viewers', d.bannerFetch.uniqueViewers],
          ['repeat_viewers', d.bannerFetch.repeatViewers],
        ];
      },
      exportName: csvName('engagement', 'banner-activity'),
    });
    fetchCard.body.appendChild(miniStrip([
      { label: 'Pinned fetches', value: fmtInt(d.bannerFetch.fetches) },
      { label: 'Pin changes',    value: fmtInt(d.bannerFetch.changedEvents) },
      { label: 'Unique viewers', value: fmtInt(d.bannerFetch.uniqueViewers) },
    ]));
    fetchCard.body.appendChild(rankedRows([
      { label: 'One interaction', value: d.bannerFetch.uniqueViewers - d.bannerFetch.repeatViewers },
      { label: 'Repeat',          value: d.bannerFetch.repeatViewers },
    ], { cls: 'an-c2' }));
    fetchCard.body.appendChild(el('div', 'an-card-note',
      fmtInt(b.reexpands) + ' re-expands after a collapse, and ' +
      fmtPct(b.visibleRate, 1) + ' of impressions were actually on screen.'));
    row4.appendChild(fetchCard.root);

    row4.appendChild(rankedCard({
      title: 'Pin changes', span: 4, items: d.pinActivity, cls: 'an-c4', unit: 'action',
      exportName: csvName('engagement', 'pin-changes'),
    }).root);
    row4.appendChild(rankedCard({
      title: 'Description links', span: 4, items: d.descriptionLinks, cls: 'an-c3', unit: 'link',
      foot: 'Outbound clicks from a rendered pin.',
      exportName: csvName('engagement', 'description-links'),
    }).root);
    ctx.content.appendChild(row4);
  }

  /* Events tab */
  function engagementEventsTab(ctx) {
    var d = ctx.data;
    var b = d.bannerToView;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'listViews',  label: 'Event list views', cls: 'an-c1', hint: 'Views of the events list' },
      { id: 'eventViews', label: 'Event views',      cls: 'an-c2', hint: 'Individual event detail views' },
      { id: 'eventPins',  label: 'Pin actions',      cls: 'an-c4', hint: 'Pin and unpin actions' },
    ]));

    var row = el('div', 'an-grid');
    var chart = card({
      title: 'Event views over time',
      span: 8,
      exportRows: function () {
        var rows = [['bucket', 'event_views']];
        d.labels.forEach(function (l, i) { rows.push([l, d.eventSeries[i]]); });
        return rows;
      },
      exportName: csvName('engagement', 'event-views-over-time'),
    });
    chart.body.appendChild(timeSeriesChart({
      labels: d.labels,
      series: [{ name: 'Event views', values: d.eventSeries, area: true }],
      formatValue: fmtInt,
      height: 288,
      ariaLabel: 'Event views over time',
    }));
    row.appendChild(chart.root);

    row.appendChild(donutCard({
      title: 'How they arrived', span: 4, items: d.eventReferrers, unit: 'source',
      foot: 'Landing from a pin counts separately from the events list.',
      exportName: csvName('engagement', 'event-referrers'),
    }).root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    var table = card({
      title: 'Events',
      span: 12,
      exportRows: function () {
        var rows = [['event', 'views', 'from_banner', 'from_list', 'pins']];
        d.eventList.forEach(function (x) {
          rows.push([x.event, x.views, x.fromBanner, x.fromList, x.pins]);
        });
        return rows;
      },
      exportName: csvName('engagement', 'events'),
    });
    table.body.appendChild(dataTable({
      columns: [
        { key: 'event',      label: 'Event' },
        { key: 'views',      label: 'Views',       num: true, format: fmtInt },
        { key: 'fromBanner', label: 'From banner', num: true, format: fmtInt },
        { key: 'fromList',   label: 'From list',   num: true, format: fmtInt },
        { key: 'pins',       label: 'Pins',        num: true, format: fmtInt },
      ],
      rows: d.eventList,
    }));
    row2.appendChild(table.root);
    ctx.content.appendChild(row2);

    var row3 = el('div', 'an-grid');
    row3.appendChild(rankedCard({
      title: 'Filters applied', span: 12, items: d.eventFilters, cls: 'an-c2', unit: 'filter',
      foot: 'Status tabs chosen on the events list.',
      exportName: csvName('engagement', 'event-filters'),
    }).root);
    ctx.content.appendChild(row3);

    var row4 = el('div', 'an-grid');
    var actors = card({
      title: 'Who pinned what',
      span: 4,
      exportRows: function () {
        var rows = [['actor', 'pinned', 'unpinned']];
        d.pinActors.forEach(function (a) { rows.push([a.actor, a.pinned, a.unpinned]); });
        return rows;
      },
      exportName: csvName('engagement', 'pin-actors'),
    });
    actors.body.appendChild(dataTable({
      columns: [
        { key: 'actor',    label: 'Actor' },
        { key: 'pinned',   label: 'Pinned',   num: true, format: fmtInt },
        { key: 'unpinned', label: 'Unpinned', num: true, format: fmtInt },
      ],
      rows: d.pinActors,
    }));
    row4.appendChild(actors.root);

    row4.appendChild(rankedCard({
      title: 'Event changes', span: 4, items: d.adminActions, cls: 'an-c4', unit: 'action',
      foot: 'Creations, edits and deletions.',
      exportName: csvName('engagement', 'event-changes'),
    }).root);

    var toView = card({
      title: 'Pin to event view',
      span: 4,
      foot: 'Time from a pin impression to the event page opening.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['median_seconds', b.median],
          ['within_1_minute', b.within1m],
          ['1_to_5_minutes', b.oneTo5m],
          ['over_5_minutes', b.over5m],
        ];
      },
      exportName: csvName('engagement', 'pin-to-view'),
    });
    toView.body.appendChild(miniStrip([
      { label: 'Median',        value: fmtDuration(b.median) },
      { label: 'Within 1 min',  value: fmtInt(b.within1m) },
      { label: 'Over 5 min',    value: fmtInt(b.over5m) },
    ]));
    toView.body.appendChild(rankedRows([
      { label: 'Within 1 minute', value: b.within1m },
      { label: '1 to 5 minutes',  value: b.oneTo5m },
      { label: 'Over 5 minutes',  value: b.over5m },
    ], { cls: 'an-c2' }));
    row4.appendChild(toView.root);
    ctx.content.appendChild(row4);
  }

  A.registerPanel('analytics-engagement', { build: buildEngagement });

  window.ESIPanel.registerItem({
    section: 'analytics',
    order: 4,
    id: 'analytics-engagement',
    type: 'analytics',
    label: 'Engagement',
    icon: 'target',
    subtitle: 'Panels, pinned banners and events.',
  });
})();
