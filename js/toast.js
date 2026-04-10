(function () {
  'use strict';

  function _readSetting(key) {
    try { var s = JSON.parse(localStorage.getItem('esi_settings')); return s && key in s ? s[key] : undefined; }
    catch (e) { return undefined; }
  }
  var _settingsToastDur = _readSetting('toastDuration');
  var _settingsToastMax = _readSetting('toastMax');
  var TOAST_DURATION  = (_settingsToastDur != null ? Math.max(1, Math.min(30, _settingsToastDur)) : 7) * 1000;
  var _toastContainer = null;
  var _toastQueue     = [];
  var MAX_TOASTS      = _settingsToastMax != null ? Math.max(1, Math.min(6, _settingsToastMax)) : 3;
  var _queueBadge     = null;
  var _toastStates    = [];
  var _rafHandle      = null;

  function _ensureToastContainer() {
    if (_toastContainer && _toastContainer.parentNode) return _toastContainer;
    if (!document.getElementById('toastKeyframes')) {
      var s = document.createElement('style');
      s.id = 'toastKeyframes';
      s.textContent =
        '@keyframes toastIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}' +
        '.esi-toast-container{-ms-overflow-style:none;scrollbar-width:none}' +
        '.esi-toast-container::-webkit-scrollbar{display:none}' +
        '.esi-toast-container>*+*{margin-bottom:8px}';
      document.head.appendChild(s);
    }
    _toastContainer = document.createElement('div');
    _toastContainer.className = 'esi-toast-container';
    _toastContainer.style.cssText =
      'position:fixed;bottom:28px;right:28px;display:flex;flex-direction:column-reverse;' +
      'z-index:999;max-width:340px;pointer-events:none;overflow-y:auto;max-height:calc(100vh - 56px);contain:layout style;';
    document.body.appendChild(_toastContainer);
    return _toastContainer;
  }

  function _visibleToastCount() {
    return _ensureToastContainer().querySelectorAll('.esi-toast:not(.esi-toast-dismissing)').length;
  }

  function _dismissToast(toast) {
    if (toast.classList.contains('esi-toast-dismissing')) return;
    _toastStates = _toastStates.filter(function (s) { return s.el !== toast; });
    toast.classList.add('esi-toast-dismissing');
    var h = toast.offsetHeight;
    toast.style.height = h + 'px';
    toast.style.overflow = 'hidden';
    toast.style.animation = 'none';
    requestAnimationFrame(function () {
      toast.style.transition =
        'height 0.3s ease, padding-top 0.3s ease, padding-bottom 0.3s ease, ' +
        'margin-bottom 0.3s ease, border-width 0.3s ease, opacity 0.3s ease, transform 0.3s ease';
      toast.style.height = '0';
      toast.style.paddingTop = '0';
      toast.style.paddingBottom = '0';
      toast.style.marginBottom = '0';
      toast.style.borderWidth = '0';
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
    });
    _drainQueue();
    setTimeout(function () { toast.remove(); }, 350);
  }

  function _ensureLoop() {
    if (_rafHandle) return;
    var last = performance.now();
    function loop(now) {
      var dt = Math.min(now - last, 100);
      last = now;
      _toastStates = _toastStates.filter(function (s) { return s.el.parentNode; });
      if (_toastStates.length === 0) { _rafHandle = null; return; }
      var active = _toastStates.slice();
      var minHovered = Infinity;
      for (var i = 0; i < active.length; i++) {
        if (active[i].hovered) { minHovered = i; break; }
      }
      for (var j = 0; j < active.length; j++) {
        var s = active[j];
        if (!s.el.parentNode) continue;
        if (j >= minHovered) {
          s.remaining = TOAST_DURATION;
          s.bar.style.transform = 'scaleX(1)';
          continue;
        }
        s.remaining -= dt;
        if (s.remaining <= 0) { _dismissToast(s.el); continue; }
        s.bar.style.transform = 'scaleX(' + (s.remaining / TOAST_DURATION) + ')';
      }
      _rafHandle = requestAnimationFrame(loop);
    }
    _rafHandle = requestAnimationFrame(loop);
  }

  function _registerTimer(toast, bar) {
    var state = { el: toast, remaining: TOAST_DURATION, bar: bar, hovered: false };
    _toastStates.push(state);
    toast.addEventListener('mouseenter', function () { state.hovered = true; });
    toast.addEventListener('mouseleave', function () { state.hovered = false; });
    _ensureLoop();
  }

  function _updateQueueBadge() {
    var container = _ensureToastContainer();
    if (_toastQueue.length > 0) {
      if (!_queueBadge) {
        _queueBadge = document.createElement('div');
        _queueBadge.className = 'esi-toast-queue-badge';
        _queueBadge.style.cssText =
          'background:#1C2E1C;border:1px solid rgba(232,216,160,0.25);' +
          'color:#999;padding:6px 14px;border-radius:6px;' +
          "font-family:'Cinzel',serif;font-size:0.72rem;letter-spacing:0.05em;" +
          'text-align:center;pointer-events:auto;';
      }
      _queueBadge.textContent = '+' + _toastQueue.length + ' more notification' + (_toastQueue.length > 1 ? 's' : '');
      if (!_queueBadge.parentNode) container.insertBefore(_queueBadge, container.firstChild);
    } else if (_queueBadge && _queueBadge.parentNode) {
      _queueBadge.remove();
    }
  }

  function _drainQueue() {
    while (_toastQueue.length > 0 && _visibleToastCount() < MAX_TOASTS) {
      var next = _toastQueue.shift();
      if (next.element) {
        _ensureToastContainer().appendChild(next.element);
        var bar = next.element.querySelector('.esi-toast-bar');
        if (bar) _registerTimer(next.element, bar);
      } else {
        _renderToast(next.message, next.type);
      }
    }
    _updateQueueBadge();
  }

  function _renderToast(message, type) {
    var container = _ensureToastContainer();
    var colors = { success: '#3BA55C', info: '#5865F2', warn: '#FAA61A', error: '#ED4245' };
    var color  = colors[type] || colors.info;
    var toast  = document.createElement('div');
    toast.className = 'esi-toast';
    toast.style.cssText =
      'background:#1C2E1C;border:1px solid ' + color + ';border-left:4px solid ' + color + ';' +
      'color:#E8D8A0;padding:14px 36px 14px 22px;border-radius:6px;' +
      "font-family:'Cinzel',serif;font-size:0.82rem;letter-spacing:0.05em;" +
      'box-shadow:0 8px 32px rgba(0,0,0,0.5);animation:toastIn 0.35s ease;' +
      'max-width:340px;pointer-events:auto;position:relative;overflow:hidden;';

    var msgSpan = document.createElement('span');
    msgSpan.innerHTML = message;
    toast.appendChild(msgSpan);

    var closeBtn = document.createElement('button');
    closeBtn.textContent = '\u2715';
    closeBtn.style.cssText =
      'position:absolute;top:8px;right:10px;background:none;border:none;' +
      'color:#E8D8A0;font-size:1rem;cursor:pointer;padding:2px 4px;line-height:1;opacity:0.7;';
    closeBtn.addEventListener('mouseenter', function () { closeBtn.style.opacity = '1'; });
    closeBtn.addEventListener('mouseleave', function () { closeBtn.style.opacity = '0.7'; });
    closeBtn.addEventListener('click', function () { _dismissToast(toast); });
    toast.appendChild(closeBtn);

    var bar = document.createElement('div');
    bar.className = 'esi-toast-bar';
    bar.style.cssText =
      'position:absolute;bottom:0;left:0;right:0;height:3px;background:' + color + ';' +
      'transform-origin:left;transform:scaleX(1);';
    toast.appendChild(bar);

    container.appendChild(toast);
    _registerTimer(toast, bar);
  }

  function _isDuplicateToast(message) {
    var spans = _ensureToastContainer().querySelectorAll('.esi-toast > span');
    for (var i = 0; i < spans.length; i++) {
      if (spans[i].innerHTML === message) return true;
    }
    for (var j = 0; j < _toastQueue.length; j++) {
      if (_toastQueue[j].message === message) return true;
    }
    return false;
  }

  function showToast(message, type) {
    if (typeof type === 'undefined') type = 'info';
    if (_isDuplicateToast(message)) return;
    if (_visibleToastCount() < MAX_TOASTS) {
      _renderToast(message, type);
    } else {
      _toastQueue.push({ message: message, type: type });
      _updateQueueBadge();
    }
  }

  function showProgressToast(title) {
    var container = _ensureToastContainer();
    var COLORS = { info: '#5865F2', success: '#3BA55C', warn: '#FAA61A', error: '#ED4245' };
    var items = {};
    var expanded = false;
    var finished = false;

    var toast = document.createElement('div');
    toast.className = 'esi-toast esi-toast-progress';
    toast.style.cssText =
      'background:#1C2E1C;border:1px solid ' + COLORS.info + ';border-left:4px solid ' + COLORS.info + ';' +
      'color:#E8D8A0;padding:14px 36px 14px 22px;border-radius:6px;' +
      "font-family:'Cinzel',serif;font-size:0.82rem;letter-spacing:0.05em;" +
      'box-shadow:0 8px 32px rgba(0,0,0,0.5);animation:toastIn 0.35s ease;max-width:340px;pointer-events:auto;position:relative;overflow:hidden;';

    var finishBar = document.createElement('div');
    finishBar.className = 'esi-toast-bar';
    finishBar.style.cssText = 'position:absolute;bottom:0;left:0;right:0;height:3px;transform-origin:left;transform:scaleX(1);display:none;';

    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:flex;align-items:center;gap:6px;cursor:pointer;user-select:none;';
    var titleEl = document.createElement('span'); titleEl.textContent = title; titleEl.style.flex = '1';
    var pctEl   = document.createElement('span'); pctEl.style.cssText = 'font-size:0.75rem;color:#999;min-width:36px;text-align:right;';
    hdr.appendChild(titleEl); hdr.appendChild(pctEl);
    toast.appendChild(hdr);

    var detailsEl = document.createElement('div');
    detailsEl.style.cssText = 'display:none;margin-top:8px;padding-top:8px;border-top:1px solid rgba(232,216,160,0.12);';
    toast.appendChild(detailsEl);

    var cornerBtn = document.createElement('button');
    cornerBtn.textContent = '\u25B6';
    cornerBtn.style.cssText =
      'position:absolute;top:8px;right:10px;background:none;border:none;' +
      'color:#E8D8A0;font-size:0.7rem;cursor:pointer;padding:2px 4px;line-height:1;opacity:0.7;transition:transform 0.2s;';
    cornerBtn.addEventListener('mouseenter', function () { cornerBtn.style.opacity = '1'; });
    cornerBtn.addEventListener('mouseleave', function () { cornerBtn.style.opacity = '0.7'; });
    toast.appendChild(cornerBtn);

    function onCornerClick() {
      if (finished) { _dismissToast(toast); }
      else { expanded = !expanded; detailsEl.style.display = expanded ? 'block' : 'none'; cornerBtn.style.transform = expanded ? 'rotate(90deg)' : ''; }
    }
    cornerBtn.addEventListener('click', onCornerClick);
    hdr.addEventListener('click', function () { if (!finished) onCornerClick(); });

    toast.appendChild(finishBar);

    if (_visibleToastCount() < MAX_TOASTS) { container.appendChild(toast); }
    else { _toastQueue.push({ element: toast }); _updateQueueBadge(); }

    function rebuildDetails() {
      var keys  = Object.keys(items);
      var total = keys.length;
      var done  = keys.filter(function (k) { return items[k].status !== 'loading'; }).length;
      var pct   = total > 0 ? Math.round((done / total) * 100) : 0;
      pctEl.textContent = total > 0 && !finished ? '(' + pct + '%)' : '';
      detailsEl.innerHTML = '';
      keys.forEach(function (k) {
        var it  = items[k];
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:3px 0;font-size:0.78rem;';
        var ico = document.createElement('span'); ico.style.cssText = 'font-size:0.7rem;width:14px;text-align:center;flex-shrink:0;';
        if (it.status === 'loading')      { ico.textContent = '\u21BB'; ico.style.color = COLORS.info; }
        else if (it.status === 'success') { ico.textContent = '\u2713'; ico.style.color = COLORS.success; }
        else                              { ico.textContent = '\u2715'; ico.style.color = COLORS.error; }
        var lbl = document.createElement('span'); lbl.textContent = it.label; lbl.style.flex = '1';
        var st  = document.createElement('span'); st.style.cssText = 'font-size:0.72rem;';
        if (it.status === 'loading')      { st.textContent = 'Loading\u2026'; st.style.color = '#999'; }
        else if (it.status === 'success') { st.textContent = 'Loaded';        st.style.color = COLORS.success; }
        else                              { st.textContent = 'Failed';        st.style.color = COLORS.error; }
        row.appendChild(ico); row.appendChild(lbl); row.appendChild(st);
        detailsEl.appendChild(row);
      });
      if (total > 1) {
        var tr = document.createElement('div');
        tr.style.cssText = 'border-top:1px solid rgba(232,216,160,0.1);margin-top:6px;padding-top:6px;font-size:0.72rem;color:#999;text-align:right;';
        tr.textContent = done + '/' + total + ' loaded (' + pct + '%)';
        detailsEl.appendChild(tr);
      }
    }

    var ctrl = {
      addItem:    function (key, label)  { items[key] = { label: label, status: 'loading' }; rebuildDetails(); return ctrl; },
      updateItem: function (key, status) { if (items[key]) items[key].status = status; rebuildDetails(); return ctrl; },
      finish: function (msgs) {
        if (finished) return;
        finished = true; msgs = msgs || {};
        var keys    = Object.keys(items);
        var allOk   = keys.every(function (k) { return items[k].status === 'success'; });
        var allFail = keys.every(function (k) { return items[k].status === 'error'; });
        cornerBtn.textContent = '\u2715'; cornerBtn.style.transform = ''; cornerBtn.style.fontSize = '1rem';
        if (allOk) {
          titleEl.textContent = msgs.success || '\u2713 Data loaded';
          toast.style.borderColor = COLORS.success; toast.style.borderLeftColor = COLORS.success;
          hdr.style.cursor = 'default';
          if (expanded) { expanded = false; detailsEl.style.display = 'none'; }
        } else if (allFail) {
          titleEl.textContent = msgs.fail || '\u2715 Failed to load data';
          toast.style.borderColor = COLORS.error; toast.style.borderLeftColor = COLORS.error;
        } else {
          titleEl.textContent = msgs.partial || '\u26a0 Data partially loaded';
          toast.style.borderColor = COLORS.warn; toast.style.borderLeftColor = COLORS.warn;
          if (!expanded) { expanded = true; detailsEl.style.display = 'block'; }
        }
        pctEl.textContent = ''; rebuildDetails();
        // Start countdown bar now that loading is done
        var barColor = allOk ? COLORS.success : (allFail ? COLORS.error : COLORS.warn);
        finishBar.style.background = barColor;
        finishBar.style.display = '';
        _registerTimer(toast, finishBar);
      },
      dismiss: function () { _dismissToast(toast); },
    };
    return ctrl;
  }

  window.showToast         = showToast;
  window.showProgressToast = showProgressToast;
})();