(function () {
  'use strict';

  /* shared state */
  const state = window.state = {
    loggedIn: false,
    user: null,
    currentView: 'global',
    playerData: null,
    guildData: null,
  };

  /* dom refs */
  const loginBtn        = document.getElementById('loginBtn');
  const helpBtn         = document.getElementById('helpBtn');
  const modalBackdrop   = document.getElementById('modalBackdrop');
  const modalClose      = document.getElementById('modalClose');
  const manageSection    = document.getElementById('manageSection');
  const navItems        = document.querySelectorAll('.nav-item');
  const sidebar         = document.getElementById('sidebar');
  const sidebarToggle   = document.getElementById('sidebarToggle');

  /* sidebar toggle */
  if (localStorage.getItem('sidebarCollapsed') === 'true') {
    sidebar.classList.add('collapsed');
  }
  document.documentElement.classList.remove('sidebar-pre-collapsed');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.documentElement.classList.remove('no-transitions');
  }));
  sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    // once the transition ends, resize event so canvases redraw properly
    sidebar.addEventListener('transitionend', function onEnd() {
      sidebar.removeEventListener('transitionend', onEnd);
      window.dispatchEvent(new Event('resize'));
    });
  });

  /* nav clicks */
  navItems.forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const target = item.dataset.panel;
      if (!target) return;
      // if it's a restricted panels, just ignore the click
      if (target === 'inactivity' && !hasParliamentPlus()) return;
      if (target === 'promotions' && !hasJurorPlus()) return;
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      const panel = document.getElementById('panel-' + target);
      if (panel) panel.classList.add('active');
      if (window.updateHash) window.updateHash();
    });
  });

  /* login */
  const accountModalBackdrop = document.getElementById('accountModalBackdrop');

  function openAccountModal() {
    accountModalBackdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeAccountModal() {
    accountModalBackdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  accountModalBackdrop.addEventListener('click', function (e) {
    if (e.target === accountModalBackdrop) closeAccountModal();
  });
  document.getElementById('accountModalClose').addEventListener('click', closeAccountModal);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAccountModal();
  });

  loginBtn.addEventListener('click', () => {
    if (state.loggedIn) openAccountModal();
    else {
      // show loading state and disable the button while redirecting
      loginBtn.disabled = true;
      loginBtn.innerHTML =
        '<span class="loading-spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,0.3);border-top-color:#fff;"></span>' +
        ' Logging in\u2026';
      loginBtn.style.background = '#4752c4';
      loginBtn.style.boxShadow = 'none';
      // save current page state so we can restore it after the OAuth redirect
      sessionStorage.setItem('esi_auth_return', window.location.hash || '');
      window.location.href = '/auth/login';
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    closeAccountModal();
    logout();
  });

  /* handle ?auth= query param after OAuth redirect */
  var _authJustCompleted = false;
  var _authFailed = false;
  (function handleAuthRedirect() {
    var params = new URLSearchParams(window.location.search);
    var authResult = params.get('auth');
    if (!authResult) return;
    // restore the hash the user was on before the redirect
    var savedHash = sessionStorage.getItem('esi_auth_return') || '';
    sessionStorage.removeItem('esi_auth_return');
    // clean the URL so refreshing doesn't re-trigger the toast
    params.delete('auth');
    var clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + (savedHash || window.location.hash);
    history.replaceState(null, '', clean);
    if (authResult === 'success') {
      _authJustCompleted = true;
      // show the same loading state while the session check confirms the login
      loginBtn.disabled = true;
      loginBtn.innerHTML =
        '<span class="loading-spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,0.3);border-top-color:#fff;"></span>' +
        ' Logging in\u2026';
      loginBtn.style.opacity = '1';
      loginBtn.style.background = '#4752c4';
      loginBtn.style.boxShadow = 'none';
    } else if (authResult === 'error') {
      _authFailed = true;
    }
  })();

  function logout() {
    // wait for the server to clear the session cookie before updating the UI,
    // otherwise a quick refresh still sees a valid session
    fetch('/auth/logout', { credentials: 'same-origin' })
      .catch(function () {})
      .then(function () {
        localStorage.removeItem('esi_user');
        state.loggedIn = false;
        state.user = null;
        updateLoginButton();
        applyPermissions();
        showToast('You have left the portal.', 'info');
      });
  }

  function renderProfile(user) {
    if (!user) return;
    var avatar  = document.getElementById('profileAvatar');
    var name    = document.getElementById('profileUsername');
    var discr   = document.getElementById('profileDiscrim');
    var idEl    = document.getElementById('profileId');
    var rolesEl = document.getElementById('profileRoles');
    if (!avatar || !name) return; // profile panel not present in this layout

    if (user.avatar) {
      avatar.src = 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=256';
    } else {
      avatar.src = 'https://cdn.discordapp.com/embed/avatars/0.png';
    }
    name.textContent  = user.nick || user.username;
    if (user.discriminator && user.discriminator !== '0') {
      discr.textContent = '#' + user.discriminator;
      discr.style.display = '';
    } else {
      discr.style.display = 'none';
    }
    idEl.textContent  = 'ID: ' + user.id;

    var roles = user.role_objects || [];
    if (roles.length === 0) {
      rolesEl.innerHTML = '<div style="padding:16px 20px;color:var(--text-faint);font-style:italic">No roles</div>';
    } else {
      rolesEl.innerHTML = roles.map(function (r) {
        return '<div class="profile-role-row">' +
          '<span class="profile-role-name">' + r.name + '</span>' +
          '<span class="profile-role-id">' + r.id + '</span></div>';
      }).join('');
    }
  }


// staff roles
const ESI_STAFF_ROLES = [
  { name: 'Bot Owner',    color: '#ec00ad', members: ['967867229410574340'] },
  { name: 'Developer',    color: '#0896d3', members: ['454260696172068879'] },
  { name: 'User Support', color: '#4933c5', members: ['516954338225160195'] },
];

// rank roles shown in the account modal
const ESI_RANK_ROLES = [
  { id: '554506531949772812', name: 'Emperor',    color: '#5c11ad' },
  { id: '554514823191199747', name: 'Archduke',   color: '#b5fff6' },
  { id: '1396112289832243282', name: 'Grand Duke', color: '#74cac0' },
  { id: '591765870272053261', name: 'Duke',        color: '#35deac' },
  { id: '1391424890938195998', name: 'Count',      color: '#3ac770' },
  { id: '591769392828776449', name: 'Viscount',    color: '#59e365' },
  { id: '688438690137243892', name: 'Knight',      color: '#93e688' },
  { id: '681030746651230351', name: 'Squire',      color: '#c7edc0' },
];
const ESI_ECHELON_ROLES = [
  { id: '600185623474601995', name: 'Parliament', color: '#afb3d1' }, // Parli Colour role
  { id: '1346436714901536858', name: 'Congress',  color: '#7289da' },
  { id: '954566591520063510', name: 'Juror',       color: '#ffc332' },
];
const ESI_CITIZEN_ROLE = { id: '554889169705500672', name: 'Sindrian Citizen', color: '#4acf5e' };

function _esiRoleBadge(name, color, large) {
  var s = 'color:' + color + ';background:' + color + '22;border-color:' + color + '66;';
  if (large) s += 'font-size:0.78rem;font-weight:600;padding:5px 18px;';
  else        s += 'font-size:0.67rem;padding:3px 12px;';
  return '<span class="account-role-badge" style="' + s + '">' + name + '</span>';
}

function renderAccountModalRoles(userRoles, userId) {
  var el = document.getElementById('accountModalRoles');
  if (!el) return;
  var html = '';

  // Staff badges (set manually by user ID)
  if (userId) {
    ESI_STAFF_ROLES.forEach(function(role) {
      if (role.members.includes(userId)) html += _esiRoleBadge(role.name, role.color, true);
    });
  }

  // Upper Echelon: Parliament supersedes Congress; Juror shown independently
  var hasValaendor  = userRoles.includes('728858956575014964');
  var hasParliament = userRoles.includes('600185623474601995');
  var hasCongress   = userRoles.includes('1346436714901536858');
  var hasJuror      = userRoles.includes('954566591520063510');
  if (hasValaendor) {
    html += _esiRoleBadge('👑 Valaendor', '#7744b6', true);
  } else if (hasParliament) {
    html += _esiRoleBadge('🏛️ Parliament', '#afb3d1', true);
  } else if (hasCongress) {
    html += _esiRoleBadge('🏵️ Congress', '#7289da', true);
  }
  if (hasJuror && !hasParliament && !hasCongress) {
    html += _esiRoleBadge('⚖ Juror', '#ffc332', true);
  }

  // Highest rank only (shown below Upper Echelon)
  var rank = ESI_RANK_ROLES.find(function(r) { return userRoles.includes(r.id); });
  if (rank) html += _esiRoleBadge(rank.name, rank.color, false);

  el.innerHTML = html;
  el.style.display = html ? '' : 'none';
}

// apply a verified user object and lock down permissions accordingly
var _defaultPlayerFetched = false;
function applyLogin(user) {
    state.loggedIn = true;
    state.user     = user;
    updateLoginButton();
    applyPermissions();
    renderProfile(user);

    // auto-populate default player from server if user hasn't set one manually
    if (!_defaultPlayerFetched && window.esiSettings) {
      _defaultPlayerFetched = true;
      var manualPlayer = window.esiSettings.get('defaultPlayer');
      if (!manualPlayer) {
        fetch('/api/settings/default-player', { credentials: 'same-origin' })
          .then(function (r) { return r.ok ? r.json() : null; })
          .then(function (data) {
            if (data && data.username) {
              window.esiSettings.set('defaultPlayer', data.username);
              var input = document.getElementById('playerInput');
              if (input && (!input.value || input.value === '190Q')) {
                input.value = data.username;
              }
            }
          })
          .catch(function () {});
      }
    }
}

// restore name/avatar from localStorage instantly, but don't grant any roles yet
// (roles get applied once the server confirms the session below)
var savedUser = localStorage.getItem('esi_user');
if (savedUser) {
    try {
        var _cachedUser = JSON.parse(savedUser);
        state.loggedIn = true;
        state.user = Object.assign({}, _cachedUser, { roles: [] });
        updateLoginButton();
    } catch (e) {
        localStorage.removeItem('esi_user');
    }
}

// verify the session is still valid, then silently refresh roles/name/avatar
fetch('/auth/session', { credentials: 'same-origin' })
    .then(r => r.json())
    .then(function(data) {
        if (data.loggedIn) {
            localStorage.setItem('esi_user', JSON.stringify(data.user));
            applyLogin(data.user);
            if (_authJustCompleted) {
                _authJustCompleted = false;
                showToast('Welcome back, ' + (data.user.nick || data.user.username) + '!', 'success');
                // warn Firefox users about cookie clearing on first login only
                if (/Firefox/.test(navigator.userAgent) && !localStorage.getItem('esi_ff_warned')) {
                  localStorage.setItem('esi_ff_warned', '1');
                  setTimeout(function () {
                    showToast(
                      '\u26a0 Firefox may clear your session when closed. To stay logged in, go to Settings \u2192 Privacy & Security and uncheck \u201cDelete cookies and site data when Firefox is closed\u201d.',
                      'warn'
                    );
                  }, 2000);
                }
            }
            // also refresh in the background so it catches role changes / deauthorization
            _refreshSession();
        } else {
            // not logged in (or session expired) — clear any stale local state
            if (state.loggedIn) {
                localStorage.removeItem('esi_user');
                state.loggedIn = false;
                state.user     = null;
                applyPermissions();
            }
            updateLoginButton();
            if (_authFailed) {
                _authFailed = false;
                showToast('\u26a0 Login failed. Please try again.', 'warn');
            }
        }
    })
    .catch(function () {
        // server unreachable, still reveal the button with whatever state we have
        updateLoginButton();
    });

  // if the user navigates back (e.g. closes the Discord auth page),
  // the browser restores the page from bfcache with the spinner still showing
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) updateLoginButton();
  });

  // re-verify the session when the tab regains focus
  // (catches deauthorization, guild kicks, etc. that happened while the tab was in the background)
  var _lastVerify = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !state.loggedIn) return;
    var now = Date.now();
    if (now - _lastVerify < 30000) return; // at most once per 30s
    _lastVerify = now;
    _refreshSession();
  });

  function _refreshSession() {
    fetch('/auth/refresh', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (fresh) {
        if (fresh.loggedIn && fresh.user) {
          localStorage.setItem('esi_user', JSON.stringify(fresh.user));
          applyLogin(fresh.user);
        } else if (!fresh.loggedIn && state.loggedIn) {
          // server invalidated the session (deauthorized, kicked, etc.)
          localStorage.removeItem('esi_user');
          state.loggedIn = false;
          state.user = null;
          updateLoginButton();
          applyPermissions();
          showToast('Your session has ended.', 'info');
        }
      })
      .catch(function () {});
  }

  function updateLoginButton() {
    loginBtn.disabled = false;
    if (state.loggedIn && state.user) {
      const u = state.user;
      const avatarSrc = u.avatar
        ? 'https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + '.png?size=64'
        : 'https://cdn.discordapp.com/embed/avatars/0.png';
      loginBtn.classList.add('btn-discord--account');
      loginBtn.innerHTML = `
        <img src="${avatarSrc}" alt="" style="width:20px;height:20px;border-radius:50%;object-fit:cover;flex-shrink:0;" />
        ${u.nick || u.username}`;
      loginBtn.style.opacity = '1';
      loginBtn.style.background = '#3BA55C';
      loginBtn.style.boxShadow = '0 2px 12px rgba(59,165,92,0.35)';
      // Populate account modal
      document.getElementById('accountModalAvatar').src = avatarSrc;
      var displayName = u.nick || u.username;
      var isCitizen = (u.roles || []).includes(ESI_CITIZEN_ROLE.id);
      var citizenStyle = 'color:' + ESI_CITIZEN_ROLE.color + ';background:' + ESI_CITIZEN_ROLE.color + '22;border:1px solid ' + ESI_CITIZEN_ROLE.color + '66;border-radius:20px;font-family:\'Cinzel\',serif;font-size:0.6rem;letter-spacing:0.08em;padding:1px 8px;vertical-align:middle;margin-left:6px;white-space:nowrap;';
      document.getElementById('accountModalName').innerHTML =
        displayName + (isCitizen ? ' <span style="' + citizenStyle + '">Citizen</span>' : '');
      document.getElementById('accountModalSub').textContent = '@' + u.username + '  ·  ' + u.id;
      renderAccountModalRoles(u.roles || [], u.id);
    } else {
      closeAccountModal();
      loginBtn.classList.remove('btn-discord--account');
      loginBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 127.14 96.36" fill="currentColor"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>
        Login with Discord`;
      loginBtn.style.opacity = '1';
      loginBtn.style.background = '#5865F2';
      loginBtn.style.boxShadow = '0 2px 12px rgba(88,101,242,0.35)';
    }
  }

  /* role checks */
  function hasParliamentPlus() {
    if (!state.loggedIn || !state.user) return false;
    var roles = state.user.roles || [];
    return roles.includes('728858956575014964') || // Valaendor
           roles.includes('600185623474601995');    // Parliament
  }

  function hasJurorPlus() {
    if (!state.loggedIn || !state.user) return false;
    var roles = state.user.roles || [];
    return roles.includes('728858956575014964') || // Valaendor
           roles.includes('600185623474601995') || // Parliament
           roles.includes('1346436714901536858') || // Congress
           roles.includes('954566591520063510');    // Juror
  }

  /* permissions */
  function applyPermissions() {
    const activePanel = document.querySelector('.panel.active');
    const canInactivity = hasParliamentPlus();
    const canPromotions = hasJurorPlus();
    manageSection.style.display = (canInactivity || canPromotions) ? 'block' : 'none';

    const inactivityNav = document.querySelector('[data-panel="inactivity"]');
    const promotionsNav = document.querySelector('[data-panel="promotions"]');
    if (inactivityNav) inactivityNav.parentElement.style.display = canInactivity ? '' : 'none';
    if (promotionsNav) promotionsNav.parentElement.style.display = canPromotions ? '' : 'none';

    // if they're on a panel they can't access anymore, bounce them to player
    if (activePanel) {
      const blocked =
        (activePanel.id === 'panel-inactivity' && !canInactivity) ||
        (activePanel.id === 'panel-promotions' && !canPromotions);
      if (blocked) {
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
        document.getElementById('panel-player').classList.add('active');
        navItems.forEach(n => n.classList.remove('active'));
        document.querySelector('[data-panel="player"]').classList.add('active');
      }
    }
  }

  /* support modal */
  helpBtn.addEventListener('click', () => openModal());
  modalClose.addEventListener('click', () => closeModal());
  modalBackdrop.addEventListener('click', e => { if (e.target === modalBackdrop) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  var linksView    = document.getElementById('supportLinksView');
  var ticketView   = document.getElementById('ticketFormView');
  var supportModal = document.getElementById('supportModal');

  function openModal()  { modalBackdrop.classList.add('open');    document.body.style.overflow = 'hidden'; }
  function closeModal() {
    modalBackdrop.classList.remove('open');
    document.body.style.overflow = '';
    /* go back to links view */
    if (ticketView) ticketView.style.display = 'none';
    if (linksView)  linksView.style.display  = 'block';
    supportModal.classList.remove('modal--ticket');
  }

  /* ticket form */
  document.getElementById('openTicketBtn').addEventListener('click', function (e) {
    e.preventDefault();
    if (!state.loggedIn) {
      showToast('\u26a0 Please log in with Discord to open a ticket.', 'warn');
      return;
    }
    linksView.style.display  = 'none';
    ticketView.style.display = 'block';
    supportModal.classList.add('modal--ticket');
  });
  document.getElementById('ticketBack').addEventListener('click', function () {
    ticketView.style.display = 'none';
    linksView.style.display  = 'block';
    supportModal.classList.remove('modal--ticket');
  });

  /* label pill toggle */
  document.getElementById('ticketLabels').addEventListener('click', function (e) {
    var pill = e.target.closest('.ticket-label-pill');
    if (pill) pill.classList.toggle('selected');
  });

  document.getElementById('ticketSubmit').addEventListener('click', function () {
    var titleEl  = document.getElementById('issueTitle');
    var bodyEl   = document.getElementById('ticketBody');
    var submitBtn = document.getElementById('ticketSubmit');
    var title = titleEl.value.trim();
    var body  = bodyEl.value.trim();
    if (!title) { showToast('\u26a0 Please enter a title.', 'warn'); return; }

    var labels = [];
    document.querySelectorAll('.ticket-label-pill.selected').forEach(function (p) {
      labels.push(p.getAttribute('data-label'));
    });

    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting\u2026';

    fetch('/api/ticket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title, body: body, labels: labels }),
    })
    .then(function (resp) { return resp.json().then(function (d) { return { ok: resp.ok, data: d }; }); })
    .then(function (result) {
      if (result.ok) {
        var msg = '\u2713 Issue created!';
        if (result.data.issue_url) msg += ' <a href="' + result.data.issue_url + '" target="_blank" style="color:var(--gold-light);text-decoration:underline;">View on GitHub</a>';
        showToast(msg, 'success');
        titleEl.value = '';
        bodyEl.value = '';
        document.querySelectorAll('.ticket-label-pill.selected').forEach(function (p) { p.classList.remove('selected'); });
        closeModal();
      } else {
        showToast('\u26a0 ' + (result.data.error || 'Failed to create issue.'), 'warn');
      }
    })
    .catch(function () {
      showToast('\u26a0 Network error. Please try again.', 'warn');
    })
    .finally(function () {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit new ticket';
    });
  });

  /* toast */
  var showToast = window.showToast;

  /* panel switching */
  function switchToPanel(panel) {
    const validPanels = ['player', 'guild', 'bot', 'profile', 'inactivity', 'promotions'];
    let target = validPanels.includes(panel) ? panel : 'player';
    // quietly fall back if they can't access the panel
    if (target === 'inactivity' && !hasParliamentPlus()) target = 'player';
    if (target === 'promotions' && !hasJurorPlus())     target = 'player';
    navItems.forEach(n => n.classList.remove('active'));
    const navItem = document.querySelector(`[data-panel="${target}"]`);
    if (navItem) navItem.classList.add('active');
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    const panelEl = document.getElementById('panel-' + target);
    if (panelEl) panelEl.classList.add('active');
  }

  /* jump to player page and search a name */
  function goToPlayer(username, options) {
    switchToPanel('player');
    var input = document.getElementById('playerInput');
    if (input) input.value = username;
    history.pushState(null, '', '#player/' + encodeURIComponent(username));
    if (window.lookupPlayer) window.lookupPlayer(username, options || null);
  }
  window.goToPlayer = goToPlayer;

  /* expose globals */
  window.switchToPanel     = switchToPanel;
  applyPermissions();

  /* settings infrastructure */
  var SETTINGS_KEY = 'esi_settings';
  var SETTINGS_DEFAULTS = {
    defaultGraphMetric: 'playtime',
    defaultGraphRange:  30,
    defaultPlayer:      '',
    checkerType:        'first',
    checkerHours:       2,
    checkerTab:         'inactive',
    promotionsTab:      'recruiter',
    toastDuration:      7,
    toastMax:           3,
    guildDefaultMetric: 'playerCount',
    guildDefaultRange:  30,
  };

  function _readAllSettings() {
    try { return Object.assign({}, SETTINGS_DEFAULTS, JSON.parse(localStorage.getItem(SETTINGS_KEY))); }
    catch (e) { return Object.assign({}, SETTINGS_DEFAULTS); }
  }
  function _writeAllSettings(obj) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj));
  }

  var esiSettings = {
    get: function (key) {
      var all = _readAllSettings();
      return key in all ? all[key] : SETTINGS_DEFAULTS[key];
    },
    set: function (key, val) {
      var all = _readAllSettings();
      all[key] = val;
      _writeAllSettings(all);
    },
    read:     _readAllSettings,
    write:    _writeAllSettings,
    defaults: SETTINGS_DEFAULTS,
    reset: function () {
      _writeAllSettings(Object.assign({}, SETTINGS_DEFAULTS));
    },
  };
  window.esiSettings = esiSettings;

  /* settings modal open/close */
  var settingsBackdrop = document.getElementById('settingsModalBackdrop');
  var settingsCloseBtn = document.getElementById('settingsModalClose');
  var settingsBtn      = document.getElementById('settingsBtn');
  var settingsResetBtn = document.getElementById('settingsResetBtn');
  var settingsSaveBtn  = document.getElementById('settingsSaveBtn');

  var _settingsSnapshot = null; // saved state when modal opened

  function openSettings() {
    _populateSettingsForm();
    _settingsSnapshot = _readFormValues();
    _updateLoginRows();
    _updateSaveBtn();
    settingsBackdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  function closeSettings() {
    settingsBackdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  settingsBtn.addEventListener('click', openSettings);
  settingsCloseBtn.addEventListener('click', closeSettings);
  settingsBackdrop.addEventListener('click', function (e) {
    if (e.target === settingsBackdrop) closeSettings();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && settingsBackdrop.classList.contains('open')) closeSettings();
  });

  /* settings form elements */
  var _sMetric      = document.getElementById('settingDefaultMetric');
  var _sRange       = document.getElementById('settingDefaultRange');
  var _sRangeVal    = document.getElementById('settingDefaultRangeVal');
  var _sGuildMetric = document.getElementById('settingGuildMetric');
  var _sGuildRange  = document.getElementById('settingGuildRange');
  var _sGuildRangeVal = document.getElementById('settingGuildRangeVal');
  var _sPlayer      = document.getElementById('settingDefaultPlayer');
  var _sChkType  = document.getElementById('settingCheckerType');
  var _sChkHours = document.getElementById('settingCheckerHours');
  var _sChkTab   = document.getElementById('settingCheckerTab');
  var _sPromTab  = document.getElementById('settingPromotionsTab');
  var _sToastDur = document.getElementById('settingToastDuration');
  var _sToastMax = document.getElementById('settingToastMax');

  function _populateSettingsForm() {
    var s = _readAllSettings();
    _sMetric.value   = s.defaultGraphMetric || 'playtime';
    _sRange.value    = s.defaultGraphRange  || 30;
    _sRangeVal.textContent = _sRange.value;
    _sGuildMetric.value = s.guildDefaultMetric || 'playerCount';
    _sGuildRange.value  = s.guildDefaultRange  || 30;
    _sGuildRangeVal.textContent = _sGuildRange.value;
    _sPlayer.value   = s.defaultPlayer      || '';
    _sChkType.value  = s.checkerType        || 'first';
    _sChkHours.value = s.checkerHours != null ? s.checkerHours : 2;
    _sChkTab.value   = s.checkerTab         || 'inactive';
    _sPromTab.value  = s.promotionsTab      || 'recruiter';
    _sToastDur.value = s.toastDuration != null ? s.toastDuration : 7;
    _sToastMax.value = s.toastMax != null    ? s.toastMax : 3;
  }

  function _readFormValues() {
    return {
      defaultGraphMetric: _sMetric.value,
      defaultGraphRange:  parseInt(_sRange.value, 10) || 30,
      guildDefaultMetric: _sGuildMetric.value,
      guildDefaultRange:  parseInt(_sGuildRange.value, 10) || 30,
      defaultPlayer:      _sPlayer.value.trim(),
      checkerType:        _sChkType.value,
      checkerHours:       Math.max(0, Math.min(10, parseFloat(_sChkHours.value) || 2)),
      checkerTab:         _sChkTab.value,
      promotionsTab:      _sPromTab.value,
      toastDuration:      Math.max(1, Math.min(30, parseInt(_sToastDur.value, 10) || 7)),
      toastMax:           Math.max(1, Math.min(6, parseInt(_sToastMax.value, 10) || 3)),
    };
  }

  function _isDirty() {
    if (!_settingsSnapshot) return false;
    var current = _readFormValues();
    for (var key in current) {
      if (current[key] !== _settingsSnapshot[key]) return true;
    }
    return false;
  }

  function _updateSaveBtn() {
    settingsSaveBtn.style.display = _isDirty() ? '' : 'none';
  }

  function _updateLoginRows() {
    var canInactivity = hasParliamentPlus();
    var canPromotions = hasJurorPlus();
    var isLoggedIn    = state.loggedIn;

    // remove rows the user can't access
    var inacRow  = document.getElementById('settingInactivityRow');
    var promRow  = document.getElementById('settingPromotionsRow');
    var toastRow = document.getElementById('settingToastRow');
    if (inacRow  && !canInactivity) inacRow.remove();
    if (promRow  && !canPromotions) promRow.remove();
    if (toastRow && !isLoggedIn)    toastRow.remove();

    // remove the entire section if nothing remains
    var loginSection = document.getElementById('settingsLoginSection');
    if (loginSection) {
      var remaining = loginSection.querySelectorAll('.settings-row');
      if (!remaining.length) loginSection.remove();
    }
  }

  /* clamp number inputs on blur */
  function _clampOnBlur(el, min, max, fallback) {
    el.addEventListener('blur', function () {
      var v = parseFloat(this.value);
      if (isNaN(v)) { this.value = fallback; }
      else { this.value = Math.max(min, Math.min(max, v)); }
      _updateSaveBtn();
    });
  }
  _clampOnBlur(_sChkHours, 0, 10, 2);
  _clampOnBlur(_sToastDur, 1, 15, 7);
  _clampOnBlur(_sToastMax, 1, 6, 3);

  /* track changes — don't save yet, just show the save button */
  _sRange.addEventListener('input', function () { _sRangeVal.textContent = _sRange.value; _updateSaveBtn(); });
  _sGuildRange.addEventListener('input', function () { _sGuildRangeVal.textContent = _sGuildRange.value; _updateSaveBtn(); });
  [_sMetric, _sGuildMetric, _sPlayer, _sChkType, _sChkHours, _sChkTab, _sPromTab, _sToastDur, _sToastMax].forEach(function (el) {
    el.addEventListener('change', _updateSaveBtn);
    el.addEventListener('input', _updateSaveBtn);
  });

  /* save button — persist all current form values, then apply live */
  settingsSaveBtn.addEventListener('click', function () {
    var values = _readFormValues();
    _writeAllSettings(values);
    _settingsSnapshot = values;
    _updateSaveBtn();
    showToast('\u2713 Settings saved. Reload the page to fully apply all changes.', 'success');
  });

  /* reset button */
  settingsResetBtn.addEventListener('click', function () {
    esiSettings.reset();
    _populateSettingsForm();
    _settingsSnapshot = _readFormValues();
    _updateSaveBtn();
    showToast('Settings reset to defaults.', 'info');
  });

})();
