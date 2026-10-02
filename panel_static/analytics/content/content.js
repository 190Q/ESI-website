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

  var CONTENT_KPI_SPEC = {
    shopViews:      { format: fmtInt, invert: false },
    productViews:   { format: fmtInt, invert: false },
    purchases:      { format: fmtInt, invert: false },
    purchaseValue:  { format: fmtInt, invert: false },
    playerLookups:  { format: fmtInt, invert: false },
    uniquePlayers:  { format: fmtInt, invert: false },
    cacheHitRate:   { format: function (v) { return fmtPct(v, 1); }, invert: false },
    cacheMissLatency: { format: fmtMs, invert: true },
    botViews:       { format: fmtInt, invert: false },
    inactivityViews: { format: fmtInt, invert: false },
    promotionViews: { format: fmtInt, invert: false },
    guildInfoViews: { format: fmtInt, invert: false },
    fileDownloads:  { format: fmtInt, invert: false },
    gdprExports:    { format: fmtInt, invert: false },
    wynnpieceViews: { format: fmtInt, invert: false },
    blockedDefault: { format: fmtInt, invert: true },
  };

  function loadContent(range) {
    return fetch('/panel/api/analytics/content?range=' + encodeURIComponent(range), {
      credentials: 'same-origin',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      d.labels = A.bucketLabels(d.buckets, range);
      Object.keys(CONTENT_KPI_SPEC).forEach(function (id) {
        var kpi = d.kpis && d.kpis[id];
        if (!kpi) return;
        kpi.format = CONTENT_KPI_SPEC[id].format;
        kpi.invert = CONTENT_KPI_SPEC[id].invert;
      });
      return d;
    });
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
          ['open_carts', d.cart.openCarts],
          ['items_in_carts', d.cart.itemsInCarts],
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
    cartCard.body.appendChild(miniStrip([
      { label: 'Open carts',     value: fmtInt(d.cart.openCarts) },
      { label: 'Items in carts', value: fmtInt(d.cart.itemsInCarts) },
    ]));
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
      foot: fmtInt(d.kpis.purchases.value) + ' purchases worth ' +
        fmtInt(d.kpis.purchaseValue.value) + ' ESI Points. Rejected and refunded are excluded. ' +
        'Median time to fulfil: ' + fmtInt(d.purchaseFulfilMinutes) + ' min.',
      exportRows: function () {
        var rows = [['item', 'buyer', 'quantity', 'value', 'status', 'timestamp']];
        d.purchasesTable.forEach(function (p) {
          rows.push([p.item, p.buyer, p.quantity, p.value, p.status, p.at]);
        });
        return rows;
      },
      exportName: csvName('content', 'purchases'),
    });
    purchases.body.appendChild(miniStrip(d.purchaseStatus.map(function (s) {
      return { label: s.label, value: fmtInt(s.value) };
    })));
    purchases.body.appendChild(dataTable({
      columns: [
        { key: 'item',     label: 'Item' },
        { key: 'buyer',    label: 'Buyer' },
        { key: 'quantity', label: 'Qty',    num: true, format: fmtInt },
        { key: 'value',    label: 'Value',  num: true, format: fmtInt },
        { key: 'status',   label: 'Status' },
        { key: 'at',       label: 'When' },
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
      foot: 'Auction rows come from shop.db; views are the list endpoint.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['active_auctions', d.auctions.active],
          ['bids_placed', d.auctions.bids],
          ['bid_value', d.auctions.bidValue],
          ['auction_views', d.auctions.views],
          ['started_in_range', d.auctions.started],
          ['extended', d.auctions.extended],
        ];
      },
      exportName: csvName('content', 'auctions'),
    });
    auctions.body.appendChild(miniStrip([
      { label: 'Active',        value: fmtInt(d.auctions.active) },
      { label: 'Bids placed',   value: fmtInt(d.auctions.bids) },
      { label: 'Bid value',     value: fmtInt(d.auctions.bidValue) },
      { label: 'Auction views', value: fmtInt(d.auctions.views) },
      { label: 'Started',       value: fmtInt(d.auctions.started) },
      { label: 'Extended',      value: fmtInt(d.auctions.extended) },
    ]));
    row5.appendChild(auctions.root);

    var dm = card({
      title: 'DM cards',
      span: 6,
      foot: 'Cards generated by the shop, and auction notices sent.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['cards_generated', d.dmCards.generated],
          ['auction_notices', d.dmCards.auctionNotices],
        ];
      },
      exportName: csvName('content', 'dm-cards'),
    });
    dm.body.appendChild(miniStrip([
      { label: 'Generated',       value: fmtInt(d.dmCards.generated) },
      { label: 'Auction notices', value: fmtInt(d.dmCards.auctionNotices) },
    ]));
    row5.appendChild(dm.root);
    ctx.content.appendChild(row5);

    var row5b = el('div', 'an-grid');
    var adj = card({
      title: 'EP adjustments',
      span: 6,
      foot: 'Manual clean and dirty EP corrections, creator commissions included.',
      exportRows: function () {
        var rows = [['metric', 'value'],
                    ['adjustments', d.epAdjustments.count],
                    ['granted', d.epAdjustments.granted],
                    ['removed', d.epAdjustments.removed]];
        d.epAdjustments.reasons.forEach(function (r) { rows.push(['reason:' + r.label, r.value]); });
        return rows;
      },
      exportName: csvName('content', 'ep-adjustments'),
    });
    adj.body.appendChild(miniStrip([
      { label: 'Adjustments', value: fmtInt(d.epAdjustments.count) },
      { label: 'Granted',     value: fmtInt(d.epAdjustments.granted) },
      { label: 'Removed',     value: fmtInt(d.epAdjustments.removed) },
    ]));
    adj.body.appendChild(rankedRows(d.epAdjustments.reasons, { cls: 'an-c3' }));
    row5b.appendChild(adj.root);

    var don = card({
      title: 'Donations',
      span: 6,
      foot: 'Loot Chest donations converted to Dirty EP.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['tickets', d.donations.tickets],
          ['le_donated', d.donations.le],
          ['dirty_ep_granted', d.donations.dirtyEp],
          ['confirmed', d.donations.confirmed],
          ['rejected', d.donations.rejected],
        ];
      },
      exportName: csvName('content', 'donations'),
    });
    don.body.appendChild(miniStrip([
      { label: 'Tickets',    value: fmtInt(d.donations.tickets) },
      { label: 'LE donated', value: fmtInt(d.donations.le) },
      { label: 'Dirty EP',   value: fmtInt(d.donations.dirtyEp) },
    ]));
    don.body.appendChild(rankedRows([
      { label: 'Confirmed', value: d.donations.confirmed },
      { label: 'Rejected',  value: d.donations.rejected },
    ], { cls: 'an-c2' }));
    row5b.appendChild(don.root);
    ctx.content.appendChild(row5b);

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
      title: 'Graph hover',
      span: 4,
      foot: 'Pointer activity over the graphs. Counted at most once every five seconds.',
      exportRows: function () {
        return [['metric', 'value'], ['hover_events', d.graphInteractions.hover]];
      },
      exportName: csvName('content', 'graph-io'),
    });
    graphIo.body.appendChild(miniStrip([
      { label: 'Hover', value: fmtInt(d.graphInteractions.hover) },
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
        return [['metric', 'value'], ['exemption_page_views', d.inactivity.views]];
      },
      exportName: csvName('content', 'inactivity'),
    });
    inact.body.appendChild(miniStrip([
      { label: 'Page views', value: fmtInt(d.inactivity.views) },
    ]));
    inact.body.appendChild(el('div', 'an-card-note',
      'Views of the exemptions page. Individual exemptions are not tracked.'));
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
      foot: 'Studio page views, and the creator workflow rows from shop.db.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['creator_studio_usage', d.creatorStudio],
          ['applications', d.creator.applications],
          ['applications_approved', d.creator.applicationsApproved],
          ['item_requests', d.creator.itemRequests],
          ['item_requests_approved', d.creator.itemRequestsApproved],
          ['creator_flags', d.creator.flags],
        ];
      },
      exportName: csvName('content', 'creator-studio'),
    });
    studio.body.appendChild(miniStrip([
      { label: 'Page views',      value: fmtInt(d.creatorStudio) },
      { label: 'Applications',    value: fmtInt(d.creator.applications) },
      { label: 'Item requests',   value: fmtInt(d.creator.itemRequests) },
    ]));
    studio.body.appendChild(rankedRows([
      { label: 'Applications approved', value: d.creator.applicationsApproved },
      { label: 'Item requests approved', value: d.creator.itemRequestsApproved },
      { label: 'Creators flagged',       value: d.creator.flags },
    ], { cls: 'an-c1' }));
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
      foot: 'Data exports generated for account holders.',
      exportRows: function () {
        return [['metric', 'value'], ['exports_generated', d.gdpr.generated]];
      },
      exportName: csvName('content', 'gdpr'),
    });
    gdpr.body.appendChild(miniStrip([
      { label: 'Generated', value: fmtInt(d.gdpr.generated) },
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
