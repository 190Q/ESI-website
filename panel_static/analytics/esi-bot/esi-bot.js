(function () {
  'use strict';

  var A = window.ESIAnalytics;
  var el = A.el;
  var card = A.card;
  var segmented = A.segmented;
  var dataTable = A.dataTable;
  var rankedRows = A.rankedRows;
  var rankedCard = A.rankedCard;
  var donut = A.donut;
  var donutCard = A.donutCard;
  var heatmap = A.heatmap;
  var miniStrip = A.miniStrip;
  var panelKpiStrip = A.panelKpiStrip;
  var timeSeriesChart = A.timeSeriesChart;
  var analyticsPanel = A.analyticsPanel;
  var analyticsFoot = A.analyticsFoot;
  var csvName = A.csvName;
  var fmtInt = A.fmtInt;
  var fmtPct = A.fmtPct;
  var fmtDuration = A.fmtDuration;
  var fmtBytes = A.fmtBytes;

  var PANEL_ID = 'analytics-esi-bot';

  // The metric the growth chart plots. Kept in memory
  var _growthMetric = 'recruits';

  var KPI_SPEC = {
    applications: { format: fmtInt, invert: false },
    recruits:     { format: fmtInt, invert: false },
    members:      { format: fmtInt, invert: false },
    epAwarded:    { format: fmtInt, invert: false },
    openTickets:  { format: fmtInt, invert: true  },
    errors:       { format: fmtInt, invert: true  },
  };

  var GROWTH_METRICS = [
    { id: 'recruits',     label: 'Recruits',     key: 'recruits',     cls: 'an-c1', format: fmtInt },
    { id: 'applications', label: 'Applications', key: 'applications', cls: 'an-c2', format: fmtInt },
    { id: 'members',      label: 'Members',      key: 'members',      cls: 'an-c3', format: fmtInt },
    { id: 'wars',         label: 'Wars',         key: 'wars',         cls: 'an-c4', format: fmtInt },
    { id: 'raids',        label: 'Raids',        key: 'raids',        cls: 'an-c6', format: fmtInt },
    { id: 'playtime',     label: 'Playtime',     key: 'playtime',     cls: 'an-c2',
      format: function (v) { return fmtDuration(v * 60); } },
  ];

  function loadBotAnalytics(range) {
    return fetch('/panel/api/bot-analytics?range=' + encodeURIComponent(range), {
      credentials: 'same-origin',
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (d) {
      d.labels = A.bucketLabels(d.buckets, range);
      Object.keys(KPI_SPEC).forEach(function (id) {
        var kpi = d.kpis && d.kpis[id];
        if (!kpi) return;
        kpi.format = KPI_SPEC[id].format;
        kpi.invert = KPI_SPEC[id].invert;
      });
      return d;
    });
  }

  function kvRows(pairs) {
    var host = el('div', 'an-kv');
    pairs.forEach(function (pair) {
      var row = el('div', 'an-kv-row');
      row.appendChild(el('span', 'an-kv-key', pair.label));
      row.appendChild(el('span', 'an-kv-val' + (pair.cls ? ' ' + pair.cls : ''), pair.value));
      host.appendChild(row);
    });
    return host;
  }

  function note(text) {
    return el('div', 'an-card-note', text);
  }

  var _trackerRows = [];

  function formatCountdown(seconds) {
    if (seconds >= 60) return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
    return seconds + 's';
  }

  function renderBotLive(host, bot) {
    host.textContent = '';
    host.appendChild(miniStrip([
      { label: 'Uptime',   value: fmtDuration(bot.uptimeSeconds) },
      { label: 'Restarts', value: fmtInt(bot.restarts) },
      { label: 'Errors',   value: fmtInt(bot.errors) },
    ]));

    _trackerRows = [];
    var list = el('div', 'an-kv');
    bot.trackers.forEach(function (t) {
      var row = el('div', 'an-kv-row');
      row.appendChild(el('span', 'an-kv-key', t.name));
      var value = el('span', 'an-kv-val' + (t.stale ? ' an-esibot-stale' : ''));
      value.textContent = t.stale ? 'Offline' : formatCountdown(t.remainingSeconds);
      row.appendChild(value);
      list.appendChild(row);
      _trackerRows.push({
        el: value, interval: t.interval, remaining: t.remainingSeconds, stale: t.stale,
      });
    });
    var apiRow = el('div', 'an-kv-row');
    apiRow.appendChild(el('span', 'an-kv-key', 'API errors'));
    apiRow.appendChild(el('span', 'an-kv-val', fmtInt(bot.apiErrors)));
    list.appendChild(apiRow);
    host.appendChild(list);
  }

  function tickTrackers() {
    _trackerRows.forEach(function (entry) {
      if (entry.stale || entry.remaining == null) return;
      entry.remaining -= 1;
      if (entry.remaining <= 0) entry.remaining = entry.interval;
      entry.el.textContent = formatCountdown(entry.remaining);
    });
  }

  function pollBotLive(ctx) {
    ctx.every(1000, tickTrackers);
    ctx.every(15000, function () {
      var host = ctx.content.querySelector('[data-live]');
      if (!host || !host.parentNode) return;
      fetch('/panel/api/bot-analytics/live', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (live) {
          if (!live || !host.parentNode) return;
          renderBotLive(host, live);
        })
        .catch(function () { /* a dropped poll is not worth interrupting for */ });
    });
  }

  function buildGrowthRow(d, ctx) {
    var row = el('div', 'an-grid');

    var metric = GROWTH_METRICS.filter(function (m) { return m.id === _growthMetric; })[0] || GROWTH_METRICS[0];
    var picker = segmented(GROWTH_METRICS.map(function (m) {
      return { id: m.id, label: m.label };
    }), metric.id, function (id) {
      _growthMetric = id;
      ctx.rerender();
    });
    picker.classList.add('an-seg--sm');

    var growth = card({
      title: 'Growth over time',
      span: 8,
      tools: [picker],
      exportRows: function () {
        var rows = [['bucket', metric.label]];
        d.labels.forEach(function (label, i) { rows.push([label, d.traffic[metric.key][i]]); });
        return rows;
      },
      exportName: csvName('esi-bot', 'growth-' + metric.id),
    });
    growth.body.appendChild(timeSeriesChart({
      labels: d.labels,
      series: [{ name: metric.label, values: d.traffic[metric.key], cls: metric.cls, area: true }],
      formatValue: metric.format,
      height: 288,
      ariaLabel: metric.label + ' over time',
    }));
    row.appendChild(growth.root);

    var bot = card({
      title: 'Bot & trackers',
      span: 4,
      foot: 'Countdowns are the time to each tracker\u2019s next run; error counts come from the bot log tail.',
      exportRows: function () {
        var rows = [['metric', 'value']];
        rows.push(['uptime_seconds', d.bot.uptimeSeconds]);
        rows.push(['restarts', d.bot.restarts]);
        rows.push(['errors', d.bot.errors]);
        rows.push(['api_errors', d.bot.apiErrors]);
        rows.push(['storage_bytes', d.bot.storageBytes]);
        d.bot.trackers.forEach(function (t) {
          rows.push(['tracker:' + t.name, t.remainingSeconds == null
            ? 'offline' : t.remainingSeconds + 's until next run']);
        });
        return rows;
      },
      exportName: csvName('esi-bot', 'bot-health'),
    });
    var liveHost = el('div');
    liveHost.dataset.live = '1';
    renderBotLive(liveHost, d.bot);
    bot.body.appendChild(liveHost);
    bot.body.appendChild(kvRows([
      { label: 'Storage used', value: fmtBytes(d.bot.storageBytes) },
    ]));
    row.appendChild(bot.root);

    return row;
  }

  function buildRecruitmentRow(d) {
    var row = el('div', 'an-grid');

    var apps = card({
      title: 'Applications',
      span: 6,
      foot: 'Approval rate is approvals over decided applications.',
      exportRows: function () {
        var rows = [['type', 'received', 'approved', 'denied', 'pending', 'approval_rate_pct']];
        d.applications.forEach(function (a) {
          rows.push([a.type, a.received, a.approved, a.denied, a.pending, a.rate.toFixed(1)]);
        });
        return rows;
      },
      exportName: csvName('esi-bot', 'applications'),
    });
    apps.body.appendChild(dataTable({
      columns: [
        { key: 'type',     label: 'Type',     ident: true },
        { key: 'received', label: 'Received', num: true, format: fmtInt },
        { key: 'approved', label: 'Approved', num: true, format: fmtInt },
        { key: 'denied',   label: 'Denied',   num: true, format: fmtInt },
        { key: 'rate',     label: 'Approval', num: true, bar: true, format: function (v) { return fmtPct(v, 1); } },
      ],
      rows: d.applications,
    }));
    apps.body.appendChild(note(
      fmtInt(d.applicationNote.abandoned) + ' of ' + fmtInt(d.applicationNote.started) +
      ' started applications were never submitted.'));
    row.appendChild(apps.root);

    var queue = card({
      title: 'Queue & inactivity',
      span: 6,
      foot: 'Queue wait is measured from the moment an application is queued.',
      exportRows: function () {
        var rows = [['metric', 'value']];
        rows.push(['queue_total', d.queue.total]);
        rows.push(['queue_normal', d.queue.normal]);
        rows.push(['queue_veteran', d.queue.veteran]);
        rows.push(['avg_wait_hours', d.queue.avgWaitHours]);
        rows.push(['exemptions_active', d.queue.exemptions]);
        rows.push(['exemptions_expiring_soon', d.queue.expiringSoon]);
        d.inactivity.forEach(function (i) { rows.push(['inactivity_' + i.label.toLowerCase(), i.value]); });
        return rows;
      },
      exportName: csvName('esi-bot', 'queue-inactivity'),
    });
    queue.body.appendChild(miniStrip([
      { label: 'In queue',    value: fmtInt(d.queue.total) },
      { label: 'Avg wait',    value: fmtDuration(d.queue.avgWaitHours * 3600) },
      { label: 'Exemptions',  value: fmtInt(d.queue.exemptions) },
    ]));
    queue.body.appendChild(rankedRows(d.inactivity, { cls: 'an-c4' }));
    queue.body.appendChild(note(
      fmtInt(d.queue.expiringSoon) + ' exemptions expire within the week.'));
    row.appendChild(queue.root);

    return row;
  }

  function buildVotingRow(d) {
    var row = el('div', 'an-grid');
    var v = d.voting;

    var split = card({
      title: 'Vote split',
      span: 4,
      foot: 'Approve and deny votes cast on applications in range.',
      exportRows: function () {
        return [
          ['metric', 'value'],
          ['approve_votes', v.approve],
          ['deny_votes', v.deny],
          ['voters', v.voters],
          ['applications', v.applications],
          ['votes_per_application', v.votesPerApplication],
          ['reached_threshold', v.reachedThreshold],
          ['below_threshold', v.belowThreshold],
        ];
      },
      exportName: csvName('esi-bot', 'vote-split'),
    });
    split.body.appendChild(miniStrip([
      { label: 'Voters',  value: fmtInt(v.voters) },
      { label: 'Per app', value: v.votesPerApplication.toFixed(1) },
      { label: 'Reached', value: fmtInt(v.reachedThreshold) },
    ]));
    split.body.appendChild(donut([
      { label: 'Approve', value: v.approve },
      { label: 'Deny',    value: v.deny },
    ]));
    if (!v.applications) {
      split.body.appendChild(note('No applications were voted on in this range.'));
    }
    row.appendChild(split.root);

    var most = rankedCard({
      title: 'Most active voters',
      span: 4,
      items: v.mostActive,
      cls: 'an-c1',
      unit: 'voter',
      foot: 'Votes cast in range.',
      exportName: csvName('esi-bot', 'most-active-voters'),
    });
    if (!v.mostActive.length) {
      most.body.appendChild(note('No votes cast in this range.'));
    }
    row.appendChild(most.root);

    var least = rankedCard({
      title: 'Least active voters',
      span: 4,
      items: v.leastActive,
      cls: 'an-c5',
      unit: 'voter',
      foot: 'The quiet end of everyone who has ever voted.',
      exportName: csvName('esi-bot', 'least-active-voters'),
    });
    if (!v.leastActive.length) {
      least.body.appendChild(note('Nobody has voted on an application yet.'));
    }
    row.appendChild(least.root);

    var decisions = card({
      title: 'Voter decisions',
      span: 12,
      foot: 'Everyone with votes in range, and how they leaned.',
      exportRows: function () {
        var rows = [['voter', 'approve', 'deny', 'total', 'deny_rate_pct']];
        v.table.forEach(function (r) {
          rows.push([r.voter, r.approve, r.deny, r.total, r.denyRate.toFixed(1)]);
        });
        return rows;
      },
      exportName: csvName('esi-bot', 'voter-decisions'),
    });
    if (v.table.length) {
      decisions.body.appendChild(dataTable({
        columns: [
          { key: 'voter',    label: 'Voter',   ident: true },
          { key: 'approve',  label: 'Approve', num: true, format: fmtInt },
          { key: 'deny',     label: 'Deny',    num: true, format: fmtInt },
          { key: 'total',    label: 'Total',   num: true, format: fmtInt },
          { key: 'denyRate', label: 'Deny rate', num: true, bar: true,
            format: function (value) { return fmtPct(value, 1); } },
        ],
        rows: v.table,
      }));
    } else {
      decisions.body.appendChild(note('No votes cast in this range.'));
    }
    row.appendChild(decisions.root);

    return row;
  }

  function buildEconomyRow(d) {
    var row = el('div', 'an-grid');

    var economy = donutCard({
      title: 'EP economy',
      span: 4,
      items: [
        { label: 'Clean EP', value: d.ep.clean },
        { label: 'Dirty EP', value: d.ep.dirty },
      ],
      foot: 'Awarded this cycle, split by clean and dirty.',
      unit: 'ep_type',
      exportName: csvName('esi-bot', 'ep-split'),
    });
    economy.body.appendChild(note(
      fmtInt(d.ep.spent) + ' EP spent in the shop \u00b7 ' +
      fmtInt(d.ep.shopPending) + ' purchases pending.'));
    row.appendChild(economy.root);

    var activity = card({
      title: 'Peak activity',
      span: 4,
      foot: 'Guild members last seen online, by weekday and hour, in UTC.',
      exportRows: function () {
        var header = ['weekday'];
        for (var h = 0; h < 24; h++) header.push(h + ':00');
        var rows = [header];
        d.activity.peakHours.forEach(function (r, idx) {
          rows.push([A.DAY_LABELS[idx]].concat(r));
        });
        return rows;
      },
      exportName: csvName('esi-bot', 'peak-activity'),
    });
    activity.body.appendChild(heatmap(d.activity.peakHours, 'members'));
    row.appendChild(activity.root);

    row.appendChild(rankedCard({
      title: 'Top EP earners',
      span: 4,
      items: d.ep.topEarners,
      cls: 'an-c1',
      unit: 'player',
      foot: 'Points earned this cycle.',
      exportName: csvName('esi-bot', 'top-earners'),
    }).root);

    return row;
  }

  function buildOpsRow(d) {
    var row = el('div', 'an-grid');

    var mod = card({
      title: 'Moderation & staff',
      span: 6,
      foot: 'Rank changes recorded in range, by executor.',
      exportRows: function () {
        var rows = [['metric', 'value']];
        rows.push(['blacklist_active', d.moderation.blacklist]);
        rows.push(['alt_links', d.moderation.altLinks]);
        rows.push(['command_bans', d.moderation.bans]);
        d.moderation.rankChanges.forEach(function (r) { rows.push(['rank_changes:' + r.label, r.value]); });
        return rows;
      },
      exportName: csvName('esi-bot', 'moderation'),
    });
    mod.body.appendChild(miniStrip([
      { label: 'Blacklisted',  value: fmtInt(d.moderation.blacklist) },
      { label: 'Alt links',    value: fmtInt(d.moderation.altLinks) },
      { label: 'Command bans', value: fmtInt(d.moderation.bans) },
    ]));
    mod.body.appendChild(rankedRows(d.moderation.rankChanges, { cls: 'an-c5' }));
    row.appendChild(mod.root);

    var tickets = card({
      title: 'Support tickets',
      span: 6,
      foot: 'First response is measured from ticket creation.',
      exportRows: function () {
        var rows = [['metric', 'value']];
        rows.push(['open', d.tickets.open]);
        rows.push(['acknowledged', d.tickets.acknowledged]);
        rows.push(['archived', d.tickets.archived]);
        rows.push(['avg_close_hours', d.tickets.avgCloseHours]);
        rows.push(['avg_first_response_hours', d.tickets.avgFirstResponseHours]);
        rows.push(['busiest_subject', d.tickets.busiest]);
        return rows;
      },
      exportName: csvName('esi-bot', 'support-tickets'),
    });
    tickets.body.appendChild(kvRows([
      { label: 'Open',                   value: fmtInt(d.tickets.open), cls: 'an-esibot-stale' },
      { label: 'Acknowledged',           value: fmtInt(d.tickets.acknowledged) },
      { label: 'Archived in range',      value: fmtInt(d.tickets.archived) },
      { label: 'Average close',          value: fmtDuration(d.tickets.avgCloseHours * 3600) },
      { label: 'Average first response', value: fmtDuration(d.tickets.avgFirstResponseHours * 3600) },
      { label: 'Busiest subject',        value: d.tickets.busiest },
    ]));
    row.appendChild(tickets.root);

    return row;
  }

  function buildUsageRow(d) {
    var row = el('div', 'an-grid');

    var commands = rankedCard({
      title: 'Most used commands',
      span: 6,
      items: d.commands,
      cls: 'an-c3',
      unit: 'command',
      exportName: csvName('esi-bot', 'commands'),
    });
    if (!d.commands.length) {
      commands.body.appendChild(note('No command usage recorded in this range.'));
    }
    row.appendChild(commands.root);

    var errors = card({
      title: 'Most recurring errors',
      span: 6,
      foot: 'From the retained tail of the bot log, which carries no timestamps.',
      exportRows: function () {
        var rows = [['error', 'count']];
        d.bot.topErrors.forEach(function (e) { rows.push([e.label, e.value]); });
        return rows;
      },
      exportName: csvName('esi-bot', 'errors'),
    });
    if (d.bot.topErrors.length) {
      errors.body.appendChild(rankedRows(d.bot.topErrors, { cls: 'an-c5' }));
    } else {
      errors.body.appendChild(note('No errors in the retained log tail.'));
    }
    errors.root.classList.add('an-esibot-errors');
    row.appendChild(errors.root);

    var features = rankedCard({
      title: 'Feature usage',
      span: 6,
      items: d.features,
      cls: 'an-c4',
      unit: 'feature',
      exportName: csvName('esi-bot', 'features'),
    });
    if (!d.features.length) {
      features.body.appendChild(note('No feature usage recorded in this range.'));
    }
    row.appendChild(features.root);

    return row;
  }

  function buildBotAnalytics(container) {
    return analyticsPanel({
      container: container,
      label: 'ESI-Bot',
      load: loadBotAnalytics,
      exportRows: botExportRows,
      exportName: function () { return csvName('esi-bot', 'overview'); },
      render: renderBotAnalytics,
    });
  }

  function botExportRows(d) {
    var rows = [['section', 'metric', 'value', 'range', 'generated_at']];
    function push(section, metric, value) {
      rows.push([section, metric, value, d.range, d.generatedAt]);
    }
    Object.keys(d.kpis).forEach(function (id) {
      push('kpi', id, Math.round(d.kpis[id].value * 100) / 100);
    });
    d.applications.forEach(function (a) { push('applications', a.type, a.received); });
    d.inactivity.forEach(function (i) { push('inactivity', i.label, i.value); });
    push('voting', 'approve_votes', d.voting.approve);
    push('voting', 'deny_votes', d.voting.deny);
    d.voting.table.forEach(function (r) { push('voter_total', r.voter, r.total); });
    d.ep.byReason.forEach(function (r) { push('ep_reason', r.label, r.value); });
    d.ep.topEarners.forEach(function (e) { push('ep_earner', e.label, e.value); });
    d.activity.topPlaytime.forEach(function (p) { push('playtime', p.label, p.value); });
    d.moderation.rankChanges.forEach(function (r) { push('rank_change_executor', r.label, r.value); });
    d.bot.topErrors.forEach(function (e) { push('error', e.label, e.value); });
    d.commands.forEach(function (c) { push('command', c.label, c.value); });
    d.features.forEach(function (f) { push('feature', f.label, f.value); });
    return rows;
  }

  function renderBotAnalytics(ctx) {
    var d = ctx.data;
    ctx.content.appendChild(panelKpiStrip(d, [
      { id: 'applications', label: 'Applications', cls: 'an-c2', hint: 'Applications received in range' },
      { id: 'recruits',     label: 'Recruits',     cls: 'an-c1', hint: 'Members recruited in range' },
      { id: 'members',      label: 'Members',      cls: 'an-c3', hint: 'Tracked guild members now' },
      { id: 'epAwarded',    label: 'EP awarded',   cls: 'an-c4', hint: 'ESI points awarded this cycle' },
      { id: 'openTickets',  label: 'Open tickets', cls: 'an-c6', hint: 'Support tickets awaiting a response' },
      { id: 'errors',       label: 'Bot errors',   cls: 'an-c5', hint: 'Errors in the recent bot log' },
    ]));
    ctx.content.appendChild(buildGrowthRow(d, ctx));
    ctx.content.appendChild(buildRecruitmentRow(d));
    ctx.content.appendChild(buildVotingRow(d));
    ctx.content.appendChild(buildEconomyRow(d));
    ctx.content.appendChild(buildOpsRow(d));
    ctx.content.appendChild(buildUsageRow(d));
    ctx.content.appendChild(analyticsFoot(d));
    pollBotLive(ctx);
  }

  A.registerPanel(PANEL_ID, { build: buildBotAnalytics });

  window.ESIPanel.registerItem({
    section: 'analytics',
    order: 8,
    id: PANEL_ID,
    type: 'analytics',
    label: 'ESI-Bot',
    icon: 'bot',
    subtitle: 'Growth, activity, economy and health for ESI-Bot.',
  });
})();
