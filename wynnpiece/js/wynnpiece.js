(function () {
  'use strict';

  var loadingEl = document.getElementById('wp-loading');
  var lockedEl = document.getElementById('wp-locked');
  var contentEl = document.getElementById('wp-content');
  var usernameEl = document.getElementById('wp-username');
  var loginBtn = document.getElementById('wp-login-btn');
  var loginLabel = document.getElementById('wp-login-btn-label');

  // Cached value of cfg.devMode from /api/config
  var devMode = false;
  var configPromise = fetch('/api/config', {
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json' },
  })
    .then(function (resp) { return resp.ok ? resp.json() : {}; })
    .then(function (cfg) {
      devMode = !!(cfg && cfg.devMode);
      return cfg;
    })
    .catch(function () { return {}; });

  function show(target) {
    [loadingEl, lockedEl, contentEl].forEach(function (el) {
      if (!el) return;
      if (el === target) {
        el.classList.remove('hidden');
      } else {
        el.classList.add('hidden');
      }
    });
  }

  function setUsername(user) {
    if (!usernameEl || !user) return;
    var name = user.nick || user.username || 'adventurer';
    usernameEl.textContent = name;
  }

  function setLoadingButton() {
    if (!loginBtn) return;
    loginBtn.disabled = true;
    if (loginLabel) loginLabel.textContent = 'Logging in\u2026';
  }

  function startDevLogin() {
    var lastId = '';
    try { lastId = localStorage.getItem('esi_dev_last_id') || ''; } catch (e) {}
    var input = window.prompt(
      'DEV MODE - enter the Discord user ID to log in as:\n'
      + '(numeric Discord snowflake; real guild roles will be fetched if available)',
      lastId
    );
    if (!input) return;
    var userId = String(input).replace(/[^0-9]/g, '');
    if (!userId) {
      window.alert('Dev-login requires a numeric Discord ID.');
      return;
    }
    try { localStorage.setItem('esi_dev_last_id', userId); } catch (e) {}
    setLoadingButton();
    try {
      sessionStorage.setItem('esi_auth_return', window.location.pathname || '/');
    } catch (e) {}
    window.location.href = '/auth/dev-login?user_id=' + encodeURIComponent(userId);
  }

  function startProdLogin() {
    setLoadingButton();
    try {
      sessionStorage.setItem('esi_auth_return', window.location.pathname || '/');
    } catch (e) {}
    window.location.href = '/auth/login';
  }

  if (loginBtn) {
    loginBtn.addEventListener('click', function () {
      // Wait for /api/config to settle so devMode is accurate
      configPromise.then(function () {
        if (devMode) {
          startDevLogin();
        } else {
          startProdLogin();
        }
      });
    });
  }

  fetch('/auth/session', {
    credentials: 'same-origin',
    headers: { 'Accept': 'application/json' },
  })
    .then(function (resp) {
      if (!resp.ok) return { loggedIn: false };
      return resp.json();
    })
    .then(function (data) {
      if (data && data.loggedIn) {
        setUsername(data.user);
        show(contentEl);
      } else {
        show(lockedEl);
      }
    })
    .catch(function () {
      show(lockedEl);
    });
})();
