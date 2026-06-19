(function () {
  'use strict';

  function _cssVar(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }

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
  const sidebarNavScroller = sidebar ? sidebar.querySelector('.sidebar-nav') : null;
  const sidebarToggle   = document.getElementById('sidebarToggle');
  const navbar          = document.querySelector('.navbar');
  const navbarLeft      = document.querySelector('.navbar-left');
  const navbarCenter    = document.querySelector('.navbar-center');
  const navbarRight     = document.querySelector('.navbar-right');
  const navbarHamburgerBtn = document.getElementById('navbarHamburgerBtn');
  const sidebarMobileBackdrop = document.getElementById('sidebarMobileBackdrop');
  const MOBILE_SIDEBAR_BREAKPOINT = 720;

  function syncNavbarCenterVisibility() {
    if (!navbar || !navbarLeft || !navbarCenter || !navbarRight) return;
    navbar.classList.remove('navbar-hide-center');
    var navStyle = getComputedStyle(navbar);
    var navGap = parseFloat(navStyle.columnGap || navStyle.gap || '0') || 0;
    var navPaddingLeft = parseFloat(navStyle.paddingLeft || '0') || 0;
    var navPaddingRight = parseFloat(navStyle.paddingRight || '0') || 0;
    var availableWidth = Math.max(0, Math.floor(navbar.clientWidth - navPaddingLeft - navPaddingRight));
    var neededWidth = Math.ceil(
      navbarLeft.getBoundingClientRect().width +
      navbarCenter.getBoundingClientRect().width +
      navbarRight.getBoundingClientRect().width +
      (navGap * 2)
    );
    var shouldHideCenter = neededWidth > availableWidth;
    navbar.classList.toggle('navbar-hide-center', shouldHideCenter);
    try {
      localStorage.setItem('esi_navbar_hide_center', shouldHideCenter ? '1' : '0');
    } catch (_err) {}
  }
  function isMobileSidebarMode() {
    return window.innerWidth <= MOBILE_SIDEBAR_BREAKPOINT;
  }
  function setMobileSidebarOpen(isOpen) {
    if (!sidebar) return;
    var shouldOpen = !!isOpen;
    sidebar.classList.toggle('mobile-open', shouldOpen);
    document.documentElement.classList.toggle('mobile-sidebar-open', shouldOpen);
    if (navbarHamburgerBtn) {
      navbarHamburgerBtn.classList.toggle('active', shouldOpen);
      navbarHamburgerBtn.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    }
    if (sidebarMobileBackdrop) {
      sidebarMobileBackdrop.classList.toggle('active', shouldOpen);
      sidebarMobileBackdrop.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
    }
  }

  window.addEventListener('resize', syncNavbarCenterVisibility);
  window.addEventListener('resize', function () {
    if (!isMobileSidebarMode()) setMobileSidebarOpen(false);
  });
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(syncNavbarCenterVisibility).catch(function () {});
  }
  if (navbarHamburgerBtn) {
    navbarHamburgerBtn.addEventListener('click', function () {
      if (!isMobileSidebarMode()) return;
      setMobileSidebarOpen(!sidebar.classList.contains('mobile-open'));
    });
  }
  if (sidebarMobileBackdrop) {
    sidebarMobileBackdrop.addEventListener('click', function () {
      setMobileSidebarOpen(false);
    });
  }
  var sidebarTouchStartY = 0;
  var sidebarTouchTracking = false;
  document.addEventListener('touchstart', function (e) {
    if (!document.documentElement.classList.contains('mobile-sidebar-open')) return;
    if (!sidebarNavScroller || !sidebarNavScroller.contains(e.target)) {
      sidebarTouchTracking = false;
      return;
    }
    if (!e.touches || !e.touches.length) return;
    sidebarTouchStartY = e.touches[0].clientY;
    sidebarTouchTracking = true;
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (!document.documentElement.classList.contains('mobile-sidebar-open')) return;
    if (!sidebar || !sidebar.contains(e.target)) {
      e.preventDefault();
      return;
    }
    if (!sidebarNavScroller || !sidebarNavScroller.contains(e.target)) {
      e.preventDefault();
      return;
    }
    if (sidebarNavScroller.scrollHeight <= sidebarNavScroller.clientHeight) {
      e.preventDefault();
      return;
    }
    if (!sidebarTouchTracking || !e.touches || !e.touches.length) return;
    var currentY = e.touches[0].clientY;
    var deltaY = currentY - sidebarTouchStartY;
    sidebarTouchStartY = currentY;
    var atTop = sidebarNavScroller.scrollTop <= 0;
    var atBottom = (sidebarNavScroller.scrollTop + sidebarNavScroller.clientHeight) >= (sidebarNavScroller.scrollHeight - 1);
    if ((atTop && deltaY > 0) || (atBottom && deltaY < 0)) {
      e.preventDefault();
    }
  }, { passive: false });
  document.addEventListener('touchend', function () {
    sidebarTouchTracking = false;
  }, { passive: true });
  document.addEventListener('touchcancel', function () {
    sidebarTouchTracking = false;
  }, { passive: true });

  /* sidebar toggle */
  if (localStorage.getItem('sidebarCollapsed') === 'true') {
    sidebar.classList.add('collapsed');
  }
  document.documentElement.classList.remove('sidebar-pre-collapsed');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.documentElement.classList.remove('no-transitions');
  }));
  sidebarToggle.addEventListener('click', () => {
    if (isMobileSidebarMode()) {
      setMobileSidebarOpen(false);
      return;
    }
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    // once the transition ends, resize event so canvases redraw properly
    sidebar.addEventListener('transitionend', function onEnd() {
      sidebar.removeEventListener('transitionend', onEnd);
      window.dispatchEvent(new Event('resize'));
    });
  });
  syncNavbarCenterVisibility();
  setMobileSidebarOpen(false);

  /* nav clicks */
  navItems.forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      const target = item.dataset.panel;
      if (!target) return;
      // if it's a restricted panels, just ignore the click
      if (target === 'shop'          && isShopBanned()) return;
      if (target === 'inactivity'    && !hasParliamentPlus()) return;
      if (target === 'promotions'    && !hasJurorPlus()) return;
      if (target === 'events-manage' && !hasEventsAccess()) return;
      if (target === 'guild-info'    && !hasGuildInfoAccess()) return;
      navItems.forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      const panel = document.getElementById('panel-' + target);
      if (panel) panel.classList.add('active');
      if (window.updateHash) window.updateHash();
      if (isMobileSidebarMode()) setMobileSidebarOpen(false);
    });
  });

  /* login */
  const accountModalBackdrop = document.getElementById('accountModalBackdrop');
  window.Popup.register(accountModalBackdrop, {
    closeBtn: document.getElementById('accountModalClose'),
  });

  function openAccountModal()  { window.Popup.open(accountModalBackdrop); }
  function closeAccountModal() { window.Popup.close(accountModalBackdrop); }
  function setLoginButtonLoadingState() {
    loginBtn.disabled = true;
    loginBtn.setAttribute('aria-busy', 'true');
    var existingIcon = loginBtn.querySelector('.btn-discord-loading-icon, svg, img');
    if (existingIcon) existingIcon.remove();
    var spinner = document.createElement('span');
    spinner.className = 'loading-spinner btn-discord-loading-icon';
    spinner.setAttribute('aria-hidden', 'true');
    spinner.style.width = '20px';
    spinner.style.height = '20px';
    spinner.style.borderColor = 'rgba(255,255,255,0.3)';
    spinner.style.borderTopColor = '#fff';
    loginBtn.insertBefore(spinner, loginBtn.firstChild);
    var label = loginBtn.querySelector('.btn-label');
    if (label) label.textContent = 'Logging in\u2026';
    loginBtn.style.opacity = '1';
    loginBtn.style.background = _cssVar('--discord-hover', '#4752c4');
    loginBtn.style.boxShadow = 'none';
    syncNavbarCenterVisibility();
  }

  loginBtn.addEventListener('click', () => {
    if (state.loggedIn) { openAccountModal(); return; }

    // dev-mode bypass: skip Discord OAuth entirely and let the user
    // impersonate any Discord ID while the site is running locally.
    if (window.ESI_DEV_MODE) {
      var input = window.prompt(
        'DEV MODE - enter the Discord user ID to log in as:\n'
        + '(numeric Discord snowflake; real guild roles will be fetched if available)',
        localStorage.getItem('esi_dev_last_id') || ''
      );
      if (!input) return;
      var userId = input.replace(/[^0-9]/g, '');
      if (!userId) {
        showToast('\u26a0 Dev-login requires a numeric Discord ID.', 'warn');
        return;
      }
      localStorage.setItem('esi_dev_last_id', userId);
      setLoginButtonLoadingState();
      sessionStorage.setItem('esi_auth_return', window.location.pathname || '/');
      window.location.href = '/auth/dev-login?user_id=' + encodeURIComponent(userId);
      return;
    }

    // show loading state and disable the button while redirecting
    setLoginButtonLoadingState();
    // save current page state so we can restore it after the OAuth redirect
    sessionStorage.setItem('esi_auth_return', window.location.pathname || '/');
    window.location.href = '/auth/login';
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
      setLoginButtonLoadingState();
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


// role config - loaded from /api/config (single source of truth on the server)
var ESI_STAFF_ROLES    = [];
var ESI_RANK_ROLES     = [];
var ESI_ECHELON_ROLES  = [];
var ESI_CITIZEN_ROLE   = { id: '', name: '', color: '' };
var ESI_MEDALS         = [];
var ESI_BADGES         = [];
var _PARLIAMENT_PLUS   = [];
var _JUROR_PLUS        = [];
var _EVENTS_ACCESS     = [];
var _EVENTS_MANAGE_ANY = [];
var _CHIEF_PLUS        = [];
var _GUILD_INFO_ACCESS = [];
var _configLoaded      = false;

var _configPromise = fetch('/api/config')
  .then(function (r) { return r.json(); })
  .then(function (cfg) {
    ESI_STAFF_ROLES   = cfg.staffRoles   || [];
    ESI_RANK_ROLES    = cfg.rankRoles    || [];
    ESI_ECHELON_ROLES = cfg.echelonRoles || [];
    ESI_CITIZEN_ROLE  = cfg.citizenRole  || ESI_CITIZEN_ROLE;
    ESI_MEDALS        = cfg.medals       || [];
    ESI_BADGES        = cfg.badges       || [];
    _ESI_APP_FORMS    = cfg.applicationForms || {};
    _PARLIAMENT_PLUS  = cfg.permissions  ? cfg.permissions.parliamentPlus  || [] : [];
    _JUROR_PLUS       = cfg.permissions  ? cfg.permissions.jurorPlus       || [] : [];
    _EVENTS_ACCESS    = cfg.permissions  ? cfg.permissions.eventsAccess    || [] : [];
    _EVENTS_MANAGE_ANY = cfg.permissions ? cfg.permissions.eventsManageAny || [] : [];
    _CHIEF_PLUS        = cfg.permissions ? cfg.permissions.chiefPlus       || [] : [];
    _GUILD_INFO_ACCESS = cfg.permissions ? cfg.permissions.guildInfoAccess || [] : [];
    window.ESI_DEV_MODE     = !!cfg.devMode;
    window.ESI_DISCORD_GUILD_ID = cfg.guildId || '';
    window.ESI_SERVER_TZ    = cfg.serverTimezone || 'UTC';
    _configLoaded     = true;
  })
  .catch(function () {});

/* Account modal tab switching */
document.getElementById('accountModalTabs').addEventListener('click', function (e) {
  var btn = e.target.closest('.account-tab');
  if (!btn) return;
  var tab = btn.getAttribute('data-acctab');
  if (!tab) return;
  document.querySelectorAll('.account-tab').forEach(function (t) { t.classList.remove('active'); });
  btn.classList.add('active');
  document.querySelectorAll('.account-tab-panel').forEach(function (p) { p.classList.remove('active'); });
  var panel = document.getElementById('accountTab' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (panel) panel.classList.add('active');
  // lazy-fetch badge progress on first open
  if (tab === 'badges' && !_badgeProgressFetched) _fetchBadgeProgress();
  // lazy-fetch shop stats on first open
  if (tab === 'shop' && !_shopStatsFetched) _fetchShopStats();
});

var _badgeProgressData = null;
var _badgeProgressFetched = false;
var _shopStatsData = null;
var _shopStatsFetched = false;
var _ESI_APP_FORMS = {};

function _renderAccountModal(userRoles) {
  _renderRankTree(userRoles);
  _renderEchelonGrid(userRoles);
  // reset badge fetch so it re-fetches on next tab open
  _badgeProgressFetched = false;
  _badgeProgressData = null;
  _renderBadges(userRoles, null);
  // reset shop stats so it re-fetches on next tab open
  _shopStatsFetched = false;
  _shopStatsData = null;
  // show/hide shop tab based on permissions
  _updateShopTabVisibility();
}

function _shouldShowShopTab() {
  if (!state.loggedIn || !state.user) return false;
  var roles = state.user.roles || [];
  var isCitizen = roles.includes(ESI_CITIZEN_ROLE.id);
  if (!isCitizen) return false;
  if (isShopBanned()) return false;
  return true;
}

function _updateShopTabVisibility() {
  var show = _shouldShowShopTab();
  var tabBtn = document.getElementById('accountShopTabBtn');
  var tabPanel = document.getElementById('accountTabShop');
  if (!tabBtn) {
    // inject tab button if not present
    var tabs = document.getElementById('accountModalTabs');
    if (tabs) {
      tabBtn = document.createElement('button');
      tabBtn.className = 'account-tab';
      tabBtn.setAttribute('data-acctab', 'shop');
      tabBtn.id = 'accountShopTabBtn';
      tabBtn.textContent = 'Shop';
      tabs.appendChild(tabBtn);
    }
  }
  if (tabBtn) tabBtn.style.display = show ? '' : 'none';
  if (tabPanel) tabPanel.style.display = show ? '' : 'none';
}

function _fetchShopStats() {
  _shopStatsFetched = true;
  var container = document.getElementById('accountShopContent');
  if (!container) return;
  container.innerHTML = '<div style="padding:24px 0;text-align:center;color:var(--text-faint)">Loading\u2026</div>';
  fetch('/api/me/shop-stats', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      _shopStatsData = data;
      _renderShopStats(data);
    })
    .catch(function () {
      if (container) container.innerHTML = '<div style="padding:24px 0;text-align:center;color:var(--text-faint)">Failed to load shop stats.</div>';
    });
}

function _renderShopStats(data) {
  var container = document.getElementById('accountShopContent');
  if (!container) return;
  if (!data || !data.linked) {
    container.innerHTML = '<div style="padding:24px 0;text-align:center;color:var(--text-faint)">No linked Minecraft account found.</div>';
    return;
  }
  var html = '';
  // EP summary card
  html += '<div class="acct-shop-ep-card">';
  html += '<div class="acct-shop-ep-title">EP Balance</div>';
  html += '<div class="acct-shop-ep-grid">';
  var epMetrics = [
    [data.total_ep || 0, 'Total EP'],
    [data.clean_ep || 0, 'Clean EP'],
    [data.dirty_ep || 0, 'Dirty EP'],
    [data.reserved_ep || 0, 'Reserved'],
  ];
  epMetrics.forEach(function (m) {
    html += '<div class="acct-shop-ep-item">';
    html += '<div class="acct-shop-ep-val">' + (m[0]).toLocaleString() + '</div>';
    html += '<div class="acct-shop-ep-lbl">' + m[1] + '</div>';
    html += '</div>';
  });
  html += '</div></div>';
  // Stats row
  html += '<div class="acct-shop-stats">';
  var stats = [
    [data.total_orders || 0, 'Orders placed'],
    [data.total_bids || 0, 'Bids placed'],
    [data.auctions_won || 0, 'Auctions won'],
  ];
  stats.forEach(function (s) {
    html += '<div class="acct-shop-stat">';
    html += '<div class="acct-shop-stat-val">' + s[0] + '</div>';
    html += '<div class="acct-shop-stat-lbl">' + s[1] + '</div>';
    html += '</div>';
  });
  html += '</div>';
  // Recent activity
  html += '<div class="acct-shop-activity">';
  html += '<div class="acct-shop-activity-title">Recent Activity</div>';
  var recent = data.recent || [];
  if (recent.length === 0) {
    html += '<div class="acct-shop-empty">No activity yet.</div>';
  } else {
    recent.forEach(function (entry) {
      var typeLabel = entry.type === 'purchase' ? 'Purchase' : 'Bid';
      var typeCls = entry.type === 'purchase' ? 'acct-shop-type--purchase' : 'acct-shop-type--bid';
      var date = entry.ts ? new Date(entry.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      var ep = entry.ep_spent != null ? (entry.ep_spent).toLocaleString() + ' EP' : '';
      html += '<div class="acct-shop-activity-row">';
      html += '<span class="acct-shop-type ' + typeCls + '">' + typeLabel + '</span>';
      html += '<span class="acct-shop-item-name">' + (entry.item_name || '').replace(/</g, '&lt;') + '</span>';
      html += '<span class="acct-shop-activity-meta">' + ep + (ep && date ? ' · ' : '') + date + '</span>';
      html += '</div>';
    });
  }
  html += '</div>';
  // Creator placeholder
  html += '<div id="accountShopCreatorSection"></div>';
  container.innerHTML = html;
  // kick off creator status fetch
  _fetchCreatorStatus();
}

/* Creator Section inside Shop tab */
var _creatorStatusData = null;

function _fetchCreatorStatus() {
  var section = document.getElementById('accountShopCreatorSection');
  if (!section) return;
  section.innerHTML = '<div class="creator-loading">Loading\u2026</div>';
  fetch('/api/shop/creator-apply/status', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      _creatorStatusData = data;
      _renderCreatorSection(data);
    })
    .catch(function () {
      if (section) section.innerHTML = '';
    });
}

function _renderCreatorSection(data) {
  var section = document.getElementById('accountShopCreatorSection');
  if (!section) return;
  if (!data) { section.innerHTML = ''; return; }

  // Already a Creator (approved)
  if (data.is_creator) {
    // Parliament+ have the full Manage Shop panel instead of Creator Studio
    var _showStudioBtn = !hasParliamentPlus();
    section.innerHTML =
      '<div class="creator-card creator-card--approved">' +
        '<div class="creator-card-icon">\u2713</div>' +
        '<div class="creator-card-body">' +
          '<div class="creator-card-title">You are a Creator</div>' +
          '<div class="creator-card-desc">You can submit and manage your own shop listings.</div>' +
        '</div>' +
        (_showStudioBtn ? '<button class="creator-studio-btn" id="creatorStudioBtn">Go to My Creator Studio</button>' : '') +
      '</div>';
    if (_showStudioBtn) {
      var studioBtn = document.getElementById('creatorStudioBtn');
      if (studioBtn) {
        studioBtn.addEventListener('click', function () {
          var backdrop = document.getElementById('accountModalBackdrop');
          if (backdrop && window.Popup) window.Popup.close(backdrop);
          if (window.switchToPanel) window.switchToPanel('creator-studio');
        });
      }
    }
    return;
  }

  var app = data.application;

  // Pending application
  if (app && app.status === 'pending') {
    var subDate = app.submitted_at
      ? new Date(app.submitted_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
      : '';
    section.innerHTML =
      '<div class="creator-card creator-card--pending">' +
        '<div class="creator-card-body">' +
          '<div class="creator-card-title">Your application is under review</div>' +
          '<div class="creator-card-desc">Submitted ' + subDate + '. Parliament will review it soon.</div>' +
        '</div>' +
      '</div>';
    return;
  }

  // Rejected (with cooldown)
  if (app && app.status === 'rejected' && data.cooldown_ends_at) {
    var reason = app.rejection_reason ? app.rejection_reason.replace(/</g, '&lt;') : '';
    var cooldownEnd = new Date(data.cooldown_ends_at);
    var _renderCooldown = function () {
      var now = new Date();
      var diff = cooldownEnd - now;
      if (diff <= 0) {
        // cooldown expired: show the eligible state
        _renderCreatorEligible(section);
        return;
      }
      var days = Math.floor(diff / 86400000);
      var hours = Math.floor((diff % 86400000) / 3600000);
      var cdText = days > 0 ? (days + 'd ' + hours + 'h') : (hours + 'h');
      var cdEl = document.getElementById('creatorCooldownTimer');
      if (cdEl) cdEl.textContent = cdText;
    };
    section.innerHTML =
      '<div class="creator-card creator-card--rejected">' +
        '<div class="creator-card-icon">\u2717</div>' +
        '<div class="creator-card-body">' +
          '<div class="creator-card-title">Application rejected</div>' +
          (reason ? '<div class="creator-card-reason">' + reason + '</div>' : '') +
          '<div class="creator-card-desc">You can reapply in <strong id="creatorCooldownTimer"></strong></div>' +
        '</div>' +
      '</div>';
    _renderCooldown();
    var _cdInterval = setInterval(function () {
      if (!document.getElementById('creatorCooldownTimer')) {
        clearInterval(_cdInterval);
        return;
      }
      _renderCooldown();
    }, 60000);
    return;
  }

  // Not applied / eligible (also covers rejected-with-expired-cooldown via can_reapply)
  _renderCreatorEligible(section);
}

function _renderCreatorEligible(section) {
  section.innerHTML =
    '<div class="creator-card creator-card--eligible">' +
      '<div class="creator-card-body">' +
        '<div class="creator-card-title">Become a Creator</div>' +
        '<div class="creator-card-desc">' +
          'Creators can submit items for the shop and manage their own listings. ' +
          'Your items will be reviewed by Parliament before going live. ' +
          'When one of your items is sold and fulfilled, you earn 35% of the sale price as Dirty EP.' +
        '</div>' +
        '<button class="creator-apply-btn" id="creatorApplyBtn">Apply to become a Creator</button>' +
      '</div>' +
    '</div>';
  var applyBtn = document.getElementById('creatorApplyBtn');
  if (applyBtn) {
    applyBtn.addEventListener('click', function () {
      _showCreatorApplyForm(section);
    });
  }
}

function _showCreatorApplyForm(section) {
  section.innerHTML =
    '<div class="creator-card creator-card--form">' +
      '<div class="creator-card-title">Creator Application</div>' +
      '<div class="creator-form-field">' +
        '<label class="creator-form-label" for="creatorQ1">Why do you want to be a Creator?</label>' +
        '<textarea class="creator-form-input" id="creatorQ1" rows="3" maxlength="500" placeholder="Your answer\u2026"></textarea>' +
        '<div class="creator-form-counter"><span id="creatorQ1Count">0</span>/500</div>' +
      '</div>' +
      '<div class="creator-form-field">' +
        '<label class="creator-form-label" for="creatorQ2">What kind of items do you plan to list?</label>' +
        '<textarea class="creator-form-input" id="creatorQ2" rows="2" maxlength="300" placeholder="Your answer\u2026"></textarea>' +
        '<div class="creator-form-counter"><span id="creatorQ2Count">0</span>/300</div>' +
      '</div>' +
      '<div class="creator-form-actions">' +
        '<button class="creator-form-cancel" id="creatorFormCancel">Cancel</button>' +
        '<button class="creator-form-submit" id="creatorFormSubmit">Submit Application</button>' +
      '</div>' +
      '<div class="creator-form-msg" id="creatorFormMsg" style="display:none"></div>' +
    '</div>';

  // char counters
  var q1 = document.getElementById('creatorQ1');
  var q2 = document.getElementById('creatorQ2');
  var q1c = document.getElementById('creatorQ1Count');
  var q2c = document.getElementById('creatorQ2Count');
  if (q1 && q1c) q1.addEventListener('input', function () { q1c.textContent = q1.value.length; });
  if (q2 && q2c) q2.addEventListener('input', function () { q2c.textContent = q2.value.length; });

  // cancel
  document.getElementById('creatorFormCancel').addEventListener('click', function () {
    _renderCreatorSection(_creatorStatusData);
  });

  // submit
  document.getElementById('creatorFormSubmit').addEventListener('click', function () {
    var a1 = (q1 ? q1.value.trim() : '');
    var a2 = (q2 ? q2.value.trim() : '');
    if (!a1) { _creatorFormMsg('Please answer the first question.', 'warn'); return; }
    if (!a2) { _creatorFormMsg('Please answer the second question.', 'warn'); return; }
    var submitBtn = document.getElementById('creatorFormSubmit');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting\u2026';
    _creatorFormMsg('', '');

    fetch('/api/shop/creator-apply', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: [a1, a2] }),
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (result) {
      if (result.ok && result.data.ok) {
        // re-render as pending without full reload
        _creatorStatusData = {
          is_creator: false,
          has_application: true,
          application: {
            status: 'pending',
            submitted_at: result.data.submitted_at || new Date().toISOString(),
          },
        };
        _renderCreatorSection(_creatorStatusData);
        if (window.showToast) showToast('\u2713 Application submitted!', 'success');
      } else {
        _creatorFormMsg(result.data.error || 'Failed to submit.', 'warn');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Application';
      }
    })
    .catch(function () {
      _creatorFormMsg('Network error. Please try again.', 'warn');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Application';
    });
  });
}

function _creatorFormMsg(text, type) {
  var el = document.getElementById('creatorFormMsg');
  if (!el) return;
  if (!text) { el.style.display = 'none'; return; }
  el.textContent = text;
  el.className = 'creator-form-msg' + (type === 'warn' ? ' creator-form-msg--warn' : '');
  el.style.display = '';
}

function _fetchBadgeProgress() {
  _badgeProgressFetched = true;
  fetch('/api/me/badge-progress', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.linked) return;
      _badgeProgressData = data.counts || {};
      if (state.user) _renderBadges(state.user.roles || [], _badgeProgressData);
    })
    .catch(function () {});
}

/* Info tooltip (shared by rank tree + echelon) */
var _infoTooltipEl = (function () {
  var el = document.createElement('div');
  el.className = 'account-info-tooltip';
  el.style.display = 'none';
  document.body.appendChild(el);
  return el;
})();
var _infoTooltipHideTimer = null;
var _infoTooltipVisible = false;

function _showInfoTooltip(anchor, data) {
  clearTimeout(_infoTooltipHideTimer);
  _infoTooltipEl.innerHTML = '';

  var title = document.createElement('div');
  title.className = 'account-info-tooltip-title';
  title.textContent = data.title || '';
  _infoTooltipEl.appendChild(title);

  var body = document.createElement('div');
  body.className = 'account-info-tooltip-body';
  body.textContent = data.body || '';
  _infoTooltipEl.appendChild(body);

  if (data.extra) {
    var extra = document.createElement('div');
    extra.className = 'account-info-tooltip-extra';
    extra.textContent = data.extra;
    _infoTooltipEl.appendChild(extra);
  }

  _infoTooltipEl.style.display = 'block';
  _infoTooltipVisible = true;

  // position to the right of the modal only
  var modal = anchor.closest('.account-modal');
  var modalRect = modal ? modal.getBoundingClientRect() : null;
  var anchorRect = anchor.getBoundingClientRect();
  var margin = 10;
  var tw = _infoTooltipEl.offsetWidth;
  var th = _infoTooltipEl.offsetHeight;
  // if right-side space does not exist, do not show the tooltip
  if (!modalRect || modalRect.right + margin + tw > window.innerWidth - margin) {
    _infoTooltipEl.style.display = 'none';
    _infoTooltipVisible = false;
    return;
  }
  var top = anchorRect.top;
  var left = modalRect.right + margin;

  // keep within viewport vertically
  if (top + th > window.innerHeight - margin) top = window.innerHeight - th - margin;
  if (top < margin) top = margin;

  _infoTooltipEl.style.top = top + 'px';
  _infoTooltipEl.style.left = left + 'px';
}

function _hideInfoTooltip() {
  clearTimeout(_infoTooltipHideTimer);
  _infoTooltipHideTimer = setTimeout(function () {
    _infoTooltipEl.style.display = 'none';
    _infoTooltipVisible = false;
  }, 120);
}

_infoTooltipEl.addEventListener('mouseenter', function () { clearTimeout(_infoTooltipHideTimer); });
_infoTooltipEl.addEventListener('mouseleave', _hideInfoTooltip);

function _attachInfoTooltip(element, data) {
  element.addEventListener('mouseenter', function () { _showInfoTooltip(element, data); });
  element.addEventListener('mouseleave', _hideInfoTooltip);
}

/* Rank Progression Tree */
function _renderRankTree(userRoles) {
  var container = document.getElementById('accountRankTree');
  if (!container) return;
  container.innerHTML = '';

  var ranks = (ESI_RANK_ROLES || []).slice().reverse();
  var userRankIdx = -1;
  for (var i = ranks.length - 1; i >= 0; i--) {
    if (userRoles.includes(ranks[i].id)) { userRankIdx = i; break; }
  }

  // the rank one step above the user's current rank
  var nextRankIdx = userRankIdx + 1;

  ranks.forEach(function(r, idx) {
    var node = document.createElement('div');
    node.className = 'rank-tree-node';
    if (idx === userRankIdx)    node.classList.add('rank-tree-node--current');
    else if (idx < userRankIdx) node.classList.add('rank-tree-node--completed');
    else                        node.classList.add('rank-tree-node--locked');

    if (idx > 0) {
      var line = document.createElement('div');
      line.className = 'rank-tree-line';
      if (idx <= userRankIdx) line.classList.add('rank-tree-line--filled');
      container.appendChild(line);
    }

    var rankKey = (r.name || '').toLowerCase().replace(/\s+/g, '-');
    var rankColor = _cssVar('--rank-' + rankKey, r.color);

    var dot = document.createElement('div');
    dot.className = 'rank-tree-dot';
    dot.style.borderColor = rankColor;
    if (idx <= userRankIdx) dot.style.background = rankColor;

    var info = document.createElement('div');
    info.className = 'rank-tree-info';
    var nameRow = document.createElement('div');
    nameRow.className = 'rank-tree-name';
    nameRow.style.color = rankColor;
    nameRow.textContent = (r.icon || '') + ' ' + r.name;
    var sub = document.createElement('div');
    sub.className = 'rank-tree-ingame';
    sub.textContent = r.ingame || '';
    info.appendChild(nameRow);
    info.appendChild(sub);

    // description
    if (r.desc) {
      var descEl = document.createElement('div');
      descEl.className = 'rank-tree-desc';
      descEl.textContent = r.desc;
      info.appendChild(descEl);
    }

    // hover tooltip for full description
    if (r.fullDesc) {
      var tooltipData = { title: r.icon + ' ' + r.name, body: r.fullDesc };
      if (r.promotion && r.promotion.hint) {
        tooltipData.extra = r.promotion.hint;
      }
      _attachInfoTooltip(node, tooltipData);
    }

    // promotion info - show on the rank directly above the user's current rank
    if (idx === nextRankIdx && nextRankIdx < ranks.length && r.promotion) {
      var promo = r.promotion;
      var promoWrap = document.createElement('div');
      promoWrap.className = 'rank-tree-promo';

      var hintEl = document.createElement('span');
      hintEl.className = 'rank-tree-promo-hint';
      hintEl.textContent = promo.hint || '';
      promoWrap.appendChild(hintEl);

      if (promo.method === 'apply' && promo.formType && _ESI_APP_FORMS[promo.formType]) {
        var promoForm = _ESI_APP_FORMS[promo.formType];
        if (_userCanApplyForForm(userRoles, promoForm)) {
          var applyBtn = document.createElement('button');
          applyBtn.className = 'rank-tree-apply-btn';
          applyBtn.textContent = 'Apply';
          applyBtn.setAttribute('data-form-type', promo.formType);
          applyBtn.addEventListener('click', function () { _openApplyForm(promo.formType); });
          promoWrap.appendChild(applyBtn);
        }
      }
      info.appendChild(promoWrap);
    }

    node.appendChild(dot);
    node.appendChild(info);
    container.appendChild(node);
  });
}

/* Upper Echelon Grid */
function _renderEchelonGrid(userRoles) {
  var container = document.getElementById('accountEchelonGrid');
  if (!container) return;
  container.innerHTML = '';

  (ESI_ECHELON_ROLES || []).forEach(function(role) {
    var has = userRoles.includes(role.id);
    var ecKey = (role.name || '').toLowerCase().replace(/\s+/g, '-');
    var ecColor = _cssVar('--echelon-' + ecKey, role.color);
    var card = document.createElement('div');
    card.className = 'echelon-card' + (has ? ' echelon-card--active' : '');
    card.style.setProperty('--ec-color', ecColor);

    var icon = document.createElement('div');
    icon.className = 'echelon-card-icon';
    icon.textContent = role.icon || '';
    var name = document.createElement('div');
    name.className = 'echelon-card-name';
    name.textContent = role.name;
    var desc = document.createElement('div');
    desc.className = 'echelon-card-desc';
    desc.textContent = role.desc || '';

    // hover tooltip for full description
    if (role.fullDesc) {
      _attachInfoTooltip(card, { title: role.icon + ' ' + role.name, body: role.fullDesc });
    }

    card.appendChild(icon);
    card.appendChild(name);
    card.appendChild(desc);

    // Apply button for echelon roles that support it
    if (role.applyForm && !has && _ESI_APP_FORMS[role.applyForm]) {
      var form = _ESI_APP_FORMS[role.applyForm];
      if (_userCanApplyForForm(userRoles, form)) {
        var ecApply = document.createElement('button');
        ecApply.className = 'echelon-apply-btn';
        ecApply.textContent = 'Apply';
        ecApply.style.setProperty('--ec-color', ecColor);
        ecApply.addEventListener('click', function () { _openApplyForm(role.applyForm); });
        card.appendChild(ecApply);
      }
    }

    container.appendChild(card);
  });
}

/* rank requirement check */
function _userHasMinRank(userRoles, minRankName) {
  if (!minRankName) return true;
  var target = minRankName.toLowerCase();
  var ranks = ESI_RANK_ROLES || [];
  var targetIdx = -1;
  for (var i = 0; i < ranks.length; i++) {
    if (ranks[i].name.toLowerCase() === target) { targetIdx = i; break; }
  }
  if (targetIdx < 0) return false;
  // ranks are highest-first; user needs any role at targetIdx or lower index
  for (var j = 0; j <= targetIdx; j++) {
    if (userRoles.includes(ranks[j].id)) return true;
  }
  return false;
}

function _userCanApplyForForm(userRoles, form) {
  if (!form) return false;
  if (form.requireRank && !_userHasMinRank(userRoles || [], form.requireRank)) {
    return false;
  }
  if (form.requireCitizen) {
    var citizenRoleId = ESI_CITIZEN_ROLE && ESI_CITIZEN_ROLE.id;
    if (!citizenRoleId || !(userRoles || []).includes(citizenRoleId)) {
      return false;
    }
  }
  return true;
}

/* Application form */
var _applyFormType = null;

function _openApplyForm(formType) {
  var form = _ESI_APP_FORMS[formType];
  if (!form) return;
  var userRoles = (state.user && state.user.roles) || [];
  if (!_userCanApplyForForm(userRoles, form)) {
    showToast('\u26A0 You do not meet the requirements for this application.', 'warn');
    return;
  }
  _applyFormType = formType;

  // hide tabs + tab panels, show the form
  document.getElementById('accountModalTabs').style.display = 'none';
  document.querySelectorAll('.account-tab-panel').forEach(function (p) { p.style.display = 'none'; });
  var formEl = document.getElementById('accountApplyForm');
  formEl.style.display = '';

  document.getElementById('accountApplyTitle').textContent = form.title;
  var qContainer = document.getElementById('accountApplyQuestions');
  qContainer.innerHTML = '';

  // requirements box
  var reqs = form.requirements || [];
  if (reqs.length) {
    var reqBox = document.createElement('div');
    reqBox.className = 'apply-requirements';
    var reqTitle = document.createElement('div');
    reqTitle.className = 'apply-requirements-title';
    reqTitle.textContent = 'Requirements';
    reqBox.appendChild(reqTitle);
    reqs.forEach(function (r) {
      var li = document.createElement('div');
      li.className = 'apply-requirements-item';
      li.textContent = r;
      reqBox.appendChild(li);
    });
    qContainer.appendChild(reqBox);
  }

  (form.questions || []).forEach(function (q, idx) {
    var wrap = document.createElement('div');
    wrap.className = 'apply-question';
    var label = document.createElement('label');
    label.className = 'apply-question-label';
    label.textContent = (idx + 1) + '. ' + q;
    label.setAttribute('for', 'applyQ' + idx);
    var textarea = document.createElement('textarea');
    textarea.className = 'apply-question-input';
    textarea.id = 'applyQ' + idx;
    textarea.rows = 3;
    textarea.maxLength = 2000;
    textarea.placeholder = 'Your answer\u2026';
    wrap.appendChild(label);
    wrap.appendChild(textarea);
    qContainer.appendChild(wrap);
  });
  var submitBtn = document.getElementById('accountApplySubmit');
  submitBtn.disabled = false;
  submitBtn.textContent = 'Submit Application';

  // scroll to top
  document.getElementById('accountModalBody').scrollTop = 0;
}

function _closeApplyForm() {
  _applyFormType = null;
  document.getElementById('accountApplyForm').style.display = 'none';
  document.getElementById('accountModalTabs').style.display = '';
  document.querySelectorAll('.account-tab-panel').forEach(function (p) { p.style.display = ''; });
}

document.getElementById('accountApplyBack').addEventListener('click', _closeApplyForm);

var _applyConfirmPending = false;

document.getElementById('accountApplySubmit').addEventListener('click', function () {
  if (!_applyFormType) return;
  var form = _ESI_APP_FORMS[_applyFormType];
  if (!form) return;
  var userRoles = (state.user && state.user.roles) || [];
  if (!_userCanApplyForForm(userRoles, form)) {
    showToast('\u26A0 You do not meet the requirements for this application.', 'warn');
    return;
  }
  var answers = [];
  var allFilled = true;
  (form.questions || []).forEach(function (_, idx) {
    var el = document.getElementById('applyQ' + idx);
    var val = el ? el.value.trim() : '';
    if (!val) allFilled = false;
    answers.push(val);
  });
  if (!allFilled) {
    showToast('\u26a0 Please answer all questions.', 'warn');
    return;
  }

  var submitBtn = document.getElementById('accountApplySubmit');

  // first click: ask to confirm
  if (!_applyConfirmPending) {
    _applyConfirmPending = true;
    submitBtn.textContent = 'Are you sure? Click again to confirm';
    submitBtn.classList.add('account-apply-submit--confirm');
    // reset after 5s if they don't click again
    setTimeout(function () {
      if (_applyConfirmPending) {
        _applyConfirmPending = false;
        submitBtn.textContent = 'Submit Application';
        submitBtn.classList.remove('account-apply-submit--confirm');
      }
    }, 5000);
    return;
  }

  // second click: actually submit
  _applyConfirmPending = false;
  submitBtn.classList.remove('account-apply-submit--confirm');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Submitting\u2026';

  fetch('/api/applications', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: _applyFormType, answers: answers }),
  })
  .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
  .then(function (result) {
    if (result.ok) {
      showToast('\u2713 Application submitted!', 'success');
      _closeApplyForm();
    } else {
      showToast('\u26a0 ' + (result.data.error || 'Failed to submit.'), 'warn');
    }
  })
  .catch(function () {
    showToast('\u26a0 Network error. Please try again.', 'warn');
  })
  .finally(function () {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Submit Application';
  });
});

/* Badges (progress bar) */
function _renderBadges(userRoles, counts) {
  var container = document.getElementById('accountBadges');
  if (!container) return;
  container.innerHTML = '';

  (ESI_BADGES || []).forEach(function(cat) {
    var tiers = (cat.tiers || []).slice().reverse(); // low-to-high
    var countKey = cat.countKey || '';
    var currentCount = counts ? (counts[countKey] || 0) : null;

    // find highest owned tier
    var ownedIdx = -1;
    for (var i = tiers.length - 1; i >= 0; i--) {
      if (userRoles.includes(tiers[i].role_id)) { ownedIdx = i; break; }
    }

    var row = document.createElement('div');
    row.className = 'badge-row';

    // header: label + current tier
    var header = document.createElement('div');
    header.className = 'badge-row-header';
    var label = document.createElement('span');
    label.className = 'badge-row-label';
    label.textContent = cat.singular || cat.label;
    header.appendChild(label);
    var tierText = document.createElement('span');
    tierText.className = 'badge-row-tier';
    if (ownedIdx >= 0) {
      tierText.textContent = tiers[ownedIdx].tier_name;
      tierText.style.color = _cssVar('--badge-tier-text', tiers[ownedIdx].colour || '#b68344');
    } else {
      tierText.textContent = 'No badge';
      tierText.style.color = 'var(--text-faint)';
    }
    header.appendChild(tierText);
    row.appendChild(header);

    // progress bar
    var nextTier = ownedIdx < tiers.length - 1 ? tiers[ownedIdx + 1] : null;
    var prevThreshold = ownedIdx >= 0 ? tiers[ownedIdx].threshold : 0;
    var nextThreshold = nextTier ? nextTier.threshold : prevThreshold;
    var barColor = nextTier ? (nextTier.colour || '#b68344') : (ownedIdx >= 0 ? tiers[ownedIdx].colour : 'var(--gold-dim)');

    var barWrap = document.createElement('div');
    barWrap.className = 'badge-bar-wrap';
    var barFill = document.createElement('div');
    barFill.className = 'badge-bar-fill';
    barFill.style.background = _cssVar('--badge-bar', barColor);

    if (currentCount !== null && nextTier) {
      var range = nextThreshold - prevThreshold;
      var progress = range > 0 ? Math.min(1, Math.max(0, (currentCount - prevThreshold) / range)) : 0;
      barFill.style.width = (progress * 100).toFixed(1) + '%';
    } else if (ownedIdx === tiers.length - 1) {
      barFill.style.width = '100%';
    } else {
      barFill.style.width = '0%';
    }
    barWrap.appendChild(barFill);
    row.appendChild(barWrap);

    // count / next info
    var info = document.createElement('div');
    info.className = 'badge-row-info';
    if (currentCount !== null && nextTier) {
      info.textContent = currentCount.toLocaleString() + ' / ' + nextThreshold.toLocaleString() + ' \u2192 ' + nextTier.tier_name;
      info.style.color = _cssVar('--badge-info', nextTier.colour || 'var(--text-faint)');
    } else if (currentCount !== null && !nextTier && ownedIdx >= 0) {
      info.textContent = currentCount.toLocaleString() + ' - Max tier!';
      info.style.color = 'var(--gold-light)';
    } else if (currentCount === null) {
      info.textContent = 'Loading\u2026';
      info.style.color = 'var(--text-faint)';
    }
    row.appendChild(info);

    container.appendChild(row);
  });
}

// strip sensitive data before caching to localStorage
function _userForCache(user) {
  return {
    id:         user.id,
    username:   user.username,
    nick:       user.nick,
    avatar:     user.avatar,
    roles:      user.roles || [],
    is_creator: !!user.is_creator,
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
      // eagerly preload queue badges on sidebar nav items
      if (hasShopAdmin() && window.preloadShopAdminBadge) window.preloadShopAdminBadge();
      if (hasCreatorAccess() && window.preloadCreatorStudioBadge) window.preloadCreatorStudioBadge();
      // guild-info access can come from a Discord permission, so always probe the server
      if (window.preloadGuildInfoBadge) window.preloadGuildInfoBadge();
      renderProfile(user);
      _renderAccountModal(user.roles || []);
      // re-route to the correct panel based on URL (handles multi-segment paths like /shop/admin)
      var _parts = window.location.pathname.replace(/^\//, '').split('/');
      var _first = _parts[0] || '';
      var wantedPanel = _first;
      if (_first === 'events' && _parts[1] === 'manage') wantedPanel = 'events-manage';
      if (_first === 'shop'   && _parts[1] === 'admin')  wantedPanel = 'shop-admin';
      if (_first === 'shop'   && _parts[1] === 'studio') wantedPanel = 'creator-studio';
      if (_first === 'guild'  && _parts[1] === 'info')   wantedPanel = 'guild-info';
      var activePanel = document.querySelector('.panel.active');
      if (wantedPanel && activePanel && activePanel.id !== 'panel-' + wantedPanel) {
        switchToPanel(wantedPanel);
      }
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

// restore cached user instantly so the UI doesn't flash between
// logged-out and logged-in states on refresh
var _cachedLoginApplied = false;
var savedUser = localStorage.getItem('esi_user');
if (savedUser) {
    try {
        var _cachedUser = JSON.parse(savedUser);
        state.loggedIn = true;
        state.user = _cachedUser;
        updateLoginButton();
        _cachedLoginApplied = true;

        // immediately restore nav visibility from the last known state
        var _cachedNav = localStorage.getItem('esi_nav_cache');
        if (_cachedNav) {
            try {
                var _nav = JSON.parse(_cachedNav);
                if (_nav.shop)           { var _e = document.getElementById('shopNavItem');           if (_e) _e.style.display = ''; }
                if (_nav.creatorStudio)   { var _e = document.getElementById('creatorStudioNavItem');  if (_e) _e.style.display = ''; }
                if (_nav.shopAdmin)       { var _e = document.getElementById('shopAdminNavItem');      if (_e) _e.style.display = ''; }
                if (_nav.manage)          { var _e = document.getElementById('manageSection');         if (_e) _e.style.display = 'block'; }
                if (_nav.inactivity)      { var _e = document.querySelector('[data-panel="inactivity"]');    if (_e) _e.parentElement.style.display = ''; }
                if (_nav.promotions)      { var _e = document.querySelector('[data-panel="promotions"]');    if (_e) _e.parentElement.style.display = ''; }
                if (_nav.eventsManage)    { var _e = document.querySelector('[data-panel="events-manage"]'); if (_e) _e.parentElement.style.display = ''; }
                if (_nav.guildInfo)       { var _e = document.getElementById('guildInfoNavItem');       if (_e) _e.style.display = ''; }
            } catch (e) { /*nav cache parse error*/ }
        }

        // immediately activate the correct panel based on URL
        var _urlParts = window.location.pathname.replace(/^\//, '').split('/');
        var _urlFirst = _urlParts[0] || 'player';
        var _wantPanel = _urlFirst;
        if (_urlFirst === 'events' && _urlParts[1] === 'manage') _wantPanel = 'events-manage';
        if (_urlFirst === 'shop'   && _urlParts[1] === 'admin')  _wantPanel = 'shop-admin';
        if (_urlFirst === 'shop'   && _urlParts[1] === 'studio') _wantPanel = 'creator-studio';
        if (_urlFirst === 'guild'  && _urlParts[1] === 'info')   _wantPanel = 'guild-info';
        var _wantPanelEl = document.getElementById('panel-' + _wantPanel);
        if (_wantPanelEl && _wantPanel !== 'player') {
            document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
            _wantPanelEl.classList.add('active');
            document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
            var _wantNav = document.querySelector('[data-panel="' + _wantPanel + '"]');
            if (_wantNav) _wantNav.classList.add('active');
        }

        // pre-paint CSS overrides are no longer needed; JS has set inline styles
        var _preloadCSS = document.getElementById('esi-preload-css');
        if (_preloadCSS) { _preloadCSS.remove(); }

        // apply cached permissions once config loads (confirms/adjusts nav state)
        _configPromise.then(function () {
            if (state.user === _cachedUser) applyPermissions();
        });
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
            // not logged in (or session expired) - clear any stale local state
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
    loginBtn.removeAttribute('aria-busy');
    if (state.loggedIn && state.user) {
      const u = state.user;
      const avatarSrc = u.avatar
        ? 'https://cdn.discordapp.com/avatars/' + u.id + '/' + u.avatar + '.png?size=64'
        : 'https://cdn.discordapp.com/embed/avatars/0.png';
      loginBtn.classList.add('btn-discord--account');
      loginBtn.innerHTML = `
        <img src="${avatarSrc}" alt="" style="width:20px;height:20px;border-radius:50%;object-fit:cover;flex-shrink:0;" />
        <span class="btn-label">${u.nick || u.username}</span>`;
      loginBtn.style.opacity = '1';
      var _onC = _cssVar('--online', '#3BA55C');
      var _onRgb = _cssVar('--online-rgb', '59, 165, 92');
      loginBtn.style.background = _onC;
      loginBtn.style.boxShadow = '0 2px 12px rgba(' + _onRgb + ', 0.35)';
      // Populate account modal
      document.getElementById('accountModalAvatar').src = avatarSrc;
      var displayName = u.nick || u.username;
      var isCitizen = (u.roles || []).includes(ESI_CITIZEN_ROLE.id);
      var _citizenC = _cssVar('--citizen-pill', ESI_CITIZEN_ROLE.color);
      var citizenStyle = 'color:' + _citizenC + ';background:' + _citizenC + '22;border:1px solid ' + _citizenC + '66;border-radius:20px;font-family:var(--font-heading);font-size:0.6rem;letter-spacing:0.08em;padding:1px 8px;vertical-align:middle;margin-left:6px;white-space:nowrap;';
      document.getElementById('accountModalName').innerHTML =
        displayName + (isCitizen ? ' <span style="' + citizenStyle + '">Citizen</span>' : '');
      document.getElementById('accountModalSub').textContent = '@' + u.username + '  ·  ' + u.id;
      _renderAccountModal(u.roles || []);
    } else {
      closeAccountModal();
      loginBtn.classList.remove('btn-discord--account');
      loginBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 127.14 96.36" fill="currentColor"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/></svg>
        <span class="btn-label">Login with Discord</span>`;
      loginBtn.style.opacity = '1';
      var _dcC = _cssVar('--discord', '#5865F2');
      var _dcRgb = _cssVar('--discord-rgb', '88, 101, 242');
      loginBtn.style.background = _dcC;
      loginBtn.style.boxShadow = '0 2px 12px rgba(' + _dcRgb + ', 0.35)';
    }
    syncNavbarCenterVisibility();
  }

  /* role checks - uses permission groups from /api/config */
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

  // true if the user has any role that lets them access the Manage Events page
  function hasEventsAccess() {
    if (!state.loggedIn || !state.user) return false;
    var roles = state.user.roles || [];
    return _EVENTS_ACCESS.some(function (id) { return roles.includes(id); });
  }

  // true if the user can manage any event
  function hasEventsManageAny() {
    if (!state.loggedIn || !state.user) return false;
    var roles = state.user.roles || [];
    return _EVENTS_MANAGE_ANY.some(function (id) { return roles.includes(id); });
  }

  // true if the user is a Chief
  function isChiefPlus() {
    if (!state.loggedIn || !state.user) return false;
    var roles = state.user.roles || [];
    return _CHIEF_PLUS.some(function (id) { return roles.includes(id); });
  }

  // true if the user can access the shop admin panel (Chief or Parliament, not admin-banned)
  function hasShopAdmin() {
    return (isChiefPlus() || hasParliamentPlus()) && !isAdminBanned();
  }

  // true if the user can access the Guild Info page
  function hasGuildInfoAccess() {
    if (window._guildInfoServerAccess) return true;
    if (!state.loggedIn || !state.user) return false;
    var roles = state.user.roles || [];
    return _GUILD_INFO_ACCESS.some(function (id) { return roles.includes(id); });
  }

  // true if the user is an approved Creator (flag set by server in session)
  // Parliament+ users are excluded: they already have the full Manage Shop panel
  function hasCreatorAccess() {
    if (!state.loggedIn || !state.user) return false;
    return !!state.user.is_creator && !hasParliamentPlus();
  }

  // true if the user holds any guild rank
  function isGuildMember() {
    if (!state.loggedIn || !state.user) return false;
    var roles = state.user.roles || [];
    return ESI_RANK_ROLES.some(function (r) { return roles.includes(r.id); });
  }

  // shop ban flag
  window._shopBanned = false;
  function isShopBanned() { return !!window._shopBanned; }
  window.isShopBanned = isShopBanned;

  // admin (manage shop) ban flag
  window._adminBanned = false;
  function isAdminBanned() { return !!window._adminBanned; }
  window.isAdminBanned = isAdminBanned;

  // guild-info access confirmed by the server /state endpoint
  window._guildInfoServerAccess = false;

  /* permissions */
  function applyPermissions() {
    const activePanel = document.querySelector('.panel.active');
    // server-confirmed guild-info access only applies while logged in
    if (!state.loggedIn) window._guildInfoServerAccess = false;
    const canInactivity = hasParliamentPlus();
    const canPromotions = hasJurorPlus();
    const canEvents     = hasEventsAccess();

    const canShop = isGuildMember() && !isShopBanned();
    const shopNavItem = document.getElementById('shopNavItem');
    if (shopNavItem) shopNavItem.style.display = canShop ? '' : 'none';

    const canCreatorStudio = hasCreatorAccess();
    const creatorStudioNav = document.getElementById('creatorStudioNavItem');
    if (creatorStudioNav) creatorStudioNav.style.display = canCreatorStudio ? '' : 'none';

    const canShopAdmin = hasShopAdmin();
    const shopAdminNav = document.getElementById('shopAdminNavItem');
    if (shopAdminNav) shopAdminNav.style.display = canShopAdmin ? '' : 'none';

    const canGuildInfo = hasGuildInfoAccess();
    const guildInfoNav = document.getElementById('guildInfoNavItem');
    if (guildInfoNav) guildInfoNav.style.display = canGuildInfo ? '' : 'none';
    // show management section if any sub-item is visible
    if (manageSection) {
      manageSection.style.display = (canInactivity || canPromotions || canEvents || canShopAdmin || canGuildInfo) ? 'block' : 'none';
    }

    const inactivityNav   = document.querySelector('[data-panel="inactivity"]');
    const promotionsNav   = document.querySelector('[data-panel="promotions"]');
    const eventsManageNav = document.querySelector('[data-panel="events-manage"]');
    if (inactivityNav)   inactivityNav.parentElement.style.display   = canInactivity ? '' : 'none';
    if (promotionsNav)   promotionsNav.parentElement.style.display   = canPromotions ? '' : 'none';
    if (eventsManageNav) eventsManageNav.parentElement.style.display = canEvents     ? '' : 'none';

    // if they're on a panel they can't access anymore, show auth gate or bounce
    if (activePanel) {
      var panelId = activePanel.id.replace('panel-', '');
      var blocked =
        (activePanel.id === 'panel-shop'          && !canShop) ||
        (activePanel.id === 'panel-creator-studio' && !canCreatorStudio) ||
        (activePanel.id === 'panel-shop-admin'    && !canShopAdmin) ||
        (activePanel.id === 'panel-inactivity'    && !canInactivity) ||
        (activePanel.id === 'panel-promotions'    && !canPromotions) ||
        (activePanel.id === 'panel-events-manage' && !canEvents) ||
        (activePanel.id === 'panel-guild-info'    && !canGuildInfo);
      if (blocked) {
        if (!state.loggedIn && _LOGIN_REQUIRED_PANELS.indexOf(panelId) !== -1 && window.renderAuthGate) {
          window.renderAuthGate(activePanel);
        } else {
          document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
          document.getElementById('panel-player').classList.add('active');
          navItems.forEach(n => n.classList.remove('active'));
          document.querySelector('[data-panel="player"]').classList.add('active');
        }
      }
    }

    // persist nav visibility so the next page load can restore it instantly
    if (state.loggedIn) {
      localStorage.setItem('esi_nav_cache', JSON.stringify({
        shop: canShop, creatorStudio: canCreatorStudio, shopAdmin: canShopAdmin,
        manage: !!(canInactivity || canPromotions || canEvents || canShopAdmin || canGuildInfo),
        inactivity: canInactivity, promotions: canPromotions, eventsManage: canEvents,
        guildInfo: canGuildInfo,
      }));
    } else {
      localStorage.removeItem('esi_nav_cache');
    }
  }

  /* support modal */
  var linksView    = document.getElementById('supportLinksView');
  var ticketView   = document.getElementById('ticketFormView');
  var supportModal = document.getElementById('supportModal');

  window.Popup.register(modalBackdrop, {
    closeBtn: modalClose,
    /* if the ticket form is showing, go back to links view instead of closing */
    onRequestClose: function () {
      if (supportModal.classList.contains('modal--ticket')) {
        ticketView.style.display = 'none';
        linksView.style.display  = 'block';
        supportModal.classList.remove('modal--ticket');
        return true; // intercept the close
      }
      return false;
    },
  });

  helpBtn.addEventListener('click', () => openModal());

  function openModal()  { window.Popup.open(modalBackdrop); }
  function closeModal() {
    if (supportModal.classList.contains('modal--ticket')) {
      ticketView.style.display = 'none';
      linksView.style.display  = 'block';
      supportModal.classList.remove('modal--ticket');
      return;
    }
    window.Popup.close(modalBackdrop);
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
    // no sub - insert directly
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
  var _LOGIN_REQUIRED_PANELS = ['shop', 'creator-studio', 'shop-admin', 'inactivity', 'promotions', 'events-manage', 'guild-info'];

  function switchToPanel(panel) {
    const validPanels = ['player', 'guild', 'bot', 'events', 'shop', 'creator-studio', 'shop-admin', 'profile', 'inactivity', 'promotions', 'events-manage', 'guild-info'];
    let target = validPanels.includes(panel) ? panel : 'player';

    // If the panel requires login and user isn't logged in, show auth gate
    if (_LOGIN_REQUIRED_PANELS.indexOf(target) !== -1 && !state.loggedIn) {
      navItems.forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      const panelEl = document.getElementById('panel-' + target);
      if (panelEl) {
        panelEl.classList.add('active');
        if (window.renderAuthGate) window.renderAuthGate(panelEl);
      }
      return;
    }

    // quietly fall back if they can't access the panel
    if (!_cachedLoginApplied || _configLoaded) {
      var _before = target;
      if (target === 'shop'            && !isGuildMember())      target = 'player';
      if (target === 'creator-studio'  && !hasCreatorAccess())   target = 'player';
      if (target === 'shop-admin'      && !hasShopAdmin())       target = 'player';
      if (target === 'inactivity'      && !hasParliamentPlus())  target = 'player';
      if (target === 'promotions'      && !hasJurorPlus())       target = 'player';
      if (target === 'events-manage'   && !hasEventsAccess())    target = 'player';
      if (target === 'guild-info'      && !hasGuildInfoAccess()) target = 'player';
      if (_before !== target);
    }
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
  window.switchToPanel        = switchToPanel;
  window.hasJurorPlus         = hasJurorPlus;
  window.hasParliamentPlus    = hasParliamentPlus;
  window.hasEventsAccess      = hasEventsAccess;
  window.hasEventsManageAny   = hasEventsManageAny;
  window.isChiefPlus          = isChiefPlus;
  window.hasShopAdmin         = hasShopAdmin;
  window.hasCreatorAccess     = hasCreatorAccess;
  window.hasGuildInfoAccess   = hasGuildInfoAccess;
  window.renderMarkdown       = renderMarkdown;

  if (!_cachedLoginApplied) {
    // switch to the correct panel based on URL (mirrors what the cached path does)
    var _urlP = window.location.pathname.replace(/^\//, '').split('/');
    var _urlF = _urlP[0] || 'player';
    var _wp = _urlF;
    if (_urlF === 'events' && _urlP[1] === 'manage') _wp = 'events-manage';
    if (_urlF === 'shop'   && _urlP[1] === 'admin')  _wp = 'shop-admin';
    if (_urlF === 'shop'   && _urlP[1] === 'studio') _wp = 'creator-studio';
    if (_urlF === 'guild'  && _urlP[1] === 'info')   _wp = 'guild-info';
    var _wpEl = document.getElementById('panel-' + _wp);
    if (_wpEl && _wp !== 'player') {
      document.querySelectorAll('.panel').forEach(function (p) { p.classList.remove('active'); });
      _wpEl.classList.add('active');
      document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
      var _wpNav = document.querySelector('[data-panel="' + _wp + '"]');
      if (_wpNav) _wpNav.classList.add('active');
    }
    applyPermissions();
  }

  // always remove pre-paint panel/nav CSS now that JS has set the real active classes
  var _preloadCSS2 = document.getElementById('esi-preload-css');
  if (_preloadCSS2) { _preloadCSS2.remove(); }
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
    toastsEnabled:      true,
    guildDefaultMetric: 'playerCount',
    guildDefaultRange:  30,
    showEventsNavBadge: true,
    showPinnedBanner:   true,
    shopAuctionDmOptOut: false,
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
          // no server settings yet - push current local settings up
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

  /* settings modal */
  window.Popup.register(settingsBackdrop, { closeBtn: settingsCloseBtn });
  function _awaitAppearanceCatalogReady() {
    var waits = [];
    if (window.ThemeConfig && typeof window.ThemeConfig.whenReady === 'function') {
      waits.push(window.ThemeConfig.whenReady());
    }
    if (window.FontConfig && typeof window.FontConfig.whenReady === 'function') {
      waits.push(window.FontConfig.whenReady());
    }
    if (!waits.length) return Promise.resolve();
    return Promise.all(waits).catch(function () {});
  }

  var _openingSettings = false;

  function _openSettingsNow() {
    _populateSettingsForm();
    _settingsSnapshot = _readFormValues();
    _updateLoginRows();
    _updateSaveBtn();
    window.Popup.open(settingsBackdrop);
  }

  function openSettings() {
    if (_openingSettings) return;
    _openingSettings = true;
    _awaitAppearanceCatalogReady().then(
      function () {
        _openingSettings = false;
        _openSettingsNow();
      },
      function () {
        _openingSettings = false;
        _openSettingsNow();
      }
    );
  }
  function closeSettings() { window.Popup.close(settingsBackdrop); }

  settingsBtn.addEventListener('click', openSettings);

  /* settings form elements */
  var _sTheme       = document.getElementById('settingTheme');
  var _sFont        = document.getElementById('settingFont');
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
  var _sEventsNavBadge = document.getElementById('settingEventsNavBadge');
  var _sPinnedBanner   = document.getElementById('settingPinnedBanner');
  var _sToastsEnabled  = document.getElementById('settingToastsEnabled');
  var _sToastRow       = document.getElementById('settingToastRow');
  var _sAuctionDmOpt   = document.getElementById('settingShopAuctionDmOptOut');

  // Custom theme/font add-custom buttons
  var _addCustomThemeBtn   = document.getElementById('addCustomThemeBtn');
  var _removeCustomThemeBtn = document.getElementById('removeCustomThemeBtn');
  var _customThemeFile     = document.getElementById('customThemeFileInput');
  var _addCustomFontBtn    = document.getElementById('addCustomFontBtn');
  var _removeCustomFontBtn = document.getElementById('removeCustomFontBtn');
  var _customFontFile      = document.getElementById('customFontFileInput');
  function _getThemeDefaultOptionLabel() {
    if (window.ThemeConfig && typeof window.ThemeConfig.getDefaultOptionLabel === 'function') {
      var configured = String(window.ThemeConfig.getDefaultOptionLabel() || '').trim();
      if (configured) return configured;
    }
    return 'Default';
  }


  function _getBuiltInThemesFromConfig() {
    if (!window.ThemeConfig || typeof window.ThemeConfig.getBuiltInThemes !== 'function') return null;
    var list = window.ThemeConfig.getBuiltInThemes();
    if (!Array.isArray(list)) return [];
    var unique = {};
    var themes = [];
    for (var i = 0; i < list.length; i++) {
      var entry = list[i] || {};
      var value = String(entry.value || '').trim();
      if (!value || value === 'custom' || unique[value]) continue;
      unique[value] = true;
      themes.push({
        value: value,
        label: String(entry.label || value),
      });
    }
    return themes;
  }

  function _isKnownThemeValue(themeValue, builtIns) {
    var value = String(themeValue || '').trim();
    if (!value) return false;
    if (value === 'custom') return true;
    var themes = Array.isArray(builtIns) ? builtIns : [];
    for (var i = 0; i < themes.length; i++) {
      if (themes[i] && themes[i].value === value) return true;
    }
    return false;
  }

  function _getThemeSelectValueForForm() {
    if (window.ThemeConfig && typeof window.ThemeConfig.resolveThemeSelectValue === 'function') {
      return String(window.ThemeConfig.resolveThemeSelectValue(new Date()) || '').trim();
    }
    var stored = String(localStorage.getItem('theme') || '').trim();
    var builtIns = _getBuiltInThemesFromConfig() || [];
    if (_isKnownThemeValue(stored, builtIns)) return stored;
    return '';
  }

  function _getFontDefaultOptionLabel() {
    if (window.FontConfig && typeof window.FontConfig.getDefaultOptionLabel === 'function') {
      var configured = String(window.FontConfig.getDefaultOptionLabel() || '').trim();
      if (configured) return configured;
    }
    return 'Cinzel & Crimson Pro';
  }

  function _getBuiltInFontsFromConfig() {
    if (!window.FontConfig || typeof window.FontConfig.getBuiltInFonts !== 'function') return null;
    var list = window.FontConfig.getBuiltInFonts();
    if (!Array.isArray(list)) return [];
    var unique = {};
    var fonts = [];
    for (var i = 0; i < list.length; i++) {
      var entry = list[i] || {};
      var value = String(entry.value || '').trim();
      if (!value || value === 'custom' || unique[value]) continue;
      unique[value] = true;
      fonts.push({
        value: value,
        label: String(entry.label || value),
      });
    }
    return fonts;
  }

  function _isKnownFontValue(fontValue, builtIns) {
    var value = String(fontValue || '').trim();
    if (!value) return false;
    if (value === 'custom') return true;
    var fonts = Array.isArray(builtIns) ? builtIns : [];
    for (var i = 0; i < fonts.length; i++) {
      if (fonts[i] && fonts[i].value === value) return true;
    }
    return false;
  }

  function _getFontSelectValueForForm() {
    if (window.FontConfig && typeof window.FontConfig.resolveFontSelectValue === 'function') {
      return String(window.FontConfig.resolveFontSelectValue() || '').trim();
    }
    var stored = String(localStorage.getItem('font') || '').trim();
    var builtIns = _getBuiltInFontsFromConfig() || [];
    if (_isKnownFontValue(stored, builtIns)) return stored;
    return '';
  }

  function _findSelectOptionByValue(select, value) {
    if (!select) return null;
    for (var i = 0; i < select.options.length; i++) {
      var option = select.options[i];
      if (option && option.value === value) return option;
    }
    return null;
  }

  function _rebuildThemeOptions() {
    if (!_sTheme) return;
    var builtIns = _getBuiltInThemesFromConfig() || [];

    var options = Array.prototype.slice.call(_sTheme.options);
    options.forEach(function (option) {
      if (!option) return;
      if (option.value === 'custom') return;
      option.remove();
    });

    var customOption = _findSelectOptionByValue(_sTheme, 'custom');
    var defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = _getThemeDefaultOptionLabel();
    _sTheme.appendChild(defaultOption);
    for (var i = 0; i < builtIns.length; i++) {
      var theme = builtIns[i];
      if (!theme || !theme.value) continue;
      var option = document.createElement('option');
      option.value = theme.value;
      option.textContent = theme.label;
      _sTheme.appendChild(option);
    }
    if (customOption) _sTheme.appendChild(customOption);
  }

  function _rebuildFontOptions() {
    if (!_sFont) return;
    var builtIns = _getBuiltInFontsFromConfig() || [];

    var options = Array.prototype.slice.call(_sFont.options);
    options.forEach(function (option) {
      if (!option) return;
      if (option.value === 'custom') return;
      option.remove();
    });

    var customOption = _findSelectOptionByValue(_sFont, 'custom');
    var defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = _getFontDefaultOptionLabel();
    _sFont.appendChild(defaultOption);
    for (var i = 0; i < builtIns.length; i++) {
      var font = builtIns[i];
      if (!font || !font.value) continue;
      var option = document.createElement('option');
      option.value = font.value;
      option.textContent = font.label;
      _sFont.appendChild(option);
    }
    if (customOption) _sFont.appendChild(customOption);
  }

  function _applyToastRowVisibility() {
    if (_sToastRow) {
      _sToastRow.style.display = (_sToastsEnabled && _sToastsEnabled.checked) ? '' : 'none';
    }
  }

  function _populateSettingsForm() {
    var s = _readAllSettings();
    _rebuildThemeOptions();
    _rebuildFontOptions();
    _syncCustomOption('theme');
    _syncCustomOption('font');
    var themeSelectValue = _getThemeSelectValueForForm();
    var fontSelectValue = _getFontSelectValueForForm();
    _sTheme.value = themeSelectValue;
    if (_sTheme.value !== themeSelectValue) _sTheme.value = '';
    if (!_sTheme.value) _sTheme.selectedIndex = 0;
    _sFont.value = fontSelectValue;
    if (_sFont.value !== fontSelectValue) _sFont.value = '';
    if (!_sFont.value) _sFont.selectedIndex = 0;
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
    _sEventsNavBadge.checked = s.showEventsNavBadge !== false;
    _sPinnedBanner.checked   = s.showPinnedBanner   !== false;
    _sToastsEnabled.checked  = s.toastsEnabled      !== false;
    if (_sAuctionDmOpt) _sAuctionDmOpt.checked = !!s.shopAuctionDmOptOut;
    _applyToastRowVisibility();
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
      showEventsNavBadge: !!_sEventsNavBadge.checked,
      showPinnedBanner:   !!_sPinnedBanner.checked,
      toastsEnabled:      !!_sToastsEnabled.checked,
      shopAuctionDmOptOut: !!(_sAuctionDmOpt && _sAuctionDmOpt.checked),
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
    var memberMgmtSection = document.getElementById('settingsMemberMgmtSection');
    if (memberMgmtSection) {
      var remaining = memberMgmtSection.querySelectorAll('.settings-row');
      if (!remaining.length) memberMgmtSection.remove();
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

  /* enforce character limits on number inputs */
  function _enforceMaxLen(el, maxLen) {
    if (!el) return;
    el.addEventListener('input', function () {
      var digits = String(this.value || '').replace(/\D/g, '');
      if (digits.length > maxLen) {
        this.value = digits.slice(0, maxLen);
      }
    });
  }
  _enforceMaxLen(_sChkHours, 2);
  _enforceMaxLen(_sToastDur, 2);
  _enforceMaxLen(_sToastMax, 1);

  /* track changes - don't save yet, just show the save button */
  _sRange.addEventListener('input', function () { _sRangeVal.textContent = _sRange.value; _updateSaveBtn(); });
  _sGuildRange.addEventListener('input', function () { _sGuildRangeVal.textContent = _sGuildRange.value; _updateSaveBtn(); });
  [_sMetric, _sGuildMetric, _sPlayer, _sChkType, _sChkHours, _sChkTab, _sPromTab, _sToastDur, _sToastMax, _sEventsNavBadge, _sPinnedBanner, _sToastsEnabled, _sAuctionDmOpt].forEach(function (el) {
    if (!el) return;
    el.addEventListener('change', _updateSaveBtn);
    el.addEventListener('input', _updateSaveBtn);
  });

  // Sync custom option into select + update button label
  function _syncCustomOption(type) {
    var isTheme = type === 'theme';
    var select   = isTheme ? _sTheme : _sFont;
    var btn      = isTheme ? _addCustomThemeBtn : _addCustomFontBtn;
    var xBtn     = isTheme ? _removeCustomThemeBtn : _removeCustomFontBtn;
    var css  = localStorage.getItem('esi_custom_' + type + '_css');
    var name = localStorage.getItem('esi_custom_' + type + '_name');
    var existing = select.querySelector('option[value="custom"]');

    if (css && name) {
      if (!existing) {
        existing = document.createElement('option');
        existing.value = 'custom';
        select.appendChild(existing);
      }
      existing.textContent = name;
      btn.textContent = name;
      xBtn.style.display = '';
    } else {
      if (existing) existing.remove();
      btn.textContent = '+ Add Custom';
      xBtn.style.display = 'none';
    }
  }

  // Handle file upload for custom theme/font
  function _handleCustomFile(type, file, companionAssets) {
    if (!file) return;
    if (!file.name.endsWith('.css')) {
      showToast('\u26a0 Please select a .css file.', 'warn');
      return;
    }
    if (file.size > 512 * 1024) {
      showToast('\u26a0 File too large (max 512 KB).', 'warn');
      return;
    }
    var reader = new FileReader();
    reader.onload = function (e) {
      var cssText = e.target.result;
      // Validate the file looks like the expected type
      if (type === 'theme') {
        var hasThemeAttr = /\[data-theme=/.test(cssText);
        var customProps  = cssText.match(/--[\w-]+\s*:/g);
        if (!hasThemeAttr && (!customProps || customProps.length < 3)) {
          showToast('\u26a0 This doesn\u2019t look like a colour theme. Expected CSS custom properties (--variable: value) or a [data-theme] selector.', 'warn');
          return;
        }
      } else {
        var hasFontAttr   = /\[data-font=/.test(cssText);
        var hasFontFace   = /@font-face/i.test(cssText);
        var hasFontFamily = /font-family\s*:/i.test(cssText);
        if (!hasFontAttr && !hasFontFace && !hasFontFamily) {
          showToast('\u26a0 This doesn\u2019t look like a font file. Expected @font-face rules, font-family declarations, or a [data-font] selector.', 'warn');
          return;
        }
      }
      // Extract display name before rewriting selectors
      var attrRe = type === 'theme' ? /data-theme="([^"]+)"/ : /data-font="([^"]+)"/;
      var nameMatch = cssText.match(attrRe);
      var rawName = nameMatch ? nameMatch[1] : file.name.replace(/\.css$/i, '');
      var displayName = rawName
        .replace(/[^a-zA-Z0-9 \-_.]/g, '')
        .replace(/[-_]/g, ' ')
        .trim()
        .replace(/\b\w/g, function (ch) { return ch.toUpperCase(); })
        || 'Custom';
      // Rewrite data-theme/data-font selectors so they match the "custom" attribute value
      var selectorRe = type === 'theme'
        ? /\[data-theme="[^"]*"\]/g
        : /\[data-font="[^"]*"\]/g;
      var customSel = type === 'theme' ? '[data-theme="custom"]' : '[data-font="custom"]';
      cssText = cssText.replace(selectorRe, customSel);

      // Inline companion assets: replace relative url() refs with data-URIs
      function _applyAndFinish(finalCss) {
        localStorage.setItem('esi_custom_' + type + '_css', finalCss);
        localStorage.setItem('esi_custom_' + type + '_name', displayName);
        _syncCustomOption(type);
        var select = type === 'theme' ? _sTheme : _sFont;
        select.value = 'custom';
        if (type === 'theme') {
          window.setTheme('custom');
          if (state.loggedIn && state.user) updateLoginButton();
        } else {
          window.setFont('custom');
        }
      }

      // Find all relative url() references (not http/https/data/absolute)
      var _relUrlRe = /url\(\s*(['"]?)(?!(?:https?:|data:|\/))([^)'"]+)\1\s*\)/g;
      var _allRelRefs = [];
      var _m;
      while ((_m = _relUrlRe.exec(cssText)) !== null) {
        _allRelRefs.push(_m[2].replace(/^\.\//, '').toLowerCase());
      }

      if (!companionAssets || !companionAssets.length) {
        if (_allRelRefs.length) {
          // CSS references local files but none were uploaded alongside it
          var _assetType = type === 'font' ? 'font files' : 'images';
          var _extraHint = type === 'font' ? ', or upload a .zip.' : '.';
          showToast('\u26a0 Your custom CSS references local files (e.g. ' + _allRelRefs[0] + '). Please select the CSS and its ' + _assetType + ' together' + _extraHint, 'warn');
          if (type === 'font') _customFontFile.click();
          else _customThemeFile.click();
          return;
        }
        _applyAndFinish(cssText);
        return;
      }

      // Build a filename
      var assetByName = {};
      companionAssets.forEach(function (f) { assetByName[f.name.toLowerCase()] = f; });

      // Match relative refs to uploaded files
      var urlRe = /url\(\s*(['"]?)(?!(?:https?:|data:|\/))([^)'"]+)\1\s*\)/g;
      var matches = [];
      var m;
      while ((m = urlRe.exec(cssText)) !== null) {
        var refName = m[2].replace(/^\.\//, '').toLowerCase();
        if (assetByName[refName]) matches.push({ full: m[0], quote: m[1], ref: m[2], name: refName });
      }

      // Warn about refs that didn't match any uploaded file
      var unresolved = _allRelRefs.filter(function (r) { return !assetByName[r]; });
      if (unresolved.length) {
        showToast('\u26a0 Could not find: ' + unresolved.join(', ') + '. Those files won\u2019t be replaced.', 'warn');
      }

      if (!matches.length) {
        _applyAndFinish(cssText);
        return;
      }

      // Read each matched asset as a data-URI, then replace in the CSS
      var pending = matches.length;
      var replacements = {};
      matches.forEach(function (entry) {
        var assetReader = new FileReader();
        assetReader.onload = function (ev) {
          replacements[entry.full] = 'url(' + ev.target.result + ')';
          if (--pending === 0) {
            var final = cssText;
            for (var original in replacements) final = final.split(original).join(replacements[original]);
            _applyAndFinish(final);
          }
        };
        assetReader.onerror = function () {
          if (--pending === 0) {
            var final = cssText;
            for (var original in replacements) final = final.split(original).join(replacements[original]);
            _applyAndFinish(final);
          }
        };
        assetReader.readAsDataURL(assetByName[entry.name]);
      });
    };
    reader.readAsText(file);
  }

  // Remove custom file
  function _removeCustomFile(type) {
    localStorage.removeItem('esi_custom_' + type + '_css');
    localStorage.removeItem('esi_custom_' + type + '_name');
    var select = type === 'theme' ? _sTheme : _sFont;
    if (type === 'theme') {
      window.setTheme('');
      if (state.loggedIn && state.user) updateLoginButton();
    } else {
      window.setFont('');
    }
    _syncCustomOption(type);
    select.value = '';
    if (!select.value) select.selectedIndex = 0;
  }

  // Extract CSS + images from a .zip and pass them to _handleCustomFile
  function _handleZipTheme(zipFile) {
    var reader = new FileReader();
    reader.onload = function (e) {
      JSZip.loadAsync(e.target.result).then(function (zip) {
        var cssEntry = null;
        var imgEntries = [];
        zip.forEach(function (path, entry) {
          if (entry.dir) return;
          var name = path.split('/').pop().toLowerCase();
          if (name.endsWith('.css')) cssEntry = entry;
          else if (/\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i.test(name)) imgEntries.push(entry);
        });
        if (!cssEntry) {
          showToast('\u26a0 No .css file found inside the zip.', 'warn');
          return;
        }
        // Read the CSS as text
        cssEntry.async('string').then(function (cssText) {
          if (!imgEntries.length) {
            // Synthesize a File for the CSS so _handleCustomFile can use file.name
            var cssBlob = new File([cssText], cssEntry.name.split('/').pop(), { type: 'text/css' });
            _handleCustomFile('theme', cssBlob, []);
            return;
          }
          // Read all images as blobs, convert to Files
          var pending = imgEntries.length;
          var imgFiles = [];
          imgEntries.forEach(function (img) {
            img.async('blob').then(function (blob) {
              var imgName = img.name.split('/').pop();
              imgFiles.push(new File([blob], imgName, { type: blob.type || 'application/octet-stream' }));
              if (--pending === 0) {
                var cssBlob = new File([cssText], cssEntry.name.split('/').pop(), { type: 'text/css' });
                _handleCustomFile('theme', cssBlob, imgFiles);
              }
            });
          });
        });
      }).catch(function () {
        showToast('\u26a0 Could not read the zip file.', 'warn');
      });
    };
    reader.readAsArrayBuffer(zipFile);
  }

  // Extract CSS + font assets from a .zip and pass them to _handleCustomFile
  function _handleZipFont(zipFile) {
    var reader = new FileReader();
    reader.onload = function (e) {
      JSZip.loadAsync(e.target.result).then(function (zip) {
        var cssEntry = null;
        var assetEntries = [];
        zip.forEach(function (path, entry) {
          if (entry.dir) return;
          var name = path.split('/').pop().toLowerCase();
          if (name.endsWith('.css')) {
            if (!cssEntry) cssEntry = entry;
            return;
          }
          assetEntries.push(entry);
        });
        if (!cssEntry) {
          showToast('\u26a0 No .css file found inside the zip.', 'warn');
          return;
        }
        // Read the CSS as text
        cssEntry.async('string').then(function (cssText) {
          if (!assetEntries.length) {
            // Synthesize a File for the CSS so _handleCustomFile can use file.name
            var cssBlob = new File([cssText], cssEntry.name.split('/').pop(), { type: 'text/css' });
            _handleCustomFile('font', cssBlob, []);
            return;
          }
          // Read all assets as blobs, convert to Files
          var pending = assetEntries.length;
          var assetFiles = [];
          assetEntries.forEach(function (asset) {
            asset.async('blob').then(function (blob) {
              var assetName = asset.name.split('/').pop();
              assetFiles.push(new File([blob], assetName, { type: blob.type || 'application/octet-stream' }));
              if (--pending === 0) {
                var cssBlob = new File([cssText], cssEntry.name.split('/').pop(), { type: 'text/css' });
                _handleCustomFile('font', cssBlob, assetFiles);
              }
            }).catch(function () {
              if (--pending === 0) {
                var cssBlob = new File([cssText], cssEntry.name.split('/').pop(), { type: 'text/css' });
                _handleCustomFile('font', cssBlob, assetFiles);
              }
            });
          });
        });
      }).catch(function () {
        showToast('\u26a0 Could not read the zip file.', 'warn');
      });
    };
    reader.readAsArrayBuffer(zipFile);
  }

  // Wire up add-custom buttons
  _addCustomThemeBtn.addEventListener('click', function () { _customThemeFile.click(); });
  _customThemeFile.addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files);
    // If a zip was selected, extract it instead
    var zipFile = files.find(function (f) { return f.name.toLowerCase().endsWith('.zip'); });
    if (zipFile) {
      _handleZipTheme(zipFile);
      this.value = '';
      return;
    }
    var cssFile = files.find(function (f) { return f.name.toLowerCase().endsWith('.css'); });
    var images  = files.filter(function (f) { return f.type && f.type.indexOf('image/') === 0; });
    _handleCustomFile('theme', cssFile, images);
    this.value = '';
  });
  _removeCustomThemeBtn.addEventListener('click', function () { _removeCustomFile('theme'); });

  _addCustomFontBtn.addEventListener('click', function () { _customFontFile.click(); });
  _customFontFile.addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []);
    var zipFile = files.find(function (f) { return f.name.toLowerCase().endsWith('.zip'); });
    if (zipFile) {
      _handleZipFont(zipFile);
      this.value = '';
      return;
    }
    _handleCustomFile('font', files[0], files.slice(1));
    this.value = '';
  });
  _removeCustomFontBtn.addEventListener('click', function () { _removeCustomFile('font'); });

  // Apply theme instantly on change
  _sTheme.addEventListener('change', function () {
    window.setTheme(_sTheme.value || '');
    if (state.loggedIn && state.user) updateLoginButton();
  });

  // Apply font instantly on change
  _sFont.addEventListener('change', function () {
    window.setFont(_sFont.value || '');
  });

  // Live-hide the toast customization row when toasts are disabled
  _sToastsEnabled.addEventListener('change', _applyToastRowVisibility);

  // Settings whose effects are picked up live
  var LIVE_APPLIED_KEYS = {
    showEventsNavBadge: true,
    showPinnedBanner:   true,
    toastsEnabled:      true,
    toastDuration:      true,
    toastMax:           true,
  };

  // Apply settings whose effects can take hold without a reload
  function _applyLiveSettings(prev, next) {
    var fullyLive = true;
    var changed = {};
    Object.keys(next).forEach(function (k) {
      if (!prev || prev[k] !== next[k]) {
        changed[k] = true;
        if (!LIVE_APPLIED_KEYS[k]) fullyLive = false;
      }
    });

    if (changed.showEventsNavBadge && typeof window.evpRefreshNavIndicators === 'function') {
      window.evpRefreshNavIndicators();
    }
    if (changed.showPinnedBanner && window.esiPinnedBanner &&
        typeof window.esiPinnedBanner.applyVisibility === 'function') {
      window.esiPinnedBanner.applyVisibility();
    }
    return fullyLive;
  }

  /* save button - persist all current form values, then apply live */
  settingsSaveBtn.addEventListener('click', function () {
    var values = _readFormValues();
    var prev   = _settingsSnapshot;
    _writeAllSettings(values);
    _pushSettingsToServer(values);
    _settingsSnapshot = values;
    _updateSaveBtn();
    var fullyLive = _applyLiveSettings(prev, values);
    if (fullyLive) {
      showToast('\u2713 Settings saved.', 'success');
    } else {
      showToast('\u2713 Settings saved. Reload the page to fully apply all changes.', 'success');
    }
  });

  /* reset button */
  settingsResetBtn.addEventListener('click', function () {
    var prev = _settingsSnapshot;
    esiSettings.reset();
    _populateSettingsForm();
    _settingsSnapshot = _readFormValues();
    _updateSaveBtn();
    _applyLiveSettings(prev, _settingsSnapshot);
    showToast('Settings reset to defaults.', 'info');
  });

})();
