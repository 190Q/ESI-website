(function () {
  'use strict';

  var panel = document.getElementById('panel-shop');
  if (!panel) return;

  var _binData        = null;   // cached GET /api/shop/bin response
  var _auctionData    = null;   // cached GET /api/shop/auctions response
  var _filterType     = 'all'; // 'all' | 'bin' | 'auction'
  var _filterCat      = null;  // null | category string
  var _filterEP       = null;  // null | 'clean' | 'any'
  var _filterAvail    = null;  // null | 'available' | 'unavailable'
  var _filterSearch   = '';    // text search
  var _filterMinPrice = null;  // null = no lower limit
  var _filterMaxPrice = null;  // null = no upper limit
  var _filterCooldown = null;  // null | 'has' | 'none'
  var _filterStock    = null;  // null | 'instock' | 'outstock' | 'unlimited'
  var _priceAbsMin    = 0;
  var _priceAbsMax    = 1000;
  var _filterBarBuilt = false;
  var _searchDebTimer = null;
  var _countdownTimer = null;
  var _auctionTimer   = null;  // 1s tick for auction countdowns
  var _auctionPoll    = null;  // 30s auction data refresh
  var _shellBuilt     = false;
  var _cart           = {};    // { [item_id]: { item, quantity } }
  var _cartSyncTimer  = null;
  var _cartContentTimer = null;
  var _cartLoaded     = false;
  var _DONATE_LE_TO_EP = 15;    // 1 LE = 15 dirty EP

  var _svg = {
    cart:      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>',
    check:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    close:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    warn:      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    clock:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    hourglass: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 1 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/></svg>',
    minus:     '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    diamond:   '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2" transform="rotate(45 12 12)"/></svg>',
    gem:       '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="12 2 22 9 18 21 6 21 2 9"/></svg>',
    rejected:  '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  };

  /* Helpers */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(n) { return Number(n || 0).toLocaleString(); }

  /* Cart persistence */
  function syncCart() {
    if (!_cartLoaded) return;
    if (_cartSyncTimer) clearTimeout(_cartSyncTimer);
    _cartSyncTimer = setTimeout(function () {
      _cartSyncTimer = null;
      var items = Object.keys(_cart).map(function (id) {
        return { item_id: id, quantity: _cart[id].quantity };
      });
      fetch('/api/shop/cart', {
        method: 'PUT', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: items }),
      }).catch(function () {});
    }, 600);
  }

  function loadCart(binItems) {
    fetch('/api/shop/cart', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        var itemMap = {};
        (binItems || []).forEach(function (it) { itemMap[it.id] = it; });
        if (data && data.ok && data.items) {
          _cart = {};
          data.items.forEach(function (entry) {
            var item = itemMap[entry.item_id];
            if (!item) return;
            // Multi-qty items: cap by max_quantity & stock; single-qty: always 1
            var maxQ = item.allow_multi_quantity
              ? Math.min(item.max_quantity || 999, item.stock != null ? item.stock : 999)
              : 1;
            _cart[entry.item_id] = { item: item, quantity: Math.max(1, Math.min(entry.quantity, maxQ)) };
          });
        }
        _cartLoaded = true;
        var badge = document.getElementById('shopCartBadge');
        var btn   = document.getElementById('shopCartBtn');
        var total = cartTotal();
        if (badge) badge.textContent = total;
        if (total > 0) renderContent();
      })
      .catch(function () { _cartLoaded = true; });
  }

  /* Cart helpers */
  function cartTotal() {
    return Object.keys(_cart).reduce(function (n, id) { return n + _cart[id].quantity; }, 0);
  }
  function cartClear() { _cart = {}; updateCartBadge(); }
  function _debouncedRenderContent() {
    if (_cartContentTimer) clearTimeout(_cartContentTimer);
    _cartContentTimer = setTimeout(function () { _cartContentTimer = null; renderContent(); }, 300);
  }
  function updateCartBadge() {
    var badge = document.getElementById('shopCartBadge');
    var btn   = document.getElementById('shopCartBtn');
    var total = cartTotal();
    if (badge) badge.textContent = total;
    syncCart();
  }

  /* Shell */
  function buildShell() {
    if (_shellBuilt) return;
    _shellBuilt = true;
    panel.innerHTML =
      '<div class="shop-balance-wrap">' +
        '<div id="shopBalanceBar" class="shop-balance-bar"></div>' +
        '<div class="shop-top-actions">' +
          '<button id="shopOrdersBtn" class="shop-orders-btn">My Orders</button>' +
          '<button id="shopCartBtn" class="cart-btn">' +
            _svg.cart + ' Cart <span class="cart-badge" id="shopCartBadge">0</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="shop-main-layout">' +
        '<div id="shopFilters" class="shop-filters"></div>' +
        '<div id="shopContent" class="shop-content"></div>' +
      '</div>' +
      '<div class="shop-modal-backdrop" id="shopModalBackdrop">' +
        '<div class="shop-modal" id="shopModal">' +
          '<div class="shop-modal-title" id="shopModalTitle"></div>' +
          '<div class="shop-modal-body" id="shopModalBody"></div>' +
          '<div class="shop-modal-breakdown" id="shopModalBreakdown"></div>' +
          '<div class="shop-modal-actions" id="shopModalActions"></div>' +
        '</div>' +
      '</div>';

    document.getElementById('shopModalBackdrop').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });
    document.getElementById('shopModal').addEventListener('click', function (e) {
      if (e.target.closest('.modal-close')) closeModal();
    });
    document.getElementById('shopCartBtn').addEventListener('click', openCartModal);
    document.getElementById('shopOrdersBtn').addEventListener('click', openOrdersModal);
  }

  /* Data fetching */
  function fetchBinData(cb) {
    fetch('/api/shop/bin', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data) _binData = data; if (cb) cb(data); })
      .catch(function () { if (cb) cb(null); });
  }

  function fetchAuctionData(cb) {
    fetch('/api/shop/auctions', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (data) {
          _auctionData = data;
          if (data.balance && _binData) { _binData.balance = data.balance; renderBalanceBar(); }
        }
        if (cb) cb(data);
      })
      .catch(function () { if (cb) cb(null); });
  }

  function startCountdownTick() {
    if (_countdownTimer) clearInterval(_countdownTimer);
    _countdownTimer = setInterval(renderBalanceBar, 60000);
  }

  /* Balance bar */
  var _mkBlock = function (label, value, reserved) {
    return '<div class="bal-block">' +
      '<span class="bal-block-label">' + label + '</span>' +
      '<span class="bal-block-value">' + num(value) + '</span>' +
      (reserved > 0 ? '<span class="bal-block-reserved">' + num(reserved) + ' reserved</span>' : '') +
      '</div>';
  };

  function renderBalanceBar() {
    var el = document.getElementById('shopBalanceBar');
    if (!el || !_binData || !_binData.balance) return;
    var b = _binData.balance;
    var html = '<div class="bal-blocks">' +
      _mkBlock('Clean EP', b.spendable_clean, b.reserved_clean) +
      _mkBlock('Dirty EP', b.spendable_dirty, b.reserved_dirty) +
      _mkBlock('Total EP', b.total_ep, 0) +
      '</div>';
    var endsAt = _binData.cycle_ends_at;
    var cycleId = _binData.current_cycle_id;
    if (endsAt) {
      var end  = new Date(endsAt);
      var diff = Math.max(0, end - new Date());
      var d = Math.floor(diff / 86400000);
      var h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      html += '<div class="bal-cycle">' +
        '<span class="bal-cycle-label">End of Cycle' + '</span>' +
        '<span class="bal-cycle-value">' + d + 'd ' + h + 'h ' + m + 'm</span>' +
        '</div>';
    }
    el.innerHTML = html;
  }

  /* Filter bar */
  function _allCategories() {
    var cats = {};
    function add(arr) { (arr || []).forEach(function (c) { if (c) cats[c] = true; }); }
    ((_binData && _binData.items) || []).forEach(function (it) {
      add(Array.isArray(it.category) ? it.category : it.category ? [it.category] : []);
    });
    ((_auctionData && _auctionData.auctions) || []).forEach(function (a) {
      add(Array.isArray(a.item_category) ? a.item_category : a.item_category ? [a.item_category] : []);
    });
    return Object.keys(cats).sort();
  }

  function _computePriceRange() {
    var prices = [];
    ((_binData && _binData.items) || []).forEach(function (it) {
      if (it.price != null && it.price > 0) prices.push(it.price);
    });
    ((_auctionData && _auctionData.auctions) || []).forEach(function (a) {
      var p = a.current_highest_bid || a.starting_bid || 0;
      if (p > 0) prices.push(p);
    });
    if (!prices.length) return { min: 0, max: 1000 };
    var lo = Math.min.apply(null, prices);
    var hi = Math.max.apply(null, prices);
    return { min: lo, max: lo === hi ? hi + 100 : hi };
  }

  function _updateSliderFill() {
    var fill  = document.getElementById('sfSliderFill');
    var minEl = document.getElementById('sfPriceMin');
    var maxEl = document.getElementById('sfPriceMax');
    if (!fill || !minEl || !maxEl) return;
    var range = _priceAbsMax - _priceAbsMin;
    if (range <= 0) { fill.style.left = '0%'; fill.style.width = '100%'; return; }
    var lo = ((parseInt(minEl.value) - _priceAbsMin) / range) * 100;
    var hi = ((parseInt(maxEl.value) - _priceAbsMin) / range) * 100;
    fill.style.left  = Math.max(0, lo) + '%';
    fill.style.width = Math.max(0, hi - lo) + '%';
  }

  function buildFilterBar() {
    if (_filterBarBuilt) { updateFilterBarData(); return; }
    _filterBarBuilt = true;

    var pr = _computePriceRange();
    _priceAbsMin = pr.min;
    _priceAbsMax = pr.max;

    var el = document.getElementById('shopFilters');
    if (!el) return;

    var cats    = _allCategories();
    var catOpts = '<option value="">All</option>';
    cats.forEach(function (c) { catOpts += '<option value="' + esc(c) + '">' + esc(c) + '</option>'; });

    var curMin = _filterMinPrice !== null ? _filterMinPrice : _priceAbsMin;
    var curMax = _filterMaxPrice !== null ? _filterMaxPrice : _priceAbsMax;

    el.innerHTML =
      '<div class="shop-filter-bar" id="shopFilterBar" data-type="' + esc(_filterType) + '">' +
        '<input type="search" id="sfSearch" class="sf-search" placeholder="Search by name\u2026" value="' + esc(_filterSearch) + '" />' +
        '<div class="sf-section">' +
          '<span class="sf-section-title">Type</span>' +
          '<div class="sf-chips">' +
            '<button class="shop-chip' + (_filterType === 'all' ? ' active' : '') + '" data-sftype="all">All</button>' +
            '<button class="shop-chip' + (_filterType === 'bin' ? ' active' : '') + '" data-sftype="bin">Bin</button>' +
            '<button class="shop-chip' + (_filterType === 'auction' ? ' active' : '') + '" data-sftype="auction">Auctions</button>' +
          '</div>' +
        '</div>' +
        '<div class="sf-section">' +
          '<span class="sf-section-title">Price (EP)</span>' +
          '<div class="sf-slider-rail">' +
            '<div class="sf-slider-fill" id="sfSliderFill"></div>' +
            '<input type="range" class="sf-range sf-range-min" id="sfPriceMin" min="' + _priceAbsMin + '" max="' + _priceAbsMax + '" value="' + curMin + '" />' +
            '<input type="range" class="sf-range sf-range-max" id="sfPriceMax" min="' + _priceAbsMin + '" max="' + _priceAbsMax + '" value="' + curMax + '" />' +
          '</div>' +
          '<div class="sf-price-vals">' +
            '<span id="sfPriceMinVal">' + num(curMin) + '</span>' +
            ' \u2013 ' +
            '<span id="sfPriceMaxVal">' + (curMax >= _priceAbsMax ? '\u221E' : num(curMax)) + '</span>' +
            ' EP' +
          '</div>' +
        '</div>' +
        '<div class="sf-section">' +
          '<span class="sf-section-title">Category</span>' +
          '<select id="sfCat" class="sf-select">' + catOpts + '</select>' +
        '</div>' +
        '<div class="sf-section">' +
          '<span class="sf-section-title">EP Type</span>' +
          '<select id="sfEP" class="sf-select">' +
            '<option value="">Any</option>' +
            '<option value="clean"' + (_filterEP === 'clean' ? ' selected' : '') + '>Clean Only</option>' +
            '<option value="any"' + (_filterEP === 'any' ? ' selected' : '') + '>Dirty OK</option>' +
          '</select>' +
        '</div>' +
        '<div class="sf-section">' +
          '<span class="sf-section-title">Status</span>' +
          '<select id="sfAvail" class="sf-select">' +
            '<option value="">All</option>' +
            '<option value="available"' + (_filterAvail === 'available' ? ' selected' : '') + '>Available</option>' +
            '<option value="unavailable"' + (_filterAvail === 'unavailable' ? ' selected' : '') + '>Unavailable</option>' +
          '</select>' +
        '</div>' +
        '<div class="sf-section" data-bin-field>' +
          '<span class="sf-section-title">Stock</span>' +
          '<select id="sfStock" class="sf-select">' +
            '<option value="">All</option>' +
            '<option value="instock"' + (_filterStock === 'instock' ? ' selected' : '') + '>In Stock</option>' +
            '<option value="outstock"' + (_filterStock === 'outstock' ? ' selected' : '') + '>Out of Stock</option>' +
            '<option value="unlimited"' + (_filterStock === 'unlimited' ? ' selected' : '') + '>Unlimited</option>' +
          '</select>' +
        '</div>' +
        '<div class="sf-section" data-bin-field>' +
          '<span class="sf-section-title">Cooldown</span>' +
          '<select id="sfCooldown" class="sf-select">' +
            '<option value="">All</option>' +
            '<option value="has"' + (_filterCooldown === 'has' ? ' selected' : '') + '>Has Cooldown</option>' +
            '<option value="none"' + (_filterCooldown === 'none' ? ' selected' : '') + '>No Cooldown</option>' +
          '</select>' +
        '</div>' +
        '<button id="sfReset" class="sf-reset-btn">Reset Filters</button>' +
      '</div>';

    _updateSliderFill();
    if (_filterCat) { var cs = document.getElementById('sfCat'); if (cs) cs.value = _filterCat; }
    _bindFilterBarEvents();
    renderContent();
  }

  function _bindFilterBarEvents() {
    // Search
    var searchEl = document.getElementById('sfSearch');
    if (searchEl) {
      searchEl.addEventListener('input', function () {
        _filterSearch = this.value;
        if (_searchDebTimer) clearTimeout(_searchDebTimer);
        _searchDebTimer = setTimeout(renderContent, 200);
      });
    }

    // Type chips (delegated from bar)
    var bar = document.getElementById('shopFilterBar');
    if (bar) {
      bar.addEventListener('click', function (e) {
        var chip = e.target.closest('[data-sftype]');
        if (!chip) return;
        var t = chip.dataset.sftype;
        if (t === _filterType) return;
        _filterType = t;
        bar.setAttribute('data-type', _filterType);
        bar.querySelectorAll('[data-sftype]').forEach(function (c) { c.classList.remove('active'); });
        chip.classList.add('active');
        // Reset bin-only filters when switching to Auctions
        if (_filterType === 'auction') {
          _filterStock = null; _filterCooldown = null;
          ['sfStock','sfCooldown'].forEach(function (id) {
            var s = document.getElementById(id); if (s) s.value = '';
          });
        }
        renderContent();
      });
    }

    // Price sliders
    var minEl = document.getElementById('sfPriceMin');
    var maxEl = document.getElementById('sfPriceMax');
    if (minEl && maxEl) {
      minEl.addEventListener('input', function () {
        var v = parseInt(this.value);
        if (v > parseInt(maxEl.value)) { this.value = maxEl.value; v = parseInt(maxEl.value); }
        _filterMinPrice = (v <= _priceAbsMin) ? null : v;
        var lbl = document.getElementById('sfPriceMinVal'); if (lbl) lbl.textContent = num(v);
        _updateSliderFill(); renderContent();
      });
      maxEl.addEventListener('input', function () {
        var v = parseInt(this.value);
        if (v < parseInt(minEl.value)) { this.value = minEl.value; v = parseInt(minEl.value); }
        _filterMaxPrice = (v >= _priceAbsMax) ? null : v;
        var lbl = document.getElementById('sfPriceMaxVal'); if (lbl) lbl.textContent = (v >= _priceAbsMax) ? '\u221E' : num(v);
        _updateSliderFill(); renderContent();
      });
    }

    // Selects
    var selDefs = [
      { id: 'sfCat',      fn: function (v) { _filterCat     = v || null; } },
      { id: 'sfEP',       fn: function (v) { _filterEP      = v || null; } },
      { id: 'sfAvail',    fn: function (v) { _filterAvail   = v || null; } },
      { id: 'sfStock',    fn: function (v) { _filterStock   = v || null; } },
      { id: 'sfCooldown', fn: function (v) { _filterCooldown = v || null; } },
    ];
    selDefs.forEach(function (s) {
      var el = document.getElementById(s.id);
      if (el) el.addEventListener('change', function () { s.fn(this.value); renderContent(); });
    });

    // Reset button
    var resetBtn = document.getElementById('sfReset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        _filterSearch = ''; _filterCat = null; _filterEP = null;
        _filterAvail = null; _filterMinPrice = null; _filterMaxPrice = null;
        _filterCooldown = null; _filterStock = null;
        _filterType = 'all';
        _filterBarBuilt = false;
        buildFilterBar();
      });
    }
  }

  function updateFilterBarData() {
    if (!_filterBarBuilt) return;
    // Refresh category options
    var catSel = document.getElementById('sfCat');
    if (catSel) {
      var cats = _allCategories();
      var opts = '<option value="">All</option>';
      cats.forEach(function (c) { opts += '<option value="' + esc(c) + '">' + esc(c) + '</option>'; });
      catSel.innerHTML = opts;
      if (_filterCat) catSel.value = _filterCat;
    }
    // Extend price range if new data goes outside it
    var pr = _computePriceRange();
    var changed = pr.min < _priceAbsMin || pr.max > _priceAbsMax;
    if (changed) {
      if (pr.min < _priceAbsMin) _priceAbsMin = pr.min;
      if (pr.max > _priceAbsMax) _priceAbsMax = pr.max;
      var minEl = document.getElementById('sfPriceMin');
      var maxEl = document.getElementById('sfPriceMax');
      if (minEl) { minEl.min = _priceAbsMin; minEl.max = _priceAbsMax; }
      if (maxEl) { maxEl.min = _priceAbsMin; maxEl.max = _priceAbsMax; if (!_filterMaxPrice) maxEl.value = _priceAbsMax; }
      if (!_filterMaxPrice) { var lbl = document.getElementById('sfPriceMaxVal'); if (lbl) lbl.textContent = '\u221E'; }
      _updateSliderFill();
    }
  }

  /* Unified content renderer */
  function renderContent() {
    var container = document.getElementById('shopContent');
    if (!container) return;

    var binItems     = (_binData && _binData.items) ? _binData.items : [];
    var auctionItems = (_auctionData && _auctionData.auctions) ? _auctionData.auctions : [];
    var myUuid       = (_auctionData && _auctionData.uuid) ? _auctionData.uuid : '';

    var showBin     = (_filterType === 'all' || _filterType === 'bin');
    var showAuction = (_filterType === 'all' || _filterType === 'auction');
    var filtered    = [];
    var searchLow   = _filterSearch.trim().toLowerCase();

    // Filter bin items
    var fBin = [];
    if (showBin) {
      fBin = binItems.slice();
      if (searchLow) fBin = fBin.filter(function (it) {
        return (it.name || '').toLowerCase().indexOf(searchLow) !== -1 ||
               (it.description || '').toLowerCase().indexOf(searchLow) !== -1 ||
               (it.id || '').toLowerCase().indexOf(searchLow) !== -1;
      });
      if (_filterMinPrice !== null) fBin = fBin.filter(function (it) { return (it.price || 0) >= _filterMinPrice; });
      if (_filterMaxPrice !== null) fBin = fBin.filter(function (it) { return (it.price || 0) <= _filterMaxPrice; });
      if (_filterCat) fBin = fBin.filter(function (it) {
        var c = it.category;
        return Array.isArray(c) ? c.indexOf(_filterCat) !== -1 : c === _filterCat;
      });
      if (_filterEP === 'clean') fBin = fBin.filter(function (it) { return !it.accepts_dirty_ep || it.spend_order === 'clean_only'; });
      else if (_filterEP === 'any') fBin = fBin.filter(function (it) { return it.accepts_dirty_ep && it.spend_order !== 'clean_only'; });
      if (_filterAvail === 'available') fBin = fBin.filter(function (it) { return it.active && !it.on_cooldown && (it.stock == null || it.stock > 0); });
      else if (_filterAvail === 'unavailable') fBin = fBin.filter(function (it) { return !it.active || it.on_cooldown || (it.stock != null && it.stock <= 0); });
      if (_filterStock === 'instock') fBin = fBin.filter(function (it) { return it.stock != null && it.stock > 0; });
      else if (_filterStock === 'outstock') fBin = fBin.filter(function (it) { return it.stock != null && it.stock <= 0; });
      else if (_filterStock === 'unlimited') fBin = fBin.filter(function (it) { return it.stock == null; });
      if (_filterCooldown === 'has') fBin = fBin.filter(function (it) { return !!it.cooldown; });
      else if (_filterCooldown === 'none') fBin = fBin.filter(function (it) { return !it.cooldown; });
    }

    // Filter auction items
    var fAuc = [];
    if (showAuction && !_filterStock) {
      fAuc = auctionItems.slice();
      if (searchLow) fAuc = fAuc.filter(function (a) {
        return (a.item_name || '').toLowerCase().indexOf(searchLow) !== -1 ||
               (a.item_description || '').toLowerCase().indexOf(searchLow) !== -1;
      });
      if (_filterMinPrice !== null) fAuc = fAuc.filter(function (a) { return (a.current_highest_bid || a.starting_bid || 0) >= _filterMinPrice; });
      if (_filterMaxPrice !== null) fAuc = fAuc.filter(function (a) { return (a.current_highest_bid || a.starting_bid || 0) <= _filterMaxPrice; });
      if (_filterCat) fAuc = fAuc.filter(function (a) {
        var c = a.item_category;
        return Array.isArray(c) ? c.indexOf(_filterCat) !== -1 : c === _filterCat;
      });
      if (_filterEP === 'clean') fAuc = fAuc.filter(function (a) { return !a.accepts_dirty_ep || a.spend_order === 'clean_only'; });
      else if (_filterEP === 'any') fAuc = fAuc.filter(function (a) { return a.accepts_dirty_ep && a.spend_order !== 'clean_only'; });
      if (_filterAvail === 'available') fAuc = fAuc.filter(function (a) { return a.status === 'active' && a.active !== false; });
      else if (_filterAvail === 'unavailable') fAuc = fAuc.filter(function (a) { return a.status !== 'active' || a.active === false; });
    }

    // Merge bin + auction cards in JSON item order
    var itemOrder = (_binData && _binData.item_order) || [];
    var binById = {};
    fBin.forEach(function (it) { binById[it.id] = it; });
    var aucById = {};
    fAuc.forEach(function (a) { aucById[a.item_id] = a; });

    itemOrder.forEach(function (id) {
      if (binById[id])      { filtered.push({ kind: 'bin',     data: binById[id] }); delete binById[id]; }
      else if (aucById[id]) { filtered.push({ kind: 'auction', data: aucById[id] }); delete aucById[id]; }
    });
    // Append any leftovers not in the order list
    Object.keys(binById).forEach(function (id) { filtered.push({ kind: 'bin', data: binById[id] }); });
    Object.keys(aucById).forEach(function (id) { filtered.push({ kind: 'auction', data: aucById[id] }); });

    if (!filtered.length) {
      stopAuctionTimers();
      container.innerHTML = (!_binData && !_auctionData)
        ? '<div class="shop-loading"><span class="loading-spinner"></span> Loading\u2026</div>'
        : '<div class="shop-empty">No items match your filters.</div>';
      return;
    }

    var hasAuctions = filtered.some(function (it) { return it.kind === 'auction'; });
    if (!hasAuctions) stopAuctionTimers();

    var html = '<div class="shop-grid">';
    filtered.forEach(function (it) {
      html += it.kind === 'bin' ? buildBinCard(it.data) : buildAuctionCard(it.data, myUuid);
    });
    html += '</div>';
    container.innerHTML = html;
    _freezeGifs(container);

    bindBinEvents(container);
    bindAuctionEvents(container, auctionItems);

    if (hasAuctions) {
      tickAuctionCountdowns();
      startAuctionCountdown(); // client-side only; no server polling
    }
  }

  /* Card ribbon helper */
  function _ribbon(text, modifier) {
    return '<div class="shop-card-ribbon' + (modifier ? ' shop-card-ribbon--' + modifier : '') + '">' + text + '</div>';
  }

  /* Category badges helper */
  var _catIcon = '<svg class="shop-cat-icon" viewBox="0 0 448 512" fill="currentColor"><path d="M0 80V229.5c0 17 6.7 33.3 18.7 45.3l176 176c25 25 65.5 25 90.5 0L418.7 317.3c25-25 25-65.5 0-90.5l-176-176c-12-12-28.3-18.7-45.3-18.7H48C21.5 32 0 53.5 0 80zm112 32a32 32 0 1 1 0 64 32 32 0 1 1 0-64z"/></svg>';
  function _catBadges(cats) {
    if (!cats) return '';
    var arr = Array.isArray(cats) ? cats : [cats];
    return arr.map(function (c) {
      return '<span class="shop-card-badge shop-card-badge--cat">' + _catIcon + ' ' + esc(c) + '</span>';
    }).join('');
  }

  /* Bin card */

  // Build just the action area HTML (button/stepper/in-cart indicator)
  function _buildBinActionHtml(item) {
    var inactive   = !item.active;
    var onCooldown = item.on_cooldown;
    var disabled   = inactive || onCooldown || (item.stock != null && item.stock <= 0);
    var label;
    if (onCooldown && item.cooldown_ends_at) {
      label = 'Available in ' + Math.ceil(Math.max(0, new Date(item.cooldown_ends_at) - new Date()) / 86400000) + 'd';
    } else if (onCooldown) { label = 'On Cooldown';
    } else if (item.stock != null && item.stock <= 0) { label = 'Out of Stock';
    } else { label = 'Add to Cart'; }
    var cartEntry = _cart[item.id];
    if (item.allow_multi_quantity) {
      if (cartEntry) {
        var maxQ = Math.min(item.max_quantity || 999, item.stock != null ? item.stock : 999);
        return '<div class="cart-stepper">' +
          '<button class="cart-step-btn" data-step-dec="' + esc(item.id) + '">&#8722;</button>' +
          '<span class="cart-qty">' + cartEntry.quantity + '</span>' +
          '<button class="cart-step-btn" data-step-inc="' + esc(item.id) + '"' +
            (cartEntry.quantity >= maxQ ? ' disabled' : '') + '>&#43;</button></div>';
      }
      return '<button class="shop-buy-btn shop-buy-btn--add-cart" data-add-cart="' +
        esc(item.id) + '"' + (disabled ? ' disabled' : '') + '>Add to Cart</button>';
    } else {
      if (cartEntry) {
        return '<div class="cart-in-cart-wrap">' +
          '<span class="cart-in-cart-label">' + _svg.check + ' In Cart</span>' +
          '<button class="cart-remove-single" data-remove-single="' + esc(item.id) + '">&times; Remove</button>' +
          '</div>';
      }
      return '<button class="shop-buy-btn shop-buy-btn--add-cart" data-add-cart="' +
        esc(item.id) + '"' + (disabled ? ' disabled' : '') + '>' +
        (onCooldown ? label : 'Add to Cart') + '</button>';
    }
  }

  function _patchCartAction(itemId) {
    var card = document.querySelector('.shop-card[data-item-id="' + itemId + '"]');
    if (!card) return;
    card.classList.toggle('shop-card--in-cart', !!_cart[itemId]);
  }

  function _cooldownLabel(item) {
    if (!item.on_cooldown) return '';
    if (item.cooldown_ends_at) {
      return 'Available in ' + Math.ceil(Math.max(0, new Date(item.cooldown_ends_at) - new Date()) / 86400000) + 'd';
    }
    return 'On Cooldown';
  }

  function buildBinCard(item) {
    var isDonate = item.type === 'donate';
    var inactive = !item.active;
    var onCooldown = !isDonate && item.on_cooldown;
    var inCart = !isDonate && !!_cart[item.id];
    var cdText = !isDonate ? _cooldownLabel(item) : '';
    var html = '<div class="shop-card' + (inactive ? ' shop-card--unavailable' : '') +
      (onCooldown && !inactive ? ' shop-card--cooldown' : '') +
      (inCart ? ' shop-card--in-cart' : '') + '" data-item-id="' + esc(item.id) + '"' +
      (cdText ? ' data-cooldown="' + esc(cdText) + '"' : '') + '>';
    var _thumb = (item.images && item.images.length) ? item.images[0] : null;
    if (_thumb) html += '<img class="shop-card-img" src="' + esc(_thumb) + '" alt="" loading="lazy" />';
    else html += '<div class="shop-card-img shop-card-img--empty' + (isDonate ? ' donate-card-icon' : '') + '">' + (isDonate ? _svg.gem : 'No Image') + '</div>';
    html += isDonate
      ? '<span class="shop-item-type-badge shop-item-type-badge--donate">Donate</span>'
      : '<span class="shop-item-type-badge shop-item-type-badge--bin">Bin</span>';
    if (!isDonate && item.stock != null) {
      html += _ribbon(num(item.stock) + '\u00a0left', item.stock <= 0 ? 'outstock' : 'stock');
    }
    html += '<div class="shop-card-body">';
    html += _catBadges(item.category);
    html += '<div class="shop-card-name">' + esc(item.name) + '</div>';
    html += '<div class="shop-card-divider"><span class="shop-card-divider-icon">' + _svg.diamond + '</span></div>';
    html += '<div class="shop-card-desc">' + esc(item.description) + '</div>';
    if (isDonate) {
      html += '<div class="shop-card-meta"><span class="shop-card-price">1 LE = ' + _DONATE_LE_TO_EP + ' EP</span>';
      html += '<span class="shop-card-badge shop-card-badge--any">Earns Dirty EP</span>';
    } else {
      html += '<div class="shop-card-meta"><span class="shop-card-price">' + num(item.price) + ' EP</span>';
      html += (!item.accepts_dirty_ep || item.spend_order === 'clean_only')
        ? '<span class="shop-card-badge shop-card-badge--clean">Clean EP Only</span>'
        : '<span class="shop-card-badge shop-card-badge--any">Any EP</span>';
    }
    html += '</div>';
    html += '</div>'; // card-body
    html += '</div>'; // card
    return html;
  }

  function bindBinEvents(container) {
    if (container._binBound) return;
    container._binBound = true;
    container.addEventListener('click', function (e) {
      var allItems = (_binData && _binData.items) ? _binData.items : [];
      var card = e.target.closest('.shop-card[data-item-id]');
      if (card) {
        var id = card.dataset.itemId;
        var item = allItems.find(function (it) { return it.id === id; });
        if (item) {
          if (item.type === 'donate') openDonateModal(item);
          else openItemDetailModal(item);
        }
      }
    });
  }

  /* Auction card */
  function buildAuctionCard(a, myUuid) {
    var isActive = a.status === 'active';
    var itemInactive = a.active === false;
    var endsMs   = new Date(a.ends_at).getTime();
    var html = '<div class="shop-card' + (a.status === 'closed' || itemInactive ? ' shop-card--unavailable' : '') +
      '" data-auction-id="' + esc(a.auction_id) + '">';
    var _aThumb = (a.item_images && a.item_images.length) ? a.item_images[0] : a.item_image;
    if (_aThumb) html += '<img class="shop-card-img" src="' + esc(_aThumb) + '" alt="" loading="lazy" />';
    else html += '<div class="shop-card-img shop-card-img--empty">No Image</div>';
    html += '<span class="shop-item-type-badge shop-item-type-badge--auction">Auction</span>';
    html += '<div class="shop-card-body">';
    html += _catBadges(a.item_category);
    html += '<div class="shop-card-name">' + esc(a.item_name) + '</div>';
    html += '<div class="shop-card-divider"><span class="shop-card-divider-icon">\u2726</span></div>';
    html += '<div class="shop-card-desc shop-card-desc--short">' + esc(a.item_description) + '</div>';
    html += isActive
      ? '<div class="auction-timer" data-auction-ends="' + endsMs + '"></div>'
      : '<div class="auction-timer auction-timer--closed">Auction ended</div>';
    html += '<div class="shop-card-meta">' + (a.current_highest_bid > 0
      ? '<span class="shop-card-price">' + num(a.current_highest_bid) + ' EP</span>'
      : '<span class="shop-card-price">' + num(a.starting_bid) + ' EP</span>');
    html += (!a.accepts_dirty_ep || a.spend_order === 'clean_only')
      ? '<span class="shop-card-badge shop-card-badge--clean">Clean EP Only</span>'
      : '<span class="shop-card-badge shop-card-badge--any">Any EP</span>';
    html += '</div>';
    html += '</div>'; // card-body
    if (a.user_bid) {
      html += a.user_bid.is_winning
        ? _ribbon('Winning', 'winning')
        : _ribbon('Outbid', 'outbid');
    }
    html += '</div>';
    return html;
  }

  function bindAuctionEvents(container, auctions) {
    container.querySelectorAll('.shop-card[data-auction-id]').forEach(function (card) {
      card.addEventListener('click', function () {
        var aid = card.dataset.auctionId;
        var auction = auctions.find(function (a) { return a.auction_id === aid; });
        if (auction) openAuctionDetailModal(auction);
      });
    });
  }

  /* Auction timers */
  function startAuctionPoll() {
    if (_auctionPoll) clearInterval(_auctionPoll);
    _auctionPoll = setInterval(function () {
      fetchAuctionData(function (data) { if (data) renderContent(); });
    }, 30000);
  }

  function stopAuctionTimers() {
    if (_auctionTimer) { clearInterval(_auctionTimer); _auctionTimer = null; }
    if (_auctionPoll)  { clearInterval(_auctionPoll);  _auctionPoll  = null; }
  }

  function startAuctionCountdown() {
    if (_auctionTimer) clearInterval(_auctionTimer);
    _auctionTimer = setInterval(tickAuctionCountdowns, 1000);
  }

  function tickAuctionCountdowns() {
    var now = Date.now();
    document.querySelectorAll('[data-auction-ends]').forEach(function (el) {
      var diff = Math.max(0, parseInt(el.dataset.auctionEnds, 10) - now);
      if (diff === 0) {
        el.className = 'auction-timer auction-timer--closed';
        el.textContent = 'Auction ended';
        var card = el.closest('.shop-card');
        if (card) { var b = card.querySelector('.shop-buy-btn'); if (b) { b.disabled = true; b.textContent = 'Ended'; } }
        return;
      }
      var d = Math.floor(diff / 86400000);
      var h = Math.floor((diff % 86400000) / 3600000);
      var m = Math.floor((diff % 3600000) / 60000);
      var s = Math.floor((diff % 60000) / 1000);
      el.innerHTML = _svg.clock + ' ' + (d > 0 ? d + 'd ' : '') + h + 'h ' + m + 'm ' + s + 's';
      el.className = 'auction-timer' + (diff < 300000 ? ' auction-timer--urgent' : '');
    });
  }

  /* Spend split */
  function computeSpendSplit(amount, spendOrder, balance) {
    var sc = balance.spendable_clean || 0, sd = balance.spendable_dirty || 0;
    var c = 0, d = 0;
    if (spendOrder === 'clean_only')       { c = amount; }
    else if (spendOrder === 'dirty_only')  { d = amount; }
    else if (spendOrder === 'clean_first') { c = Math.min(sc, amount); d = Math.min(sd, amount - c); }
    else if (spendOrder === 'dirty_first') { d = Math.min(sd, amount); c = Math.min(sc, amount - d); }
    return { clean: c, dirty: d, affordable: (c + d) >= amount };
  }

  function computeCartSplit(entries, balance) {
    var prio = ['clean_only', 'dirty_only', 'clean_first', 'dirty_first'];
    var orders = {}, total = 0;
    entries.forEach(function (e) {
      var so = (!e.item.accepts_dirty_ep) ? 'clean_only' : (e.item.spend_order || 'clean_first');
      orders[so] = true; total += e.item.price * e.quantity;
    });
    var globalOrder = 'clean_first', best = 99;
    Object.keys(orders).forEach(function (o) { var i = prio.indexOf(o); if (i !== -1 && i < best) { best = i; globalOrder = o; } });
    return computeSpendSplit(total, globalOrder, balance);
  }

  /* Image carousel helpers */
  function _getItemImages(item) {
    if (item.images && item.images.length) return item.images;
    if (item.item_images && item.item_images.length) return item.item_images;
    if (item.image) return [item.image];
    if (item.item_image) return [item.item_image];
    return [];
  }

  function _buildCarousel(images) {
    if (!images.length) return '';
    if (images.length === 1) {
      return '<div class="detail-img-wrap"><img src="' + esc(images[0]) + '" alt="" class="detail-img" /></div>';
    }
    var h = '<div class="detail-img-wrap detail-carousel">';
    h += '<div class="carousel-track">';
    images.forEach(function (url, i) {
      h += '<img class="carousel-slide' + (i === 0 ? ' carousel-slide--active' : '') + '" src="' + esc(url) + '" alt="" />';
    });
    h += '</div>';
    h += '<button class="carousel-arrow carousel-arrow--prev" data-dir="-1"><svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></button>';
    h += '<button class="carousel-arrow carousel-arrow--next" data-dir="1"><svg viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"/></svg></button>';
    h += '<div class="carousel-footer">';
    h += '<div class="carousel-dots">';
    images.forEach(function (_, i) {
      h += '<span class="carousel-dot' + (i === 0 ? ' carousel-dot--active' : '') + '" data-slide="' + i + '"></span>';
    });
    h += '</div></div></div>';
    return h;
  }

  function _bindCarousel(container) {
    var carousel = container.querySelector('.detail-carousel');
    if (!carousel) return;
    var slides  = carousel.querySelectorAll('.carousel-slide');
    var dots    = carousel.querySelectorAll('.carousel-dot');
    var total   = slides.length;
    var current = 0;
    function goTo(idx) {
      current = ((idx % total) + total) % total;
      slides.forEach(function (s, i) { s.classList.toggle('carousel-slide--active', i === current); });
      dots.forEach(function (d, i) { d.classList.toggle('carousel-dot--active', i === current); });
    }
    carousel.querySelectorAll('.carousel-arrow').forEach(function (btn) {
      btn.addEventListener('click', function (e) { e.stopPropagation(); goTo(current + parseInt(btn.dataset.dir)); });
    });
    dots.forEach(function (dot) {
      dot.addEventListener('click', function (e) { e.stopPropagation(); goTo(parseInt(dot.dataset.slide)); });
    });
  }

  /* Cooldown description for detail modal */
  function _cooldownDesc(item) {
    var cd = item.cooldown;
    if (cd == null) return null;
    var s = String(cd).trim().toLowerCase();
    if (s === 'end_of_cycle') return 'Resets each cycle';
    var cm = s.match(/^(\d+)c$/);
    if (cm) return cm[1] + '-cycle cooldown';
    var days = parseInt(s, 10);
    if (!isNaN(days) && days > 0) return days + '-day cooldown';
    return null;
  }

  /* Freeze GIF animation – draw first frame to canvas */
  function _freezeGifs(container) {
    container.querySelectorAll('img').forEach(function (img) {
      if (!/\.gif($|\?|#)/i.test(img.src)) return;
      function freeze() {
        var c = document.createElement('canvas');
        c.width  = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        try { img.src = c.toDataURL(); } catch (e) { /* cross-origin */ }
      }
      if (img.complete && img.naturalWidth) freeze();
      else img.addEventListener('load', freeze, { once: true });
    });
  }

  /* Detail modals */
  function openItemDetailModal(item) {
    buildShell();
    var modal = document.getElementById('shopModal');
    if (!modal) return;
    var cartEntry = _cart[item.id];
    var inactive   = !item.active;
    var onCooldown = item.on_cooldown;
    var disabled   = inactive || onCooldown || (item.stock != null && item.stock <= 0);
    var html = '<button class="modal-close" aria-label="Close">' + _svg.close + '</button>';
    var detailImgs = _getItemImages(item);
    if (detailImgs.length) html += _buildCarousel(detailImgs);
    else html += '<div class="detail-img-wrap detail-img-wrap--empty">No Image</div>';
    html += _catBadges(item.category);
    html += '<div class="shop-modal-title">' + esc(item.name) + '</div>';
    html += '<div class="detail-meta-row">';
    html += '<span class="shop-card-price">' + num(item.price) + ' EP</span>';
    html += (!item.accepts_dirty_ep || item.spend_order === 'clean_only')
      ? '<span class="shop-card-badge shop-card-badge--clean">Clean EP Only</span>'
      : '<span class="shop-card-badge shop-card-badge--any">Any EP</span>';
    if (item.stock != null) html += '<span class="detail-stock-info">' + num(item.stock) + ' left</span>';
    var cdDesc = _cooldownDesc(item);
    html += cdDesc
      ? '<span class="detail-cooldown-info">' + esc(cdDesc) + '</span>'
      : '<span class="detail-cooldown-info detail-cooldown-info--none">No Cooldown</span>';
    html += '</div>';
    if (item.description) html += '<div class="detail-full-desc">' + esc(item.description) + '</div>';
    var btnLabel = 'Add to Cart';
    var btnDisabled = disabled;
    if (inactive) { btnLabel = 'Unavailable'; }
    else if (item.stock != null && item.stock <= 0) { btnLabel = 'Out of Stock'; }
    else if (onCooldown && item.cooldown_ends_at) {
      btnLabel = 'Available in ' + Math.ceil(Math.max(0, new Date(item.cooldown_ends_at) - new Date()) / 86400000) + 'd';
    } else if (onCooldown) { btnLabel = 'On Cooldown'; }
    html += '<div class="shop-modal-actions">';
    if (!cartEntry || disabled) {
      html += '<button class="shop-modal-btn shop-modal-btn--confirm" id="shopDetailAdd"' + (btnDisabled ? ' disabled' : '') + '>' + btnLabel + '</button>';
    } else if (item.allow_multi_quantity) {
      var maxQ = Math.min(item.max_quantity || 999, item.stock != null ? item.stock : 999);
      html += '<div class="cart-stepper">' +
        '<button class="cart-step-btn" id="shopDetailDec">&#8722;</button>' +
        '<input type="text" inputmode="numeric" class="cart-qty" id="shopDetailQty" value="' + cartEntry.quantity + '" maxlength="3" />' +
        '<button class="cart-step-btn" id="shopDetailInc"' + (cartEntry.quantity >= maxQ ? ' disabled' : '') + '>&#43;</button>' +
        '</div>';
    } else {
      html += '<div class="cart-in-cart-wrap">' +
        '<span class="cart-in-cart-label">' + _svg.check + ' In Cart</span>' +
        '<button class="cart-remove-single" id="shopDetailRemove">&times; Remove</button>' +
        '</div>';
    }
    html += '</div>';
    modal.innerHTML = html;
    _bindCarousel(modal);
    _freezeGifs(modal);
    var addBtn = document.getElementById('shopDetailAdd');
    if (addBtn) addBtn.addEventListener('click', function () {
      _cart[item.id] = { item: item, quantity: 1 };
      updateCartBadge(); _patchCartAction(item.id);
      openItemDetailModal(item); // re-render modal with updated state
    });
    var removeBtn = document.getElementById('shopDetailRemove');
    if (removeBtn) removeBtn.addEventListener('click', function () {
      delete _cart[item.id];
      updateCartBadge(); _patchCartAction(item.id);
      openItemDetailModal(item);
    });
    var qtyInput = document.getElementById('shopDetailQty');
    if (qtyInput) {
      qtyInput.addEventListener('input', function () {
        var pos = this.selectionStart;
        var cleaned = this.value.replace(/\D/g, '').slice(0, 3);
        if (cleaned !== this.value) {
          this.value = cleaned;
          this.setSelectionRange(Math.min(pos, cleaned.length), Math.min(pos, cleaned.length));
        }
      });
      qtyInput.addEventListener('blur', function () {
        if (!_cart[item.id]) return;
        var v = parseInt(this.value, 10) || 0;
        var mxQ = Math.min(item.max_quantity || 999, item.stock != null ? item.stock : 999);
        if (v < 1) delete _cart[item.id]; else _cart[item.id].quantity = Math.min(v, mxQ);
        updateCartBadge(); _patchCartAction(item.id);
        openItemDetailModal(item);
      });
      qtyInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); });
    }
    var decBtn = document.getElementById('shopDetailDec');
    if (decBtn) decBtn.addEventListener('click', function () {
      if (!_cart[item.id]) return;
      var it = _cart[item.id];
      if (it.quantity <= 1) delete _cart[item.id]; else it.quantity--;
      updateCartBadge(); _patchCartAction(item.id);
      openItemDetailModal(item);
    });
    var incBtn = document.getElementById('shopDetailInc');
    if (incBtn) incBtn.addEventListener('click', function () {
      if (!_cart[item.id]) return;
      var mxQ = Math.min(item.max_quantity || 999, item.stock != null ? item.stock : 999);
      if (_cart[item.id].quantity < mxQ) { _cart[item.id].quantity++; updateCartBadge(); _patchCartAction(item.id); openItemDetailModal(item); }
    });
    document.getElementById('shopModalBackdrop').classList.add('open');
  }

  function openAuctionDetailModal(auction) {
    buildShell();
    var modal = document.getElementById('shopModal');
    if (!modal) return;
    var myUuid   = (_auctionData && _auctionData.uuid) ? _auctionData.uuid : '';
    var isActive = auction.status === 'active';
    var itemActive = auction.active !== false;
    var canBid = isActive && itemActive;
    var isHighest = auction.current_highest_bidder_uuid === myUuid;
    var bal = (_auctionData && _auctionData.balance) || (_binData && _binData.balance);
    var minBid = auction.current_highest_bid > 0
      ? auction.current_highest_bid + (auction.min_increment || 1) : (auction.starting_bid || 0);

    var html = '<button class="modal-close">\u2715</button>';

    // Zone 1: Identity
    var detailImgs = (auction.item_images && auction.item_images.length) ? auction.item_images : (auction.item_image ? [auction.item_image] : []);
    if (detailImgs.length) html += _buildCarousel(detailImgs);
    else html += '<div class="detail-img-wrap detail-img-wrap--empty">No Image</div>';
    html += _catBadges(auction.item_category);
    html += '<div class="shop-modal-title">' + esc(auction.item_name) + '</div>';
    if (auction.item_description) html += '<div class="detail-full-desc">' + esc(auction.item_description) + '</div>';

    html += '<div class="detail-divider"><span class="detail-divider-icon">' + _svg.diamond + '</span></div>';

    // Zone 2: Auction status
    html += '<div class="detail-meta-row">';
    html += '<span class="detail-meta-label">Current bid</span>';
    html += auction.current_highest_bid > 0
      ? '<span class="shop-card-price">' + num(auction.current_highest_bid) + ' EP</span>'
      : '<span class="shop-card-price">' + num(auction.starting_bid) + ' EP</span>';
    html += (!auction.accepts_dirty_ep || auction.spend_order === 'clean_only')
      ? '<span class="shop-card-badge shop-card-badge--clean">Clean EP Only</span>'
      : '<span class="shop-card-badge shop-card-badge--any">Any EP</span>';
    html += '</div>';

    html += '<div class="detail-pills">';
    if (isActive) {
      var endsMs = new Date(auction.ends_at).getTime();
      var diff   = Math.max(0, endsMs - Date.now());
      var td = Math.floor(diff / 86400000), th = Math.floor((diff % 86400000) / 3600000), tm = Math.floor((diff % 3600000) / 60000);
      html += '<span class="detail-pill detail-pill--timer">' + _svg.clock + ' ' + (td > 0 ? td + 'd\u00a0' : '') + th + 'h\u00a0' + tm + 'm</span>';
    } else {
      html += '<span class="detail-pill detail-pill--muted">Auction ended</span>';
    }
    html += '<span class="detail-pill detail-pill--timer">Min +' + num(auction.min_increment) + ' EP</span>';
    if (auction.user_bid) {
      html += auction.user_bid.is_winning
        ? '<span class="detail-pill detail-pill--success">' + _svg.check + ' Winning ' + '\u00B7 ' + num(auction.user_bid.amount) + ' EP</span>'
        : '<span class="detail-pill detail-pill--danger">' + _svg.warn + ' Outbid ' + '\u00B7 ' + num(auction.user_bid.amount) + ' EP</span>';
    }
    if (auction.extended) {
      var extH = auction.extended_hours || 0;
      if (extH > 0) {
        html += '<span class="detail-pill detail-pill--warn">Extended +' + extH + 'h</span>';
      } else if (extH < 0) {
        html += '<span class="detail-pill detail-pill--danger">Reduced ' + Math.abs(extH) + 'h</span>';
      } else {
        html += '<span class="detail-pill detail-pill--warn">Extended</span>';
      }
    }
    html += '</div>';

    // Zone 3: Bid action
    html += '<div class="detail-divider"><span class="detail-divider-icon">' + _svg.diamond + '</span></div>';
    if (canBid && !isHighest && bal) {
      html += '<div class="detail-bid-form">';
      html += '<div class="detail-bid-stepper">';
      html += '<button class="bid-step-btn" id="bidDec" aria-label="Decrease bid">' + _svg.minus + '</button>';
      html += '<input type="text" inputmode="numeric" class="detail-bid-num" id="bidAmountInput" value="' + minBid + '" maxlength="6" />';
      html += '<button class="bid-step-btn" id="bidInc">+</button>';
      html += '</div>';
      html += '</div>';
      html += '<div class="shop-modal-actions">';
      html += '<button class="shop-modal-btn shop-modal-btn--confirm" id="shopDetailBid">Place Bid</button>';
      html += '</div>';
    } else if (canBid && isHighest) {
      html += '<div class="shop-modal-actions">';
      html += '<span class="detail-pill detail-pill--success" style="margin:0 auto;">' + _svg.check + ' Highest Bidder</span>';
      html += '</div>';
    } else {
      html += '<div class="shop-modal-actions">';
      var abtnLabel = !isActive ? 'Auction Ended' : !itemActive ? 'Auction Paused' : 'Unavailable';
      html += '<button class="shop-modal-btn shop-modal-btn--confirm" disabled>' + abtnLabel + '</button>';
      html += '</div>';
    }

    modal.innerHTML = html;
    _bindCarousel(modal);
    _freezeGifs(modal);

    // Bid form wiring
    var bidInput = document.getElementById('bidAmountInput');
    var bidBtn   = document.getElementById('shopDetailBid');
    var incBtn   = document.getElementById('bidInc');
    var decBtn   = document.getElementById('bidDec');
    var increment = auction.min_increment || 1;

    // Digits-only enforcement + clamp on blur
    if (bidInput) {
      bidInput.addEventListener('input', function () {
        var pos = this.selectionStart;
        var cleaned = this.value.replace(/\D/g, '').slice(0, 6);
        if (cleaned !== this.value) {
          this.value = cleaned;
          this.setSelectionRange(Math.min(pos, cleaned.length), Math.min(pos, cleaned.length));
        }
      });
      bidInput.addEventListener('blur', function () {
        var v = parseInt(this.value, 10) || 0;
        if (v < minBid) this.value = minBid;
        this.dispatchEvent(new Event('input'));
      });
    }

    // Stepper +/−
    if (incBtn && bidInput) incBtn.addEventListener('click', function () {
      var v = parseInt(bidInput.value, 10) || 0;
      bidInput.value = v + increment;
      bidInput.dispatchEvent(new Event('input'));
    });
    if (decBtn && bidInput) decBtn.addEventListener('click', function () {
      var v = parseInt(bidInput.value, 10) || 0;
      bidInput.value = Math.max(minBid, v - increment);
      bidInput.dispatchEvent(new Event('input'));
    });

    // Dynamic button label
    if (bidInput && bidBtn && bal) {
      var spendOrder = (!auction.accepts_dirty_ep) ? 'clean_only' : (auction.spend_order || 'clean_first');
      function updateBidBtn() {
        var amount = parseInt(bidInput.value, 10) || 0;
        var split  = computeSpendSplit(amount, spendOrder, bal);
        if (amount < minBid) {
          bidBtn.textContent = 'Min ' + num(minBid) + ' EP';
          bidBtn.disabled = true;
        } else if (!split.affordable) {
          bidBtn.textContent = 'Not enough EP';
          bidBtn.disabled = true;
        } else {
          bidBtn.textContent = 'Place Bid: ' + num(amount) + ' EP';
          bidBtn.disabled = false;
        }
        bidBtn._confirmed = false;
      }
      updateBidBtn();
      bidInput.addEventListener('input', updateBidBtn);
    }

    // Two-phase confirm
    if (bidBtn) {
      bidBtn._confirmed = false;
      bidBtn.addEventListener('click', function () {
        if (!bidBtn._confirmed) {
          bidBtn._confirmed = true;
          bidBtn.textContent = 'Confirm Bid?';
          setTimeout(function () {
            if (bidBtn._confirmed) {
              bidBtn._confirmed = false;
              var amount = parseInt(bidInput.value, 10) || 0;
              bidBtn.textContent = 'Place Bid: ' + num(amount) + ' EP';
            }
          }, 3000);
          return;
        }
        executeBid(auction, minBid);
      });
    }

    document.getElementById('shopModalBackdrop').classList.add('open');
  }

  /* Modal utilities */
  function closeModal() {
    var bd = document.getElementById('shopModalBackdrop');
    if (bd) bd.classList.remove('open', 'orders-open', 'cart-open');
  }

  function resetModal() {
    var modal = document.getElementById('shopModal');
    if (modal) {
      modal.innerHTML =
        '<button class="modal-close">\u2715</button>' +
        '<div class="shop-modal-title" id="shopModalTitle"></div>' +
        '<div class="shop-modal-body" id="shopModalBody"></div>' +
        '<div class="shop-modal-breakdown" id="shopModalBreakdown"></div>' +
        '<div class="shop-modal-actions" id="shopModalActions"></div>';
    }
  }

  /* Cart EP badge helper */
  function _cartEpBadge(item) {
    if (!item.accepts_dirty_ep || item.spend_order === 'clean_only')
      return '<span class="cart-ep-badge cart-ep-badge--clean">Clean EP</span>';
    if (item.spend_order === 'dirty_only')
      return '<span class="cart-ep-badge cart-ep-badge--dirty">Dirty EP</span>';
    return '<span class="cart-ep-badge cart-ep-badge--any">Any EP</span>';
  }

  /* Cart modal */
  function openCartModal() {
    buildShell(); renderCartModal();
    document.getElementById('shopModalBackdrop').classList.add('open', 'cart-open');
  }

  function renderCartModal() {
    var modal = document.getElementById('shopModal');
    if (!modal) return;
    var bal     = _binData ? _binData.balance : null;
    var entries = Object.keys(_cart).map(function (id) { return _cart[id]; });
    var qt      = cartTotal();

    /* Header (always present) */
    var html = '<div class="cart-header">' +
      '<div class="cart-header-left">' +
        '<span class="cart-header-title">Cart</span>' +
        (qt > 0 ? '<span class="cart-header-count">' + qt + ' item' + (qt !== 1 ? 's' : '') + '</span>' : '') +
      '</div>' +
      '<button class="modal-close">\u2715</button>' +
    '</div>';

    /* Empty state */
    if (!entries.length) {
      html += '<div class="cart-empty">Your cart is empty.</div>';
      modal.innerHTML = html;
      return;
    }

    var total = entries.reduce(function (n, e) { return n + e.item.price * e.quantity; }, 0);
    var split = bal ? computeCartSplit(entries, bal) : null;

    /* Item list */
    html += '<div class="cart-items">';
    entries.forEach(function (entry) {
      var item    = entry.item;
      var isMulti = item.allow_multi_quantity;
      var maxQ    = isMulti ? Math.min(item.max_quantity || 999, item.stock != null ? item.stock : 999) : 1;
      html += '<div class="cart-row">';
      // Col 1: info
      html += '<div class="cart-row-info">' +
        '<span class="cart-row-name">' + esc(item.name) + '</span>' +
        '<span class="cart-row-meta">' + num(item.price) + ' EP each ' + _cartEpBadge(item) + '</span>' +
      '</div>';
      // Col 2: stepper
      html += '<div class="cart-row-stepper' + (isMulti ? '' : ' cart-row-stepper--static') + '">';
      if (isMulti) {
        html +=
          '<button class="cart-step-btn" data-modal-dec="' + esc(item.id) + '"' + (entry.quantity <= 1 ? ' disabled' : '') + '>&#8722;</button>' +
          '<input type="text" inputmode="numeric" class="cart-qty" data-modal-qty="' + esc(item.id) + '" value="' + entry.quantity + '" maxlength="3" />' +
          '<button class="cart-step-btn" data-modal-inc="' + esc(item.id) + '"' + (entry.quantity >= maxQ ? ' disabled' : '') + '>&#43;</button>';
      } else {
        html += '1';
      }
      html += '</div>';
      // Col 3: subtotal + trash
      html += '<div class="cart-row-end">' +
        '<span class="cart-row-subtotal">' + num(item.price * entry.quantity) + ' EP</span>' +
        '<button class="cart-row-remove" data-modal-remove="' + esc(item.id) + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
            '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>' +
            '<path d="M10 11v6"/><path d="M14 11v6"/>' +
          '</svg>' +
        '</button>' +
      '</div>';
      html += '</div>';
    });
    html += '</div>';

    /* Footer summary */
    html += '<div class="cart-footer">';
    if (!split || !split.affordable) {
      html += '<div class="cart-summary-row cart-summary-row--danger">' +
        '<span>Insufficient EP</span><span>' + num(total) + ' EP needed</span></div>';
    } else {
      html += '<div class="cart-summary-row">' +
        '<span>EP total</span><span>' + num(total) + ' EP</span></div>';
      if (split.clean > 0) html += '<div class="cart-summary-row cart-summary-row--clean">' +
        '<span>Clean EP</span><span>' + num(split.clean) + ' EP</span></div>';
      if (split.dirty > 0) html += '<div class="cart-summary-row cart-summary-row--dirty">' +
        '<span>Dirty EP</span><span>' + num(split.dirty) + ' EP</span></div>';
      html += '<div class="cart-summary-divider"></div>';
      html += '<div class="cart-summary-row cart-summary-row--total">' +
        '<span>Total</span><span>' + num(total) + ' EP</span></div>';
    }
    if (split && split.affordable) {
      html += '<button class="cart-checkout-btn" id="shopModalConfirm">CHECKOUT: ' + num(total) + ' EP</button>';
    }
    html += '</div>';

    modal.innerHTML = html;

    /* Event bindings */
    var cBtn = document.getElementById('shopModalConfirm');
    if (cBtn) cBtn.addEventListener('click', executeCartCheckout);

    modal.querySelectorAll('[data-modal-dec]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.modalDec;
        if (!_cart[id] || _cart[id].quantity <= 1) return;
        _cart[id].quantity--;
        updateCartBadge(); renderCartModal(); _debouncedRenderContent();
      });
    });
    modal.querySelectorAll('[data-modal-inc]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.modalInc;
        if (!_cart[id]) return;
        var mxQ = Math.min(_cart[id].item.max_quantity || 999, _cart[id].item.stock != null ? _cart[id].item.stock : 999);
        if (_cart[id].quantity < mxQ) { _cart[id].quantity++; updateCartBadge(); renderCartModal(); _debouncedRenderContent(); }
      });
    });
    modal.querySelectorAll('[data-modal-remove]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        delete _cart[btn.dataset.modalRemove];
        updateCartBadge(); renderCartModal(); _debouncedRenderContent();
      });
    });
    modal.querySelectorAll('[data-modal-qty]').forEach(function (input) {
      input.addEventListener('input', function () {
        var pos = this.selectionStart;
        var cleaned = this.value.replace(/\D/g, '').slice(0, 3);
        if (cleaned !== this.value) {
          this.value = cleaned;
          this.setSelectionRange(Math.min(pos, cleaned.length), Math.min(pos, cleaned.length));
        }
      });
      input.addEventListener('blur', function () {
        var id = this.dataset.modalQty;
        if (!_cart[id]) return;
        var v = parseInt(this.value, 10) || 0;
        var mxQ = Math.min(_cart[id].item.max_quantity || 999, _cart[id].item.stock != null ? _cart[id].item.stock : 999);
        _cart[id].quantity = Math.max(1, Math.min(v, mxQ));
        updateCartBadge(); renderCartModal(); _debouncedRenderContent();
      });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') this.blur(); });
    });
  }

  function executeCartCheckout() {
    var modal      = document.getElementById('shopModal');
    var confirmBtn = document.getElementById('shopModalConfirm');
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Processing\u2026'; }
    var items = Object.keys(_cart).map(function (id) { return { item_id: id, quantity: _cart[id].quantity }; });
    fetch('/api/shop/bin/cart/checkout', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: items }),
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
      if (res.ok && res.data.ok) {
        cartClear();
        closeModal();
        showToast(_svg.check + ' Order submitted! A Chief will fulfil your items.', 'success');
        fetchBinData(function () { renderBalanceBar(); renderContent(); });
      } else {
        showToast(_svg.warn + (res.data.error || 'Checkout failed.'), 'warn');
        renderCartModal();
      }
    })
    .catch(function () {
      showToast(_svg.warn + ' Network error. Please try again.', 'warn');
      renderCartModal();
    });
  }

  /* Buy modal */
  function openBuyModal(item) {
    buildShell(); resetModal();
    var bal = _binData ? _binData.balance : null;
    if (!bal) return;
    var spendOrder = (!item.accepts_dirty_ep) ? 'clean_only' : (item.spend_order || 'clean_first');
    var split = computeSpendSplit(item.price || 0, spendOrder, bal);

    document.getElementById('shopModalTitle').textContent = 'Buy ' + (item.name || '');
    document.getElementById('shopModalBody').textContent = split.affordable
      ? 'Are you sure you want to purchase this item?'
      : 'You do not have enough EP to purchase this item.';

    var bd = document.getElementById('shopModalBreakdown');
    if (split.affordable) {
      var parts = ['This will spend <strong>' + num(item.price) + ' EP</strong>:'];
      if (split.clean > 0) parts.push(num(split.clean) + ' clean');
      if (split.dirty > 0) parts.push(num(split.dirty) + ' dirty');
      bd.innerHTML = parts[0] + ' ' + parts.slice(1).join(' + ');
      bd.style.display = '';
    } else { bd.style.display = 'none'; }

    document.getElementById('shopModalActions').innerHTML =
      (split.affordable ? '<button class="shop-modal-btn shop-modal-btn--confirm" id="shopModalConfirm">Confirm Purchase</button>' : '');
    if (split.affordable) {
      document.getElementById('shopModalConfirm').addEventListener('click', function () {
        executePurchase(item, split.clean, split.dirty);
      });
    }
    document.getElementById('shopModalBackdrop').classList.add('open');
  }

  function executePurchase(item, cleanEp, dirtyEp) {
    var confirmBtn = document.getElementById('shopModalConfirm');
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Processing\u2026'; }
    fetch('/api/shop/bin/purchase', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: item.id, acknowledged_spend: { clean_ep: cleanEp, dirty_ep: dirtyEp } }),
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
      var modal = document.getElementById('shopModal');
      if (res.ok && res.data.ok) {
        modal.innerHTML =
          '<button class="modal-close">\u2715</button>' +
          '<div class="result-icon">' + _svg.hourglass + '</div>' +
          '<div class="result-msg">Purchase submitted! A Chief will fulfill your order.</div></div>';
        showToast('\u2713 ' + (item.name || 'Item') + ' purchased!', 'success');
        fetchBinData(function () { renderBalanceBar(); renderContent(); });
      } else {
        showToast(_svg.warn + (res.data.error || 'Purchase failed.'), 'warn'); closeModal();
      }
    })
    .catch(function () { showToast(_svg.warn + ' Network error. Please try again.', 'warn'); closeModal(); });
  }

  function executeBid(auction, minBid) {
    var amount = parseInt(document.getElementById('bidAmountInput').value, 10) || 0;
    if (amount < minBid) { showToast(_svg.warn + ' Bid must be at least ' + num(minBid) + ' EP.', 'warn'); return; }
    var confirmBtn = document.getElementById('shopDetailBid');
    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Placing bid\u2026'; }
    var body = { auction_id: auction.auction_id, amount: amount };
    fetch('/api/shop/auctions/bid', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
    .then(function (res) {
      if (res.ok && res.data.ok) {
        var msg = 'Bid of ' + num(amount) + ' EP placed!';
        if (res.data.extended) msg += ' Auction extended due to last-minute bid.';
        showToast('\u2713 ' + msg, 'success');
        // Refresh auction data and re-render the detail modal with updated state
        fetchAuctionData(function () {
          renderContent();
          var updated = ((_auctionData && _auctionData.auctions) || []).find(function (a) { return a.auction_id === auction.auction_id; });
          if (updated) openAuctionDetailModal(updated); else closeModal();
        });
      } else {
        showToast(_svg.warn + (res.data.error || 'Bid failed.'), 'warn');
        if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = 'Place Bid'; }
      }
    })
    .catch(function () { showToast(_svg.warn + ' Network error. Please try again.', 'warn'); closeModal(); });
  }

  /* Donate modal */
  function openDonateModal(item) {
    buildShell();
    var modal = document.getElementById('shopModal');
    if (!modal) return;
    var html = '<button class="modal-close">\u2715</button>';
    var detailImgs = _getItemImages(item);
    if (detailImgs.length) html += _buildCarousel(detailImgs);
    else html += '<div class="detail-img-wrap detail-img-wrap--empty">No Image</div>';
    html += _catBadges(item.category);
    html += '<div class="shop-modal-title">' + esc(item.name) + '</div>';
    if (item.description) html += '<div class="detail-full-desc">' + esc(item.description) + '</div>';
    html += '<label class="shop-modal-input-label">LE Amount</label>';
    html += '<div class="detail-bid-stepper">';
    html += '<button class="bid-step-btn" id="donDec" aria-label="Decrease amount">' + _svg.minus + '</button>';
    html += '<input type="text" inputmode="numeric" class="detail-bid-num" id="donAmountInput" value="1" maxlength="4" />';
    html += '<button class="bid-step-btn" id="donInc">+</button>';
    html += '</div>';
    html += '<div class="donate-ep-preview" id="donEpPreview">= ' + num(_DONATE_LE_TO_EP) + ' Dirty EP</div>';
    html += '<div class="shop-modal-actions">';
    html += '<button class="shop-modal-btn shop-modal-btn--confirm" id="donSubmit">Submit Donation: 1 LE</button>';
    html += '</div>';
    modal.innerHTML = html;
    _bindCarousel(modal);
    _freezeGifs(modal);
    document.getElementById('shopModalBackdrop').classList.add('open');

    var input = document.getElementById('donAmountInput');
    var preview = document.getElementById('donEpPreview');
    var submitBtn = document.getElementById('donSubmit');
    var _donLocked = false;

    function _lockDonateForm() {
      _donLocked = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Pending donation exists';
      input.disabled = true;
      document.getElementById('donInc').disabled = true;
      document.getElementById('donDec').disabled = true;
    }

    // Pre-check for existing pending donation
    fetch('/api/shop/donations', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.tickets) return;
        var hasPending = data.tickets.some(function (t) { return t.status === 'pending'; });
        if (hasPending) _lockDonateForm();
      })
      .catch(function () {});

    function updatePreview() {
      if (_donLocked) return;
      var v = parseInt(input.value, 10) || 0;
      preview.textContent = '= ' + num(v * _DONATE_LE_TO_EP) + ' Dirty EP';
      submitBtn.disabled = v <= 0;
      submitBtn.textContent = v > 0 ? 'Submit Donation: ' + num(v) + ' LE' : 'Enter an amount';
    }

    var _DON_MAX = 6400;
    input.addEventListener('input', function () {
      var pos = this.selectionStart;
      var cleaned = this.value.replace(/\D/g, '').slice(0, 4);
      if (cleaned !== this.value) {
        this.value = cleaned;
        this.setSelectionRange(Math.min(pos, cleaned.length), Math.min(pos, cleaned.length));
      }
      var n = parseInt(cleaned, 10);
      if (!isNaN(n) && n > _DON_MAX) { this.value = String(_DON_MAX); }
      updatePreview();
    });
    input.addEventListener('blur', function () {
      var v = parseInt(this.value, 10) || 0;
      if (v < 1) this.value = '1';
      if (v > _DON_MAX) this.value = String(_DON_MAX);
      updatePreview();
    });

    document.getElementById('donInc').addEventListener('click', function () {
      input.value = Math.min(_DON_MAX, (parseInt(input.value, 10) || 0) + 1);
      updatePreview();
    });
    document.getElementById('donDec').addEventListener('click', function () {
      input.value = Math.max(1, (parseInt(input.value, 10) || 0) - 1);
      updatePreview();
    });

    submitBtn.addEventListener('click', function () {
      var amount = parseInt(input.value, 10) || 0;
      if (amount <= 0) return;
      if (amount > _DON_MAX) {
        showToast(_svg.warn + ' Donation cannot exceed ' + num(_DON_MAX) + ' LE.', 'warn');
        input.value = String(_DON_MAX); updatePreview(); return;
      }
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting\u2026';
      fetch('/api/shop/donate', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ le_amount: amount }),
      })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (res.ok && res.data.ok) {
          showToast('\u2713 Donation submitted! ' + num(res.data.dirty_ep_to_grant) + ' Dirty EP pending confirmation.', 'success');
          closeModal();
        } else {
          var err = res.data.error || 'Donation failed.';
          showToast(_svg.warn + err, 'warn');
          if (/pending/.test(err)) {
            _lockDonateForm();
          } else {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Submit Donation: ' + num(amount) + ' LE';
          }
        }
      })
      .catch(function () {
        showToast(_svg.warn + ' Network error. Please try again.', 'warn');
        closeModal();
      });
    });
  }

  /* Orders modal */
  var _ordersData = null;

  function fetchOrders(cb) {
    fetch('/api/shop/orders', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) { if (data) _ordersData = data; if (cb) cb(data); })
      .catch(function () { if (cb) cb(null); });
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function statusBadge(status) {
    var colors = { pending: 'var(--warn)', fulfilled: 'var(--online)', confirmed: 'var(--online)', rejected: 'var(--danger)' };
    return '<span class="order-status" style="color:' + (colors[status] || 'var(--text-faint)') + '">' + esc(status) + '</span>';
  }

  function openOrdersModal() {
    buildShell();
    var modal = document.getElementById('shopModal');
    if (!modal) return;
    modal.innerHTML =
      '<button class="modal-close">\u2715</button>' +
      '<div class="shop-modal-title">My Orders</div>' +
      '<div class="orders-modal-body"><div class="shop-loading"><span class="loading-spinner"></span> Loading\u2026</div></div>';
    document.getElementById('shopModalBackdrop').classList.add('open', 'orders-open');

    _ordersData = null;
    fetchOrders(function (data) {
      if (!data) {
        modal.innerHTML =
          '<button class="modal-close">\u2715</button>' +
          '<div class="shop-modal-title">My Orders</div>' +
          '<div class="orders-modal-body" style="color:var(--text-faint);padding:16px 0">Could not load orders.</div>';
        return;
      }
      _renderOrdersInModal(modal);
    });
  }

  var _ordersFilter = 'all'; // 'all' | 'purchase' | 'bid' | 'donation'

  function _buildUnifiedFeed() {
    var purchases = _ordersData.purchases || [];
    var bids      = _ordersData.bids      || [];
    var donations = _ordersData.donations || [];
    var feed = [];

    purchases.forEach(function (p) {
      feed.push({
        kind: 'purchase', name: p.item_id, date: p.purchased_at,
        amount: p.ep_spent, outcome: p.status, note: p.chief_note || '',
      });
    });
    bids.forEach(function (b) {
      var outcome, oc;
      if (b.auction_status === 'closed') {
        if (b.is_winning) { outcome = 'Won'; oc = 'var(--online)'; }
        else { outcome = 'Outbid'; oc = 'var(--danger)'; }
      } else if (b.is_winning) { outcome = 'Winning'; oc = 'var(--online)'; }
      else { outcome = 'Outbid'; oc = 'var(--warn)'; }
      feed.push({
        kind: 'bid', name: b.item_id, date: b.placed_at,
        amount: b.amount, outcome: outcome, outcomeColor: oc, note: '',
      });
    });
    donations.forEach(function (d) {
      feed.push({
        kind: 'donation', name: 'Community fund', date: d.submitted_at,
        amount: d.dirty_ep_to_grant, outcome: d.status, note: d.chief_note || '',
      });
    });

    feed.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    return feed;
  }

  function _outcomeHtml(entry) {
    if (entry.outcomeColor) {
      return '<span class="order-outcome" style="color:' + entry.outcomeColor + '">' + esc(entry.outcome) + '</span>';
    }
    var colors = { pending: 'var(--warn)', fulfilled: 'var(--online)', confirmed: 'var(--online)', rejected: 'var(--danger)' };
    var c = colors[entry.outcome] || 'var(--text-faint)';
    var label = entry.outcome === 'fulfilled' ? 'Completed' : entry.outcome;
    return '<span class="order-outcome" style="color:' + c + '">' + esc(label) + '</span>';
  }

  function _typePillHtml(kind) {
    var labels = { purchase: 'Bin purchase', bid: 'Auction bid', donation: 'Donation' };
    return '<span class="order-type-pill order-type-pill--' + kind + '">' + labels[kind] + '</span>';
  }

  function _renderOrdersInModal(modal) {
    if (!modal || !_ordersData) return;
    var feed = _buildUnifiedFeed();
    var filtered = _ordersFilter === 'all' ? feed : feed.filter(function (e) { return e.kind === _ordersFilter; });

    var html = '<button class="modal-close">\u2715</button>';
    html += '<div class="orders-title-row">';
    html += '<div class="shop-modal-title" style="margin-bottom:0">My orders</div>';
    html += '<span class="orders-count">' + filtered.length + ' entr' + (filtered.length === 1 ? 'y' : 'ies') + '</span>';
    html += '</div>';

    // Filter tabs
    html += '<div class="orders-filters">';
    ['all', 'purchase', 'bid', 'donation'].forEach(function (f) {
      var labels = { all: 'All', purchase: 'Bin purchase', bid: 'Auction bid', donation: 'Donation' };
      html += '<button class="orders-filter-btn' + (_ordersFilter === f ? ' active' : '') + '" data-ofilter="' + f + '">' + labels[f] + '</button>';
    });
    html += '</div>';

    html += '<div class="orders-modal-body">';
    if (!filtered.length) {
      html += '<div class="order-empty">No entries found.</div>';
    } else {
      html += '<div class="order-table">';
      html += '<div class="order-row order-header"><span>Item</span><span>Type</span><span>Amount</span><span>Outcome</span></div>';
      filtered.forEach(function (e) {
        html += '<div class="order-row">';
        html += '<span class="order-item-cell"><span class="order-item-name">' + esc(e.name) + '</span>';
        html += '<span class="order-item-date">' + fmtDate(e.date) + '</span></span>';
        html += '<span>' + _typePillHtml(e.kind) + '</span>';
        html += '<span>' + num(e.amount) + ' EP</span>';
        html += '<span>' + _outcomeHtml(e);
        if (e.note && (e.outcome === 'rejected' || e.outcome === 'fulfilled')) {
          html += '<div class="order-note">' + (e.outcome === 'rejected' ? _svg.rejected + ' ' : '') + esc(e.note) + '</div>';
        }
        html += '</span>';
        html += '</div>';
      });
      html += '</div>';
    }
    html += '</div>';

    modal.innerHTML = html;

    // Bind filter tabs
    modal.querySelectorAll('[data-ofilter]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _ordersFilter = btn.dataset.ofilter;
        _renderOrdersInModal(modal);
      });
    });
  }

  /* Init */
  var _initDone = false;

  function initShop() {
    if (_initDone) return;
    _initDone = true;
    if (!window.state || !window.state.loggedIn) {
      panel.innerHTML = '<div class="shop-login-prompt">Log in with Discord to access the shop.</div>';
      return;
    }
    buildShell();
    document.getElementById('shopContent').innerHTML =
      '<div class="shop-loading"><span class="loading-spinner"></span> Loading shop\u2026</div>';

    fetchBinData(function (data) {
      if (!data) {
        document.getElementById('shopContent').innerHTML =
          '<div class="shop-empty">Could not load shop data. You may not be a guild member.</div>';
        return;
      }
      renderBalanceBar();
      buildFilterBar();  // builds filter bar then calls renderContent()
      startCountdownTick();
      loadCart(data.items || []);
    });

    // Pre-fetch auctions; update price range + re-render once ready
    fetchAuctionData(function (data) { if (data) { updateFilterBarData(); renderContent(); } });
  }

  var observer = new MutationObserver(function () {
    if (panel.classList.contains('active')) initShop();
  });
  observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  if (panel.classList.contains('active')) initShop();

  // Refresh shop bin data whenever the admin panel writes an item change
  window.addEventListener('shop:items-updated', function () {
    if (!_initDone) return; // shop hasn't loaded yet, skip
    var done = 0;
    function check() {
      if (++done < 2) return;
      renderBalanceBar();
      updateFilterBarData();
      loadCart((_binData && _binData.items) || []);
      renderContent();
    }
    fetchBinData(function (data) { if (data) check(); else check(); });
    fetchAuctionData(function (data) { check(); });
  });
})()
