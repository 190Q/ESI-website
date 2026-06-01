import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Import all CSS (Vite bundles these into a single file)
import '../../css/fonts.css'
import '../../css/themes.css'
import '../../css/base.css'
import '../../css/popup.css'
import '../../css/graph-shared.css'
import '../../css/player.css'
import '../../css/guild.css'
import '../../css/bot.css'
import '../../css/inactivity.css'
import '../../css/promotions.css'
import '../../css/events.css'
import '../../css/shop.css'
import '../../css/shop-admin.css'
import '../../css/creator-studio.css'
import '../../css/auth-gate.css'

// Theme switcher (call setTheme('name') in the DevTools console)
const savedTheme = localStorage.getItem('theme');
if (savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);

// Font switcher (call setFont('name') in the DevTools console)
const savedFont = localStorage.getItem('font');
if (savedFont) document.documentElement.setAttribute('data-font', savedFont);

// Custom CSS injection (stored in localStorage, never sent to server)
window._injectCustomCSS = (type) => {
  const id = 'esi-custom-' + type + '-style';
  let el = document.getElementById(id);
  let css = localStorage.getItem('esi_custom_' + type + '_css');
  if (css) {
    // Boost specificity so custom variables override :root regardless of source order
    const attr = type === 'theme' ? 'data-theme' : 'data-font';
    css = css.replace(
      new RegExp('\\[' + attr + '="custom"\\]', 'g'),
      'html[' + attr + '="custom"]'
    );
    if (!el) {
      el = document.createElement('style');
      el.id = id;
    }
    el.textContent = css;
    document.head.appendChild(el); // always (re-)append as last child
  } else if (el) {
    el.remove();
  }
};
window._removeCustomCSS = (type) => {
  const el = document.getElementById('esi-custom-' + type + '-style');
  if (el) el.remove();
};

if (savedTheme === 'custom') window._injectCustomCSS('theme');
if (savedFont === 'custom') window._injectCustomCSS('font');

window.setTheme = (name) => {
  const prev = document.documentElement.getAttribute('data-theme');
  if (name === undefined || name === null) return `Current theme: ${prev || 'default'}`;
  if (name) {
    document.documentElement.setAttribute('data-theme', name);
    localStorage.setItem('theme', name);
  } else {
    document.documentElement.removeAttribute('data-theme');
    localStorage.removeItem('theme');
  }
  if (name === 'custom') window._injectCustomCSS('theme');
  else window._removeCustomCSS('theme');
  if (window.ThemeColors && window.ThemeColors.invalidateCache) window.ThemeColors.invalidateCache();
  if (window.ThemeImages && window.ThemeImages.invalidateCache) window.ThemeImages.invalidateCache();
  window.dispatchEvent(new Event('themechange'));
  if (name === prev) return `Theme already set to '${name || 'default'}'`;
  return `Theme changed: '${prev || 'default'}' → '${name || 'default'}'`;
};

window.setFont = (name) => {
  const prev = document.documentElement.getAttribute('data-font');
  if (name === undefined || name === null) return `Current font: ${prev || 'default'}`;
  if (name) {
    document.documentElement.setAttribute('data-font', name);
    localStorage.setItem('font', name);
  } else {
    document.documentElement.removeAttribute('data-font');
    localStorage.removeItem('font');
  }
  if (name === 'custom') window._injectCustomCSS('font');
  else window._removeCustomCSS('font');
  if (name === prev) return `Font already set to '${name || 'default'}'`;
  return `Font changed: '${prev || 'default'}' → '${name || 'default'}'`;
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
