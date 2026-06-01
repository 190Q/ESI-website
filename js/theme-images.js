(function () {
  'use strict';

  /*
   * Theme-aware image replacement.
   *
   * Themes (built-in or custom CSS) can override site images by declaring
   * CSS custom properties with a url() value.  This module reads those
   * properties from the computed style and swaps every matching <img> src,
   * including images inserted dynamically after page load.
   *
   * Example inside a theme CSS file:
   *
   *   [data-theme="purple"] {
   *     --img-guild-emblem-navbar: url('/images/themes/purple/guild_emblem_nav.avif');
   *     --img-guild-emblem-guild:  url('/images/themes/purple/guild_emblem_card.avif');
   *     --img-aspect-icon:         url('/images/themes/purple/aspect_icon.avif');
   *     --img-point-icon-player:   url('/images/themes/purple/player_point_icon.png');
   *   }
   *
   * Data-URIs work too (handy for self-contained custom themes):
   *
   *   --img-point-icon: url(data:image/png;base64,...);
   */
  /* Shared CSS variable name  ->  default image path */
  var PATH_VARS = {
    '--img-guild-emblem':           '/images/guild_emblem.avif',
    '--img-aspect-icon':            '/images/aspect_icon.avif',
    '--img-point-icon':             '/images/point_icon.png',
    '--img-territory-icon':         '/images/territory_icon.png',
    '--img-medal-allegiance':       '/images/medals/allegiance.png',
    '--img-medal-benevolence':      '/images/medals/benevolence.png',
    '--img-medal-brilliance':       '/images/medals/brilliance.png',
    '--img-medal-fellowship':       '/images/medals/fellowship.png',
    '--img-medal-inspiration':      '/images/medals/inspiration.png',
    '--img-medal-order-of-sindria': '/images/medals/order_of_sindria.png',
    '--img-medal-sindrian-eagle':   '/images/medals/sindrian_eagle.png',
    '--img-medal-valliance':        '/images/medals/valliance.png',
  };
  /*
   * Context-specific image targets selected via data-theme-img-key.
   * Each key can define a fallback chain of CSS variables.
   */
  var KEYED_TARGETS = {
    'guild-emblem-navbar': {
      defaultPath: '/images/guild_emblem.avif',
      vars: ['--img-guild-emblem-navbar', '--img-guild-emblem'],
    },
    'guild-emblem-guild': {
      defaultPath: '/images/guild_emblem.avif',
      vars: ['--img-guild-emblem-guild', '--img-guild-emblem'],
    },
    'aspect-icon-player': {
      defaultPath: '/images/aspect_icon.avif',
      vars: ['--img-aspect-icon-player', '--img-aspect-icon'],
    },
    'aspect-icon-guild': {
      defaultPath: '/images/aspect_icon.avif',
      vars: ['--img-aspect-icon-guild', '--img-aspect-icon'],
    },
    'point-icon-player': {
      defaultPath: '/images/point_icon.png',
      vars: ['--img-point-icon-player', '--img-point-icon'],
    },
    'point-icon-guild': {
      defaultPath: '/images/point_icon.png',
      vars: ['--img-point-icon-guild', '--img-point-icon'],
    },
  };

  /* Reverse lookup: default path -> any shared CSS variable name */
  var _pathToVar = {};
  for (var v in PATH_VARS) _pathToVar[PATH_VARS[v]] = v;

  /* Cache (invalidated on every theme switch) */
  var _cachedTheme = null;
  var _cachedOverrides = null;
  var _cachedHasAny = false;

  /** Extract the raw URL string from a CSS url() value. */
  function _parseUrl(raw) {
    var t = (raw || '').trim();
    if (!t) return '';
    var m = t.match(/^url\(\s*(['"]?)(.*?)\1\s*\)$/);
    return m ? m[2] : '';
  }

  function _isValidReplacementUrl(url) {
    return !!(url && (url.charAt(0) === '/' || /^https?:/.test(url) || /^data:/.test(url)));
  }

  function _pickFirstDefinedUrl(style, varNames) {
    for (var i = 0; i < varNames.length; i++) {
      var varName = varNames[i];
      var rawValue = (style.getPropertyValue(varName) || '').trim();
      var parsed = _parseUrl(rawValue);
      if (_isValidReplacementUrl(parsed)) return parsed;
    }
    return '';
  }

  function _currentTheme() {
    return document.documentElement.getAttribute('data-theme') || '';
  }

  /** Build (and cache) the override map for the active theme. */
  function _getOverrides() {
    var current = _currentTheme();
    if (_cachedOverrides !== null && _cachedTheme === current) return _cachedOverrides;
    _cachedTheme = current;
    _cachedOverrides = { byPath: {}, byKey: {} };
    _cachedHasAny = false;

    if (!current) return _cachedOverrides;

    var s = getComputedStyle(document.documentElement);
    for (var varName in PATH_VARS) {
      var url = _parseUrl((s.getPropertyValue(varName) || '').trim());
      if (_isValidReplacementUrl(url)) {
        _cachedOverrides.byPath[PATH_VARS[varName]] = url;
        _cachedHasAny = true;
      }
    }

    for (var key in KEYED_TARGETS) {
      var cfg = KEYED_TARGETS[key];
      var keyedUrl = _pickFirstDefinedUrl(s, cfg.vars || []);
      if (keyedUrl) {
        _cachedOverrides.byKey[key] = keyedUrl;
        _cachedHasAny = true;
      }
    }
    return _cachedOverrides;
  }

  function _invalidateCache() {
    _cachedTheme = null;
    _cachedOverrides = null;
    _cachedHasAny = false;
  }

  function _resolvePath(defaultPath) {
    var basePath = defaultPath || '';
    if (!basePath) return basePath;
    var overrides = _getOverrides();
    return overrides.byPath[basePath] || basePath;
  }

  function _resolveKey(key, fallbackPath) {
    var cfg = KEYED_TARGETS[key];
    var basePath = fallbackPath || (cfg && cfg.defaultPath) || '';
    if (!cfg) return _resolvePath(basePath);
    var overrides = _getOverrides();
    return overrides.byKey[key] || overrides.byPath[basePath] || basePath;
  }
  function _updateKeyedImg(img, overrides, key) {
    var cfg = KEYED_TARGETS[key];
    if (!cfg) return false;

    var basePath = cfg.defaultPath || img.dataset.themeOriginal || (img.getAttribute('src') || '');
    if (basePath && img.dataset.themeOriginal !== basePath) {
      img.dataset.themeOriginal = basePath;
    }
    var replacement = overrides.byKey[key] || overrides.byPath[basePath];
    var target = replacement || basePath;
    if (target && img.getAttribute('src') !== target) img.src = target;
    return true;
  }

  /** Update a single <img> element. */
  function _updateImg(img, overrides) {
    var key = img.dataset.themeImgKey;
    if (key && _updateKeyedImg(img, overrides, key)) return;
    var src = img.getAttribute('src') || '';
    var original = img.dataset.themeOriginal || src;
    if (!(original in _pathToVar)) return;
    if (!img.dataset.themeOriginal) img.dataset.themeOriginal = original;
    var replacement = overrides.byPath[original];
    var target = replacement || original;
    if (img.getAttribute('src') !== target) img.src = target;
  }

  /** Walk the full DOM and apply the current overrides. */
  function applyAll() {
    _invalidateCache();
    var overrides = _getOverrides();
    var imgs = document.querySelectorAll('img');
    for (var i = 0; i < imgs.length; i++) _updateImg(imgs[i], overrides);
  }

  /* MutationObserver for dynamically inserted images */
  var _observer = new MutationObserver(function (mutations) {
    if (!_currentTheme()) return;
    var overrides = _getOverrides();
    if (!_cachedHasAny) return;

    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) {
        var node = added[j];
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'IMG') _updateImg(node, overrides);
        var nested = node.querySelectorAll ? node.querySelectorAll('img') : [];
        for (var n = 0; n < nested.length; n++) _updateImg(nested[n], overrides);
      }
    }
  });

  _observer.observe(document.documentElement, { childList: true, subtree: true });

  /* Auto-apply on theme change */
  window.addEventListener('themechange', applyAll);

  /* Initial apply */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { if (_currentTheme()) applyAll(); });
  } else {
    if (_currentTheme()) applyAll();
  }

  /* Public API */
  window.ThemeImages = Object.freeze({
    VARS: PATH_VARS,
    KEYED_TARGETS: KEYED_TARGETS,
    /** Resolve a shared default image path to its themed URL (if overridden). */
    resolvePath: _resolvePath,
    /** Resolve a keyed image target to its themed URL (if overridden). */
    resolveKey: _resolveKey,
    /** Force a full DOM re-scan (called automatically on themechange). */
    applyAll: applyAll,
    /** Drop the internal cache (useful after injecting custom CSS). */
    invalidateCache: _invalidateCache,
  });
})();
