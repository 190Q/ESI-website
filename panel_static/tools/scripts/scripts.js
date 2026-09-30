/**
 * tools/scripts/scripts.js - the Scripts panel.
 *
 * The script list, the detail form and the run console. Registers itself with
 * the shell; onReady fetches the list once the owner session is confirmed.
 */
(function () {
  'use strict';

  var P = window.ESIPanel;
  var showConfirm = P.showConfirm;
  var showAlert = P.showAlert;
  var session = P.session;

  var _scriptsList = [];
  var _scriptsListLoaded = false;
  var _currentScriptKey = null;
  var _currentScriptData = null;
  var _scriptsLogTimer = null;

  function scriptsPanelTemplate() {
    return (
      '<div class="scripts-shell" id="scriptsShell">' +
        '<div class="scripts-list-view" id="scriptsListView">' +
          '<input type="text" class="scripts-search" id="scriptsSearch" placeholder="Search scripts\u2026" autocomplete="off">' +
          '<div class="scripts-list" id="scriptsList">Loading\u2026</div>' +
        '</div>' +
        '<div class="scripts-detail-view" id="scriptsDetailView"></div>' +
      '</div>'
    );
  }

  function initScriptsPanel() {
    var search = document.getElementById('scriptsSearch');
    if (search) search.addEventListener('input', renderScriptsList);
  }

  function fetchScriptsList() {
    if (!session().user || session().accessLevel !== 'owner') return;
    fetch('/panel/api/scripts', { credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (body) {
          return { ok: r.ok, status: r.status, body: body };
        });
      })
      .then(function (res) {
        if (!res.ok || !res.body || !Array.isArray(res.body.scripts)) {
          var msg = (res.body && res.body.error) || ('HTTP ' + res.status);
          var list = document.getElementById('scriptsList');
          if (list) list.innerHTML = '<div class="scripts-empty">Failed to load scripts: ' + msg + '</div>';
          return;
        }
        _scriptsList = res.body.scripts.slice().sort(function (a, b) {
          return a.label.localeCompare(b.label);
        });
        _scriptsListLoaded = true;
        renderScriptsList();
      })
      .catch(function () {
        var list = document.getElementById('scriptsList');
        if (list) list.innerHTML = '<div class="scripts-empty">Failed to load scripts: request error.</div>';
      });
  }

  function renderScriptsList() {
    var list = document.getElementById('scriptsList');
    if (!list) return;
    var search = document.getElementById('scriptsSearch');
    var query = ((search && search.value) || '').toLowerCase().trim();
    var items = _scriptsList.filter(function (s) {
      if (!query) return true;
      return s.label.toLowerCase().indexOf(query) !== -1 ||
        (s.description || '').toLowerCase().indexOf(query) !== -1;
    });
    if (!items.length) {
      list.innerHTML = '<div class="scripts-empty">' + (!_scriptsListLoaded ? 'Loading\u2026' : (_scriptsList.length ? 'No scripts match your search.' : 'No scripts available.')) + '</div>';
      return;
    }
    list.innerHTML = items.map(function (s) {
      return '<button type="button" class="script-card" data-script-key="' + s.key + '">' +
        '<div class="script-card-text">' +
          '<div class="script-card-label">' + s.label + '</div>' +
          (s.description ? '<div class="script-card-desc">' + s.description + '</div>' : '') +
        '</div>' +
        '<span class="script-card-arrow">\u2192</span>' +
      '</button>';
    }).join('');
    list.querySelectorAll('.script-card').forEach(function (btn) {
      btn.addEventListener('click', function () { openScriptDetail(btn.dataset.scriptKey); });
    });
  }

  function syncScriptsShellHeight() {
    var shell = document.getElementById('scriptsShell');
    var detail = document.getElementById('scriptsDetailView');
    var list = document.getElementById('scriptsListView');
    if (!shell) return;
    var listHeight = list ? list.scrollHeight : 0;
    var isOpen = detail && detail.classList.contains('open');
    var target = isOpen ? Math.max(detail.scrollHeight, listHeight) : listHeight;
    var current = shell.getBoundingClientRect().height;
    if (Math.round(current) === Math.round(target)) return;
    shell.style.height = current + 'px';
    void shell.offsetHeight; // force reflow so the transition has a starting point to animate from
    shell.style.height = target + 'px';
  }

  function openScriptDetail(key) {
    _currentScriptKey = key;
    var detail = document.getElementById('scriptsDetailView');
    if (!detail) return;
    detail.innerHTML = '<div class="scripts-detail-loading">Loading\u2026</div>';
    detail.classList.add('open');
    syncScriptsShellHeight();
    fetch('/panel/api/scripts/' + encodeURIComponent(key) + '/help', { credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (body) {
          return { ok: r.ok, status: r.status, body: body };
        });
      })
      .then(function (res) {
        if (_currentScriptKey !== key) return; // navigated away before this resolved
        if (!res.ok || !res.body) {
          var msg = (res.body && res.body.error) || ('HTTP ' + res.status);
          detail.innerHTML = '<div class="scripts-detail-loading">Failed to load this script: ' + msg + '</div>';
          syncScriptsShellHeight();
          return;
        }
        renderScriptDetail(res.body);
      })
      .catch(function () {
        detail.innerHTML = '<div class="scripts-detail-loading">Failed to load this script: request error.</div>';
        syncScriptsShellHeight();
      });
  }

  function closeScriptDetail() {
    var detail = document.getElementById('scriptsDetailView');
    if (detail) detail.classList.remove('open');
    syncScriptsShellHeight();
    stopScriptLogPolling();
    _currentScriptKey = null;
    _currentScriptData = null;
  }

  function renderScriptDetail(data) {
    var detail = document.getElementById('scriptsDetailView');
    if (!detail) return;
    _currentScriptData = data;

    var secretHtml = data.secret_stdin_flag ? (
      '<div class="script-field">' +
        '<label class="script-field-label">' + (data.secret_label || 'Secret value') + '</label>' +
        '<div class="script-field-help">Sent securely over HTTPS and piped directly to the script\u2019s stdin \u2014 never written to argv, shell history, or the audit log.</div>' +
        '<input type="password" class="script-field-input" id="scriptSecretInput" autocomplete="off">' +
      '</div>'
    ) : '';

    var positionalsHtml = (data.positionals || []).map(function (p, i) {
      return '<div class="script-field">' +
        '<label class="script-field-label">' + p.name + ' <span class="script-field-required">required</span></label>' +
        (p.help ? '<div class="script-field-help">' + p.help + '</div>' : '') +
        '<input type="text" class="script-field-input" data-positional-index="' + i + '">' +
      '</div>';
    }).join('');

    var flagsHtml = (data.flags || [])
      .filter(function (f) { return f.flags.indexOf('-h') === -1 && f.flags.indexOf('--help') === -1; })
      .map(function (f) {
        var canonical = f.flags[0];
        var display = f.flags.join(', ');
        if (!f.takes_value) {
          return '<div class="script-flag">' +
            '<label class="script-flag-toggle settings-toggle">' +
              '<input type="checkbox" data-flag-name="' + canonical + '" data-flag-kind="bool">' +
              '<span class="settings-toggle-track" aria-hidden="true"><span class="settings-toggle-thumb"></span></span>' +
              '<span class="script-flag-name">' + display + '</span>' +
            '</label>' +
            (f.help ? '<div class="script-field-help">' + f.help + '</div>' : '') +
          '</div>';
        }
        var valueInputs = f.metavars.map(function (mv, vi) {
          var choiceMatch = /^\{(.*)\}$/.exec(mv);
          if (choiceMatch) {
            var options = choiceMatch[1].split(',');
            return '<select class="script-field-input" data-flag-name="' + canonical + '" data-flag-value-index="' + vi + '">' +
              options.map(function (o) { return '<option value="' + o + '">' + o + '</option>'; }).join('') +
            '</select>';
          }
          return '<input type="text" class="script-field-input" placeholder="' + mv + '" data-flag-name="' + canonical + '" data-flag-value-index="' + vi + '">';
        }).join('');
        return '<div class="script-flag">' +
          '<label class="script-flag-toggle settings-toggle">' +
            '<input type="checkbox" class="script-flag-enable" data-flag-name="' + canonical + '">' +
            '<span class="settings-toggle-track" aria-hidden="true"><span class="settings-toggle-thumb"></span></span>' +
            '<span class="script-flag-name">' + display + '</span>' +
          '</label>' +
          (f.help ? '<div class="script-field-help">' + f.help + '</div>' : '') +
          '<div class="script-flag-values" data-flag-values="' + canonical + '" style="display:none">' + valueInputs + '</div>' +
        '</div>';
      }).join('');

    detail.innerHTML =
      '<div class="script-detail-columns">' +
        '<div class="script-detail-form">' +
          '<button type="button" class="script-back-btn" id="scriptBackBtn">\u2190 Back to Scripts</button>' +
          '<h2 class="script-detail-title">' + data.label + '</h2>' +
          (data.description ? '<p class="script-detail-desc">' + data.description + '</p>' : '') +
          (secretHtml ? '<div class="script-section-label">Secret</div>' + secretHtml : '') +
          (positionalsHtml ? '<div class="script-section-label">Arguments</div>' + positionalsHtml : '') +
          (flagsHtml ? '<div class="script-section-label">Flags</div>' + flagsHtml : '') +
          '<div class="script-run-row service-actions">' +
            '<button type="button" class="btn-primary" id="scriptRunBtn"' + (data.running ? ' style="display:none"' : '') + '>Run</button>' +
            '<button type="button" class="btn-danger" id="scriptStopBtn"' + (data.running ? '' : ' style="display:none"') + '>Stop</button>' +
          '</div>' +
        '</div>' +
        '<div class="script-detail-console">' +
          '<div class="console-card">' +
            '<div class="console-head"><span class="script-run-status" id="scriptRunStatus">' + (data.running ? 'Running\u2026' : 'Idle') + '</span></div>' +
            '<pre class="console-body" id="scriptConsoleBody">(no output yet)</pre>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.getElementById('scriptBackBtn').addEventListener('click', closeScriptDetail);
    detail.querySelectorAll('.script-flag-enable').forEach(function (cb) {
      cb.addEventListener('change', function () {
        var valuesWrap = detail.querySelector('[data-flag-values="' + cb.dataset.flagName + '"]');
        if (valuesWrap) valuesWrap.style.display = cb.checked ? '' : 'none';
      });
    });
    document.getElementById('scriptRunBtn').addEventListener('click', function () { runScript(data); });
    document.getElementById('scriptStopBtn').addEventListener('click', stopScript);

    syncScriptsShellHeight();
    if (data.running) startScriptLogPolling();
  }

  function collectScriptRunPayload() {
    var detail = document.getElementById('scriptsDetailView');
    var positionals = [];
    detail.querySelectorAll('[data-positional-index]').forEach(function (input) {
      positionals[Number(input.dataset.positionalIndex)] = input.value.trim();
    });
    var flags = [];
    detail.querySelectorAll('[data-flag-kind="bool"]').forEach(function (cb) {
      if (cb.checked) flags.push({ name: cb.dataset.flagName });
    });
    detail.querySelectorAll('.script-flag-enable').forEach(function (cb) {
      if (!cb.checked) return;
      var values = [];
      detail.querySelectorAll('[data-flag-name="' + cb.dataset.flagName + '"][data-flag-value-index]').forEach(function (input) {
        values.push(input.value);
      });
      flags.push({ name: cb.dataset.flagName, values: values });
    });
    var payload = { positionals: positionals, flags: flags };
    var secretInput = detail.querySelector('#scriptSecretInput');
    if (secretInput && secretInput.value) payload.secret = secretInput.value;
    return payload;
  }

  function describeRunPreview(payload) {
    var parts = ['python3', (_scriptsList.filter(function (s) { return s.key === _currentScriptKey; })[0] || {}).label || _currentScriptKey];
    (payload.positionals || []).forEach(function (v) { if (v) parts.push(v); });
    (payload.flags || []).forEach(function (f) {
      parts.push(f.name);
      (f.values || []).forEach(function (v) { if (v) parts.push(v); });
    });
    if (payload.secret && _currentScriptData && _currentScriptData.secret_stdin_flag) {
      parts.push(_currentScriptData.secret_stdin_flag);
      parts.push('\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022 (hidden)');
    }
    return parts.join(' ');
  }

  function runScript() {
    if (!_currentScriptKey) return;
    var payload = collectScriptRunPayload();
    showConfirm({
      title: 'Run this script now?',
      detail: describeRunPreview(payload),
      confirmLabel: 'Run',
      onConfirm: function () { executeScriptRun(payload); },
    });
  }

  function executeScriptRun(payload) {
    fetch('/panel/api/scripts/' + encodeURIComponent(_currentScriptKey) + '/run', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session().csrfToken || '' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json().then(function (body) { return { ok: r.ok, body: body }; }); })
      .then(function (res) {
        if (!res.ok || !res.body || res.body.ok === false) {
          showAlert('Failed to start: ' + ((res.body && res.body.error) || 'unknown error'));
          return;
        }
        var runBtn = document.getElementById('scriptRunBtn');
        var stopBtn = document.getElementById('scriptStopBtn');
        var status = document.getElementById('scriptRunStatus');
        var secretInput = document.getElementById('scriptSecretInput');
        if (secretInput) secretInput.value = '';
        if (runBtn) runBtn.style.display = 'none';
        if (stopBtn) stopBtn.style.display = '';
        if (status) status.textContent = 'Running\u2026';
        startScriptLogPolling();
      })
      .catch(function () { showAlert('Failed to start: request error.'); });
  }

  function stopScript() {
    if (!_currentScriptKey) return;
    showConfirm({
      title: 'Stop the running script?',
      confirmLabel: 'Stop',
      danger: true,
      onConfirm: function () { executeScriptStop(); },
    });
  }

  function executeScriptStop() {
    fetch('/panel/api/scripts/' + encodeURIComponent(_currentScriptKey) + '/stop', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': session().csrfToken || '' },
    })
      .catch(function () {})
      .finally(pollScriptLogsOnce);
  }

  function startScriptLogPolling() {
    stopScriptLogPolling();
    pollScriptLogsOnce();
    _scriptsLogTimer = setInterval(pollScriptLogsOnce, 2000);
  }

  function stopScriptLogPolling() {
    if (_scriptsLogTimer) { clearInterval(_scriptsLogTimer); _scriptsLogTimer = null; }
  }

  function pollScriptLogsOnce() {
    if (!_currentScriptKey) return;
    var key = _currentScriptKey;
    fetch('/panel/api/scripts/' + encodeURIComponent(key) + '/logs', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (_currentScriptKey !== key) return;
        var body = document.getElementById('scriptConsoleBody');
        var status = document.getElementById('scriptRunStatus');
        if (body) {
          body.textContent = data.output || '(no output yet)';
          body.scrollTop = body.scrollHeight;
        }
        if (status) status.textContent = data.running ? 'Running\u2026' : 'Finished';
        if (!data.running) {
          stopScriptLogPolling();
          var runBtn = document.getElementById('scriptRunBtn');
          var stopBtn = document.getElementById('scriptStopBtn');
          if (runBtn) runBtn.style.display = '';
          if (stopBtn) stopBtn.style.display = 'none';
        }
        syncScriptsShellHeight();
      })
      .catch(function () {});
  }

  P.registerItem({
    section: 'tools',
    order: 1,
    id: 'scripts',
    type: 'scripts',
    label: 'Scripts',
    icon: 'scripts',
    subtitle: 'Run admin scripts and GDPR tools directly from the panel.',
    build: function (container) {
      container.innerHTML = scriptsPanelTemplate();
      initScriptsPanel();
    },
    onReady: fetchScriptsList,
  });
})();
