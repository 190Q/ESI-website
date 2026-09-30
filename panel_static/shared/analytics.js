/**
 * shared/analytics.js - analytics core.
 *
 * Owns the panel registry plus every primitive the analytics panels share:
 * formatting, CSV export, the chart, tables, cards, donuts, ranked bars, the
 * heatmap, and the panel shell with its toolbar, tab strip and request guard.
 *
 * Each panel lives in its own directory under analytics/ and registers itself
 * with ESIAnalytics.registerPanel() as it loads.
 *
 * Conventions:
 *   - Build DOM with createElement/textContent, never by interpolating values
 *     into an innerHTML string. Analytics values (paths, user agents,
 *     referrers, event names) are attacker-influenced.
 *   - No literal colours or font families; everything comes from the theme.
 */
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  // Flip to false once /panel/api/analytics/overview exists. While true every
  // panel renders from the demo dataset below and the toolbar shows a
  // "Demo data" badge so it can never be mistaken for real traffic.
  var USE_DEMO_DATA = true;

  // Demo scaffolding shared by Overview, Traffic and Audience so the three
  // panels agree on the bucket labels and the request series. Delete along with
  // USE_DEMO_DATA once the analytics API exists.
  function demoBase(range) {
    var spec = RANGE_SPEC[range] || RANGE_SPEC['7d'];
    var rand = rng(9137 + range.length * 977);
    var n = spec.points;
    var labels = [];
    var now = Date.now();
    for (var i = n - 1; i >= 0; i--) {
      labels.push(spec.label(new Date(now - i * spec.stepMs)));
    }

    function series(base, spread, trend) {
      var out = [];
      for (var i = 0; i < n; i++) {
        var t = n > 1 ? i / (n - 1) : 0;
        var v = base * (1 + trend * t) + (rand() - 0.5) * spread;
        out.push(Math.max(0, Math.round(v)));
      }
      return out;
    }

    return {
      labels: labels,
      traffic: {
        requests: series(2400, 900, 0.35),
        visitors: series(520, 160, 0.22),
        errors: series(14, 12, -0.2),
        p95: series(310, 120, 0.08),
        blocked: series(38, 40, 0.1),
      },
    };
  }

  function trendSeries(value, n, spread, rand) {
    var out = [];
    for (var i = 0; i < n; i++) {
      var t = n > 1 ? i / (n - 1) : 0;
      var drift = 1 + (t - 0.5) * 0.12;
      out.push(Math.max(0, value * drift * (1 + (rand() - 0.5) * spread)));
    }
    return out;
  }

  var RANGES = [
    { id: '24h', label: '24h' },
    { id: '7d',  label: '7d'  },
    { id: '30d', label: '30d' },
    { id: '90d', label: '90d' },
    { id: 'all', label: 'All' },
  ];

  var RANGE_SPEC = {
    '24h': { points: 24, stepMs: 3600e3,      label: function (d) { return d.getHours() + ':00'; } },
    '7d':  { points: 7,  stepMs: 86400e3,     label: function (d) { return d.toLocaleDateString('en-GB', { weekday: 'short' }); } },
    '30d': { points: 30, stepMs: 86400e3,     label: function (d) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } },
    '90d': { points: 45, stepMs: 2 * 86400e3, label: function (d) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } },
    'all': { points: 26, stepMs: 7 * 86400e3, label: function (d) { return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); } },
  };

  // Series the traffic chart can plot. `invert` marks metrics where a rise is bad, so delta colouring can flip.
  var METRICS = [
    { id: 'requests', label: 'Requests', key: 'requests', cls: 'an-c1', format: fmtCompact, invert: false },
    { id: 'visitors', label: 'Visitors', key: 'visitors', cls: 'an-c2', format: fmtCompact, invert: false },
    { id: 'errors',   label: 'Errors',   key: 'errors',   cls: 'an-c5', format: fmtCompact, invert: true  },
    { id: 'latency',  label: 'Latency',  key: 'p95',      cls: 'an-c3', format: fmtMs,      invert: true  },
    { id: 'blocked',  label: 'Blocked',  key: 'blocked',  cls: 'an-c6', format: fmtCompact, invert: false },
  ];

  var STATE_KEY = 'esi.analytics.state';
  var DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  var _state = readState();
  var _mounted = {};   // panelId -> { container, dispose }

  function readState() {
    var def = { range: '7d', metric: 'requests', latencyMetric: 'p95', visitorMetric: 'total', compare: true };
    try {
      var raw = JSON.parse(localStorage.getItem(STATE_KEY));
      if (raw && typeof raw === 'object') {
        if (RANGES.some(function (r) { return r.id === raw.range; })) def.range = raw.range;
        if (METRICS.some(function (m) { return m.id === raw.metric; })) def.metric = raw.metric;
        if (['p50', 'p95', 'p99'].indexOf(raw.latencyMetric) !== -1) def.latencyMetric = raw.latencyMetric;
        if (['total', 'new', 'returning'].indexOf(raw.visitorMetric) !== -1) def.visitorMetric = raw.visitorMetric;
        if (typeof raw.compare === 'boolean') def.compare = raw.compare;
      }
    } catch (e) { /* storage disabled - fall back to defaults */ }
    return def;
  }

  function writeState() {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify({
        range: _state.range,
        metric: _state.metric,
        latencyMetric: _state.latencyMetric,
        visitorMetric: _state.visitorMetric,
        compare: _state.compare,
      }));
    } catch (e) { /* non-fatal */ }
  }

  function readTabState(key, fallback) {
    try { return localStorage.getItem('esi.analytics.tab.' + key) || fallback; } catch (e) { return fallback; }
  }

  function writeTabState(key, id) {
    try { localStorage.setItem('esi.analytics.tab.' + key, id); } catch (e) { /* non-fatal */ }
  }

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }

  function svgEl(tag, attrs) {
    var e = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    }
    return e;
  }

  function toast(message, type) {
    if (typeof window.showToast === 'function') window.showToast(message, type || 'info');
  }

  function fmtInt(v) {
    if (v == null || isNaN(v)) return '\u2014';
    return Math.round(Number(v)).toLocaleString('en-GB');
  }

  function fmtCompact(v) {
    if (v == null || isNaN(v)) return '\u2014';
    var n = Number(v);
    var abs = Math.abs(n);
    if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (abs >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
    return Math.round(n).toLocaleString('en-GB');
  }

  function fmtMs(v) {
    if (v == null || isNaN(v)) return '\u2014';
    var n = Number(v);
    if (n >= 1000) return (n / 1000).toFixed(2) + ' s';
    return Math.round(n) + ' ms';
  }

  function fmtDuration(seconds) {
    if (seconds == null || isNaN(seconds)) return '\u2014';
    var s = Math.max(0, Math.round(Number(seconds)));
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + (s % 60) + 's';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  }

  function fmtBytes(v) {
    if (v == null || isNaN(v)) return '\u2014';
    var n = Number(v);
    var units = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return (i === 0 ? Math.round(n) : n.toFixed(n < 10 ? 1 : 0)) + ' ' + units[i];
  }

  function fmtPct(v, digits) {
    if (v == null || isNaN(v)) return '\u2014';
    return Number(v).toFixed(digits == null ? 2 : digits) + '%';
  }

  function fmtDateTime(iso) {
    var d = iso ? new Date(iso) : new Date();
    if (isNaN(d.getTime())) return '\u2014';
    return d.toLocaleString('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  // Deterministic PRNG so demo figures stay stable between re-renders.
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function deltaPct(value, prev) {
    if (!prev) return null;
    return ((value - prev) / prev) * 100;
  }

  function sumOf(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
  function avgOf(a) { return a.length ? sumOf(a) / a.length : 0; }

  // Quote for RFC 4180 and neutralise spreadsheet formula injection - a
  // request path like "=cmd|'/c calc'!A1" must never execute when the export
  // is opened in Excel.
  function csvCell(value) {
    var s = value == null ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function downloadCsv(filename, rows) {
    var body = rows.map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\r\n');
    // BOM so Excel reads it as UTF-8 rather than the local codepage.
    var blob = new Blob(['\ufeff' + body], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 0);
  }

  function stamp() {
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function sparkline(values, cls) {
    var svg = svgEl('svg', {
      viewBox: '0 0 100 28',
      preserveAspectRatio: 'none',
      'class': 'an-spark',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    if (!values || values.length < 2) return svg;
    var max = Math.max.apply(null, values);
    var min = Math.min.apply(null, values);
    var span = (max - min) || 1;
    var pts = values.map(function (v, i) {
      var x = (i / (values.length - 1)) * 100;
      var y = 26 - ((v - min) / span) * 24;
      return x.toFixed(2) + ',' + y.toFixed(2);
    });
    svg.appendChild(svgEl('polyline', {
      points: pts.join(' '),
      'class': 'an-spark-line ' + (cls || 'an-c1'),
    }));
    return svg;
  }

  var CHART_PAD = { top: 18, right: 14, bottom: 28, left: 44 };

  /**
   * Interactive time-series chart, styled and driven the same way as the
   * player/guild graph panels: gold series on the graph background, 10%
   * headroom above the peak, a hover line down the plot and a tooltip that
   * follows the cursor.
   *
   * Renders at the container's real pixel size so strokes stay crisp, and
   * re-renders on resize - which also covers the 0 -> N transition when a
   * hidden panel becomes active.
   */
  function timeSeriesChart(opts) {
    var wrap = el('div', 'an-chart-wrap');
    var svg = svgEl('svg', { 'class': 'an-chart', role: 'img', 'aria-label': opts.ariaLabel || 'Time series' });
    wrap.appendChild(svg);

    var vline = el('div', 'an-chart-vline');
    wrap.appendChild(vline);
    var xbadge = el('div', 'an-chart-xbadge');
    wrap.appendChild(xbadge);
    var tip = el('div', 'an-chart-tooltip');
    wrap.appendChild(tip);

    var labels = opts.labels || [];
    var series = opts.series || [];
    var fmt = opts.formatValue || fmtInt;
    var height = opts.height || 268;
    var geom = null;

    function hideHover() {
      vline.style.display = 'none';
      xbadge.style.display = 'none';
      tip.style.display = 'none';
    }

    function render() {
      var w = wrap.clientWidth;
      if (!w || !labels.length) return;
      var h = height;
      var n = labels.length;
      var plotH = Math.max(1, h - CHART_PAD.top - CHART_PAD.bottom);

      var peak = 0;
      series.forEach(function (s) {
        s.values.forEach(function (v) { if (v > peak) peak = v; });
      });
      var top = (peak * 1.1) || 1;

      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      var STEPS = 4;
      var yLabels = [];
      for (var g = 0; g <= STEPS; g++) {
        var label = svgEl('text', {
          y: (CHART_PAD.top + (plotH * g) / STEPS + 3).toFixed(1),
          'class': 'an-chart-axis an-chart-axis--y', 'text-anchor': 'end',
        });
        label.textContent = fmt(top * (1 - g / STEPS));
        svg.appendChild(label);
        yLabels.push(label);
      }

      var labelW = 0;
      yLabels.forEach(function (el) {
        try { labelW = Math.max(labelW, el.getBBox().width); } catch (e) { /* not measurable yet */ }
      });
      var padLeft = Math.ceil(labelW) + 10;
      if (!(padLeft > CHART_PAD.left)) padLeft = CHART_PAD.left;
      var padCap = Math.max(CHART_PAD.left, Math.floor(w * 0.4));
      if (padLeft > padCap) padLeft = padCap;

      var plotW = Math.max(1, w - padLeft - CHART_PAD.right);

      function xAt(i) { return padLeft + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW); }
      function yAt(v) { return CHART_PAD.top + plotH - (Math.min(v, top) / top) * plotH; }

      for (var g2 = 0; g2 <= STEPS; g2++) {
        var gy = CHART_PAD.top + (plotH * g2) / STEPS;
        svg.appendChild(svgEl('line', {
          x1: padLeft, y1: gy.toFixed(1),
          x2: padLeft + plotW, y2: gy.toFixed(1),
          'class': 'an-chart-grid',
        }));
      }

      yLabels.forEach(function (el) {
        el.setAttribute('x', padLeft - 6);
        svg.appendChild(el);
      });
      var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 96))));
      for (var i = 0; i < n; i += every) {
        var xLabel = svgEl('text', {
          x: xAt(i).toFixed(1), y: (CHART_PAD.top + plotH + 16).toFixed(1),
          'class': 'an-chart-axis an-chart-axis--x', 'text-anchor': 'middle',
        });
        xLabel.textContent = labels[i];
        svg.appendChild(xLabel);
      }

      series.forEach(function (s) {
        var pts = s.values.map(function (v, i) { return xAt(i).toFixed(1) + ',' + yAt(v).toFixed(1); });
        if (pts.length < 2) return;
        if (s.area) {
          svg.appendChild(svgEl('path', {
            d: 'M' + xAt(0).toFixed(1) + ',' + (CHART_PAD.top + plotH).toFixed(1) +
               'L' + pts.join('L') +
               'L' + xAt(n - 1).toFixed(1) + ',' + (CHART_PAD.top + plotH).toFixed(1) + 'Z',
            'class': 'an-chart-area',
          }));
        }
        svg.appendChild(svgEl('polyline', { points: pts.join(' '), 'class': 'an-chart-line' }));
      });

      if (n <= 60) {
        var r = n === 1 ? 4.5 : (n > 30 ? 1.5 : 2.5);
        series.forEach(function (s) {
          s.values.forEach(function (v, i) {
            svg.appendChild(svgEl('circle', {
              cx: xAt(i).toFixed(1), cy: yAt(v).toFixed(1), r: r, 'class': 'an-chart-point',
            }));
          });
        });
      }

      geom = { padLeft: padLeft, plotW: plotW, plotH: plotH, n: n, xAt: xAt };
    }

    wrap.addEventListener('mousemove', function (ev) {
      if (!geom) { hideHover(); return; }
      var box = wrap.getBoundingClientRect();
      var mx = ev.clientX - box.left;
      var my = ev.clientY - box.top;

      var inPlot = mx >= geom.padLeft && mx <= geom.padLeft + geom.plotW &&
                   my >= CHART_PAD.top && my <= CHART_PAD.top + geom.plotH;
      if (!inPlot) { hideHover(); return; }

      var idx = geom.n > 1
        ? Math.max(0, Math.min(geom.n - 1, Math.round(((mx - geom.padLeft) / geom.plotW) * (geom.n - 1))))
        : 0;
      var x = geom.xAt(idx);

      vline.style.display = 'block';
      vline.style.left = x + 'px';
      vline.style.top = '0px';
      vline.style.height = (CHART_PAD.top + geom.plotH + 4) + 'px';

      xbadge.style.display = 'block';
      xbadge.textContent = labels[idx];
      xbadge.style.left = x + 'px';
      xbadge.style.top = (CHART_PAD.top + geom.plotH + 8) + 'px';

      tip.textContent = '';
      series.forEach(function (s) {
        var row = el('div', 'an-tip-row');
        row.appendChild(el('span', 'an-tip-swatch'));
        row.appendChild(el('span', 'an-tip-name', s.name));
        row.appendChild(el('span', 'an-tip-val', fmt(s.values[idx])));
        tip.appendChild(row);
      });
      tip.style.display = 'block';
      positionChartTooltip(tip, wrap, mx, my);
    });
    wrap.addEventListener('mouseleave', hideHover);

    wrap._anRender = render;
    requestAnimationFrame(render);
    return wrap;
  }

  function positionChartTooltip(tip, wrap, x, y) {
    var margin = 8, offset = 14;
    var left = x + offset;
    var top = y + offset;
    if (left > wrap.clientWidth - tip.offsetWidth - margin) left = x - tip.offsetWidth - offset;
    if (top > wrap.clientHeight - tip.offsetHeight - margin) top = y - tip.offsetHeight - offset;
    if (left < margin) left = margin;
    if (top < margin) top = margin;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  // Horizontal ranked bars, for rankings that read better as a list than a chart.
  function rankedRows(items, opts) {
    opts = opts || {};
    function barValue(it) {
      var v = Number(it.value);
      return isFinite(v) ? v : 0;
    }
    var max = items.reduce(function (m, it) { return Math.max(m, barValue(it)); }, 0) || 1;
    var root = el('div', 'an-rows');
    items.forEach(function (it) {
      var row = el('div', 'an-row');
      var head = el('div', 'an-row-head');
      head.appendChild(el('span', 'an-row-label', it.label));
      head.appendChild(el('span', 'an-row-value', opts.format ? opts.format(it.value) : fmtInt(it.value)));
      row.appendChild(head);
      var track = el('div', 'an-row-track');
      var fill = el('div', 'an-row-fill ' + (opts.cls || 'an-c1'));
      fill.style.width = Math.max(1.5, (barValue(it) / max) * 100).toFixed(2) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      root.appendChild(row);
    });
    return root;
  }

  function donut(items) {
    var wrap = el('div', 'an-donut-wrap');
    var total = items.reduce(function (s, it) { return s + it.value; }, 0) || 1;
    var size = 148, r = 54, cx = size / 2, cy = size / 2;
    var circumference = 2 * Math.PI * r;

    var ring = el('div', 'an-donut-ring');

    var svg = svgEl('svg', {
      viewBox: '0 0 ' + size + ' ' + size,
      'class': 'an-donut',
      'aria-hidden': 'true',
      focusable: 'false',
    });
    svg.appendChild(svgEl('circle', { cx: cx, cy: cy, r: r, 'class': 'an-donut-track' }));

    var offset = 0;
    items.forEach(function (it, i) {
      var frac = it.value / total;
      svg.appendChild(svgEl('circle', {
        cx: cx, cy: cy, r: r,
        'class': 'an-donut-seg an-c' + ((i % 6) + 1),
        'stroke-dasharray': (frac * circumference).toFixed(2) + ' ' + circumference.toFixed(2),
        'stroke-dashoffset': (-offset * circumference).toFixed(2),
      }));
      offset += frac;
    });

    ring.appendChild(svg);
    ring.appendChild(el('div', 'an-donut-total', fmtCompact(total)));
    wrap.appendChild(ring);

    var legend = el('div', 'an-legend');
    items.forEach(function (it, i) {
      var row = el('div', 'an-legend-item');
      row.appendChild(el('span', 'an-legend-swatch an-c' + ((i % 6) + 1)));
      row.appendChild(el('span', 'an-legend-label', it.label));
      row.appendChild(el('span', 'an-legend-value', fmtPct((it.value / total) * 100, 1)));
      legend.appendChild(row);
    });
    wrap.appendChild(legend);
    return wrap;
  }

  function heatmap(grid) {
    var max = 0;
    grid.forEach(function (row) { row.forEach(function (v) { if (v > max) max = v; }); });
    if (!max) max = 1;

    var root = el('div', 'an-heat');
    var head = el('div', 'an-heat-row an-heat-row--head');
    head.appendChild(el('span', 'an-heat-corner'));
    for (var h = 0; h < 24; h++) {
      head.appendChild(el('span', 'an-heat-hour', h % 3 === 0 ? String(h) : ''));
    }
    root.appendChild(head);

    grid.forEach(function (row, d) {
      var line = el('div', 'an-heat-row');
      line.appendChild(el('span', 'an-heat-day', DAY_LABELS[d] || ''));
      row.forEach(function (v, h) {
        var cell = el('span', 'an-heat-cell');
        // Opacity carries the intensity so no colour value is ever hardcoded.
        cell.style.opacity = (0.08 + (v / max) * 0.92).toFixed(3);
        cell.title = (DAY_LABELS[d] || '') + ' ' + h + ':00 \u2014 ' + fmtInt(v) + ' requests';
        line.appendChild(cell);
      });
      root.appendChild(line);
    });

    var legend = el('div', 'an-heat-legend');
    legend.appendChild(el('span', 'an-heat-legend-label', 'Low'));
    for (var i = 0; i < 5; i++) {
      var sw = el('span', 'an-heat-cell');
      sw.style.opacity = (0.08 + (i / 4) * 0.92).toFixed(3);
      legend.appendChild(sw);
    }
    legend.appendChild(el('span', 'an-heat-legend-label', 'High'));
    root.appendChild(legend);
    return root;
  }

  function card(opts) {
    var root = el('section', 'an-card an-span-' + (opts.span || 12));

    var head = el('div', 'an-card-head');
    head.appendChild(el('h2', 'an-card-title', opts.title));
    var tools = el('div', 'an-card-tools');
    if (opts.tools) opts.tools.forEach(function (t) { tools.appendChild(t); });

    if (typeof opts.exportRows === 'function') {
      var btn = el('button', 'an-icon-btn', '\u2b07');
      btn.type = 'button';
      btn.title = 'Download this card as CSV';
      btn.setAttribute('aria-label', 'Download ' + opts.title + ' as CSV');
      btn.addEventListener('click', function () {
        downloadCsv(opts.exportName || ('analytics-' + stamp() + '.csv'), opts.exportRows());
        toast('Downloaded \u201c' + opts.title + '\u201d as CSV', 'success');
      });
      tools.appendChild(btn);
    }
    if (tools.childNodes.length) head.appendChild(tools);
    root.appendChild(head);

    var body = el('div', 'an-card-body');
    root.appendChild(body);
    if (opts.foot) root.appendChild(el('div', 'an-card-foot', opts.foot));
    return { root: root, body: body };
  }

  function segmented(options, activeId, onSelect) {
    var root = el('div', 'an-seg');
    root.setAttribute('role', 'group');
    options.forEach(function (opt) {
      var btn = el('button', 'an-seg-btn' + (opt.id === activeId ? ' active' : ''), opt.label);
      btn.type = 'button';
      btn.setAttribute('aria-pressed', opt.id === activeId ? 'true' : 'false');
      btn.addEventListener('click', function () { onSelect(opt.id); });
      root.appendChild(btn);
    });
    return root;
  }

  function switchToggle(label, checked, onChange) {
    var wrap = el('label', 'an-switch settings-toggle');
    var input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = !!checked;
    input.addEventListener('change', function () { onChange(input.checked); });
    var track = el('span', 'settings-toggle-track');
    track.setAttribute('aria-hidden', 'true');
    track.appendChild(el('span', 'settings-toggle-thumb'));
    wrap.appendChild(input);
    wrap.appendChild(track);
    wrap.appendChild(el('span', 'an-switch-label', label));
    return wrap;
  }

  function dataTable(opts) {
    var wrap = el('div', 'an-table-wrap');
    var table = el('table', 'an-table');

    var thead = document.createElement('thead');
    var hrow = document.createElement('tr');
    opts.columns.forEach(function (col) {
      var th = document.createElement('th');
      th.textContent = col.label;
      if (col.num) th.className = 'is-num';
      hrow.appendChild(th);
    });
    thead.appendChild(hrow);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    opts.rows.forEach(function (row) {
      var tr = document.createElement('tr');
      opts.columns.forEach(function (col) {
        var td = document.createElement('td');
        if (col.num) td.className = 'is-num';
        if (col.ident) td.classList.add('is-ident');
        var value = row[col.key];
        if (col.bar) {
          var track = el('div', 'an-row-track an-row-track--inline');
          var fill = el('div', 'an-row-fill an-c1');
          fill.style.width = Math.max(1, Math.min(100, Number(value) || 0)).toFixed(1) + '%';
          track.appendChild(fill);
          td.appendChild(track);
          td.appendChild(el('span', 'an-bar-note', col.format ? col.format(value) : String(value)));
        } else {
          td.textContent = col.format ? col.format(value) : (value == null ? '\u2014' : String(value));
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  function kpiTile(id, kpi, opts) {
    opts = opts || {};
    var tile = el('button', 'an-kpi');
    tile.type = 'button';
    tile.dataset.kpi = id;
    tile.title = opts.hint || '';
    if (opts.cls) tile.classList.add(opts.cls);

    tile.appendChild(el('div', 'an-kpi-label', opts.label || id));
    var value = el('div', 'an-kpi-value');
    value.appendChild(el('span', 'an-kpi-number', kpi.format(kpi.value)));
    tile.appendChild(value);

    if (opts.compare && kpi.prev != null) {
      var d = deltaPct(kpi.value, kpi.prev);
      if (d != null) {
        var good = kpi.invert ? d < 0 : d > 0;
        var dir = Math.abs(d) < 0.05 ? 'flat' : (good ? 'up' : 'down');
        var row = el('div', 'an-kpi-delta is-' + dir);
        row.appendChild(el('span', 'an-kpi-arrow', Math.abs(d) < 0.05 ? '\u2014' : (d > 0 ? '\u25b2' : '\u25bc')));
        row.appendChild(el('span', null, Math.abs(d).toFixed(1) + '%'));
        row.appendChild(el('span', 'an-kpi-delta-note', 'vs prev'));
        tile.appendChild(row);
      }
    } else {
      tile.appendChild(el('div', 'an-kpi-delta is-none', '\u2014'));
    }

    var spark = el('div', 'an-kpi-spark');
    if (kpi.series && kpi.series.length > 1) {
      spark.appendChild(sparkline(kpi.series, opts.cls || 'an-c1'));
    }
    tile.appendChild(spark);
    return tile;
  }

  function analyticsPanel(cfg) {
    var root = el('div', 'an-panel');
    cfg.container.appendChild(root);

    var ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(function (entries) {
        entries.forEach(function (entry) {
          if (typeof entry.target._anRender === 'function') entry.target._anRender();
        });
      });
    }

    var toolbar = el('div', 'an-toolbar');
    var tabsHost = cfg.tabs ? el('div', 'an-tabs') : null;
    var content = el('div', 'an-content');
    var intervals = [];
    var data = null;
    var requestId = 0;
    var tab = null;
    if (cfg.tabs) {
      tab = readTabState(cfg.tabKey, cfg.tabs[0].id);
      if (!cfg.tabs.some(function (t) { return t.id === tab; })) tab = cfg.tabs[0].id;
    }

    function clearIntervals() {
      intervals.forEach(function (id) { clearInterval(id); });
      intervals = [];
    }

    function renderToolbar() {
      toolbar.textContent = '';

      var rangeGroup = el('div', 'an-toolbar-group');
      rangeGroup.appendChild(el('span', 'an-toolbar-label', 'Range'));
      rangeGroup.appendChild(segmented(RANGES, _state.range, function (id) {
        _state.range = id;
        writeState();
        render();
      }));
      toolbar.appendChild(rangeGroup);

      var end = el('div', 'an-toolbar-group an-toolbar-group--end');
      end.appendChild(switchToggle('Compare', _state.compare, function (on) {
        _state.compare = on;
        writeState();
        render();
      }));

      var refresh = el('button', 'an-btn', '\u27f3 Refresh');
      refresh.type = 'button';
      refresh.addEventListener('click', function () {
        render();
        toast(cfg.label + ' refreshed', 'info');
      });
      end.appendChild(refresh);

      if (typeof cfg.exportRows === 'function') {
        var exportBtn = el('button', 'an-btn', '\u2b07 Export');
        exportBtn.type = 'button';
        exportBtn.title = 'Download the current view as CSV';
        exportBtn.addEventListener('click', function () {
          if (!data) return;
          downloadCsv(cfg.exportName(data, tab), cfg.exportRows(data, tab));
          toast('Downloaded ' + cfg.label + ' as CSV', 'success');
        });
        end.appendChild(exportBtn);
      }

      if (USE_DEMO_DATA) {
        var badge = el('span', 'an-badge', 'Demo data');
        badge.title = 'Placeholder figures - no analytics API is connected yet';
        end.appendChild(badge);
      }

      toolbar.appendChild(end);
    }

    function renderTabs() {
      if (!tabsHost) return;
      tabsHost.textContent = '';
      cfg.tabs.forEach(function (t) {
        var btn = el('button', 'an-tab' + (t.id === tab ? ' active' : ''), t.label);
        btn.type = 'button';
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', t.id === tab ? 'true' : 'false');
        btn.addEventListener('click', function () {
          if (tab === t.id) return;
          tab = t.id;
          writeTabState(cfg.tabKey, tab);
          render();
        });
        tabsHost.appendChild(btn);
      });
    }

    function render() {
      clearIntervals();
      renderToolbar();
      renderTabs();
      content.textContent = '';
      if (ro) ro.disconnect();
      var token = ++requestId;

      cfg.load(_state.range).then(function (d) {
        if (token !== requestId) return;
        data = d;
        cfg.render({
          content: content,
          data: d,
          tab: tab,
          compare: _state.compare,
          rerender: render,
          every: function (ms, fn) { intervals.push(setInterval(fn, ms)); },
        });
        if (ro) {
          content.querySelectorAll('.an-chart-wrap').forEach(function (w) { ro.observe(w); });
        }
      }).catch(function (err) {
        if (token !== requestId) return;
        var box = el('div', 'an-empty');
        box.appendChild(el('div', 'an-empty-title', 'Could not load analytics'));
        box.appendChild(el('div', 'an-empty-text', String(err && err.message ? err.message : err)));
        content.appendChild(box);
      });
    }

    root.appendChild(toolbar);
    if (tabsHost) root.appendChild(tabsHost);
    root.appendChild(content);
    render();

    return function dispose() {
      clearIntervals();
      if (ro) ro.disconnect();
    };
  }

  function analyticsFoot(d) {
    var foot = el('div', 'an-footnote');
    foot.appendChild(el('span', null, 'Data as of ' + fmtDateTime(d.generatedAt)));
    if (d.demo) {
      foot.appendChild(el('span', 'an-footnote-warn',
        'Demo figures \u2014 the analytics API is not connected yet.'));
    }
    return foot;
  }

  function miniStrip(items) {
    var strip = el('div', 'an-mini-strip');
    items.forEach(function (s) {
      var item = el('div', 'an-mini');
      item.appendChild(el('div', 'an-mini-value', s.value));
      item.appendChild(el('div', 'an-mini-label', s.label));
      strip.appendChild(item);
    });
    return strip;
  }

  // Card wrapping a ranked-bar list, with the export wired up.
  function rankedCard(opts) {
    var c = card({
      title: opts.title,
      span: opts.span,
      foot: opts.foot,
      exportRows: function () {
        var rows = [[opts.unit || 'label', 'value']];
        opts.items.forEach(function (it) { rows.push([it.label, it.value]); });
        return rows;
      },
      exportName: opts.exportName,
    });
    c.body.appendChild(rankedRows(opts.items, { cls: opts.cls, format: opts.format }));
    return c;
  }

  function donutCard(opts) {
    var c = card({
      title: opts.title,
      span: opts.span,
      foot: opts.foot,
      exportRows: function () {
        var rows = [[opts.unit || 'label', 'value']];
        opts.items.forEach(function (it) { rows.push([it.label, it.value]); });
        return rows;
      },
      exportName: opts.exportName,
    });
    c.body.appendChild(donut(opts.items));
    return c;
  }

  function panelKpiStrip(d, defs) {
    var strip = el('div', 'an-kpi-strip');
    defs.forEach(function (def) {
      var kpi = d.kpis[def.id];
      if (!kpi) return;
      strip.appendChild(kpiTile(def.id, kpi, {
        label: def.label, cls: def.cls || 'an-c1', hint: def.hint, compare: _state.compare,
      }));
    });
    return strip;
  }

  function csvName(panel, view) {
    return 'esi-analytics_' + panel + (view ? '-' + view : '') + '_' + _state.range + '_' + stamp() + '.csv';
  }

  /* ------------------------------------------------------------------ *
   * Panel registry
   * ------------------------------------------------------------------ */

  var _panels = {};

  /**
   * Called by each analytics panel module as it loads. A panel that registers
   * without a build function renders the placeholder, which is how the
   * not-yet-written panels behave.
   */
  function registerPanel(id, cfg) {
    if (!id) return;
    _panels[id] = cfg || {};
  }

  function renderPlaceholder(container) {
    var box = el('div', 'analytics-placeholder');
    box.appendChild(el('div', 'analytics-placeholder-title', 'No widgets yet'));
    box.appendChild(el('div', 'analytics-placeholder-text',
      'This panel is wired up and ready for its widgets.'));
    container.appendChild(box);
  }

  function mount(panelId, container) {
    if (!container || !_panels[panelId]) return null;

    unmount(panelId);
    container.textContent = '';

    var cfg = _panels[panelId];
    var dispose = typeof cfg.build === 'function' ? cfg.build(container) : null;
    if (!dispose) renderPlaceholder(container);

    _mounted[panelId] = { container: container, dispose: dispose };
    return _mounted[panelId];
  }

  function unmount(panelId) {
    var entry = _mounted[panelId];
    if (!entry) return;
    if (typeof entry.dispose === 'function') entry.dispose();
    if (entry.container) entry.container.textContent = '';
    delete _mounted[panelId];
  }

  window.ESIAnalytics = {
    // registry
    registerPanel: registerPanel,
    mount: mount,
    unmount: unmount,
    isPanel: function (id) { return Object.prototype.hasOwnProperty.call(_panels, id); },

    // shared state
    state: _state,
    writeState: writeState,
    USE_DEMO_DATA: USE_DEMO_DATA,
    DAY_LABELS: DAY_LABELS,
    RANGES: RANGES,
    RANGE_SPEC: RANGE_SPEC,
    METRICS: METRICS,

    // formatting
    fmtInt: fmtInt,
    fmtCompact: fmtCompact,
    fmtMs: fmtMs,
    fmtDuration: fmtDuration,
    fmtBytes: fmtBytes,
    fmtPct: fmtPct,
    fmtDateTime: fmtDateTime,
    deltaPct: deltaPct,
    sumOf: sumOf,
    avgOf: avgOf,
    rng: rng,

    // dom and csv
    el: el,
    svgEl: svgEl,
    toast: toast,
    downloadCsv: downloadCsv,
    stamp: stamp,

    // shared demo scaffolding
    demoBase: demoBase,
    trendSeries: trendSeries,

    // primitives
    sparkline: sparkline,
    timeSeriesChart: timeSeriesChart,
    rankedRows: rankedRows,
    donut: donut,
    heatmap: heatmap,

    // components
    card: card,
    segmented: segmented,
    switchToggle: switchToggle,
    dataTable: dataTable,
    kpiTile: kpiTile,
    analyticsPanel: analyticsPanel,
    analyticsFoot: analyticsFoot,
    miniStrip: miniStrip,
    rankedCard: rankedCard,
    donutCard: donutCard,
    panelKpiStrip: panelKpiStrip,
    csvName: csvName,
  };
})();
