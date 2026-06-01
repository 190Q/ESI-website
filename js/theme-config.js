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
   * - baseTheme: the real fallback default when no seasonal rule matches.
   *   Use '' to keep :root (Empire of Sindria).
   * - seasonal: first matching rule wins, based on the user's local clock.
   *   Date format is DD-MM and supports year-wrapping ranges (for example: 01-12 to 15-01).
   */
  var THEME_DEFAULTS = {
    baseTheme: '',
    defaultOptionLabel: 'Default',
    baseDefaultOptionLabel: 'Real Default',
    seasonalOptionSuffix: '',
    seasonal: [
      // { start: '01-12', end: '15-01', theme: 'purple' },
      // { start: '01-10', end: '31-10', theme: 'purple' },
    ],
  };
  var THEME_SELECT_VALUES = Object.freeze({
    BASE_DEFAULT: '__base_default__',
    SEASONAL_DEFAULT: '__seasonal_default__',
  });

  function _safeGetLocalStorageTheme() {
    try {
      return localStorage.getItem('theme');
    } catch (_err) {
      return null;
    }
  }

  function _parseMonthDay(raw) {
    var value = String(raw || '').trim();
    var match = value.match(/^(\d{2})-(\d{2})$/);
    if (!match) return null;
    var day = parseInt(match[1], 10);
    var month = parseInt(match[2], 10);
    if (!Number.isFinite(day) || !Number.isFinite(month)) return null;
    if (day < 1 || day > 31) return null;
    if (month < 1 || month > 12) return null;
    return month * 100 + day;
  }

  function _monthDayKey(date) {
    return (date.getMonth() + 1) * 100 + date.getDate();
  }

  function _inMonthDayRange(nowKey, startKey, endKey) {
    if (startKey <= endKey) return nowKey >= startKey && nowKey <= endKey;
    return nowKey >= startKey || nowKey <= endKey;
  }
  function _cleanThemeValue(value) {
    return String(value || '').trim();
  }

  function _findActiveSeasonalRule(date) {
    var now = (date instanceof Date) ? date : new Date();
    if (!Number.isFinite(now.getTime())) now = new Date();
    var nowKey = _monthDayKey(now);

    for (var i = 0; i < THEME_DEFAULTS.seasonal.length; i++) {
      var rule = THEME_DEFAULTS.seasonal[i] || {};
      var theme = _cleanThemeValue(rule.theme);
      if (!theme) continue;
      var startKey = _parseMonthDay(rule.start);
      var endKey = _parseMonthDay(rule.end);
      if (startKey == null || endKey == null) continue;
      if (!_inMonthDayRange(nowKey, startKey, endKey)) continue;
      return {
        start: String(rule.start || ''),
        end: String(rule.end || ''),
        theme: theme,
      };
    }

    return null;
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

  function getBaseDefaultOptionLabel() {
    return String(THEME_DEFAULTS.baseDefaultOptionLabel || '').trim() || 'Real Default';
  }

  function getThemeSelectValues() {
    return {
      BASE_DEFAULT: THEME_SELECT_VALUES.BASE_DEFAULT,
      SEASONAL_DEFAULT: THEME_SELECT_VALUES.SEASONAL_DEFAULT,
    };
  }

  function getThemeLabel(themeValue) {
    var target = _cleanThemeValue(themeValue);
    if (!target) return getDefaultOptionLabel();
    var builtIn = _findBuiltInThemeByValue(target);
    if (builtIn && builtIn.label) return String(builtIn.label);
    return target;
  }

  function getActiveSeasonalTheme(date) {
    var rule = _findActiveSeasonalRule(date);
    return rule ? rule.theme : '';
  }

  function getSeasonalOptionLabel(date) {
    var activeTheme = getActiveSeasonalTheme(date);
    if (!activeTheme) return '';
    var themeLabel = getThemeLabel(activeTheme);
    var suffix = String(THEME_DEFAULTS.seasonalOptionSuffix || '').trim();
    if (!suffix) return themeLabel;
    return themeLabel + ' (' + suffix + ')';
  }

  function resolveDefaultTheme(date) {
    var activeSeasonal = getActiveSeasonalTheme(date);
    if (activeSeasonal) return activeSeasonal;
    return getBaseTheme();
  }

  function resolveThemeFromStorageOrDefault(date) {
    var stored = _cleanThemeValue(_safeGetLocalStorageTheme());
    var activeSeasonal = getActiveSeasonalTheme(date);
    if (stored === THEME_SELECT_VALUES.BASE_DEFAULT) return getBaseTheme();
    if (activeSeasonal) return activeSeasonal;
    if (stored && stored !== THEME_SELECT_VALUES.SEASONAL_DEFAULT) return stored;
    return getBaseTheme();
  }

  function resolveThemeSelectValue(date) {
    var stored = _cleanThemeValue(_safeGetLocalStorageTheme());
    var activeSeasonal = getActiveSeasonalTheme(date);
    if (activeSeasonal) {
      if (stored === THEME_SELECT_VALUES.BASE_DEFAULT) return THEME_SELECT_VALUES.BASE_DEFAULT;
      return THEME_SELECT_VALUES.SEASONAL_DEFAULT;
    }
    if (stored === THEME_SELECT_VALUES.BASE_DEFAULT) return '';
    if (stored === THEME_SELECT_VALUES.SEASONAL_DEFAULT) return '';
    return stored;
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
    getBaseDefaultOptionLabel: getBaseDefaultOptionLabel,
    getThemeSelectValues: getThemeSelectValues,
    getThemeLabel: getThemeLabel,
    getActiveSeasonalTheme: getActiveSeasonalTheme,
    getSeasonalOptionLabel: getSeasonalOptionLabel,
    resolveDefaultTheme: resolveDefaultTheme,
    resolveThemeFromStorageOrDefault: resolveThemeFromStorageOrDefault,
    resolveThemeSelectValue: resolveThemeSelectValue,
    ensureBuiltInThemeStylesLoaded: ensureBuiltInThemeStylesLoaded,
    applyInitialTheme: applyInitialTheme,
  });
})();
