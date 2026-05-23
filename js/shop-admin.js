(function () {
  'use strict';

  var panel = document.getElementById('panel-shop-admin');
  if (!panel) return;

  var _items = null;
  var _auctions = null;
  var _activeTab    = 'items';
  var _isChief      = false; // any shop admin (chief+ or parliament+)
  var _isParliament = false; // parliament+ only
  var _shellBuilt   = false;
  var _shopEnabled  = true;
  var _shopDisabledMessage = 'Coming soon';
  var _canToggleShopState = false;
  var _isParliamentFromState = false;

  var _svg = {
    check:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    close:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warn:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    clock:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    play:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
    grip:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>',
    minus:   '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    cart:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
    gavel:   '<svg width="13" height="13" viewBox="-2 0 19 19" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="M9.316 14.722a.477.477 0 0 1-.475.475H1.433a.477.477 0 0 1-.475-.475v-.863a.477.477 0 0 1 .475-.475h7.408a.476.476 0 0 1 .475.475zm-2.767-2.587a.552.552 0 0 1-.392-.163L2.96 8.776a.554.554 0 0 1 .784-.784L6.94 11.19a.554.554 0 0 1-.392.946zm7.33.992L9.435 8.682l1.085-1.084-3.173-3.173-2.97 2.97 3.173 3.172 1.102-1.101 4.445 4.445a.554.554 0 1 0 .784-.784zm-2.33-5.993a.552.552 0 0 1-.391-.162L7.96 3.775a.554.554 0 1 1 .784-.784l3.196 3.197a.554.554 0 0 1-.391.946z"/></svg>',
    gift:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>',
    pin:     '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>',
    dash:    '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    chevron: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>',
    gear:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(n) { return Number(n || 0).toLocaleString(); }

  function apiPost(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); });
  }

  function apiPut(url, body) {
    return fetch(url, {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); });
  }

  function apiDelete(url) {
    return fetch(url, { method: 'DELETE', credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); });
  }

  var _adminBannedDetected = false;

  function fetchShopState(cb) {
    fetch('/api/admin/shop/state', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 403) {
          return r.json().then(function (d) {
            if (d && d.error && d.error.indexOf('banned') !== -1) {
              _adminBannedDetected = true;
            }
            return null;
          });
        }
        return r.ok ? r.json() : null;
      })
      .then(function (d) {
        if (_adminBannedDetected) { if (cb) cb(null); return; }
        if (d && typeof d.shop_enabled === 'boolean') _shopEnabled = !!d.shop_enabled;
        if (d && typeof d.message === 'string' && d.message.trim()) _shopDisabledMessage = d.message.trim();
        _canToggleShopState = !!(d && d.can_toggle);
        _isParliamentFromState = !!(d && d.is_parliament);
        if (cb) cb(d);
      })
      .catch(function () { if (cb) cb(null); });
  }

  function setShopState(enabled) {
    return apiPost('/api/admin/shop/state', { shop_enabled: !!enabled });
  }

  function _isOwnerShopAdmin() {
    return !!_canToggleShopState;
  }

  function _canChiefEditShopAdmin() {
    return (_isChief || _isOwnerShopAdmin()) && (_shopEnabled || _isOwnerShopAdmin() || _isParliamentFromState);
  }

  function _canParliamentEditShopAdmin() {
    return (_isParliament || _isOwnerShopAdmin()) && (_shopEnabled || _isOwnerShopAdmin() || _isParliamentFromState);
  }

  function _disabledMessageLabel() {
    var msg = String(_shopDisabledMessage || '').trim();
    return msg || 'Coming soon';
  }

  // Notify the shop page that item data changed so it can refresh without a reload
  function _notifyShopUpdated() {
    window.dispatchEvent(new CustomEvent('shop:items-updated'));
  }

  /* Shell */
  function buildShell() {
    if (_shellBuilt) return;
    _shellBuilt = true;
    _isChief      = window.hasShopAdmin      ? window.hasShopAdmin()      : false;
    _isParliament = window.hasParliamentPlus ? window.hasParliamentPlus() : false;

    panel.innerHTML =
      '<div class=\"sa-state-banner\" id=\"saStateBanner\"></div>' +
      '<div class="shop-tabs" id="saTabs">' +
        '<button class="shop-tab active" data-tab="items">Items</button>' +
        '<button class="shop-tab" data-tab="queue">Queue</button>' +
        '<button class="shop-tab" data-tab="logs">Logs</button>' +
        '<button class="shop-tab" data-tab="users">Users</button>' +
      '</div>' +
      '<div id="saContent"></div>' +
      '<div class="shop-modal-backdrop" id="saModalBackdrop">' +
        '<div class="shop-modal" id="saModal"></div>' +
      '</div>' +
      '<div class="shop-modal-backdrop sa-overlay-backdrop" id="saOverlayBackdrop">' +
        '<div class="shop-modal sa-overlay-modal" id="saOverlay"></div>' +
      '</div>';

    document.getElementById('saTabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.shop-tab');
      if (!btn) return;
      var tab = btn.dataset.tab;
      if (tab === _activeTab) return;
      _activeTab = tab;
      document.querySelectorAll('#saTabs .shop-tab').forEach(function (t) { t.classList.remove('active'); });
      btn.classList.add('active');
      renderTab();
    });

    document.getElementById('saModalBackdrop').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });
    document.getElementById('saModal').addEventListener('click', function (e) {
      if (e.target.closest('.modal-close')) {
        this.classList.remove('ie-modal');
        closeModal();
      }
    });
  }

  function closeModal() { document.getElementById('saModalBackdrop').classList.remove('open'); }

  function _clearQueueBadges() {
    var queueBtn = document.querySelector('#saTabs [data-tab=\"queue\"]');
    if (queueBtn) {
      var qBadge = queueBtn.querySelector('.sa-badge');
      if (qBadge) qBadge.remove();
    }
    var navItem = document.querySelector('[data-panel=\"shop-admin\"]');
    if (navItem) {
      var navBadge = navItem.querySelector('.nav-upcoming-badge');
      if (navBadge) navBadge.remove();
      navItem.removeAttribute('title');
    }
  }

  function renderShopStateBanner() {
    var banner = document.getElementById('saStateBanner');
    if (!banner) return;
    var isOn = _shopEnabled !== false;
    if (isOn && !_canToggleShopState) {
      banner.style.display = 'none';
      banner.innerHTML = '';
      return;
    }
    banner.style.display = '';
    var statusText = isOn ? 'Shop ON' : 'Shop OFF';
    var disabledModeLabel = _disabledMessageLabel() + ' mode';
    var helper = isOn
      ? 'Live mode: users can access the shop.'
      : (_canToggleShopState
          ? disabledModeLabel + ': tabs stay available. You can still edit as OWNER.'
          : (_isParliamentFromState
              ? disabledModeLabel + ': tabs stay available. You can still edit as Parliament.'
              : disabledModeLabel + ': tabs stay available in read-only mode. Only OWNER and Parliament can edit.'));
    banner.innerHTML =
      '<div class=\"sa-state-meta\">' +
        '<span class=\"sa-state-pill ' + (isOn ? 'sa-state-pill--on' : 'sa-state-pill--off') + '\">' + statusText + '</span>' +
        '<span class=\"sa-state-text\">' + helper + '</span>' +
      '</div>' +
      (_canToggleShopState
        ? '<button class=\"shop-modal-btn shop-modal-btn--confirm sa-state-toggle\" id=\"saToggleShopState\">' +
            (isOn ? 'Turn shop off' : 'Turn shop on') +
          '</button>'
        : '');
    var toggleBtn = document.getElementById('saToggleShopState');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', function () {
        var target = !_shopEnabled;
        toggleBtn.disabled = true;
        toggleBtn.textContent = 'Saving\u2026';
        setShopState(target)
          .then(function (res) {
            if (res.ok && res.data && res.data.ok) {
              _shopEnabled = !!res.data.shop_enabled;
              if (typeof res.data.message === 'string' && res.data.message.trim()) {
                _shopDisabledMessage = res.data.message.trim();
              }
              _items = null; _auctions = null; _queueData = null; _logsData = null; _logsFeed = null;
              _changesData = null; _users = null; _usersOpenUuid = null;
              renderShopStateBanner();
              if (_shopEnabled) {
                fetchQueue(function () { updateQueueBadge(); renderTab(); });
              } else {
                _clearQueueBadges();
                renderTab();
              }
              _notifyShopUpdated();
              showToast('\u2713 Shop turned ' + (_shopEnabled ? 'on' : 'off') + '.', 'success');
            } else {
              showToast('\u26a0 ' + ((res.data && res.data.error) || 'Failed to update shop state'), 'warn');
              renderShopStateBanner();
            }
          })
          .catch(function () {
            showToast('\u26a0 Network error', 'warn');
            renderShopStateBanner();
          });
      });
    }
  }

  function renderComingSoonTab(c) {
    var titleMap = { items: 'Items', queue: 'Queue', logs: 'Logs', users: 'Users' };
    c.innerHTML =
      '<div class=\"shop-empty sa-coming-soon-tab\">' +
        '<div class=\"sa-coming-soon-title\">' + titleMap[_activeTab] + '</div>' +
        '<div>' + esc(_disabledMessageLabel()) + '</div>' +
      '</div>';
  }

  function renderTab() {
    var c = document.getElementById('saContent');
    if (_activeTab === 'items') renderItems(c);
    else if (_activeTab === 'queue') renderQueue(c);
    else if (_activeTab === 'logs') renderLogs(c);
    else if (_activeTab === 'users') renderUsers(c);
  }

  function fmtDate(iso) {
    if (!iso) return 'N/A';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  /* Item Management */
  function fetchItems(cb) {
    fetch('/api/admin/shop/items', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data) _items = data; if (cb) cb(data); })
      .catch(function () { if (cb) cb(null); });
  }

  function fetchAuctions(cb) {
    fetch('/api/shop/auctions', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { _auctions = (data && data.auctions) || []; if (cb) cb(); })
      .catch(function () { _auctions = []; if (cb) cb(); });
  }

  function renderItems(c) {
    c.innerHTML = '<div class="shop-loading"><span class="loading-spinner"></span> Loading items\u2026</div>';
    var done = 0;
    function check() {
      if (++done >= 2) {
        if (_activeTab !== 'items') return;
        if (!_items) { c.innerHTML = '<div class="shop-empty">Could not load items.</div>'; return; }
        renderItemsTable(c);
      }
    }
    if (!_items) fetchItems(check); else { done++; check(); }
    fetchAuctions(check);
  }

  function renderItemsTable(c) {
    var html = '';
    var canChiefEdit = _canChiefEditShopAdmin();
    var canParliamentEdit = _canParliamentEditShopAdmin();
    if (canParliamentEdit) {
      html += '<div style="display:flex;justify-content:flex-end;margin-bottom:12px;">' +
        '<button class="shop-modal-btn shop-modal-btn--confirm" id="saNewItem">+ New Item</button>' +
        '</div>';
    }
    var _binItems = (_items || []).filter(function (it) { return it.type !== 'auction'; });
    var _aucItems = (_items || []).filter(function (it) { return it.type === 'auction'; });

    html += '<div class=\"sa-table ie-item-table' + (canParliamentEdit ? '' : ' ie-item-table--ro') + '\" id=\"saItemTable\">';
    html += '<div class="sa-row sa-header ie-row-cols">' +
      '<span></span><span>Name</span><span>ID</span><span>Type</span><span>Category</span>' +
      '<span>Active</span><span>Stock</span>' +
      (canParliamentEdit ? '<span>Controls</span>' : '') +
      '</div>';

    function _renderItemRow(item, skipAuctionControls) {
      var isActive = item.active !== false;
      var rowClass = 'sa-row' + (!isActive ? ' sa-row--inactive' : '');

      html += '<div class=\"' + rowClass + '\" data-item-id=\"' + esc(item.id) + '\"' + (canParliamentEdit ? ' draggable=\"true\"' : '') + '>';
      html += '<span class=\"sa-grip\"' + (canParliamentEdit ? ' title=\"Drag to reorder\"' : ' style=\"opacity:0.2;cursor:default\"') + '>' + _svg.grip + '</span>';
      html += '<span class="sa-item-name">' + esc(item.name) + '</span>';
      html += '<span class="sa-item-id">' + esc(item.id) + '</span>';
      var _typePill = item.type === 'auction'
        ? '<span class="sa-pill sa-pill--auction">Auction</span>'
        : item.type === 'donate'
        ? '<span class="sa-pill sa-pill--donate">Donation</span>'
        : '<span class="sa-pill sa-pill--bin">Bin</span>';
      html += '<span>' + _typePill + '</span>';
      var cats = Array.isArray(item.category) ? item.category : (item.category ? [item.category] : []);
      html += '<span>' + (cats.length
        ? cats.map(function (c) { return '<span class="sa-pill sa-pill--cat">' + esc(c) + '</span>'; }).join(' ')
        : '<span style="color:var(--text-faint)">N/A</span>') + '</span>';

      // active toggle
      if (skipAuctionControls && item.type === 'auction') {
        var _hasLive = (_auctions || []).some(function (a) { return a.item_id === item.id && a.status === 'active'; });
        if (_hasLive) {
          html += '<span><span class="sa-pill sa-pill--live">Live</span></span>';
        } else if (canParliamentEdit) {
          html += '<span><button class="sa-action-btn" data-start-auction="' + esc(item.id) + '">Start</button></span>';
        } else {
          html += '<span><span class="sa-pill" style="color:var(--text-faint);border-color:var(--border)">Not live</span></span>';
        }
      } else if (canChiefEdit) {
        html += '<span><label class="settings-toggle" data-toggle-id="' + esc(item.id) + '">' +
          '<input type="checkbox"' + (isActive ? ' checked' : '') + ' />' +
          '<span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>' +
          '</label></span>';
      } else {
        html += '<span class="' + (isActive ? 'sa-status-on' : 'sa-status-off') + '">' + (isActive ? 'Active' : 'Inactive') + '</span>';
      }

      // stock (not applicable for auctions)
      if (item.type === 'auction') {
        html += '<span style="color:var(--text-faint)">N/A</span>';
      } else {
        var _sv = Array.isArray(item.variants) ? item.variants : [];
        var _isMulti = _sv.length > 1;
        var _effStock = item.stock;
        if (_isMulti) {
          var _hasInf = false, _sum = 0;
          for (var _vi = 0; _vi < _sv.length; _vi++) {
            if (_sv[_vi].stock == null) { _hasInf = true; break; }
            _sum += _sv[_vi].stock;
          }
          _effStock = _hasInf ? null : _sum;
        }
        if (canChiefEdit) {
          var stockVal = _effStock != null ? _effStock : '';
          if (_isMulti) {
            html += '<span><input type="number" class="sa-stock-input" value="' + esc(stockVal) + '" placeholder="\u221E" disabled title="Total from all variants" /></span>';
          } else {
            html += '<span><input type="number" min="0" max="99999" class="sa-stock-input" data-stock-id="' + esc(item.id) + '" value="' + esc(stockVal) + '" placeholder="\u221E" /></span>';
          }
        } else {
          html += '<span>' + (_effStock != null ? num(_effStock) : '\u221E') + '</span>';
        }
      }

      // controls: auction actions + edit + delete
      if (canParliamentEdit) {
      html += '<span class="sa-actions-cell">';
      if (item.type === 'auction' && !skipAuctionControls) {
        var activeAuction = (_auctions || []).find(function (a) { return a.item_id === item.id && a.status === 'active'; });
        if (activeAuction) {
          html += '<button class="sa-action-btn sa-pill sa-pill--auction" data-manage-auction="' + esc(activeAuction.auction_id) + '">Manage</button>';
        } else {
          html += '<button class="sa-action-btn" data-start-auction="' + esc(item.id) + '">Start</button>';
        }
      }
        html += '<button class="sa-action-btn ie-edit-btn" data-edit-item="' + esc(item.id) + '">Edit</button>';
        html += '<button class="sa-action-btn sa-action-btn--danger" data-del-item="' + esc(item.id) + '">Delete</button>';
      html += '</span>';
      }
      html += '</div>';
    }

    // Top section: bin/donate items + live auction rows (in JSON order)
    var _liveAucMap = {};
    (_auctions || []).forEach(function (a) { if (a.status === 'active') _liveAucMap[a.item_id] = a; });

    (_items || []).forEach(function (item) {
      if (item.type !== 'auction') {
        _renderItemRow(item);
      } else if (_liveAucMap[item.id]) {
        var auc = _liveAucMap[item.id];
        var isActive = item.active !== false;
        html += '<div class=\"sa-row sa-row--live' + (!isActive ? ' sa-row--inactive' : '') + '\" data-item-id=\"' + esc(item.id) + '\"' + (canParliamentEdit ? ' draggable=\"true\"' : '') + '>';
        html += '<span class=\"sa-grip\"' + (canParliamentEdit ? ' title=\"Drag to reorder\"' : ' style=\"opacity:0.2;cursor:default\"') + '>' + _svg.grip + '</span>';
        html += '<span class="sa-item-name">' + esc(item.name) + '</span>';
        html += '<span class="sa-item-id">' + esc(item.id) + '</span>';
        html += '<span><span class="sa-pill sa-pill--auction">Auction</span></span>';
        var liveCats = Array.isArray(item.category) ? item.category : (item.category ? [item.category] : []);
        html += '<span>' + (liveCats.length
          ? liveCats.map(function (c) { return '<span class="sa-pill sa-pill--cat">' + esc(c) + '</span>'; }).join(' ')
          : '<span style="color:var(--text-faint)">N/A</span>') + '</span>';
        if (canChiefEdit) {
          html += '<span><label class="settings-toggle" data-toggle-id="' + esc(item.id) + '">' +
            '<input type="checkbox"' + (isActive ? ' checked' : '') + ' />' +
            '<span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>' +
            '</label></span>';
        } else {
          html += '<span class="' + (isActive ? 'sa-status-on' : 'sa-status-off') + '">' + (isActive ? 'Active' : 'Inactive') + '</span>';
        }
        html += '<span style="color:var(--text-faint)">N/A</span>';
        if (canParliamentEdit) {
          html += '<span class="sa-actions-cell">';
          html += '<button class="sa-action-btn sa-pill sa-pill--auction" data-manage-auction="' + esc(auc.auction_id) + '">Manage</button>';
          html += '</span>';
        } // end _isParliament controls
        html += '</div>';
      }
    });

    if (_aucItems.length) {
      html += '<div class="sa-section-divider"><span>Auctions</span></div>';
      _aucItems.forEach(function (item) { _renderItemRow(item, true); });
    }

    html += '</div>';
    c.innerHTML = html;

    // bind toggles
    c.querySelectorAll('[data-toggle-id]').forEach(function (label) {
      var checkbox = label.querySelector('input[type="checkbox"]');
      if (!checkbox) return;
      checkbox.addEventListener('change', function () {
        var id = label.dataset.toggleId;
        var newActive = checkbox.checked;
        checkbox.disabled = true;
        apiPost('/api/admin/shop/items/' + encodeURIComponent(id) + '/override', { active: newActive })
          .then(function (res) {
            if (res.ok) {
              var row = label.closest('.sa-row');
              if (row) row.classList.toggle('sa-row--inactive', !newActive);
              showToast('\u2713 ' + id + ' ' + (newActive ? 'activated' : 'deactivated'), 'success');
              var item = (_items || []).find(function (it) { return it.id === id; });
              if (item) item.active = newActive;
              _notifyShopUpdated();
            } else {
              showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn');
              checkbox.checked = !newActive; // revert
            }
          })
          .catch(function () { showToast('\u26a0 Network error', 'warn'); checkbox.checked = !newActive; })
          .finally(function () { checkbox.disabled = false; });
      });
    });

    // bind Manage auction buttons (opens modal)
    c.querySelectorAll('[data-manage-auction]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var aid = btn.dataset.manageAuction;
        _openAuctionManageModal(aid);
      });
    });

    // bind Start Auction buttons
    c.querySelectorAll('[data-start-auction]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var itemId = btn.dataset.startAuction;
        var item   = (_items || []).find(function (it) { return it.id === itemId; });
        var durText = item
          ? (item.duration_type === 'eoc_minus_2'
              ? 'End of Cycle \u2212 2 days'
              : (item.duration_hours || 48) + ' hours')
          : '48 hours';
        var modal = document.getElementById('saModal');
        modal.innerHTML =
          '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>' +
          '<div class="shop-modal-title">Start Auction</div>' +
          '<div class="shop-modal-body">Start a new auction for <strong>' + esc(itemId) + '</strong>?<br>' +
            '<span style="font-size:0.8rem;color:var(--text-faint)">Duration: ' + esc(durText) + '</span></div>' +
          '<div class="shop-modal-actions">' +
            '<button class="shop-modal-btn shop-modal-btn--confirm" id="saStartConfirm">Start Auction</button>' +
          '</div>';
        document.getElementById('saModalBackdrop').classList.add('open');
        document.getElementById('saStartConfirm').addEventListener('click', function () {
          var cfm = this; cfm.disabled = true; cfm.textContent = 'Starting\u2026';
          apiPost('/api/admin/shop/auctions/start', { item_id: itemId })
            .then(function (res) {
              if (res.ok && res.data.ok) {
                showToast('\u2713 Auction started for ' + itemId + '.', 'success');
                closeModal();
                _items = null; _auctions = [];
                renderItems(document.getElementById('saContent'));
                _notifyShopUpdated();
              } else {
                showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn');
                cfm.disabled = false; cfm.textContent = 'Start Auction';
              }
            })
            .catch(function () { showToast('\u26a0 Network error', 'warn'); cfm.disabled = false; cfm.textContent = 'Start Auction'; });
        });
      });
    });

    // bind New Item button
    var newBtn = document.getElementById('saNewItem');
    if (newBtn) newBtn.addEventListener('click', function () { openItemEditor(null, true); });

    // bind Edit buttons
    c.querySelectorAll('[data-edit-item]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.editItem;
        var item = (_items || []).find(function (it) { return it.id === id; });
        if (item) openItemEditor(item, false);
      });
    });

    // bind Delete buttons
    c.querySelectorAll('[data-del-item]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.delItem;
        var modal = document.getElementById('saModal');
        modal.innerHTML =
          '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>' +
          '<div class="shop-modal-title">Delete Item</div>' +
          '<div class="shop-modal-body">Permanently remove <strong>' + esc(id) + '</strong> from the catalogue? This cannot be undone.</div>' +
          '<div class="shop-modal-actions">' +
            '<button class="shop-modal-btn shop-modal-btn--cancel" id="saDelConfirm" style="color:var(--danger);border-color:var(--danger);">Delete</button>' +
          '</div>';
        document.getElementById('saModalBackdrop').classList.add('open');
        document.getElementById('saDelConfirm').addEventListener('click', function () {
          var cfm = this; cfm.disabled = true; cfm.textContent = 'Deleting\u2026';
          apiDelete('/api/admin/shop/items/' + encodeURIComponent(id))
            .then(function (res) {
              if (res.ok && res.data.ok) {
                showToast('\u2713 ' + id + ' deleted.', 'success');
                closeModal();
                _items = (_items || []).filter(function (it) { return it.id !== id; });
                var row = btn.closest('.sa-row');
                if (row) { row.style.opacity = '0.3'; row.style.pointerEvents = 'none'; }
                _notifyShopUpdated();
              } else {
                showToast('\u26a0 ' + (res.data.error || 'Delete failed'), 'warn');
                cfm.disabled = false; cfm.textContent = 'Delete';
              }
            })
            .catch(function () { showToast('\u26a0 Network error', 'warn'); cfm.disabled = false; cfm.textContent = 'Delete'; });
        });
      });
    });

    // bind drag-to-reorder on item rows
    (function () {
      if (!canParliamentEdit) return;
      var table = document.getElementById('saItemTable');
      if (!table) return;
      var dragRow = null;
      table.addEventListener('dragstart', function (e) {
        var row = e.target.closest('.sa-row[data-item-id]');
        if (!row) return;
        dragRow = row;
        row.classList.add('sa-row--dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.itemId);
      });
      table.addEventListener('dragend', function () {
        if (dragRow) dragRow.classList.remove('sa-row--dragging');
        table.querySelectorAll('.sa-row--over').forEach(function (r) { r.classList.remove('sa-row--over'); });
        dragRow = null;
      });
      function _sectionOf(row) {
        // Walk backwards from row; if we hit the divider first, it's auction section
        var prev = row.previousElementSibling;
        while (prev) {
          if (prev.classList.contains('sa-section-divider')) return 'auction';
          prev = prev.previousElementSibling;
        }
        return 'bin';
      }
      table.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        var target = e.target.closest('.sa-row[data-item-id]');
        table.querySelectorAll('.sa-row--over').forEach(function (r) { r.classList.remove('sa-row--over'); });
        if (target && target !== dragRow && _sectionOf(target) === _sectionOf(dragRow)) target.classList.add('sa-row--over');
      });
      table.addEventListener('drop', function (e) {
        e.preventDefault();
        var target = e.target.closest('.sa-row[data-item-id]');
        if (!target || !dragRow || target === dragRow) return;
        if (_sectionOf(target) !== _sectionOf(dragRow)) return;
        // Reorder in DOM
        var rows = Array.from(table.querySelectorAll('.sa-row[data-item-id]'));
        var fromIdx = rows.indexOf(dragRow);
        var toIdx = rows.indexOf(target);
        if (fromIdx < 0 || toIdx < 0) return;
        if (fromIdx < toIdx) target.after(dragRow);
        else target.before(dragRow);
        // Persist new order
        var _seen = {};
        var ordered = [];
        Array.from(table.querySelectorAll('.sa-row[data-item-id]')).forEach(function (r) {
          var id = r.dataset.itemId;
          if (!_seen[id]) { _seen[id] = true; ordered.push(id); }
        });
        apiPost('/api/admin/shop/items/reorder', { ordered_ids: ordered })
          .then(function (res) {
            if (res.ok && res.data.ok) {
              // Update local cache order
              var byId = {};
              (_items || []).forEach(function (it) { byId[it.id] = it; });
              _items = ordered.map(function (id) { return byId[id]; }).filter(Boolean);
              showToast('\u2713 Items reordered', 'success');
              _notifyShopUpdated();
            } else {
              showToast('\u26a0 ' + (res.data.error || 'Reorder failed'), 'warn');
              renderItemsTable(c); // re-render to restore original order
            }
          })
          .catch(function () { showToast('\u26a0 Network error', 'warn'); renderItemsTable(c); });
      });
    })();

    // bind stock inputs (save on blur)
    c.querySelectorAll('[data-stock-id]').forEach(function (input) {
      var lastVal = input.value;
      input.addEventListener('blur', function () {
        var id = input.dataset.stockId;
        var val = input.value.trim();
        if (val === lastVal) return;
        var stock = val === '' ? null : parseInt(val, 10);
        if (val !== '' && isNaN(stock)) { input.value = lastVal; return; }
        if (stock !== null && stock < 0) {
          showToast('\u26a0 Stock cannot be negative.', 'warn');
          input.value = lastVal; return;
        }
        if (stock !== null && stock > 99999) {
          showToast('\u26a0 Stock cannot exceed 99,999.', 'warn');
          input.value = lastVal; return;
        }
        input.disabled = true;
        apiPost('/api/admin/shop/items/' + encodeURIComponent(id) + '/override', { stock: stock })
          .then(function (res) {
            if (res.ok) {
              lastVal = val;
              showToast('\u2713 Stock updated for ' + id, 'success');
              var item = (_items || []).find(function (it) { return it.id === id; });
              if (item) {
                item.stock = stock;
                // Sync single-variant stock in local cache
                if (Array.isArray(item.variants) && item.variants.length === 1) {
                  item.variants[0].stock = stock;
                }
              }
              _notifyShopUpdated();
            } else {
              showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn');
              input.value = lastVal;
            }
          })
          .catch(function () { showToast('\u26a0 Network error', 'warn'); input.value = lastVal; })
          .finally(function () { input.disabled = false; });
      });
      input.addEventListener('focus', function () {
        var v = this.value; this.value = ''; this.value = v;
      });
      input.addEventListener('input', function () {
        // Strip anything that isn't a digit, then cap at 5 characters
        var clean = this.value.replace(/\D/g, '').slice(0, 5);
        if (this.value !== clean) this.value = clean;
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { input.blur(); return; }
        // Allow navigation / editing control keys
        var ctrl = ['Backspace','Delete','Tab','Escape','Home','End',
                    'ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];
        if (ctrl.indexOf(e.key) !== -1) return;
        if (e.ctrlKey || e.metaKey) return;  // allow Ctrl+A/C/V/X etc.
        // Block everything except single digits
        if (!/^\d$/.test(e.key)) e.preventDefault();
      });
    });
  }

  /* Auction Manage Modal */
  function _openAuctionManageModal(aid) {
    var modal = document.getElementById('saModal');
    var bd = document.getElementById('saModalBackdrop');
    modal.innerHTML = '<div class="shop-loading" style="padding:24px"><span class="loading-spinner"></span> Loading\u2026</div>';
    bd.classList.add('open');
    fetch('/api/admin/shop/auctions/' + encodeURIComponent(aid) + '/detail', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.ok) { modal.innerHTML = '<button class="modal-close" aria-label="Close">' + _svg.close + '</button><div class="shop-modal-body" style="color:var(--text-faint)">Could not load auction.</div>'; return; }
        _renderAuctionManageModal(modal, data);
      })
      .catch(function () { modal.innerHTML = '<button class="modal-close" aria-label="Close">' + _svg.close + '</button><div class="shop-modal-body" style="color:var(--text-faint)">Network error.</div>'; });
  }

  function _renderAuctionManageModal(modal, data) {
    var aid = data.auction_id;
    var _pendingHours = 0;
    var statusLabel = data.status === 'active' ? 'Live' : data.status === 'closed' ? 'Closed' : 'Cancelled';
    var statusClass = data.status === 'active' ? 'am-status--live' : 'am-status--closed';
    var antiSnipeMin = Math.round((data.anti_snipe_seconds || 0) / 60);

    // Compute clamp limits for the adjust stepper
    var endsMs = new Date(data.ends_at).getTime();
    var nowMs = Date.now();
    var remainingHours = Math.floor((endsMs - nowMs) / 3600000);

    var _minAdjust = (data.extended_hours || 0) - Math.max(0, remainingHours - 2);

    function render() {
      var h = '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>';

      // Title row with status badge
      h += '<div class="am-title-row">';
      h += '<div><div class="shop-modal-title" style="margin-bottom:2px">Manage auction</div>';
      h += '<div class="am-item-id">' + esc(data.item_id) + '</div></div>';
      h += '<span class="am-status ' + statusClass + '">' + _svg.play + ' ' + statusLabel + '</span>';
      h += '</div>';

      // Bid Activity
      h += '<div class="am-section">';
      h += '<div class="am-section-title">Bid Activity</div>';
      h += '<div class="am-metrics">';
      h += '<div class="am-metric"><span class="am-metric-val">' + num(data.current_highest_bid) + ' EP</span><span class="am-metric-label">Highest bid</span></div>';
      h += '<div class="am-metric"><span class="am-metric-val">' + data.bid_count + '</span><span class="am-metric-label">Total bids</span></div>';
      h += '<div class="am-metric"><span class="am-metric-val">' + data.bidder_count + '</span><span class="am-metric-label">Bidders</span></div>';
      h += '<div class="am-metric"><span class="am-metric-val">' + num(data.min_increment || 1) + ' EP</span><span class="am-metric-label">Min increment</span></div>';
      h += '</div>';
      h += '</div>';

      // Recent Bids
      h += '<div class="am-section">';
      h += '<div class="am-section-title">Recent Bids</div>';
      if (data.recent_bids && data.recent_bids.length) {
        h += '<div class="am-bids">';
        data.recent_bids.forEach(function (b) {
          h += '<div class="am-bid-row">';
          h += '<span class="am-bid-user">' + esc(b.username) + '</span>';
          h += '<span class="am-bid-amt">' + num(b.amount) + ' EP</span>';
          h += '<span class="am-bid-time">' + fmtDate(b.placed_at) + '</span>';
          h += '<span class="am-bid-actions">';
          if (b.is_winning) h += '<span class="am-bid-status am-bid-status--win">Winning</span> ';
          if (_canParliamentEditShopAdmin()) h += '<button class=\"am-bid-remove\" data-remove-bid=\"' + esc(b.bid_id) + '\" aria-label=\"Remove bid\">' + _svg.close + '</button>';
          h += '</span>';
          h += '</div>';
        });
        h += '</div>';
        h += '<div class="am-bid-total">' + data.bid_count + ' bid' + (data.bid_count !== 1 ? 's' : '') + ' total</div>';
      } else {
        h += '<div class="am-empty">No bids yet.</div>';
      }
      h += '</div>';

      // Timeline
      h += '<div class="am-section">';
      h += '<div class="am-section-title">Timeline</div>';
      h += '<div class="am-tl"><span class="am-tl-label">Started</span><span class="am-tl-val">' + fmtDate(data.created_at) + '</span></div>';
      h += '<div class="am-tl"><span class="am-tl-label">Ends</span><span class="am-tl-val">' + fmtDate(data.ends_at) + '</span>';
      if (data.extended) {
        var extH = data.extended_hours || 0;
        var extTxt = extH > 0 ? '+' + extH + 'h' : extH < 0 ? extH + 'h' : '';
        h += '<span class="sa-pill sa-pill--auction" style="font-size:0.72rem;margin-left:8px">Extended' + (extTxt ? ' ' + extTxt : '') + '</span>';
      }
      h += '</div>';

      // Progress bar
      var startMs = new Date(data.created_at).getTime();
      var endMs = new Date(data.ends_at).getTime();
      var nowMs = Date.now();
      var totalMs = Math.max(1, endMs - startMs);
      var pct = Math.max(0, Math.min(100, ((nowMs - startMs) / totalMs) * 100));
      h += '<div class="am-progress-wrap">';
      h += '<div class="am-progress-bar"><div class="am-progress-fill" style="width:' + pct.toFixed(1) + '%"></div></div>';
      h += '<div class="am-progress-labels">';
      h += '<span>' + fmtDate(data.created_at) + '</span>';
      h += '<span class="am-progress-now">Now (' + Math.round(pct) + '%)</span>';
      h += '<span>' + fmtDate(data.ends_at) + '</span>';
      h += '</div></div>';

      // Adjust end time (Parliament only)
    if (_canParliamentEditShopAdmin()) {
        var curExt = data.extended_hours || 0;
        h += '<div class="am-adjust">';
        h += '<span class="am-tl-label" style="min-width:auto">Adjust end time</span>';
        h += '<div class="am-stepper">';
        h += '<button class="am-step-btn" id="amDec" aria-label="Decrease">' + _svg.minus + '</button>';
        h += '<input type="text" inputmode="numeric" class="am-step-input" id="amHoursInput" value="' + curExt + '" />';
        h += '<button class="am-step-btn" id="amInc">+</button>';
        h += '</div>';
        h += '<span class="am-step-unit">hours</span>';
        h += '<button class="sa-action-btn" id="amApply" style="margin-left:4px;display:none">Apply</button>';
        h += '</div>';
      }

      // Anti-snipe
      if (antiSnipeMin > 0) {
        h += '<div class="am-tl" style="margin-top:8px"><span class="am-tl-label">Anti-snipe buffer</span><span class="am-tl-val">' + antiSnipeMin + ' min</span></div>';
      }
      h += '</div>';

      // Cancel auction (Parliament only)
      if (_canParliamentEditShopAdmin()) {
        h += '<div class="am-cancel-row">';
        h += '<button class="am-cancel-btn" id="amCancel">' + _svg.close + ' Cancel auction</button>';
        h += '</div>';
      }

      modal.innerHTML = h;
      _bindModalEvents();
    }

    function _bindModalEvents() {
      var inp      = document.getElementById('amHoursInput');
      var applyBtn = document.getElementById('amApply');
      var curExt   = data.extended_hours || 0; // used even when inputs aren't rendered

      function _showApply() {
        var v = parseInt(inp.value, 10) || 0;
        if (applyBtn) applyBtn.style.display = (v !== curExt) ? '' : 'none';
      }

      if (inp) {
        inp.addEventListener('input', function () {
          this.value = this.value.replace(/[^\-\d]/g, '').replace(/(?!^)-/g, '').slice(0, 5);
          var v = parseInt(this.value, 10);
          if (!isNaN(v) && v < _minAdjust) this.value = String(_minAdjust);
          _showApply();
        });
        inp.addEventListener('blur', function () {
          var v = parseInt(this.value, 10);
          if (isNaN(v)) { this.value = curExt; }
          else if (v < _minAdjust) { this.value = String(_minAdjust); }
          _showApply();
        });
      }
      var incBtn = document.getElementById('amInc');
      var decBtn = document.getElementById('amDec');
      if (incBtn) incBtn.addEventListener('click', function () {
        var v = parseInt(inp.value, 10) || 0;
        inp.value = v + 1;
        _showApply();
      });
      if (decBtn) decBtn.addEventListener('click', function () {
        var v = parseInt(inp.value, 10) || 0;
        inp.value = Math.max(_minAdjust, v - 1);
        _showApply();
      });
      if (applyBtn) applyBtn.addEventListener('click', function () {
        var target = parseInt(inp.value, 10) || 0;
        var delta = target - curExt;
        if (delta === 0) return;
        applyBtn.disabled = true; applyBtn.textContent = 'Applying\u2026';
        apiPost('/api/admin/shop/auctions/' + encodeURIComponent(aid) + '/extend', { hours: delta })
          .then(function (res) {
            if (res.ok && res.data.ok) {
              var appliedTarget = (typeof res.data.new_extended_hours === 'number') ? res.data.new_extended_hours : target;
              var toastMsg = '\u2713 End time adjusted to ' + (appliedTarget > 0 ? '+' : '') + appliedTarget + 'h.';
              if (res.data.clamped_to_min) {
                toastMsg += ' (clamped to minimum remaining time)';
              }
              showToast(toastMsg, 'success');
              data.ends_at = res.data.new_ends_at;
              data.extended = appliedTarget !== 0;
              data.extended_hours = appliedTarget;
              // Recompute clamp
              var newEndsMs = new Date(data.ends_at).getTime();
              var newRemaining = Math.floor((newEndsMs - Date.now()) / 3600000);
              _minAdjust = data.extended_hours - Math.max(0, newRemaining - 2);
              render();
              _auctions = []; renderItems(document.getElementById('saContent')); _notifyShopUpdated();
            } else {
              showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn');
              applyBtn.disabled = false; applyBtn.textContent = 'Apply';
            }
          }).catch(function () { showToast('\u26a0 Network error', 'warn'); applyBtn.disabled = false; applyBtn.textContent = 'Apply'; });
      });
      // Bind bid remove buttons
      modal.querySelectorAll('[data-remove-bid]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var bidId = btn.dataset.removeBid;
          var row = btn.closest('.am-bid-row');
          var bidUser = row ? row.querySelector('.am-bid-user').textContent : '';
          var bidAmt = row ? row.querySelector('.am-bid-amt').textContent : '';
          var overlay = document.getElementById('saOverlay');
          var overlayBd = document.getElementById('saOverlayBackdrop');
          overlay.innerHTML =
            '<button class="modal-close" id="saOverlayClose">\u2715</button>' +
            '<div class="shop-modal-title">Remove Bid</div>' +
            '<div class="shop-modal-body">Remove <strong>' + esc(bidUser) + '</strong>\u2019s bid of <strong>' + esc(bidAmt) + '</strong>?<br>' +
              'Their reserved EP will be released and they will be notified.</div>' +
            '<label class="shop-modal-input-label">Reason (optional)</label>' +
            '<textarea class="shop-modal-input" id="amRemoveReason" placeholder="Reason for removal\u2026" maxlength="50" rows="2"></textarea>' +
            '<div class="shop-modal-actions">' +
              '<button class="shop-modal-btn shop-modal-btn--cancel" id="amRemoveConfirm" style="color:var(--danger);border-color:var(--danger);">Remove Bid</button>' +
            '</div>';
          overlayBd.classList.add('open');
          document.getElementById('saOverlayClose').addEventListener('click', function () {
            overlayBd.classList.remove('open');
          });
          overlayBd.addEventListener('click', function (e) {
            if (e.target === overlayBd) overlayBd.classList.remove('open');
          });
          document.getElementById('amRemoveConfirm').addEventListener('click', function () {
            var reason = document.getElementById('amRemoveReason').value.trim();
            var cfm = this; cfm.disabled = true; cfm.textContent = 'Removing\u2026';
            apiPost('/api/admin/shop/bids/' + encodeURIComponent(bidId) + '/remove', { reason: reason || null })
              .then(function (res) {
                if (res.ok && res.data.ok) {
                  showToast('\u2713 Bid removed.', 'success');
                  overlayBd.classList.remove('open');
                  _notifyShopUpdated();
                  _openAuctionManageModal(aid);
                } else {
                  showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn');
                  cfm.disabled = false; cfm.textContent = 'Remove Bid';
                }
              }).catch(function () { showToast('\u26a0 Network error', 'warn'); cfm.disabled = false; cfm.textContent = 'Remove Bid'; });
          });
        });
      });
      var cancelBtn = document.getElementById('amCancel');
      if (cancelBtn) cancelBtn.addEventListener('click', function () {
        var body = 'This auction has <strong>' + data.bid_count + ' bid' + (data.bid_count !== 1 ? 's' : '') +
          '</strong> from <strong>' + data.bidder_count + ' bidder' + (data.bidder_count !== 1 ? 's' : '') + '</strong>.';
        if (data.current_highest_bid > 0) body += '<br>Highest bid: <strong>' + num(data.current_highest_bid) + ' EP</strong>.';
        body += '<br><br>Cancelling will release all reserved EP and notify all bidders.';
        modal.innerHTML =
          '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>' +
          '<div class="shop-modal-title">Cancel Auction</div>' +
          '<div class="shop-modal-body">' + body + '</div>' +
          '<div class="shop-modal-actions">' +
            '<button class="shop-modal-btn shop-modal-btn--cancel" id="amCancelConfirm" style="color:var(--danger);border-color:var(--danger);">Cancel Auction</button>' +
          '</div>';
        document.getElementById('amCancelConfirm').addEventListener('click', function () {
          var cfm = this; cfm.disabled = true; cfm.textContent = 'Cancelling\u2026';
          apiPost('/api/admin/shop/auctions/' + encodeURIComponent(aid) + '/close', {})
            .then(function (res) {
              if (res.ok && res.data.ok) { showToast('\u2713 Auction cancelled.', 'success'); closeModal(); _auctions = []; renderItems(document.getElementById('saContent')); _notifyShopUpdated(); }
              else { showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn'); cfm.disabled = false; cfm.textContent = 'Cancel Auction'; }
            }).catch(function () { showToast('\u26a0 Network error', 'warn'); cfm.disabled = false; cfm.textContent = 'Cancel Auction'; });
        });
      });
    }

    render();
  }

  /* Item Editor */
  var _IE_RANKS = ['emperor', 'archduke', 'grand duke', 'duke', 'count', 'viscount', 'knight', 'squire'];
  var _ieCatTags = [];
  var _ieImages = [];
  var _ieVariants = [];       // [{id, label}] – variant (sub-item) tabs
  var _ieActiveVariant = -1;  // -1 = General tab
  var _IE_MAX_TABS = 11;      // includes the permanent General tab

  function _ieSaveVariantData(modal) {
    if (_ieActiveVariant < 0 || _ieActiveVariant >= _ieVariants.length) return;
    var i = _ieActiveVariant, d = _ieVariants[i].data;
    if (!d) { _ieVariants[i].data = d = {}; }
    function gv(id) { var el = modal.querySelector('#' + id); return el ? el.value.trim() : ''; }
    d.name = gv('ieVarName_' + i);
    d.price = gv('ieVarPrice_' + i);
    d.stock = gv('ieVarStock_' + i);
    d.max_quantity = gv('ieVarMaxQty_' + i);
    d.accepts_dirty_ep = gv('ieVarDirtyEP_' + i);
    d.spend_order = gv('ieVarSpendOrder_' + i);
    d.cooldown_type = gv('ieVarCdType_' + i);
    d.cooldown_num = gv('ieVarCdNum_' + i);
    d.activate_at = gv('ieVarActAt_' + i);
    d.deactivate_at = gv('ieVarDeactAt_' + i);
    d.active = gv('ieVarActive_' + i);
  }

  function _ieCatSyncHidden(el) { if (el) el.value = _ieCatTags.join(','); }

  /* Item Editor helpers */
  function _slugify(s) {
    return (s || '').trim().toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function _makeUniqueId(slug) {
    if (!slug) return '';
    var ids = (_items || []).map(function (it) { return it.id; });
    if (!ids.includes(slug)) return slug;
    var i = 2;
    while (ids.includes(slug + '-' + i)) i++;
    return slug + '-' + i;
  }

  function _parseCooldownUI(val) {
    if (!val) return { type: 'none', n: 1 };
    val = String(val).trim();
    if (val === 'end_of_cycle') return { type: 'end_of_cycle', n: 1 };
    var m = val.match(/^(\d+)c$/i);
    if (m) return { type: 'cycles', n: parseInt(m[1]) };
    var d = parseInt(val);
    if (!isNaN(d) && d > 0) return { type: 'days', n: d };
    return { type: 'none', n: 1 };
  }

  function _parseRanks(vtr) {
    var state = {};
    _IE_RANKS.forEach(function (r) { state[r] = 0; });
    if (!Array.isArray(vtr)) return state;
    vtr.forEach(function (s) {
      s = String(s).trim().toLowerCase();
      if (s[0] === '!') { var r = s.slice(1); if (r in state) state[r] = -1; }
      else { if (s in state) state[s] = 1; }
    });
    return state;
  }

  function _ieExistingCats() {
    var m = {};
    (_items || []).forEach(function (it) {
      var cats = Array.isArray(it.category) ? it.category : (it.category ? [it.category] : []);
      cats.forEach(function (c) { if (c) m[c] = true; });
    });
    return Object.keys(m).sort();
  }

  function _ieRenderImageList(container) {
    var h = '';
    _ieImages.forEach(function (img, i) {
      h += '<div class="ie-img-row" data-idx="' + i + '">';
      h += '<span class="ie-img-pos">' + (i + 1) + '</span>';
      h += '<span class="ie-img-row-grip">&#9776;</span>';
      h += '<img class="ie-img-row-thumb" src="' + esc(img.url) + '" />';
      h += '<span class="ie-img-row-name" title="' + esc(img.name) + '">' + esc(img.name) + '</span>';
      h += '<button type="button" class="ie-img-row-btn ie-img-row-up" title="Move up"' + (i === 0 ? ' disabled' : '') + '>&#9650;</button>';
      h += '<button type="button" class="ie-img-row-btn ie-img-row-down" title="Move down"' + (i === _ieImages.length - 1 ? ' disabled' : '') + '>&#9660;</button>';
      h += '<button type="button" class="ie-img-row-btn ie-img-row-remove" title="Remove">&times;</button>';
      h += '</div>';
    });
    container.innerHTML = h;
    var addBtn = container.parentNode.querySelector('#ieImgAdd');
    if (addBtn) addBtn.style.display = _ieImages.length >= 3 ? 'none' : '';
    // Bind drag-to-reorder on each row
    container.querySelectorAll('.ie-img-row').forEach(function (row) {
      row.setAttribute('draggable', 'true');
      row.addEventListener('dragstart', function (e) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.idx);
        row.classList.add('ie-img-row--dragging');
      });
      row.addEventListener('dragend', function () {
        row.classList.remove('ie-img-row--dragging');
        container.querySelectorAll('.ie-img-row--over').forEach(function (r) { r.classList.remove('ie-img-row--over'); });
      });
      row.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        container.querySelectorAll('.ie-img-row--over').forEach(function (r) { r.classList.remove('ie-img-row--over'); });
        row.classList.add('ie-img-row--over');
      });
      row.addEventListener('dragleave', function () { row.classList.remove('ie-img-row--over'); });
      row.addEventListener('drop', function (e) {
        e.preventDefault();
        row.classList.remove('ie-img-row--over');
        var fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        var toIdx   = parseInt(row.dataset.idx);
        if (fromIdx === toIdx || isNaN(fromIdx) || isNaN(toIdx)) return;
        var moved = _ieImages.splice(fromIdx, 1)[0];
        _ieImages.splice(toIdx, 0, moved);
        _ieRenderImageList(container);
      });
    });
  }

  function _ieUploadMultiImage(file, listEl) {
    var allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/gif', 'image/webp'];
    if (!allowed.includes(file.type)) { showToast('\u26a0 Use PNG, JPG, GIF or WebP.', 'warn'); return; }
    if (file.size > 2 * 1024 * 1024) { showToast('\u26a0 Image must be < 2 MB.', 'warn'); return; }
    if (_ieImages.length >= 3) { showToast('\u26a0 Maximum 3 images.', 'warn'); return; }
    var addBtn = listEl.parentNode.querySelector('#ieImgAdd');
    if (addBtn) { addBtn.style.display = 'none'; }
    var fd = new FormData();
    fd.append('file', file);
    fetch('/api/admin/shop/items/upload-image', { method: 'POST', credentials: 'same-origin', body: fd })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.ok) {
          _ieImages.push({ name: file.name, url: data.url });
          _ieRenderImageList(listEl);
        } else {
          showToast('\u26a0 ' + (data.error || 'Upload failed'), 'warn');
          if (addBtn) addBtn.style.display = _ieImages.length >= 3 ? 'none' : '';
        }
      })
      .catch(function () {
        showToast('\u26a0 Upload failed.', 'warn');
        if (addBtn) addBtn.style.display = _ieImages.length >= 3 ? 'none' : '';
      });
  }

  function openItemEditor(item, isNew) {
    var modal = document.getElementById('saModal');
    var bd    = document.getElementById('saModalBackdrop');
    _ieVariants = [];
    _ieActiveVariant = -1;

    // Edit mode: seed variant state from existing item data
    if (!isNew && item) {
      var _t = item.type || 'bin';
      if (_t !== 'auction') {
        var subs = Array.isArray(item.variants) ? item.variants : [];
        if (subs.length) {
          // Pre-populate from existing sub-items
          subs.forEach(function (sv, idx) {
            _ieVariants.push({
              id: 'v' + Date.now() + '_' + idx,
              label: sv.label || ('Variant ' + (idx + 1)),
              data: (function () {
                var _svCd = _parseCooldownUI(sv.cooldown);
                return {
                  name: sv.name || '',
                  price: _v(sv.price, ''),
                  stock: _v(sv.stock, ''),
                  max_quantity: _v(sv.max_quantity, ''),
                  accepts_dirty_ep: sv.accepts_dirty_ep !== false ? 'true' : 'false',
                  spend_order: sv.spend_order || 'clean_first',
                  cooldown_type: _svCd.type, cooldown_num: String(_svCd.n),
                  activate_at: sv.activate_at || '', deactivate_at: sv.deactivate_at || '',
                  active: sv.active !== false ? 'true' : 'false',
                };
              })()
            });
          });
        } else {
          // Bin/Donation with no sub-items: single default variant from item data
          _ieVariants.push({
            id: 'v' + Date.now(),
            label: 'Variant 1',
            data: (function () {
              var _iCd = _parseCooldownUI(item.cooldown);
              return {
                name: '',
                price: _v(item.price, ''),
                stock: _v(item.stock, ''),
                max_quantity: _v(item.max_quantity, ''),
                accepts_dirty_ep: item.accepts_dirty_ep !== false ? 'true' : 'false',
                spend_order: item.spend_order || 'clean_first',
                cooldown_type: _iCd.type, cooldown_num: String(_iCd.n),
                activate_at: item.activate_at || '', deactivate_at: item.deactivate_at || '',
                active: 'true',
              };
            })()
          });
        }
      }
      // Auction: _ieVariants stays empty
    }

    // Non-auction items always have at least one variant
    if (!_ieVariants.length && (!item || (item.type || 'bin') !== 'auction')) {
      _ieVariants.push({
        id: 'v' + Date.now(), label: 'Variant 1',
        data: { name: '', price: '', stock: '', max_quantity: '',
                accepts_dirty_ep: 'true', spend_order: 'clean_first',
                cooldown_type: 'none', cooldown_num: '1',
                activate_at: '', deactivate_at: '', active: 'true' }
      });
    }

    modal.classList.add('ie-modal');
    modal.innerHTML = _buildItemEditorHtml(item, isNew);
    bd.classList.add('open');
    _ieTypeToggle(modal);
    _bindItemEditorEvents(modal, item, isNew);
  }

  function _v(val, def) {
    return (val != null && val !== '') ? String(val) : (def != null ? String(def) : '');
  }
  function _sel(cond) { return cond ? ' selected' : ''; }

  function _buildItemEditorHtml(item, isNew) {
    var it = item || {};
    var itType = it.type || 'bin';
    var imgUrl = it.image || '';
    var cats   = _ieExistingCats();
    var cd     = _parseCooldownUI(it.cooldown);
    var ranks  = _parseRanks(it.visible_to_ranks);
    var acceptsDirty = it.accepts_dirty_ep !== false;
    var spendVal = acceptsDirty ? (it.spend_order || 'clean_first') : 'clean_only';

    var h = '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>';
    h += '<div class="shop-modal-title">' + (isNew ? 'New Item' : 'Edit: ' + esc(it.name || it.id || '')) + '</div>';

    // Variant tab bar (hidden for auction single-item edit)
    var _showTabBar = isNew || _ieVariants.length > 0;
    if (_showTabBar) {
      h += '<div class="ie-variant-tabs" id="ieVariantTabs">';
      h += '<div class="ie-variant-tabs-row">';
      h += '<button class="ie-variant-tab' + (_ieActiveVariant === -1 ? ' ie-variant-tab--active' : '') + '" data-variant-idx="-1">';
      h += '<span class="ie-variant-tab-label">General</span></button>';
      _ieVariants.forEach(function (v, i) {
        h += '<button class="ie-variant-tab' + (_ieActiveVariant === i ? ' ie-variant-tab--active' : '') + '" data-variant-idx="' + i + '" title="' + esc(v.label) + '">';
        h += '<span class="ie-variant-tab-label">' + esc(v.label) + '</span>';
        if (_ieVariants.length > 1) h += '<span class="ie-variant-tab-close" data-variant-remove="' + i + '" title="Remove">&times;</span>';
        h += '</button>';
      });
      var _isAuction = itType === 'auction';
      var canAddVariant = (1 + _ieVariants.length) < _IE_MAX_TABS && !_isAuction;
      if (canAddVariant) {
        h += '<button class="ie-variant-tab ie-variant-tab--add" id="ieAddVariant" title="Add Variant">' +
          '<span class="ie-add-plus">+</span><span class="ie-add-text">\u00a0Add Variant</span></button>';
      }
      h += '</div>';
      h += '<div class="ie-variant-tabs-border"></div>';
      h += '</div>';
    }

    h += '<div class="ie-form-scroll"' + (_showTabBar ? '' : ' style="max-height:65vh"') + '>';

    // Basic Info (hidden when variant tab active)
    h += '<div class="ie-section" id="ieBasicInfo"' + (_ieActiveVariant >= 0 ? ' style="display:none"' : '') + '><div class="ie-section-title">Basic Info</div>';
    h += '<div class="ie-row">';
    h += '<div class="ie-field ie-field--wide">';
    h += '<label class="ie-label">Name</label>';
    h += '<input id="ieName" class="ie-input" value="' + esc(it.name || '') + '" placeholder="Display name" maxlength="45" />';
    h += '<input type="hidden" id="ieId" value="' + esc(it.id || '') + '" />';
    h += '</div>';
    h += '<div class="ie-field" id="ieTypeField"' + (_ieActiveVariant >= 0 ? ' style="display:none"' : '') + '><label class="ie-label">Type</label>' +
         '<select id="ieType" class="ie-input"><option value="bin"' + _sel(itType === 'bin') + '>Bin</option>' +
         '<option value="auction"' + _sel(itType === 'auction') + '>Auction</option>' +
         '<option value="donate"' + _sel(itType === 'donate') + '>Donate</option></select></div>';
    h += '<div class="ie-field"><label class="ie-label">Active</label>' +
         '<select id="ieActive" class="ie-input"><option value="true"' + _sel(it.active !== false) + '>Yes</option>' +
         '<option value="false"' + _sel(it.active === false) + '>No</option></select></div>';
    h += '</div>';
    h += '</div>'; // basic info section

    // General tab panel
    var _generalVis = _ieActiveVariant === -1 ? '' : 'none';
    h += '<div class="ie-tab-panel" data-ie-panel="-1" style="display:' + _generalVis + '">';

    // Categories (tag input)
    h += '<div class="ie-row">';
    var initTags = Array.isArray(it.category) ? it.category : (it.category ? [it.category] : []);
    h += '<div class="ie-field ie-field--full"><label class="ie-label">Categories</label>' +
         '<div class="ie-tag-container" id="ieCatContainer">';
    initTags.forEach(function (t) {
      h += '<span class="ie-tag-pill">' + esc(t) + '<button type="button" class="ie-tag-x">&times;</button></span>';
    });
    h += '<input id="ieCatGhost" class="ie-tag-ghost" list="ieCatList" placeholder="' +
         (initTags.length ? '' : 'Type and press Space or Enter\u2026') + '" />' +
         '</div>' +
         '<datalist id="ieCatList">' + cats.map(function (c) { return '<option value="' + esc(c) + '">'; }).join('') + '</datalist>' +
         '<input type="hidden" id="ieCategory" />' +
         '<div class="ie-hint">Press <code>Space</code> or <code>Enter</code> to add \u00b7 <code>Backspace</code> on empty to remove last</div>' +
         '</div>';
    h += '</div>';

    // Description
    h += '<div class="ie-field ie-field--full"><label class="ie-label">Description</label>' +
         '<textarea id="ieDesc" class="ie-input ie-textarea" maxlength="500">' + esc(it.description || '') + '</textarea></div>';

    // Images: multi-upload
    h += '<div class="ie-field ie-field--full" style="margin-bottom: 18px;"><label class="ie-label">Images <span class="ie-hint-inline">max 3</span></label>';
    h += '<div class="ie-img-list" id="ieImgList"></div>';
    h += '<button type="button" class="ie-img-add-btn" id="ieImgAdd">&#43; Upload Image</button>';
    h += '<input type="file" id="ieImgFile" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none" />';
    h += '<div class="ie-hint">PNG/JPG/GIF/WebP \u00b7 max 2 MB</div>';
    h += '</div>';

    // Pricing & Stock
    if (!_ieVariants.length) {
    h += '<div class="ie-section" data-ie-pricing><div class="ie-section-title">Pricing &amp; Stock</div>';
    h += '<div class="ie-row">';
    h += '<div class="ie-field" data-ie-bin><label class="ie-label">Price (EP)</label>' +
         '<input id="iePrice" type="text" inputmode="numeric" class="ie-input ie-num" value="' + _v(it.price, '') + '" maxlength="6" placeholder="0" /></div>';
    h += '<div class="ie-field" data-ie-bin><label class="ie-label">Stock (blank\u00a0=\u00a0\u221E)</label>' +
         '<input id="ieStock" type="text" inputmode="numeric" class="ie-input ie-num" value="' + _v(it.stock, '') + '" maxlength="6" placeholder="\u221E" /></div>';
    h += '<div class="ie-field" data-ie-bin><label class="ie-label">Max Qty/purchase</label>' +
         '<input id="ieMaxQty" type="text" inputmode="numeric" class="ie-input ie-num" value="' + _v(it.max_quantity, '') + '" maxlength="2" placeholder="1" /></div>';
    h += '</div>';
    var durType = it.duration_type || 'fixed';
    var durHrs  = it.duration_hours || 48;
    h += '<div class="ie-row" data-ie-auction>';
    h += '<div class="ie-field"><label class="ie-label">Starting Bid (EP)</label><input id="ieStartBid" type="text" inputmode="numeric" class="ie-input ie-num" value="' + _v(it.starting_bid, 1) + '" maxlength="6" /></div>';
    h += '<div class="ie-field"><label class="ie-label">Min Increment (EP)</label><input id="ieMinInc" type="text" inputmode="numeric" class="ie-input ie-num" value="' + _v(it.min_increment, 1) + '" maxlength="6" /></div>';
    h += '<div class="ie-field ie-field--wide"><label class="ie-label">Duration</label>' +
         '<div class="ie-cooldown-row">' +
         '<select id="ieDurType" class="ie-input ie-cd-type">' +
           '<option value="fixed"' + _sel(durType !== 'eoc_minus_2') + '>Hours</option>' +
           '<option value="eoc_minus_2"' + _sel(durType === 'eoc_minus_2') + '>End of Cycle \u2212 2 days</option>' +
         '</select>' +
         '<input id="ieDurHrs" type="text" inputmode="numeric" class="ie-input ie-num ie-cd-num" maxlength="4" value="' + durHrs + '"' +
           (durType === 'eoc_minus_2' ? ' style="display:none"' : '') + ' />' +
         '</div></div>';
    h += '<div class="ie-field"><label class="ie-label">Anti-snipe (secs)</label><input id="ieAntiSnipe" type="text" inputmode="numeric" class="ie-input ie-num" value="' + _v(it.anti_snipe_seconds, 300) + '" maxlength="4" /></div>';
    h += '<div class="ie-field"><label class="ie-label">Winners</label><input id="ieWinners" type="text" inputmode="numeric" class="ie-input ie-num" value="' + _v(it.winner_count, 1) + '" maxlength="2" /></div>';
    h += '<div class="ie-field"><label class="ie-label">Auto Start</label>' +
         '<select id="ieAutoStart" class="ie-input"><option value="false"' + _sel(!it.auto_start) + '>No</option>' +
         '<option value="true"' + _sel(!!it.auto_start) + '>Yes</option></select>' +
         '<div class="ie-hint">Automatically start when a new cycle begins</div></div>';
    h += '</div>';
    h += '</div>'; // pricing section

    // EP Settings
    h += '<div class="ie-section" data-ie-ep><div class="ie-section-title">EP Settings</div><div class="ie-row">';
    h += '<div class="ie-field"><label class="ie-label">Accepts Dirty EP</label>' +
         '<select id="ieDirtyEP" class="ie-input">' +
         '<option value="true"' + _sel(acceptsDirty) + '>Yes</option>' +
         '<option value="false"' + _sel(!acceptsDirty) + '>No (Clean Only)</option>' +
         '</select></div>';
    h += '<div class="ie-field"><label class="ie-label">Spend Order</label>' +
         '<select id="ieSpendOrder" class="ie-input">' +
         ['clean_first', 'dirty_first', 'clean_only', 'dirty_only'].map(function (o) {
           return '<option value="' + o + '"' + _sel(spendVal === o) + '>' + o.replace(/_/g, ' ') + '</option>';
         }).join('') + '</select></div>';
    h += '</div></div>'; // EP section
    } // end if (!_ieVariants.length)

    function _utcToLocal(iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var pad = function (n) { return n < 10 ? '0' + n : String(n); };
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    // Cooldown & Schedule (in General only when no variants)
    if (!_ieVariants.length) {
      h += '<div class="ie-section" data-ie-bin><div class="ie-section-title">Cooldown &amp; Schedule</div><div class="ie-row">';
      h += '<div class="ie-field ie-field--wide"><label class="ie-label">Cooldown</label>';
      h += '<div class="ie-cooldown-row">';
      h += '<select id="ieCooldownType" class="ie-input ie-cd-type">' +
           '<option value="none"'          + _sel(cd.type === 'none')         + '>None</option>' +
           '<option value="days"'          + _sel(cd.type === 'days')         + '>Days</option>' +
           '<option value="end_of_cycle"'  + _sel(cd.type === 'end_of_cycle') + '>End of Cycle</option>' +
           '<option value="cycles"'        + _sel(cd.type === 'cycles')       + '>Cycles</option>' +
           '</select>';
      h += '<input id="ieCooldownNum" type="text" inputmode="numeric" class="ie-input ie-num ie-cd-num" maxlength="2" value="' + cd.n + '"' +
           ((cd.type === 'days' || cd.type === 'cycles') ? '' : ' style="display:none"') + ' />';
      h += '</div></div>';
      h += '</div>';
      var _actAt  = _utcToLocal(it.activate_at);
      var _deactAt = _utcToLocal(it.deactivate_at);
      h += '<div class="ie-row">';
      h += '<div class="ie-field"><label class="ie-label">Auto-activate at</label>' +
           '<input id="ieActivateAt" type="datetime-local" class="ie-input" value="' + esc(_actAt) + '" />' +
           '<div class="ie-hint">Item will automatically activate at this date/time (your local timezone)</div></div>';
      h += '<div class="ie-field"><label class="ie-label">Auto-deactivate at</label>' +
           '<input id="ieDeactivateAt" type="datetime-local" class="ie-input" value="' + esc(_deactAt) + '" />' +
           '<div class="ie-hint">Item will automatically deactivate at this date/time (your local timezone)</div></div>';
      h += '</div>';
      h += '</div>';
    }

    // Visibility
    h += '<div class="ie-section"><div class="ie-section-title">Visibility</div>';
    h += '<div class="ie-field ie-field--full"><label class="ie-label">Visible to ranks</label>';
    h += '<div class="ie-rank-chips" id="ieRankChips">';
    _IE_RANKS.forEach(function (rank) {
      var state = ranks[rank] || 0;
      var label = rank.split(' ').map(function (w) { return w[0].toUpperCase() + w.slice(1); }).join(' ');
      h += '<button class="ie-rank-chip" type="button" data-rank="' + esc(rank) + '" data-state="' + state + '">' + esc(label) + '</button>';
    });
    h += '</div>';
    h += '<div class="ie-hint ie-rank-legend">' +
         '<span class="ie-rl-dot" style="background:var(--border)"></span>Neutral (no filter) &ensp;' +
         '<span class="ie-rl-dot" style="background:var(--gold)"></span>Include &ensp;' +
         '<span class="ie-rl-dot" style="background:var(--danger)"></span>Exclude &ensp;- click to cycle</div>';
    h += '</div>';
    // Top N from previous cycle
    var topN = (it.visible_to_top_n != null && it.visible_to_top_n > 0) ? String(it.visible_to_top_n) : '';
    h += '<div class="ie-field ie-field--full" style="margin-top:8px"><label class="ie-label">Top N from Previous Cycle</label>';
    h += '<input id="ieTopN" type="text" inputmode="numeric" class="ie-input ie-num" value="' + esc(topN) + '" maxlength="3" placeholder="No filter" style="max-width:140px" />';
    h += '<div class="ie-hint">Only the top N players from the previous EP cycle can see and purchase this item. Leave blank for no restriction.</div>';
    h += '</div>';
    h += '</div>'; // visibility section

    h += '</div>'; // General panel

    // Variant tab panels
    _ieVariants.forEach(function (v, i) {
      var _varVis = _ieActiveVariant === i ? '' : 'none';
      var d = v.data || {};
      var vDirty = d.accepts_dirty_ep !== 'false';
      var vSpend = vDirty ? (d.spend_order || 'clean_first') : 'clean_only';
      h += '<div class="ie-tab-panel" data-ie-panel="' + i + '" style="display:' + _varVis + '">';
      h += '<div class="ie-section">';
      h += '<div class="ie-row">';
      h += '<div class="ie-field ie-field--wide"><label class="ie-label">Name</label>' +
           '<input id="ieVarName_' + i + '" class="ie-input" value="' + esc(d.name || '') + '" placeholder="Variant display name" maxlength="45" /></div>';
      h += '<div class="ie-field"><label class="ie-label">Active</label>' +
           '<select id="ieVarActive_' + i + '" class="ie-input">' +
           '<option value="true"' + _sel(d.active !== 'false') + '>Yes</option>' +
           '<option value="false"' + _sel(d.active === 'false') + '>No</option></select></div>';
      h += '</div>';
      h += '<div class="ie-row">';
      h += '<div class="ie-field"><label class="ie-label">Price (EP)</label>' +
           '<input id="ieVarPrice_' + i + '" type="text" inputmode="numeric" class="ie-input ie-num" value="' + _v(d.price, '') + '" maxlength="6" placeholder="0" /></div>';
      h += '<div class="ie-field"><label class="ie-label">Stock (blank\u00a0=\u00a0\u221e)</label>' +
           '<input id="ieVarStock_' + i + '" type="text" inputmode="numeric" class="ie-input ie-num" value="' + _v(d.stock, '') + '" maxlength="6" placeholder="\u221e" /></div>';
      h += '<div class="ie-field"><label class="ie-label">Max Qty/purchase</label>' +
           '<input id="ieVarMaxQty_' + i + '" type="text" inputmode="numeric" class="ie-input ie-num" value="' + _v(d.max_quantity, '') + '" maxlength="2" placeholder="1" /></div>';
      h += '</div>';
      h += '<div class="ie-row">';
      h += '<div class="ie-field"><label class="ie-label">Accepts Dirty EP</label>' +
           '<select id="ieVarDirtyEP_' + i + '" class="ie-input">' +
           '<option value="true"' + _sel(vDirty) + '>Yes</option>' +
           '<option value="false"' + _sel(!vDirty) + '>No (Clean Only)</option>' +
           '</select></div>';
      h += '<div class="ie-field"><label class="ie-label">Spend Order</label>' +
           '<select id="ieVarSpendOrder_' + i + '" class="ie-input">';
      ['clean_first', 'dirty_first', 'clean_only', 'dirty_only'].forEach(function (o) {
        h += '<option value="' + o + '"' + _sel(vSpend === o) + '>' + o.replace(/_/g, ' ') + '</option>';
      });
      h += '</select></div>';
      h += '</div>';
      h += '</div>'; // section
      // Cooldown & Schedule
      var vCd = { type: d.cooldown_type || 'none', n: d.cooldown_num || '1' };
      h += '<div class="ie-section"><div class="ie-section-title">Cooldown &amp; Schedule</div>';
      h += '<div class="ie-row">';
      h += '<div class="ie-field ie-field--wide"><label class="ie-label">Cooldown</label>';
      h += '<div class="ie-cooldown-row">';
      h += '<select id="ieVarCdType_' + i + '" class="ie-input ie-cd-type">' +
           '<option value="none"' + _sel(vCd.type === 'none') + '>None</option>' +
           '<option value="days"' + _sel(vCd.type === 'days') + '>Days</option>' +
           '<option value="end_of_cycle"' + _sel(vCd.type === 'end_of_cycle') + '>End of Cycle</option>' +
           '<option value="cycles"' + _sel(vCd.type === 'cycles') + '>Cycles</option>' +
           '</select>';
      h += '<input id="ieVarCdNum_' + i + '" type="text" inputmode="numeric" class="ie-input ie-num ie-cd-num" maxlength="2" value="' + esc(vCd.n) + '"' +
           ((vCd.type === 'days' || vCd.type === 'cycles') ? '' : ' style="display:none"') + ' />';
      h += '</div></div>';
      h += '</div>';
      var vActAt = _utcToLocal(d.activate_at || '');
      var vDeactAt = _utcToLocal(d.deactivate_at || '');
      h += '<div class="ie-row">';
      h += '<div class="ie-field"><label class="ie-label">Auto-activate at</label>' +
           '<input id="ieVarActAt_' + i + '" type="datetime-local" class="ie-input" value="' + esc(vActAt) + '" /></div>';
      h += '<div class="ie-field"><label class="ie-label">Auto-deactivate at</label>' +
           '<input id="ieVarDeactAt_' + i + '" type="datetime-local" class="ie-input" value="' + esc(vDeactAt) + '" /></div>';
      h += '</div>';
      h += '</div>'; // cooldown section
      h += '</div>'; // panel
    });

    h += '</div>'; // ie-form-scroll
    h += '<div class="shop-modal-actions">';
    if (!isNew) h += '<button class="shop-modal-btn shop-modal-btn--cancel" id="ieDelete" style="color:var(--danger);border-color:var(--danger);margin-right:auto;">Delete Item</button>';
    h += '<button class="shop-modal-btn shop-modal-btn--confirm" id="ieSubmit">' + (isNew ? 'Create Item' : 'Save Changes') + '</button>';
    h += '</div>';
    return h;
  }

  function _ieTypeToggle(modal) {
    var typeEl = modal.querySelector('#ieType');
    if (!typeEl) return;
    var t = typeEl.value;
    var isDonate = t === 'donate';
    modal.querySelectorAll('[data-ie-bin]').forEach(function (el) { el.style.display = t === 'bin' ? '' : 'none'; });
    modal.querySelectorAll('[data-ie-auction]').forEach(function (el) { el.style.display = t === 'auction' ? '' : 'none'; });
    modal.querySelectorAll('[data-ie-pricing]').forEach(function (el) { el.style.display = isDonate ? 'none' : ''; });
    modal.querySelectorAll('[data-ie-ep]').forEach(function (el) { el.style.display = isDonate ? 'none' : ''; });
  }

  function _ieCollect(modal) {
    _ieSaveVariantData(modal);
    function gv(id) { var el = modal.querySelector('#' + id); return el ? el.value.trim() : ''; }
    // Frontend sanitize helpers
    function gs(id, max) { return gv(id).slice(0, max); }
    function gd(id) { return gv(id).replace(/\D/g, '').slice(0, 20); } // digits only

    // Cooldown value
    var cdType = gv('ieCooldownType');
    var cdNum  = parseInt(gv('ieCooldownNum') || '1') || 1;
    var cooldownVal = cdType === 'none'         ? '' :
                      cdType === 'end_of_cycle' ? 'end_of_cycle' :
                      cdType === 'days'         ? String(cdNum) :
                      cdType === 'cycles'       ? cdNum + 'c' : '';

    // Auction duration
    var durType   = gv('ieDurType') || 'fixed';
    var durHrsVal = durType === 'eoc_minus_2' ? null : (parseInt(gv('ieDurHrs') || '48') || 48);

    // Rank states from chips
    var rankResult = [];
    modal.querySelectorAll('.ie-rank-chip').forEach(function (c) {
      var s = parseInt(c.dataset.state);
      if (s === 1)  rankResult.push(c.dataset.rank);
      else if (s === -1) rankResult.push('!' + c.dataset.rank);
    });

    // Top N from previous cycle
    var topNVal = gv('ieTopN');
    var topN = topNVal ? (parseInt(topNVal, 10) || null) : null;
    if (topN !== null && topN <= 0) topN = null;

    // Schedule fields
    var actAtRaw = gv('ieActivateAt');
    var deactAtRaw = gv('ieDeactivateAt');
    var activateAt = actAtRaw ? new Date(actAtRaw).toISOString() : null;
    var deactivateAt = deactAtRaw ? new Date(deactAtRaw).toISOString() : null;

    var _hasVariants = _ieVariants.length > 0;
    var _firstV = _hasVariants ? (_ieVariants[0].data || {}) : null;
    var _fvCdType, _fvCdNum, _fvCdVal;
    if (_firstV) {
      _fvCdType = _firstV.cooldown_type || 'none';
      _fvCdNum  = parseInt(_firstV.cooldown_num || '1') || 1;
      _fvCdVal  = _fvCdType === 'none' ? '' :
                  _fvCdType === 'end_of_cycle' ? 'end_of_cycle' :
                  _fvCdType === 'days' ? String(_fvCdNum) :
                  _fvCdType === 'cycles' ? _fvCdNum + 'c' : '';
    }
    var _fvActAt = _firstV && _firstV.activate_at ? new Date(_firstV.activate_at).toISOString() : null;
    var _fvDeactAt = _firstV && _firstV.deactivate_at ? new Date(_firstV.deactivate_at).toISOString() : null;

    return {
      id:                    gv('ieId'),
      type:                  gv('ieType'),
      name:                  gs('ieName', 45),
      description:           gs('ieDesc', 500),
      image:                 _ieImages.length ? _ieImages[0].url : '',
      images:                _ieImages.map(function (img) { return img.url; }),
      category:              _ieCatTags.slice(0, 10),
      active:                gv('ieActive'),
      price:                 _hasVariants ? (_firstV.price || '') : gv('iePrice'),
      stock:                 _hasVariants ? (_firstV.stock || '') : gv('ieStock'),
      max_quantity:          _hasVariants ? (_firstV.max_quantity || '') : gv('ieMaxQty'),
      starting_bid:          gv('ieStartBid'),
      min_increment:         gv('ieMinInc'),
      duration_type:         durType,
      duration_hours:        durHrsVal,
      anti_snipe_seconds:    gv('ieAntiSnipe'),
      winner_count:          gv('ieWinners'),
      auto_start:            gv('ieAutoStart'),
      accepts_dirty_ep:      _hasVariants ? (_firstV.accepts_dirty_ep || 'true') : gv('ieDirtyEP'),
      spend_order:           _hasVariants ? (_firstV.spend_order || 'clean_first') : gv('ieSpendOrder'),
      cooldown:              _hasVariants ? _fvCdVal : cooldownVal,
      visible_to_ranks:      rankResult.length ? rankResult : null,
      visible_to_top_n:      topN,
      activate_at:           _hasVariants ? _fvActAt : activateAt,
      deactivate_at:         _hasVariants ? _fvDeactAt : deactivateAt,
      variants:              _ieVariants.map(function (v) {
        var d = v.data || {};
        var _vCdType = d.cooldown_type || 'none';
        var _vCdNum  = parseInt(d.cooldown_num || '1') || 1;
        var _vCdVal  = _vCdType === 'none' ? '' :
                       _vCdType === 'end_of_cycle' ? 'end_of_cycle' :
                       _vCdType === 'days' ? String(_vCdNum) :
                       _vCdType === 'cycles' ? _vCdNum + 'c' : '';
        return {
          label: v.label,
          name: (d.name || '').slice(0, 45),
          type: gv('ieType'),
          price: d.price || '',
          stock: d.stock || '',
          max_quantity: d.max_quantity || '',
          accepts_dirty_ep: d.accepts_dirty_ep || 'true',
          spend_order: d.spend_order || 'clean_first',
          cooldown: _vCdVal,
          activate_at: d.activate_at ? new Date(d.activate_at).toISOString() : null,
          deactivate_at: d.deactivate_at ? new Date(d.deactivate_at).toISOString() : null,
          active: d.active !== 'false',
        };
      }),
    };
  }

  function _bindItemEditorEvents(modal, origItem, isNew) {
    // Snapshot / restore General tab state across full rebuilds
    function _snapshotGeneral() {
      function _gv(id) { var el = modal.querySelector('#' + id); return el ? el.value : null; }
      var s = {
        name: _gv('ieName'), id: _gv('ieId'), type: _gv('ieType'), active: _gv('ieActive'),
        desc: _gv('ieDesc'), topN: _gv('ieTopN'),
        price: _gv('iePrice'), stock: _gv('ieStock'), maxQty: _gv('ieMaxQty'),
        startBid: _gv('ieStartBid'), minInc: _gv('ieMinInc'),
        durType: _gv('ieDurType'), durHrs: _gv('ieDurHrs'),
        antiSnipe: _gv('ieAntiSnipe'), winners: _gv('ieWinners'), autoStart: _gv('ieAutoStart'),
        dirtyEP: _gv('ieDirtyEP'), spendOrder: _gv('ieSpendOrder'),
        cdType: _gv('ieCooldownType'), cdNum: _gv('ieCooldownNum'),
        actAt: _gv('ieActivateAt'), deactAt: _gv('ieDeactivateAt'),
        ranks: {}, catTags: _ieCatTags.slice(), images: _ieImages.slice()
      };
      modal.querySelectorAll('.ie-rank-chip').forEach(function (c) { s.ranks[c.dataset.rank] = c.dataset.state; });
      return s;
    }
    function _restoreGeneral(s) {
      function _sv(id, v) { var el = modal.querySelector('#' + id); if (el && v != null) el.value = v; }
      _sv('ieName', s.name); _sv('ieId', s.id); _sv('ieType', s.type); _sv('ieActive', s.active);
      _sv('ieDesc', s.desc); _sv('ieTopN', s.topN);
      _sv('iePrice', s.price); _sv('ieStock', s.stock); _sv('ieMaxQty', s.maxQty);
      _sv('ieStartBid', s.startBid); _sv('ieMinInc', s.minInc);
      _sv('ieDurType', s.durType); _sv('ieDurHrs', s.durHrs);
      _sv('ieAntiSnipe', s.antiSnipe); _sv('ieWinners', s.winners); _sv('ieAutoStart', s.autoStart);
      _sv('ieDirtyEP', s.dirtyEP); _sv('ieSpendOrder', s.spendOrder);
      _sv('ieCooldownType', s.cdType); _sv('ieCooldownNum', s.cdNum);
      _sv('ieActivateAt', s.actAt); _sv('ieDeactivateAt', s.deactAt);
      // Rank chips
      modal.querySelectorAll('.ie-rank-chip').forEach(function (c) {
        if (s.ranks[c.dataset.rank] != null) c.dataset.state = s.ranks[c.dataset.rank];
      });
      // Images
      _ieImages = s.images;
      var il = modal.querySelector('#ieImgList');
      if (il) _ieRenderImageList(il);
      // Categories – rebuild pills with handlers
      _ieCatTags = s.catTags;
      var cc = modal.querySelector('#ieCatContainer');
      var cg = modal.querySelector('#ieCatGhost');
      var ch = modal.querySelector('#ieCategory');
      if (cc && cg) {
        cc.querySelectorAll('.ie-tag-pill').forEach(function (p) { p.remove(); });
        s.catTags.forEach(function (t) {
          var pill = document.createElement('span');
          pill.className = 'ie-tag-pill';
          pill.textContent = t;
          var x = document.createElement('button');
          x.type = 'button'; x.className = 'ie-tag-x'; x.innerHTML = '&times;';
          x.addEventListener('click', function () {
            var idx = _ieCatTags.indexOf(t);
            if (idx !== -1) _ieCatTags.splice(idx, 1);
            pill.remove();
            _ieCatSyncHidden(ch);
            if (cg) cg.placeholder = _ieCatTags.length ? '' : 'Type and press Space or Enter\u2026';
          });
          pill.appendChild(x);
          cc.insertBefore(pill, cg);
        });
        cg.placeholder = _ieCatTags.length ? '' : 'Type and press Space or Enter\u2026';
      }
      _ieCatSyncHidden(ch);
      // Re-apply section toggles
      _ieTypeToggle(modal);
      var _cdT = modal.querySelector('#ieCooldownType'), _cdN = modal.querySelector('#ieCooldownNum');
      if (_cdT && _cdN) _cdN.style.display = (_cdT.value === 'days' || _cdT.value === 'cycles') ? '' : 'none';
      var _dT = modal.querySelector('#ieDurType'), _dN = modal.querySelector('#ieDurHrs');
      if (_dT && _dN) _dN.style.display = _dT.value === 'eoc_minus_2' ? 'none' : '';
    }

    // Type toggle (bin/auction sections) + auction variant constraint
    var typeEl = modal.querySelector('#ieType');
    if (typeEl) {
      var _prevMainType = typeEl.value;
      typeEl.addEventListener('focus', function () { _prevMainType = typeEl.value; });
      typeEl.addEventListener('change', function () {
        var newType = typeEl.value;
        var isAuction = newType === 'auction';
        if (isAuction && _ieVariants.length > 0) {
          if (!confirm('Switching to Auction will remove all variants. Continue?')) {
            typeEl.value = _prevMainType;
            return;
          }
          _ieSaveVariantData(modal);
          var _sg = _snapshotGeneral();
          _ieVariants = [];
          _ieActiveVariant = -1;
          modal.innerHTML = _buildItemEditorHtml(origItem, isNew);
          _ieTypeToggle(modal);
          _bindItemEditorEvents(modal, origItem, isNew);
          _sg.type = 'auction';
          _restoreGeneral(_sg);
          return;
        }
        // Switching from auction to non-auction: ensure at least one variant
        if (!isAuction && _ieVariants.length === 0) {
          var _sg2 = _snapshotGeneral();
          _ieVariants.push({ id: 'v' + Date.now(), label: 'Variant 1', data: { name: '', price: '', stock: '', max_quantity: '', accepts_dirty_ep: 'true', spend_order: 'clean_first', cooldown_type: 'none', cooldown_num: '1', activate_at: '', deactivate_at: '', active: 'true' } });
          _ieActiveVariant = -1;
          modal.innerHTML = _buildItemEditorHtml(origItem, isNew);
          _ieTypeToggle(modal);
          _bindItemEditorEvents(modal, origItem, isNew);
          _sg2.type = newType;
          _restoreGeneral(_sg2);
          return;
        }
        _prevMainType = newType;
        _ieTypeToggle(modal);
        var addBtn = modal.querySelector('#ieAddVariant');
        if (addBtn) {
          if (isAuction) {
            addBtn.disabled = true;
            addBtn.title = 'Auctions cannot have sub-items';
          } else {
            var underMax = (1 + _ieVariants.length) < _IE_MAX_TABS;
            addBtn.disabled = !underMax;
            addBtn.title = underMax ? 'Add Variant' : 'Maximum ' + _IE_MAX_TABS + ' tabs';
          }
        }
      });
    }

    // Digits-only enforcer for all numeric text inputs
    modal.querySelectorAll('.ie-num').forEach(function (input) {
      input.addEventListener('input', function () {
        var pos = this.selectionStart;
        var cleaned = this.value.replace(/\D/g, '');
        if (cleaned !== this.value) {
          this.value = cleaned;
          this.setSelectionRange(pos - 1, pos - 1);
        }
      });
    });

    // Auto-ID from name (new items)
    if (isNew) {
      var nameEl    = modal.querySelector('#ieName');
      var idHidden  = modal.querySelector('#ieId');
      var idPreview = modal.querySelector('#ieIdPreview');
      if (nameEl) nameEl.addEventListener('input', function () {
        var slug   = _slugify(nameEl.value);
        var unique = _makeUniqueId(slug);
        if (idHidden)  idHidden.value = unique;
        if (idPreview) idPreview.textContent = unique || 'enter a name…';
      });
    }

    // Two-way sync
    var dirtyEPEl  = modal.querySelector('#ieDirtyEP');
    var spendOrdEl = modal.querySelector('#ieSpendOrder');
    if (dirtyEPEl && spendOrdEl) {
      dirtyEPEl.addEventListener('change', function () {
        if (dirtyEPEl.value === 'false') {
          spendOrdEl.value = 'clean_only';
        } else {
          if (spendOrdEl.value === 'clean_only') spendOrdEl.value = 'clean_first';
        }
      });
      spendOrdEl.addEventListener('change', function () {
        if (spendOrdEl.value === 'clean_only') {
          dirtyEPEl.value = 'false';
        } else {
          dirtyEPEl.value = 'true';
        }
      });
    }


    // Variant dirty EP / spend order sync
    _ieVariants.forEach(function (v, i) {
      var vDirty = modal.querySelector('#ieVarDirtyEP_' + i);
      var vSpend = modal.querySelector('#ieVarSpendOrder_' + i);
      if (vDirty && vSpend) {
        vDirty.addEventListener('change', function () {
          if (vDirty.value === 'false') vSpend.value = 'clean_only';
          else if (vSpend.value === 'clean_only') vSpend.value = 'clean_first';
        });
        vSpend.addEventListener('change', function () {
          if (vSpend.value === 'clean_only') vDirty.value = 'false';
          else vDirty.value = 'true';
        });
      }
      // Variant cooldown type
      var vCdTypeEl = modal.querySelector('#ieVarCdType_' + i);
      var vCdNumEl  = modal.querySelector('#ieVarCdNum_' + i);
      if (vCdTypeEl && vCdNumEl) {
        vCdTypeEl.addEventListener('change', function () {
          var needs = vCdTypeEl.value === 'days' || vCdTypeEl.value === 'cycles';
          vCdNumEl.style.display = needs ? '' : 'none';
        });
      }
    });

    // Cooldown type -> show/hide number
    var cdTypeEl = modal.querySelector('#ieCooldownType');
    var cdNumEl  = modal.querySelector('#ieCooldownNum');
    if (cdTypeEl && cdNumEl) {
      cdTypeEl.addEventListener('change', function () {
        var needs = cdTypeEl.value === 'days' || cdTypeEl.value === 'cycles';
        cdNumEl.style.display = needs ? '' : 'none';
      });
    }

    // Auction duration type -> show/hide hours input
    var durTypeEl = modal.querySelector('#ieDurType');
    var durNumEl  = modal.querySelector('#ieDurHrs');
    if (durTypeEl && durNumEl) {
      durTypeEl.addEventListener('change', function () {
        durNumEl.style.display = durTypeEl.value === 'eoc_minus_2' ? 'none' : '';
      });
    }

    // Category tag input
    _ieCatTags = [];
    var catContainer = modal.querySelector('#ieCatContainer');
    var catGhost     = modal.querySelector('#ieCatGhost');
    var catHidden    = modal.querySelector('#ieCategory');
    // seed from existing pills rendered in HTML
    catContainer.querySelectorAll('.ie-tag-pill').forEach(function (pill) {
      var text = pill.firstChild.textContent.trim();
      if (text) _ieCatTags.push(text);
    });
    _ieCatSyncHidden(catHidden);

    function _catAddTag(val) {
      val = val.replace(/,/g, '').trim().slice(0, 25);
      if (!val) return;
      var exists = _ieCatTags.some(function (t) { return t.toLowerCase() === val.toLowerCase(); });
      if (exists || _ieCatTags.length >= 10) return;
      _ieCatTags.push(val);
      var pill = document.createElement('span');
      pill.className = 'ie-tag-pill';
      pill.textContent = val;
      var x = document.createElement('button');
      x.type = 'button'; x.className = 'ie-tag-x'; x.innerHTML = '&times;';
      x.addEventListener('click', function () {
        var idx = _ieCatTags.indexOf(val);
        if (idx !== -1) _ieCatTags.splice(idx, 1);
        pill.remove();
        _ieCatSyncHidden(catHidden);
        _catUpdatePlaceholder();
      });
      pill.appendChild(x);
      catContainer.insertBefore(pill, catGhost);
      catGhost.value = '';
      _ieCatSyncHidden(catHidden);
      _catUpdatePlaceholder();
    }

    function _catUpdatePlaceholder() {
      catGhost.placeholder = _ieCatTags.length ? '' : 'Type and press Space or Enter\u2026';
    }

    // bind × buttons on existing pills
    catContainer.querySelectorAll('.ie-tag-x').forEach(function (x) {
      x.addEventListener('click', function () {
        var pill = x.parentNode;
        var text = pill.firstChild.textContent.trim();
        var idx = _ieCatTags.indexOf(text);
        if (idx !== -1) _ieCatTags.splice(idx, 1);
        pill.remove();
        _ieCatSyncHidden(catHidden);
        _catUpdatePlaceholder();
      });
    });

    catGhost.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === ',') {
        e.preventDefault();
        _catAddTag(catGhost.value);
      } else if (e.key === 'Backspace' && !catGhost.value && _ieCatTags.length) {
        var last = catContainer.querySelectorAll('.ie-tag-pill');
        if (last.length) {
          var pill = last[last.length - 1];
          var text = pill.firstChild.textContent.trim();
          var idx = _ieCatTags.indexOf(text);
          if (idx !== -1) _ieCatTags.splice(idx, 1);
          pill.remove();
          _ieCatSyncHidden(catHidden);
          _catUpdatePlaceholder();
        }
      }
    });

    catGhost.addEventListener('blur', function () {
      if (catGhost.value.trim()) _catAddTag(catGhost.value);
    });

    catContainer.addEventListener('click', function (e) {
      if (e.target === catContainer) catGhost.focus();
    });

    // Variant tab bar
    (function () {
      var tabsEl = modal.querySelector('#ieVariantTabs');
      if (!tabsEl) return;

      function _renumberVariants() {
        _ieVariants.forEach(function (v, i) {
          v.label = 'Variant ' + (i + 1);
        });
      }

      function _rebuildTabBar(item, isNew, skipSave) {
        if (!skipSave) _ieSaveVariantData(modal);
        var _sg = _snapshotGeneral();
        modal.innerHTML = _buildItemEditorHtml(item || null, isNew || false);
        _ieTypeToggle(modal);
        _bindItemEditorEvents(modal, item || null, isNew || false);
        _restoreGeneral(_sg);
      }

      function _removeVariant(ri) {
        if (_ieVariants.length <= 1) return;
        _ieSaveVariantData(modal); // save with original indices before splice
        _ieVariants.splice(ri, 1);
        if (_ieActiveVariant === ri) _ieActiveVariant = -1;
        else if (_ieActiveVariant > ri) _ieActiveVariant--;
        _renumberVariants();
        _rebuildTabBar(origItem, isNew, true);
      }

      // Tab click (switch) + × remove
      tabsEl.addEventListener('click', function (e) {
        var removeBtn = e.target.closest('[data-variant-remove]');
        if (removeBtn) {
          e.stopPropagation();
          _removeVariant(parseInt(removeBtn.dataset.variantRemove));
          return;
        }
        var tab = e.target.closest('.ie-variant-tab[data-variant-idx]');
        if (tab) {
          var idx = parseInt(tab.dataset.variantIdx);
          if (idx === _ieActiveVariant) return;
          _ieSaveVariantData(modal);
          _ieActiveVariant = idx;
          tabsEl.querySelectorAll('.ie-variant-tab').forEach(function (t) {
            t.classList.toggle('ie-variant-tab--active',
              parseInt(t.dataset.variantIdx) === _ieActiveVariant);
          });
          // Switch tab panels
          modal.querySelectorAll('.ie-tab-panel').forEach(function (p) {
            p.style.display = parseInt(p.dataset.iePanel) === _ieActiveVariant ? '' : 'none';
          });
          // Show Type field only on General tab
          var typeField = modal.querySelector('#ieTypeField');
          if (typeField) typeField.style.display = _ieActiveVariant === -1 ? '' : 'none';
          // Show Basic Info only on General tab
          var basicInfo = modal.querySelector('#ieBasicInfo');
          if (basicInfo) basicInfo.style.display = _ieActiveVariant === -1 ? '' : 'none';
        }
      });

      // Middle-click to remove a variant tab
      tabsEl.addEventListener('auxclick', function (e) {
        if (e.button !== 1) return; // only middle click
        var tab = e.target.closest('.ie-variant-tab[data-variant-idx]');
        if (!tab) return;
        var idx = parseInt(tab.dataset.variantIdx);
        if (idx < 0) return; // cannot remove General
        e.preventDefault();
        _removeVariant(idx);
      });

      // Add Variant button
      var addBtn = tabsEl.querySelector('#ieAddVariant');
      if (addBtn) addBtn.addEventListener('click', function () {
        var _typeEl = modal.querySelector('#ieType');
        if ((1 + _ieVariants.length) >= _IE_MAX_TABS || (_typeEl && _typeEl.value === 'auction')) return;
        _ieSaveVariantData(modal); // save current variant before switching
        _ieVariants.push({ id: 'v' + Date.now(), label: 'Variant ' + (_ieVariants.length + 1), data: { name: '', price: '', stock: '', max_quantity: '', accepts_dirty_ep: 'true', spend_order: 'clean_first', cooldown_type: 'none', cooldown_num: '1', activate_at: '', deactivate_at: '', active: 'true' } });
        _ieActiveVariant = _ieVariants.length - 1;
        _rebuildTabBar(origItem, isNew, true);
      });


      // Prevent middle-click default (new-tab, paste) on the whole tab bar
      tabsEl.addEventListener('mousedown', function (e) {
        if (e.button === 1) e.preventDefault();
      });

    })();

    // Rank chips
    modal.querySelectorAll('.ie-rank-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var s = parseInt(chip.dataset.state) || 0;
        chip.dataset.state = s === 0 ? 1 : (s === 1 ? -1 : 0);
      });
    });

    // Multi-image management
    _ieImages = [];
    var imgList     = modal.querySelector('#ieImgList');
    var imgAddBtn   = modal.querySelector('#ieImgAdd');
    var imgFileInput = modal.querySelector('#ieImgFile');

    // Seed from existing item
    if (origItem) {
      var existImgs = origItem.images || (origItem.image ? [origItem.image] : []);
      existImgs.forEach(function (url) {
        if (url) _ieImages.push({ name: url.split('/').pop() || url, url: url });
      });
    }
    _ieRenderImageList(imgList);

    // Upload button
    if (imgAddBtn && imgFileInput) {
      imgAddBtn.addEventListener('click', function () { imgFileInput.click(); });
      imgFileInput.addEventListener('change', function () {
        var file = imgFileInput.files[0];
        if (file) _ieUploadMultiImage(file, imgList);
        imgFileInput.value = '';
      });
    }

    // Row actions (event delegation)
    if (imgList) {
      imgList.addEventListener('click', function (e) {
        var row = e.target.closest('.ie-img-row');
        if (!row) return;
        var idx = parseInt(row.dataset.idx);
        var tmp;
        if (e.target.closest('.ie-img-row-up') && idx > 0) {
          tmp = _ieImages[idx]; _ieImages[idx] = _ieImages[idx - 1]; _ieImages[idx - 1] = tmp;
          _ieRenderImageList(imgList);
        } else if (e.target.closest('.ie-img-row-down') && idx < _ieImages.length - 1) {
          tmp = _ieImages[idx]; _ieImages[idx] = _ieImages[idx + 1]; _ieImages[idx + 1] = tmp;
          _ieRenderImageList(imgList);
        } else if (e.target.closest('.ie-img-row-remove')) {
          _ieImages.splice(idx, 1);
          _ieRenderImageList(imgList);
        }
      });
    }

    // delete (edit mode only)
    var delBtn = modal.querySelector('#ieDelete');
    if (delBtn) {
      delBtn.addEventListener('click', function () {
        var id = origItem && origItem.id;
        if (!id) return;
        if (!confirm('Permanently delete \u201c' + (origItem.name || id) + '\u201d?')) return;
        delBtn.disabled = true; delBtn.textContent = 'Deleting\u2026';
        apiDelete('/api/admin/shop/items/' + encodeURIComponent(id))
          .then(function (res) {
            if (res.ok && res.data.ok) {
              showToast('\u2713 ' + id + ' deleted.', 'success');
              _items = (_items || []).filter(function (it) { return it.id !== id; });
              modal.classList.remove('ie-modal');
              closeModal();
              var c = document.getElementById('saContent');
              if (c) renderItemsTable(c);
              _notifyShopUpdated();
            } else {
              showToast('\u26a0 ' + (res.data.error || 'Delete failed'), 'warn');
              delBtn.disabled = false; delBtn.textContent = 'Delete Item';
            }
          })
          .catch(function () { showToast('\u26a0 Network error', 'warn'); delBtn.disabled = false; delBtn.textContent = 'Delete Item'; });
      });
    }

    // submit
    modal.querySelector('#ieSubmit').addEventListener('click', function () {
      var btn = this;
      var fields = _ieCollect(modal);
      if (!fields.name) { showToast('\u26a0 Name is required.', 'warn'); return; }
      if (isNew && !fields.id) { showToast('\u26a0 ID is required.', 'warn'); return; }
      // Validate Accepts Dirty EP / Spend Order consistency
      if (fields.variants && fields.variants.length) {
        // Per-variant validation
        for (var _vi = 0; _vi < fields.variants.length; _vi++) {
          var _vf = fields.variants[_vi];
          var _vLabel = _vf.name || _vf.label || ('Variant ' + (_vi + 1));
          // Multi-variant: require display name
          if (fields.variants.length > 1 && !(_vf.name || '').trim()) {
            showToast('\u26a0 ' + (_vf.label || 'Variant ' + (_vi + 1)) + ': Display name is required.', 'warn'); return;
          }
          var _vAccepts = _vf.accepts_dirty_ep !== 'false' && _vf.accepts_dirty_ep !== false;
          var _vSo = _vf.spend_order;
          if (!_vAccepts && _vSo !== 'clean_only') {
            showToast('\u26a0 ' + _vLabel + ': Accepts Dirty EP is No but spend order is not Clean Only.', 'warn'); return;
          }
          if (_vSo === 'clean_only' && _vAccepts) {
            showToast('\u26a0 ' + _vLabel + ': Spend order is Clean Only but Accepts Dirty EP is Yes.', 'warn'); return;
          }
        }
      } else {
        var _acceptsDirty = fields.accepts_dirty_ep !== 'false' && fields.accepts_dirty_ep !== false;
        var _so = fields.spend_order;
        if (!_acceptsDirty && _so !== 'clean_only') {
          showToast('\u26a0 \'Accepts Dirty EP\' is No but spend order is not \'Clean Only\'. Please fix this.', 'warn'); return;
        }
        if (_so === 'clean_only' && _acceptsDirty) {
          showToast('\u26a0 Spend order is \'Clean Only\' but \'Accepts Dirty EP\' is Yes. Please fix this.', 'warn'); return;
        }
      }

      btn.disabled = true; btn.textContent = isNew ? 'Creating\u2026' : 'Saving\u2026';
      var req = isNew
        ? apiPost('/api/admin/shop/items', fields)
        : apiPut('/api/admin/shop/items/' + encodeURIComponent(origItem.id), fields);

      req.then(function (res) {
        if (res.ok && res.data.ok) {
          showToast('\u2713 Item ' + (isNew ? 'created' : 'saved') + '.', 'success');
          // update local cache
          var updated = res.data.item;
          if (isNew) {
            _items = (_items || []).concat([updated]);
          } else {
            _items = (_items || []).map(function (it) { return it.id === updated.id ? updated : it; });
          }
          modal.classList.remove('ie-modal');
          closeModal();
          var c = document.getElementById('saContent');
          if (c) renderItemsTable(c);
          _notifyShopUpdated();
        } else {
          showToast('\u26a0 ' + (res.data.error || 'Save failed'), 'warn');
          btn.disabled = false; btn.textContent = isNew ? 'Create Item' : 'Save Changes';
        }
      })
      .catch(function () {
        showToast('\u26a0 Network error', 'warn');
        btn.disabled = false; btn.textContent = isNew ? 'Create Item' : 'Save Changes';
      });
    });
  }

  /* Fulfillment Queue */
  var _queueData   = null;
  var _queueFilter = 'all';    // 'all' | 'purchases' | 'donations'
  var _queueSort   = 'oldest'; // 'oldest' | 'newest'

  function fetchQueue(cb) {
    fetch('/api/admin/shop/queue', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) _queueData = d; if (cb) cb(d); })
      .catch(function () { if (cb) cb(null); });
  }

  function renderQueue(c) {
    if (!_queueData) {
      c.innerHTML = '<div class="shop-loading"><span class="loading-spinner"></span> Loading queue\u2026</div>';
      fetchQueue(function (d) {
        if (_activeTab !== 'queue') return;
        if (!d) { c.innerHTML = '<div class="shop-empty">Could not load queue.</div>'; return; }
        renderQueueContent(c);
        updateQueueBadge();
      });
      return;
    }
    renderQueueContent(c);
  }

  function updateQueueBadge() {
    var btn = document.querySelector('#saTabs [data-tab="queue"]');
    if (!_shopEnabled) { _clearQueueBadges(); return; }
    if (!_queueData) return;
    var count = (_queueData.purchases || []).length + (_queueData.refund_requests || []).length + (_queueData.donations || []).length;

    // badge on the Queue tab inside the panel
    if (btn) {
      var badge = btn.querySelector('.sa-badge');
      if (count > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'sa-badge';
          btn.appendChild(badge);
        }
        badge.textContent = count;
      } else if (badge) {
        badge.remove();
      }
    }

    // badge on the Manage Shop sidebar nav item (same style as the events badge)
    var navItem = document.querySelector('[data-panel="shop-admin"]');
    if (navItem) {
      var navBadge = navItem.querySelector('.nav-upcoming-badge');
      if (count > 0) {
        if (!navBadge) {
          navBadge = document.createElement('span');
          navBadge.className = 'nav-upcoming-badge';
          navBadge.setAttribute('aria-hidden', 'true');
          navItem.appendChild(navBadge);
        }
        navBadge.textContent = count > 9 ? '9+' : String(count);
        navItem.setAttribute('title', count + ' pending item' + (count === 1 ? '' : 's') + ' in queue');
      } else {
        if (navBadge) navBadge.remove();
        navItem.removeAttribute('title');
      }
    }
  }

  function _queueMerged() {
    var merged = [];
    ((_queueData && _queueData.purchases) || []).forEach(function (p) {
      merged.push({ type: 'purchase', date: p.purchased_at, id: p.purchase_id, data: p });
    });
    ((_queueData && _queueData.refund_requests) || []).forEach(function (p) {
      merged.push({ type: 'refund', date: p.purchased_at, id: p.purchase_id, data: p });
    });
    ((_queueData && _queueData.donations) || []).forEach(function (d) {
      merged.push({ type: 'donation', date: d.submitted_at, id: d.ticket_id, data: d });
    });
    merged.sort(function (a, b) {
      var cmp = (a.date || '').localeCompare(b.date || '');
      return _queueSort === 'newest' ? -cmp : cmp;
    });
    return merged;
  }

  function renderQueueContent(c) {
    var pCount = ((_queueData && _queueData.purchases) || []).length;
    var dCount = ((_queueData && _queueData.donations) || []).length;
    var rCount = ((_queueData && _queueData.refund_requests) || []).length;
    var total  = pCount + rCount + dCount;
    var html = '';
    html += '<div class="sa-q-filters">' +
      '<button class="sa-q-pill' + (_queueFilter === 'all' ? ' active' : '') + '" data-qf="all">All <span class="sa-q-count">' + total + '</span></button>' +
      '<button class="sa-q-pill' + (_queueFilter === 'purchases' ? ' active' : '') + '" data-qf="purchases">Pending <span class="sa-q-count">' + pCount + '</span></button>' +
      '<button class="sa-q-pill' + (_queueFilter === 'refunds' ? ' active' : '') + '" data-qf="refunds">Refund Requests <span class="sa-q-count">' + rCount + '</span></button>' +
      '<button class="sa-q-pill' + (_queueFilter === 'donations' ? ' active' : '') + '" data-qf="donations">Donations <span class="sa-q-count">' + dCount + '</span></button>' +
      '<span class="sa-q-sort" id="saQueueSort">' + (_queueSort === 'oldest' ? 'Oldest first' : 'Newest first') + '</span>' +
    '</div>';

    var merged = _queueMerged();

    html += '<div id="saQueueList">';
    if (!merged.length) {
      html += '<div class=\"shop-empty sa-q-empty\">No items in queue</div>';
    } else {
      merged.forEach(function (item) {
        var filterMap = { purchase: 'purchases', refund: 'refunds', donation: 'donations' };
        var hidden = _queueFilter !== 'all' && _queueFilter !== filterMap[item.type];
        html += _buildQueueCard(item, hidden);
      });
    }
    html += '</div>';
    c.innerHTML = html;

    /* Bind filter pills + sort toggle */
    c.querySelector('.sa-q-filters').addEventListener('click', function (e) {
      var pill = e.target.closest('.sa-q-pill');
      if (pill) {
        _queueFilter = pill.dataset.qf;
        c.querySelectorAll('.sa-q-pill').forEach(function (p) { p.classList.remove('active'); });
        pill.classList.add('active');
        _applyQueueFilter();
        return;
      }
      var sort = e.target.closest('.sa-q-sort');
      if (sort) {
        _queueSort = _queueSort === 'oldest' ? 'newest' : 'oldest';
        sort.textContent = _queueSort === 'oldest' ? 'Oldest first' : 'Newest first';
        _resortQueue();
      }
    });

    var list = document.getElementById('saQueueList');
    if (list) bindQueueActions(list);
  }

  function _buildQueueCard(item, hidden) {
    var d = item.data;
    var isPurchase = item.type === 'purchase';
    var isRefund = item.type === 'refund';

    var html = '<div class="sa-q-card' + (hidden ? ' sa-q-hidden' : '') +
      '" data-qtype="' + item.type +
      '" data-qid="' + esc(item.id) +
      '" data-qdate="' + esc(item.date) + '">';

    /* Header */
    html += '<div class="sa-q-header"><div class="sa-q-header-left">';
    html += '<span class="sa-q-user">' + esc(d.username) + '</span>';
    html += '<div class="sa-q-tags">';
    if (isPurchase || isRefund) {
      html += isRefund
        ? '<span class="sa-q-type sa-q-type--refund">Refund Request</span>'
        : '<span class="sa-q-type sa-q-type--purchase">Shop item</span>';
      var slugText = esc(d.item_id);
      try { if (d.quantity && d.quantity > 1) slugText += ' \u00d7' + d.quantity; } catch (ignore) {}
      html += '<span class="sa-q-slug">' + slugText + '</span>';
    } else {
      html += '<span class="sa-q-type sa-q-type--donation">Donation</span>';
      html += '<span class="sa-q-slug">' + num(d.le_amount) + ' LE declared</span>';
    }
    html += '</div></div>';
    html += '<span class="sa-q-date">' + fmtDate(item.date) + '</span>';
    html += '</div>';

    /* Metrics */
    html += '<div class="sa-q-metrics">';
    if (isPurchase || isRefund) {
      html += '<div class="sa-q-metric"><span class="sa-q-metric-label">Total</span>' +
        '<span class="sa-q-metric-value sa-q-val--total">' + num(d.ep_spent) + ' EP</span></div>';
      html += '<div class="sa-q-metric"><span class="sa-q-metric-label">Clean</span>' +
        '<span class="sa-q-metric-value sa-q-val--clean">' + num(d.clean_ep_spent) + ' EP</span></div>';
      html += '<div class="sa-q-metric"><span class="sa-q-metric-label">Dirty</span>' +
        '<span class="sa-q-metric-value sa-q-val--dirty">' + num(d.dirty_ep_spent) + ' EP</span></div>';
    } else {
      html += '<div class="sa-q-metric"><span class="sa-q-metric-label">EP to grant</span>' +
        '<span class="sa-q-metric-value sa-q-val--dirty">' + num(d.dirty_ep_to_grant) + ' EP</span></div>';
      html += '<div class="sa-q-metric"><span class="sa-q-metric-label">Type</span>' +
        '<span class="sa-q-metric-value sa-q-val--dirty">Dirty</span></div>';
      html += '<div class="sa-q-metric"><span class="sa-q-metric-label">Declared</span>' +
        '<span class="sa-q-metric-value">' + num(d.le_amount) + ' LE</span></div>';
    }
    html += '</div>';

    /* Fulfillment note */
    if ((isPurchase || isRefund) && d.fulfillment_note) {
      html += '<div class="sa-q-note">' + _svg.pin + ' ' + esc(d.fulfillment_note) + '</div>';
    }
    if (isRefund && d.chief_note) {
      html += '<div class="sa-q-note"><strong>Reason:</strong> ' + esc(d.chief_note) + '</div>';
    }

    /* Actions */
    if (_canChiefEditShopAdmin()) {
      html += '<div class="sa-q-actions">';
      if (isPurchase) {
        html += '<button class="sa-q-btn sa-q-btn--primary" data-action="fulfill" data-type="purchase" data-id="' + esc(d.purchase_id) + '">Mark fulfilled</button>';
        html += '<button class="sa-q-btn sa-q-btn--reject" data-action="reject" data-type="purchase" data-id="' + esc(d.purchase_id) + '">Reject</button>';
      } else if (isRefund) {
        html += '<button class="sa-q-btn sa-q-btn--primary" data-action="approve-refund" data-id="' + esc(d.purchase_id) + '">Approve Refund</button>';
        html += '<button class="sa-q-btn sa-q-btn--reject" data-action="reject-refund" data-id="' + esc(d.purchase_id) + '">Deny</button>';
      } else {
        html += '<button class="sa-q-btn sa-q-btn--primary" data-action="fulfill" data-type="donation" data-id="' + esc(d.ticket_id) + '">Confirm</button>';
        html += '<button class="sa-q-btn sa-q-btn--reject" data-action="reject" data-type="donation" data-id="' + esc(d.ticket_id) + '">Reject</button>';
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  function _applyQueueFilter() {
    document.querySelectorAll('.sa-q-card').forEach(function (card) {
      var t = card.dataset.qtype;
    var match = _queueFilter === 'all' ||
        (_queueFilter === 'purchases' && t === 'purchase') ||
        (_queueFilter === 'refunds' && t === 'refund') ||
        (_queueFilter === 'donations' && t === 'donation');
      card.classList.toggle('sa-q-hidden', !match);
    });
    _checkQueueEmpty();
  }

  function _resortQueue() {
    var list = document.getElementById('saQueueList');
    if (!list) return;
    var cards = Array.from(list.querySelectorAll('.sa-q-card'));
    cards.sort(function (a, b) {
      var cmp = (a.dataset.qdate || '').localeCompare(b.dataset.qdate || '');
      return _queueSort === 'newest' ? -cmp : cmp;
    });
    cards.forEach(function (card) { list.appendChild(card); });
  }

  function _updateQueuePillCounts() {
    var pCount = ((_queueData && _queueData.purchases) || []).length;
    var rCount = ((_queueData && _queueData.refund_requests) || []).length;
    var dCount = ((_queueData && _queueData.donations) || []).length;
    document.querySelectorAll('.sa-q-pill').forEach(function (p) {
      var cnt = p.querySelector('.sa-q-count');
      if (!cnt) return;
      var f = p.dataset.qf;
      if (f === 'all') cnt.textContent = pCount + rCount + dCount;
      else if (f === 'purchases') cnt.textContent = pCount;
      else if (f === 'refunds') cnt.textContent = rCount;
      else if (f === 'donations') cnt.textContent = dCount;
    });
  }

  function _checkQueueEmpty() {
    var list = document.getElementById('saQueueList');
    if (!list) return;
    var visible = list.querySelectorAll('.sa-q-card:not(.sa-q-hidden)');
    var allDone = true;
    visible.forEach(function (c) { if (c.style.pointerEvents !== 'none') allDone = false; });
    var empty = list.querySelector('.sa-q-empty');
    if (allDone && !empty) {
      var div = document.createElement('div');
      div.className = 'shop-empty sa-q-empty';
      div.textContent = 'No items in queue';
      list.appendChild(div);
    } else if (!allDone && empty) {
      empty.remove();
    }
  }

  function bindQueueActions(el) {
    el.querySelectorAll('.sa-q-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.dataset.action;
        var type   = btn.dataset.type;
        var id     = btn.dataset.id;
        if (action === 'fulfill') openFulfillModal(type, id, btn);
        else if (action === 'reject') openRejectModal(type, id, btn);
        else if (action === 'approve-refund') openRefundModal(id, btn);
        else if (action === 'reject-refund') _rejectRefund(id, btn);
      });
    });
  }

  function openRefundModal(purchaseId, triggerBtn) {
    var modal = document.getElementById('saModal');
    modal.innerHTML =
      '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>' +
      '<div class="shop-modal-title">Approve Refund</div>' +
      '<div class="shop-modal-body">' +
        '<p>Approve this refund request? The user\u2019s EP will be restored and stock will be incremented.</p>' +
        '<p style="color:var(--text-faint);font-size:0.75rem;margin:6px 0 0">The user will be notified via DM.</p>' +
      '</div>' +
      '<div class="shop-modal-actions">' +
        '<button class="shop-modal-btn shop-modal-btn--confirm" id="saRefundConfirm">Approve Refund</button>' +
      '</div>';
    document.getElementById('saModalBackdrop').classList.add('open');
    document.getElementById('saRefundConfirm').addEventListener('click', function () {
      var confirmBtn = this;
      confirmBtn.disabled = true; confirmBtn.textContent = 'Processing\u2026';
      apiPost('/api/admin/shop/queue/refund', { purchase_id: purchaseId })
        .then(function (res) {
          if (res.ok && res.data.ok) {
            showToast('\u2713 Refund approved.', 'success');
            closeModal();
            var card = triggerBtn.closest('.sa-q-card');
            if (card) { card.style.opacity = '0.3'; card.style.pointerEvents = 'none'; }
            if (_queueData && _queueData.refund_requests) {
              _queueData.refund_requests = _queueData.refund_requests.filter(function (p) { return p.purchase_id !== purchaseId; });
            }
            _updateQueuePillCounts();
            _checkQueueEmpty();
          } else {
            showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn');
            confirmBtn.disabled = false; confirmBtn.textContent = 'Approve Refund';
          }
        })
        .catch(function () { showToast('\u26a0 Network error', 'warn'); confirmBtn.disabled = false; confirmBtn.textContent = 'Approve Refund'; });
    });
  }

  function _rejectRefund(purchaseId, triggerBtn) {
    triggerBtn.disabled = true; triggerBtn.textContent = 'Denying\u2026';
    apiPost('/api/admin/shop/queue/refund/reject', { purchase_id: purchaseId })
      .then(function (res) {
        if (res.ok && res.data.ok) {
          showToast('\u2713 Refund denied.', 'success');
          var card = triggerBtn.closest('.sa-q-card');
          if (card) { card.style.opacity = '0.3'; card.style.pointerEvents = 'none'; }
          if (_queueData && _queueData.refund_requests) {
            _queueData.refund_requests = _queueData.refund_requests.filter(function (p) { return p.purchase_id !== purchaseId; });
          }
          _updateQueuePillCounts();
          _checkQueueEmpty();
        } else {
          showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn');
          triggerBtn.disabled = false; triggerBtn.textContent = 'Deny';
        }
      })
      .catch(function () { showToast('\u26a0 Network error', 'warn'); triggerBtn.disabled = false; triggerBtn.textContent = 'Deny'; });
  }

  function openFulfillModal(type, id, triggerBtn) {
    var modal = document.getElementById('saModal');
    var label = type === 'purchase' ? 'Mark Fulfilled' : 'Confirm Donation';
    modal.innerHTML =
      '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>' +
      '<div class="shop-modal-title">' + label + '</div>' +
      '<div class="shop-modal-body">' +
        '<label class="shop-modal-input-label">Note (optional)</label>' +
        '<textarea class="shop-modal-input" id="saFulfillNote" placeholder="Optional note\u2026" maxlength="50" rows="2"></textarea>' +
      '</div>' +
      '<div class="shop-modal-actions">' +
        '<button class="shop-modal-btn shop-modal-btn--confirm" id="saFulfillConfirm">' + label + '</button>' +
      '</div>';
    document.getElementById('saModalBackdrop').classList.add('open');
    document.getElementById('saFulfillConfirm').addEventListener('click', function () {
      var note = document.getElementById('saFulfillNote').value.trim();
      var confirmBtn = this;
      confirmBtn.disabled = true; confirmBtn.textContent = 'Processing\u2026';
      apiPost('/api/admin/shop/queue/fulfill', { type: type, ticket_id: id, note: note || null })
        .then(function (res) {
          if (res.ok && res.data.ok) {
            showToast('\u2713 ' + (type === 'purchase' ? 'Purchase' : 'Donation') + ' fulfilled.', 'success');
            closeModal();
            var card = triggerBtn.closest('.sa-q-card');
            if (card) { card.style.opacity = '0.3'; card.style.pointerEvents = 'none'; }
            var dataList = type === 'purchase' ? _queueData.purchases : _queueData.donations;
            var key = type === 'purchase' ? 'purchase_id' : 'ticket_id';
            if (dataList) {
              for (var i = dataList.length - 1; i >= 0; i--) { if (dataList[i][key] === id) dataList.splice(i, 1); }
            }
            updateQueueBadge();
            _updateQueuePillCounts();
            _checkQueueEmpty();
          } else {
            showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn');
            confirmBtn.disabled = false; confirmBtn.textContent = label;
          }
        })
        .catch(function () { showToast('\u26a0 Network error', 'warn'); confirmBtn.disabled = false; confirmBtn.textContent = label; });
    });
  }

  function openRejectModal(type, id, triggerBtn) {
    var modal = document.getElementById('saModal');
    modal.innerHTML =
      '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>' +
      '<div class="shop-modal-title">Reject ' + (type === 'purchase' ? 'Purchase' : 'Donation') + '</div>' +
      '<div class="shop-modal-body">' +
        '<label class="shop-modal-input-label">Reason (required)</label>' +
        '<textarea class="shop-modal-input" id="saRejectReason" placeholder="Reason for rejection\u2026" maxlength="50" rows="2"></textarea>' +
      '</div>' +
      '<div class="shop-modal-actions">' +
        '<button class="shop-modal-btn shop-modal-btn--cancel" id="saRejectConfirm" style="color:var(--danger);border-color:var(--danger);">Reject</button>' +
      '</div>';
    document.getElementById('saModalBackdrop').classList.add('open');
    document.getElementById('saRejectConfirm').addEventListener('click', function () {
      var reason = document.getElementById('saRejectReason').value.trim();
      if (!reason) { showToast('\u26a0 Reason is required.', 'warn'); return; }
      var rejectBtn = this;
      rejectBtn.disabled = true; rejectBtn.textContent = 'Rejecting\u2026';
      apiPost('/api/admin/shop/queue/reject', { type: type, ticket_id: id, reason: reason })
        .then(function (res) {
          if (res.ok && res.data.ok) {
            showToast('\u2713 ' + (type === 'purchase' ? 'Purchase' : 'Donation') + ' rejected.', 'success');
            closeModal();
            var card = triggerBtn.closest('.sa-q-card');
            if (card) { card.style.opacity = '0.3'; card.style.pointerEvents = 'none'; }
            var dataList = type === 'purchase' ? _queueData.purchases : _queueData.donations;
            var key = type === 'purchase' ? 'purchase_id' : 'ticket_id';
            if (dataList) {
              for (var i = dataList.length - 1; i >= 0; i--) { if (dataList[i][key] === id) dataList.splice(i, 1); }
            }
            updateQueueBadge();
            _updateQueuePillCounts();
            _checkQueueEmpty();
          } else {
            showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn');
            rejectBtn.disabled = false; rejectBtn.textContent = 'Reject';
          }
        })
        .catch(function () { showToast('\u26a0 Network error', 'warn'); rejectBtn.disabled = false; rejectBtn.textContent = 'Reject'; });
    });
  }

  /* Logs & History */
  var _logsData = null;
  var _logsFeed = null;
  var _logsPage = 1;
  var _logsFilters = { log_type: 'activity', username: '', item_id: '', type: '', status: '', date_from: '', date_to: '' };

  /* Changes log */
  var _changesData = null;
  var _changesPage = 1;
  var _changesFilters = { actor: '', action: '', target_id: '', date_from: '', date_to: '' };

  var _ACTION_LABELS = {
    item_created:       'Item Created',
    item_edited:        'Item Edited',
    item_deleted:       'Item Deleted',
    item_activated:     'Item Activated',
    item_deactivated:   'Item Deactivated',
    stock_updated:      'Stock Updated',
    items_reordered:    'Items Reordered',
    auction_started:    'Auction Started',
    auction_extended:   'Auction Extended',
    auction_cancelled:  'Auction Cancelled',
    bid_removed:        'Bid Removed',
    purchase_fulfilled: 'Purchase Fulfilled',
    purchase_refunded:  'Purchase Refunded',
    refund_rejected:    'Refund Denied',
    donation_confirmed: 'Donation Confirmed',
    donation_rejected:  'Donation Rejected',
    shop_enabled:       'Shop Enabled',
    shop_disabled:      'Shop Disabled',
    user_shop_banned:   'User Banned (Shop)',
    user_shop_unbanned: 'User Unbanned (Shop)',
    user_admin_banned:  'Admin Banned (Manage)',
    user_admin_unbanned:'Admin Unbanned (Manage)',
    ep_adjusted:        'EP Adjusted',
    purchase_rejected:  'Purchase Rejected',
    user_limits_changed:'User Limits Changed',
  };

  var _ACTION_TYPES = Object.keys(_ACTION_LABELS);

  function fetchChanges(cb) {
    var qs = 'page=' + _changesPage + '&per_page=25';
    if (_changesFilters.actor)     qs += '&actor='     + encodeURIComponent(_changesFilters.actor);
    if (_changesFilters.action)    qs += '&action='    + encodeURIComponent(_changesFilters.action);
    if (_changesFilters.target_id) qs += '&target_id=' + encodeURIComponent(_changesFilters.target_id);
    if (_changesFilters.date_from) qs += '&date_from=' + encodeURIComponent(_changesFilters.date_from);
    if (_changesFilters.date_to)   qs += '&date_to='   + encodeURIComponent(_changesFilters.date_to);
    fetch('/api/admin/shop/changes?' + qs, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) _changesData = d; if (cb) cb(d); })
      .catch(function () { if (cb) cb(null); });
  }

  function _fmtChangesTarget(row) {
    var d = row.details || {};
    var a = row.action;
    if (d.item_id) return esc(d.item_id);
    if (d.username) return esc(d.username);
    if (a === 'items_reordered') return (d.count || '?') + ' items';
    if (a === 'shop_enabled' || a === 'shop_disabled') return '\u2014';
    return esc(row.target_id || '\u2014');
  }

  function _fmtDiffVal(field, val) {
    if (val === null || val === undefined || val === '') {
      if (field === 'stock') return '\u221E';
      return 'none';
    }
    if (field === 'active' || field === 'accepts_dirty_ep' || field === 'auto_start')
      return val ? 'Yes' : 'No';
    if (typeof val === 'boolean') return val ? 'Yes' : 'No';
    if (Array.isArray(val)) return val.length ? val.join(', ') : 'none';
    if (field === 'duration_hours') return val + 'h';
    if (field === 'anti_snipe_seconds') return val + 's';
    var s = String(val);
    return s.length > 40 ? s.slice(0, 40) + '\u2026' : s;
  }

  var _DIFF_LABELS = {
    name: 'Name', type: 'Type', description: 'Desc', price: 'Price',
    stock: 'Stock', active: 'Active', category: 'Category', cooldown: 'Cooldown',
    starting_bid: 'Start Bid', min_increment: 'Min Inc', duration_hours: 'Duration',
    duration_type: 'Dur Type', anti_snipe_seconds: 'Anti-Snipe', winner_count: 'Winners',
    max_quantity: 'Max Qty', accepts_dirty_ep: 'Dirty EP', spend_order: 'Spend Order',
    visible_to_ranks: 'Ranks', visible_to_top_n: 'Top N', auto_start: 'Auto Start',
    activate_at: 'Activate', deactivate_at: 'Deactivate', images: 'Images',
  };

  function _fmtItemDiff(changes) {
    if (!changes || typeof changes !== 'object') return '';
    var keys = Object.keys(changes);
    if (!keys.length) return '';
    return keys.map(function (f) {
      var c = changes[f];
      var ov = Array.isArray(c) ? c[0] : (c && c.old);
      var nv = Array.isArray(c) ? c[1] : (c && c['new']);
      return '<span class="sa-chg-field">' + esc(_DIFF_LABELS[f] || f) + ':</span> ' +
        esc(_fmtDiffVal(f, ov)) + ' \u2192 ' + esc(_fmtDiffVal(f, nv));
    }).join(' \u00b7 ');
  }

  function _fmtChangesWhat(row) {
    var d = row.details || {};
    var a = row.action;
    if (a === 'item_edited') {
      if (d.changes) return _fmtItemDiff(d.changes);
      if (d.type) return 'type: ' + esc(d.type);
      return '\u2014';
    }
    if (a === 'item_created') {
      if (d.item) {
        var p = [];
        if (d.item.type) p.push('Type: ' + esc(d.item.type));
        if (d.item.price != null) p.push('Price: ' + num(d.item.price));
        if (d.item.stock != null) p.push('Stock: ' + num(d.item.stock));
        if (d.item.category) p.push('Cat: ' + esc(Array.isArray(d.item.category) ? d.item.category.join(', ') : d.item.category));
        return p.length ? p.join(' \u00b7 ') : 'type: ' + esc(d.type || '');
      }
      return d.type ? 'type: ' + esc(d.type) : '\u2014';
    }
    if (a === 'item_deleted') {
      var p = [];
      if (d.name) p.push(esc(d.name));
      if (d.type) p.push(esc(d.type));
      return p.join(' \u00b7 ') || '\u2014';
    }
    if (a === 'item_activated') return 'active \u2192 Yes';
    if (a === 'item_deactivated') return 'active \u2192 No';
    if (a === 'stock_updated') {
      var ov = d.old_stock != null ? num(d.old_stock) : '\u221E';
      var nv = d.new_stock != null ? num(d.new_stock) : '\u221E';
      return 'stock: ' + ov + ' \u2192 ' + nv;
    }
    if (a === 'items_reordered') return (d.count || '?') + ' items';
    if (a === 'auction_started') return d.ends_at ? 'ends ' + fmtDate(d.ends_at) : '\u2014';
    if (a === 'auction_extended') {
      var h = d.extra_hours > 0 ? '+' + d.extra_hours + 'h' : d.extra_hours + 'h';
      return h + (d.new_ends_at ? ' \u2192 ends ' + fmtDate(d.new_ends_at) : '');
    }
    if (a === 'auction_cancelled') return '\u2014';
    if (a === 'bid_removed') {
      var p = [];
      if (d.amount) p.push(num(d.amount) + ' EP');
      if (d.reason) p.push(esc(d.reason));
      return p.join(' \u00b7 ') || '\u2014';
    }
    if (a === 'purchase_fulfilled') {
      var p = [];
      if (d.ep_spent) p.push(num(d.ep_spent) + ' EP');
      if (d.username) p.push(esc(d.username));
      if (d.note) p.push(esc(d.note));
      return p.join(' \u00b7 ') || '\u2014';
    }
    if (a === 'purchase_rejected') {
      var p = [];
      if (d.username) p.push(esc(d.username));
      if (d.reason) p.push(esc(d.reason));
      if (d.ep_spent) p.push('refunded ' + num(d.ep_spent) + ' EP');
      return p.join(' \u00b7 ') || '\u2014';
    }
    if (a === 'purchase_refunded') {
      var p = [];
      if (d.ep_spent) p.push(num(d.ep_spent) + ' EP');
      if (d.reason) p.push(esc(d.reason));
      return p.join(' \u00b7 ') || '\u2014';
    }
    if (a === 'refund_rejected') return '\u2014';
    if (a === 'donation_confirmed') {
      var p = [];
      if (d.le_amount) p.push(num(d.le_amount) + ' LE');
      if (d.note) p.push(esc(d.note));
      return p.join(' \u00b7 ') || '\u2014';
    }
    if (a === 'donation_rejected') {
      var p = [];
      if (d.le_amount) p.push(num(d.le_amount) + ' LE');
      if (d.reason) p.push(esc(d.reason));
      return p.join(' \u00b7 ') || '\u2014';
    }
    if (a === 'shop_enabled') return 'Shop \u2192 On';
    if (a === 'shop_disabled') return 'Shop \u2192 Off';
    if (a === 'user_shop_banned' || a === 'user_admin_banned')
      return d.reason ? esc(d.reason) : '\u2014';
    if (a === 'user_shop_unbanned' || a === 'user_admin_unbanned') return '\u2014';
    if (a === 'user_limits_changed') {
      if (d.max_ep_per_cycle == null && d.max_purchases_per_cycle == null) return 'Limits cleared';
      var p = [];
      if (d.max_ep_per_cycle != null) p.push('Max EP/cycle: ' + num(d.max_ep_per_cycle));
      if (d.max_purchases_per_cycle != null) p.push('Max purchases/cycle: ' + num(d.max_purchases_per_cycle));
      return p.join(' \u00b7 ') || 'Limits cleared';
    }
    if (a === 'ep_adjusted') {
      var sign = (d.amount > 0) ? '+' : '';
      var ep = sign + num(d.amount) + ' ' + esc((d.ep_type || '').charAt(0).toUpperCase() + (d.ep_type || '').slice(1)) + ' EP';
      return d.reason ? ep + ' \u00b7 ' + esc(d.reason) : ep;
    }
    return '\u2014';
  }

  function renderChangesContent(c) {
    if (!_changesData) { c.innerHTML = '<div class="shop-empty">Could not load changes.</div>'; return; }
    var html = '';

    // filter bar
    html += '<div class="sa-filter-bar">';
    html += '<select class="sa-filter-input" id="saLogTypeView">' +
      '<option value="activity">Activity</option>' +
      '<option value="changes" selected>Changes</option>' +
      '</select>';
    html += '<input class="sa-filter-input" id="saChgActor" placeholder="Actor" maxlength="64" value="' + esc(_changesFilters.actor) + '" />';
    html += '<input class="sa-filter-input" id="saChgTarget" placeholder="Target ID" maxlength="64" value="' + esc(_changesFilters.target_id) + '" />';
    html += '<select class="sa-filter-input" id="saChgAction"><option value="">All actions</option>' +
      _ACTION_TYPES.map(function (a) {
        return '<option value="' + esc(a) + '"' + (_changesFilters.action === a ? ' selected' : '') + '>' +
          esc(_ACTION_LABELS[a] || a) + '</option>';
      }).join('') + '</select>';
    html += '<span class="sa-filter-label">From:</span><input type="date" class="sa-filter-input" id="saChgFrom" value="' + esc(_changesFilters.date_from) + '" />';
    html += '<span class="sa-filter-label">To:</span><input type="date" class="sa-filter-input" id="saChgTo" value="' + esc(_changesFilters.date_to) + '" />';
    html += '<button class="shop-modal-btn shop-modal-btn--confirm" id="saChgSearch" style="padding:5px 14px;font-size:0.72rem;">Search</button>';
    html += '</div>';

    html += '<div class="sa-table">';
    html += '<div class="sa-row sa-header sa-log-row sa-chg-row"><span>Time</span><span>Actor</span><span>Action</span><span>Target</span><span>Changes</span></div>';
    if (!_changesData.rows || !_changesData.rows.length) {
      html += '<div class="sa-row sa-log-row sa-chg-row" style="justify-content:center;color:var(--text-faint);grid-column:1/-1;">No records found.</div>';
    }
    (_changesData.rows || []).forEach(function (row) {
      html += '<div class="sa-row sa-log-row sa-chg-row">';
      html += '<span>' + fmtDate(row.timestamp) + '</span>';
      html += '<span>' + esc(row.actor) + '</span>';
      html += '<span><span class="sa-log-type sa-log-type--change">' +
        esc(_ACTION_LABELS[row.action] || row.action) + '</span></span>';
      html += '<span class="sa-chg-target">' + _fmtChangesTarget(row) + '</span>';
      html += '<span class="sa-chg-changes">' + _fmtChangesWhat(row) + '</span>';
      html += '</div>';
    });
    html += '</div>';

    // pagination
    var chgTotalPages = _changesData.total_pages || 1;
    html += '<div class="sa-pagination">';
    html += '<button class="shop-modal-btn shop-modal-btn--cancel sa-page-btn" data-chg-page="prev"' + (_changesPage <= 1 ? ' disabled' : '') + '><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg> Prev</button>';
    html += '<span class="sa-page-info">Page ' + _changesPage + ' of ' + chgTotalPages + '</span>';
    html += '<button class="shop-modal-btn shop-modal-btn--cancel sa-page-btn" data-chg-page="next"' + (_changesPage >= chgTotalPages ? ' disabled' : '') + '>Next <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>';
    html += '</div>';

    c.innerHTML = html;

    // log type switcher — immediate, no Search needed
    document.getElementById('saLogTypeView').addEventListener('change', function () {
      _logsFilters.log_type = this.value;
      _logsPage = 1; _logsData = null;
      _changesPage = 1; _changesData = null;
      _renderLogsBody();
    });
    document.getElementById('saChgSearch').addEventListener('click', function () {
      _changesFilters.actor     = document.getElementById('saChgActor').value.trim();
      _changesFilters.action    = document.getElementById('saChgAction').value;
      _changesFilters.target_id = document.getElementById('saChgTarget').value.trim();
      _changesFilters.date_from = document.getElementById('saChgFrom').value;
      _changesFilters.date_to   = document.getElementById('saChgTo').value;
      _changesPage = 1;
      _changesData = null;
      renderChanges(c);
    });
    c.querySelectorAll('[data-chg-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.chgPage === 'prev' && _changesPage > 1) _changesPage--;
        else if (btn.dataset.chgPage === 'next' && _changesPage < chgTotalPages) _changesPage++;
        _changesData = null;
        renderChanges(c);
      });
    });
  }

  function renderChanges(c) {
    c.innerHTML = '<div class="shop-loading"><span class="loading-spinner"></span> Loading changes\u2026</div>';
    fetchChanges(function () { renderChangesContent(c); });
  }

  function fetchLogs(cb) {
    var qs = 'page=1&per_page=200';
    if (_logsFilters.username)  qs += '&username=' + encodeURIComponent(_logsFilters.username);
    if (_logsFilters.item_id)   qs += '&item_id='  + encodeURIComponent(_logsFilters.item_id);
    if (_logsFilters.type)      qs += '&type='     + encodeURIComponent(_logsFilters.type);
    if (_logsFilters.status && ['active', 'won', 'outbid'].indexOf(_logsFilters.status) === -1)
      qs += '&status=' + encodeURIComponent(_logsFilters.status);
    if (_logsFilters.date_from) qs += '&date_from=' + encodeURIComponent(_logsFilters.date_from);
    if (_logsFilters.date_to)   qs += '&date_to='   + encodeURIComponent(_logsFilters.date_to);
    fetch('/api/admin/shop/logs?' + qs, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) { _logsData = d; _logsFeed = _buildLogsFeed(d); } if (cb) cb(d); })
      .catch(function () { if (cb) cb(null); });
  }

  function _buildLogsFeed(data) {
    var feed = [];
    (data.purchases || []).forEach(function (p) {
      feed.push({ type: 'purchase', date: p.purchased_at, user: p.username, item: p.item_id,
        ep: p.ep_spent, clean: p.clean_ep_spent, dirty: p.dirty_ep_spent, status: p.status,
        id: p.purchase_id, chief_note: p.chief_note });
    });
    (data.bids || []).forEach(function (b) {
      feed.push({ type: 'bid', date: b.placed_at, user: b.username, item: b.item_id,
        ep: b.amount, clean: b.clean_ep_used, dirty: b.dirty_ep_used,
        status: b.auction_status === 'closed' ? (b.is_winning ? 'won' : 'outbid') : 'active',
        id: b.bid_id });
    });
    (data.donations || []).forEach(function (d) {
      feed.push({ type: 'donation', date: d.submitted_at, user: d.username,
        item: num(d.le_amount) + ' LE',
        ep: d.dirty_ep_to_grant, clean: 0, dirty: d.dirty_ep_to_grant,
        status: d.status, id: d.ticket_id });
    });
    feed.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    return feed;
  }

  function renderLogs(c) {
    c.innerHTML = '<div id="saLogBody"></div>';
    _renderLogsBody();
  }

  function _renderLogsBody() {
    var body = document.getElementById('saLogBody');
    if (!body) return;
    if (_logsFilters.log_type === 'changes') {
      if (!_changesData) {
        body.innerHTML = '<div class="shop-loading"><span class="loading-spinner"></span> Loading changes\u2026</div>';
        fetchChanges(function () { renderChangesContent(body); });
      } else {
        renderChangesContent(body);
      }
    } else {
      if (!_logsData) {
        body.innerHTML = '<div class="shop-loading"><span class="loading-spinner"></span> Loading logs\u2026</div>';
        fetchLogs(function () { renderLogsContent(body); });
      } else {
        renderLogsContent(body);
      }
    }
  }


  function renderLogsContent(c) {
    if (!_logsData) { c.innerHTML = '<div class="shop-empty">Could not load logs.</div>'; return; }
    var html = '';

    // filter bar
    html += '<div class="sa-filter-bar">';
    html += '<select class="sa-filter-input" id="saLogTypeView">' +
      '<option value="activity" selected>Activity</option>' +
      '<option value="changes">Changes</option>' +
      '</select>';
    html += '<input class="sa-filter-input" id="saLogUser" placeholder="Username" maxlength="32" value="' + esc(_logsFilters.username) + '" />';
    html += '<input class="sa-filter-input" id="saLogItem" placeholder="Item ID" maxlength="64" value="' + esc(_logsFilters.item_id) + '" />';
    html += '<select class="sa-filter-input" id="saLogType">' +
      '<option value="">All types</option>' +
      '<option value="purchase"' + (_logsFilters.type === 'purchase' ? ' selected' : '') + '>Purchase</option>' +
      '<option value="bid"'      + (_logsFilters.type === 'bid'      ? ' selected' : '') + '>Bid</option>' +
      '<option value="donation"' + (_logsFilters.type === 'donation' ? ' selected' : '') + '>Donation</option>' +
      '</select>';
    html += '<select class="sa-filter-input" id="saLogStatus"><option value="">All statuses</option>' +
      '<option value="pending"'   + (_logsFilters.status === 'pending'   ? ' selected' : '') + '>Pending</option>' +
      '<option value="fulfilled"' + (_logsFilters.status === 'fulfilled' ? ' selected' : '') + '>Fulfilled</option>' +
      '<option value="confirmed"' + (_logsFilters.status === 'confirmed' ? ' selected' : '') + '>Confirmed</option>' +
      '<option value="rejected"'  + (_logsFilters.status === 'rejected'  ? ' selected' : '') + '>Rejected</option>' +
      '<option value="refunded"'  + (_logsFilters.status === 'refunded'  ? ' selected' : '') + '>Refunded</option>' +
      '<option value="refund_pending"' + (_logsFilters.status === 'refund_pending' ? ' selected' : '') + '>Refund Pending</option>' +
      '<option value="active"'    + (_logsFilters.status === 'active'    ? ' selected' : '') + '>Active</option>' +
      '<option value="won"'       + (_logsFilters.status === 'won'       ? ' selected' : '') + '>Won</option>' +
      '<option value="outbid"'    + (_logsFilters.status === 'outbid'    ? ' selected' : '') + '>Outbid</option>' +
      '</select>';
    html += '<span class="sa-filter-label">From:</span><input type="date" class="sa-filter-input" id="saLogFrom" value="' + esc(_logsFilters.date_from) + '" />';
    html += '<span class="sa-filter-label">To:</span><input type="date" class="sa-filter-input" id="saLogTo" value="' + esc(_logsFilters.date_to) + '" />';
    html += '<button class="shop-modal-btn shop-modal-btn--confirm" id="saLogSearch" style="padding:5px 14px;font-size:0.72rem;">Search</button>';
    html += '</div>';

    // client-side pagination over the full merged+sorted feed
    var _LOGS_PER_PAGE = 25;
    var totalFeed  = _logsFeed || [];
    if (_logsFilters.status) {
      totalFeed = totalFeed.filter(function (f) { return f.status === _logsFilters.status; });
    }
    var totalPages = Math.max(1, Math.ceil(totalFeed.length / _LOGS_PER_PAGE));
    if (_logsPage > totalPages) _logsPage = 1;
    var feed = totalFeed.slice((_logsPage - 1) * _LOGS_PER_PAGE, _logsPage * _LOGS_PER_PAGE);

    html += '<div class="sa-table">';
    html += '<div class="sa-row sa-header sa-log-row">' +
      '<span>Time</span><span>User</span><span>Item</span><span>Type</span><span>EP</span><span>Status</span></div>';
    if (!feed.length) {
      html += '<div class="sa-row sa-log-row" style="justify-content:center;color:var(--text-faint);">No records found.</div>';
    }
    var _typeIcons = { purchase: _svg.cart, bid: _svg.gavel, donation: _svg.gift };
    var _statusCfg  = {
      pending:   { icon: _svg.clock, cls: 'pending' },
      fulfilled: { icon: _svg.check, cls: 'fulfilled' },
      confirmed: { icon: _svg.check, cls: 'fulfilled' },
      rejected:  { icon: _svg.close, cls: 'rejected' },
      active:    { icon: _svg.play,  cls: 'active' },
      won:       { icon: _svg.check, cls: 'won' },
      outbid:    { icon: _svg.dash,  cls: 'outbid' },
    };
    feed.forEach(function (f) {
      html += '<div class="sa-row sa-log-row">';
      html += '<span>' + fmtDate(f.date) + '</span>';
      html += '<span>' + esc(f.user) + '</span>';
      html += '<span>' + esc(f.item) + '</span>';
      html += '<span><span class="sa-log-type sa-log-type--' + f.type + '">' +
        (_typeIcons[f.type] || '') + ' ' + f.type + '</span></span>';
      html += '<span class="sa-log-ep"><span class="sa-log-ep-total">' + num(f.ep) + ' EP</span>' +
        '<span class="sa-log-ep-split">' + num(f.clean) + 'c + ' + num(f.dirty) + 'd</span></span>';
      var sc = _statusCfg[f.status] || { icon: '', cls: 'active' };
      html += '<span><span class="sa-log-status sa-log-status--' + sc.cls + '">' +
        sc.icon + ' ' + esc(f.status) + '</span></span>';
      html += '</div>';
    });
    html += '</div>';

    // pagination
    var hasMore = _logsPage < totalPages;
    html += '<div class="sa-pagination">';
    html += '<button class="shop-modal-btn shop-modal-btn--cancel sa-page-btn" data-page="prev"' + (_logsPage <= 1 ? ' disabled' : '') + '><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg> Prev</button>';
    html += '<span class="sa-page-info">Page ' + _logsPage + ' of ' + totalPages + '</span>';
    html += '<button class="shop-modal-btn shop-modal-btn--cancel sa-page-btn" data-page="next"' + (!hasMore ? ' disabled' : '') + '>Next <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>';
    html += '</div>';

    c.innerHTML = html;

    // log type switcher — immediate, no Search needed
    document.getElementById('saLogTypeView').addEventListener('change', function () {
      _logsFilters.log_type = this.value;
      _logsPage = 1; _logsData = null; _logsFeed = null;
      _changesPage = 1; _changesData = null;
      _renderLogsBody();
    });
    // bind filter search
    document.getElementById('saLogSearch').addEventListener('click', function () {
      _logsFilters.username  = document.getElementById('saLogUser').value.trim();
      _logsFilters.item_id   = document.getElementById('saLogItem').value.trim();
      _logsFilters.type      = document.getElementById('saLogType').value;
      _logsFilters.status    = document.getElementById('saLogStatus').value;
      _logsFilters.date_from = document.getElementById('saLogFrom').value;
      _logsFilters.date_to   = document.getElementById('saLogTo').value;
      _logsPage = 1;
      _logsData = null;
      _logsFeed = null;
      _renderLogsBody();
    });

    // bind pagination
    c.querySelectorAll('[data-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.page === 'prev' && _logsPage > 1) _logsPage--;
        else if (btn.dataset.page === 'next' && _logsPage < totalPages) _logsPage++;
        else return;
        renderLogsContent(document.getElementById('saLogBody'));
      });
    });

  }

  /* Users Tab */
  var _users         = null;
  var _usersPage     = 1;
  var _usersPerPage  = 10;
  var _usersFilters  = { search: '', activity: '', sort: 'az' };
  var _usersOpenUuid = null;
  var _usersCartOpen = {};
  var _actorRankLevel = 0;

  function fetchUsers(cb, forceRefresh) {
    var url = '/api/admin/shop/users' + (forceRefresh ? '?refresh=true' : '');
    fetch(url, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (d && d.users) {
          _users = d.users;
          _actorRankLevel = d.actor_rank_level || 0;
        } else if (Array.isArray(d)) {
          _users = d;
        }
        if (cb) cb(d);
      })
      .catch(function () { if (cb) cb(null); });
  }

  function _filterSortUsers() {
    if (!_users) return [];
    var list = _users.slice();
    var s = (_usersFilters.search || '').toLowerCase();
    if (s) list = list.filter(function (u) { return (u.username || '').toLowerCase().indexOf(s) !== -1; });
    var act = _usersFilters.activity;
    if (act === 'purchases') list = list.filter(function (u) { return (u.orders  || 0) > 0; });
    else if (act === 'bids')      list = list.filter(function (u) { return (u.bids     || 0) > 0; });
    else if (act === 'donations') list = list.filter(function (u) { return (u.donations|| 0) > 0; });
    var sort = _usersFilters.sort;
    list.sort(function (a, b) {
      if (sort === 'ep_desc') return (((b.balance || {}).total) || 0) - (((a.balance || {}).total) || 0);
      if (sort === 'ep_asc')  return (((a.balance || {}).total) || 0) - (((b.balance || {}).total) || 0);
      if (sort === 'orders')  return (b.orders    || 0) - (a.orders    || 0);
      if (sort === 'donated') return (b.donations || 0) - (a.donations || 0);
      if (sort === 'recent')  return (b.last_activity || '').localeCompare(a.last_activity || '');
      if (sort === 'az')      return (a.username  || '').localeCompare(b.username  || '');
      return 0;
    });
    return list;
  }

  function _isUserActive(u) {
    if (!u.last_activity) return false;
    return u.last_activity >= new Date(Date.now() - 30 * 24 * 3600000).toISOString();
  }

  function renderUsers(c, forceRefresh) {
    c.innerHTML = '<div class="shop-loading"><span class="loading-spinner"></span> Loading users\u2026</div>';
    fetchUsers(function () {
      if (_activeTab !== 'users') return; // user switched away while loading
      _renderUsersContent(c);
    }, forceRefresh);
  }

  function _renderUsersContent(c) {
    if (!_users) { c.innerHTML = '<div class="shop-empty">Could not load users.</div>'; return; }

    // Preserve focus + cursor across re-renders
    var _prevFocusId  = document.activeElement && document.activeElement.id;
    var _prevSelStart = null, _prevSelEnd = null;
    if (_prevFocusId && document.activeElement.selectionStart != null) {
      _prevSelStart = document.activeElement.selectionStart;
      _prevSelEnd   = document.activeElement.selectionEnd;
    }
    function _restoreFocus() {
      if (!_prevFocusId) return;
      var el = document.getElementById(_prevFocusId);
      if (!el) return;
      el.focus();
      if (_prevSelStart != null && el.setSelectionRange) {
        try { el.setSelectionRange(_prevSelStart, _prevSelEnd); } catch (e) {}
      }
    }
    var filtered    = _filterSortUsers();
    var total       = filtered.length;
    var totalPages  = Math.max(1, Math.ceil(total / _usersPerPage));
    if (_usersPage > totalPages) _usersPage = 1;
    var start = (_usersPage - 1) * _usersPerPage;
    var page  = filtered.slice(start, start + _usersPerPage);
    var html  = '';

    /* Filter bar */
    html += '<div class="sa-filter-bar">';
    html += '<input class="sa-filter-input" id="suSearch" placeholder="Search username\u2026" maxlength="32" value="' + esc(_usersFilters.search) + '" />';
    html += '<select class="sa-filter-input" id="suActivity">' +
      '<option value=""'          + (_usersFilters.activity === ''          ? ' selected' : '') + '>All users</option>' +
      '<option value="purchases"' + (_usersFilters.activity === 'purchases' ? ' selected' : '') + '>Has purchases</option>' +
      '<option value="bids"'      + (_usersFilters.activity === 'bids'      ? ' selected' : '') + '>Has bids</option>' +
      '<option value="donations"' + (_usersFilters.activity === 'donations' ? ' selected' : '') + '>Has donations</option>' +
      '</select>';
    html += '<select class="sa-filter-input" id="suSort">' +
      [['az','A\u2192Z'],['ep_desc','Highest EP balance'],['ep_asc','Lowest EP balance'],['orders','Most orders'],['donated','Most donated'],['recent','Most recent']]
      .map(function (s) { return '<option value="' + s[0] + '"' + (_usersFilters.sort === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') +
      '</select>';
    html += '</div>';
    html += '<div class="su-count">' + total + ' user' + (total !== 1 ? 's' : '') + '</div>';

    if (!page.length) {
      html += '<div class="shop-empty">No users found.</div>';
      c.innerHTML = html;
      _bindUsersFilters(c);
      _restoreFocus();
      return;
    }

    /* Table */
    html += '<div class="sa-table">';
    html += '<div class="sa-row sa-header su-row">';
    html += '<span></span><span>User</span><span>EP Balance</span><span>Orders</span><span>Bids</span><span>Donations</span><span>Last Activity</span><span>Status</span><span></span>';
    html += '</div>';

    page.forEach(function (u) {
      var bal = u.balance || {};
      var active = _isUserActive(u);
      var isOpen = _usersOpenUuid === u.uuid;
      html += '<div class="sa-row su-row su-user-row' + (isOpen ? ' su-row--open' : '') + '" data-uuid="' + esc(u.uuid) + '">';
      html += '<span class="su-expand">' + _svg.chevron + '</span>';
      html += '<span class="su-user-cell">' +
        '<span class="su-username">' + esc(u.username) + '</span>' +
        '<span class="su-tag">' + (u.discord_id ? esc(u.discord_id) : esc((u.uuid || '').substring(0, 8) + '\u2026')) + '</span>' +
        '</span>';
      html += '<span class="su-ep-cell">' +
        '<span class=\"su-ep-total\">' + num(bal.total) + ' EP</span>' +
        '<span class=\"su-ep-split\">' + num(bal.clean_total) + 'c + ' + num(bal.dirty_total) + 'd</span>' +
        '</span>';
      html += '<span>' + (u.orders    || 0) + '</span>';
      html += '<span>' + (u.bids      || 0) + '</span>';
      html += '<span>' + (u.donations || 0) + '</span>';
      html += '<span class="su-date">' + fmtDate(u.last_activity) + '</span>';
      html += '<span>' +
        (u.shop_banned ? '<span class="su-status su-status--banned">Shop Ban</span>' : '') +
        (u.admin_banned ? '<span class="su-status su-status--banned">Admin Ban</span>' : '') +
        '<span class="su-status su-status--' + (active ? 'active' : 'inactive') + '">' + (active ? 'Active' : 'Inactive') + '</span>' +
        '</span>';
      /* Settings gear */
      if (_isParliament || _isOwnerShopAdmin()) {
        html += '<span class="su-manage-cell"><button class="su-manage-btn" data-manage-uuid="' + esc(u.uuid) + '" title="Manage user">' + _svg.gear + '</button></span>';
      } else {
        html += '<span></span>';
      }
      html += '</div>';
      if (isOpen) {
        html += '<div class="su-drawer">' + _buildUserDrawer(u) + '</div>';
      }
    });
    html += '</div>';

    /* Pagination */
    html += '<div class="sa-pagination">';
    html += '<button class="shop-modal-btn shop-modal-btn--cancel sa-page-btn" data-su-page="prev"' + (_usersPage <= 1 ? ' disabled' : '') + '><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg> Prev</button>';
    html += '<span class="sa-page-info">Page ' + _usersPage + ' of ' + totalPages + '</span>';
    html += '<button class="shop-modal-btn shop-modal-btn--cancel sa-page-btn" data-su-page="next"' + (_usersPage >= totalPages ? ' disabled' : '') + '>Next <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>';
    html += '</div>';

    c.innerHTML = html;
    _bindUsersFilters(c);
    _restoreFocus();
    /* Bind: row expand/collapse */
    c.querySelectorAll('.su-user-row').forEach(function (row) {
      row.addEventListener('click', function () {
        var uuid = row.dataset.uuid;
        _usersOpenUuid = (_usersOpenUuid === uuid) ? null : uuid;
        _renderUsersContent(c);
      });
    });
    /* Bind: cart section toggles */
    c.querySelectorAll('[data-cart-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var uuid = btn.dataset.cartToggle;
        _usersCartOpen[uuid] = (_usersCartOpen[uuid] === false) ? true : false;
        _renderUsersContent(c);
      });
    });
    /* Bind: manage user gear buttons */
    c.querySelectorAll('.su-manage-btn').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        _openManageUserModal(btn.dataset.manageUuid, c);
      });
    });
    /* Bind: pagination */
    c.querySelectorAll('[data-su-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.suPage === 'prev' && _usersPage > 1) _usersPage--;
        else if (btn.dataset.suPage === 'next') _usersPage++;
        _usersOpenUuid = null;
        _renderUsersContent(c);
      });
    });
  }

  function _bindUsersFilters(c) {
    document.getElementById('suSearch').addEventListener('input', function () {
      _usersFilters.search = this.value;
      _usersPage = 1; _usersOpenUuid = null;
      _renderUsersContent(c);
    });
    document.getElementById('suActivity').addEventListener('change', function () {
      _usersFilters.activity = this.value;
      _usersPage = 1; _usersOpenUuid = null;
      _renderUsersContent(c);
    });
    document.getElementById('suSort').addEventListener('change', function () {
      _usersFilters.sort = this.value;
      _usersPage = 1; _usersOpenUuid = null;
      _renderUsersContent(c);
    });
    var refreshBtn = document.getElementById('suRefresh');
    if (refreshBtn) refreshBtn.addEventListener('click', function () {
      _users = null; _usersPage = 1; _usersOpenUuid = null;
      renderUsers(c, true); // true = bypass server-side cache
    });
  }

  function _openBanModal(uuid, contentEl) {
    var user = (_users || []).find(function (u) { return u.uuid === uuid; });
    var name = user ? user.username : uuid.substring(0, 8);
    var modal = document.getElementById('saModal');
    modal.innerHTML =
      '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>' +
      '<div class="shop-modal-title">Ban ' + esc(name) + ' from shop</div>' +
      '<div class="shop-modal-body">' +
        '<label class="shop-modal-input-label">Reason (required)</label>' +
        '<textarea class="shop-modal-input" id="saBanReason" placeholder="Reason for ban\u2026" maxlength="50" rows="2"></textarea>' +
        '<p style="color:var(--text-faint);font-size:0.75rem;margin:6px 0 0">The user will be notified via DM and lose access to the shop.</p>' +
      '</div>' +
      '<div class="shop-modal-actions">' +
        '<button class="shop-modal-btn shop-modal-btn--cancel" id="saBanConfirm" style="color:var(--danger);border-color:var(--danger)">Ban user</button>' +
      '</div>';
    document.getElementById('saModalBackdrop').classList.add('open');
    document.getElementById('saBanConfirm').addEventListener('click', function () {
      var reason = document.getElementById('saBanReason').value.trim();
      if (!reason) { showToast('\u26a0 Reason is required.', 'warn'); return; }
      var btn = this;
      btn.disabled = true; btn.textContent = 'Banning\u2026';
      apiPost('/api/admin/shop/users/' + encodeURIComponent(uuid) + '/ban', { reason: reason })
        .then(function (res) {
          if (res.ok && res.data.ok) {
            showToast('\u2713 User banned from shop.', 'success');
            closeModal();
            if (user) user.shop_banned = true;
            _renderUsersContent(contentEl);
          } else {
            showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn');
            btn.disabled = false; btn.textContent = 'Ban user';
          }
        })
        .catch(function () { showToast('\u26a0 Network error', 'warn'); btn.disabled = false; btn.textContent = 'Ban user'; });
    });
  }

  function _openUnbanModal(uuid, contentEl) {
    var user = (_users || []).find(function (u) { return u.uuid === uuid; });
    var name = user ? user.username : uuid.substring(0, 8);
    var modal = document.getElementById('saModal');
    modal.innerHTML =
      '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>' +
      '<div class="shop-modal-title">Unban ' + esc(name) + '</div>' +
      '<div class="shop-modal-body">' +
        '<p>Are you sure you want to restore shop access for <strong>' + esc(name) + '</strong>?</p>' +
        '<p style="color:var(--text-faint);font-size:0.75rem;margin:6px 0 0">The user will be notified via DM.</p>' +
      '</div>' +
      '<div class="shop-modal-actions">' +
        '<button class="shop-modal-btn shop-modal-btn--confirm" id="saUnbanConfirm">Unban user</button>' +
      '</div>';
    document.getElementById('saModalBackdrop').classList.add('open');
    document.getElementById('saUnbanConfirm').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true; btn.textContent = 'Unbanning\u2026';
      apiPost('/api/admin/shop/users/' + encodeURIComponent(uuid) + '/unban', {})
        .then(function (res) {
          if (res.ok && res.data.ok) {
            showToast('\u2713 User unbanned from shop.', 'success');
            closeModal();
            if (user) user.shop_banned = false;
            _renderUsersContent(contentEl);
          } else {
            showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn');
            btn.disabled = false; btn.textContent = 'Unban user';
          }
        })
        .catch(function () { showToast('\u26a0 Network error', 'warn'); btn.disabled = false; btn.textContent = 'Unban user'; });
    });
  }

  function _openAdminBanModal(discordId, contentEl) {
    var user = (_users || []).find(function (u) { return u.discord_id === discordId; });
    var name = user ? user.username : discordId;
    var modal = document.getElementById('saModal');
    modal.innerHTML =
      '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>' +
      '<div class="shop-modal-title">Ban ' + esc(name) + ' from manage shop</div>' +
      '<div class="shop-modal-body">' +
        '<label class="shop-modal-input-label">Reason (required)</label>' +
        '<textarea class="shop-modal-input" id="saAdminBanReason" placeholder="Reason for admin ban\u2026" maxlength="50" rows="2"></textarea>' +
        '<p style="color:var(--text-faint);font-size:0.75rem;margin:6px 0 0">The user will lose access to the manage shop panel and be notified via DM.</p>' +
      '</div>' +
      '<div class="shop-modal-actions">' +
        '<button class="shop-modal-btn shop-modal-btn--cancel" id="saAdminBanConfirm" style="color:var(--danger);border-color:var(--danger)">Ban from manage shop</button>' +
      '</div>';
    document.getElementById('saModalBackdrop').classList.add('open');
    document.getElementById('saAdminBanConfirm').addEventListener('click', function () {
      var reason = document.getElementById('saAdminBanReason').value.trim();
      if (!reason) { showToast('\u26a0 Reason is required.', 'warn'); return; }
      var btn = this;
      btn.disabled = true; btn.textContent = 'Banning\u2026';
      apiPost('/api/admin/shop/users/' + encodeURIComponent(discordId) + '/admin-ban', { reason: reason })
        .then(function (res) {
          if (res.ok && res.data.ok) {
            showToast('\u2713 User banned from manage shop.', 'success');
            closeModal();
            if (user) user.admin_banned = true;
            _renderUsersContent(contentEl);
          } else {
            showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn');
            btn.disabled = false; btn.textContent = 'Ban from manage shop';
          }
        })
        .catch(function () { showToast('\u26a0 Network error', 'warn'); btn.disabled = false; btn.textContent = 'Ban from manage shop'; });
    });
  }

  function _openAdminUnbanModal(discordId, contentEl) {
    var user = (_users || []).find(function (u) { return u.discord_id === discordId; });
    var name = user ? user.username : discordId;
    var modal = document.getElementById('saModal');
    modal.innerHTML =
      '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>' +
      '<div class="shop-modal-title">Unban ' + esc(name) + ' from manage shop</div>' +
      '<div class="shop-modal-body">' +
        '<p>Are you sure you want to restore manage shop access for <strong>' + esc(name) + '</strong>?</p>' +
        '<p style="color:var(--text-faint);font-size:0.75rem;margin:6px 0 0">The user will be notified via DM.</p>' +
      '</div>' +
      '<div class="shop-modal-actions">' +
        '<button class="shop-modal-btn shop-modal-btn--confirm" id="saAdminUnbanConfirm">Unban from manage shop</button>' +
      '</div>';
    document.getElementById('saModalBackdrop').classList.add('open');
    document.getElementById('saAdminUnbanConfirm').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true; btn.textContent = 'Unbanning\u2026';
      apiPost('/api/admin/shop/users/' + encodeURIComponent(discordId) + '/admin-unban', {})
        .then(function (res) {
          if (res.ok && res.data.ok) {
            showToast('\u2713 User unbanned from manage shop.', 'success');
            closeModal();
            if (user) user.admin_banned = false;
            _renderUsersContent(contentEl);
          } else {
            showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn');
            btn.disabled = false; btn.textContent = 'Unban from manage shop';
          }
        })
        .catch(function () { showToast('\u26a0 Network error', 'warn'); btn.disabled = false; btn.textContent = 'Unban from manage shop'; });
    });
  }

  function _buildUserDrawer(u) {
    var html = '';
    var bal          = u.balance || {};
    var totalReserved = (bal.clean_reserved || 0) + (bal.dirty_reserved || 0);

    /* Six-metric strip */
    html += '<div class="su-metrics">';
    [
      [num(bal.total || 0)        + ' EP', 'Total balance'],
      [num(bal.clean_total || 0)  + ' EP', 'Clean balance'],
      [num(bal.dirty_total || 0)  + ' EP', 'Dirty balance'],
      [String(u.orders       || 0), 'Orders'],
      [String(u.bids         || 0), 'Bids placed'],
      [String(u.winning_bids || 0), 'Auctions won'],
    ].forEach(function (m) {
      html += '<div class="su-metric"><div class="su-metric-val">' + esc(m[0]) + '</div>' +
              '<div class="su-metric-lbl">' + esc(m[1]) + '</div></div>';
    });
    html += '</div>';

    /* EP Balance card */
    function _balCol(tot, res, fre, label) {
      var pct = (tot > 0) ? Math.min(100, (res / tot) * 100) : 0;
      return '<div class="su-bal-col">' +
        '<div class="su-bal-col-title">' + label + '</div>' +
        '<div class="su-bal-row"><span>Total</span><span>'    + num(tot) + ' EP</span></div>' +
        '<div class="su-bal-row su-bal-row--reserved"><span>Reserved</span><span>' + num(res) + ' EP</span></div>' +
        '<div class="su-bal-row su-bal-row--free"><span>Free</span><span>'    + num(fre) + ' EP</span></div>' +
        '<div class="su-bal-bar"><div class="su-bal-bar-res" style="width:' + pct.toFixed(1) + '%"></div></div>' +
        '</div>';
    }
    html += '<div class="su-bal-card">' +
      '<div class="su-bal-header">' +
        '<span class="su-bal-title">EP Balance</span>' +
        '<div class="su-bal-totals">' +
          '<span class="su-bal-total">'      + num(bal.total || 0) + ' EP</span>' +
          '<span class="su-bal-free-total">' + num(bal.free  || 0) + ' free</span>' +
        '</div>' +
      '</div>' +
      '<div class="su-bal-grid">' +
        _balCol(bal.clean_total, bal.clean_reserved, bal.clean_free, 'Clean EP') +
        _balCol(bal.dirty_total, bal.dirty_reserved, bal.dirty_free, 'Dirty EP') +
      '</div>' +
      '<div class="su-bal-legend">' +
        '<span class="su-bal-dot su-bal-dot--res"></span><span>Reserved</span>' +
        '<span class="su-bal-dot su-bal-dot--free"></span><span>Free</span>' +
      '</div>' +
    '</div>';

    /* Three detail cards */
    html += '<div class="su-cards">';

    /* Account card */
    html += '<div class="su-card"><div class="su-card-title">Account</div>';
    [
      ['Username',      esc(u.username)],
      ['Discord ID',    u.discord_id ? esc(u.discord_id) : '<span style="color:var(--text-faint)">N/A</span>'],
      ['First seen',    esc(fmtDate(u.first_seen))],
      ['Last activity', esc(fmtDate(u.last_activity))],
    ].forEach(function (r) {
      html += '<div class="su-card-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    });
    html += '</div>';

    /* Order history card */
    html += '<div class="su-card"><div class="su-card-title">Order History</div>';
    [
      ['Total orders', String(u.orders    || 0)],
      ['Fulfilled',    '<span style="color:var(--online)">'  + (u.fulfilled || 0) + '</span>'],
      ['Rejected',     '<span style="color:var(--danger)">'  + (u.rejected  || 0) + '</span>'],
      ['Donations',    String(u.donations || 0)],
    ].forEach(function (r) {
      html += '<div class="su-card-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    });
    html += '</div>';

    /* Auction activity card */
    html += '<div class="su-card"><div class="su-card-title">Auction Activity</div>';
    [
      ['Total bids',   String(u.bids         || 0)],
      ['Active bids',  String(u.active_bids  || 0)],
      ['Auctions won', String(u.winning_bids || 0)],
    ].forEach(function (r) {
      html += '<div class="su-card-row"><span>' + r[0] + '</span><span>' + r[1] + '</span></div>';
    });
    html += '</div>';

    html += '</div>'; /* su-cards */

    /* Collapsible cart section */
    var cart       = u.cart || [];
    var cartOpen   = _usersCartOpen[u.uuid] !== false; // default open
    var cartQty    = cart.reduce(function (s, ci) { return s + (ci.quantity || 1); }, 0);
    var cartEpSum  = cart.reduce(function (s, ci) { return s + (ci.price_each || 0) * (ci.quantity || 1); }, 0);
    html += '<div class="su-cart-section">';
    html += '<div class="su-cart-header" data-cart-toggle="' + esc(u.uuid) + '">';
    html += '<span class="su-cart-title">' +
      '<span class="su-cart-chev' + (cartOpen ? ' su-cart-chev--open' : '') + '">' + _svg.chevron + '</span>' +
      'Current cart</span>';
    html += '<span class="su-cart-summary">' +
      (cart.length ? cartQty + ' item' + (cartQty !== 1 ? 's' : '') + ' \u00b7 ' + num(cartEpSum) + ' EP' : '<span style="color:var(--text-faint)">Empty</span>') +
      '</span>';
    html += '</div>'; /* su-cart-header */
    if (cartOpen) {
      html += '<div class="su-cart-body">';
      if (!cart.length) {
        html += '<div style="color:var(--text-faint);font-size:0.8rem;font-style:italic;padding:6px 0">Cart is empty.</div>';
      } else {
        html += '<div class="su-cart-table">';
        html += '<div class="su-cart-row su-cart-hdr"><span>Item</span><span>Type</span><span>Qty</span><span>Unit price</span><span>Total</span><span>EP type</span></div>';
        cart.forEach(function (ci) {
          var lineTotal = (ci.price_each || 0) * (ci.quantity || 1);
          var typePill  = ci.type === 'donate'
            ? '<span class="sa-pill sa-pill--donate">Donate</span>'
            : '<span class="sa-pill sa-pill--bin">Bin</span>';
          var epLabel   = ci.ep_type === 'dirty' ? 'Dirty' : ci.ep_type === 'mixed' ? 'Mixed' : 'Clean';
          var epPill    = '<span class="su-ep-pill su-ep-pill--' + (ci.ep_type || 'clean') + '">' + epLabel + '</span>';
          html += '<div class="su-cart-row">';
          html += '<span class="su-item" title="' + esc(ci.item_id) + '">' + esc(ci.item_name || ci.item_id) + '</span>';
          html += '<span>' + typePill + '</span>';
          html += '<span>' + (ci.quantity || 1) + '</span>';
          html += '<span>' + num(ci.price_each) + ' EP</span>';
          html += '<span>' + num(lineTotal) + ' EP</span>';
          html += '<span>' + epPill + '</span>';
          html += '</div>';
        });
        html += '</div>'; /* su-cart-table */
        html += '<div class="su-cart-total">Cart total: <strong>' + num(cartEpSum) + ' EP</strong></div>';
        if (totalReserved) {
          html += '<div class="su-cart-note">Reserved EP (' + num(totalReserved) + ' EP) is from active auction bids and is separate from this cart.</div>';
        }
      }
      html += '</div>'; /* su-cart-body */
    }
    html += '</div>'; /* su-cart-section */

    /* Recent activity */
    html += '<div class="su-recent"><div class="su-recent-title">Recent Activity</div>';
    if (!u.recent || !u.recent.length) {
      html += '<div style="color:var(--text-faint);font-size:0.8rem;font-style:italic;padding:6px 0">No activity recorded.</div>';
    } else {
      var _ti = { purchase: _svg.cart, bid: _svg.gavel, donation: _svg.gift };
      var _sc = { pending:'pending', fulfilled:'fulfilled', rejected:'rejected', active:'active', won:'won', outbid:'outbid', confirmed:'fulfilled' };
      html += '<div class="su-recent-table">';
      html += '<div class="su-recent-row su-recent-hdr"><span>Date</span><span>Type</span><span>Item</span><span>EP</span><span>Status</span></div>';
      (u.recent || []).forEach(function (r) {
        var sc = _sc[r.status] || 'active';
        html += '<div class="su-recent-row">';
        html += '<span class="su-recent-date">' + fmtDate(r.date) + '</span>';
        html += '<span><span class="sa-log-type sa-log-type--' + esc(r.type) + '">' + (_ti[r.type] || '') + ' ' + esc(r.type) + '</span></span>';
        html += '<span class="su-item">' + esc(r.item || 'N/A') + '</span>';
        html += '<span>' + num(r.ep) + ' EP</span>';
        html += '<span><span class="sa-log-status sa-log-status--' + sc + '">' + esc(r.status) + '</span></span>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>'; /* su-recent */

    return html;
  }

  function _openManageUserModal(uuid, contentEl) {
    var user = (_users || []).find(function (u) { return u.uuid === uuid; });
    if (!user) return;
    var name = user.username || uuid.substring(0, 8);
    var _actorDiscordId = (window.state && window.state.user) ? window.state.user.id : null;
    var _isSelf = user.discord_id && _actorDiscordId && user.discord_id === _actorDiscordId;
    var _canBan = !_isSelf && (user.rank_level || 0) < _actorRankLevel;

    var modal = document.getElementById('saModal');
    var html = '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>';
    html += '<div class="shop-modal-title">Manage ' + esc(name) + '</div>';
    html += '<div class="shop-modal-body su-manage-body">';

    /* Notes section */
    var notes = user.notes || [];
    html += '<div class="su-manage-section">';
    html += '<div class="su-manage-section-title">Notes (' + notes.length + ')</div>';
    if (notes.length) {
      html += '<div class="su-notes-list">';
      notes.forEach(function (n) {
        html += '<div class="su-note">';
        html += '<div class="su-note-meta"><span class="su-note-actor">' + esc(n.actor) + '</span>' +
          '<span class="su-note-date">' + fmtDate(n.created_at) + '</span>';
        if (_isParliament || _isOwnerShopAdmin()) {
          html += '<button class="su-note-del" data-note-id="' + esc(n.id) + '" title="Delete note">' + _svg.close + '</button>';
        }
        html += '</div>';
        html += '<div class="su-note-text">' + esc(n.note) + '</div>';
        html += '</div>';
      });
      html += '</div>';
    } else {
      html += '<div style="color:var(--text-faint);font-size:0.8rem;font-style:italic;padding:4px 0">No notes yet.</div>';
    }
    if (_isParliament || _isOwnerShopAdmin()) {
      html += '<div class="su-note-add">' +
        '<textarea class="shop-modal-input" id="suNoteInput" placeholder="Add a note\u2026" maxlength="200" rows="2"></textarea>' +
        '</div>';
    }
    html += '</div>';

    /* EP Adjustment section */
    var _bal = user.balance || {};
    var _cleanMax = _bal.clean_total || 0;
    var _dirtyMax = _bal.dirty_total || 0;
    html += '<div class="su-manage-section">';
    html += '<div class="su-manage-section-title">EP Adjustment</div>';
    html += '<div style="display:flex;gap:10px;margin-bottom:8px">';
    html += '<div style="flex:1"><label class="shop-modal-input-label">Amount (<span id="saEpAdjRange">' + (-_cleanMax) + ' to 100,000</span>)</label>' +
      '<input type="text" inputmode="numeric" class="shop-modal-input" id="saEpAdjAmount" placeholder="e.g. 50 or -20" maxlength="7" /></div>';
    html += '<div style="flex:1"><label class="shop-modal-input-label">EP Type</label>' +
      '<select class="shop-modal-input" id="saEpAdjType"><option value="clean">Clean EP</option><option value="dirty">Dirty EP</option></select></div>';
    html += '</div>';
    html += '<label class="shop-modal-input-label">Reason (required for EP adjustment)</label>' +
      '<textarea class="shop-modal-input" id="saEpAdjReason" placeholder="Reason for adjustment\u2026" maxlength="50" rows="2"></textarea>';
    html += '</div>';

    /* Purchase Limits section */
    var _lim = user.limits || {};
    var _curMaxEp = _lim.max_ep_per_cycle;
    var _curMaxP  = _lim.max_purchases_per_cycle;
    html += '<div class="su-manage-section">';
    html += '<div class="su-manage-section-title">Purchase Limits</div>';
    html += '<div style="display:flex;gap:10px">';
    html += '<div style="flex:1"><label class="shop-modal-input-label">Max EP per cycle (blank\u00a0=\u00a0no\u00a0limit)</label>' +
      '<input type="text" inputmode="numeric" class="shop-modal-input" id="suLimMaxEp" placeholder="No limit" maxlength="6" value="' +
      (_curMaxEp != null ? esc(String(_curMaxEp)) : '') + '" /></div>';
    html += '<div style="flex:1"><label class="shop-modal-input-label">Max purchases per cycle (blank\u00a0=\u00a0no\u00a0limit)</label>' +
      '<input type="text" inputmode="numeric" class="shop-modal-input" id="suLimMaxP" placeholder="No limit" maxlength="3" value="' +
      (_curMaxP != null ? esc(String(_curMaxP)) : '') + '" /></div>';
    html += '</div>';
    html += '<div class="ie-hint">Limits reset each EP cycle. Blank = unlimited. Current cycle usage: ' +
      num(user.orders || 0) + ' purchases, ' + num(user.ep_total || 0) + ' EP spent.</div>';
    html += '</div>';

    /* Ban actions */
    if (_canBan) {
      html += '<div class="su-manage-section">';
      html += '<div class="su-manage-section-title">Access Control</div>';
      html += '<div class="su-manage-actions">';
      /* Shop ban / unban */
      if (user.shop_banned) {
        html += '<button class="shop-modal-btn shop-modal-btn--confirm su-manage-action-btn" id="suMgUnban">Unban from shop</button>';
      } else {
        html += '<button class="shop-modal-btn shop-modal-btn--cancel su-manage-action-btn" id="suMgBan" ' +
          'style="color:var(--danger);border-color:var(--danger)">Ban from shop</button>';
      }
      /* Admin ban / unban (only for shop admins) */
      if ((user.rank_level || 0) > 0 && user.discord_id) {
        if (user.admin_banned) {
          html += '<button class="shop-modal-btn shop-modal-btn--confirm su-manage-action-btn" id="suMgAdminUnban">Unban from manage shop</button>';
        } else {
          html += '<button class="shop-modal-btn shop-modal-btn--cancel su-manage-action-btn" id="suMgAdminBan" ' +
            'style="color:var(--danger);border-color:var(--danger)">Ban from manage shop</button>';
        }
      }
      html += '</div>';
      html += '</div>';
    }

    html += '</div>'; /* shop-modal-body */

    /* Save button (outside scrollable body) */
    html += '<button class="shop-modal-btn shop-modal-btn--confirm su-manage-save" id="suMgSave" style="display:none">Save Changes</button>';
    modal.innerHTML = html;
    document.getElementById('saModalBackdrop').classList.add('open');

    /* Dirty tracking */
    var _saveBtn = document.getElementById('suMgSave');
    var _noteInput = document.getElementById('suNoteInput');
    var _limMaxEpInput = document.getElementById('suLimMaxEp');
    var _limMaxPInput  = document.getElementById('suLimMaxP');
    var _limOrigEp = _curMaxEp != null ? String(_curMaxEp) : '';
    var _limOrigP  = _curMaxP  != null ? String(_curMaxP)  : '';

    function _limitsChanged() {
      var epVal = _limMaxEpInput ? _limMaxEpInput.value.trim() : '';
      var pVal  = _limMaxPInput  ? _limMaxPInput.value.trim()  : '';
      return epVal !== _limOrigEp || pVal !== _limOrigP;
    }
    function _hasPendingChanges() {
      var hasNote = _noteInput && _noteInput.value.trim().length > 0;
      var hasEp   = _adjInput && _adjInput.value.trim().length > 0;
      return hasNote || hasEp || _limitsChanged();
    }
    function _updateSaveBtn() {
      _saveBtn.style.display = _hasPendingChanges() ? '' : 'none';
    }
    if (_noteInput) _noteInput.addEventListener('input', _updateSaveBtn);

    /* Digits-only for limit inputs */
    [_limMaxEpInput, _limMaxPInput].forEach(function (el) {
      if (!el) return;
      el.addEventListener('input', function () {
        var pos = this.selectionStart;
        var cleaned = this.value.replace(/\D/g, '');
        if (cleaned !== this.value) {
          this.value = cleaned;
          this.setSelectionRange(Math.min(pos, cleaned.length), Math.min(pos, cleaned.length));
        }
        _updateSaveBtn();
      });
    });

    /* Amount input: digits + optional leading minus only */
    var _adjInput = document.getElementById('saEpAdjAmount');
    var _adjTypeEl = document.getElementById('saEpAdjType');
    var _adjRangeEl = document.getElementById('saEpAdjRange');

    function _epMaxDeduct() {
      return _adjTypeEl.value === 'clean' ? _cleanMax : _dirtyMax;
    }
    function _updateRangeLabel() {
      _adjRangeEl.textContent = (-_epMaxDeduct()) + ' to 100,000';
    }
    function _reclampAmount() {
      var raw = _adjInput.value.trim();
      if (!raw) return;
      var v = parseInt(raw, 10);
      if (isNaN(v) || v === 0) { _adjInput.value = ''; return; }
      var maxDeduct = _epMaxDeduct();
      if (v < 0 && maxDeduct <= 0) { _adjInput.value = ''; return; }
      if (v < -maxDeduct) _adjInput.value = String(-maxDeduct);
    }
    _adjTypeEl.addEventListener('change', function () { _updateRangeLabel(); _reclampAmount(); });

    _adjInput.addEventListener('input', function () {
      var pos = this.selectionStart;
      // Allow digits and a leading minus
      var raw = this.value;
      var neg = raw.charAt(0) === '-';
      var digits = raw.replace(/[^0-9]/g, '').slice(0, 6);
      var cleaned = (neg ? '-' : '') + digits;
      if (cleaned !== raw) {
        this.value = cleaned;
        this.setSelectionRange(Math.min(pos, cleaned.length), Math.min(pos, cleaned.length));
      }
      _updateSaveBtn();
    });
    _adjInput.addEventListener('blur', function () {
      var raw = this.value.trim();
      if (!raw) return;
      var v = parseInt(raw, 10);
      if (isNaN(v) || v === 0) { this.value = ''; return; }
      var maxDeduct = _epMaxDeduct();
      if (v < 0 && maxDeduct <= 0) { this.value = ''; return; }
      if (v < -maxDeduct) v = -maxDeduct;
      if (v > 100000) v = 100000;
      this.value = String(v);
    });

    /* Wire Save Changes */
    _saveBtn.addEventListener('click', function () {
      var btn = _saveBtn;
      var noteText = _noteInput ? _noteInput.value.trim() : '';
      var epRaw = _adjInput.value.trim();
      var amount = epRaw ? parseInt(epRaw, 10) : 0;
      var epType = _adjTypeEl.value;
      var reason = document.getElementById('saEpAdjReason').value.trim();

      // Validate EP if filled
      if (epRaw) {
        if (!amount || isNaN(amount)) { showToast('\u26a0 EP amount must be a non-zero number.', 'warn'); return; }
        if (amount > 100000) { showToast('\u26a0 Amount cannot exceed 100,000.', 'warn'); return; }
        if (amount < 0) {
          var available = epType === 'clean' ? _cleanMax : _dirtyMax;
          if (Math.abs(amount) > available) {
            showToast('\u26a0 Cannot deduct ' + Math.abs(amount) + ' ' + epType + ' EP \u2014 user only has ' + num(available) + '.', 'warn');
            return;
          }
        }
        if (!reason) { showToast('\u26a0 Reason is required for EP adjustment.', 'warn'); return; }
      }

      btn.disabled = true; btn.textContent = 'Saving\u2026';
      var _pending = [];

      // Queue note
      if (noteText) {
        _pending.push(function () {
          return apiPost('/api/admin/shop/users/' + encodeURIComponent(uuid) + '/notes', { note: noteText })
            .then(function (res) {
              if (res.ok && res.data.ok) {
                if (!user.notes) user.notes = [];
                user.notes.unshift(res.data);
              } else { showToast('\u26a0 Note: ' + (res.data.error || 'Failed'), 'warn'); }
            });
        });
      }
      // Queue EP adjustment
      if (epRaw && amount) {
        _pending.push(function () {
          return apiPost('/api/admin/shop/users/' + encodeURIComponent(uuid) + '/ep-adjust', {
            amount: amount, ep_type: epType, reason: reason
          }).then(function (res) {
            if (res.ok && res.data.ok) {
              var sign = amount > 0 ? '+' : '';
              showToast('\u2713 ' + sign + amount + ' ' + epType + ' EP applied.', 'success');
            } else { showToast('\u26a0 EP: ' + (res.data.error || 'Failed'), 'warn'); }
          });
        });
      }

      // Queue limits if changed
      if (_limitsChanged()) {
        _pending.push(function () {
          var epVal = _limMaxEpInput ? _limMaxEpInput.value.trim() : '';
          var pVal  = _limMaxPInput  ? _limMaxPInput.value.trim()  : '';
          return apiPost('/api/admin/shop/users/' + encodeURIComponent(uuid) + '/limits', {
            max_ep_per_cycle: epVal || null,
            max_purchases_per_cycle: pVal || null
          }).then(function (res) {
            if (res.ok && res.data.ok) {
              user.limits = { max_ep_per_cycle: res.data.max_ep_per_cycle, max_purchases_per_cycle: res.data.max_purchases_per_cycle };
            } else { showToast('\u26a0 Limits: ' + (res.data.error || 'Failed'), 'warn'); }
          });
        });
      }

      // Execute sequentially then refresh
      var chain = Promise.resolve();
      _pending.forEach(function (fn) { chain = chain.then(fn); });
      chain.then(function () {
        closeModal(); _users = null; renderUsers(contentEl, true);
      }).catch(function () {
        showToast('\u26a0 Network error', 'warn');
        btn.disabled = false; btn.textContent = 'Save Changes';
      });
    });

    /* Wire note delete */
    modal.querySelectorAll('.su-note-del').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var noteId = btn.dataset.noteId;
        btn.disabled = true;
        apiDelete('/api/admin/shop/users/' + encodeURIComponent(uuid) + '/notes/' + encodeURIComponent(noteId))
          .then(function (res) {
            if (res.ok && res.data.ok) {
              if (user.notes) user.notes = user.notes.filter(function (n) { return n.id !== noteId; });
              _openManageUserModal(uuid, contentEl);
            } else {
              showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn');
              btn.disabled = false;
            }
          })
          .catch(function () { showToast('\u26a0 Network error', 'warn'); btn.disabled = false; });
      });
    });

    /* Wire ban actions */
    var banBtn = document.getElementById('suMgBan');
    if (banBtn) banBtn.addEventListener('click', function () {
      closeModal(); _openBanModal(uuid, contentEl);
    });
    var unbanBtn = document.getElementById('suMgUnban');
    if (unbanBtn) unbanBtn.addEventListener('click', function () {
      closeModal(); _openUnbanModal(uuid, contentEl);
    });
    var adminBanBtn = document.getElementById('suMgAdminBan');
    if (adminBanBtn) adminBanBtn.addEventListener('click', function () {
      closeModal(); _openAdminBanModal(user.discord_id, contentEl);
    });
    var adminUnbanBtn = document.getElementById('suMgAdminUnban');
    if (adminUnbanBtn) adminUnbanBtn.addEventListener('click', function () {
      closeModal(); _openAdminUnbanModal(user.discord_id, contentEl);
    });
  }

  function _openEpAdjustModal(uuid, contentEl) {
    var user = (_users || []).find(function (u) { return u.uuid === uuid; });
    var name = user ? user.username : uuid.substring(0, 8);
    var modal = document.getElementById('saModal');
    modal.innerHTML =
      '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>' +
      '<div class="shop-modal-title">Adjust EP for ' + esc(name) + '</div>' +
      '<div class="shop-modal-body">' +
        '<div style="display:flex;gap:10px;margin-bottom:10px">' +
          '<div style="flex:1">' +
            '<label class="shop-modal-input-label">Amount (use negative to deduct)</label>' +
            '<input type="number" class="shop-modal-input" id="saEpAdjAmount" placeholder="e.g. 50 or -20" min="-100000" max="100000" />' +
          '</div>' +
          '<div style="flex:1">' +
            '<label class="shop-modal-input-label">EP Type</label>' +
            '<select class="shop-modal-input" id="saEpAdjType">' +
              '<option value="clean">Clean EP</option>' +
              '<option value="dirty">Dirty EP</option>' +
            '</select>' +
          '</div>' +
        '</div>' +
        '<label class="shop-modal-input-label">Reason (required)</label>' +
        '<textarea class="shop-modal-input" id="saEpAdjReason" placeholder="Reason for adjustment\u2026" maxlength="50" rows="2"></textarea>' +
        '<p style="color:var(--text-faint);font-size:0.75rem;margin:6px 0 0">The user will be notified via DM.</p>' +
      '</div>' +
      '<div class="shop-modal-actions">' +
        '<button class="shop-modal-btn shop-modal-btn--confirm" id="saEpAdjConfirm">Apply Adjustment</button>' +
      '</div>';
    document.getElementById('saModalBackdrop').classList.add('open');
    document.getElementById('saEpAdjConfirm').addEventListener('click', function () {
      var amount = parseInt(document.getElementById('saEpAdjAmount').value, 10);
      if (!amount || isNaN(amount)) { showToast('\u26a0 Enter a non-zero amount.', 'warn'); return; }
      var epType = document.getElementById('saEpAdjType').value;
      var reason = document.getElementById('saEpAdjReason').value.trim();
      if (!reason) { showToast('\u26a0 Reason is required.', 'warn'); return; }
      var btn = this;
      btn.disabled = true; btn.textContent = 'Applying\u2026';
      apiPost('/api/admin/shop/users/' + encodeURIComponent(uuid) + '/ep-adjust', {
        amount: amount, ep_type: epType, reason: reason
      })
        .then(function (res) {
          if (res.ok && res.data.ok) {
            var sign = amount > 0 ? '+' : '';
            showToast('\u2713 ' + sign + amount + ' ' + epType + ' EP applied to ' + esc(name) + '.', 'success');
            closeModal();
            // Refresh users data to reflect updated balance
            _users = null;
            renderUsers(contentEl, true);
          } else {
            showToast('\u26a0 ' + (res.data.error || 'Failed'), 'warn');
            btn.disabled = false; btn.textContent = 'Apply Adjustment';
          }
        })
        .catch(function () { showToast('\u26a0 Network error', 'warn'); btn.disabled = false; btn.textContent = 'Apply Adjustment'; });
    });
  }

  function _applyAdminBannedState() {
    panel.innerHTML =
      '<div class="shop-banned-notice">' +
        '<div class="shop-banned-icon">' +
          '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>' +
        '</div>' +
        '<div class="shop-banned-title">Manage Shop Access Revoked</div>' +
        '<div class="shop-banned-text">You have been banned from the manage shop panel. If you believe this is a mistake, please contact a Parliament member.</div>' +
      '</div>';
    window._adminBanned = true;
    var adminNav = document.getElementById('shopAdminNavItem');
    if (adminNav) adminNav.style.display = 'none';
  }

  /* Init */
  var _initDone = false;
  function initAdmin() {
    if (_initDone) return;
    _initDone = true;
    if (!window.state || !window.state.loggedIn) {
      panel.innerHTML = '<div class="shop-login-prompt">Log in to access the shop admin.</div>';
      return;
    }
    // If already detected as admin-banned (from shop state), don't load anything
    if (window._adminBanned) {
      _applyAdminBannedState();
      return;
    }
    buildShell();
    fetchShopState(function () {
      // Check if the fetch detected an admin ban (403)
      if (_adminBannedDetected) {
        _applyAdminBannedState();
        return;
      }
      renderShopStateBanner();
      if (_shopEnabled) {
        fetchQueue(function () { updateQueueBadge(); });
      } else {
        _clearQueueBadges();
      }
      renderTab();
    });
  }

  var observer = new MutationObserver(function () {
    if (panel.classList.contains('active')) initAdmin();
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  if (panel.classList.contains('active')) initAdmin();
})();
