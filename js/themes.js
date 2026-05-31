(function () {
  'use strict';

  /* Read theme colours from CSS custom properties (cached per theme switch) */
  var _cachedTheme = null;
  var _cachedTC = null;

  function _themeColors() {
    var current = document.documentElement.getAttribute('data-theme') || '';
    if (_cachedTC && _cachedTheme === current) return _cachedTC;
    _cachedTheme = current;
    var s = getComputedStyle(document.documentElement);
    function v(name) { return (s.getPropertyValue(name) || '').trim(); }
    _cachedTC = {
      graphBg:    v('--graph-bg')    || '#111e11',
      graphAxis:  v('--graph-axis')  || '#4A5A3A',
      goldRgb:    v('--gold-rgb')    || '212, 160, 23',
      parchment:  v('--parchment')   || '#0D1A0D',
      gold:       v('--gold')        || '#D4A017',
      goldLight:  v('--gold-light')  || '#F0C040',
      s2:         v('--graph-series-2')       || '#3BA55C',
      s2Rgb:      v('--graph-series-2-rgb')   || '59, 165, 92',
      s2Point:    v('--graph-series-2-point')  || '#5FD87A',
      discord:    v('--discord')          || '#5865F2',
      discordRgb: v('--discord-rgb')      || '88, 101, 242',
      discordLav: v('--discord-lavender') || '#8A94F7',
      danger:     v('--danger')       || '#ED4245',
      dangerRgb:  v('--danger-rgb')   || '237, 66, 69',
      dangerLt:   v('--danger-light') || '#F47373',
    };
    return _cachedTC;
  }

  function getSeriesColors() {
    var tc = _themeColors();
    return [
      { line: tc.gold,    fill: 'rgba(' + tc.goldRgb + ',0.08)',    point: tc.goldLight },
      { line: tc.s2,      fill: 'rgba(' + tc.s2Rgb + ',0.08)',      point: tc.s2Point },
      { line: tc.discord,  fill: 'rgba(' + tc.discordRgb + ',0.08)', point: tc.discordLav },
    ];
  }

  function getOverflowColor() {
    var tc = _themeColors();
    return { line: tc.danger, fill: 'rgba(' + tc.dangerRgb + ',0.08)', point: tc.dangerLt };
  }

  function invalidateCache() {
    _cachedTheme = null;
    _cachedTC = null;
  }

  window.ThemeColors = Object.freeze({
    get: _themeColors,
    getSeriesColors: getSeriesColors,
    getOverflowColor: getOverflowColor,
    invalidateCache: invalidateCache,
  });
})();
