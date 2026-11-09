/* Applies the visitor's saved theme and font to the standalone chess pages.
   The pages cannot use inline scripts (CSP), so this replaces the bootstrap
   index.html normally runs in place. */
(function () {
  'use strict';

  var released = false;

  function release() {
    if (released) return;
    released = true;
    document.documentElement.classList.remove('theme-preload');
    var style = document.getElementById('esi-prepaint-hide');
    if (style) style.remove();
  }

  window.chessReleasePreload = release;

  var handled = false;
  try {
    if (window.ThemeConfig && typeof window.ThemeConfig.applyInitialTheme === 'function') {
      // The theme code releases the pre-paint mask once its stylesheet is in.
      window.ThemeConfig.applyInitialTheme();
      handled = true;
    }
    if (window.FontConfig && typeof window.FontConfig.applyInitialFont === 'function') {
      window.FontConfig.applyInitialFont();
    }
  } catch (err) {
    handled = false;
  }

  if (!handled) release();
  window.setTimeout(release, 1500);
})();
