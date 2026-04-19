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
  const manageSection   = document.getElementById('manageSection');
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

  var _acctMouseDownOnBackdrop = false;
  accountModalBackdrop.addEventListener('mousedown', function (e) { _acctMouseDownOnBackdrop = e.target === accountModalBackdrop; });
  accountModalBackdrop.addEventListener('mouseup', function (e) {
    if (_acctMouseDownOnBackdrop && e.target === accountModalBackdrop) closeAccountModal();
    _acctMouseDownOnBackdrop = false;
  });
  document.getElementById('accountModalClose').addEventListener('click', closeAccountModal);

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
      sessionStorage.setItem('esi_auth_return', window.location.pathname || '/');
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
    // restore the path the user was on before the redirect
    var savedPath = sessionStorage.getItem('esi_auth_return') || '/';
    sessionStorage.removeItem('esi_auth_return');
    // clean the URL so refreshing doesn't re-trigger the toast
    params.delete('auth');
    var clean = savedPath + (params.toString() ? '?' + params.toString() : '');
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
    rolesEl.innerHTML = '';
    if (roles.length === 0) {
      var empty = document.createElement('div');
      empty.style.cssText = 'padding:16px 20px;color:var(--text-faint);font-style:italic';
      empty.textContent = 'No roles';
      rolesEl.appendChild(empty);
    } else {
      roles.forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'profile-role-row';
        var nameSpan = document.createElement('span');
        nameSpan.className = 'profile-role-name';
        nameSpan.textContent = r.name;
        var idSpan = document.createElement('span');
        idSpan.className = 'profile-role-id';
        idSpan.textContent = r.id;
        row.appendChild(nameSpan);
        row.appendChild(idSpan);
        rolesEl.appendChild(row);
      });
    }
  }


// role config — loaded from /api/config (single source of truth on the server)
var ESI_STAFF_ROLES   = [];
var ESI_RANK_ROLES    = [];
var ESI_ECHELON_ROLES = [];
var ESI_CITIZEN_ROLE  = { id: '', name: '', color: '' };
var ESI_MEDALS        = [];
var ESI_BADGES        = [];
var _PARLIAMENT_PLUS  = [];
var _JUROR_PLUS       = [];
var _configLoaded     = false;

var _configPromise = fetch('/api/config')
  .then(function (r) { return r.json(); })
  .then(function (cfg) {
    ESI_STAFF_ROLES   = cfg.staffRoles   || [];
    ESI_RANK_ROLES    = cfg.rankRoles    || [];
    ESI_ECHELON_ROLES = cfg.echelonRoles || [];
    ESI_CITIZEN_ROLE  = cfg.citizenRole  || ESI_CITIZEN_ROLE;
    ESI_MEDALS        = cfg.medals       || [];
    ESI_BADGES        = cfg.badges       || [];
    _PARLIAMENT_PLUS  = cfg.permissions  ? cfg.permissions.parliamentPlus || [] : [];
    _JUROR_PLUS       = cfg.permissions  ? cfg.permissions.jurorPlus || [] : [];
    _configLoaded     = true;
  })
  .catch(function () {});

function _esiRoleBadgeEl(name, color, large) {
  var span = document.createElement('span');
  span.className = 'account-role-badge';
  span.style.cssText = 'color:' + color + ';background:' + color + '22;border-color:' + color + '66;'
    + (large ? 'font-size:0.78rem;font-weight:600;padding:5px 18px;' : 'font-size:0.67rem;padding:3px 12px;');
  span.textContent = name;
  return span;
}

function renderAccountModalMedals(userRoles) {
  var el = document.getElementById('accountModalMedals');
  if (!el) return;
  el.textContent = '';
  var roleSet = {};
  (userRoles || []).forEach(function (id) { roleSet[id] = true; });
  var owned = ESI_MEDALS.filter(function (m) { return roleSet[m.role_id]; }).slice(0, 8);
  owned.forEach(function (m) {
    var wrap = document.createElement('div');
    wrap.className = 'account-medal';
    wrap.title = m.name + ' [' + m.abbr + ']';
    var img = document.createElement('img');
    img.className = 'account-medal-img';
    img.src = m.icon;
    img.alt = m.name;
    wrap.appendChild(img);
    el.appendChild(wrap);
  });
  el.style.display = owned.length ? '' : 'none';
}

function renderAccountModalBadges(userRoles) {
  var el = document.getElementById('accountModalBadges');
  if (!el) return;
  el.textContent = '';
  var roleSet = {};
  (userRoles || []).forEach(function (id) { roleSet[id] = true; });
  var picks = [];
  ESI_BADGES.forEach(function (cat) {
    // tiers are ordered top → bottom; pick the highest tier the user owns
    for (var i = 0; i < cat.tiers.length; i++) {
      var t = cat.tiers[i];
      if (roleSet[t.role_id]) {
        picks.push({ label: t.label, colour: t.colour });
        break;
      }
    }
  });
  picks.slice(0, 4).forEach(function (p) {
    var pill = document.createElement('span');
    pill.className = 'account-badge-pill';
    pill.style.color = p.colour;
    pill.style.background = p.colour + '22';
    pill.style.borderColor = p.colour + '66';
    pill.textContent = p.label;
    el.appendChild(pill);
  });
  el.style.display = picks.length ? '' : 'none';
}

function renderAccountModalRoles(userRoles, userId) {
  renderAccountModalMedals(userRoles);
  renderAccountModalBadges(userRoles);
  var el = document.getElementById('accountModalRoles');
  if (!el) return;
  el.innerHTML = '';

  // Staff badges (set manually by user ID)
  if (userId) {
    ESI_STAFF_ROLES.forEach(function(role) {
      if (role.members.includes(userId)) el.appendChild(_esiRoleBadgeEl(role.name, role.color, true));
    });
  }

  // Upper Echelon: Parliament supersedes Congress; Juror shown independently
  var _echelonIds = ESI_ECHELON_ROLES.map(function(r) { return r.id; });
  var _valaendorId = _PARLIAMENT_PLUS.find(function(id) { return !_echelonIds.includes(id); }) || '';
  var _parli = ESI_ECHELON_ROLES.find(function(r) { return r.name === 'Parliament'; });
  var _cong  = ESI_ECHELON_ROLES.find(function(r) { return r.name === 'Congress'; });
  var _jur   = ESI_ECHELON_ROLES.find(function(r) { return r.name === 'Juror'; });
  var hasValaendor  = _valaendorId && userRoles.includes(_valaendorId);
  var hasParliament = _parli ? userRoles.includes(_parli.id) : false;
  var hasCongress   = _cong  ? userRoles.includes(_cong.id)  : false;
  var hasJuror      = _jur   ? userRoles.includes(_jur.id)   : false;
  if (hasValaendor) {
    el.appendChild(_esiRoleBadgeEl('\ud83d\udc51 Valaendor', '#7744b6', true));
  } else if (hasParliament) {
    el.appendChild(_esiRoleBadgeEl('\ud83c\udfdb\ufe0f Parliament', '#afb3d1', true));
  } else if (hasCongress) {
    el.appendChild(_esiRoleBadgeEl('\ud83c\udff5\ufe0f Congress', '#7289da', true));
  }
  if (hasJuror && !hasParliament && !hasCongress) {
    el.appendChild(_esiRoleBadgeEl('\u2696 Juror', '#ffc332', true));
  }

  // Highest rank only (shown below Upper Echelon)
  var rank = ESI_RANK_ROLES.find(function(r) { return userRoles.includes(r.id); });
  if (rank) el.appendChild(_esiRoleBadgeEl(rank.name, rank.color, false));

  el.style.display = el.children.length ? '' : 'none';
}

// strip sensitive data before caching to localStorage
function _userForCache(user) {
  return {
    id:       user.id,
    username: user.username,
    nick:     user.nick,
    avatar:   user.avatar,
  };
}

// apply a verified user object and lock down permissions accordingly
var _defaultPlayerFetched = false;
function applyLogin(user) {
    state.loggedIn = true;
    state.user     = user;
    updateLoginButton();
    // wait for config to load before applying role-dependent UI
    _configPromise.then(function () {
      applyPermissions();
      renderProfile(user);
      renderAccountModalRoles(user.roles || [], user.id);
    });

    // sync settings from server (first login on this device restores them)
    _syncSettingsFromServer();

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
            localStorage.setItem('esi_user', JSON.stringify(_userForCache(data.user)));
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
          localStorage.setItem('esi_user', JSON.stringify(_userForCache(fresh.user)));
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

  /* role checks — uses permission groups from /api/config */
  function hasParliamentPlus() {
    if (!state.loggedIn || !state.user) return false;
    var roles = state.user.roles || [];
    return _PARLIAMENT_PLUS.some(function (id) { return roles.includes(id); });
  }

  function hasJurorPlus() {
    if (!state.loggedIn || !state.user) return false;
    var roles = state.user.roles || [];
    return _JUROR_PLUS.some(function (id) { return roles.includes(id); });
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
  var _modalMouseDownOnBackdrop = false;
  modalBackdrop.addEventListener('mousedown', e => { _modalMouseDownOnBackdrop = e.target === modalBackdrop; });
  modalBackdrop.addEventListener('mouseup', e => {
    if (_modalMouseDownOnBackdrop && e.target === modalBackdrop) closeModal();
    _modalMouseDownOnBackdrop = false;
  });

  var linksView    = document.getElementById('supportLinksView');
  var ticketView   = document.getElementById('ticketFormView');
  var supportModal = document.getElementById('supportModal');

  function openModal()  { modalBackdrop.classList.add('open');    document.body.style.overflow = 'hidden'; }
  function closeModal() {
    /* if the ticket form is showing, go back to links view instead of closing */
    if (supportModal.classList.contains('modal--ticket')) {
      ticketView.style.display = 'none';
      linksView.style.display  = 'block';
      supportModal.classList.remove('modal--ticket');
      return;
    }
    modalBackdrop.classList.remove('open');
    document.body.style.overflow = '';
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

  /* ticket preview (Write / Preview tabs) */
  var tabWrite   = document.getElementById('tabWrite');
  var tabPreview = document.getElementById('tabPreview');
  var writePane  = document.getElementById('ticketWritePane');
  var previewPane = document.getElementById('ticketPreviewPane');
  var previewContent = document.getElementById('ticketPreviewContent');

  tabWrite.addEventListener('click', function () {
    tabWrite.classList.add('active');
    tabPreview.classList.remove('active');
    writePane.style.display  = '';
    previewPane.style.display = 'none';
  });
  tabPreview.addEventListener('click', function () {
    tabPreview.classList.add('active');
    tabWrite.classList.remove('active');
    writePane.style.display  = 'none';
    previewPane.style.display = '';
    var body = document.getElementById('ticketBody').value;
    var rendered = body.trim() ? renderMarkdown(body) : '';
    previewContent.innerHTML = typeof DOMPurify !== 'undefined'
      ? DOMPurify.sanitize(rendered, { ADD_TAGS: ['details', 'summary'], ADD_ATTR: ['target', 'rel', 'style'] })
      : rendered;
  });

  /* markdown renderer */
  var ALERT_ICONS = {
    NOTE:      '\u2139\ufe0f',
    TIP:       '\ud83d\udca1',
    IMPORTANT: '\ud83d\udcdd',
    WARNING:   '\u26a0\ufe0f',
    CAUTION:   '\u26d4',
  };

  function _esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _safeUrl(url) {
    try {
      var u = new URL(url, window.location.origin);
      return (u.protocol === 'https:' || u.protocol === 'http:') ? url : '#';
    } catch (e) { return '#'; }
  }

  function _inline(text) {
    // handle escape sequences: \* \_ \` \# etc.
    // replace escaped chars with placeholders, process, then restore
    var escapes = [];
    text = text.replace(/\\([\\`*_{}\[\]()#+\-.!|>~])/g, function (_, ch) {
      escapes.push(ch);
      return '\x00ESC' + (escapes.length - 1) + '\x00';
    });

    // inline code (must be before other inline formatting)
    text = text.replace(/`([^`]+)`/g, function (_, code) {
      return '<code>' + _esc(code) + '</code>';
    });
    // images  ![alt](url)
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, function (_, alt, url) {
      return '<img src="' + _esc(_safeUrl(url)) + '" alt="' + _esc(alt) + '" />';
    });
    // links  [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (_, label, url) {
      return '<a href="' + _esc(_safeUrl(url)) + '" target="_blank" rel="noopener">' + label + '</a>';
    });
    // bold **text**
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // italic _text_
    text = text.replace(/(?<![\w])_(.+?)_(?![\w])/g, '<em>$1</em>');
    // mentions @user
    text = text.replace(/@([\w.-]+)/g, '<span class="md-mention">@$1</span>');
    // issue references #123
    text = text.replace(/#(\d+)/g, '<span class="md-issue-ref">#$1</span>');

    // restore escaped characters
    text = text.replace(/\x00ESC(\d+)\x00/g, function (_, idx) {
      return _esc(escapes[parseInt(idx, 10)]);
    });
    return text;
  }

  function renderMarkdown(src) {
    var lines = src.replace(/\r\n/g, '\n').split('\n');
    var html = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      // fenced code blocks ```lang
      var codeMatch = line.match(/^```(\w*)\s*$/);
      if (codeMatch) {
        var lang = codeMatch[1] || '';
        var codeLines = [];
        i++;
        while (i < lines.length && !lines[i].match(/^```\s*$/)) {
          codeLines.push(_esc(lines[i]));
          i++;
        }
        i++; // skip closing ```
        html.push('<pre><code' + (lang ? ' class="language-' + _esc(lang) + '"' : '') + '>' + codeLines.join('\n') + '</code></pre>');
        continue;
      }

      // HTML details/summary, only allow safe structure, escape inner content
      if (line.match(/^<details>/i)) {
        var summaryText = 'Details';
        var detailBody = [];
        i++;
        if (i < lines.length) {
          var sumMatch = lines[i].match(/^<summary>(.*?)<\/summary>$/i);
          if (sumMatch) {
            summaryText = _esc(sumMatch[1]);
            i++;
          }
        }
        while (i < lines.length && !lines[i].match(/<\/details>/i)) {
          var dl = lines[i].replace(/^<\/?p>$/i, '').trim();
          if (dl) detailBody.push(_esc(dl));
          i++;
        }
        if (i < lines.length) i++;
        html.push(
          '<details><summary>' + summaryText + '</summary>' +
          (detailBody.length ? '<p>' + detailBody.join('<br>') + '</p>' : '') +
          '</details>'
        );
        continue;
      }

      // tables: | Header | Header |
      if (line.match(/^\|(.+)\|\s*$/) && i + 1 < lines.length && lines[i + 1].match(/^\|[\s:|-]+\|\s*$/)) {
        var headerCells = line.split('|').slice(1, -1).map(function (c) { return c.trim(); });
        i += 2; // skip header + separator
        var rows = [];
        while (i < lines.length && lines[i].match(/^\|(.+)\|\s*$/)) {
          rows.push(lines[i].split('|').slice(1, -1).map(function (c) { return c.trim(); }));
          i++;
        }
        var tableHtml = '<table><thead><tr>' + headerCells.map(function (c) { return '<th>' + _inline(_esc(c)) + '</th>'; }).join('') + '</tr></thead><tbody>';
        rows.forEach(function (row) {
          tableHtml += '<tr>' + row.map(function (c) { return '<td>' + _inline(_esc(c)) + '</td>'; }).join('') + '</tr>';
        });
        tableHtml += '</tbody></table>';
        html.push(tableHtml);
        continue;
      }

      // GitHub alerts: > [!NOTE] / > [!TIP] / etc.
      var alertMatch = line.match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i);
      if (alertMatch) {
        var alertType = alertMatch[1].toUpperCase();
        var alertBody = [];
        i++;
        while (i < lines.length && lines[i].match(/^>/)) {
          alertBody.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        var icon = ALERT_ICONS[alertType] || '';
        var typeLower = alertType.toLowerCase();
        html.push(
          '<div class="md-alert md-alert-' + typeLower + '">' +
          '<div class="md-alert-title">' + icon + ' ' + alertType.charAt(0) + alertType.slice(1).toLowerCase() + '</div>' +
          alertBody.filter(function (l) { return l.trim(); }).map(function (l) { return '<p>' + _inline(_esc(l)) + '</p>'; }).join('') +
          '</div>'
        );
        continue;
      }

      // blockquotes
      if (line.match(/^>\s?/)) {
        var quoteLines = [];
        while (i < lines.length && lines[i].match(/^>/)) {
          quoteLines.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        html.push('<blockquote>' + quoteLines.map(function (l) { return '<p>' + _inline(_esc(l)) + '</p>'; }).join('') + '</blockquote>');
        continue;
      }

      // headings
      var headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
      if (headingMatch) {
        var level = headingMatch[1].length;
        html.push('<h' + level + '>' + _inline(_esc(headingMatch[2])) + '</h' + level + '>');
        i++;
        continue;
      }

      // task list: - [ ] or - [x]
      if (line.match(/^-\s+\[[ xX]\]\s/)) {
        var taskItems = [];
        while (i < lines.length && lines[i].match(/^-\s+\[[ xX]\]\s/)) {
          var checked = lines[i].match(/^-\s+\[[xX]\]/) ? ' checked disabled' : ' disabled';
          var taskText = lines[i].replace(/^-\s+\[[ xX]\]\s*/, '');
          taskItems.push('<li><input type="checkbox"' + checked + ' />' + _inline(_esc(taskText)) + '</li>');
          i++;
        }
        html.push('<ul style="list-style:none;padding-left:4px;">' + taskItems.join('') + '</ul>');
        continue;
      }

      // unordered list: - item
      if (line.match(/^-\s+\S/)) {
        var ulItems = [];
        while (i < lines.length && lines[i].match(/^-\s+\S/)) {
          ulItems.push('<li>' + _inline(_esc(lines[i].replace(/^-\s+/, ''))) + '</li>');
          i++;
        }
        html.push('<ul>' + ulItems.join('') + '</ul>');
        continue;
      }

      // ordered list: 1. item
      if (line.match(/^\d+\.\s+/)) {
        var olItems = [];
        while (i < lines.length && lines[i].match(/^\d+\.\s+/)) {
          olItems.push('<li>' + _inline(_esc(lines[i].replace(/^\d+\.\s+/, ''))) + '</li>');
          i++;
        }
        html.push('<ol>' + olItems.join('') + '</ol>');
        continue;
      }

      // empty line
      if (!line.trim()) {
        i++;
        continue;
      }

      // paragraph
      html.push('<p>' + _inline(_esc(line)) + '</p>');
      i++;
    }

    return html.join('\n');
  }

  /* ── slash commands ── */
  var SLASH_COMMANDS = [
    { name: '/alert',   desc: 'Insert an alert callout',       sub: ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'] },
    { name: '/code',    desc: 'Insert a code block',           sub: ['No Syntax','JavaScript','CSS','Python','HTML','C','C#','C++','CoffeeScript','Dart','DM','Elixir','Go','Groovy','Java','Kotlin','Objective-C','Perl','PHP','PowerShell','Ruby','Rust','Scala','Shell','Swift','TypeScript'] },
    { name: '/details', desc: 'Insert a collapsible section' },
    { name: '/table',   desc: 'Insert a table' },
  ];
  var slashDropdown = document.getElementById('slashDropdown');
  var _slashFocusIdx = -1;
  var _slashFiltered = [];
  var _slashSubMenu = null; // when showing sub-options

  function _showSlashDropdown(items, onClick) {
    _slashFocusIdx = 0;
    slashDropdown.innerHTML = items.map(function (item, idx) {
      return '<div class="slash-item' + (idx === 0 ? ' focused' : '') + '" data-idx="' + idx + '">' +
        '<span class="slash-item-name">' + _esc(item.name || item) + '</span>' +
        (item.desc ? '<span class="slash-item-desc">' + _esc(item.desc) + '</span>' : '') +
        '</div>';
    }).join('');
    slashDropdown.style.display = '';
    slashDropdown.querySelectorAll('.slash-item').forEach(function (el) {
      el.addEventListener('click', function () {
        onClick(parseInt(el.dataset.idx, 10));
      });
    });
  }

  function _hideSlashDropdown() {
    slashDropdown.style.display = 'none';
    slashDropdown.innerHTML = '';
    _slashSubMenu = null;
    _slashFocusIdx = -1;
  }

  function _insertAtCursor(textarea, text, selectRange) {
    var start = textarea.selectionStart;
    var end   = textarea.selectionEnd;
    var before = textarea.value.substring(0, start);
    var after  = textarea.value.substring(end);
    // remove the slash command text from the current line
    var lineStart = before.lastIndexOf('\n') + 1;
    before = before.substring(0, lineStart);
    textarea.value = before + text + after;
    var cursorPos = before.length + text.length;
    textarea.selectionStart = textarea.selectionEnd = cursorPos;
    textarea.focus();
  }

  function _handleSlashSelect(idx) {
    var textarea = document.getElementById('ticketBody');
    if (_slashSubMenu) {
      // sub-option selected
      var cmd = _slashSubMenu;
      var option = _slashFiltered[idx];
      if (typeof option === 'object') option = option.name || option;
      if (cmd.name === '/alert') {
        _insertAtCursor(textarea, '> [!' + option + ']\n> ');
      } else if (cmd.name === '/code') {
        var lang = option === 'No Syntax' ? '' : option.toLowerCase().replace('#', 'sharp').replace('++', 'pp').replace(/[^a-z]/g, '');
        _insertAtCursor(textarea, '```' + lang + '\n\n```');
      }
      _hideSlashDropdown();
      return;
    }
    var command = _slashFiltered[idx];
    if (command.sub) {
      // show sub-menu
      _slashSubMenu = command;
      _slashFiltered = command.sub;
      _showSlashDropdown(command.sub.map(function (s) { return { name: s }; }), _handleSlashSelect);
      return;
    }
    // no sub — insert directly
    if (command.name === '/details') {
      _insertAtCursor(textarea, '<details><summary>Details</summary>\n<p>\n\n</p>\n</details>');
    } else if (command.name === '/table') {
      _insertAtCursor(textarea, '| Header | Header |\n|--------|--------|\n| Cell | Cell |\n| Cell | Cell |');
    }
    _hideSlashDropdown();
  }

  document.getElementById('ticketBody').addEventListener('input', function () {
    var textarea = this;
    var val = textarea.value;
    var pos = textarea.selectionStart;
    // get text from start of current line to cursor
    var lineStart = val.lastIndexOf('\n', pos - 1) + 1;
    var lineText  = val.substring(lineStart, pos);

    if (lineText.startsWith('/') && !_slashSubMenu) {
      var query = lineText.toLowerCase();
      _slashFiltered = SLASH_COMMANDS.filter(function (c) {
        return c.name.indexOf(query) === 0;
      });
      if (_slashFiltered.length) {
        _showSlashDropdown(_slashFiltered, _handleSlashSelect);
      } else {
        _hideSlashDropdown();
      }
    } else if (!lineText.startsWith('/')) {
      _hideSlashDropdown();
    }
  });

  document.getElementById('ticketBody').addEventListener('keydown', function (e) {
    if (slashDropdown.style.display === 'none') return;
    var items = slashDropdown.querySelectorAll('.slash-item');
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[_slashFocusIdx].classList.remove('focused');
      _slashFocusIdx = (_slashFocusIdx + 1) % items.length;
      items[_slashFocusIdx].classList.add('focused');
      items[_slashFocusIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[_slashFocusIdx].classList.remove('focused');
      _slashFocusIdx = (_slashFocusIdx - 1 + items.length) % items.length;
      items[_slashFocusIdx].classList.add('focused');
      items[_slashFocusIdx].scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      _handleSlashSelect(_slashFocusIdx);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      _hideSlashDropdown();
    }
  });

  /* ── file upload ── */
  var ticketFileArea  = document.getElementById('ticketFileArea');
  var ticketFileBtn   = document.getElementById('ticketFileBtn');
  var ticketFileInput = document.getElementById('ticketFileInput');

  ticketFileBtn.addEventListener('click', function () {
    ticketFileInput.click();
  });

  ticketFileInput.addEventListener('change', function () {
    if (this.files && this.files.length) _uploadFiles(this.files);
    this.value = '';
  });

  // drag & drop on the file area
  ticketFileArea.addEventListener('dragover', function (e) {
    e.preventDefault();
    ticketFileArea.classList.add('dragover');
  });
  ticketFileArea.addEventListener('dragleave', function () {
    ticketFileArea.classList.remove('dragover');
  });
  ticketFileArea.addEventListener('drop', function (e) {
    e.preventDefault();
    ticketFileArea.classList.remove('dragover');
    if (e.dataTransfer && e.dataTransfer.files.length) {
      _uploadFiles(e.dataTransfer.files);
    }
  });

  // paste on the textarea
  document.getElementById('ticketBody').addEventListener('paste', function (e) {
    var items = (e.clipboardData || e.originalEvent.clipboardData || {}).items;
    if (!items) return;
    var files = [];
    for (var k = 0; k < items.length; k++) {
      if (items[k].kind === 'file') files.push(items[k].getAsFile());
    }
    if (files.length) {
      e.preventDefault();
      _uploadFiles(files);
    }
  });

  function _uploadFiles(fileList) {
    var textarea = document.getElementById('ticketBody');
    Array.from(fileList).forEach(function (file) {
      // show uploading indicator
      var placeholder = '![Uploading ' + file.name + '\u2026]()';
      var pos = textarea.selectionStart;
      textarea.value = textarea.value.substring(0, pos) + placeholder + textarea.value.substring(pos);
      textarea.selectionStart = textarea.selectionEnd = pos + placeholder.length;

      var formData = new FormData();
      formData.append('file', file);

      fetch('/api/upload', {
        method: 'POST',
        credentials: 'same-origin',
        body: formData,
      })
      .then(function (resp) { return resp.json().then(function (d) { return { ok: resp.ok, data: d }; }); })
      .then(function (result) {
        if (result.ok && result.data.url) {
          var isImage = /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(file.name);
          var mdLink = isImage
            ? '![' + file.name + '](' + result.data.url + ')'
            : '[' + file.name + '](' + result.data.url + ')';
          textarea.value = textarea.value.replace(placeholder, mdLink);
        } else {
          textarea.value = textarea.value.replace(placeholder, '');
          showToast('\u26a0 ' + (result.data.error || 'Upload failed.'), 'warn');
        }
      })
      .catch(function () {
        textarea.value = textarea.value.replace(placeholder, '');
        showToast('\u26a0 Upload failed. Please try again.', 'warn');
      });
    });
  }

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
    history.pushState(null, '', '/player/' + encodeURIComponent(username));
    if (window.lookupPlayer) window.lookupPlayer(username, options || null);
  }
  window.goToPlayer = goToPlayer;

  /* expose globals */
  window.switchToPanel     = switchToPanel;
  window.hasJurorPlus      = hasJurorPlus;
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
      _pushSettingsToServer(all);
    },
    read:     _readAllSettings,
    write:    _writeAllSettings,
    defaults: SETTINGS_DEFAULTS,
    reset: function () {
      var defaults = Object.assign({}, SETTINGS_DEFAULTS);
      _writeAllSettings(defaults);
      _pushSettingsToServer(defaults);
    },
  };
  window.esiSettings = esiSettings;

  /* server-side settings sync */
  var _settingsSyncDone = false;

  function _syncSettingsFromServer() {
    if (_settingsSyncDone) return;
    _settingsSyncDone = true;
    fetch('/api/settings', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (serverSettings) {
        if (!serverSettings || typeof serverSettings !== 'object') return;
        if (Object.keys(serverSettings).length === 0) {
          // no server settings yet — push current local settings up
          _pushSettingsToServer(_readAllSettings());
          return;
        }
        // merge: server settings win over local
        var merged = Object.assign({}, SETTINGS_DEFAULTS, _readAllSettings(), serverSettings);
        _writeAllSettings(merged);
      })
      .catch(function () {});
  }

  function _pushSettingsToServer(settings) {
    if (!state.loggedIn) return;
    fetch('/api/settings', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    }).catch(function () {});
  }

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
  var _settingsMouseDownOnBackdrop = false;
  settingsBackdrop.addEventListener('mousedown', function (e) { _settingsMouseDownOnBackdrop = e.target === settingsBackdrop; });
  settingsBackdrop.addEventListener('mouseup', function (e) {
    if (_settingsMouseDownOnBackdrop && e.target === settingsBackdrop) closeSettings();
    _settingsMouseDownOnBackdrop = false;
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (settingsBackdrop.classList.contains('open')) closeSettings();
    else if (accountModalBackdrop.classList.contains('open')) closeAccountModal();
    else if (modalBackdrop.classList.contains('open')) closeModal();
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

    // remove rows the user can't access
    var inacRow  = document.getElementById('settingInactivityRow');
    var promRow  = document.getElementById('settingPromotionsRow');
    if (inacRow  && !canInactivity) inacRow.remove();
    if (promRow  && !canPromotions) promRow.remove();

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
    _pushSettingsToServer(values);
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
