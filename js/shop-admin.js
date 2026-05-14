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
        if (!_items) { c.innerHTML = '<div class="shop-empty">Could not load items.</div>'; return; }
        renderItemsTable(c);
      }
    }
    if (!_items) fetchItems(check); else { done++; check(); }
    fetchAuctions(check);
  }

  function renderItemsTable(c) {
    var html = '';
    if (_isParliament) {
      html += '<div style="display:flex;justify-content:flex-end;margin-bottom:12px;">' +
        '<button class="shop-modal-btn shop-modal-btn--confirm" id="saNewItem">+ New Item</button>' +
        '</div>';
    }
    var _binItems = (_items || []).filter(function (it) { return it.type !== 'auction'; });
    var _aucItems = (_items || []).filter(function (it) { return it.type === 'auction'; });

    html += '<div class="sa-table ie-item-table' + (_isParliament ? '' : ' ie-item-table--ro') + '" id="saItemTable">';
    html += '<div class="sa-row sa-header ie-row-cols">' +
      '<span></span><span>Name</span><span>ID</span><span>Type</span><span>Category</span>' +
      '<span>Active</span><span>Stock</span>' +
      (_isParliament ? '<span>Controls</span>' : '') +
      '</div>';

    function _renderItemRow(item, skipAuctionControls) {
      var isActive = item.active !== false;
      var rowClass = 'sa-row' + (!isActive ? ' sa-row--inactive' : '');

      html += '<div class="' + rowClass + '" data-item-id="' + esc(item.id) + '"' + (_isParliament ? ' draggable="true"' : '') + '>';
      html += '<span class="sa-grip" title="Drag to reorder">' + _svg.grip + '</span>';
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
        } else if (_isParliament) {
          html += '<span><button class="sa-action-btn" data-start-auction="' + esc(item.id) + '">Start</button></span>';
        } else {
          html += '<span><span class="sa-pill" style="color:var(--text-faint);border-color:var(--border)">Not live</span></span>';
        }
      } else if (_isParliament) {
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
      } else if (_isParliament) {
        var stockVal = item.stock != null ? item.stock : '';
        html += '<span><input type="number" min="0" max="99999" class="sa-stock-input" data-stock-id="' + esc(item.id) + '" value="' + esc(stockVal) + '" placeholder="\u221E" /></span>';
      } else {
        html += '<span>' + (item.stock != null ? num(item.stock) : '\u221E') + '</span>';
      }

      // controls: auction actions + edit + delete
      if (_isParliament) {
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
        html += '<div class="sa-row sa-row--live' + (!isActive ? ' sa-row--inactive' : '') + '" data-item-id="' + esc(item.id) + '"' + (_isParliament ? ' draggable="true"' : '') + '>';
        html += '<span class="sa-grip"' + (_isParliament ? ' title="Drag to reorder"' : ' style="opacity:0.2;cursor:default"') + '>' + _svg.grip + '</span>';
        html += '<span class="sa-item-name">' + esc(item.name) + '</span>';
        html += '<span class="sa-item-id">' + esc(item.id) + '</span>';
        html += '<span><span class="sa-pill sa-pill--auction">Auction</span></span>';
        var liveCats = Array.isArray(item.category) ? item.category : (item.category ? [item.category] : []);
        html += '<span>' + (liveCats.length
          ? liveCats.map(function (c) { return '<span class="sa-pill sa-pill--cat">' + esc(c) + '</span>'; }).join(' ')
          : '<span style="color:var(--text-faint)">N/A</span>') + '</span>';
        if (_isParliament) {
          html += '<span><label class="settings-toggle" data-toggle-id="' + esc(item.id) + '">' +
            '<input type="checkbox"' + (isActive ? ' checked' : '') + ' />' +
            '<span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>' +
            '</label></span>';
        } else {
          html += '<span class="' + (isActive ? 'sa-status-on' : 'sa-status-off') + '">' + (isActive ? 'Active' : 'Inactive') + '</span>';
        }
        html += '<span style="color:var(--text-faint)">N/A</span>';
        if (_isParliament) {
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
              if (item) item.stock = stock;
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
    var _minAdjust = -(Math.max(0, remainingHours - 2)); // leave at least 2h
    // _minAdjust is negative or 0; e.g. if 50h remaining, min is -48
    if (_minAdjust > -1 && _minAdjust < 0) _minAdjust = -1; // at least allow -1 if there's room
    if (_minAdjust >= 0) _minAdjust = 0; // can't reduce at all if <= 2h left

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
          if (_isParliament) h += '<button class="am-bid-remove" data-remove-bid="' + esc(b.bid_id) + '" aria-label="Remove bid">' + _svg.close + '</button>';
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
      if (_isParliament) {
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
      if (_isParliament) {
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
          _showApply();
        });
        inp.addEventListener('blur', function () {
          var v = parseInt(this.value, 10);
          if (isNaN(v)) this.value = curExt;
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
        inp.value = v - 1;
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
              showToast('\u2713 End time adjusted to ' + (target > 0 ? '+' : '') + target + 'h.', 'success');
              data.ends_at = res.data.new_ends_at;
              data.extended = target !== 0;
              data.extended_hours = target;
              // Recompute clamp
              var newEndsMs = new Date(data.ends_at).getTime();
              var newRemaining = Math.floor((newEndsMs - Date.now()) / 3600000);
              _minAdjust = -(Math.max(0, newRemaining - 2));
              if (_minAdjust > -1 && _minAdjust < 0) _minAdjust = -1;
              if (_minAdjust >= 0) _minAdjust = 0;
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
            '<input type="text" class="shop-modal-input" id="amRemoveReason" placeholder="Reason for removal\u2026" />' +
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
    h += '<div class="ie-form-scroll">';

    // Basic Info
    h += '<div class="ie-section"><div class="ie-section-title">Basic Info</div>';

    // Row 1: Name (+ auto-ID preview) | Type | Active
    h += '<div class="ie-row">';
    h += '<div class="ie-field ie-field--wide">';
    h += '<label class="ie-label">Name</label>';
    h += '<input id="ieName" class="ie-input" value="' + esc(it.name || '') + '" placeholder="Display name" maxlength="45" />';
    h += '<input type="hidden" id="ieId" value="' + esc(it.id || '') + '" />';
    h += '</div>';
    h += '<div class="ie-field"><label class="ie-label">Type</label>' +
         '<select id="ieType" class="ie-input"><option value="bin"' + _sel(itType === 'bin') + '>Bin</option>' +
         '<option value="auction"' + _sel(itType === 'auction') + '>Auction</option></select></div>';
    h += '<div class="ie-field"><label class="ie-label">Active</label>' +
         '<select id="ieActive" class="ie-input"><option value="true"' + _sel(it.active !== false) + '>Yes</option>' +
         '<option value="false"' + _sel(it.active === false) + '>No</option></select></div>';
    h += '</div>';

    // Row 2: Categories (tag input)
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
    h += '<div class="ie-field ie-field--full"><label class="ie-label">Images <span class="ie-hint-inline">max 3</span></label>';
    h += '<div class="ie-img-list" id="ieImgList"></div>';
    h += '<button type="button" class="ie-img-add-btn" id="ieImgAdd">&#43; Upload Image</button>';
    h += '<input type="file" id="ieImgFile" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none" />';
    h += '<div class="ie-hint">PNG/JPG/GIF/WebP \u00b7 max 2 MB</div>';
    h += '</div>'; // field
    h += '</div>'; // basic section

    // Pricing & Stock
    h += '<div class="ie-section"><div class="ie-section-title">Pricing &amp; Stock</div>';
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
    h += '<div class="ie-field"><label class="ie-label">Allow Autobid</label><select id="ieAutobid" class="ie-input">' +
         '<option value="true"' + _sel(it.max_autobid) + '>Yes</option>' +
         '<option value="false"' + _sel(!it.max_autobid) + '>No</option></select></div>';
    h += '</div>';
    h += '</div>'; // pricing section

    // EP Settings
    h += '<div class="ie-section"><div class="ie-section-title">EP Settings</div><div class="ie-row">';
    h += '<div class="ie-field"><label class="ie-label">Accepts Dirty EP</label>' +
         '<select id="ieDirtyEP" class="ie-input">' +
         '<option value="true"' + _sel(acceptsDirty) + '>Yes</option>' +
         '<option value="false"' + _sel(!acceptsDirty) + '>No (Clean Only)</option>' +
         '</select></div>';
    h += '<div class="ie-field"><label class="ie-label">Spend Order</label>' +
         '<select id="ieSpendOrder" class="ie-input"' + (!acceptsDirty ? ' disabled' : '') + '>' +
         ['clean_first', 'dirty_first', 'clean_only', 'dirty_only'].map(function (o) {
           return '<option value="' + o + '"' + _sel(spendVal === o) + '>' + o.replace(/_/g, ' ') + '</option>';
         }).join('') + '</select></div>';
    h += '</div></div>'; // EP section

    // Cooldown
    h += '<div class="ie-section" data-ie-bin><div class="ie-section-title">Cooldown</div><div class="ie-row">';
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
    h += '</div></div>'; // cooldown field
    h += '</div>'; // ie-row
    h += '</div>'; // cooldown section

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
    h += '</div></div>'; // field + section

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
    var isBin = typeEl.value === 'bin';
    modal.querySelectorAll('[data-ie-bin]').forEach(function (el) { el.style.display = isBin ? '' : 'none'; });
    modal.querySelectorAll('[data-ie-auction]').forEach(function (el) { el.style.display = isBin ? 'none' : ''; });
  }

  function _ieCollect(modal) {
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

    return {
      id:                    gv('ieId'),
      type:                  gv('ieType'),
      name:                  gs('ieName', 45),
      description:           gs('ieDesc', 500),
      image:                 _ieImages.length ? _ieImages[0].url : '',
      images:                _ieImages.map(function (img) { return img.url; }),
      category:              _ieCatTags.slice(0, 10),
      active:                gv('ieActive'),
      price:                 gv('iePrice'),
      stock:                 gv('ieStock'),
      max_quantity:          gv('ieMaxQty'),
      starting_bid:          gv('ieStartBid'),
      min_increment:         gv('ieMinInc'),
      duration_type:         durType,
      duration_hours:        durHrsVal,
      anti_snipe_seconds:    gv('ieAntiSnipe'),
      winner_count:          gv('ieWinners'),
      max_autobid:           gv('ieAutobid'),
      accepts_dirty_ep:      gv('ieDirtyEP'),
      spend_order:           gv('ieSpendOrder'),
      cooldown:              cooldownVal,
      visible_to_ranks:      rankResult.length ? rankResult : null,
    };
  }

  function _bindItemEditorEvents(modal, origItem, isNew) {
    // Type toggle (bin/auction sections)
    var typeEl = modal.querySelector('#ieType');
    if (typeEl) typeEl.addEventListener('change', function () { _ieTypeToggle(modal); });

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

    // Dirty EP -> lock spend order to clean_only
    var dirtyEPEl   = modal.querySelector('#ieDirtyEP');
    var spendOrdEl  = modal.querySelector('#ieSpendOrder');
    if (dirtyEPEl && spendOrdEl) {
      dirtyEPEl.addEventListener('change', function () {
        if (dirtyEPEl.value === 'false') {
          spendOrdEl.value = 'clean_only';
          spendOrdEl.disabled = true;
        } else {
          spendOrdEl.disabled = false;
          if (spendOrdEl.value === 'clean_only') spendOrdEl.value = 'clean_first';
        }
      });
    }

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
    if (!_queueData) return;
    var count = (_queueData.purchases || []).length + (_queueData.donations || []).length;

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
    var total  = pCount + dCount;

    var html = '<div class="sa-q-filters">' +
      '<button class="sa-q-pill' + (_queueFilter === 'all' ? ' active' : '') + '" data-qf="all">All <span class="sa-q-count">' + total + '</span></button>' +
      '<button class="sa-q-pill' + (_queueFilter === 'purchases' ? ' active' : '') + '" data-qf="purchases">Shop Items <span class="sa-q-count">' + pCount + '</span></button>' +
      '<button class="sa-q-pill' + (_queueFilter === 'donations' ? ' active' : '') + '" data-qf="donations">Donations <span class="sa-q-count">' + dCount + '</span></button>' +
      '<span class="sa-q-sort" id="saQueueSort">' + (_queueSort === 'oldest' ? 'Oldest first' : 'Newest first') + '</span>' +
    '</div>';

    var merged = _queueMerged();

    html += '<div id="saQueueList">';
    if (!merged.length) {
      html += '<div class="shop-empty">No items in queue</div>';
    } else {
      merged.forEach(function (item) {
        var hidden = _queueFilter !== 'all' &&
          _queueFilter !== (item.type === 'purchase' ? 'purchases' : 'donations');
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

    var html = '<div class="sa-q-card' + (hidden ? ' sa-q-hidden' : '') +
      '" data-qtype="' + item.type +
      '" data-qid="' + esc(item.id) +
      '" data-qdate="' + esc(item.date) + '">';

    /* Header */
    html += '<div class="sa-q-header"><div class="sa-q-header-left">';
    html += '<span class="sa-q-user">' + esc(d.username) + '</span>';
    html += '<div class="sa-q-tags">';
    if (isPurchase) {
      html += '<span class="sa-q-type sa-q-type--purchase">Shop item</span>';
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
    if (isPurchase) {
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
    if (isPurchase && d.fulfillment_note) {
      html += '<div class="sa-q-note">' + _svg.pin + ' ' + esc(d.fulfillment_note) + '</div>';
    }

    /* Actions */
    if (_isChief) {
      html += '<div class="sa-q-actions">';
      if (isPurchase) {
        html += '<button class="sa-q-btn sa-q-btn--primary" data-action="fulfill" data-type="purchase" data-id="' + esc(d.purchase_id) + '">Mark fulfilled</button>';
        html += '<button class="sa-q-btn sa-q-btn--reject" data-action="reject" data-type="purchase" data-id="' + esc(d.purchase_id) + '">Reject</button>';
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
    var dCount = ((_queueData && _queueData.donations) || []).length;
    document.querySelectorAll('.sa-q-pill').forEach(function (p) {
      var cnt = p.querySelector('.sa-q-count');
      if (!cnt) return;
      var f = p.dataset.qf;
      if (f === 'all') cnt.textContent = pCount + dCount;
      else if (f === 'purchases') cnt.textContent = pCount;
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
      });
    });
  }

  function openFulfillModal(type, id, triggerBtn) {
    var modal = document.getElementById('saModal');
    var label = type === 'purchase' ? 'Mark Fulfilled' : 'Confirm Donation';
    modal.innerHTML =
      '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>' +
      '<div class="shop-modal-title">' + label + '</div>' +
      '<div class="shop-modal-body">' +
        '<label class="shop-modal-input-label">Note (optional)</label>' +
        '<input type="text" class="shop-modal-input" id="saFulfillNote" placeholder="Optional note\u2026" />' +
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
        '<input type="text" class="shop-modal-input" id="saRejectReason" placeholder="Reason for rejection\u2026" />' +
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
    purchase_rejected:  'Purchase Rejected',
    donation_confirmed: 'Donation Confirmed',
    donation_rejected:  'Donation Rejected',
  };

  var _ACTION_TYPES = Object.keys(_ACTION_LABELS);

  function fetchChanges(cb) {
    var qs = 'page=' + _changesPage + '&per_page=50';
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

  function _fmtChangesDetails(row) {
    var d = row.details || {};
    var action = row.action;
    if (action === 'item_created' || action === 'item_edited') {
      return esc(d.item_id || row.target_id || '') +
        (d.type ? ' <span style="color:var(--text-faint)">(' + esc(d.type) + ')</span>' : '');
    }
    if (action === 'item_deleted')      return esc(d.item_id || row.target_id || '');
    if (action === 'item_activated' || action === 'item_deactivated') {
      return esc(d.item_id || row.target_id || '');
    }
    if (action === 'stock_updated') {
      var ns = d.new_stock != null ? d.new_stock : '\u221E';
      return esc(d.item_id || row.target_id || '') +
        ' \u2192 ' + esc(String(ns));
    }
    if (action === 'items_reordered') return (d.count || '?') + ' items';
    if (action === 'auction_started') {
      return esc(d.item_id || '') +
        (d.ends_at ? ' \u2022 ends ' + fmtDate(d.ends_at) : '');
    }
    if (action === 'auction_extended') {
      var h = d.extra_hours > 0 ? '+' + d.extra_hours + 'h' : d.extra_hours + 'h';
      return esc(row.target_id || '') + ' ' + h;
    }
    if (action === 'auction_cancelled') {
      return esc(d.item_id || row.target_id || '');
    }
    if (action === 'bid_removed') {
      return esc(row.target_id || '') +
        (d.reason ? ' \u2022 ' + esc(d.reason) : '');
    }
    if (action === 'purchase_fulfilled' || action === 'purchase_rejected') {
      return esc(d.item_id || row.target_id || '') +
        (d.reason ? ' \u2022 ' + esc(d.reason) : '') +
        (d.note   ? ' \u2022 ' + esc(d.note)   : '');
    }
    if (action === 'donation_confirmed' || action === 'donation_rejected') {
      return esc(row.target_id || '') +
        (d.reason ? ' \u2022 ' + esc(d.reason) : '');
    }
    return esc(row.target_id || '');
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
    html += '<div class="sa-row sa-header sa-log-row sa-chg-row"><span>Time</span><span>Actor</span><span>Action</span><span>Details</span></div>';
    if (!_changesData.rows || !_changesData.rows.length) {
      html += '<div class="sa-row sa-log-row sa-chg-row" style="justify-content:center;color:var(--text-faint);">No records found.</div>';
    }
    (_changesData.rows || []).forEach(function (row) {
      html += '<div class="sa-row sa-log-row sa-chg-row">';
      html += '<span>' + fmtDate(row.timestamp) + '</span>';
      html += '<span>' + esc(row.actor) + '</span>';
      html += '<span><span class="sa-log-type sa-log-type--change">' +
        esc(_ACTION_LABELS[row.action] || row.action) + '</span></span>';
      html += '<span style="font-size:0.8rem;color:var(--text-secondary)">' + _fmtChangesDetails(row) + '</span>';
      html += '</div>';
    });
    html += '</div>';

    // pagination
    var chgHasMore = !!_changesData.has_more;
    html += '<div class="sa-pagination">';
    html += '<button class="shop-modal-btn shop-modal-btn--cancel sa-page-btn" data-chg-page="prev"' + (_changesPage <= 1 ? ' disabled' : '') + '><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg> Prev</button>';
    html += '<span class="sa-page-info">Page ' + _changesPage + '</span>';
    html += '<button class="shop-modal-btn shop-modal-btn--cancel sa-page-btn" data-chg-page="next"' + (!chgHasMore ? ' disabled' : '') + '>Next <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>';
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
        else if (btn.dataset.chgPage === 'next') _changesPage++;
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
    var qs = 'page=' + _logsPage + '&per_page=50';
    if (_logsFilters.username)  qs += '&username=' + encodeURIComponent(_logsFilters.username);
    if (_logsFilters.item_id)   qs += '&item_id='  + encodeURIComponent(_logsFilters.item_id);
    if (_logsFilters.type)      qs += '&type='     + encodeURIComponent(_logsFilters.type);
    if (_logsFilters.status)    qs += '&status='   + encodeURIComponent(_logsFilters.status);
    if (_logsFilters.date_from) qs += '&date_from=' + encodeURIComponent(_logsFilters.date_from);
    if (_logsFilters.date_to)   qs += '&date_to='   + encodeURIComponent(_logsFilters.date_to);
    fetch('/api/admin/shop/logs?' + qs, { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) _logsData = d; if (cb) cb(d); })
      .catch(function () { if (cb) cb(null); });
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
      '<option value="active"'    + (_logsFilters.status === 'active'    ? ' selected' : '') + '>Active</option>' +
      '</select>';
    html += '<span class="sa-filter-label">From:</span><input type="date" class="sa-filter-input" id="saLogFrom" value="' + esc(_logsFilters.date_from) + '" />';
    html += '<span class="sa-filter-label">To:</span><input type="date" class="sa-filter-input" id="saLogTo" value="' + esc(_logsFilters.date_to) + '" />';
    html += '<button class="shop-modal-btn shop-modal-btn--confirm" id="saLogSearch" style="padding:5px 14px;font-size:0.72rem;">Search</button>';
    html += '</div>';

    // unified feed: merge purchases + bids + donations, sort by date desc
    var feed = [];
    (_logsData.purchases || []).forEach(function (p) {
      feed.push({ type: 'purchase', date: p.purchased_at, user: p.username, item: p.item_id,
        ep: p.ep_spent, clean: p.clean_ep_spent, dirty: p.dirty_ep_spent, status: p.status,
        id: p.purchase_id, chief_note: p.chief_note });
    });
    (_logsData.bids || []).forEach(function (b) {
      feed.push({ type: 'bid', date: b.placed_at, user: b.username, item: b.item_id,
        ep: b.amount, clean: b.clean_ep_used, dirty: b.dirty_ep_used,
        status: b.auction_status === 'closed' ? (b.is_winning ? 'won' : 'outbid') : 'active',
        id: b.bid_id });
    });
    (_logsData.donations || []).forEach(function (d) {
      feed.push({ type: 'donation', date: d.submitted_at, user: d.username,
        item: num(d.le_amount) + ' LE',
        ep: d.dirty_ep_to_grant, clean: 0, dirty: d.dirty_ep_to_grant,
        status: d.status, id: d.ticket_id });
    });
    feed.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });

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
    var hasMore = !!_logsData.has_more;
    html += '<div class="sa-pagination">';
    html += '<button class="shop-modal-btn shop-modal-btn--cancel sa-page-btn" data-page="prev"' + (_logsPage <= 1 ? ' disabled' : '') + '><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg> Prev</button>';
    html += '<span class="sa-page-info">Page ' + _logsPage + '</span>';
    html += '<button class="shop-modal-btn shop-modal-btn--cancel sa-page-btn" data-page="next"' + (!hasMore ? ' disabled' : '') + '>Next <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>';
    html += '</div>';

    c.innerHTML = html;

    // log type switcher — immediate, no Search needed
    document.getElementById('saLogTypeView').addEventListener('change', function () {
      _logsFilters.log_type = this.value;
      _logsPage = 1; _logsData = null;
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
      _renderLogsBody();
    });

    // bind pagination
    c.querySelectorAll('[data-page]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.page === 'prev' && _logsPage > 1) _logsPage--;
        else if (btn.dataset.page === 'next') _logsPage++;
        _logsData = null;
        _renderLogsBody();
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

  function fetchUsers(cb) {
    fetch('/api/admin/shop/users', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) _users = d; if (cb) cb(d); })
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
      if (sort === 'ep_desc') return (b.ep_total  || 0) - (a.ep_total  || 0);
      if (sort === 'ep_asc')  return (a.ep_total  || 0) - (b.ep_total  || 0);
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

  function renderUsers(c) {
    if (!_users) {
      c.innerHTML = '<div class="shop-loading"><span class="loading-spinner"></span> Loading users\u2026</div>';
      fetchUsers(function () { _renderUsersContent(c); });
    } else {
      _renderUsersContent(c);
    }
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
      [['az','A\u2192Z'],['ep_desc','Most EP spent'],['ep_asc','Least EP spent'],['orders','Most orders'],['donated','Most donated'],['recent','Most recent']]
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
    html += '<span></span><span>User</span><span>EP Spent</span><span>Orders</span><span>Bids</span><span>Donations</span><span>Last Activity</span><span>Status</span>';
    html += '</div>';

    page.forEach(function (u) {
      var active = _isUserActive(u);
      var isOpen = _usersOpenUuid === u.uuid;
      html += '<div class="sa-row su-row su-user-row' + (isOpen ? ' su-row--open' : '') + '" data-uuid="' + esc(u.uuid) + '">';
      html += '<span class="su-expand">' + _svg.chevron + '</span>';
      html += '<span class="su-user-cell">' +
        '<span class="su-username">' + esc(u.username) + '</span>' +
        '<span class="su-tag">' + (u.discord_id ? esc(u.discord_id) : esc((u.uuid || '').substring(0, 8) + '\u2026')) + '</span>' +
        '</span>';
      html += '<span class="su-ep-cell">' +
        '<span class="su-ep-total">' + num(u.ep_total) + ' EP</span>' +
        '<span class="su-ep-split">' + num(u.ep_clean) + 'c + ' + num(u.ep_dirty) + 'd</span>' +
        '</span>';
      html += '<span>' + (u.orders    || 0) + '</span>';
      html += '<span>' + (u.bids      || 0) + '</span>';
      html += '<span>' + (u.donations || 0) + '</span>';
      html += '<span class="su-date">' + fmtDate(u.last_activity) + '</span>';
      html += '<span><span class="su-status su-status--' + (active ? 'active' : 'inactive') + '">' + (active ? 'Active' : 'Inactive') + '</span></span>';
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
  }

  function _buildUserDrawer(u) {
    var html = '';
    var bal          = u.balance || {};
    var totalReserved = (bal.clean_reserved || 0) + (bal.dirty_reserved || 0);

    /* Six-metric strip */
    html += '<div class="su-metrics">';
    [
      [num(u.ep_total)    + ' EP', 'Total spent'],
      [num(u.ep_clean)    + ' EP', 'Clean spent'],
      [num(u.ep_dirty)    + ' EP', 'Dirty spent'],
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

  /* Init */
  var _initDone = false;
  function initAdmin() {
    if (_initDone) return;
    _initDone = true;
    if (!window.state || !window.state.loggedIn) {
      panel.innerHTML = '<div class="shop-login-prompt">Log in to access the shop admin.</div>';
      return;
    }
    buildShell();
    // pre-fetch queue to show badge count
    fetchQueue(function () { updateQueueBadge(); });
    renderTab();
  }

  var observer = new MutationObserver(function () {
    if (panel.classList.contains('active')) initAdmin();
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  if (panel.classList.contains('active')) initAdmin();
})();
