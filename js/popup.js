/* =========================================================================
 * Popup / modal behavior.
 *
 * Exposes window.Popup with:
 *
 *   Popup.register(el, opts)  - wires up backdrop click, close button,
 *                               and Escape handling for a popup/modal.
 *                               Returns { open, close, toggle, element }.
 *   Popup.open(el, opts?)     - adds `.open` and body scroll lock.
 *   Popup.close(el, opts?)    - removes `.open` and releases the scroll
 *                               lock when no popup is open any more.
 *   Popup.isOpen(el)          - convenience check.
 *
 * This replaces the several near-duplicate blocks of open/close code that
 * previously lived in app.js / legal.js / bot.js / guild.js / player.js.
 * ========================================================================= */
(function () {
  'use strict';

  if (window.Popup) return;

  var openStack = [];   // stack of currently-open elements (top = last opened)
  var registry  = new WeakMap();  // element -> options record

  function _lockBody()   { document.body.classList.add('popup-scroll-lock'); }
  function _unlockBody() { document.body.classList.remove('popup-scroll-lock'); }

  function _syncScrollLock() {
    if (openStack.length === 0) _unlockBody();
    else                        _lockBody();
  }

  function isOpen(el) {
    return !!el && el.classList.contains('open');
  }

  function open(el, opts) {
    if (!el || isOpen(el)) return;
    el.classList.add('open');
    // also open the paired overlay if one was registered
    var record = registry.get(el);
    if (record && record.overlay) record.overlay.classList.add('open');
    openStack.push(el);
    _syncScrollLock();
    if (record && typeof record.onOpen === 'function') {
      try { record.onOpen(el); } catch (e) { /* ignore */ }
    }
    if (opts && typeof opts.onOpen === 'function') {
      try { opts.onOpen(el); } catch (e) { /* ignore */ }
    }
  }

  function close(el, opts) {
    if (!el || !isOpen(el)) return;
    el.classList.remove('open');
    var record = registry.get(el);
    if (record && record.overlay) record.overlay.classList.remove('open');
    var idx = openStack.indexOf(el);
    if (idx !== -1) openStack.splice(idx, 1);
    _syncScrollLock();
    if (record && typeof record.onClose === 'function') {
      try { record.onClose(el); } catch (e) { /* ignore */ }
    }
    if (opts && typeof opts.onClose === 'function') {
      try { opts.onClose(el); } catch (e) { /* ignore */ }
    }
  }

  function toggle(el) {
    if (!el) return;
    if (isOpen(el)) close(el); else open(el);
  }

  /**
   * Wire up shared popup/modal behavior.
   *
   * @param {HTMLElement} el     The element that receives the `.open` class.
   *                             For full-screen modals this is typically the
   *                             `.modal-backdrop`. For floating popups
   *                             (owed-aspects, esi-points, territories) it
   *                             is the popup card itself, and an overlay
   *                             should be provided via `opts.overlay`.
   * @param {object} opts
   * @param {HTMLElement} [opts.overlay]              Paired overlay to toggle in lockstep with `el`.
   * @param {HTMLElement|string} [opts.closeBtn]      Close button element or selector (querySelector within el or overlay).
   * @param {boolean}    [opts.closeOnBackdrop=true]  Click-outside closes the popup.
   * @param {boolean}    [opts.closeOnEsc=true]       Escape closes the popup.
   * @param {Function}   [opts.onOpen]
   * @param {Function}   [opts.onClose]
   * @param {Function}   [opts.onRequestClose]        Called before close. If it returns a truthy value, close is cancelled.
   */
  function register(el, opts) {
    if (!el) return null;
    opts = opts || {};

    var record = {
      overlay:           opts.overlay || null,
      onOpen:            opts.onOpen || null,
      onClose:           opts.onClose || null,
      onRequestClose:    opts.onRequestClose || null,
      closeOnBackdrop:   opts.closeOnBackdrop !== false,
      closeOnEsc:        opts.closeOnEsc      !== false,
    };
    registry.set(el, record);

    function requestClose() {
      if (record.onRequestClose) {
        try {
          if (record.onRequestClose(el)) return; // handler consumed the close
        } catch (e) { /* ignore */ }
      }
      close(el);
    }

    // Close button - accept an element or a selector string.
    if (opts.closeBtn) {
      var btn = typeof opts.closeBtn === 'string'
        ? (el.querySelector(opts.closeBtn) || (record.overlay && record.overlay.querySelector(opts.closeBtn)))
        : opts.closeBtn;
      if (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          requestClose();
        });
      }
    }

    // Backdrop click-to-close with mousedown/mouseup tracking so the user
    // can start a drag inside the modal and release outside without it
    // closing.
    if (record.closeOnBackdrop) {
      var backdrops = [];
      if (el.classList.contains('modal-backdrop')) backdrops.push(el);
      if (record.overlay)                          backdrops.push(record.overlay);
      backdrops.forEach(function (bd) {
        var mouseDownOn = false;
        bd.addEventListener('mousedown', function (ev) {
          mouseDownOn = ev.target === bd;
        });
        bd.addEventListener('mouseup', function (ev) {
          if (mouseDownOn && ev.target === bd) requestClose();
          mouseDownOn = false;
        });
      });
    }

    return {
      element: el,
      open:    function (o) { open(el, o); },
      close:   function (o) { close(el, o); },
      toggle:  function ()  { toggle(el); },
      isOpen:  function ()  { return isOpen(el); },
    };
  }

  // Single shared Escape handler - closes the top-most open popup that
  // opted into Escape-to-close.
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!openStack.length) return;
    for (var i = openStack.length - 1; i >= 0; i--) {
      var el = openStack[i];
      var rec = registry.get(el);
      if (!rec || rec.closeOnEsc) {
        close(el);
        return;
      }
    }
  });

  window.Popup = {
    register: register,
    open:     open,
    close:    close,
    toggle:   toggle,
    isOpen:   isOpen,
  };
})();
