(function () {
  function _safeGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (_err) {
      return null;
    }
  }

  function _setAttrFromStorage(storageKey, attrName) {
    var value = _safeGet(storageKey);
    if (value) {
      document.documentElement.setAttribute(attrName, value);
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

  _setAttrFromStorage('theme', 'data-theme');
  _setAttrFromStorage('font', 'data-font');

  if (_safeGet('theme') === 'custom') _injectCustomCss('theme');
  if (_safeGet('font') === 'custom') _injectCustomCss('font');
})();
