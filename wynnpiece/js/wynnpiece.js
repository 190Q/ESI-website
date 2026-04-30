(function () {
  'use strict';

  var loadingEl = document.getElementById('wp-loading');
  var lockedEl = document.getElementById('wp-locked');
  var contentEl = document.getElementById('wp-content');
  var usernameEl = document.getElementById('wp-username');

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
