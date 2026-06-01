(function () {
  'use strict';

  /*
   * Built-in themes:
   * - Add one entry per theme here.
   * - Put each theme CSS in its own file (for example: /css/themes/<name>.css).
   * - The settings dropdown and stylesheet loader both read from this catalog.
   */
  var BUILT_IN_THEMES = [
    { value: 'purple', label: 'Purple', stylesheet: '/css/themes/purple.css' },
  ];

  /*
   * Default theme behavior:
   * - baseTheme: the fallback default theme.
   *   Use '' to keep :root (Empire of Sindria).
   */
  var THEME_DEFAULTS = {
    baseTheme: '',
    defaultOptionLabel: 'Default',
  };

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

  function _findBuiltInThemeByValue(value) {
    var target = _cleanThemeValue(value);
    if (!target) return null;
    for (var i = 0; i < BUILT_IN_THEMES.length; i++) {
      var theme = BUILT_IN_THEMES[i] || {};
      if (_cleanThemeValue(theme.value) !== target) continue;
      return theme;
    }
    return null;
  }

  function _isStoredThemeUsable(value) {
    var target = _cleanThemeValue(value);
    if (!target) return false;
    if (target === 'custom') return true;
    return !!_findBuiltInThemeByValue(target);
  }

  function getBuiltInThemes() {
    return BUILT_IN_THEMES.map(function (theme) {
      return {
        value: theme.value,
        label: theme.label,
        stylesheet: theme.stylesheet,
      };
    });
  }

  function getDefaultOptionLabel() {
    return String(THEME_DEFAULTS.defaultOptionLabel || '').trim() || 'Default';
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

    var loaded = {};
    var existingLinks = head.querySelectorAll('link[data-built-in-theme-css]');
    for (var i = 0; i < existingLinks.length; i++) {
      var href = existingLinks[i].getAttribute('href');
      if (href) loaded[href] = existingLinks[i];
    }

    for (var j = 0; j < BUILT_IN_THEMES.length; j++) {
      var theme = BUILT_IN_THEMES[j];
      if (!theme || !theme.stylesheet) continue;
      var link = loaded[theme.stylesheet];
      if (!link) {
        link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = theme.stylesheet;
      }
      link.setAttribute('data-built-in-theme-css', theme.value || 'theme');
      head.appendChild(link);
      loaded[theme.stylesheet] = link;
    }
  }

  function applyInitialTheme(date) {
    ensureBuiltInThemeStylesLoaded();
    var resolved = resolveThemeFromStorageOrDefault(date);
    if (resolved) document.documentElement.setAttribute('data-theme', resolved);
    else document.documentElement.removeAttribute('data-theme');
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
  });
})();
