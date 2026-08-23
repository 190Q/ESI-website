(function () {
  'use strict';

  var csrfToken = null;
  var currentUser = null;
  var accessLevel = null;
  var pollTimer = null;
  var _serviceStatus = {};
  var _logRaw = {};
  var _consoleTab = {};
  var _ACCESS_LINE_RE = /\[\d{2}\/\w{3}\/\d{4} \d{2}:\d{2}:\d{2}\] "[A-Z]+ \S+ HTTP\/\d\.\d" \d{3}/;
  var _ERROR_LINE_RE = /error|exception|traceback|critical/i;

  var SIDEBAR_SECTIONS = [
    {
      label: 'Website',
      items: [
        { id: 'gateway', type: 'screen', label: 'Website Gateway', icon: 'server' },
        { id: 'routes',  type: 'screen', label: 'Website Routes',  icon: 'server' },
        { id: 'cache',   type: 'screen', label: 'Website Cache',   icon: 'server' },
      ],
    },
    {
      label: 'Bots',
      items: [
        { id: 'q-bot', type: 'screen', label: 'Q-Bot', icon: 'bot' },
        { id: 'esi-bot', type: 'screen', label: 'ESI-Bot', icon: 'bot' },
        { id: 'esi-bot-trackers', type: 'screen', label: 'ESI-Bot Trackers', icon: 'bot' },
      ],
    },
    {
      label: 'Tools',
      items: [
        { id: 'scripts', type: 'scripts', label: 'Scripts', icon: 'scripts' },
      ],
    },
  ];

  var SVG = {
    server: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="6" rx="1"/><rect x="3" y="14" width="18" height="6" rx="1"/><circle cx="7" cy="7" r="1"/><circle cx="7" cy="17" r="1"/></svg>',
    bot: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>',
    scripts: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
  };

  var sidebar = document.getElementById('sidebar');
  var sidebarToggle = document.getElementById('sidebarToggle');
  var navbar = document.querySelector('.navbar');
  var navbarLeft = document.querySelector('.navbar-left');
  var navbarCenter = document.querySelector('.navbar-center');
  var navbarRight = document.querySelector('.navbar-right');
  var navbarHamburgerBtn = document.getElementById('navbarHamburgerBtn');
  var sidebarMobileBackdrop = document.getElementById('sidebarMobileBackdrop');
  var sidebarNavScroller = sidebar ? sidebar.querySelector('.sidebar-nav') : null;
  var loginBtn = document.getElementById('loginBtn');
  var MOBILE_SIDEBAR_BREAKPOINT = 720;

  function el(tag, className, text) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function fmtUptime(seconds) {
    if (seconds == null) return '';
    var d = Math.floor(seconds / 86400);
    var h = Math.floor((seconds % 86400) / 3600);
    var m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm';
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
    navbar.classList.toggle('navbar-hide-center', neededWidth > availableWidth);
  }

  function wireShell() {
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
      sidebar.classList.add('collapsed');
    }
    document.documentElement.classList.remove('sidebar-pre-collapsed');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        document.documentElement.classList.remove('no-transitions');
      });
    });

    sidebarToggle.addEventListener('click', function () {
      if (isMobileSidebarMode()) {
        setMobileSidebarOpen(false);
        return;
      }
      sidebar.classList.toggle('collapsed');
      localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
      sidebar.addEventListener('transitionend', function onEnd() {
        sidebar.removeEventListener('transitionend', onEnd);
        window.dispatchEvent(new Event('resize'));
      });
    });

    navbarHamburgerBtn.addEventListener('click', function () {
      if (!isMobileSidebarMode()) return;
      setMobileSidebarOpen(!sidebar.classList.contains('mobile-open'));
    });
    sidebarMobileBackdrop.addEventListener('click', function () {
      setMobileSidebarOpen(false);
    });
    window.addEventListener('resize', syncNavbarCenterVisibility);
    window.addEventListener('resize', function () {
      if (!isMobileSidebarMode()) setMobileSidebarOpen(false);
    });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(syncNavbarCenterVisibility).catch(function () {});
    }
    syncNavbarCenterVisibility();
    setMobileSidebarOpen(false);
  }

  function setActivePanel(id) {
    document.querySelectorAll('.nav-item[data-panel]').forEach(function (n) {
      n.classList.toggle('active', n.dataset.panel === id);
    });
    document.querySelectorAll('.panel').forEach(function (p) {
      p.classList.toggle('active', p.id === 'panel-' + id);
    });
    try {
      history.replaceState(null, '', '#screen=' + encodeURIComponent(id));
    } catch (_err) {}
    if (isMobileSidebarMode()) setMobileSidebarOpen(false);
    if (id === 'scripts') return; // not a service/bot screen - has its own data flow
    fetchLogs(id);
    fetchEvents(id);
  }

  function getInitialPanelId() {
    var match = String(location.hash || '').match(/screen=([^&]+)/);
    if (match) {
      try { return decodeURIComponent(match[1]); } catch (_err) {}
    }
    return SIDEBAR_SECTIONS[0].items[0].id;
  }

  function buildShellRegistry() {
    var navRoot = document.getElementById('sidebarNav');
    var panelsRoot = document.getElementById('panels-root');
    navRoot.innerHTML = '';
    panelsRoot.innerHTML = '';

    SIDEBAR_SECTIONS.forEach(function (section) {
      var sectionEl = el('div', 'nav-section');
      sectionEl.appendChild(el('span', 'nav-section-label', section.label));
      var list = document.createElement('ul');
      sectionEl.appendChild(list);
      navRoot.appendChild(sectionEl);

      section.items.forEach(function (item) {
        var li = document.createElement('li');
        var a = document.createElement('a');
        a.href = '#screen=' + encodeURIComponent(item.id);
        a.className = 'nav-item';
        a.dataset.panel = item.id;
        a.dataset.itemType = item.type;
        a.title = item.label;
        var icon = el('span', 'nav-icon');
        icon.innerHTML = SVG[item.icon] || SVG.server;
        a.appendChild(icon);
        a.appendChild(el('span', 'nav-label', item.label));
        a.addEventListener('click', function (event) {
          if (item.type === 'screen' || item.type === 'scripts') {
            event.preventDefault();
            setActivePanel(item.id);
          }
        });
        li.appendChild(a);
        list.appendChild(li);

        if (item.type === 'screen') {
          var panel = document.createElement('section');
          panel.className = 'panel';
          panel.id = 'panel-' + item.id;
          panel.dataset.serviceKey = item.id;
          panel.innerHTML =
            '<div class="panel-header">' +
              '<h1 class="panel-title">' + item.label + '</h1>' +
              '<p class="panel-subtitle">Manage the ' + item.id + ' screen session.</p>' +
            '</div>' +
            '<div class="service-panel-body" data-service-body="' + item.id + '">' +
              serviceBodyTemplate() +
            '</div>';
          panelsRoot.appendChild(panel);
          wireServiceConsole(item.id);
        } else if (item.type === 'scripts') {
          var scriptsPanel = document.createElement('section');
          scriptsPanel.className = 'panel';
          scriptsPanel.id = 'panel-' + item.id;
          scriptsPanel.innerHTML =
            '<div class="panel-header">' +
              '<h1 class="panel-title">' + item.label + '</h1>' +
              '<p class="panel-subtitle">Run admin scripts and GDPR tools directly from the panel.</p>' +
            '</div>' +
            scriptsPanelTemplate();
          panelsRoot.appendChild(scriptsPanel);
          initScriptsPanel();
        }
      });
    });

    setActivePanel(getInitialPanelId());
  }

  function discordAvatarUrl(user) {
    return user && user.avatar
      ? 'https://cdn.discordapp.com/avatars/' + user.id + '/' + user.avatar + '.png?size=64'
      : 'https://cdn.discordapp.com/embed/avatars/0.png';
  }

  function renderLoginButton() {
    loginBtn.disabled = false;
    loginBtn.removeAttribute('aria-busy');
    loginBtn.innerHTML = '';
    if (!currentUser) {
      var iconWrap = document.createElement('span');
      iconWrap.innerHTML = '<svg width="20" height="20" viewBox="0 0 127.14 96.36" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07Z"/></svg>';
      loginBtn.appendChild(iconWrap.firstChild);
      loginBtn.appendChild(el('span', 'btn-label', 'Login with Discord'));
      loginBtn.style.opacity = '1';
      loginBtn.classList.remove('btn-discord--account');
      return;
    }
    var img = document.createElement('img');
    img.src = discordAvatarUrl(currentUser);
    img.alt = '';
    img.style.cssText = 'width:20px;height:20px;border-radius:50%;object-fit:cover;flex-shrink:0;';
    loginBtn.appendChild(img);
    loginBtn.appendChild(el('span', 'btn-label', currentUser.nick || currentUser.username));
    loginBtn.style.opacity = '1';
    loginBtn.style.background = 'var(--online,#3BA55C)';
    loginBtn.style.boxShadow = '0 2px 12px rgba(var(--online-rgb,59,165,92),0.35)';
    loginBtn.classList.add('btn-discord--account');
  }

  function wireAccountModal() {
    var backdrop = document.getElementById('accountModalBackdrop');
    window.Popup.register(backdrop, {
      closeBtn: document.getElementById('accountModalClose'),
    });
    loginBtn.addEventListener('click', function () {
      if (!currentUser) {
        loginBtn.disabled = true;
        loginBtn.setAttribute('aria-busy', 'true');
        var label = loginBtn.querySelector('.btn-label');
        if (label) label.textContent = 'Logging in\u2026';
        window.location.href = '/panel/auth/login';
        return;
      }
      document.getElementById('accountModalAvatar').src = discordAvatarUrl(currentUser);
      document.getElementById('accountModalName').textContent = currentUser.nick || currentUser.username;
      document.getElementById('accountModalSub').textContent = accessLevel === 'owner' ? 'Panel owner' : (accessLevel || 'No panel access');
      window.Popup.open(backdrop);
    });
    document.getElementById('logoutBtn').addEventListener('click', function () {
      fetch('/panel/auth/logout', { method: 'POST', credentials: 'same-origin' })
        .then(function () { window.location.reload(); });
    });
  }


  function ensureConfirmModal() {
    var bd = document.getElementById('panelConfirmBackdrop');
    if (bd) return bd;
    bd = document.createElement('div');
    bd.id = 'panelConfirmBackdrop';
    bd.className = 'modal-backdrop';
    bd.innerHTML =
      '<div class="modal confirm-modal">' +
        '<button class="modal-close" id="panelConfirmClose" aria-label="Close">\u2715</button>' +
        '<h2 class="modal-title" id="panelConfirmTitle">Confirm</h2>' +
        '<p class="modal-sub confirm-modal-message" id="panelConfirmMessage"></p>' +
        '<pre class="confirm-modal-detail" id="panelConfirmDetail" style="display:none"></pre>' +
        '<div class="service-actions confirm-modal-actions">' +
          '<button type="button" class="btn-secondary" id="panelConfirmCancel">Cancel</button>' +
          '<button type="button" class="btn-primary" id="panelConfirmOk">Confirm</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bd);
    window.Popup.register(bd, { closeBtn: '#panelConfirmClose' });
    return bd;
  }

  function showConfirm(opts) {
    opts = opts || {};
    var bd = ensureConfirmModal();
    var titleEl = bd.querySelector('#panelConfirmTitle');
    var msgEl = bd.querySelector('#panelConfirmMessage');
    var detailEl = bd.querySelector('#panelConfirmDetail');
    var okBtn = bd.querySelector('#panelConfirmOk');
    var cancelBtn = bd.querySelector('#panelConfirmCancel');
    var closeBtn = bd.querySelector('#panelConfirmClose');
    titleEl.textContent = opts.title || 'Are you sure?';
    msgEl.textContent = opts.message || '';
    msgEl.style.display = opts.message ? '' : 'none';
    if (opts.detail) { detailEl.textContent = opts.detail; detailEl.style.display = ''; }
    else { detailEl.textContent = ''; detailEl.style.display = 'none'; }
    okBtn.textContent = opts.confirmLabel || 'Confirm';
    cancelBtn.textContent = opts.cancelLabel || 'Cancel';
    okBtn.className = opts.danger ? 'btn-danger' : 'btn-primary';

    function close() { window.Popup.close(bd); }
    function settle(confirmed) {
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      closeBtn.onclick = null;
      close();
      if (confirmed && typeof opts.onConfirm === 'function') opts.onConfirm();
      else if (!confirmed && typeof opts.onCancel === 'function') opts.onCancel();
    }
    okBtn.onclick = function () { settle(true); };
    cancelBtn.onclick = function () { settle(false); };
    closeBtn.onclick = function () { settle(false); };
    window.Popup.open(bd);
  }

  function ensureAlertModal() {
    var bd = document.getElementById('panelAlertBackdrop');
    if (bd) return bd;
    bd = document.createElement('div');
    bd.id = 'panelAlertBackdrop';
    bd.className = 'modal-backdrop';
    bd.innerHTML =
      '<div class="modal confirm-modal">' +
        '<button class="modal-close" id="panelAlertClose" aria-label="Close">\u2715</button>' +
        '<h2 class="modal-title" id="panelAlertTitle">Notice</h2>' +
        '<p class="modal-sub confirm-modal-message" id="panelAlertMessage"></p>' +
        '<pre class="confirm-modal-detail" id="panelAlertDetail" style="display:none"></pre>' +
        '<div class="service-actions confirm-modal-actions">' +
          '<button type="button" class="btn-primary" id="panelAlertOk">OK</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(bd);
    window.Popup.register(bd, { closeBtn: '#panelAlertClose' });
    return bd;
  }

  function showAlert(opts) {
    if (typeof opts === 'string') opts = { message: opts };
    opts = opts || {};
    var bd = ensureAlertModal();
    bd.querySelector('#panelAlertTitle').textContent = opts.title || 'Notice';
    var msgEl = bd.querySelector('#panelAlertMessage');
    msgEl.textContent = opts.message || '';
    msgEl.style.display = opts.message ? '' : 'none';
    var detailEl = bd.querySelector('#panelAlertDetail');
    if (opts.detail) { detailEl.textContent = opts.detail; detailEl.style.display = ''; }
    else { detailEl.textContent = ''; detailEl.style.display = 'none'; }
    var okBtn = bd.querySelector('#panelAlertOk');
    var closeBtn = bd.querySelector('#panelAlertClose');
    function close() { window.Popup.close(bd); }
    function settle() {
      okBtn.onclick = null;
      closeBtn.onclick = null;
      close();
      if (typeof opts.onClose === 'function') opts.onClose();
    }
    okBtn.onclick = settle;
    closeBtn.onclick = settle;
    window.Popup.open(bd);
  }

  window._injectCustomCSS = function (type) {
    var id = 'esi-custom-' + type + '-style';
    var css = localStorage.getItem('esi_custom_' + type + '_css');
    var current = document.getElementById(id);
    if (!css) {
      if (current) current.remove();
      return;
    }
    var attr = type === 'theme' ? 'data-theme' : 'data-font';
    css = String(css).replace(
      new RegExp('\\[' + attr + '="custom"\\]', 'g'),
      'html[' + attr + '="custom"]'
    );
    if (!current) {
      current = document.createElement('style');
      current.id = id;
    }
    current.textContent = css;
    document.head.appendChild(current);
  };

  window._removeCustomCSS = function (type) {
    var current = document.getElementById('esi-custom-' + type + '-style');
    if (current) current.remove();
  };

  window.setTheme = function (name) {
    var next = String(name || '').trim();
    if (next) localStorage.setItem('theme', next);
    else localStorage.removeItem('theme');
    if (next) document.documentElement.setAttribute('data-theme', next);
    else document.documentElement.removeAttribute('data-theme');
    if (next === 'custom') window._injectCustomCSS('theme');
    else window._removeCustomCSS('theme');
    if (window.ThemeConfig && typeof window.ThemeConfig.ensureBuiltInThemeStylesLoaded === 'function') {
      window.ThemeConfig.ensureBuiltInThemeStylesLoaded();
    }
    window.dispatchEvent(new Event('themechange'));
  };

  window.setFont = function (name) {
    var next = String(name || '').trim();
    if (next) localStorage.setItem('font', next);
    else localStorage.removeItem('font');
    if (next) document.documentElement.setAttribute('data-font', next);
    else document.documentElement.removeAttribute('data-font');
    if (next === 'custom') window._injectCustomCSS('font');
    else window._removeCustomCSS('font');
    if (window.FontConfig && typeof window.FontConfig.ensureBuiltInFontStylesLoaded === 'function') {
      window.FontConfig.ensureBuiltInFontStylesLoaded();
    }
  };

  function syncCustomOption(type) {
    var isTheme = type === 'theme';
    var select = document.getElementById(isTheme ? 'settingTheme' : 'settingFont');
    var addBtn = document.getElementById(isTheme ? 'addCustomThemeBtn' : 'addCustomFontBtn');
    var removeBtn = document.getElementById(isTheme ? 'removeCustomThemeBtn' : 'removeCustomFontBtn');
    var css = localStorage.getItem('esi_custom_' + type + '_css');
    var name = localStorage.getItem('esi_custom_' + type + '_name');
    var option = select.querySelector('option[value="custom"]');
    if (css && name) {
      if (!option) {
        option = document.createElement('option');
        option.value = 'custom';
        select.appendChild(option);
      }
      option.textContent = name;
      addBtn.textContent = name;
      removeBtn.style.display = '';
    } else {
      if (option) option.remove();
      addBtn.textContent = '+ Add Custom';
      removeBtn.style.display = 'none';
    }
  }

  function populateAppearanceSelects() {
    var themeSelect = document.getElementById('settingTheme');
    var fontSelect = document.getElementById('settingFont');
    themeSelect.innerHTML = '<option value="">Default</option>';
    fontSelect.innerHTML = '<option value="">Cinzel &amp; Crimson Pro</option>';
    var themes = window.ThemeConfig && window.ThemeConfig.getBuiltInThemes
      ? window.ThemeConfig.getBuiltInThemes() : [];
    var fonts = window.FontConfig && window.FontConfig.getBuiltInFonts
      ? window.FontConfig.getBuiltInFonts() : [];
    (themes || []).forEach(function (entry) {
      var option = document.createElement('option');
      option.value = entry.value;
      option.textContent = entry.label || entry.value;
      themeSelect.appendChild(option);
    });
    (fonts || []).forEach(function (entry) {
      var option = document.createElement('option');
      option.value = entry.value;
      option.textContent = entry.label || entry.value;
      fontSelect.appendChild(option);
    });
    syncCustomOption('theme');
    syncCustomOption('font');
    themeSelect.value = localStorage.getItem('theme') || '';
    fontSelect.value = localStorage.getItem('font') || '';
  }

  function handleCustomCss(type, file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.css') || file.size > 512 * 1024) {
      showAlert('Please choose a .css file no larger than 512 KB.');
      return;
    }
    var reader = new FileReader();
    reader.onload = function (event) {
      var cssText = String(event.target.result || '');
      var isTheme = type === 'theme';
      var looksValid = isTheme
        ? (/\[data-theme=/.test(cssText) || (cssText.match(/--[\w-]+\s*:/g) || []).length >= 3)
        : (/\[data-font=/.test(cssText) || /@font-face/i.test(cssText) || /font-family\s*:/i.test(cssText));
      if (!looksValid) {
        showAlert('That file does not look like a valid custom ' + type + ' CSS file.');
        return;
      }
      if (/url\(\s*(['"]?)(?!(?:https?:|data:|\/))/.test(cssText)) {
        showAlert('This CSS references local companion files. Upload its zip bundle through the main dashboard Settings instead; it will automatically appear here.');
        return;
      }
      var attrRe = isTheme ? /data-theme="([^"]+)"/ : /data-font="([^"]+)"/;
      var nameMatch = cssText.match(attrRe);
      var rawName = nameMatch ? nameMatch[1] : file.name.replace(/\.css$/i, '');
      var displayName = rawName
        .replace(/[^a-zA-Z0-9 \-_.]/g, '')
        .replace(/[-_]/g, ' ')
        .trim()
        .replace(/\b\w/g, function (ch) { return ch.toUpperCase(); }) || 'Custom';
      var selectorRe = isTheme ? /\[data-theme="[^"]*"\]/g : /\[data-font="[^"]*"\]/g;
      var customSelector = isTheme ? '[data-theme="custom"]' : '[data-font="custom"]';
      cssText = cssText.replace(selectorRe, customSelector);
      localStorage.setItem('esi_custom_' + type + '_css', cssText);
      localStorage.setItem('esi_custom_' + type + '_name', displayName);
      syncCustomOption(type);
      if (isTheme) window.setTheme('custom');
      else window.setFont('custom');
      document.getElementById(isTheme ? 'settingTheme' : 'settingFont').value = 'custom';
    };
    reader.readAsText(file);
  }

  function removeCustomCss(type) {
    localStorage.removeItem('esi_custom_' + type + '_css');
    localStorage.removeItem('esi_custom_' + type + '_name');
    if (type === 'theme') window.setTheme('');
    else window.setFont('');
    syncCustomOption(type);
    document.getElementById(type === 'theme' ? 'settingTheme' : 'settingFont').value = '';
  }

  function wireSettingsModal() {
    var backdrop = document.getElementById('settingsModalBackdrop');
    window.Popup.register(backdrop, {
      closeBtn: document.getElementById('settingsModalClose'),
    });
    document.getElementById('settingsBtn').addEventListener('click', function () {
      var waits = [];
      if (window.ThemeConfig && window.ThemeConfig.whenReady) waits.push(window.ThemeConfig.whenReady());
      if (window.FontConfig && window.FontConfig.whenReady) waits.push(window.FontConfig.whenReady());
      Promise.all(waits).catch(function () {}).then(function () {
        populateAppearanceSelects();
        window.Popup.open(backdrop);
      });
    });
    document.getElementById('settingTheme').addEventListener('change', function () {
      window.setTheme(this.value || '');
      renderLoginButton();
    });
    document.getElementById('settingFont').addEventListener('change', function () {
      window.setFont(this.value || '');
      syncNavbarCenterVisibility();
    });

    var themeInput = document.getElementById('customThemeFileInput');
    var fontInput = document.getElementById('customFontFileInput');
    document.getElementById('addCustomThemeBtn').addEventListener('click', function () { themeInput.click(); });
    document.getElementById('addCustomFontBtn').addEventListener('click', function () { fontInput.click(); });
    themeInput.addEventListener('change', function () {
      handleCustomCss('theme', this.files && this.files[0]);
      this.value = '';
    });
    fontInput.addEventListener('change', function () {
      handleCustomCss('font', this.files && this.files[0]);
      this.value = '';
    });
    document.getElementById('removeCustomThemeBtn').addEventListener('click', function () { removeCustomCss('theme'); });
    document.getElementById('removeCustomFontBtn').addEventListener('click', function () { removeCustomCss('font'); });
  }

  function serviceBodyTemplate() {
    return (
      '<div class="stat-strip" data-stat-strip></div>' +
      '<div class="service-actions" data-actions></div>' +
      '<div class="service-columns">' +
        '<div class="console-card">' +
          '<div class="console-head">' +
            '<div class="console-tabs" data-tabs>' +
              '<button type="button" class="console-tab active" data-tab="output">Output</button>' +
              '<button type="button" class="console-tab" data-tab="errors">Errors <span class="tab-count" data-count="errors">0</span></button>' +
              '<button type="button" class="console-tab" data-tab="access" data-access-tab>Access Log <span class="tab-count" data-count="access">0</span></button>' +
            '</div>' +
            '<div class="console-tools">' +
              '<input type="text" class="console-search" data-search placeholder="filter logs\u2026">' +
              '<label class="console-autoscroll settings-toggle">' +
                '<input type="checkbox" data-autoscroll checked aria-label="Autoscroll">' +
                '<span class="settings-toggle-track" aria-hidden="true"><span class="settings-toggle-thumb"></span></span>' +
                '<span class="console-autoscroll-label">autoscroll</span>' +
              '</label>' +
              '<button type="button" class="console-icon-btn" data-refresh title="Refresh logs">\u27f3</button>' +
              '<button type="button" class="console-icon-btn" data-download title="Download full log">\u2b07</button>' +
            '</div>' +
          '</div>' +
          '<pre class="console-body" data-console>Loading logs\u2026</pre>' +
          '<div class="console-foot"><span data-line-count></span><span data-last-update></span></div>' +
        '</div>' +
        '<div class="service-sidebar">' +
          '<div class="side-card">' +
            '<div class="side-title">Process</div>' +
            '<div class="kv-list" data-process-info></div>' +
          '</div>' +
          '<div class="side-card">' +
            '<div class="side-title">Resource Trend</div>' +
            '<svg class="spark" viewBox="0 0 260 44" preserveAspectRatio="none" data-spark></svg>' +
            '<div class="spark-legend"><span class="leg-cpu">\u2014 CPU</span><span class="leg-mem">\u2014 Memory</span></div>' +
          '</div>' +
          '<div class="side-card">' +
            '<div class="side-title">Quick Actions</div>' +
            '<button type="button" class="qa-item" data-qa="download">Download full log <span class="arrow">\u2192</span></button>' +
            '<button type="button" class="qa-item" data-qa="copy-attach">Copy attach command <span class="arrow">\u2192</span></button>' +
          '</div>' +
          '<div class="side-card">' +
            '<div class="side-title">Recent Events</div>' +
            '<div class="events-list" data-events>No events yet.</div>' +
          '</div>' +
        '</div>' +
      '</div>'
    );
  }

  function statTile(label, value, sub) {
    return '<div class="stat-tile"><div class="stat-tile-label">' + label + '</div>' +
      '<div class="stat-tile-value">' + value + '</div>' +
      (sub ? '<div class="stat-tile-sub">' + sub + '</div>' : '') + '</div>';
  }

  function renderStatStrip(body, svc) {
    var strip = body.querySelector('[data-stat-strip]');
    var tiles = [];
    tiles.push(
      '<div class="stat-tile">' +
        '<div class="stat-tile-label">Status</div>' +
        '<div class="stat-tile-value ' + (svc.running ? 'is-running' : 'is-stopped') + '">' +
          '<span class="status-dot ' + (svc.running ? 'running' : 'stopped') + '"></span>' +
          (svc.running ? 'Running' : 'Stopped') +
        '</div>' +
        '<div class="stat-tile-sub">' + (svc.running && svc.uptime_seconds != null ? 'up ' + fmtUptime(svc.uptime_seconds) : '\u2014') + '</div>' +
      '</div>'
    );
    tiles.push(statTile('Memory', svc.running && svc.memory_mb != null ? svc.memory_mb + ' <small>MB</small>' : '\u2014', 'process tree total'));
    tiles.push(statTile('CPU', svc.running && svc.cpu_percent != null ? svc.cpu_percent + ' <small>%</small>' : '\u2014', 'lifetime avg'));
    if (svc.kind === 'website') {
      tiles.push(statTile('Request Rate', svc.running && svc.request_rate != null ? svc.request_rate + ' <small>/min</small>' : '\u2014', 'last 5 min'));
    }
    strip.innerHTML = tiles.join('');
  }

  function renderActions(body, svc) {
    var actions = body.querySelector('[data-actions]');
    actions.innerHTML = '';
    function addAction(label, cls, action, confirmation) {
      var btn = el('button', cls, label);
      btn.addEventListener('click', function () {
        if (confirmation) {
          showConfirm({
            title: confirmation.replace('{label}', svc.label),
            confirmLabel: label,
            danger: cls === 'btn-danger',
            onConfirm: function () { runServiceAction(svc.key, action, body); },
          });
          return;
        }
        runServiceAction(svc.key, action, body);
      });
      actions.appendChild(btn);
    }
    addAction('Start', 'btn-primary', 'start');
    addAction('Restart', 'btn-secondary', 'restart', 'Restart {label}?');
    addAction('Stop', 'btn-danger', 'stop', 'Stop {label}?');
  }

  function fmtDateTime(epochSeconds) {
    if (epochSeconds == null) return '\u2014';
    var d = new Date(epochSeconds * 1000);
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function kvRow(k, v) {
    return '<div class="kv"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
  }

  function renderProcessInfo(body, svc) {
    var box = body.querySelector('[data-process-info]');
    var rows = [];
    rows.push(kvRow('PID', svc.running && svc.pid ? svc.pid : '\u2014'));
    rows.push(kvRow('Screen session', svc.screen || '\u2014'));
    rows.push(kvRow('Bind', svc.port ? '127.0.0.1:' + svc.port : '\u2014'));
    rows.push(kvRow('Command', svc.command || '\u2014'));
    rows.push(kvRow('Started', svc.running ? fmtDateTime(svc.started_at) : '\u2014'));
    box.innerHTML = rows.join('');
  }

  function renderSparkline(body, svc) {
    var svg = body.querySelector('[data-spark]');
    var hist = svc.history || [];
    if (hist.length < 2) {
      svg.innerHTML = '';
      return;
    }
    var w = 260, h = 44, n = hist.length;
    var maxCpu = Math.max(10, Math.max.apply(null, hist.map(function (s) { return s.cpu || 0; })));
    var maxMem = Math.max(10, Math.max.apply(null, hist.map(function (s) { return s.mem_mb || 0; })));
    function points(key, max) {
      return hist.map(function (s, i) {
        var x = (i / (n - 1)) * w;
        var y = h - (Math.min(s[key] || 0, max) / max) * (h - 4) - 2;
        return x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');
    }
    svg.innerHTML =
      '<polyline fill="none" stroke="var(--gold-dim)" stroke-width="1.5" points="' + points('cpu', maxCpu) + '"/>' +
      '<polyline fill="none" stroke="var(--online)" stroke-width="1.5" opacity="0.85" points="' + points('mem_mb', maxMem) + '"/>';
  }

  function updateServicePanel(svc) {
    _serviceStatus[svc.key] = svc;
    var panel = document.getElementById('panel-' + svc.key);
    if (!panel) return;
    var body = panel.querySelector('[data-service-body]');
    renderStatStrip(body, svc);
    renderActions(body, svc);
    renderProcessInfo(body, svc);
    renderSparkline(body, svc);
    var accessTab = body.querySelector('[data-access-tab]');
    if (accessTab) accessTab.style.display = svc.kind === 'website' ? '' : 'none';
  }

  function runServiceAction(key, action, body) {
    var buttons = body.querySelectorAll('button');
    buttons.forEach(function (b) { b.disabled = true; });
    fetch('/panel/api/services/' + encodeURIComponent(key) + '/' + action, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': csrfToken || '' },
    })
      .then(function (response) {
        if (response.status === 429) {
          showAlert('Rate limited: too many ' + action + ' requests. Wait a moment and try again.');
          return null;
        }
        return response.json().catch(function () { return null; }).then(function (data) {
          if (!response.ok || !data || data.ok === false) {
            var detail = data && (data.error || data.stderr || data.stdout);
            showAlert({
              title: 'Failed to ' + action + ' ' + key,
              message: detail ? '' : 'Unknown error.',
              detail: detail || null,
            });
          }
          return data;
        });
      })
      .catch(function () {
        showAlert('Failed to ' + action + ' ' + key + ': request error.');
      })
      .finally(function () {
        buttons.forEach(function (b) { b.disabled = false; });
        loadServices();
      });
  }

  function categorizeLines(text) {
    var raw = String(text || '');
    if (!raw) return { output: [], errors: [], access: [] };
    var lines = raw.split('\n');
    var output = [], errors = [], access = [];
    lines.forEach(function (line) {
      if (_ACCESS_LINE_RE.test(line)) access.push(line);
      else output.push(line);
      if (_ERROR_LINE_RE.test(line)) errors.push(line);
    });
    return { output: output, errors: errors, access: access };
  }

  function renderConsole(key) {
    var panel = document.getElementById('panel-' + key);
    if (!panel) return;
    var body = panel.querySelector('[data-service-body]');
    var pre = body.querySelector('[data-console]');
    var tab = _consoleTab[key] || 'output';
    var cats = categorizeLines(_logRaw[key] || '');
    var lines = cats[tab] || [];
    var query = (body.querySelector('[data-search]').value || '').toLowerCase();
    if (query) lines = lines.filter(function (l) { return l.toLowerCase().indexOf(query) !== -1; });

    var errCount = body.querySelector('[data-count="errors"]');
    var accCount = body.querySelector('[data-count="access"]');
    if (errCount) errCount.textContent = cats.errors.length;
    if (accCount) accCount.textContent = cats.access.length;

    pre.textContent = lines.length ? lines.join('\n') : '(no matching lines)';
    var lineCountEl = body.querySelector('[data-line-count]');
    if (lineCountEl) lineCountEl.textContent = lines.length + ' lines';

    var autoscroll = body.querySelector('[data-autoscroll]');
    if (autoscroll && autoscroll.checked) pre.scrollTop = pre.scrollHeight;
  }

  function fetchLogs(key) {
    if (!currentUser || accessLevel !== 'owner') return;
    var panel = document.getElementById('panel-' + key);
    if (!panel) return;
    var body = panel.querySelector('[data-service-body]');
    if (!body) return;
    var refreshBtn = body.querySelector('[data-refresh]');
    if (refreshBtn) refreshBtn.disabled = true;
    fetch('/panel/api/services/' + encodeURIComponent(key) + '/logs', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-CSRF-Token': csrfToken || '' },
    })
      .then(function (response) {
        if (response.status === 429) {
          _logRaw[key] = '(rate limited - wait a moment, then click refresh)';
          renderConsole(key);
          return null;
        }
        if (!response.ok) {
          _logRaw[key] = '(failed to load logs - HTTP ' + response.status + ')';
          renderConsole(key);
          return null;
        }
        return response.json();
      })
      .then(function (data) {
        if (!data) return;
        _logRaw[key] = data.output || '(no output)';
        renderConsole(key);
        var lastUpdate = body.querySelector('[data-last-update]');
        if (lastUpdate) lastUpdate.textContent = 'updated ' + new Date().toLocaleTimeString();
      })
      .catch(function () {
        _logRaw[key] = '(failed to load logs - network error)';
        renderConsole(key);
      })
      .finally(function () {
        if (refreshBtn) refreshBtn.disabled = false;
      });
  }

  function fmtRelativeTime(epochSeconds) {
    var diff = Math.max(0, (Date.now() / 1000) - epochSeconds);
    if (diff < 60) return Math.floor(diff) + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function fetchEvents(key) {
    if (!currentUser || accessLevel !== 'owner') return;
    var panel = document.getElementById('panel-' + key);
    if (!panel) return;
    var list = panel.querySelector('[data-events]');
    if (!list) return;
    fetch('/panel/api/services/' + encodeURIComponent(key) + '/events', { credentials: 'same-origin' })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        var events = data.events || [];
        if (!events.length) {
          list.innerHTML = 'No events yet.';
          return;
        }
        list.innerHTML = events.map(function (ev) {
          var label = ev.action.charAt(0).toUpperCase() + ev.action.slice(1);
          return '<div class="event">' +
            '<div class="event-top"><span class="type">' + label + (ev.result !== 'ok' ? ' (failed)' : '') + '</span><span>' + fmtRelativeTime(ev.ts) + '</span></div>' +
            '<div class="event-meta">by ' + (ev.actor || 'unknown') + '</div>' +
          '</div>';
        }).join('');
      })
      .catch(function () {});
  }

  function downloadLog(key) {
    window.location.href = '/panel/api/services/' + encodeURIComponent(key) + '/download-log';
  }

  function wireServiceConsole(key) {
    var panel = document.getElementById('panel-' + key);
    if (!panel) return;
    var body = panel.querySelector('[data-service-body]');
    _consoleTab[key] = 'output';

    body.querySelectorAll('[data-tabs] .console-tab').forEach(function (tabBtn) {
      tabBtn.addEventListener('click', function () {
        body.querySelectorAll('[data-tabs] .console-tab').forEach(function (b) { b.classList.remove('active'); });
        tabBtn.classList.add('active');
        _consoleTab[key] = tabBtn.dataset.tab;
        renderConsole(key);
      });
    });
    body.querySelector('[data-search]').addEventListener('input', function () { renderConsole(key); });
    body.querySelector('[data-autoscroll]').addEventListener('change', function () { renderConsole(key); });
    body.querySelector('[data-refresh]').addEventListener('click', function () { fetchLogs(key); });
    body.querySelector('[data-download]').addEventListener('click', function () { downloadLog(key); });
    body.querySelector('[data-qa="download"]').addEventListener('click', function () { downloadLog(key); });
    body.querySelector('[data-qa="copy-attach"]').addEventListener('click', function (event) {
      var svc = _serviceStatus[key];
      var screenName = (svc && svc.screen) || key;
      var text = 'screen -r ' + screenName;
      var btn = event.currentTarget;
      var original = btn.firstChild.textContent;
      var copy = (navigator.clipboard && navigator.clipboard.writeText)
        ? navigator.clipboard.writeText(text)
        : Promise.reject();
      copy
        .then(function () { btn.firstChild.textContent = 'Copied: ' + text + ' '; })
        .catch(function () {
          showAlert({ title: 'Copy attach command', message: 'Clipboard access failed \u2014 copy this manually:', detail: text });
        })
        .finally(function () {
          setTimeout(function () { btn.firstChild.textContent = original; }, 2000);
        });
    });
  }

  function loadServices() {
    fetch('/panel/api/services', { credentials: 'same-origin' })
      .then(function (response) {
        if (response.status === 401 || response.status === 403) throw new Error('denied');
        return response.json();
      })
      .then(function (data) {
        (data.services || []).forEach(updateServicePanel);
      })
      .catch(function () {
        if (pollTimer) clearInterval(pollTimer);
      });
  }

  function initSession() {
    return fetch('/panel/auth/session', { credentials: 'same-origin' })
      .then(function (response) { return response.json(); })
      .then(function (data) {
        currentUser = data.loggedIn ? data.user : null;
        accessLevel = data.accessLevel || null;
        csrfToken = data.csrfToken || null;
        renderLoginButton();
        if (currentUser && accessLevel === 'owner') {
          loadServices();
          var initialPanelId = getInitialPanelId();
          if (initialPanelId !== 'scripts') {
            fetchLogs(initialPanelId);
            fetchEvents(initialPanelId);
          }
          fetchScriptsList();
          pollTimer = setInterval(loadServices, 15000);
        }
      })
      .catch(function () {
        currentUser = null;
        renderLoginButton();
      });
  }

  var _scriptsList = [];
  var _scriptsListLoaded = false;
  var _currentScriptKey = null;
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
    if (!currentUser || accessLevel !== 'owner') return;
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
  }

  function renderScriptDetail(data) {
    var detail = document.getElementById('scriptsDetailView');
    if (!detail) return;

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
    return { positionals: positionals, flags: flags };
  }

  function describeRunPreview(payload) {
    var parts = ['python3', (_scriptsList.filter(function (s) { return s.key === _currentScriptKey; })[0] || {}).label || _currentScriptKey];
    (payload.positionals || []).forEach(function (v) { if (v) parts.push(v); });
    (payload.flags || []).forEach(function (f) {
      parts.push(f.name);
      (f.values || []).forEach(function (v) { if (v) parts.push(v); });
    });
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
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken || '' },
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
      headers: { 'X-CSRF-Token': csrfToken || '' },
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

  function init() {
    buildShellRegistry();
    wireShell();
    wireAccountModal();
    wireSettingsModal();
    initSession();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
