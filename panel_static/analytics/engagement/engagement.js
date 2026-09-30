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
  var sumOf = A.sumOf;
  var avgOf = A.avgOf;
  var rng = A.rng;
  var demoBase = A.demoBase;
  var trendSeries = A.trendSeries;
  var USE_DEMO_DATA = A.USE_DEMO_DATA;

  function loadEngagement(range) {
    if (USE_DEMO_DATA) return Promise.resolve(buildEngagementDemo(range));
    return fetch('/panel/api/analytics/engagement?range=' + encodeURIComponent(range), {
      credentials: 'same-origin',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function buildEngagementDemo(range) {
    var base = demoBase(range);
    var rand = rng(3391 + range.length * 733);
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

    var PANEL_SPECS = [
      { label: 'Player',        share: 0.27, seconds: 184 },
      { label: 'Guild',         share: 0.18, seconds: 156 },
      { label: 'Events',        share: 0.14, seconds: 121 },
      { label: 'Shop',          share: 0.11, seconds: 143 },
      { label: 'Bot',           share: 0.08, seconds: 96 },
      { label: 'Promotions',    share: 0.07, seconds: 88 },
      { label: 'Inactivity',    share: 0.05, seconds: 102 },
      { label: 'Shop admin',    share: 0.04, seconds: 268 },
      { label: 'Events manage', share: 0.03, seconds: 241 },
      { label: 'Guild info',    share: 0.02, seconds: 74 },
      { label: 'WynnPiece',     share: 0.01, seconds: 312 },
    ];

    var totalPanelViews = 18420;
    var panels = PANEL_SPECS.map(function (s) {
      return {
        label: s.label,
        views: Math.round(totalPanelViews * s.share),
        avgSeconds: s.seconds,
      };
    });

    var panelSeries = series(2600, 900, 0.18);

    // Panel to panel moves, which also give the total switch count.
    var flow = [
      { from: 'Player', to: 'Guild',      moves: 1840 },
      { from: 'Player', to: 'Events',     moves: 1120 },
      { from: 'Guild',  to: 'Player',     moves: 1490 },
      { from: 'Guild',  to: 'Promotions', moves: 640 },
      { from: 'Events', to: 'Shop',       moves: 520 },
      { from: 'Shop',   to: 'Player',     moves: 480 },
      { from: 'Player', to: 'Shop',       moves: 410 },
      { from: 'Guild',  to: 'Inactivity', moves: 260 },
    ];
    var panelSwitches = sumOf(flow.map(function (f) { return f.moves; }));

    // Deep-link entries against landing on the root.
    var entryTypes = [
      { label: 'Landed on /', value: 2410 },
      { label: 'Deep link',   value: 1180 },
    ];

    var navClicks = [
      { label: 'Sidebar', value: 9840 },
      { label: 'Navbar',  value: 1240 },
    ];

    var footerClicks = [
      { label: 'Discord',          value: 320 },
      { label: 'GitHub',           value: 148 },
      { label: 'Privacy Policy',   value: 96 },
      { label: 'Terms of Service', value: 41 },
      { label: 'Cookie Policy',    value: 28 },
      { label: 'Contact',          value: 17 },
    ];

    var themes = [
      { label: 'Empire of Sindria',  value: 4820 },
      { label: 'Midnight Afterglow', value: 1410 },
      { label: 'Catppuccin',         value: 690 },
      { label: 'Purple',             value: 420 },
      { label: 'Custom',             value: 190 },
    ];

    var fonts = [
      { label: 'Cinzel & Crimson Pro', value: 5210 },
      { label: 'Inter',                value: 1640 },
      { label: 'Minecraft',            value: 520 },
      { label: 'Custom',               value: 160 },
    ];

    var appearance = {
      themeSwitches: 612,
      fontChanges: 218,
      customThemes: 96,
      customFonts: 41,
    };

    var depth = {
      scroll: [
        { label: '25%',  value: 4210 },
        { label: '50%',  value: 3120 },
        { label: '75%',  value: 1980 },
        { label: '100%', value: 940 },
      ],
      tabHidden: 2840,
      idleSeconds: 96,
      activeSeconds: 312,
      firstUse: [
        { label: 'Player',     value: 412 },
        { label: 'Guild',      value: 388 },
        { label: 'Events',     value: 296 },
        { label: 'Shop',       value: 214 },
        { label: 'Bot',        value: 84 },
        { label: 'Promotions', value: 61 },
      ],
    };

    var PINNED_SPECS = [
      { event: 'Wynnpiece Treasure Hunt', status: 'ongoing',  audience: 'public',     impressions: 3184, visible: 2910, clicks: 412, collapses: 688,  reexpands: 96,  unique: 1180, repeat: 268 },
      { event: 'Guild Anniversary Raid',  status: 'upcoming', audience: 'guild_only', impressions: 2410, visible: 2240, clicks: 188, collapses: 1210, reexpands: 214, unique: 640,  repeat: 186 },
      { event: 'Aspect Hunt Night',       status: 'upcoming', audience: 'public',     impressions: 1760, visible: 1610, clicks: 96,  collapses: 902,  reexpands: 148, unique: 410,  repeat: 128 },
      { event: 'Build Contest',           status: 'upcoming', audience: 'public',     impressions: 980,  visible: 890,  clicks: 24,  collapses: 731,  reexpands: 61,  unique: 212,  repeat: 74 },
    ];

    var pinned = PINNED_SPECS.map(function (p) {
      var ctr = p.clicks / p.impressions;
      return {
        event: p.event,
        status: p.status,
        audience: p.audience,
        impressions: p.impressions,
        visible: p.visible,
        clicks: p.clicks,
        ctr: ctr * 100,
        collapses: p.collapses,
        collapseRate: (p.collapses / p.impressions) * 100,
        reexpands: p.reexpands,
        uniqueUsers: p.unique,
        repeatUsers: p.repeat,
        dwell: Math.round((p.visible / p.impressions) * (8 + ctr * 90) * 10) / 10,
      };
    });

    var bannerImpressions = sumOf(pinned.map(function (p) { return p.impressions; }));
    var bannerVisible = sumOf(pinned.map(function (p) { return p.visible; }));
    var bannerClicks = sumOf(pinned.map(function (p) { return p.clicks; }));
    var bannerCollapses = sumOf(pinned.map(function (p) { return p.collapses; }));

    var bannerByPanel = [
      { label: 'Player', value: 2140 },
      { label: 'Guild',  value: 1420 },
      { label: 'Bot',    value: 386 },
    ];

    var bannerSlots = [
      { label: 'Slot 1', value: 2840 },
      { label: 'Slot 2', value: 1190 },
      { label: 'Slot 3', value: 640 },
      { label: 'Slot 4', value: 210 },
    ];

    var bannerByDevice = [
      { label: 'Desktop', value: 3100 },
      { label: 'Mobile',  value: 1040 },
      { label: 'Tablet',  value: 190 },
    ];

    // Guild-only pins carry a badge.
    var bannerByAudience = [
      { label: 'Public',     value: 5924 },
      { label: 'Guild only', value: 2410 },
    ];

    // Interaction rate, not a raw count.
    var bannerStatusRate = [
      { label: 'Ongoing',  value: 12.9 },
      { label: 'Upcoming', value: 6.7 },
    ];

    var bannerToggle = [
      { label: 'Banner on',  value: 5480 },
      { label: 'Banner off', value: 610 },
    ];

    var pinActivity = [
      { label: 'Pinned',   value: 41 },
      { label: 'Unpinned', value: 33 },
    ];

    var descriptionLinks = [
      { label: 'wynncraft.com/news', value: 214 },
      { label: 'discord.gg/sindria', value: 168 },
      { label: 'Wynnpiece page',     value: 96 },
      { label: 'Shop listing',       value: 42 },
    ];

    var bannerFetch = {
      fetches: 7422,
      changedEvents: 74,
      uniqueViewers: 1893,
      repeatViewers: 642,
    };

    var listViews = 8240;
    var eventSeries = series(820, 320, 0.22);

    var eventReferrers = [
      { label: 'Events page',   value: 4120 },
      { label: 'Pinned banner', value: 1180 },
      { label: 'Deep link',     value: 640 },
    ];

    var eventList = [
      { event: 'Wynnpiece Treasure Hunt', views: 1840, fromBanner: 412, fromList: 1120, pins: 12 },
      { event: 'Guild Anniversary Raid',  views: 1420, fromBanner: 188, fromList: 1010, pins: 9 },
      { event: 'Aspect Hunt Night',       views: 1060, fromBanner: 96,  fromList: 810,  pins: 7 },
      { event: 'Build Contest',           views: 690,  fromBanner: 24,  fromList: 520,  pins: 5 },
      { event: 'Raid Practice',           views: 480,  fromBanner: 0,   fromList: 410,  pins: 3 },
      { event: 'Territory Defence',       views: 310,  fromBanner: 0,   fromList: 280,  pins: 2 },
    ];

    var eventFilters = [
      { label: 'Status: upcoming', value: 1420 },
      { label: 'Status: ongoing',  value: 860 },
      { label: 'Audience: public', value: 640 },
      { label: 'Guild only',       value: 410 },
      { label: 'Date range',       value: 280 },
    ];

    var eventSorts = [
      { label: 'Start date', value: 2140 },
      { label: 'Newest',     value: 980 },
      { label: 'Name',       value: 310 },
    ];

    var eventSearches = [
      { label: 'raid',     value: 84 },
      { label: 'treasure', value: 62 },
      { label: 'aspect',   value: 48 },
      { label: 'contest',  value: 31 },
      { label: 'practice', value: 19 },
    ];

    // Who pinned and unpinned what.
    var pinActors = [
      { actor: '190Q',      pinned: 18, unpinned: 12 },
      { actor: 'Sindria',   pinned: 11, unpinned: 9 },
      { actor: 'Valaendor', pinned: 7,  unpinned: 6 },
      { actor: 'Meridia',   pinned: 5,  unpinned: 6 },
    ];

    var adminActions = [
      { label: 'Event edited',  value: 68 },
      { label: 'Event created', value: 26 },
      { label: 'Event deleted', value: 7 },
    ];

    var prizes = {
      prizeExpands: 1840,
      leaderboardViews: 960,
      signups: 412,
      signupRate: 22.4,
    };

    var bannerToView = {
      median: 96,
      within1m: 412,
      oneTo5m: 186,
      over5m: 74,
    };

    var eventViews = sumOf(eventList.map(function (e) { return e.views; }));
    var eventPinsTotal = sumOf(eventList.map(function (e) { return e.pins; }));
    var eventSearchesTotal = sumOf(eventSearches.map(function (s) { return s.value; }));
    var avgPanelSeconds = Math.round(avgOf(panels.map(function (p) { return p.avgSeconds; })));

    return {
      demo: true,
      range: range,
      generatedAt: new Date().toISOString(),
      labels: labels,

      kpis: {
        panelViews:       { value: totalPanelViews, prev: Math.round(totalPanelViews * 0.9), series: panelSeries, format: fmtInt, invert: false },
        panelSwitches:    { value: panelSwitches, prev: Math.round(panelSwitches * 0.92), series: trendSeries(panelSwitches, n, 0.2, rand), format: fmtInt, invert: false },
        deepLinks:        { value: 1180, prev: 1020, series: trendSeries(1180, n, 0.3, rand), format: fmtInt, invert: false },
        avgPanelTime:     { value: avgPanelSeconds, prev: 148, series: trendSeries(avgPanelSeconds, n, 0.12, rand), format: fmtDuration, invert: false },
        impressions:      { value: bannerImpressions, prev: Math.round(bannerImpressions * 0.88), series: trendSeries(bannerImpressions, n, 0.25, rand), format: fmtInt, invert: false },
        bannerCtr:        { value: (bannerClicks / bannerImpressions) * 100, prev: 6.1, series: trendSeries((bannerClicks / bannerImpressions) * 100, n, 0.2, rand), format: function (v) { return fmtPct(v, 1); }, invert: false },
        collapseRate:     { value: (bannerCollapses / bannerImpressions) * 100, prev: 41.2, series: trendSeries((bannerCollapses / bannerImpressions) * 100, n, 0.15, rand), format: function (v) { return fmtPct(v, 1); }, invert: true },
        bannerClicks:     { value: bannerClicks, prev: Math.round(bannerClicks * 0.83), series: trendSeries(bannerClicks, n, 0.3, rand), format: fmtInt, invert: false },
        listViews:        { value: listViews, prev: Math.round(listViews * 0.91), series: trendSeries(listViews, n, 0.2, rand), format: fmtInt, invert: false },
        eventViews:       { value: eventViews, prev: 4820, series: eventSeries, format: fmtInt, invert: false },
        eventPins:        { value: eventPinsTotal, prev: 31, series: trendSeries(eventPinsTotal, n, 0.35, rand), format: fmtInt, invert: false },
        eventSearches:    { value: eventSearchesTotal, prev: Math.round(eventSearchesTotal * 0.87), series: trendSeries(eventSearchesTotal, n, 0.35, rand), format: fmtInt, invert: false },
      },

      panels: panels,
      panelSeries: panelSeries,
      flow: flow,
      entryTypes: entryTypes,
      navClicks: navClicks,
      footerClicks: footerClicks,
      themes: themes,
      fonts: fonts,
      appearance: appearance,
      depth: depth,

      banner: {
        impressions: bannerImpressions,
        visible: bannerVisible,
        clicks: bannerClicks,
        collapses: bannerCollapses,
        reexpands: sumOf(pinned.map(function (p) { return p.reexpands; })),
        visibleRate: (bannerVisible / bannerImpressions) * 100,
      },
      pinned: pinned,
      bannerByPanel: bannerByPanel,
      bannerSlots: bannerSlots,
      bannerByDevice: bannerByDevice,
      bannerByAudience: bannerByAudience,
      bannerStatusRate: bannerStatusRate,
      bannerToggle: bannerToggle,
      pinActivity: pinActivity,
      descriptionLinks: descriptionLinks,
      bannerFetch: bannerFetch,

      listViews: listViews,
      eventSeries: eventSeries,
      eventReferrers: eventReferrers,
      eventList: eventList,
      eventFilters: eventFilters,
      eventSorts: eventSorts,
      eventSearches: eventSearches,
      pinActors: pinActors,
      adminActions: adminActions,
      prizes: prizes,
      bannerToView: bannerToView,
    };
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
    var p = [['panel', 'views', 'avg_seconds']];
    d.panels.forEach(function (x) { p.push([x.label, x.views, x.avgSeconds]); });
    return p;
  }

  /* Panels tab */

  function engagementPanelsTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'panelViews',    label: 'Panel views',       cls: 'an-c1', hint: 'Every panel open in range' },
      { id: 'panelSwitches', label: 'Panel switches',    cls: 'an-c2', hint: 'Panel to panel moves' },
      { id: 'deepLinks',     label: 'Deep-link entries', cls: 'an-c4', hint: 'Sessions that started on a panel URL' },
      { id: 'avgPanelTime',  label: 'Avg time in panel', cls: 'an-c3', hint: 'Mean time spent per panel' },
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
        var rows = [['panel', 'views', 'avg_seconds']];
        d.panels.forEach(function (p) { rows.push([p.label, p.views, p.avgSeconds]); });
        return rows;
      },
      exportName: csvName('engagement', 'panels'),
    });
    table.body.appendChild(dataTable({
      columns: [
        { key: 'label',      label: 'Panel' },
        { key: 'views',      label: 'Views',    num: true, format: fmtInt },
        { key: 'avgSeconds', label: 'Avg time', num: true, format: fmtDuration },
        { key: 'share',      label: 'Share',    num: true, bar: true, format: function (v) { return fmtPct(v, 1); } },
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
    var p = d.prizes;
    var b = d.bannerToView;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'listViews',     label: 'Event list views', cls: 'an-c1', hint: 'Views of the events list' },
      { id: 'eventViews',    label: 'Event views',      cls: 'an-c2', hint: 'Individual event detail views' },
      { id: 'eventPins',     label: 'Pin actions',      cls: 'an-c4', hint: 'Pin and unpin actions' },
      { id: 'eventSearches', label: 'Event searches',   cls: 'an-c3', hint: 'Searches on the events page' },
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
      title: 'Filters applied', span: 4, items: d.eventFilters, cls: 'an-c2', unit: 'filter',
      exportName: csvName('engagement', 'event-filters'),
    }).root);
    row3.appendChild(rankedCard({
      title: 'Sort order', span: 4, items: d.eventSorts, cls: 'an-c1', unit: 'sort',
      exportName: csvName('engagement', 'event-sorts'),
    }).root);
    row3.appendChild(rankedCard({
      title: 'Event searches', span: 4, items: d.eventSearches, cls: 'an-c3', unit: 'query',
      exportName: csvName('engagement', 'event-searches'),
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

    var row5 = el('div', 'an-grid');
    var prize = card({
      title: 'Prizes and signups',
      span: 6,
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['prize_section_expands', p.prizeExpands],
          ['leaderboard_views', p.leaderboardViews],
          ['signups', p.signups],
          ['signup_rate_pct', p.signupRate],
        ];
      },
      exportName: csvName('engagement', 'prizes'),
    });
    prize.body.appendChild(miniStrip([
      { label: 'Prize expands', value: fmtInt(p.prizeExpands) },
      { label: 'Leaderboard',   value: fmtInt(p.leaderboardViews) },
      { label: 'Signups',       value: fmtInt(p.signups) },
    ]));
    prize.body.appendChild(rankedRows([
      { label: 'Viewed the prizes', value: p.prizeExpands },
      { label: 'Opened the board',  value: p.leaderboardViews },
      { label: 'Signed up',         value: p.signups },
    ], { cls: 'an-c2' }));
    prize.body.appendChild(el('div', 'an-card-note',
      fmtPct(p.signupRate, 1) + ' of prize viewers signed up.'));
    row5.appendChild(prize.root);
    ctx.content.appendChild(row5);
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
