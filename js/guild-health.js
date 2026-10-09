(function () {
  'use strict';

  var panel = document.getElementById('panel-guild-health');
  if (!panel) return;

  var API = '/api/guild/health';
  var _loading = false;
  var _loadedOnce = false;
  var _lastStatus = 0;

  function track(props) {
    try {
      if (window.ESITrack) window.ESITrack.event('feature', props);
    } catch (e) { /* analytics must never break the panel */ }
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function dirArrow(direction) {
    if (direction === 'improving') return '\u25B2';
    if (direction === 'declining') return '\u25BC';
    return '\u2022';
  }

  function dirClass(direction) {
    if (direction === 'improving') return 'gh-up';
    if (direction === 'declining') return 'gh-down';
    return 'gh-flat';
  }

  function bandClass(band) {
    switch (String(band || '').toLowerCase()) {
      case 'thriving': return 'gh-band-thriving';
      case 'healthy':  return 'gh-band-healthy';
      case 'stable':   return 'gh-band-stable';
      case 'slipping': return 'gh-band-slipping';
      case 'strained': return 'gh-band-strained';
      default:         return 'gh-band-unknown';
    }
  }

  function scoreClass(score) {
    if (score == null) return 'gh-score-unknown';
    if (score >= 80) return 'gh-score-thriving';
    if (score >= 65) return 'gh-score-healthy';
    if (score >= 50) return 'gh-score-stable';
    if (score >= 35) return 'gh-score-slipping';
    return 'gh-score-strained';
  }

  function fmtTrend(trend) {
    if (trend == null) return '';
    return (trend > 0 ? '+' : '') + trend;
  }

  var observer = new MutationObserver(function () {
    if (!panel.classList.contains('active')) return;
    if (_loading) return;
    if (!_loadedOnce || _lastStatus === 401 || _lastStatus === 403) load();
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['class'] });

  function load() {
    if (_loading) return;
    _loading = true;

    if (!document.getElementById('ghBody')) {
      var pre = DataCache.readCache(API);
      if (pre) { render(pre); _loadedOnce = true; }
    }

    fetch(API, { credentials: 'same-origin' })
      .then(function (r) {
        _lastStatus = r.status;
        if (r.status === 401 || r.status === 403) { renderGate(r.status); return null; }
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data) return;
        DataCache.writeCache(API, data);
        render(data);
        _loadedOnce = true;
      })
      .catch(function () {
        if (document.getElementById('ghBody')) return;
        var cached = DataCache.readCache(API);
        if (cached) { render(cached); _loadedOnce = true; }
        else renderError();
      })
      .finally(function () { _loading = false; });
  }

  if (panel.classList.contains('active')) load();

  window.guildHealthOnLogin = function () {
    _lastStatus = 0;
    if (panel.classList.contains('active')) load();
  };

  function headerHtml() {
    return '<div class="panel-header">' +
        '<h1 class="panel-title">Guild Health</h1>' +
        '<p class="panel-subtitle">Scored against the guild\u2019s own history, not fixed thresholds</p>' +
      '</div>';
  }

  function renderGate(status) {
    var loggedIn = window.state && window.state.loggedIn;
    if (!loggedIn && window.renderAuthGate) { window.renderAuthGate(panel); return; }
    var msg = status === 403
      ? 'You do not have permission to view this page.'
      : 'Failed to load guild health. Please try again.';
    panel.innerHTML = headerHtml() + '<div class="gh-empty">' + msg + '</div>';
  }

  function renderError() {
    panel.innerHTML = headerHtml() +
      '<div class="gh-empty">Failed to load guild health. Please try again.</div>';
  }

  function renderUnavailable(data) {
    panel.innerHTML = headerHtml() +
      '<div class="gh-empty">Not enough data to build a health index yet.' +
      (data && data.reason
        ? '<br><span class="gh-empty-sub">' + esc(data.reason) + '</span>'
        : '') +
      '</div>';
  }

  function render(data) {
    if (!data || data.available === false) { renderUnavailable(data); return; }

    var idx = data.index || {};
    var conf = data.confidence || {};
    var dims = data.dimensions || [];
    var watch = data.watchlist || [];
    var excluded = data.excluded || {};

    var html = headerHtml();
    html += '<div id="ghBody">';

    html += '<div class="gh-hero">' +
        '<div class="gh-hero-score">' +
          '<span class="gh-score ' + scoreClass(idx.score) + '">' +
            (idx.score == null ? '\u2014' : esc(Math.round(idx.score))) + '</span>' +
          '<span class="gh-score-suffix">/100</span>' +
        '</div>' +
        '<div class="gh-hero-main">' +
          '<div class="gh-band ' + bandClass(idx.band) + '">' + esc(idx.band || 'Unknown') + '</div>' +
          '<div class="gh-hero-trend ' + dirClass(idx.direction) + '">' +
            (idx.trend == null
              ? 'no trend available yet'
              : dirArrow(idx.direction) + ' ' + esc(fmtTrend(idx.trend)) +
                ' pts vs the previous window') +
          '</div>' +
        '</div>' +
        '<div class="gh-hero-meta">' +
          '<button type="button" id="ghConfBtn" class="gh-conf gh-conf-' +
            esc(conf.label || 'unknown') + '" title="How this is calculated">' +
            esc(String(conf.label || 'unknown').toUpperCase()) + ' CONFIDENCE' +
            '<span class="gh-conf-info" aria-hidden="true">\u24D8</span>' +
          '</button>' +
          '<span class="gh-meta-line">' + esc(data.roster || 0) + ' members \u00B7 ' +
            esc(data.history_days || 0) + ' days of history \u00B7 ' +
            esc(conf.scored_dimensions || 0) + '/' + esc(conf.total_dimensions || 0) +
            ' dimensions scored</span>' +
        '</div>' +
      '</div>';

    html += '<div class="gh-dims">';
    dims.forEach(function (d) {
      var scored = d.score != null;
      html += '<button type="button" class="gh-dim" data-dim="' + esc(d.key) + '">' +
          '<span class="gh-dim-label">' + esc(d.label) + '</span>' +
          '<span class="gh-dim-score ' + scoreClass(d.score) + '">' +
            (scored ? esc(Math.round(d.score)) : '\u2014') + '</span>' +
          '<span class="gh-dim-bar"><span class="gh-dim-bar-fill ' + scoreClass(d.score) +
            '" style="width:' + (scored ? Math.max(2, Math.min(100, d.score)) : 0) + '%"></span></span>' +
          '<span class="gh-dim-meta">' +
            (d.trend == null
              ? '<span class="gh-flat">\u2022 no trend</span>'
              : '<span class="' + dirClass(d.direction) + '">' + dirArrow(d.direction) + ' ' +
                esc(fmtTrend(d.trend)) + '</span>') +
            '<span class="gh-dim-weight">' + esc(Math.round((d.weight || 0) * 100)) + '%</span>' +
          '</span>' +
        '</button>';
    });
    html += '</div>';

    html += '<div class="gh-evidence" id="ghEvidence"></div>';

    html += '<div class="gh-section">' +
        '<div class="gh-section-head">' +
          '<span class="gh-section-title">Member watchlist</span>' +
          '<span class="gh-section-note">' + esc(watch.length) + ' flagged \u00B7 ' +
            esc(excluded.inactive || 0) + ' excluded (declared inactive) \u00B7 ' +
            esc(excluded.new_members || 0) + ' excluded (joined under 14d)</span>' +
        '</div>';

    if (!watch.length) {
      html += '<div class="gh-empty gh-empty-inline">' +
        'No members are showing a declining trend right now.</div>';
    } else {
      html += '<div class="gh-watch">';
      watch.forEach(function (w) {
        html += '<div class="gh-watch-row">' +
            '<div class="gh-watch-left">' +
              '<span class="gh-watch-name">' + esc(w.username) + '</span>' +
              (w.rank ? '<span class="gh-rank">' + esc(w.rank) + '</span>' : '') +
            '</div>' +
            '<div class="gh-watch-mid">';
        (w.reasons || []).forEach(function (r) {
          html += '<span class="gh-reason">' + esc(r) + '</span>';
        });
        html += '</div><div class="gh-watch-right">' +
              '<span class="gh-risk gh-risk-' + esc(w.band) + '">' +
                esc(Math.round(w.risk)) + '</span>' +
              (w.tenure_days != null
                ? '<span class="gh-tenure">' + esc(w.tenure_days) + 'd in guild</span>'
                : '') +
            '</div>' +
          '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    html += '</div>';
    panel.innerHTML = html;

    Array.prototype.forEach.call(panel.querySelectorAll('.gh-dim'), function (card) {
      card.addEventListener('click', function () {
        selectDimension(card.getAttribute('data-dim'), dims);
        track({ name: 'guild_health', action: 'dimension', detail: card.getAttribute('data-dim') });
      });
    });

    var confBtn = panel.querySelector('#ghConfBtn');
    if (confBtn) {
      confBtn.addEventListener('click', function () {
        openConfidenceModal(data);
        track({ name: 'guild_health', action: 'confidence_modal' });
      });
    }

    var first = dims.filter(function (d) { return d.score != null; })[0] || dims[0];
    if (first) selectDimension(first.key, dims);
  }

  var _modal = null;

  function ensureModal() {
    if (_modal) return _modal;

    var overlay = document.createElement('div');
    overlay.className = 'gh-modal-overlay';

    var popup = document.createElement('div');
    popup.className = 'gh-modal';
    popup.innerHTML =
      '<div class="gh-modal-header">' +
        '<span class="gh-modal-title">Confidence</span>' +
        '<button type="button" class="gh-modal-close" aria-label="Close">\u2715</button>' +
      '</div>' +
      '<div class="gh-modal-body popup-scroll"></div>';

    document.body.appendChild(overlay);
    document.body.appendChild(popup);

    var api = window.Popup
      ? window.Popup.register(popup, { overlay: overlay, closeBtn: '.gh-modal-close' })
      : null;

    _modal = {
      popup: popup,
      overlay: overlay,
      api: api,
      body: popup.querySelector('.gh-modal-body'),
    };
    return _modal;
  }

  function openConfidenceModal(data) {
    var modal = ensureModal();
    modal.body.innerHTML = confidenceHtml(data);
    if (modal.api) {
      modal.api.open();
    } else {
      modal.overlay.classList.add('open');
      modal.popup.classList.add('open');
    }
  }

  function confidenceHtml(data) {
    var conf = data.confidence || {};
    var srcs = data.data_sources || [];
    var score = conf.score == null ? null : Math.round(conf.score);
    var label = String(conf.label || 'unknown');
    var html = '';

    html += '<div class="gh-modal-score">' +
        '<span class="gh-modal-score-val ' + scoreClass(score) + '">' +
          (score == null ? '\u2014' : score + '%') + '</span>' +
        '<span class="gh-modal-score-lbl gh-conf-' + esc(label) + '">' +
          esc(label.toUpperCase()) + '</span>' +
      '</div>';

    html += '<p class="gh-modal-lede">The average of the three coverage factors, ' +
      'multiplied by how current the underlying data is.</p>';

    var factors = conf.factors || [];
    if (factors.length) {
      html += '<div class="gh-factors">';
      factors.forEach(function (f) {
        var pct = Math.round((f.value || 0) * 100);
        html += '<div class="gh-factor">' +
            '<div class="gh-factor-top">' +
              '<span class="gh-factor-label">' + esc(f.label) +
                (f.multiplier ? '<span class="gh-factor-tag">multiplier</span>' : '') +
              '</span>' +
              '<span class="gh-factor-val ' + scoreClass(pct) + '">' + pct + '%</span>' +
            '</div>' +
            '<span class="gh-factor-bar"><span class="gh-factor-bar-fill ' + scoreClass(pct) +
              '" style="width:' + Math.max(2, Math.min(100, pct)) + '%"></span></span>' +
            '<span class="gh-factor-note">' + esc(f.display || '') + '</span>' +
          '</div>';
      });
      html += '</div>';
    }

    if (srcs.length) {
      html += '<div class="gh-modal-sub">Data sources</div>';
      html += '<div class="gh-sources">';
      srcs.forEach(function (s) {
        var cls = !s.available ? 'gh-src-missing'
          : (!s.usable ? 'gh-src-dead' : (s.stale ? 'gh-src-stale' : 'gh-src-ok'));
        var txt = !s.available ? 'no data' : (s.lag_days + 'd behind');
        html += '<span class="gh-src ' + cls + '" title="' +
            esc(s.label + (s.end ? ' \u00b7 last record ' + s.end : '')) + '">' +
            esc(s.label) + ' \u00B7 ' + esc(txt) + '</span>';
      });
      html += '</div>';
    }

    var notes = conf.notes || [];
    if (notes.length) {
      html += '<div class="gh-modal-sub">Notes</div>';
      html += '<div class="gh-notes">';
      notes.forEach(function (n) {
        html += '<div class="gh-note">' + esc(n) + '</div>';
      });
      html += '</div>';
    }

    return html;
  }

  function selectDimension(key, dims) {
    var target = null;
    for (var i = 0; i < dims.length; i++) {
      if (dims[i].key === key) { target = dims[i]; break; }
    }
    if (!target) return;

    Array.prototype.forEach.call(panel.querySelectorAll('.gh-dim'), function (card) {
      card.classList.toggle('gh-dim-active', card.getAttribute('data-dim') === key);
    });

    var signals = target.signals || [];
    var html = '<div class="gh-evidence-head">' +
        '<span class="gh-evidence-title">' + esc(target.label) +
          ' \u2014 what produced this score</span>' +
        '<span class="gh-evidence-sub">' +
          (target.score == null
            ? 'not enough history to score this dimension'
            : esc(target.scored_signals) + ' of ' + esc(signals.length) + ' signals scored') +
        '</span>' +
      '</div>';

    if (!signals.length) {
      html += '<div class="gh-empty gh-empty-inline">No signals available.</div>';
      document.getElementById('ghEvidence').innerHTML = html;
      return;
    }

    html += '<div class="gh-table-wrap"><table class="gh-table"><thead><tr>' +
        '<th>Signal</th><th>Now</th><th>Baseline</th><th>Score</th><th>Weight</th>' +
      '</tr></thead><tbody>';

    signals.forEach(function (s) {
      var method;
      if (s.method === 'absolute') {
        method = '<span class="gh-method gh-method-abs" ' +
          'title="No per-day history for this signal, so it uses a documented fixed scale">' +
          'fixed scale</span>';
      } else if (s.method === 'unscored') {
        method = '<span class="gh-method gh-method-none" ' +
          'title="Not enough history to rank this signal">unscored</span>';
      } else {
        method = '<span class="gh-method gh-method-pct" ' +
          'title="Ranked against ' + esc(s.samples) + ' previous windows of the same length">' +
          esc(s.samples) + ' windows</span>';
      }
      html += '<tr>' +
          '<td class="gh-td-signal">' +
            '<span class="gh-td-label">' + esc(s.label) + '</span>' +
            '<span class="gh-td-detail">' + esc(s.detail || '') + '</span>' +
            method +
          '</td>' +
          '<td class="gh-td-num">' + esc(s.value_display) + '</td>' +
          '<td class="gh-td-num gh-td-base">' + esc(s.baseline_display) + '</td>' +
          '<td class="gh-td-num ' + scoreClass(s.score) + '">' +
            (s.score == null ? '\u2014' : esc(Math.round(s.score))) + '</td>' +
          '<td class="gh-td-num gh-td-weight">' + esc(Math.round((s.weight || 0) * 100)) + '%</td>' +
        '</tr>';
    });

    html += '</tbody></table></div>' +
      '<div class="gh-evidence-foot">A score of 50 means the guild is exactly at its own ' +
      'historical average for that signal. Signals marked <em>fixed scale</em> have no per-day ' +
      'history and use a documented band instead.</div>';

    document.getElementById('ghEvidence').innerHTML = html;
  }
})();
