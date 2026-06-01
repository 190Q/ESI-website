(function () {
  'use strict';
  var THEME_DEFAULTS = {
    baseTheme: '',
    defaultOptionLabel: 'Default',
  };
  var _catalogReady = false;
  var _catalogPromise = null;
  var _catalogThemes = [];
  var _defaultOptionLabel = String(THEME_DEFAULTS.defaultOptionLabel || '').trim() || 'Default';

  function _safeGetLocalStorageTheme() {
    try {
      return localStorage.getItem('theme');
    } catch (_err) {
      return null;
    }
  }

  function _cleanThemeValue(value) {
    return String(value || '').trim();
  }
  function _normalizeStylesheetHref(href) {
    var value = String(href || '').trim();
    if (!value) return '';
    if (/^(?:https?:)?\/\//i.test(value)) return value;
    if (value.charAt(0) === '/') return value;
    return '/' + value.replace(/^\/+/, '');
  }
  function _deriveThemeStylesheetFromValue(themeValue) {
    var value = _cleanThemeValue(themeValue);
    if (!value || value === 'custom') return '';
    if (!/^[a-z0-9_-]+$/i.test(value)) return '';
    return '/css/themes/' + value + '.css';
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

  function _normalizeBuiltInThemes(rawThemes) {
    if (!Array.isArray(rawThemes)) return [];
    var out = [];
    var seen = Object.create(null);
    for (var i = 0; i < rawThemes.length; i++) {
      var item = rawThemes[i];
      if (!item || typeof item !== 'object') continue;
      var value = _cleanThemeValue(item.value);
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
    if (_catalogReady) return Promise.resolve(_catalogThemes);
    if (_catalogPromise) return _catalogPromise;
    _catalogPromise = _requestAppearanceCatalogAsync()
      .then(function (payload) {
        _catalogThemes = [];
        _defaultOptionLabel = String(THEME_DEFAULTS.defaultOptionLabel || '').trim() || 'Default';
        if (payload && typeof payload === 'object') {
          var payloadDefaultLabel = String(payload.themeDefaultOptionLabel || '').trim();
          if (payloadDefaultLabel) _defaultOptionLabel = payloadDefaultLabel;
          _catalogThemes = _normalizeBuiltInThemes(payload.themes);
        }
        _catalogReady = true;
        _catalogPromise = null;
        return _catalogThemes;
      })
      .catch(function () {
        _catalogThemes = [];
        _defaultOptionLabel = String(THEME_DEFAULTS.defaultOptionLabel || '').trim() || 'Default';
        _catalogReady = true;
        _catalogPromise = null;
        return _catalogThemes;
      });
    return _catalogPromise;
  }

  function _getCatalogThemes() {
    _loadCatalogAsync();
    return _catalogThemes;
  }

  function _findBuiltInThemeByValue(value) {
    var target = _cleanThemeValue(value);
    if (!target) return null;
    var themes = _getCatalogThemes();
    for (var i = 0; i < themes.length; i++) {
      var theme = themes[i] || {};
      if (_cleanThemeValue(theme.value) !== target) continue;
      return theme;
    }
    return null;
  }

  function _isStoredThemeUsable(value) {
    var target = _cleanThemeValue(value);
    if (!target) return false;
    if (target === 'custom') return true;
    if (!_catalogReady) return true;
    return !!_findBuiltInThemeByValue(target);
  }

  function getBuiltInThemes() {
    return _getCatalogThemes().map(function (theme) {
      return {
        value: theme.value,
        label: theme.label,
        stylesheet: theme.stylesheet,
      };
    });
  }

  function getDefaultOptionLabel() {
    _loadCatalogAsync();
    return _defaultOptionLabel;
  }

  function getBaseTheme() {
    return _cleanThemeValue(THEME_DEFAULTS.baseTheme);
  }

  function getThemeLabel(themeValue) {
    var target = _cleanThemeValue(themeValue);
    if (!target) return getDefaultOptionLabel();
    var builtIn = _findBuiltInThemeByValue(target);
    if (builtIn && builtIn.label) return String(builtIn.label);
    return target;
  }

  function resolveDefaultTheme(date) {
    return getBaseTheme();
  }

  function resolveThemeFromStorageOrDefault(date) {
    var stored = _cleanThemeValue(_safeGetLocalStorageTheme());
    if (_isStoredThemeUsable(stored)) return stored;
    return getBaseTheme();
  }

  function resolveThemeSelectValue(date) {
    var stored = _cleanThemeValue(_safeGetLocalStorageTheme());
    if (_isStoredThemeUsable(stored)) return stored;
    return '';
  }

  function ensureBuiltInThemeStylesLoaded() {
    var head = document.head || document.getElementsByTagName('head')[0];
    if (!head) return;

    function ensureLink(stylesheet, value) {
      var href = _normalizeStylesheetHref(stylesheet);
      if (!href) return;
      var existingLinks = head.querySelectorAll('link[data-built-in-theme-css]');
      for (var i = 0; i < existingLinks.length; i++) {
        var existing = existingLinks[i];
        var existingValue = _cleanThemeValue(existing.getAttribute('data-built-in-theme-css'));
        if (value && existingValue === value) {
          if (existing.getAttribute('href') !== href) existing.setAttribute('href', href);
          return;
        }
        if (_normalizeStylesheetHref(existing.getAttribute('href')) === href) {
          if (value) existing.setAttribute('data-built-in-theme-css', value);
          return;
        }
      }
      var link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.setAttribute('data-built-in-theme-css', value || 'theme');
      head.appendChild(link);
    }

    var activeTheme = _cleanThemeValue(document.documentElement.getAttribute('data-theme'));
    if (!activeTheme) activeTheme = _cleanThemeValue(_safeGetLocalStorageTheme());
    if (activeTheme && activeTheme !== 'custom') {
      ensureLink(_deriveThemeStylesheetFromValue(activeTheme), activeTheme);
    }

    var cachedThemes = _catalogThemes;
    for (var j = 0; j < cachedThemes.length; j++) {
      var theme = cachedThemes[j];
      if (!theme || !theme.stylesheet) continue;
      ensureLink(theme.stylesheet, _cleanThemeValue(theme.value));
    }

    _loadCatalogAsync().then(function (themes) {
      if (!Array.isArray(themes)) return;
      for (var k = 0; k < themes.length; k++) {
        var entry = themes[k];
        if (!entry || !entry.stylesheet) continue;
        ensureLink(entry.stylesheet, _cleanThemeValue(entry.value));
      }
    });
  }

  function applyInitialTheme(date) {
    var resolved = resolveThemeFromStorageOrDefault(date);
    if (resolved) document.documentElement.setAttribute('data-theme', resolved);
    else document.documentElement.removeAttribute('data-theme');
    ensureBuiltInThemeStylesLoaded();
    return resolved;
  }

  window.ThemeConfig = Object.freeze({
    getBuiltInThemes: getBuiltInThemes,
    getDefaultOptionLabel: getDefaultOptionLabel,
    getBaseTheme: getBaseTheme,
    getThemeLabel: getThemeLabel,
    resolveDefaultTheme: resolveDefaultTheme,
    resolveThemeFromStorageOrDefault: resolveThemeFromStorageOrDefault,
    resolveThemeSelectValue: resolveThemeSelectValue,
    ensureBuiltInThemeStylesLoaded: ensureBuiltInThemeStylesLoaded,
    applyInitialTheme: applyInitialTheme,
    whenReady: _loadCatalogAsync,
  });
})();
