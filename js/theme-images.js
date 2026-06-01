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
   *     --img-guild-emblem: url('/images/themes/purple/guild_emblem.avif');
   *     --img-aspect-icon:  url('/images/themes/purple/aspect_icon.avif');
   *   }
   *
   * Data-URIs work too (handy for self-contained custom themes):
   *
   *   --img-point-icon: url(data:image/png;base64,...);
   */

  /* CSS variable name  ->  default image path */
  var VARS = {
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

  /* Reverse lookup: default path -> CSS variable name */
  var _pathToVar = {};
  for (var v in VARS) _pathToVar[VARS[v]] = v;

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

  function _currentTheme() {
    return document.documentElement.getAttribute('data-theme') || '';
  }

  /** Build (and cache) the override map for the active theme. */
  function _getOverrides() {
    var current = _currentTheme();
    if (_cachedOverrides !== null && _cachedTheme === current) return _cachedOverrides;
    _cachedTheme = current;
    _cachedOverrides = {};
    _cachedHasAny = false;

    if (!current) return _cachedOverrides;

    var s = getComputedStyle(document.documentElement);
    for (var varName in VARS) {
      var url = _parseUrl((s.getPropertyValue(varName) || '').trim());
      if (url) {
        _cachedOverrides[VARS[varName]] = url;
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

  /** Update a single <img> element. */
  function _updateImg(img, overrides) {
    var src = img.getAttribute('src') || '';
    var original = img.dataset.themeOriginal || src;
    if (!(original in _pathToVar)) return;
    if (!img.dataset.themeOriginal) img.dataset.themeOriginal = original;
    var replacement = overrides[original];
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
    VARS: VARS,
    /** Force a full DOM re-scan (called automatically on themechange). */
    applyAll: applyAll,
    /** Drop the internal cache (useful after injecting custom CSS). */
    invalidateCache: _invalidateCache,
  });
})();
