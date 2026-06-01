(function () {
  'use strict';

  var FONT_DEFAULTS = {
    baseFont: '',
    defaultOptionLabel: 'Cinzel & Crimson Pro',
  };
  var _catalogReady = false;
  var _catalogPromise = null;
  var _catalogFonts = [];
  var _defaultOptionLabel = String(FONT_DEFAULTS.defaultOptionLabel || '').trim() || 'Cinzel & Crimson Pro';
  var _CUSTOM_FONT_STYLE_ID = 'esi-custom-font-style';

  function _safeGetLocalStorageFont() {
    try {
      return localStorage.getItem('font');
    } catch (_err) {
      return null;
    }
  }

  function _cleanFontValue(value) {
    return String(value || '').trim();
  }
  function _safeGetLocalStorageCustomFontCss() {
    try {
      return localStorage.getItem('esi_custom_font_css');
    } catch (_err) {
      return null;
    }
  }
  function _removeCustomFontCss() {
    var existing = document.getElementById(_CUSTOM_FONT_STYLE_ID);
    if (existing) existing.remove();
  }
  function _injectCustomFontCss() {
    var css = _safeGetLocalStorageCustomFontCss();
    if (!css) {
      _removeCustomFontCss();
      return;
    }
    css = String(css).replace(
      /\[data-font="custom"\]/g,
      'html[data-font="custom"]'
    );
    var existing = document.getElementById(_CUSTOM_FONT_STYLE_ID);
    if (existing) existing.remove();
    var style = document.createElement('style');
    style.id = _CUSTOM_FONT_STYLE_ID;
    style.textContent = css;
    (document.head || document.documentElement).appendChild(style);
  }

  function _normalizeStylesheetHref(href) {
    var value = String(href || '').trim();
    if (!value) return '';
    if (/^(?:https?:)?\/\//i.test(value)) return value;
    if (value.charAt(0) === '/') return value;
    return '/' + value.replace(/^\/+/, '');
  }
  function _deriveFontStylesheetFromValue(fontValue) {
    var value = _cleanFontValue(fontValue);
    if (!value || value === 'custom') return '';
    if (!/^[a-z0-9_-]+$/i.test(value)) return '';
    return '/css/fonts/' + value + '.css';
  }

  function _requestAppearanceCatalogAsync() {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch('/api/appearance-catalog', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then(function (response) {
        if (!response || !response.ok) return null;
        return response.json().catch(function () { return null; });
      })
      .catch(function () { return null; });
  }

  function _normalizeBuiltInFonts(rawFonts) {
    if (!Array.isArray(rawFonts)) return [];
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < rawFonts.length; i++) {
      var item = rawFonts[i];
      if (!item || typeof item !== 'object') continue;
      var value = _cleanFontValue(item.value);
      if (!value || value === 'custom') continue;
      if (seen[value]) continue;
      var stylesheet = _normalizeStylesheetHref(item.stylesheet);
      if (!stylesheet) continue;
      var label = String(item.label || value).trim() || value;
      seen[value] = true;
      out.push({
        value: value,
        label: label,
        stylesheet: stylesheet,
      });
    }
    return out;
  }

  function _loadCatalogAsync() {
    if (_catalogReady) return Promise.resolve(_catalogFonts);
    if (_catalogPromise) return _catalogPromise;
    _catalogPromise = _requestAppearanceCatalogAsync()
      .then(function (payload) {
        _catalogFonts = [];
        _defaultOptionLabel = String(FONT_DEFAULTS.defaultOptionLabel || '').trim() || 'Cinzel & Crimson Pro';
        if (payload && typeof payload === 'object') {
          var payloadDefaultLabel = String(payload.fontDefaultOptionLabel || '').trim();
          if (payloadDefaultLabel) _defaultOptionLabel = payloadDefaultLabel;
          _catalogFonts = _normalizeBuiltInFonts(payload.fonts);
        }
        _catalogReady = true;
        _catalogPromise = null;
        return _catalogFonts;
      })
      .catch(function () {
        _catalogFonts = [];
        _defaultOptionLabel = String(FONT_DEFAULTS.defaultOptionLabel || '').trim() || 'Cinzel & Crimson Pro';
        _catalogReady = true;
        _catalogPromise = null;
        return _catalogFonts;
      });
    return _catalogPromise;
  }

  function _getCatalogFonts() {
    _loadCatalogAsync();
    return _catalogFonts;
  }

  function _findBuiltInFontByValue(value) {
    var target = _cleanFontValue(value);
    if (!target) return null;
    var fonts = _getCatalogFonts();
    for (var i = 0; i < fonts.length; i++) {
      var font = fonts[i] || {};
      if (_cleanFontValue(font.value) !== target) continue;
      return font;
    }
    return null;
  }

  function _isStoredFontUsable(value) {
    var target = _cleanFontValue(value);
    if (!target) return false;
    if (target === 'custom') return true;
    if (!_catalogReady) return true;
    if (_findBuiltInFontByValue(target)) return true;
    return !!_deriveFontStylesheetFromValue(target);
  }

  function getBuiltInFonts() {
    return _getCatalogFonts().map(function (font) {
      return {
        value: font.value,
        label: font.label,
        stylesheet: font.stylesheet,
      };
    });
  }

  function getDefaultOptionLabel() {
    _loadCatalogAsync();
    return _defaultOptionLabel;
  }

  function getBaseFont() {
    return _cleanFontValue(FONT_DEFAULTS.baseFont);
  }

  function getFontLabel(fontValue) {
    var target = _cleanFontValue(fontValue);
    if (!target) return getDefaultOptionLabel();
    var builtIn = _findBuiltInFontByValue(target);
    if (builtIn && builtIn.label) return String(builtIn.label);
    return target;
  }

  function resolveDefaultFont() {
    return getBaseFont();
  }

  function resolveFontFromStorageOrDefault() {
    var stored = _cleanFontValue(_safeGetLocalStorageFont());
    if (_isStoredFontUsable(stored)) return stored;
    return getBaseFont();
  }

  function resolveFontSelectValue() {
    var stored = _cleanFontValue(_safeGetLocalStorageFont());
    if (_isStoredFontUsable(stored)) return stored;
    return '';
  }

  function ensureBuiltInFontStylesLoaded() {
    var head = document.head || document.getElementsByTagName('head')[0];
    if (!head) return;

    function ensureLink(stylesheet, value) {
      var href = _normalizeStylesheetHref(stylesheet);
      if (!href) return;
      var existingLinks = head.querySelectorAll('link[data-built-in-font-css]');
      for (var i = 0; i < existingLinks.length; i++) {
        var existing = existingLinks[i];
        var existingValue = _cleanFontValue(existing.getAttribute('data-built-in-font-css'));
        if (value && existingValue === value) {
          if (existing.getAttribute('href') !== href) existing.setAttribute('href', href);
          head.appendChild(existing);
          return;
        }
        if (_normalizeStylesheetHref(existing.getAttribute('href')) === href) {
          if (value) existing.setAttribute('data-built-in-font-css', value);
          head.appendChild(existing);
          return;
        }
      }
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-built-in-font-css', value || 'font');
      head.appendChild(link);
    }

    var activeFont = _cleanFontValue(document.documentElement.getAttribute('data-font'));
    if (!activeFont) activeFont = _cleanFontValue(_safeGetLocalStorageFont());
    if (activeFont && activeFont !== 'custom') {
      ensureLink(_deriveFontStylesheetFromValue(activeFont), activeFont);
    }

    var cachedFonts = _catalogFonts;
    for (var j = 0; j < cachedFonts.length; j++) {
      var font = cachedFonts[j];
      if (!font || !font.stylesheet) continue;
      ensureLink(font.stylesheet, _cleanFontValue(font.value));
    }

    _loadCatalogAsync().then(function (fonts) {
      if (!Array.isArray(fonts)) return;
      for (var k = 0; k < fonts.length; k++) {
        var entry = fonts[k];
        if (!entry || !entry.stylesheet) continue;
        ensureLink(entry.stylesheet, _cleanFontValue(entry.value));
      }
    });
  }

  function applyInitialFont() {
    var resolved = resolveFontFromStorageOrDefault();
    if (resolved) document.documentElement.setAttribute('data-font', resolved);
    else document.documentElement.removeAttribute('data-font');
    if (resolved === 'custom') _injectCustomFontCss();
    else _removeCustomFontCss();
    ensureBuiltInFontStylesLoaded();
    return resolved;
  }

  window.FontConfig = Object.freeze({
    getBuiltInFonts: getBuiltInFonts,
    getDefaultOptionLabel: getDefaultOptionLabel,
    getBaseFont: getBaseFont,
    getFontLabel: getFontLabel,
    resolveDefaultFont: resolveDefaultFont,
    resolveFontFromStorageOrDefault: resolveFontFromStorageOrDefault,
    resolveFontSelectValue: resolveFontSelectValue,
    ensureBuiltInFontStylesLoaded: ensureBuiltInFontStylesLoaded,
    applyInitialFont: applyInitialFont,
    whenReady: _loadCatalogAsync,
  });
})();
