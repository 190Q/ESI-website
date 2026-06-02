(function () {
  'use strict';

  // All selects on the site are auto-upgraded unless they have data-cs="false"
  var SELECTOR = 'select.graph-select, select.sf-select, select.settings-select, select.ev-select, select.ie-input, select.ie-cd-type, select.sa-filter-input, select.shop-modal-input, select.detail-variant-dropdown, select.char-select';
  var _open = null;

  /* helpers */
  function _close() {
    if (!_open) return;
    _open.classList.remove('cs-open');
    var t = _open.querySelector('.cs-trigger');
    if (t) t.setAttribute('aria-expanded', 'false');
    _open = null;
  }

  document.addEventListener('mousedown', function (e) {
    if (_open && !_open.contains(e.target)) _close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && _open) _close();
  });

  function _fontVar(sel) {
    if (sel.classList.contains('settings-select')) return 'var(--font-body)';
    return 'var(--font-heading)';
  }

  /* upgrade a single <select> */
  function upgrade(select) {
    if (!select || select._cs) return select ? select._cs : null;
    if (select.getAttribute('data-cs') === 'false') return null;
    var parent = select.parentNode;
    if (!parent) return null;

    // Snapshot layout before we touch the DOM
    var computed = window.getComputedStyle(select);
    var selectFlex = computed.flex;
    var selectFontSize = computed.fontSize;

    // Wrapper
    var wrap = document.createElement('div');
    wrap.className = 'cs-wrap';
    wrap.style.fontFamily = _fontVar(select);
    if (selectFontSize) wrap.style.fontSize = selectFontSize;

    parent.insertBefore(wrap, select);
    wrap.appendChild(select);
    select.style.cssText =
      'position:absolute;opacity:0;pointer-events:none;' +
      'width:0;height:0;overflow:hidden;';

    // Trigger (copies the select's classes for visual styling)
    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'cs-trigger';
    select.classList.forEach(function (c) { trigger.classList.add(c); });
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');

    var label = document.createElement('span');
    label.className = 'cs-label';
    trigger.appendChild(label);

    // Dropdown
    var dd = document.createElement('div');
    dd.className = 'cs-dropdown';
    dd.setAttribute('role', 'listbox');

    wrap.appendChild(trigger);
    wrap.appendChild(dd);

    /* sync helpers */
    function buildOpts() {
      dd.innerHTML = '';
      for (var i = 0; i < select.options.length; i++) {
        var o = document.createElement('div');
        o.className = 'cs-option' + (i === select.selectedIndex ? ' cs-selected' : '');
        o.setAttribute('data-i', String(i));
        o.setAttribute('role', 'option');
        o.textContent = select.options[i].textContent;
        dd.appendChild(o);
      }
    }

    function syncLabel() {
      var idx = select.selectedIndex;
      label.textContent =
        idx >= 0 && select.options[idx] ? select.options[idx].textContent : '';
    }

    function _measureWidth() {
      if (!select.options.length) return;
      var span = document.createElement('span');
      span.style.cssText =
        'position:absolute;visibility:hidden;white-space:nowrap;' +
        'pointer-events:none;height:0;overflow:hidden;';
      var cs = window.getComputedStyle(trigger);
      span.style.fontFamily = cs.fontFamily;
      span.style.fontSize = cs.fontSize;
      span.style.fontWeight = cs.fontWeight;
      span.style.letterSpacing = cs.letterSpacing;
      document.body.appendChild(span);

      var maxW = 0;
      for (var i = 0; i < select.options.length; i++) {
        span.textContent = select.options[i].textContent;
        if (span.offsetWidth > maxW) maxW = span.offsetWidth;
      }
      document.body.removeChild(span);

      // trigger padding + border + arrow (8px margin-left + 8px border width)
      var extra = (parseFloat(cs.paddingLeft) || 0) +
                  (parseFloat(cs.paddingRight) || 0) +
                  (parseFloat(cs.borderLeftWidth) || 0) +
                  (parseFloat(cs.borderRightWidth) || 0) + 17;
      wrap.style.width = Math.ceil(maxW + extra) + 'px';
    }

    function refresh() { buildOpts(); syncLabel(); _measureWidth(); }

    refresh();

    /* intercept programmatic value / selectedIndex changes */
    var _valDesc = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype, 'value'
    );
    var _idxDesc = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype, 'selectedIndex'
    );
    if (_valDesc && _valDesc.set) {
      Object.defineProperty(select, 'value', {
        get: function () { return _valDesc.get.call(this); },
        set: function (v) { _valDesc.set.call(this, v); syncLabel(); },
        configurable: true,
      });
    }
    if (_idxDesc && _idxDesc.set) {
      Object.defineProperty(select, 'selectedIndex', {
        get: function () { return _idxDesc.get.call(this); },
        set: function (v) { _idxDesc.set.call(this, v); syncLabel(); },
        configurable: true,
      });
    }

    /* watch for option additions / innerHTML replacement */
    var _raf = null;
    if (typeof MutationObserver !== 'undefined') {
      var mo = new MutationObserver(function () {
        if (_raf) return;
        _raf = requestAnimationFrame(function () { _raf = null; refresh(); });
      });
      mo.observe(select, { childList: true, subtree: true, characterData: true });
    }

    /* toggle */
    trigger.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (wrap.classList.contains('cs-open')) {
        _close();
      } else {
        _close();
        wrap.classList.add('cs-open');
        trigger.setAttribute('aria-expanded', 'true');
        _open = wrap;
        var s = dd.querySelector('.cs-selected');
        if (s) s.scrollIntoView({ block: 'nearest' });
      }
    });

    /* option click */
    dd.addEventListener('click', function (e) {
      var opt = e.target.closest('.cs-option');
      if (!opt) return;
      var idx = parseInt(opt.getAttribute('data-i'));
      if (!isNaN(idx)) {
        if (idx !== select.selectedIndex) {
          select.selectedIndex = idx;
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        refresh();
      }
      _close();
    });

    /* keyboard */
    trigger.addEventListener('keydown', function (e) {
      var isOpen = wrap.classList.contains('cs-open');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen) { trigger.click(); return; }
        var items = Array.from(dd.querySelectorAll('.cs-option'));
        var cur = dd.querySelector('.cs-focused') || dd.querySelector('.cs-selected');
        var idx = cur ? items.indexOf(cur) : -1;
        idx += e.key === 'ArrowDown' ? 1 : -1;
        if (idx < 0) idx = items.length - 1;
        if (idx >= items.length) idx = 0;
        items.forEach(function (el) { el.classList.remove('cs-focused'); });
        items[idx].classList.add('cs-focused');
        items[idx].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter' && isOpen) {
        e.preventDefault();
        var f = dd.querySelector('.cs-focused');
        if (f) {
          var fi = parseInt(f.getAttribute('data-i'));
          if (!isNaN(fi) && fi !== select.selectedIndex) {
            select.selectedIndex = fi;
            select.dispatchEvent(new Event('change', { bubbles: true }));
          }
          refresh();
        }
        _close();
      }
    });

    var ctrl = { refresh: refresh, wrap: wrap, trigger: trigger, dropdown: dd };
    select._cs = ctrl;
    return ctrl;
  }

  /* batch upgrade */
  function upgradeAll(sel) {
    document.querySelectorAll(sel || SELECTOR).forEach(function (el) {
      if (!el._cs) upgrade(el);
    });
  }

  /* auto-upgrade via MutationObserver */
  if (typeof MutationObserver !== 'undefined') {
    var _pending = false;
    var _obs = new MutationObserver(function () {
      if (_pending) return;
      _pending = true;
      requestAnimationFrame(function () { _pending = false; upgradeAll(); });
    });

    function _start() {
      if (!document.body) {
        document.addEventListener('DOMContentLoaded', _start);
        return;
      }
      upgradeAll();
      _obs.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _start);
    } else {
      _start();
    }
  }

  window.CustomSelect = Object.freeze({
    upgrade: upgrade,
    upgradeAll: upgradeAll,
    close: _close,
  });
})();
