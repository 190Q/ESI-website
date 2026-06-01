(function () {
  function _safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_err) {
      return null;
    }
  }


  function _injectCustomCss(type) {
    var storageKey = type === 'theme' ? 'esi_custom_theme_css' : 'esi_custom_font_css';
    var attr = type === 'theme' ? 'data-theme' : 'data-font';
    var css = _safeGet(storageKey);
    if (!css) return;

    css = css.replace(
      new RegExp('\\[' + attr + '="custom"\\]', 'g'),
      'html[' + attr + '="custom"]'
    );

    var id = 'esi-custom-' + type + '-style';
    var existing = document.getElementById(id);
    if (existing) existing.remove();

    var style = document.createElement('style');
    style.id = id;
    style.textContent = css;
    document.head.appendChild(style);
  }
  var appliedTheme = null;
  if (window.ThemeConfig && typeof window.ThemeConfig.applyInitialTheme === 'function') {
    appliedTheme = window.ThemeConfig.applyInitialTheme();
  } else {
    var storedTheme = _safeGet('theme');
    if (storedTheme) {
      document.documentElement.setAttribute('data-theme', storedTheme);
      appliedTheme = storedTheme;
    } else {
      document.documentElement.removeAttribute('data-theme');
      appliedTheme = '';
    }
  }
  var appliedFont = null;
  if (window.FontConfig && typeof window.FontConfig.applyInitialFont === 'function') {
    appliedFont = window.FontConfig.applyInitialFont();
  } else {
    var storedFont = _safeGet('font');
    if (storedFont) {
      document.documentElement.setAttribute('data-font', storedFont);
      appliedFont = storedFont;
    } else {
      document.documentElement.removeAttribute('data-font');
      appliedFont = '';
    }
  }

  if (appliedTheme === 'custom') _injectCustomCss('theme');
  if (appliedFont === 'custom') _injectCustomCss('font');
})();
