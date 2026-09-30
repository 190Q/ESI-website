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

  function loadContent(range) {
    if (USE_DEMO_DATA) return Promise.resolve(buildContentDemo(range));
    return fetch('/panel/api/analytics/content?range=' + encodeURIComponent(range), {
      credentials: 'same-origin',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function buildContentDemo(range) {
    var base = demoBase(range);
    var rand = rng(6151 + range.length * 457);
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

    var shopViewSeries = series(1200, 420, 0.2);
    var totalShopViews = 12480;
    var productViews = 6420;
    var purchases = 238;
    var purchaseValue = 184200;

    var cart = {
      adds: 610,
      removes: 184,
      qtyChanges: 268,
      abandoned: 372,
      abandonmentRate: 42.1,
    };

    // Checkout start to completion, plus the drop-off between them.
    var checkout = [
      { label: 'Checkout started',   value: 412 },
      { label: 'Checkout completed', value: 238 },
    ];
    var checkoutDropoff = 42.2;

    var products = [
      { item: 'Aspect Token',      views: 1240, purchases: 62, conversion: 5.0 },
      { item: 'Raid Consumables',  views: 1080, purchases: 54, conversion: 5.0 },
      { item: 'Emerald Pouch',     views: 960,  purchases: 41, conversion: 4.3 },
      { item: 'Guild Banner',      views: 820,  purchases: 28, conversion: 3.4 },
      { item: 'Detlas Teleport',   views: 690,  purchases: 31, conversion: 4.5 },
      { item: 'Cosmetic Cape',     views: 540,  purchases: 12, conversion: 2.2 },
      { item: 'Horse Whistle',     views: 480,  purchases: 7,  conversion: 1.5 },
      { item: 'Loot Chest Key',    views: 610,  purchases: 3,  conversion: 0.5 },
    ];

    var shopFilters = [
      { label: 'Category',    value: 1420 },
      { label: 'Price range', value: 860 },
      { label: 'Availability', value: 640 },
      { label: 'Rarity',      value: 410 },
    ];

    var shopSearches = [
      { label: 'aspect',   value: 96 },
      { label: 'token',    value: 74 },
      { label: 'pouch',    value: 48 },
      { label: 'banner',   value: 31 },
      { label: 'cape',     value: 22 },
    ];

    var purchasesTable = [
      { item: 'Aspect Token',     buyer: '190Q',      value: 4800, at: '2026-09-30T14:12:00Z' },
      { item: 'Raid Consumables', buyer: 'Sindria',   value: 1250, at: '2026-09-30T13:41:00Z' },
      { item: 'Emerald Pouch',    buyer: 'Valaendor', value: 2400, at: '2026-09-30T11:08:00Z' },
      { item: 'Guild Banner',     buyer: 'Meridia',   value: 3600, at: '2026-09-29T21:55:00Z' },
      { item: 'Aspect Token',     buyer: 'Kestrel',   value: 4800, at: '2026-09-29T19:20:00Z' },
      { item: 'Detlas Teleport',  buyer: 'Halcyon',   value: 480,  at: '2026-09-29T17:03:00Z' },
      { item: 'Raid Consumables', buyer: 'Aurelia',   value: 1250, at: '2026-09-29T15:47:00Z' },
      { item: 'Emerald Pouch',    buyer: 'Corvane',   value: 2400, at: '2026-09-29T12:31:00Z' },
    ];

    var balanceLookups = 1840;

    var auctions = { views: 2140, bids: 186 };

    var dmCards = { generated: 412, tested: 28 };

    var shopAdmin = [
      { label: 'Item edited',        value: 68 },
      { label: 'Price changed',      value: 34 },
      { label: 'Item created',       value: 26 },
      { label: 'Item deleted',       value: 7 },
      { label: 'Maintenance toggled', value: 3 },
    ];

    var maintenance = {
      users: 214,
      windows: 3,
      minutes: 96,
    };

    var lookupSeries = series(2000, 700, 0.18);
    var totalPlayerLookups = 14280;
    var uniquePlayers = 1204;

    var mostViewedPlayers = [
      { label: '190Q',      value: 1840 },
      { label: 'Sindria',   value: 1420 },
      { label: 'Valaendor', value: 1060 },
      { label: 'Meridia',   value: 780 },
      { label: 'Kestrel',   value: 620 },
      { label: 'Halcyon',   value: 480 },
    ];

    var topSearches = [
      { label: '190Q',     value: 214 },
      { label: 'sindria',  value: 168 },
      { label: 'valaendor', value: 121 },
      { label: 'meridia',  value: 96 },
      { label: 'kestrel',  value: 74 },
    ];

    var statCardsExpanded = [
      { label: 'Activity Comparison', value: 1840 },
      { label: 'Guild Summary',       value: 1420 },
      { label: 'Combat Stats',        value: 1060 },
      { label: 'Raids & Dungeons',    value: 780 },
      { label: 'Professions',         value: 540 },
      { label: 'Playtime',            value: 410 },
    ];

    var metricMasks = [
      { label: 'Playtime',     value: 412 },
      { label: 'Guild Raids',  value: 268 },
      { label: 'Chests Found', value: 184 },
      { label: 'Mobs Killed',  value: 121 },
      { label: 'Wars',         value: 96 },
    ];

    var graphInteractions = {
      viewed: [
        { label: 'Player activity', value: 4120 },
        { label: 'Guild stats',     value: 2410 },
        { label: 'Compare',         value: 980 },
      ],
      ranges: [
        { label: '30 days', value: 2840 },
        { label: '7 days',  value: 1420 },
        { label: '60 days', value: 860 },
        { label: '2 days',  value: 410 },
      ],
      hover: 8420,
      zoom: 1860,
    };

    var lookupCache = {
      hitRate: 74.2,
      prevHitRate: 68.9,
      missLatency: 210,
    };
    
    var bot = {
      panelViews: 1860,
      logTailViews: 940,
      commandTriggers: 412,
      restartActions: 68,
      sessionStarts: 96,
      sessionStops: 88,
    };

    var inactivity = {
      views: 1240,
      topExemptions: [
        { label: '190Q',      value: 214 },
        { label: 'Sindria',   value: 168 },
        { label: 'Valaendor', value: 121 },
        { label: 'Meridia',   value: 96 },
        { label: 'Halcyon',   value: 61 },
      ],
    };

    var promotions = {
      pageViews: 1640,
      memberListViews: 980,
      detailOpens: 412,
    };

    var creatorStudio = 240;
    var guildInfo = { threadViews: 860 };

    var uploads = [
      { file: 'raid-schedule-october.pdf',   downloads: 412 },
      { file: 'guild-banner.png',            downloads: 268 },
      { file: 'event-rules.txt',             downloads: 184 },
      { file: 'aspect-checklist.csv',        downloads: 121 },
      { file: 'territory-map.png',           downloads: 96 },
      { file: 'shop-price-list.json',        downloads: 74 },
      { file: 'raid-composition-guide.pdf',  downloads: 48 },
    ];
    var totalDownloads = sumOf(uploads.map(function (u) { return u.downloads; }));

    var gdpr = { generated: 41, downloaded: 33 };

    var notFoundViews = 386;

    var wynnpiece = {
      pageViews: 1840,
      customLinks: [
        { label: 'wynnpiece/progression', value: 412 },
        { label: 'wynnpiece/tracker',     value: 268 },
        { label: 'wynnpiece/rewards',     value: 121 },
      ],
      blockedDefault: [
        { label: '/wynnpiece/progression/default', value: 96 },
        { label: '/wynnpiece/tracker/default',     value: 41 },
      ],
    };
    var blockedDefaultTotal = sumOf(wynnpiece.blockedDefault.map(function (b) { return b.value; }));

    return {
      demo: true,
      range: range,
      generatedAt: new Date().toISOString(),
      labels: labels,

      kpis: {
        shopViews:      { value: totalShopViews, prev: Math.round(totalShopViews * 0.9), series: shopViewSeries, format: fmtInt, invert: false },
        productViews:   { value: productViews, prev: Math.round(productViews * 0.88), series: trendSeries(productViews, n, 0.22, rand), format: fmtInt, invert: false },
        purchases:      { value: purchases, prev: 206, series: trendSeries(purchases, n, 0.3, rand), format: fmtInt, invert: false },
        purchaseValue:  { value: purchaseValue, prev: 158400, series: trendSeries(purchaseValue, n, 0.28, rand), format: fmtInt, invert: false },

        playerLookups:    { value: totalPlayerLookups, prev: Math.round(totalPlayerLookups * 0.91), series: lookupSeries, format: fmtInt, invert: false },
        uniquePlayers:    { value: uniquePlayers, prev: 1096, series: trendSeries(uniquePlayers, n, 0.18, rand), format: fmtInt, invert: false },
        cacheHitRate:     { value: lookupCache.hitRate, prev: lookupCache.prevHitRate, series: trendSeries(lookupCache.hitRate, n, 0.08, rand), format: function (v) { return fmtPct(v, 1); }, invert: false },
        cacheMissLatency: { value: lookupCache.missLatency, prev: 236, series: trendSeries(lookupCache.missLatency, n, 0.2, rand), format: fmtMs, invert: true },

        botViews:        { value: bot.panelViews, prev: 1640, series: trendSeries(bot.panelViews, n, 0.24, rand), format: fmtInt, invert: false },
        inactivityViews: { value: inactivity.views, prev: 1080, series: trendSeries(inactivity.views, n, 0.22, rand), format: fmtInt, invert: false },
        promotionViews:  { value: promotions.pageViews, prev: 1420, series: trendSeries(promotions.pageViews, n, 0.2, rand), format: fmtInt, invert: false },
        guildInfoViews:  { value: guildInfo.threadViews, prev: 740, series: trendSeries(guildInfo.threadViews, n, 0.22, rand), format: fmtInt, invert: false },

        fileDownloads:  { value: totalDownloads, prev: Math.round(totalDownloads * 0.88), series: trendSeries(totalDownloads, n, 0.26, rand), format: fmtInt, invert: false },
        gdprExports:    { value: gdpr.generated, prev: 34, series: trendSeries(gdpr.generated, n, 0.35, rand), format: fmtInt, invert: false },
        wynnpieceViews: { value: wynnpiece.pageViews, prev: 1620, series: trendSeries(wynnpiece.pageViews, n, 0.24, rand), format: fmtInt, invert: false },
        blockedDefault: { value: blockedDefaultTotal, prev: 164, series: trendSeries(blockedDefaultTotal, n, 0.4, rand), format: fmtInt, invert: true },
      },

      shopViewSeries: shopViewSeries,
      cart: cart,
      checkout: checkout,
      checkoutDropoff: checkoutDropoff,
      products: products,
      shopFilters: shopFilters,
      shopSearches: shopSearches,
      purchasesTable: purchasesTable,
      balanceLookups: balanceLookups,
      auctions: auctions,
      dmCards: dmCards,
      shopAdmin: shopAdmin,
      maintenance: maintenance,

      lookupSeries: lookupSeries,
      mostViewedPlayers: mostViewedPlayers,
      topSearches: topSearches,
      statCardsExpanded: statCardsExpanded,
      metricMasks: metricMasks,
      graphInteractions: graphInteractions,
      lookupCache: lookupCache,

      bot: bot,
      inactivity: inactivity,
      promotions: promotions,
      creatorStudio: creatorStudio,
      guildInfo: guildInfo,

      uploads: uploads,
      gdpr: gdpr,
      notFoundViews: notFoundViews,
      wynnpiece: wynnpiece,
    };
  }

  var CONTENT_TABS = [
    { id: 'shop',      label: 'Shop' },
    { id: 'lookups',   label: 'Lookups' },
    { id: 'tools',     label: 'Bots & tools' },
    { id: 'downloads', label: 'Downloads' },
  ];

  function buildContent(container) {
    return analyticsPanel({
      container: container,
      label: 'Content',
      tabKey: 'content',
      tabs: CONTENT_TABS,
      load: loadContent,
      exportRows: contentExportRows,
      exportName: function (d, tab) { return csvName('content', tab); },
      render: renderContent,
    });
  }

  function renderContent(ctx) {
    if (ctx.tab === 'lookups') contentLookupsTab(ctx);
    else if (ctx.tab === 'tools') contentToolsTab(ctx);
    else if (ctx.tab === 'downloads') contentDownloadsTab(ctx);
    else contentShopTab(ctx);
    ctx.content.appendChild(analyticsFoot(ctx.data));
  }

  function contentExportRows(d, tab) {
    if (tab === 'lookups') {
      var l = [['player', 'lookups']];
      d.mostViewedPlayers.forEach(function (p) { l.push([p.label, p.value]); });
      return l;
    }
    if (tab === 'tools') {
      var t = [['metric', 'value']];
      t.push(['bot_panel_views', d.bot.panelViews]);
      t.push(['bot_log_tail_views', d.bot.logTailViews]);
      t.push(['bot_command_triggers', d.bot.commandTriggers]);
      t.push(['bot_restart_actions', d.bot.restartActions]);
      t.push(['bot_session_starts', d.bot.sessionStarts]);
      t.push(['bot_session_stops', d.bot.sessionStops]);
      t.push(['inactivity_views', d.inactivity.views]);
      t.push(['promotions_page_views', d.promotions.pageViews]);
      t.push(['promotions_member_list_views', d.promotions.memberListViews]);
      t.push(['promotion_detail_opens', d.promotions.detailOpens]);
      t.push(['creator_studio_usage', d.creatorStudio]);
      t.push(['guild_info_thread_views', d.guildInfo.threadViews]);
      return t;
    }
    if (tab === 'downloads') {
      var dl = [['file', 'downloads']];
      d.uploads.forEach(function (u) { dl.push([u.file, u.downloads]); });
      return dl;
    }
    var s = [['item', 'detail_views', 'purchases', 'conversion_pct']];
    d.products.forEach(function (p) { s.push([p.item, p.views, p.purchases, p.conversion]); });
    return s;
  }

  /* Shop tabs */
  function contentShopTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'shopViews',     label: 'Shop page views',   cls: 'an-c1', hint: 'Views of the shop' },
      { id: 'productViews',  label: 'Product detail views', cls: 'an-c2', hint: 'Individual product pages opened' },
      { id: 'purchases',     label: 'Purchases',         cls: 'an-c4', hint: 'Completed purchases' },
      { id: 'purchaseValue', label: 'Purchase value',    cls: 'an-c3', hint: 'ESI Points spent' },
    ]));

    var row = el('div', 'an-grid');
    var chart = card({
      title: 'Shop views over time',
      span: 8,
      exportRows: function () {
        var rows = [['bucket', 'shop_views']];
        d.labels.forEach(function (l, i) { rows.push([l, d.shopViewSeries[i]]); });
        return rows;
      },
      exportName: csvName('content', 'shop-views'),
    });
    chart.body.appendChild(timeSeriesChart({
      labels: d.labels,
      series: [{ name: 'Shop views', values: d.shopViewSeries, area: true }],
      formatValue: fmtInt,
      height: 288,
      ariaLabel: 'Shop views over time',
    }));
    row.appendChild(chart.root);

    var cartCard = card({
      title: 'Cart',
      span: 4,
      foot: 'Abandonment is carts that were filled but never checked out.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['added', d.cart.adds],
          ['removed', d.cart.removes],
          ['quantity_changes', d.cart.qtyChanges],
          ['abandoned', d.cart.abandoned],
          ['abandonment_rate_pct', d.cart.abandonmentRate],
        ];
      },
      exportName: csvName('content', 'cart'),
    });
    cartCard.body.appendChild(miniStrip([
      { label: 'Added',      value: fmtInt(d.cart.adds) },
      { label: 'Removed',    value: fmtInt(d.cart.removes) },
      { label: 'Qty changed', value: fmtInt(d.cart.qtyChanges) },
    ]));
    cartCard.body.appendChild(rankedRows([
      { label: 'Abandoned', value: d.cart.abandoned },
      { label: 'Purchased', value: d.kpis.purchases.value },
    ], { cls: 'an-c5' }));
    cartCard.body.appendChild(el('div', 'an-card-note',
      'Abandonment rate: ' + fmtPct(d.cart.abandonmentRate, 1)));
    row.appendChild(cartCard.root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    var products = card({
      title: 'Products',
      span: 12,
      foot: 'Conversion is purchases as a share of detail views.',
      exportRows: function () {
        var rows = [['item', 'detail_views', 'purchases', 'conversion_pct']];
        d.products.forEach(function (p) { rows.push([p.item, p.views, p.purchases, p.conversion]); });
        return rows;
      },
      exportName: csvName('content', 'products'),
    });
    products.body.appendChild(dataTable({
      columns: [
        { key: 'item',       label: 'Item' },
        { key: 'views',      label: 'Detail views', num: true, format: fmtInt },
        { key: 'purchases',  label: 'Purchases',    num: true, format: fmtInt },
        { key: 'conversion', label: 'Conversion',   num: true, format: function (v) { return fmtPct(v, 1); } },
      ],
      rows: d.products,
    }));
    row2.appendChild(products.root);
    ctx.content.appendChild(row2);

    var row3 = el('div', 'an-grid');
    var checkout = card({
      title: 'Checkout funnel',
      span: 4,
      foot: 'Drop-off: ' + fmtPct(d.checkoutDropoff, 1) + ' between starting and completing.',
      exportRows: function () {
        var rows = [['stage', 'count']];
        d.checkout.forEach(function (s) { rows.push([s.label, s.value]); });
        rows.push(['drop_off_pct', d.checkoutDropoff]);
        return rows;
      },
      exportName: csvName('content', 'checkout-funnel'),
    });
    checkout.body.appendChild(rankedRows(d.checkout, { cls: 'an-c2' }));
    row3.appendChild(checkout.root);

    row3.appendChild(rankedCard({
      title: 'Filters applied', span: 4, items: d.shopFilters, cls: 'an-c4', unit: 'filter',
      exportName: csvName('content', 'shop-filters'),
    }).root);
    row3.appendChild(rankedCard({
      title: 'Shop searches', span: 4, items: d.shopSearches, cls: 'an-c1', unit: 'query',
      exportName: csvName('content', 'shop-searches'),
    }).root);
    ctx.content.appendChild(row3);

    var row4 = el('div', 'an-grid');
    var purchases = card({
      title: 'Purchases',
      span: 8,
      foot: fmtInt(d.kpis.purchases.value) + ' purchases worth ' + fmtInt(d.kpis.purchaseValue.value) + ' ESI Points.',
      exportRows: function () {
        var rows = [['item', 'buyer', 'value', 'timestamp']];
        d.purchasesTable.forEach(function (p) { rows.push([p.item, p.buyer, p.value, p.at]); });
        return rows;
      },
      exportName: csvName('content', 'purchases'),
    });
    purchases.body.appendChild(dataTable({
      columns: [
        { key: 'item',  label: 'Item' },
        { key: 'buyer', label: 'Buyer' },
        { key: 'value', label: 'Value', num: true, format: fmtInt },
        { key: 'at',    label: 'When' },
      ],
      rows: d.purchasesTable,
    }));
    row4.appendChild(purchases.root);

    var balance = card({
      title: 'Balance lookups',
      span: 4,
      foot: 'Lookups against the points balance service.',
      exportRows: function () {
        return [['metric', 'value'], ['balance_lookups', d.balanceLookups]];
      },
      exportName: csvName('content', 'balance-lookups'),
    });
    balance.body.appendChild(miniStrip([
      { label: 'Lookups', value: fmtInt(d.balanceLookups) },
    ]));
    row4.appendChild(balance.root);
    ctx.content.appendChild(row4);

    var row5 = el('div', 'an-grid');
    var auctions = card({
      title: 'Auctions',
      span: 6,
      exportRows: function () {
        return [['metric', 'value'], ['auction_views', d.auctions.views], ['bids', d.auctions.bids]];
      },
      exportName: csvName('content', 'auctions'),
    });
    auctions.body.appendChild(miniStrip([
      { label: 'Auction views', value: fmtInt(d.auctions.views) },
      { label: 'Bids placed',   value: fmtInt(d.auctions.bids) },
    ]));
    row5.appendChild(auctions.root);

    var dm = card({
      title: 'DM cards',
      span: 6,
      foot: 'Cards generated by the shop and the test sends used while building them.',
      exportRows: function () {
        return [['metric', 'value'], ['cards_generated', d.dmCards.generated], ['test_sends', d.dmCards.tested]];
      },
      exportName: csvName('content', 'dm-cards'),
    });
    dm.body.appendChild(miniStrip([
      { label: 'Generated',  value: fmtInt(d.dmCards.generated) },
      { label: 'Test sends', value: fmtInt(d.dmCards.tested) },
    ]));
    row5.appendChild(dm.root);
    ctx.content.appendChild(row5);

    var row6 = el('div', 'an-grid');
    row6.appendChild(rankedCard({
      title: 'Shop admin actions', span: 6, items: d.shopAdmin, cls: 'an-c4', unit: 'action',
      exportName: csvName('content', 'shop-admin'),
    }).root);

    var maint = card({
      title: 'Maintenance',
      span: 6,
      foot: 'Visitors who hit the disabled message while the shop was closed.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['users_hit_disabled_message', d.maintenance.users],
          ['maintenance_windows', d.maintenance.windows],
          ['minutes_in_maintenance', d.maintenance.minutes],
        ];
      },
      exportName: csvName('content', 'maintenance'),
    });
    maint.body.appendChild(miniStrip([
      { label: 'Hit disabled', value: fmtInt(d.maintenance.users) },
      { label: 'Windows',      value: fmtInt(d.maintenance.windows) },
      { label: 'Minutes down', value: fmtInt(d.maintenance.minutes) },
    ]));
    row6.appendChild(maint.root);
    ctx.content.appendChild(row6);
  }

  /* Lookups tab - list section 8 */

  function contentLookupsTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'playerLookups',    label: 'Player lookups',     cls: 'an-c1', hint: 'Player lookups in range' },
      { id: 'uniquePlayers',    label: 'Unique players',     cls: 'an-c2', hint: 'Distinct players looked up' },
      { id: 'cacheHitRate',     label: 'Cache hit rate',     cls: 'an-c4', hint: 'Player endpoint cache hits' },
      { id: 'cacheMissLatency', label: 'Cache-miss latency', cls: 'an-c3', hint: 'Response time when the cache misses' },
    ]));

    var row = el('div', 'an-grid');
    var chart = card({
      title: 'Player lookups over time',
      span: 12,
      exportRows: function () {
        var rows = [['bucket', 'player_lookups']];
        d.labels.forEach(function (l, i) { rows.push([l, d.lookupSeries[i]]); });
        return rows;
      },
      exportName: csvName('content', 'lookups-over-time'),
    });
    chart.body.appendChild(timeSeriesChart({
      labels: d.labels,
      series: [{ name: 'Player lookups', values: d.lookupSeries, area: true }],
      formatValue: fmtInt,
      height: 288,
      ariaLabel: 'Player lookups over time',
    }));
    row.appendChild(chart.root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    row2.appendChild(rankedCard({
      title: 'Most-viewed players', span: 6, items: d.mostViewedPlayers, cls: 'an-c1', unit: 'player',
      exportName: csvName('content', 'most-viewed-players'),
    }).root);
    row2.appendChild(rankedCard({
      title: 'Top searches', span: 6, items: d.topSearches, cls: 'an-c2', unit: 'query',
      exportName: csvName('content', 'top-searches'),
    }).root);
    ctx.content.appendChild(row2);

    var row3 = el('div', 'an-grid');
    row3.appendChild(rankedCard({
      title: 'Stat cards expanded', span: 6, items: d.statCardsExpanded, cls: 'an-c3', unit: 'card',
      foot: 'Which collapsible stat cards people open.',
      exportName: csvName('content', 'stat-cards'),
    }).root);
    row3.appendChild(rankedCard({
      title: 'Metric masks', span: 6, items: d.metricMasks, cls: 'an-c5', unit: 'metric',
      foot: 'Which metric columns people hide.',
      exportName: csvName('content', 'metric-masks'),
    }).root);
    ctx.content.appendChild(row3);

    var row4 = el('div', 'an-grid');
    row4.appendChild(rankedCard({
      title: 'Graphs viewed', span: 4, items: d.graphInteractions.viewed, cls: 'an-c1', unit: 'graph',
      exportName: csvName('content', 'graphs-viewed'),
    }).root);
    row4.appendChild(rankedCard({
      title: 'Time ranges selected', span: 4, items: d.graphInteractions.ranges, cls: 'an-c2', unit: 'range',
      exportName: csvName('content', 'graph-ranges'),
    }).root);
    var graphIo = card({
      title: 'Hover and zoom',
      span: 4,
      foot: 'Pointer activity on the graphs.',
      exportRows: function () {
        return [['metric', 'value'], ['hover_events', d.graphInteractions.hover], ['zoom_events', d.graphInteractions.zoom]];
      },
      exportName: csvName('content', 'graph-io'),
    });
    graphIo.body.appendChild(miniStrip([
      { label: 'Hover', value: fmtInt(d.graphInteractions.hover) },
      { label: 'Zoom',  value: fmtInt(d.graphInteractions.zoom) },
    ]));
    row4.appendChild(graphIo.root);
    ctx.content.appendChild(row4);
  }

  /* Bots and tools tab - list section 9 */

  function contentToolsTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'botViews',        label: 'Bot panel views', cls: 'an-c1', hint: 'Views of the Bot panel' },
      { id: 'inactivityViews', label: 'Inactivity views', cls: 'an-c2', hint: 'Views of the inactivity exemptions' },
      { id: 'promotionViews',  label: 'Promotions views', cls: 'an-c4', hint: 'Views of the promotions page' },
      { id: 'guildInfoViews',  label: 'Guild info views', cls: 'an-c3', hint: 'Forum thread views' },
    ]));

    var row = el('div', 'an-grid');
    var bot = card({
      title: 'Bot panel',
      span: 6,
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['panel_views', d.bot.panelViews],
          ['log_tail_views', d.bot.logTailViews],
          ['command_triggers', d.bot.commandTriggers],
          ['restart_actions', d.bot.restartActions],
        ];
      },
      exportName: csvName('content', 'bot-panel'),
    });
    bot.body.appendChild(miniStrip([
      { label: 'Panel views', value: fmtInt(d.bot.panelViews) },
      { label: 'Log tails',   value: fmtInt(d.bot.logTailViews) },
      { label: 'Restarts',    value: fmtInt(d.bot.restartActions) },
    ]));
    bot.body.appendChild(rankedRows([
      { label: 'Command triggers', value: d.bot.commandTriggers },
      { label: 'Log tail views',   value: d.bot.logTailViews },
      { label: 'Restart actions',  value: d.bot.restartActions },
    ], { cls: 'an-c1' }));
    row.appendChild(bot.root);

    var sessions = card({
      title: 'Bot screen sessions',
      span: 6,
      foot: 'Starts and stops of the bot screen session.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['session_starts', d.bot.sessionStarts],
          ['session_stops', d.bot.sessionStops],
        ];
      },
      exportName: csvName('content', 'bot-sessions'),
    });
    sessions.body.appendChild(miniStrip([
      { label: 'Starts', value: fmtInt(d.bot.sessionStarts) },
      { label: 'Stops',  value: fmtInt(d.bot.sessionStops) },
    ]));
    row.appendChild(sessions.root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    var inact = card({
      title: 'Inactivity',
      span: 6,
      exportRows: function () {
        var rows = [['metric', 'value'], ['exemption_views', d.inactivity.views]];
        d.inactivity.topExemptions.forEach(function (e) { rows.push(['exemption:' + e.label, e.value]); });
        return rows;
      },
      exportName: csvName('content', 'inactivity'),
    });
    inact.body.appendChild(miniStrip([
      { label: 'Exemption views', value: fmtInt(d.inactivity.views) },
    ]));
    inact.body.appendChild(el('div', 'an-card-note', 'Most-viewed exemptions.'));
    inact.body.appendChild(rankedRows(d.inactivity.topExemptions, { cls: 'an-c2' }));
    row2.appendChild(inact.root);

    var promos = card({
      title: 'Promotions',
      span: 6,
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['page_views', d.promotions.pageViews],
          ['member_list_views', d.promotions.memberListViews],
          ['promotion_detail_opens', d.promotions.detailOpens],
        ];
      },
      exportName: csvName('content', 'promotions'),
    });
    promos.body.appendChild(miniStrip([
      { label: 'Page views',  value: fmtInt(d.promotions.pageViews) },
      { label: 'Member list', value: fmtInt(d.promotions.memberListViews) },
      { label: 'Details',     value: fmtInt(d.promotions.detailOpens) },
    ]));
    row2.appendChild(promos.root);
    ctx.content.appendChild(row2);

    var row3 = el('div', 'an-grid');
    var studio = card({
      title: 'Creator studio',
      span: 6,
      foot: 'Usage of the event creator studio.',
      exportRows: function () {
        return [['metric', 'value'], ['creator_studio_usage', d.creatorStudio]];
      },
      exportName: csvName('content', 'creator-studio'),
    });
    studio.body.appendChild(miniStrip([
      { label: 'Usage', value: fmtInt(d.creatorStudio) },
    ]));
    row3.appendChild(studio.root);

    var info = card({
      title: 'Guild info',
      span: 6,
      foot: 'Views of the guild info forum thread.',
      exportRows: function () {
        return [['metric', 'value'], ['forum_thread_views', d.guildInfo.threadViews]];
      },
      exportName: csvName('content', 'guild-info'),
    });
    info.body.appendChild(miniStrip([
      { label: 'Thread views', value: fmtInt(d.guildInfo.threadViews) },
    ]));
    row3.appendChild(info.root);
    ctx.content.appendChild(row3);
  }

  /* Downloads tab */
  function contentDownloadsTab(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'fileDownloads',  label: 'File downloads', cls: 'an-c1', hint: 'Downloads from /uploads/' },
      { id: 'gdprExports',    label: 'GDPR exports',   cls: 'an-c2', hint: 'Exports generated' },
      { id: 'wynnpieceViews', label: 'WynnPiece views', cls: 'an-c4', hint: 'Views of the WynnPiece page' },
      { id: 'blockedDefault', label: 'Blocked direct hits', cls: 'an-c5', hint: 'Direct hits on a default link a custom link overrides' },
    ]));

    var row = el('div', 'an-grid');
    var files = card({
      title: 'Files downloaded',
      span: 8,
      foot: 'Every download served from /uploads/.',
      exportRows: function () {
        var rows = [['file', 'downloads']];
        d.uploads.forEach(function (u) { rows.push([u.file, u.downloads]); });
        return rows;
      },
      exportName: csvName('content', 'uploads'),
    });
    files.body.appendChild(dataTable({
      columns: [
        { key: 'file',      label: 'File', ident: true },
        { key: 'downloads', label: 'Downloads', num: true, format: fmtInt },
      ],
      rows: d.uploads,
    }));
    row.appendChild(files.root);

    var gdpr = card({
      title: 'GDPR exports',
      span: 4,
      foot: 'Data exports generated for account holders and how many were collected.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['exports_generated', d.gdpr.generated],
          ['exports_downloaded', d.gdpr.downloaded],
        ];
      },
      exportName: csvName('content', 'gdpr'),
    });
    gdpr.body.appendChild(miniStrip([
      { label: 'Generated',  value: fmtInt(d.gdpr.generated) },
      { label: 'Downloaded', value: fmtInt(d.gdpr.downloaded) },
    ]));
    row.appendChild(gdpr.root);
    ctx.content.appendChild(row);

    var row2 = el('div', 'an-grid');
    var wynn = card({
      title: 'WynnPiece',
      span: 6,
      foot: 'Views of the standalone WynnPiece landing page.',
      exportRows: function () {
        return [['metric', 'value'], ['page_views', d.wynnpiece.pageViews]];
      },
      exportName: csvName('content', 'wynnpiece'),
    });
    wynn.body.appendChild(miniStrip([
      { label: 'Page views', value: fmtInt(d.wynnpiece.pageViews) },
    ]));
    row2.appendChild(wynn.root);

    row2.appendChild(rankedCard({
      title: 'Custom links used', span: 6, items: d.wynnpiece.customLinks, cls: 'an-c2', unit: 'link',
      foot: 'Redirects served through the custom link handler.',
      exportName: csvName('content', 'custom-links'),
    }).root);
    ctx.content.appendChild(row2);

    var row3 = el('div', 'an-grid');
    row3.appendChild(rankedCard({
      title: 'Blocked direct hits', span: 6, items: d.wynnpiece.blockedDefault, cls: 'an-c5', unit: 'path',
      foot: 'People trying the default URL directly instead of the custom link.',
      exportName: csvName('content', 'blocked-direct'),
    }).root);

    var nf = card({
      title: 'Not found page',
      span: 6,
      foot: 'Views of the 404 page.',
      exportRows: function () {
        return [['metric', 'value'], ['404_page_views', d.notFoundViews]];
      },
      exportName: csvName('content', '404'),
    });
    nf.body.appendChild(miniStrip([
      { label: '404 views', value: fmtInt(d.notFoundViews) },
    ]));
    row3.appendChild(nf.root);
    ctx.content.appendChild(row3);
  }

  A.registerPanel('analytics-content', { build: buildContent });

  window.ESIPanel.registerItem({
    section: 'analytics',
    order: 5,
    id: 'analytics-content',
    type: 'analytics',
    label: 'Content',
    icon: 'box',
    subtitle: 'Shop, lookups, bots and downloads.',
  });
})();
