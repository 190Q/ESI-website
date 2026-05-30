(function () {
  'use strict';

  var panel = document.getElementById('panel-creator-studio');
  if (!panel) return;

  var _data      = null; // { items, requests }
  var _activeTab = 'items';
  var _shellBuilt = false;

  /* helpers */
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

  function apiPatch(url, body) {
    return fetch(url, {
      method: 'PATCH', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); });
  }

  function statusPill(status) {
    var cls = 'cs-pill cs-pill--' + esc(status || 'pending');
    return '<span class="' + cls + '">' + esc(status || 'pending') + '</span>';
  }

  function fmtDate(iso) {
    if (!iso) return 'N/A';
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) +
        ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    }
    catch (e) { return esc(iso); }
  }

  var _closeSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

  /* shell */
  function buildShell() {
    if (_shellBuilt) return;
    _shellBuilt = true;
    panel.innerHTML =
      '<div class="shop-tabs" id="csTabs">' +
        '<button class="shop-tab active" data-tab="items">My Items</button>' +
        '<button class="shop-tab" data-tab="queue">Queue</button>' +
        '<button class="shop-tab" data-tab="requests">My Requests</button>' +
      '</div>' +
      '<div id="csContent"></div>' +
      '<div class="shop-modal-backdrop" id="csModalBackdrop">' +
        '<div class="shop-modal" id="csModal"></div>' +
      '</div>';

    document.getElementById('csTabs').addEventListener('click', function (e) {
      var btn = e.target.closest('.shop-tab');
      if (!btn) return;
      var tab = btn.dataset.tab;
      if (tab === _activeTab) return;
      _activeTab = tab;
      document.querySelectorAll('#csTabs .shop-tab').forEach(function (t) { t.classList.remove('active'); });
      btn.classList.add('active');
      renderTab();
    });

    document.getElementById('csModalBackdrop').addEventListener('click', function (e) {
      if (e.target === this) _closeModal();
    });
    document.getElementById('csModal').addEventListener('click', function (e) {
      if (e.target.closest('.modal-close')) _closeModal();
    });
  }

  function _closeModal() {
    var m = document.getElementById('csModal');
    if (m) m.classList.remove('ie-modal');
    document.getElementById('csModalBackdrop').classList.remove('open');
  }

  /* data fetching */
  function fetchData(cb) {
    fetch('/api/shop/creator/my-items', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        _data = d;
        // seed queue badge from the requests that come with items
        if (d && d.requests) {
          var pendingCount = d.requests.filter(function (r) { return r.status === 'pending'; }).length;
          _updateCsQueueBadge(pendingCount);
        }
        if (cb) cb(d);
      })
      .catch(function () { if (cb) cb(null); });
  }

  /* tab routing */
  function renderTab() {
    var c = document.getElementById('csContent');
    if (!c) return;
    if (_activeTab === 'items') renderItemsTab(c);
    else if (_activeTab === 'queue') renderQueueTab(c);
    else if (_activeTab === 'requests') renderRequestsTab(c);
  }

  /* My Items tab */
  function renderItemsTab(c) {
    if (!_data) { c.innerHTML = '<div class="shop-empty">Loading\u2026</div>'; return; }
    var items = _data.items || [];
    var requests = _data.requests || [];

    var html = '<div style="display:flex;justify-content:flex-end;margin-bottom:12px;">' +
      '<button class="shop-modal-btn shop-modal-btn--confirm" id="csNewItem">+ Request New Item</button>' +
    '</div>';

    if (items.length === 0) {
      html += '<div class="shop-empty">You have no items yet. Request one above!</div>';
    } else {
      html += '<div class="sa-table cs-item-table">';
      html += '<div class="sa-row sa-header cs-item-row">' +
        '<span>Name</span><span>ID</span><span>Type</span><span>Category</span>' +
        '<span>Active</span><span>Stock</span><span>Actions</span>' +
      '</div>';

      items.forEach(function (item) {
        var hasEditPending = requests.some(function (r) {
          return r.item_id === item.id && r.status === 'pending';
        });
        var isActive = item.active !== false;
        var rowClass = 'sa-row cs-item-row' + (!isActive ? ' sa-row--inactive' : '');

        html += '<div class="' + rowClass + '" data-item-id="' + esc(item.id) + '">';
        html += '<span class="sa-item-name">' + esc(item.name || item.id) + '</span>';
        html += '<span class="sa-item-id">' + esc(item.id) + '</span>';

        // Type pill
        var typePill = item.type === 'auction'
          ? '<span class="sa-pill sa-pill--auction">Auction</span>'
          : item.type === 'donate'
          ? '<span class="sa-pill sa-pill--donate">Donation</span>'
          : '<span class="sa-pill sa-pill--bin">Bin</span>';
        html += '<span>' + typePill + '</span>';

        // Category pills
        var cats = Array.isArray(item.category) ? item.category : (item.category ? [item.category] : []);
        html += '<span>' + (cats.length
          ? cats.map(function (ct) { return '<span class="sa-pill sa-pill--cat">' + esc(ct) + '</span>'; }).join(' ')
          : '<span style="color:var(--text-faint)">N/A</span>') + '</span>';

        // Active toggle
        html += '<span><label class="settings-toggle" data-cs-toggle="' + esc(item.id) + '">' +
          '<input type="checkbox"' + (isActive ? ' checked' : '') + ' />' +
          '<span class="settings-toggle-track"><span class="settings-toggle-thumb"></span></span>' +
          '</label></span>';

        // Stock input
        var stockVal = item.stock != null ? item.stock : '';
        html += '<span><input type="number" min="0" max="99999" class="sa-stock-input" ' +
          'data-cs-stock="' + esc(item.id) + '" value="' + esc(stockVal) + '" placeholder="\u221E" /></span>';

        // Actions
        html += '<span class="sa-actions-cell">';
        if (hasEditPending) {
          html += '<span class="sa-pill sa-pill--pending" style="font-size:0.6rem">Edit pending</span>';
        } else {
          html += '<button class="sa-action-btn ie-edit-btn" data-cs-edit="' + esc(item.id) + '">Request Edit</button>';
        }
        html += '</span>';

        html += '</div>';
      });

      html += '</div>';
    }

    c.innerHTML = html;

    /* wire events */
    document.getElementById('csNewItem').addEventListener('click', function () {
      showRequestForm(null);
    });

    // Active toggles
    c.querySelectorAll('[data-cs-toggle]').forEach(function (label) {
      var checkbox = label.querySelector('input[type="checkbox"]');
      if (!checkbox) return;
      checkbox.addEventListener('change', function () {
        var id = label.dataset.csToggle;
        var active = checkbox.checked;
        checkbox.disabled = true;
        apiPatch('/api/shop/creator/items/' + encodeURIComponent(id) + '/active', { active: active })
          .then(function (r) {
            if (r.ok) {
              var row = label.closest('.sa-row');
              if (row) row.classList.toggle('sa-row--inactive', !active);
              window.showToast('\u2713 ' + id + ' ' + (active ? 'activated' : 'deactivated'), 'success');
              var item = (items || []).find(function (it) { return it.id === id; });
              if (item) item.active = active;
            } else {
              window.showToast('\u26a0 ' + (r.data.error || 'Failed'), 'warn');
              checkbox.checked = !active;
            }
          })
          .catch(function () { window.showToast('\u26a0 Network error', 'warn'); checkbox.checked = !active; })
          .finally(function () { checkbox.disabled = false; });
      });
    });

    // Stock inputs
    c.querySelectorAll('[data-cs-stock]').forEach(function (inp) {
      var lastVal = inp.value;
      inp.addEventListener('blur', function () {
        var id = inp.dataset.csStock;
        var val = inp.value.trim();
        if (val === lastVal) return;
        var stock = val === '' ? null : parseInt(val, 10);
        if (stock !== null && (isNaN(stock) || stock < 0)) { inp.value = lastVal; return; }
        if (stock !== null && stock > 99999) { window.showToast('\u26a0 Stock cannot exceed 99,999.', 'warn'); inp.value = lastVal; return; }
        inp.disabled = true;
        apiPatch('/api/shop/creator/items/' + encodeURIComponent(id) + '/stock', { stock: stock })
          .then(function (r) {
            if (r.ok) {
              lastVal = val;
              window.showToast('\u2713 Stock updated for ' + id, 'success');
            } else {
              window.showToast('\u26a0 ' + (r.data.error || 'Failed'), 'warn');
              inp.value = lastVal;
            }
          })
          .catch(function () { window.showToast('\u26a0 Network error', 'warn'); inp.value = lastVal; })
          .finally(function () { inp.disabled = false; });
      });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') inp.blur(); });
      inp.addEventListener('input', function () {
        var clean = this.value.replace(/\D/g, '').slice(0, 5);
        if (this.value !== clean) this.value = clean;
      });
    });

    // Edit buttons
    c.querySelectorAll('[data-cs-edit]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.csEdit;
        var item = (items || []).find(function (it) { return it.id === id; });
        if (item) showRequestForm(item);
      });
    });
  }

  /* Request form (new / edit) */
  var _ITEM_CATEGORIES = ['cosmetic','consumable','gear','housing','collectible','service','misc'];
  var _CS_RANKS = ['emperor','archduke','grand duke','duke','count','viscount','knight','squire'];
  var _csCatTags   = [];
  var _csImages    = [];
  var _csVariants  = [];
  var _csActiveVar = -1;  // -1 = General
  var _CS_MAX_TABS = 11;

  function _sel(c) { return c ? ' selected' : ''; }
  function _v(v, d) { return (v != null && v !== '') ? String(v) : (d != null ? String(d) : ''); }
  function _csParseCd(val) {
    if (!val) return {type:'none',n:1};
    val = String(val).trim();
    if (val === 'end_of_cycle') return {type:'end_of_cycle',n:1};
    var m = val.match(/^(\d+)c$/i);
    if (m) return {type:'cycles',n:parseInt(m[1])};
    var d = parseInt(val);
    return (!isNaN(d) && d > 0) ? {type:'days',n:d} : {type:'none',n:1};
  }

  function _csParseRanks(vtr) {
    var state = {};
    _CS_RANKS.forEach(function(r) { state[r] = 0; });
    if (!Array.isArray(vtr)) return state;
    vtr.forEach(function(s) {
      s = String(s).trim().toLowerCase();
      if (s[0] === '!') { var r = s.slice(1); if (r in state) state[r] = -1; }
      else { if (s in state) state[s] = 1; }
    });
    return state;
  }

  function _csRenderImageList(container) {
    var h = '';
    _csImages.forEach(function(img, i) {
      h += '<div class="ie-img-row" data-idx="' + i + '">';
      h += '<span class="ie-img-pos">' + (i+1) + '</span>';
      h += '<span class="ie-img-row-grip">&#9776;</span>';
      h += '<img class="ie-img-row-thumb" src="' + esc(img.url) + '" />';
      h += '<span class="ie-img-row-name" title="' + esc(img.name) + '">' + esc(img.name) + '</span>';
      h += '<button type="button" class="ie-img-row-btn ie-img-row-up" title="Move up"' + (i===0?' disabled':'') + '>&#9650;</button>';
      h += '<button type="button" class="ie-img-row-btn ie-img-row-down" title="Move down"' + (i===_csImages.length-1?' disabled':'') + '>&#9660;</button>';
      h += '<button type="button" class="ie-img-row-btn ie-img-row-remove" title="Remove">&times;</button>';
      h += '</div>';
    });
    container.innerHTML = h;
    var addBtn = container.parentNode.querySelector('#csImgAdd');
    if (addBtn) addBtn.style.display = _csImages.length >= 3 ? 'none' : '';
    // Bind drag-to-reorder on each row
    container.querySelectorAll('.ie-img-row').forEach(function(row) {
      row.setAttribute('draggable', 'true');
      row.addEventListener('dragstart', function(e) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', row.dataset.idx);
        row.classList.add('ie-img-row--dragging');
      });
      row.addEventListener('dragend', function() {
        row.classList.remove('ie-img-row--dragging');
        container.querySelectorAll('.ie-img-row--over').forEach(function(r) { r.classList.remove('ie-img-row--over'); });
      });
      row.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        container.querySelectorAll('.ie-img-row--over').forEach(function(r) { r.classList.remove('ie-img-row--over'); });
        row.classList.add('ie-img-row--over');
      });
      row.addEventListener('dragleave', function() { row.classList.remove('ie-img-row--over'); });
      row.addEventListener('drop', function(e) {
        e.preventDefault();
        row.classList.remove('ie-img-row--over');
        var fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
        var toIdx   = parseInt(row.dataset.idx);
        if (fromIdx === toIdx || isNaN(fromIdx) || isNaN(toIdx)) return;
        var moved = _csImages.splice(fromIdx, 1)[0];
        _csImages.splice(toIdx, 0, moved);
        _csRenderImageList(container);
      });
    });
  }

  function _csUploadImage(file, listEl) {
    var allowed = ['image/png','image/jpeg','image/jpg','image/gif','image/webp'];
    if (allowed.indexOf(file.type) === -1) { window.showToast('\u26a0 Use PNG, JPG, GIF or WebP.', 'warn'); return; }
    if (file.size > 2*1024*1024) { window.showToast('\u26a0 Image must be < 2 MB.', 'warn'); return; }
    if (_csImages.length >= 3) { window.showToast('\u26a0 Maximum 3 images.', 'warn'); return; }
    var addBtn = listEl.parentNode.querySelector('#csImgAdd');
    if (addBtn) addBtn.style.display = 'none';
    var fd = new FormData();
    fd.append('file', file);
    fetch('/api/shop/creator/upload-image', { method:'POST', credentials:'same-origin', body:fd })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.ok) {
          _csImages.push({ name:file.name, url:data.url });
          _csRenderImageList(listEl);
        } else {
          window.showToast('\u26a0 ' + (data.error || 'Upload failed'), 'warn');
          if (addBtn) addBtn.style.display = _csImages.length >= 3 ? 'none' : '';
        }
      })
      .catch(function() {
        window.showToast('\u26a0 Upload failed.', 'warn');
        if (addBtn) addBtn.style.display = _csImages.length >= 3 ? 'none' : '';
      });
  }

  function _csSaveVarData(modal) {
    if (_csActiveVar < 0 || _csActiveVar >= _csVariants.length) return;
    var i = _csActiveVar, d = _csVariants[i].data || (_csVariants[i].data = {});
    function gv(id) { var el = modal.querySelector('#'+id); return el ? el.value.trim() : ''; }
    d.name=gv('csVN_'+i); d.price=gv('csVP_'+i); d.stock=gv('csVS_'+i);
    d.max_quantity=gv('csVMQ_'+i); d.accepts_dirty_ep=gv('csVDE_'+i);
    d.spend_order=gv('csVSO_'+i); d.cooldown_type=gv('csVCT_'+i);
    d.cooldown_num=gv('csVCN_'+i); d.active=gv('csVA_'+i);
  }

  /* Build full editor HTML */
  function _csBuildHtml(it) {
    var itType = it.type || 'bin';
    var ranks = _csParseRanks(it.visible_to_ranks);
    var h = '<button class="modal-close" aria-label="Close">' + _closeSvg + '</button>';
    h += '<div class="shop-modal-title" id="csModalTitle"></div>';

    /* Tab bar */
    var _show = _csVariants.length > 0;
    if (_show) {
      h += '<div class="ie-variant-tabs" id="csVarTabs"><div class="ie-variant-tabs-row">';
      h += '<button class="ie-variant-tab' + (_csActiveVar===-1?' ie-variant-tab--active':'') + '" data-vidx="-1"><span class="ie-variant-tab-label">General</span></button>';
      _csVariants.forEach(function(v,i){
        var inact = v.data && v.data.active==='false';
        h += '<button class="ie-variant-tab'+(_csActiveVar===i?' ie-variant-tab--active':'')+(inact?' ie-variant-tab--inactive':'')+'" data-vidx="'+i+'" title="'+esc(v.label)+'">';
        h += '<span class="ie-variant-tab-label">'+esc(v.label)+'</span>';
        if (_csVariants.length > 1) h += '<span class="ie-variant-tab-close" data-vrem="'+i+'" title="Remove">&times;</span>';
        h += '</button>';
      });
      if ((1+_csVariants.length)<_CS_MAX_TABS && itType!=='auction')
        h += '<button class="ie-variant-tab ie-variant-tab--add" id="csAddVar" title="Add Variant"><span class="ie-add-plus">+</span><span class="ie-add-text">\u00a0Add Variant</span></button>';
      h += '</div><div class="ie-variant-tabs-border"></div></div>';
    }

    h += '<div class="ie-form-scroll"'+(_show?'':' style="max-height:65vh"')+'>';

    /* Basic Info (hidden when variant tab active) */
    h += '<div class="ie-section" id="csBasicInfo"'+(_csActiveVar>=0?' style="display:none"':'')+'><div class="ie-section-title">Basic Info</div><div class="ie-row">';
    h += '<div class="ie-field ie-field--wide"><label class="ie-label">Name</label><input id="csF_name" class="ie-input" value="'+esc(it.name||'')+'" placeholder="Display name" maxlength="80" /></div>';
    h += '<div class="ie-field" id="csTypeField"'+(_csActiveVar>=0?' style="display:none"':'')+'><label class="ie-label">Type</label><select id="csF_type" class="ie-input"><option value="bin"'+_sel(itType==='bin')+'>Bin</option><option value="auction"'+_sel(itType==='auction')+'>Auction</option></select></div>';
    h += '<div class="ie-field"><label class="ie-label">Active</label><select id="csF_active" class="ie-input"><option value="true"'+_sel(it.active!==false)+'>Yes</option><option value="false"'+_sel(it.active===false)+'>No</option></select></div>';
    h += '</div></div>';

    /* General panel */
    var gVis = _csActiveVar===-1?'':'none';
    h += '<div class="ie-tab-panel" data-csp="-1" style="display:'+gVis+'">';

    /* Categories */
    h += '<div class="ie-row"><div class="ie-field ie-field--full"><label class="ie-label">Categories</label><div class="ie-tag-container" id="csCatC">';
    _csCatTags.forEach(function(t){ h += '<span class="ie-tag-pill">'+esc(t)+'<button type="button" class="ie-tag-x">&times;</button></span>'; });
    h += '<input id="csCatG" class="ie-tag-ghost" list="csCatL" placeholder="'+(_csCatTags.length?'':'Type and press Space or Enter\u2026')+'" /></div>';
    h += '<datalist id="csCatL">'+_ITEM_CATEGORIES.map(function(c){return '<option value="'+esc(c)+'">';}).join('')+'</datalist>';
    h += '<input type="hidden" id="csF_cat" /><div class="ie-hint">Press <code>Space</code> or <code>Enter</code> to add \u00b7 <code>Backspace</code> on empty to remove last</div></div></div>';

    /* Description */
    h += '<div class="ie-field ie-field--full"><label class="ie-label">Description</label><textarea id="csF_desc" class="ie-input ie-textarea" maxlength="500">'+esc(it.description||'')+'</textarea></div>';

    /* Images: multi-upload */
    h += '<div class="ie-field ie-field--full" style="margin-bottom:18px"><label class="ie-label">Images <span class="ie-hint-inline">max 3</span></label>';
    h += '<div class="ie-img-list" id="csImgList"></div>';
    h += '<button type="button" class="ie-img-add-btn" id="csImgAdd">&#43; Upload Image</button>';
    h += '<input type="file" id="csImgFile" accept="image/png,image/jpeg,image/gif,image/webp" style="display:none" />';
    h += '<div class="ie-hint">PNG/JPG/GIF/WebP \u00b7 max 2 MB</div>';
    h += '</div>';

    /* Pricing & Stock */
    if (!_csVariants.length) {
      h += '<div class="ie-section" data-cs-pricing><div class="ie-section-title">Pricing &amp; Stock</div><div class="ie-row">';
      h += '<div class="ie-field"><label class="ie-label">Price (EP)</label><input id="csF_price" type="text" inputmode="numeric" class="ie-input ie-num" value="'+_v(it.price,'')+'" maxlength="6" placeholder="0" /></div>';
      h += '<div class="ie-field"><label class="ie-label">Stock (blank\u00a0=\u00a0\u221E)</label><input id="csF_stock" type="text" inputmode="numeric" class="ie-input ie-num" value="'+_v(it.stock,'')+'" maxlength="6" placeholder="\u221E" /></div>';
      h += '<div class="ie-field"><label class="ie-label">Max Qty/purchase</label><input id="csF_mq" type="text" inputmode="numeric" class="ie-input ie-num" value="'+_v(it.max_quantity,'')+'" maxlength="2" placeholder="1" /></div>';
      h += '</div></div>';

      var ad = it.accepts_dirty_ep!==false, sv = ad?(it.spend_order||'clean_first'):'clean_only';
      h += '<div class="ie-section" data-cs-ep><div class="ie-section-title">EP Settings</div><div class="ie-row">';
      h += '<div class="ie-field"><label class="ie-label">Accepts Dirty EP</label><select id="csF_de" class="ie-input"><option value="true"'+_sel(ad)+'>Yes</option><option value="false"'+_sel(!ad)+'>No (Clean Only)</option></select></div>';
      h += '<div class="ie-field"><label class="ie-label">Spend Order</label><select id="csF_so" class="ie-input">';
      ['clean_first','dirty_first','clean_only','dirty_only'].forEach(function(o){ h += '<option value="'+o+'"'+_sel(sv===o)+'>'+o.replace(/_/g,' ')+'</option>'; });
      h += '</select></div></div></div>';

      var cd = _csParseCd(it.cooldown);
      h += '<div class="ie-section"><div class="ie-section-title">Cooldown</div><div class="ie-row"><div class="ie-field ie-field--wide"><label class="ie-label">Cooldown</label><div class="ie-cooldown-row">';
      h += '<select id="csF_ct" class="ie-input ie-cd-type"><option value="none"'+_sel(cd.type==='none')+'>None</option><option value="days"'+_sel(cd.type==='days')+'>Days</option><option value="end_of_cycle"'+_sel(cd.type==='end_of_cycle')+'>End of Cycle</option><option value="cycles"'+_sel(cd.type==='cycles')+'>Cycles</option></select>';
      h += '<input id="csF_cn" type="text" inputmode="numeric" class="ie-input ie-num ie-cd-num" maxlength="2" value="'+cd.n+'"'+((cd.type==='days'||cd.type==='cycles')?'':' style="display:none"')+' />';
      h += '</div></div></div></div>';
    }

    /* Visibility */
    h += '<div class="ie-section"><div class="ie-section-title">Visibility</div>';
    h += '<div class="ie-field ie-field--full"><label class="ie-label">Visible to ranks</label>';
    h += '<div class="ie-rank-chips" id="csRankChips">';
    _CS_RANKS.forEach(function(rank) {
      var state = ranks[rank] || 0;
      var label = rank.split(' ').map(function(w){ return w[0].toUpperCase()+w.slice(1); }).join(' ');
      h += '<button class="ie-rank-chip" type="button" data-rank="'+esc(rank)+'" data-state="'+state+'">'+esc(label)+'</button>';
    });
    h += '</div>';
    h += '<div class="ie-hint ie-rank-legend">' +
      '<span class="ie-rl-dot" style="background:var(--border)"></span>Neutral (no filter) &ensp;' +
      '<span class="ie-rl-dot" style="background:var(--gold)"></span>Include &ensp;' +
      '<span class="ie-rl-dot" style="background:var(--danger)"></span>Exclude &ensp;- click to cycle</div>';
    h += '</div>';
    var topN = (it.visible_to_top_n != null && it.visible_to_top_n > 0) ? String(it.visible_to_top_n) : '';
    h += '<div class="ie-field ie-field--full" style="margin-top:8px"><label class="ie-label">Top N from Previous Cycle</label>';
    h += '<input id="csF_topN" type="text" inputmode="numeric" class="ie-input ie-num" value="'+esc(topN)+'" maxlength="3" placeholder="No filter" style="max-width:140px" />';
    h += '<div class="ie-hint">Only the top N players from the previous EP cycle can see and purchase this item. Leave blank for no restriction.</div>';
    h += '</div>';
    h += '</div>'; // visibility section

    h += '</div>'; // General panel

    /* Variant panels */
    _csVariants.forEach(function(v,i){
      var vis = _csActiveVar===i?'':'none';
      var d = v.data||{};
      var vd = d.accepts_dirty_ep!=='false', vs = vd?(d.spend_order||'clean_first'):'clean_only';
      h += '<div class="ie-tab-panel" data-csp="'+i+'" style="display:'+vis+'">';
      h += '<div class="ie-section"><div class="ie-row">';
      h += '<div class="ie-field ie-field--wide"><label class="ie-label">Name</label><input id="csVN_'+i+'" class="ie-input" value="'+esc(d.name||'')+'" placeholder="Variant display name" maxlength="45" /></div>';
      h += '<div class="ie-field"><label class="ie-label">Active</label><select id="csVA_'+i+'" class="ie-input"><option value="true"'+_sel(d.active!=='false')+'>Yes</option><option value="false"'+_sel(d.active==='false')+'>No</option></select></div>';
      h += '</div><div class="ie-row">';
      h += '<div class="ie-field"><label class="ie-label">Price (EP)</label><input id="csVP_'+i+'" type="text" inputmode="numeric" class="ie-input ie-num" value="'+_v(d.price,'')+'" maxlength="6" placeholder="0" /></div>';
      h += '<div class="ie-field"><label class="ie-label">Stock (blank\u00a0=\u00a0\u221e)</label><input id="csVS_'+i+'" type="text" inputmode="numeric" class="ie-input ie-num" value="'+_v(d.stock,'')+'" maxlength="6" placeholder="\u221e" /></div>';
      h += '<div class="ie-field"><label class="ie-label">Max Qty/purchase</label><input id="csVMQ_'+i+'" type="text" inputmode="numeric" class="ie-input ie-num" value="'+_v(d.max_quantity,'')+'" maxlength="2" placeholder="1" /></div>';
      h += '</div><div class="ie-row">';
      h += '<div class="ie-field"><label class="ie-label">Accepts Dirty EP</label><select id="csVDE_'+i+'" class="ie-input"><option value="true"'+_sel(vd)+'>Yes</option><option value="false"'+_sel(!vd)+'>No (Clean Only)</option></select></div>';
      h += '<div class="ie-field"><label class="ie-label">Spend Order</label><select id="csVSO_'+i+'" class="ie-input">';
      ['clean_first','dirty_first','clean_only','dirty_only'].forEach(function(o){ h += '<option value="'+o+'"'+_sel(vs===o)+'>'+o.replace(/_/g,' ')+'</option>'; });
      h += '</select></div></div></div>';
      var vc = {type:d.cooldown_type||'none',n:d.cooldown_num||'1'};
      h += '<div class="ie-section"><div class="ie-section-title">Cooldown</div><div class="ie-row"><div class="ie-field ie-field--wide"><label class="ie-label">Cooldown</label><div class="ie-cooldown-row">';
      h += '<select id="csVCT_'+i+'" class="ie-input ie-cd-type"><option value="none"'+_sel(vc.type==='none')+'>None</option><option value="days"'+_sel(vc.type==='days')+'>Days</option><option value="end_of_cycle"'+_sel(vc.type==='end_of_cycle')+'>End of Cycle</option><option value="cycles"'+_sel(vc.type==='cycles')+'>Cycles</option></select>';
      h += '<input id="csVCN_'+i+'" type="text" inputmode="numeric" class="ie-input ie-num ie-cd-num" maxlength="2" value="'+esc(vc.n)+'"'+((vc.type==='days'||vc.type==='cycles')?'':' style="display:none"')+' />';
      h += '</div></div></div></div></div>';
    });

    h += '</div>'; // ie-form-scroll
    h += '<div class="ie-field ie-field--full ie-note-field"><label class="ie-label">Note for reviewer <span class="ie-hint-inline">optional</span></label>' +
         '<textarea id="csF_note" class="ie-input ie-textarea" maxlength="200" rows="2" placeholder="Add context or reasoning for this request\u2026"></textarea></div>';
    h += '<div class="cs-form-msg" id="csFMsg" style="display:none"></div>';
    h += '<div class="shop-modal-actions"><button class="shop-modal-btn shop-modal-btn--confirm" id="csFSubmit">Submit Request</button></div>';
    return h;
  }

  /* Snapshot / restore General tab values across re-renders */
  function _csSnapGeneral(m) {
    function g(id) { var e = m.querySelector('#'+id); return e ? e.value : null; }
    var s = {name:g('csF_name'),type:g('csF_type'),active:g('csF_active'),desc:g('csF_desc'),topN:g('csF_topN'),
            price:g('csF_price'),stock:g('csF_stock'),mq:g('csF_mq'),de:g('csF_de'),so:g('csF_so'),ct:g('csF_ct'),cn:g('csF_cn'),
            images:_csImages.slice(), ranks:{}};
    m.querySelectorAll('.ie-rank-chip').forEach(function(c){ s.ranks[c.dataset.rank]=c.dataset.state; });
    return s;
  }
  function _csRestoreGeneral(m, s) {
    function sv(id,v) { var e = m.querySelector('#'+id); if (e && v!=null) e.value = v; }
    sv('csF_name',s.name); sv('csF_type',s.type); sv('csF_active',s.active);
    sv('csF_desc',s.desc); sv('csF_topN',s.topN);
    sv('csF_price',s.price); sv('csF_stock',s.stock); sv('csF_mq',s.mq);
    sv('csF_de',s.de); sv('csF_so',s.so); sv('csF_ct',s.ct); sv('csF_cn',s.cn);
    // Rank chips
    m.querySelectorAll('.ie-rank-chip').forEach(function(c){ if(s.ranks[c.dataset.rank]!=null) c.dataset.state=s.ranks[c.dataset.rank]; });
    // Images
    _csImages = s.images || [];
    var il = m.querySelector('#csImgList');
    if (il) _csRenderImageList(il);
  }

  /* Bind all editor events */
  function _csBindEvents(modal, existingItem, isEdit) {
    var title = isEdit ? 'Request Edit: ' + esc((existingItem||{}).name||(existingItem||{}).id||'') : 'Request New Item';
    var titleEl = modal.querySelector('#csModalTitle');
    if (titleEl) titleEl.textContent = title;

    /* Tab switching */
    modal.querySelectorAll('[data-vidx]').forEach(function(btn){
      btn.addEventListener('click', function(e){
        if (e.target.closest('[data-vrem]')) return;
        var idx = parseInt(btn.dataset.vidx);
        if (idx === _csActiveVar) return;
        _csSaveVarData(modal);
        _csActiveVar = idx;
        modal.querySelectorAll('[data-vidx]').forEach(function(b){ b.classList.toggle('ie-variant-tab--active', parseInt(b.dataset.vidx)===idx); });
        modal.querySelectorAll('[data-csp]').forEach(function(p){ p.style.display = parseInt(p.dataset.csp)===idx?'':'none'; });
        var bi = modal.querySelector('#csBasicInfo'), tf = modal.querySelector('#csTypeField');
        if (bi) bi.style.display = idx<0?'':'none';
        if (tf) tf.style.display = idx<0?'':'none';
      });
    });

    /* Remove variant (x on tab) */
    modal.querySelectorAll('[data-vrem]').forEach(function(x){
      x.addEventListener('click', function(e){
        e.stopPropagation();
        var ri = parseInt(x.dataset.vrem);
        if (_csVariants.length <= 1) return;
        _csSaveVarData(modal);
        var snap = _csSnapGeneral(modal);
        _csVariants.splice(ri,1);
        if (_csActiveVar === ri) _csActiveVar = -1;
        else if (_csActiveVar > ri) _csActiveVar--;
        _csRerender(modal, existingItem, isEdit, snap);
      });
    });

    /* Add variant */
    var addBtn = modal.querySelector('#csAddVar');
    if (addBtn) addBtn.addEventListener('click', function(){
      _csSaveVarData(modal);
      var snap = _csSnapGeneral(modal);
      _csVariants.push({id:'v'+Date.now(), label:'Variant '+(_csVariants.length+1),
        data:{name:'',price:'',stock:'',max_quantity:'',accepts_dirty_ep:'true',spend_order:'clean_first',cooldown_type:'none',cooldown_num:'1',active:'true'}});
      _csActiveVar = _csVariants.length - 1;
      _csRerender(modal, existingItem, isEdit, snap);
    });

    /* Type toggle */
    var typeEl = modal.querySelector('#csF_type');
    if (typeEl) {
      var prevType = typeEl.value;
      typeEl.addEventListener('change', function(){
        var t = typeEl.value;
        if (t==='auction' && _csVariants.length) {
          if (!confirm('Switching to Auction will remove all variants. Continue?')) { typeEl.value=prevType; return; }
          _csSaveVarData(modal); var snap=_csSnapGeneral(modal);
          _csVariants=[]; _csActiveVar=-1;
          snap.type='auction';
          _csRerender(modal, existingItem, isEdit, snap); return;
        }
        if (t!=='auction' && !_csVariants.length) {
          var snap2=_csSnapGeneral(modal);
          _csVariants.push({id:'v'+Date.now(),label:'Variant 1',data:{name:'',price:'',stock:'',max_quantity:'',accepts_dirty_ep:'true',spend_order:'clean_first',cooldown_type:'none',cooldown_num:'1',active:'true'}});
          _csActiveVar=-1; snap2.type=t;
          _csRerender(modal, existingItem, isEdit, snap2); return;
        }
        prevType=t;
      });
    }

    /* Rank chips */
    modal.querySelectorAll('.ie-rank-chip').forEach(function(chip){
      chip.addEventListener('click', function(){
        var s = parseInt(chip.dataset.state) || 0;
        chip.dataset.state = s===0 ? 1 : (s===1 ? -1 : 0);
      });
    });

    /* Multi-image management */
    var imgList = modal.querySelector('#csImgList');
    var imgAddBtn = modal.querySelector('#csImgAdd');
    var imgFileInput = modal.querySelector('#csImgFile');
    if (imgList) _csRenderImageList(imgList);
    if (imgAddBtn && imgFileInput) {
      imgAddBtn.addEventListener('click', function(){ imgFileInput.click(); });
      imgFileInput.addEventListener('change', function(){
        var file = imgFileInput.files[0];
        if (file) _csUploadImage(file, imgList);
        imgFileInput.value = '';
      });
    }
    if (imgList) {
      imgList.addEventListener('click', function(e){
        var row = e.target.closest('.ie-img-row');
        if (!row) return;
        var idx = parseInt(row.dataset.idx);
        var tmp;
        if (e.target.closest('.ie-img-row-up') && idx > 0) {
          tmp=_csImages[idx]; _csImages[idx]=_csImages[idx-1]; _csImages[idx-1]=tmp;
          _csRenderImageList(imgList);
        } else if (e.target.closest('.ie-img-row-down') && idx < _csImages.length-1) {
          tmp=_csImages[idx]; _csImages[idx]=_csImages[idx+1]; _csImages[idx+1]=tmp;
          _csRenderImageList(imgList);
        } else if (e.target.closest('.ie-img-row-remove')) {
          _csImages.splice(idx,1);
          _csRenderImageList(imgList);
        }
      });
    }

    /* Digits-only enforcer */
    modal.querySelectorAll('.ie-num').forEach(function(inp){
      inp.addEventListener('input', function(){ var c=this.value.replace(/\D/g,''); if(c!==this.value) this.value=c; });
    });

    /* Cooldown toggles (General) */
    var gCt=modal.querySelector('#csF_ct'), gCn=modal.querySelector('#csF_cn');
    if(gCt&&gCn) gCt.addEventListener('change',function(){gCn.style.display=(gCt.value==='days'||gCt.value==='cycles')?'':'none';});

    /* Cooldown toggles + dirty/spend sync (per variant) */
    _csVariants.forEach(function(v,i){
      var vct=modal.querySelector('#csVCT_'+i), vcn=modal.querySelector('#csVCN_'+i);
      if(vct&&vcn) vct.addEventListener('change',function(){vcn.style.display=(vct.value==='days'||vct.value==='cycles')?'':'none';});
      var vde=modal.querySelector('#csVDE_'+i), vso=modal.querySelector('#csVSO_'+i);
      if(vde&&vso){
        vde.addEventListener('change',function(){if(vde.value==='false')vso.value='clean_only';else if(vso.value==='clean_only')vso.value='clean_first';});
        vso.addEventListener('change',function(){if(vso.value==='clean_only')vde.value='false';else vde.value='true';});
      }
      var va=modal.querySelector('#csVA_'+i);
      if(va) va.addEventListener('change',function(){
        var active = va.value === 'true';
        if(v.data) v.data.active=va.value;
        var tb=modal.querySelector('[data-vidx="'+i+'"]');
        if(tb) tb.classList.toggle('ie-variant-tab--inactive',!active);
        if (isEdit && existingItem && existingItem.id) {
          va.disabled = true;
          apiPatch('/api/shop/creator/items/' + encodeURIComponent(existingItem.id) + '/active', { active: active })
            .then(function(r) {
              if (r.ok) {
                window.showToast('\u2713 ' + (active ? 'Activated' : 'Deactivated'), 'success');
                existingItem.active = active;
                var tt = document.querySelector('[data-cs-toggle="' + existingItem.id + '"] input');
                if (tt) tt.checked = active;
                var row = document.querySelector('.sa-row[data-item-id="' + existingItem.id + '"]');
                if (row) row.classList.toggle('sa-row--inactive', !active);
                var lt = modal.querySelector('#csF_active');
                if (lt) lt.value = active ? 'true' : 'false';
                _csVariants.forEach(function(ov, oi) {
                  if (oi === i) return;
                  var ova = modal.querySelector('#csVA_' + oi);
                  if (ova) ova.value = active ? 'true' : 'false';
                  if (ov.data) ov.data.active = active ? 'true' : 'false';
                  var otb = modal.querySelector('[data-vidx="' + oi + '"]');
                  if (otb) otb.classList.toggle('ie-variant-tab--inactive', !active);
                });
              } else {
                window.showToast('\u26a0 ' + (r.data.error || 'Failed'), 'warn');
                va.value = active ? 'false' : 'true';
                if (v.data) v.data.active = va.value;
                if (tb) tb.classList.toggle('ie-variant-tab--inactive', va.value === 'false');
              }
            })
            .catch(function() {
              window.showToast('\u26a0 Network error', 'warn');
              va.value = active ? 'false' : 'true';
              if (v.data) v.data.active = va.value;
              if (tb) tb.classList.toggle('ie-variant-tab--inactive', va.value === 'false');
            })
            .finally(function() { va.disabled = false; });
        }
      });
    });

    /* General dirty/spend sync */
    var gde=modal.querySelector('#csF_de'), gso=modal.querySelector('#csF_so');
    if(gde&&gso){
      gde.addEventListener('change',function(){if(gde.value==='false')gso.value='clean_only';else if(gso.value==='clean_only')gso.value='clean_first';});
      gso.addEventListener('change',function(){if(gso.value==='clean_only')gde.value='false';else gde.value='true';});
    }

    /* Instant active dropdown + stock for edits */
    if (isEdit && existingItem && existingItem.id) {
      var _liveActive = modal.querySelector('#csF_active');
      if (_liveActive) {
        _liveActive.addEventListener('change', function() {
          var id = existingItem.id;
          var active = _liveActive.value === 'true';
          _liveActive.disabled = true;
          apiPatch('/api/shop/creator/items/' + encodeURIComponent(id) + '/active', { active: active })
            .then(function(r) {
              if (r.ok) {
                window.showToast('\u2713 ' + id + ' ' + (active ? 'activated' : 'deactivated'), 'success');
                existingItem.active = active;
                var tableToggle = document.querySelector('[data-cs-toggle="' + id + '"] input[type="checkbox"]');
                if (tableToggle) tableToggle.checked = active;
                var row = document.querySelector('.sa-row[data-item-id="' + id + '"]');
                if (row) row.classList.toggle('sa-row--inactive', !active);
                _csVariants.forEach(function(ov, oi) {
                  var ova = modal.querySelector('#csVA_' + oi);
                  if (ova) ova.value = active ? 'true' : 'false';
                  if (ov.data) ov.data.active = active ? 'true' : 'false';
                  var otb = modal.querySelector('[data-vidx="' + oi + '"]');
                  if (otb) otb.classList.toggle('ie-variant-tab--inactive', !active);
                });
              } else {
                window.showToast('\u26a0 ' + (r.data.error || 'Failed'), 'warn');
                _liveActive.value = active ? 'false' : 'true';
              }
            })
            .catch(function() { window.showToast('\u26a0 Network error', 'warn'); _liveActive.value = active ? 'false' : 'true'; })
            .finally(function() { _liveActive.disabled = false; });
        });
      }
      var _liveStock = modal.querySelector('#csF_stock');
      if (_liveStock) {
        var _lsLast = _liveStock.value;
        _liveStock.addEventListener('blur', function() {
          var id = existingItem.id;
          var val = _liveStock.value.trim();
          if (val === _lsLast) return;
          var stock = val === '' ? null : parseInt(val, 10);
          if (stock !== null && (isNaN(stock) || stock < 0)) { _liveStock.value = _lsLast; return; }
          if (stock !== null && stock > 99999) { window.showToast('\u26a0 Stock cannot exceed 99,999.', 'warn'); _liveStock.value = _lsLast; return; }
          _liveStock.disabled = true;
          apiPatch('/api/shop/creator/items/' + encodeURIComponent(id) + '/stock', { stock: stock })
            .then(function(r) {
              if (r.ok) {
                _lsLast = val;
                window.showToast('\u2713 Stock updated', 'success');
                existingItem.stock = stock;
                var tableStock = document.querySelector('[data-cs-stock="' + id + '"]');
                if (tableStock) tableStock.value = val;
              } else {
                window.showToast('\u26a0 ' + (r.data.error || 'Failed'), 'warn');
                _liveStock.value = _lsLast;
              }
            })
            .catch(function() { window.showToast('\u26a0 Network error', 'warn'); _liveStock.value = _lsLast; })
            .finally(function() { _liveStock.disabled = false; });
        });
        _liveStock.addEventListener('keydown', function(e) { if (e.key === 'Enter') _liveStock.blur(); });
      }
      /* Instant stock for variant panels in edit mode */
      _csVariants.forEach(function(v, vi) {
        var vsInp = modal.querySelector('#csVS_' + vi);
        if (!vsInp) return;
        var vsLast = vsInp.value;
        vsInp.addEventListener('blur', function() {
          var val = vsInp.value.trim();
          if (val === vsLast) return;
          var stock = val === '' ? null : parseInt(val, 10);
          if (stock !== null && (isNaN(stock) || stock < 0)) { vsInp.value = vsLast; return; }
          if (stock !== null && stock > 99999) { window.showToast('\u26a0 Stock cannot exceed 99,999.', 'warn'); vsInp.value = vsLast; return; }
          vsInp.disabled = true;
          apiPatch('/api/shop/creator/items/' + encodeURIComponent(existingItem.id) + '/stock', { stock: stock })
            .then(function(r) {
              if (r.ok) {
                vsLast = val;
                window.showToast('\u2713 Stock updated', 'success');
                existingItem.stock = stock;
                var tableStock = document.querySelector('[data-cs-stock="' + existingItem.id + '"]');
                if (tableStock) tableStock.value = val;
              } else {
                window.showToast('\u26a0 ' + (r.data.error || 'Failed'), 'warn');
                vsInp.value = vsLast;
              }
            })
            .catch(function() { window.showToast('\u26a0 Network error', 'warn'); vsInp.value = vsLast; })
            .finally(function() { vsInp.disabled = false; });
        });
        vsInp.addEventListener('keydown', function(e) { if (e.key === 'Enter') vsInp.blur(); });
      });
    }

    /* Category tag input */
    var cc=modal.querySelector('#csCatC'), cg=modal.querySelector('#csCatG'), ch=modal.querySelector('#csF_cat');
    function _syncCat(){if(ch)ch.value=_csCatTags.join(',');}
    _syncCat();
    function _addCat(val){
      val=val.replace(/,/g,'').trim().toLowerCase().slice(0,25);
      if(!val||_csCatTags.indexOf(val)!==-1||_csCatTags.length>=10) return;
      _csCatTags.push(val);
      var p=document.createElement('span'); p.className='ie-tag-pill';
      p.innerHTML=esc(val)+'<button type="button" class="ie-tag-x">&times;</button>';
      p.querySelector('.ie-tag-x').addEventListener('click',function(){_csCatTags=_csCatTags.filter(function(t){return t!==val;});p.remove();_syncCat();cg.placeholder=_csCatTags.length?'':'Type and press Space or Enter\u2026';});
      cc.insertBefore(p,cg); _syncCat(); cg.value=''; cg.placeholder='';
    }
    cc.querySelectorAll('.ie-tag-x').forEach(function(btn){
      btn.addEventListener('click',function(){var p=btn.parentNode,t=p.firstChild.textContent.trim();_csCatTags=_csCatTags.filter(function(x){return x!==t;});p.remove();_syncCat();cg.placeholder=_csCatTags.length?'':'Type and press Space or Enter\u2026';});
    });
    cg.addEventListener('keydown',function(e){
      if(e.key==='Enter'||e.key===' '){e.preventDefault();_addCat(cg.value);}
      else if(e.key==='Backspace'&&!cg.value&&_csCatTags.length){_csCatTags.pop();var ps=cc.querySelectorAll('.ie-tag-pill');if(ps.length)ps[ps.length-1].remove();_syncCat();cg.placeholder=_csCatTags.length?'':'Type and press Space or Enter\u2026';}
    });
    cg.addEventListener('input',function(){if(cg.value.indexOf(' ')!==-1) cg.value.split(/\s+/).forEach(function(t){_addCat(t);});});
    cc.addEventListener('click',function(){cg.focus();});

    /* Submit */
    modal.querySelector('#csFSubmit').addEventListener('click', function(){
      _csSaveVarData(modal);
      var changes = {};
      function gv(id){var e=modal.querySelector('#'+id);return e?e.value.trim():'';}
      var name=gv('csF_name'); if(name) changes.name=name;
      changes.type=gv('csF_type');
      if (!isEdit) changes.active=gv('csF_active')==='true';
      changes.category=_csCatTags.length?(_csCatTags.length===1?_csCatTags[0]:_csCatTags):'misc';
      var desc=gv('csF_desc'); if(desc) changes.description=desc;
      if(_csImages.length) changes.images=_csImages.map(function(img){return img.url;});

      /* Visibility */
      var rankResult=[];
      modal.querySelectorAll('.ie-rank-chip').forEach(function(c){
        var s=parseInt(c.dataset.state);
        if(s===1) rankResult.push(c.dataset.rank);
        else if(s===-1) rankResult.push('!'+c.dataset.rank);
      });
      if(rankResult.length) changes.visible_to_ranks=rankResult;
      var topNVal=gv('csF_topN');
      var topN=topNVal?(parseInt(topNVal,10)||null):null;
      if(topN!==null&&topN<=0) topN=null;
      if(topN!==null) changes.visible_to_top_n=topN;

      function _toInt(v) { var n = parseInt(String(v).replace(/\D/g, ''), 10); return isNaN(n) ? null : n; }
      var hasV = _csVariants.length > 0;
      var fv = hasV ? (_csVariants[0].data||{}) : null;
      if (!hasV) {
        var pr=gv('csF_price').replace(/\D/g,''); if(pr!=='') changes.price=parseInt(pr,10);
        if (!isEdit) { var st=gv('csF_stock').replace(/\D/g,''); if(st!=='') changes.stock=parseInt(st,10); }
        var mq=gv('csF_mq').replace(/\D/g,''); if(mq!=='') changes.max_quantity=parseInt(mq,10);
        changes.accepts_dirty_ep=gv('csF_de')==='true';
        changes.spend_order=gv('csF_so');
        var ct=gv('csF_ct'), cn=parseInt(gv('csF_cn')||'1')||1;
        changes.cooldown=ct==='none'?'':ct==='end_of_cycle'?'end_of_cycle':ct==='days'?String(cn):ct==='cycles'?cn+'c':'';
      } else {
        changes.price = _toInt(fv.price);
        if (!isEdit) changes.stock = _toInt(fv.stock);
        changes.max_quantity = _toInt(fv.max_quantity);
        changes.accepts_dirty_ep = fv.accepts_dirty_ep!=='false';
        changes.spend_order = fv.spend_order||'clean_first';
        var fct=fv.cooldown_type||'none', fcn=parseInt(fv.cooldown_num||'1')||1;
        changes.cooldown=fct==='none'?'':fct==='end_of_cycle'?'end_of_cycle':fct==='days'?String(fcn):fct==='cycles'?fcn+'c':'';
      }

      /* Collect variants */
      if (hasV) {
        changes.variants = _csVariants.map(function(v){
          var d=v.data||{};
          var vct=d.cooldown_type||'none', vcn=parseInt(d.cooldown_num||'1')||1;
          var vr = {
            label:v.label, name:(d.name||'').slice(0,45), type:gv('csF_type'),
            price:_toInt(d.price), max_quantity:_toInt(d.max_quantity),
            accepts_dirty_ep:d.accepts_dirty_ep!=='false',
            spend_order:d.spend_order||'clean_first',
            cooldown:vct==='none'?'':vct==='end_of_cycle'?'end_of_cycle':vct==='days'?String(vcn):vct==='cycles'?vcn+'c':'',
          };
          vr.stock = _toInt(d.stock);
          vr.active = d.active !== 'false';
          return vr;
        });
      }

      /* For edits, strip unchanged fields so only actual diffs are submitted */
      if (isEdit) {
        var _o = existingItem;
        function _eq(a, b) {
          var ae = (a == null || a === ''), be = (b == null || b === '');
          if (ae && be) return true;
          if (ae !== be) return false;
          if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
          return String(a) === String(b);
        }
        /* Detect fields that were cleared (form empty but original had a value) */
        if (!('description' in changes) && _o.description) changes.description = '';
        if (!('images' in changes)) {
          var _oImgs = _o.images || (_o.image ? [_o.image] : []);
          if (_oImgs.length) changes.images = [];
        }
        if (!('visible_to_ranks' in changes) && Array.isArray(_o.visible_to_ranks) && _o.visible_to_ranks.length) changes.visible_to_ranks = [];
        if (!('visible_to_top_n' in changes) && _o.visible_to_top_n > 0) changes.visible_to_top_n = null;
        /* Strip unchanged */
        if (_eq(changes.name, _o.name)) delete changes.name;
        if (_eq(changes.type, _o.type || 'bin')) delete changes.type;
        var _oCat = Array.isArray(_o.category) ? _o.category.slice().sort() : (_o.category ? [_o.category] : []);
        var _nCat = Array.isArray(changes.category) ? changes.category.slice().sort() : (changes.category ? [changes.category] : []);
        if (JSON.stringify(_nCat) === JSON.stringify(_oCat)) delete changes.category;
        if (_eq(changes.description, _o.description)) delete changes.description;
        var _oI = _o.images || (_o.image ? [_o.image] : []);
        if (JSON.stringify(changes.images || []) === JSON.stringify(_oI)) delete changes.images;
        if (JSON.stringify(changes.visible_to_ranks || []) === JSON.stringify(_o.visible_to_ranks || [])) delete changes.visible_to_ranks;
        if (_eq(changes.visible_to_top_n, _o.visible_to_top_n)) delete changes.visible_to_top_n;
        if (_eq(changes.price, _o.price)) delete changes.price;
        if (_eq(changes.max_quantity, _o.max_quantity)) delete changes.max_quantity;
        if (changes.accepts_dirty_ep === (_o.accepts_dirty_ep !== false)) delete changes.accepts_dirty_ep;
        if (_eq(changes.spend_order, _o.spend_order || 'clean_first')) delete changes.spend_order;
        var _oCdP = _csParseCd(_o.cooldown);
        var _oCdS = _oCdP.type==='none'?'':_oCdP.type==='end_of_cycle'?'end_of_cycle':_oCdP.type==='days'?String(_oCdP.n):_oCdP.type==='cycles'?_oCdP.n+'c':'';
        if (_eq(changes.cooldown, _oCdS)) delete changes.cooldown;
        /* Variants: deep compare */
        if (changes.variants) {
          var _oV = Array.isArray(_o.variants) ? _o.variants : [];
          var _vc = changes.variants.length !== _oV.length;
          if (!_vc) {
            for (var _vi = 0; _vi < changes.variants.length; _vi++) {
              var _cv = changes.variants[_vi], _ov = _oV[_vi] || {};
              var _ovP = _csParseCd(_ov.cooldown);
              var _ovS = _ovP.type==='none'?'':_ovP.type==='end_of_cycle'?'end_of_cycle':_ovP.type==='days'?String(_ovP.n):_ovP.type==='cycles'?_ovP.n+'c':'';
              if (!_eq(_cv.name, _ov.name) || !_eq(_cv.label, _ov.label) ||
                  !_eq(_cv.price, _ov.price) ||
                  !_eq(_cv.max_quantity, _ov.max_quantity) ||
                  _cv.accepts_dirty_ep !== (_ov.accepts_dirty_ep !== false) ||
                  !_eq(_cv.spend_order, _ov.spend_order || 'clean_first') ||
                  !_eq(_cv.cooldown, _ovS)) {
                _vc = true; break;
              }
            }
          }
          if (!_vc) delete changes.variants;
        }
        if (Object.keys(changes).length === 0) {
          _formMsg('No changes detected.', 'warn');
          return;
        }
      }

      if (!changes.name && !isEdit) { _formMsg('Name is required for new items.','warn'); return; }
      var sub=modal.querySelector('#csFSubmit'); sub.disabled=true; sub.textContent='Submitting\u2026';
      _formMsg('','');
      var body={changes:changes}; if(isEdit) body.item_id=existingItem.id;
      var noteVal=modal.querySelector('#csF_note'); if(noteVal&&noteVal.value.trim()) body.note=noteVal.value.trim();
      apiPost('/api/shop/creator/request-item',body)
        .then(function(r){
          if(r.ok&&r.data.ok){window.showToast('\u2713 Request submitted!','success');_closeModal();fetchData(function(){renderTab();});}
          else{_formMsg(r.data.error||'Failed to submit.','warn');sub.disabled=false;sub.textContent='Submit Request';}
        })
        .catch(function(){_formMsg('Network error. Please try again.','warn');sub.disabled=false;sub.textContent='Submit Request';});
    });
  }

  /* Re-render after variant add/remove */
  function _csRerender(modal, existingItem, isEdit, snap) {
    modal.innerHTML = _csBuildHtml(existingItem || {});
    if (snap) _csRestoreGeneral(modal, snap);
    /* Rebuild category pills from _csCatTags */
    var cc=modal.querySelector('#csCatC'), cg=modal.querySelector('#csCatG');
    if (cc&&cg) {
      cc.querySelectorAll('.ie-tag-pill').forEach(function(p){p.remove();});
      _csCatTags.forEach(function(t){
        var p=document.createElement('span');p.className='ie-tag-pill';
        p.innerHTML=esc(t)+'<button type="button" class="ie-tag-x">&times;</button>';
        cc.insertBefore(p,cg);
      });
      cg.placeholder=_csCatTags.length?'':'Type and press Space or Enter\u2026';
    }
    _csBindEvents(modal, existingItem, isEdit);
  }

  /* Main entry point*/
  function showRequestForm(existingItem) {
    var modal = document.getElementById('csModal');
    var bd    = document.getElementById('csModalBackdrop');
    var isEdit = !!existingItem;
    var it = existingItem || {};
    var itType = it.type || 'bin';

    /* Seed state */
    _csCatTags = Array.isArray(it.category) ? it.category.slice() : (it.category ? [it.category] : []);
    _csImages = [];
    var existImgs = it.images || (it.image ? [it.image] : []);
    existImgs.forEach(function(url){ if(url) _csImages.push({ name:url.split('/').pop()||url, url:url }); });
    _csVariants = [];
    _csActiveVar = -1;

    if (isEdit && itType !== 'auction') {
      var subs = Array.isArray(it.variants) ? it.variants : [];
      if (subs.length) {
        subs.forEach(function(sv,idx){
          var scd = _csParseCd(sv.cooldown);
          _csVariants.push({id:'v'+Date.now()+'_'+idx, label:sv.label||('Variant '+(idx+1)),
            data:{name:sv.name||'', price:_v(sv.price,''), stock:_v(sv.stock,''), max_quantity:_v(sv.max_quantity,''),
                  accepts_dirty_ep:sv.accepts_dirty_ep!==false?'true':'false', spend_order:sv.spend_order||'clean_first',
                  cooldown_type:scd.type, cooldown_num:String(scd.n), active:sv.active!==false?'true':'false'}});
        });
      } else {
        var icd = _csParseCd(it.cooldown);
        _csVariants.push({id:'v'+Date.now(), label:'Variant 1',
          data:{name:'', price:_v(it.price,''), stock:_v(it.stock,''), max_quantity:_v(it.max_quantity,''),
                accepts_dirty_ep:it.accepts_dirty_ep!==false?'true':'false', spend_order:it.spend_order||'clean_first',
                cooldown_type:icd.type, cooldown_num:String(icd.n), active:'true'}});
      }
    } else if (itType !== 'auction') {
      _csVariants.push({id:'v'+Date.now(), label:'Variant 1',
        data:{name:'',price:'',stock:'',max_quantity:'',accepts_dirty_ep:'true',spend_order:'clean_first',cooldown_type:'none',cooldown_num:'1',active:'true'}});
    }

    modal.classList.add('ie-modal');
    modal.innerHTML = _csBuildHtml(it);
    bd.classList.add('open');
    _csBindEvents(modal, existingItem, isEdit);
  }

  function _formMsg(text, type) {
    var el = document.getElementById('csFMsg');
    if (!el) return;
    if (!text) { el.style.display = 'none'; return; }
    el.textContent = text;
    el.className = 'cs-form-msg' + (type === 'warn' ? ' cs-form-msg--warn' : '');
    el.style.display = '';
  }

  /* Queue tab */
  var _csQueueFilter = 'all';
  var _csQueueSort   = 'oldest';

  function renderQueueTab(c) {
    c.innerHTML = '<div class="shop-loading"><span class="loading-spinner"></span> Loading queue\u2026</div>';
    Promise.all([
      fetch('/api/shop/creator/my-requests', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }),
      fetch('/api/shop/creator/my-orders', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }),
    ]).then(function (results) {
      if (_activeTab !== 'queue') return;
      var reqData = results[0];
      var ordData = results[1];
      if (!reqData && !ordData) { c.innerHTML = '<div class="shop-empty">Could not load queue.</div>'; return; }
      var pending = ((reqData && reqData.requests) || []).filter(function (r) { return r.status === 'pending'; });
      var orders = ((ordData && ordData.orders) || []).filter(function (o) { return o.status === 'pending'; });
      _renderQueueContent(c, pending, orders);
      _updateCsQueueBadge(pending.length + orders.filter(function (o) { return o.status === 'pending'; }).length);
    }).catch(function () {
      if (_activeTab !== 'queue') return;
      c.innerHTML = '<div class="shop-empty">Could not load queue.</div>';
    });
  }

  function _updateCsQueueBadge(count) {
    // badge on the Queue tab inside the panel
    var btn = document.querySelector('#csTabs [data-tab="queue"]');
    if (btn) {
      var badge = btn.querySelector('.sa-badge');
      if (count > 0) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'sa-badge'; btn.appendChild(badge); }
        badge.textContent = count;
      } else if (badge) { badge.remove(); }
    }

    // badge on the Creator Studio sidebar nav item
    var navItem = document.querySelector('[data-panel="creator-studio"]');
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

  function _renderQueueContent(c, pending, orders) {
    var newCount  = pending.filter(function (r) { return !r.item_id; }).length;
    var editCount = pending.filter(function (r) { return !!r.item_id; }).length;
    var orderCount = orders.length;
    var total     = pending.length + orderCount;

    var html = '<div class="sa-q-filters">';
    html += '<button class="sa-q-pill' + (_csQueueFilter === 'all'  ? ' active' : '') + '" data-qf="all">All <span class="sa-q-count">' + total + '</span></button>';
    html += '<button class="sa-q-pill' + (_csQueueFilter === 'order' ? ' active' : '') + '" data-qf="order">Orders <span class="sa-q-count">' + orderCount + '</span></button>';
    html += '<button class="sa-q-pill' + (_csQueueFilter === 'new'  ? ' active' : '') + '" data-qf="new">New Item <span class="sa-q-count">' + newCount + '</span></button>';
    html += '<button class="sa-q-pill' + (_csQueueFilter === 'edit' ? ' active' : '') + '" data-qf="edit">Edit Item <span class="sa-q-count">' + editCount + '</span></button>';
    html += '<span class="sa-q-sort" id="csQueueSort">' + (_csQueueSort === 'oldest' ? 'Oldest first' : 'Newest first') + '</span>';
    html += '</div>';

    var merged = pending.map(function (r) {
      return { subtype: r.item_id ? 'edit' : 'new', date: r.submitted_at || '', data: r };
    });
    orders.forEach(function (o) {
      merged.push({ subtype: 'order', date: o.purchased_at || '', data: o });
    });
    merged.sort(function (a, b) {
      var cmp = (a.date).localeCompare(b.date);
      return _csQueueSort === 'newest' ? -cmp : cmp;
    });

    html += '<div id="csQueueList">';
    if (!merged.length) {
      html += '<div class="shop-empty sa-q-empty">Nothing in queue</div>';
    } else {
      merged.forEach(function (item) {
        var hidden = _csQueueFilter !== 'all' && _csQueueFilter !== item.subtype;
        html += _buildCsQueueCard(item, hidden);
      });
    }
    html += '</div>';
    c.innerHTML = html;

    /* Bind filter pills + sort */
    c.querySelector('.sa-q-filters').addEventListener('click', function (e) {
      var pill = e.target.closest('.sa-q-pill');
      if (pill) {
        _csQueueFilter = pill.dataset.qf;
        c.querySelectorAll('.sa-q-pill').forEach(function (p) { p.classList.remove('active'); });
        pill.classList.add('active');
        _applyCsQueueFilter();
        return;
      }
      var sort = e.target.closest('.sa-q-sort');
      if (sort) {
        _csQueueSort = _csQueueSort === 'oldest' ? 'newest' : 'oldest';
        sort.textContent = _csQueueSort === 'oldest' ? 'Oldest first' : 'Newest first';
        _resortCsQueue();
      }
    });

    /* Bind fulfill buttons on order cards */
    c.querySelectorAll('[data-cs-fulfill]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _openCsFulfillModal(btn.dataset.csFulfill, btn, c);
      });
    });

    /* Bind reject buttons on order cards */
    c.querySelectorAll('[data-cs-reject]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _openCsRejectModal(btn.dataset.csReject, btn, c);
      });
    });
  }

  function _openCsFulfillModal(pid, triggerBtn, queueContainer) {
    var modal = document.getElementById('csModal');
    var bd    = document.getElementById('csModalBackdrop');
    modal.classList.remove('ie-modal');
    modal.innerHTML =
      '<button class="modal-close" aria-label="Close">' + _closeSvg + '</button>' +
      '<div class="shop-modal-title">Mark Fulfilled</div>' +
      '<div class="shop-modal-body">' +
        '<label class="shop-modal-input-label">Note (optional)</label>' +
        '<textarea class="shop-modal-input" id="csFulfillNote" placeholder="Optional note\u2026" maxlength="50" rows="2"></textarea>' +
      '</div>' +
      '<div class="shop-modal-actions">' +
        '<button class="shop-modal-btn shop-modal-btn--confirm" id="csFulfillConfirm">Mark Fulfilled</button>' +
      '</div>';
    bd.classList.add('open');
    document.getElementById('csFulfillConfirm').addEventListener('click', function () {
      var note = document.getElementById('csFulfillNote').value.trim();
      var confirmBtn = this;
      confirmBtn.disabled = true; confirmBtn.textContent = 'Processing\u2026';
      apiPost('/api/shop/creator/orders/' + encodeURIComponent(pid) + '/fulfill', { note: note || null })
        .then(function (r) {
          if (r.ok) {
            window.showToast('\u2713 Order fulfilled.', 'success');
            _closeModal();
            var card = triggerBtn.closest('.sa-q-card');
            if (card) { card.style.opacity = '0.3'; card.style.pointerEvents = 'none'; }
            renderQueueTab(queueContainer);
          } else {
            window.showToast('\u26a0 ' + (r.data.error || 'Failed'), 'warn');
            confirmBtn.disabled = false; confirmBtn.textContent = 'Mark Fulfilled';
          }
        })
        .catch(function () {
          window.showToast('\u26a0 Network error', 'warn');
          confirmBtn.disabled = false; confirmBtn.textContent = 'Mark Fulfilled';
        });
    });
  }

  function _openCsRejectModal(pid, triggerBtn, queueContainer) {
    var modal = document.getElementById('csModal');
    var bd    = document.getElementById('csModalBackdrop');
    modal.classList.remove('ie-modal');
    modal.innerHTML =
      '<button class="modal-close" aria-label="Close">' + _closeSvg + '</button>' +
      '<div class="shop-modal-title">Reject Purchase</div>' +
      '<div class="shop-modal-body">' +
        '<label class="shop-modal-input-label">Reason (required)</label>' +
        '<textarea class="shop-modal-input" id="csRejectReason" placeholder="Reason for rejection\u2026" maxlength="50" rows="2"></textarea>' +
      '</div>' +
      '<div class="shop-modal-actions">' +
        '<button class="shop-modal-btn shop-modal-btn--cancel" id="csRejectConfirm" style="color:var(--danger);border-color:var(--danger);">Reject</button>' +
      '</div>';
    bd.classList.add('open');
    document.getElementById('csRejectConfirm').addEventListener('click', function () {
      var reason = document.getElementById('csRejectReason').value.trim();
      if (!reason) { window.showToast('\u26a0 Reason is required.', 'warn'); return; }
      var rejectBtn = this;
      rejectBtn.disabled = true; rejectBtn.textContent = 'Rejecting\u2026';
      apiPost('/api/shop/creator/orders/' + encodeURIComponent(pid) + '/reject', { reason: reason })
        .then(function (r) {
          if (r.ok) {
            window.showToast('\u2713 Purchase rejected.', 'success');
            _closeModal();
            var card = triggerBtn.closest('.sa-q-card');
            if (card) { card.style.opacity = '0.3'; card.style.pointerEvents = 'none'; }
            renderQueueTab(queueContainer);
          } else {
            window.showToast('\u26a0 ' + (r.data.error || 'Failed'), 'warn');
            rejectBtn.disabled = false; rejectBtn.textContent = 'Reject';
          }
        })
        .catch(function () {
          window.showToast('\u26a0 Network error', 'warn');
          rejectBtn.disabled = false; rejectBtn.textContent = 'Reject';
        });
    });
  }

  function _buildCsQueueCard(item, hidden) {
    var d = item.data;
    var isNew = item.subtype === 'new';
    var isOrder = item.subtype === 'order';
    var html = '<div class="sa-q-card' + (hidden ? ' sa-q-hidden' : '') +
      '" data-qtype="' + esc(item.subtype) +
      '" data-qdate="' + esc(item.date) + '">';

    /* Header */
    html += '<div class="sa-q-header"><div class="sa-q-header-left">';
    if (isOrder) {
      html += '<span class="sa-q-user">' + esc(d.username || 'Unknown buyer') + '</span>';
      html += '<div class="sa-q-tags">';
      html += '<span class="sa-q-type sa-q-type--purchase">Shop item</span>';
      var slugText = esc(d.item_id || '');
      if (d.variant_name) slugText += ' \u00b7 ' + esc(d.variant_name);
      try { if (d.quantity && d.quantity > 1) slugText += ' \u00d7' + d.quantity; } catch (ignore) {}
      html += '<span class="sa-q-slug">' + slugText + '</span>';
      html += '</div>';
    } else {
      var itemName = '';
      if (d.changes && d.changes.name) itemName = d.changes.name;
      else if (d.item_id && _data && _data.items) {
        var match = _data.items.find(function (it) { return it.id === d.item_id; });
        if (match) itemName = match.name || match.id;
        else itemName = d.item_id;
      }
      html += '<span class="sa-q-user">' + esc(itemName || (isNew ? 'New Item' : 'Edit')) + '</span>';
      html += '<div class="sa-q-tags">';
      html += isNew
        ? '<span class="sa-q-type sa-q-type--creator-request">New Item</span>'
        : '<span class="sa-q-type sa-q-type--creator-request">Edit Item</span>';
      if (!isNew && d.item_id) html += '<span class="sa-q-slug">' + esc(d.item_id) + '</span>';
      html += '</div>';
    }
    html += '</div>';
    html += '<span class="sa-q-date">' + fmtDate(item.date) + '</span>';
    html += '</div>';

    if (isOrder) {
      /* Metrics for orders */
      html += '<div class="sa-q-metrics">';
      html += '<div class="sa-q-metric"><span class="sa-q-metric-label">Total</span>' +
        '<span class="sa-q-metric-value sa-q-val--total">' + num(d.ep_spent) + ' EP</span></div>';
      html += '<div class="sa-q-metric"><span class="sa-q-metric-label">Clean</span>' +
        '<span class="sa-q-metric-value sa-q-val--clean">' + num(d.clean_ep_spent) + ' EP</span></div>';
      html += '<div class="sa-q-metric"><span class="sa-q-metric-label">Dirty</span>' +
        '<span class="sa-q-metric-value sa-q-val--dirty">' + num(d.dirty_ep_spent) + ' EP</span></div>';
      html += '</div>';
      /* Action buttons for pending orders */
      if ((d.status || 'pending') === 'pending') {
        html += '<div class="sa-q-actions">';
        html += '<button class="sa-q-btn sa-q-btn--primary" data-cs-fulfill="' + esc(d.purchase_id) + '">Mark fulfilled</button>';
        html += '<button class="sa-q-btn sa-q-btn--reject" data-cs-reject="' + esc(d.purchase_id) + '">Reject</button>';
        html += '</div>';
      } else {
        /* Status pill for resolved orders */
        html += '<div class="cs-q-status">' + statusPill(d.status) + '</div>';
      }
    } else {
      /* Changes summary for requests */
      var ch = d.changes || {};
      var bits = [];
      if (ch.name) bits.push('Name: ' + ch.name);
      if (ch.type) bits.push('Type: ' + ch.type);
      if (ch.price != null) bits.push('Price: ' + ch.price + ' EP');
      if (ch.stock != null) bits.push('Stock: ' + ch.stock);
      if (ch.category) bits.push('Category: ' + (Array.isArray(ch.category) ? ch.category.join(', ') : ch.category));
      if (ch.description) bits.push('Description updated');
      if (ch.images) bits.push('Images: ' + ch.images.length);
      if (ch.variants) bits.push('Variants: ' + ch.variants.length);
      if (bits.length) {
        html += '<div class="sa-q-note">' + esc(bits.join(' \u00b7 ')) + '</div>';
      }
      /* Status pill */
      html += '<div class="cs-q-status">' + statusPill('pending') + ' <span class="cs-q-status-hint">Awaiting Parliament review</span></div>';
    }

    html += '</div>';
    return html;
  }

  function _applyCsQueueFilter() {
    document.querySelectorAll('#csQueueList .sa-q-card').forEach(function (card) {
      var t = card.dataset.qtype;
      var match = _csQueueFilter === 'all' || _csQueueFilter === t;
      card.classList.toggle('sa-q-hidden', !match);
    });
    _checkCsQueueEmpty();
  }

  function _resortCsQueue() {
    var list = document.getElementById('csQueueList');
    if (!list) return;
    var cards = Array.from(list.querySelectorAll('.sa-q-card'));
    cards.sort(function (a, b) {
      var cmp = (a.dataset.qdate || '').localeCompare(b.dataset.qdate || '');
      return _csQueueSort === 'newest' ? -cmp : cmp;
    });
    cards.forEach(function (card) { list.appendChild(card); });
  }

  function _checkCsQueueEmpty() {
    var list = document.getElementById('csQueueList');
    if (!list) return;
    var visible = list.querySelectorAll('.sa-q-card:not(.sa-q-hidden)');
    var empty = list.querySelector('.sa-q-empty');
    if (!visible.length && !empty) {
      var div = document.createElement('div');
      div.className = 'shop-empty sa-q-empty';
      div.textContent = 'Nothing in queue';
      list.appendChild(div);
    } else if (visible.length && empty) {
      empty.remove();
    }
  }

  /* My Requests tab */
  function renderRequestsTab(c) {
    c.innerHTML = '<div class="sa-empty">Loading\u2026</div>';

    fetch('/api/shop/creator/my-requests', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) { c.innerHTML = '<div class="sa-empty">Failed to load requests.</div>'; return; }
        var reqs = d.requests || [];
        if (reqs.length === 0) {
          c.innerHTML = '<div class="sa-empty">No requests yet.</div>';
          return;
        }

        var html = '<div class="sa-table">';
        html += '<div class="sa-row sa-header cs-req-row">' +
          '<span>Type</span><span>Item</span><span>Submitted</span><span>Status</span><span>Reviewer Note</span>' +
        '</div>';

        reqs.forEach(function (r) {
          var reqType = r.item_id ? 'Edit' : 'New';
          var itemName = '';
          if (r.changes && r.changes.name) itemName = r.changes.name;
          else if (r.item_id && _data && _data.items) {
            var match = _data.items.find(function (it) { return it.id === r.item_id; });
            if (match) itemName = match.name || match.id;
            else itemName = r.item_id;
          }
          var typePill = r.item_id
            ? '<span class="sa-pill sa-pill--edit">Edit</span>'
            : '<span class="sa-pill sa-pill--new">New</span>';

          html += '<div class="sa-row cs-req-row">';
          html += '<span>' + typePill + '</span>';
          html += '<span class="sa-item-name">' + esc(itemName || '\u2014') + '</span>';
          html += '<span>' + fmtDate(r.submitted_at) + '</span>';
          html += '<span>' + statusPill(r.status) + '</span>';
          html += '<span style="color:var(--text-faint);font-size:.8rem">' + esc(r.rejection_reason || '\u2014') + '</span>';
          html += '</div>';
        });

        html += '</div>';
        c.innerHTML = html;
      })
      .catch(function () {
        c.innerHTML = '<div class="sa-empty">Failed to load requests.</div>';
      });
  }

  /* init */
  function initAdmin() {
    if (!window.hasCreatorAccess || !window.hasCreatorAccess()) return;
    buildShell();
    fetchData(function () { renderTab(); });
  }

  // observe the panel becoming active
  var _observer = new MutationObserver(function () {
    if (panel.classList.contains('active')) {
      _observer.disconnect();
      initAdmin();
    }
  });
  _observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
  // also check immediately
  if (panel.classList.contains('active')) {
    _observer.disconnect();
    initAdmin();
  }

  // re-init when shop toggle changes (reuses existing event pattern)
  window.addEventListener('shop:items-updated', function () {
    if (_shellBuilt && panel.classList.contains('active')) {
      fetchData(function () { renderTab(); });
    }
  });

  // Preload badge counts for the sidebar nav item (called before panel is active)
  window.preloadCreatorStudioBadge = function () {
    Promise.all([
      fetch('/api/shop/creator/my-requests', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }),
      fetch('/api/shop/creator/my-orders', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }),
    ]).then(function (results) {
      var reqData = results[0];
      var ordData = results[1];
      var pending = ((reqData && reqData.requests) || []).filter(function (r) { return r.status === 'pending'; });
      var orders = (ordData && ordData.orders) || [];
      var count = pending.length + orders.filter(function (o) { return o.status === 'pending'; }).length;
      _updateCsQueueBadge(count);
    }).catch(function () {});
  };
})();
