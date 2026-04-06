(function () {
  'use strict';

  /* shared state */
  const state = window.state = {
    loggedIn: false,
    user: null,
    role: 'member',
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
    else mockLogin();
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    closeAccountModal();
    logout();
  });

  function mockLogin() {
    loginBtn.disabled = true;
    loginBtn.innerHTML = `
      <span class="loading-spinner" style="width:16px;height:16px;border-color:rgba(255,255,255,0.3);border-top-color:#fff;"></span>
      Logging in...`;
    loginBtn.style.background = '#4752c4';
    loginBtn.style.boxShadow = 'none';

    fetch('/auth/mock-login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '914186153995927623' }),
    }).then(r => r.json()).then(function(data) {
        if (data.user) {
        // user came back directly
        localStorage.setItem('esi_user', JSON.stringify(data.user));
        applyLogin(data.user);
        showToast('Welcome back, ' + (data.user.nick || data.user.username) + '!', 'success');
      } else if (data.ok) {
        // older server path if session was set but no user in response
        return fetch('/auth/session', { credentials: 'same-origin' })
          .then(r => r.json())
          .then(function(session) {
            if (session.loggedIn && session.user) {
              localStorage.setItem('esi_user', JSON.stringify(session.user));
              applyLogin(session.user);
              showToast('Welcome back, ' + (session.user.nick || session.user.username) + '!', 'success');
            } else {
              updateLoginButton();
            }
          });
      } else {
        throw new Error('Login failed');
      }
    }).catch(function() {
      showToast('\u26a0 Login failed. Please try again.', 'warn');
      updateLoginButton();
    }).finally(function() {
      loginBtn.disabled = false;
    });
  }

  function logout() {
    fetch('/auth/logout', { credentials: 'same-origin' }).catch(function () {});
    localStorage.removeItem('esi_user');
    state.loggedIn = false;
    state.user = null;
    state.role = 'member';
    updateLoginButton();
    applyPermissions();
    showToast('You have left the portal.', 'info');
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


function resolveRole(discordRoles) {
    if (discordRoles.includes('YOUR_ADMIN_ROLE_ID')) return 'admin';
    if (discordRoles.includes('YOUR_MOD_ROLE_ID'))   return 'mod';
    return 'member';
}

// staff roles (hardcoded member IDs until I get them from the Unpaid Labour Discord server)
const ESI_STAFF_ROLES = [
  { name: 'Bot Owner',    color: '#ec00ad', members: ['967867229410574340'] },
  { name: 'Developer',    color: '#0896d3', members: ['454260696172068879'] },
  { name: 'User Support', color: '#4933c5', members: ['516954338225160195'] },
];

// rank roles shown in the account modal
const ESI_RANK_ROLES = [
  { id: '554506531949772812', name: 'Emperor',    color: '#5c11ad' },
  { id: '728858956575014964', name: 'Valaendor',  color: '#c2b2ea' },
  { id: '554514823191199747', name: 'Archduke',   color: '#b5fff6' },
  { id: '1396112289832243282', name: 'Grand Duke', color: '#74cac0' },
  { id: '591765870272053261', name: 'Duke',        color: '#35deac' },
  { id: '1391424890938195998', name: 'Count',      color: '#3ac770' },
  { id: '591769392828776449', name: 'Viscount',    color: '#59e365' },
  { id: '688438690137243892', name: 'Knight',      color: '#93e688' },
  { id: '681030746651230351', name: 'Squire',      color: '#c7edc0' },
];
const ESI_ECHELON_ROLES = [
  { id: '728858956575014964', name: 'Valaendor', colour: '#7744b6' },
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
    html += _esiRoleBadge('🏛️ Valaendor', '#7744b6', true);
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
function applyLogin(user) {
    state.loggedIn = true;
    state.user     = user;
    state.role     = resolveRole(user.roles || []);
    updateLoginButton();
    applyPermissions();
    renderProfile(user);
}

// restore name/avatar from localStorage instantly, but don't grant any roles yet
// (roles get applied once the server confirms the session below)
var savedUser = localStorage.getItem('esi_user');
if (savedUser) {
    try {
        var _cachedUser = JSON.parse(savedUser);
        state.loggedIn = true;
        state.user = Object.assign({}, _cachedUser, { roles: [] });
        state.role = 'member';
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
            // also refresh in the background so it catches role changes
            fetch('/auth/refresh', { credentials: 'same-origin' })
                .then(r => r.json())
                .then(function(fresh) {
                    if (fresh.loggedIn && fresh.user) {
                        localStorage.setItem('esi_user', JSON.stringify(fresh.user));
                        applyLogin(fresh.user);
                    }
                })
                .catch(function() {});
        } else if (state.loggedIn) {
            // server says user is not logged in anymore
            localStorage.removeItem('esi_user');
            state.loggedIn = false;
            state.user     = null;
            state.role     = 'member';
            updateLoginButton();
            applyPermissions();
        }
    })
    .catch(function () { /* server unreachable, just keep what there is */ });

  function updateLoginButton() {
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

  var linksView  = document.getElementById('supportLinksView');
  var ticketView = document.getElementById('ticketFormView');

  function openModal()  { modalBackdrop.classList.add('open');    document.body.style.overflow = 'hidden'; }
  function closeModal() {
    modalBackdrop.classList.remove('open');
    document.body.style.overflow = '';
    /* go back to links view */
    if (ticketView) ticketView.style.display = 'none';
    if (linksView)  linksView.style.display  = 'block';
  }

  /* ticket form */
  document.getElementById('openTicketBtn').addEventListener('click', function (e) {
    e.preventDefault();
    linksView.style.display  = 'none';
    ticketView.style.display = 'block';
  });
  document.getElementById('ticketBack').addEventListener('click', function () {
    ticketView.style.display = 'none';
    linksView.style.display  = 'block';
  });
  document.getElementById('ticketSubmit').addEventListener('click', function () {
    var cat  = document.getElementById('ticketCategory').value;
    var subj = document.getElementById('ticketSubject').value.trim();
    var msg  = document.getElementById('ticketMessage').value.trim();
    if (!cat)  { showToast('\u26a0 Please select a category.', 'warn'); return; }
    if (!subj) { showToast('\u26a0 Please enter a subject.', 'warn'); return; }
    if (!msg)  { showToast('\u26a0 Please enter a message.', 'warn'); return; }
    showToast('\u2713 Ticket submitted! We\'ll get back to you soon.', 'success');
    document.getElementById('ticketCategory').value = '';
    document.getElementById('ticketSubject').value  = '';
    document.getElementById('ticketMessage').value  = '';
    closeModal();
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

})();
