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

const themeConfig = (typeof window !== 'undefined' && window.ThemeConfig) ? window.ThemeConfig : null;
if (themeConfig && typeof themeConfig.ensureBuiltInThemeStylesLoaded === 'function') {
  themeConfig.ensureBuiltInThemeStylesLoaded();
}
const themeSelectValues = (themeConfig && typeof themeConfig.getThemeSelectValues === 'function')
  ? themeConfig.getThemeSelectValues()
  : {};
const BASE_DEFAULT_THEME_VALUE = themeSelectValues.BASE_DEFAULT || '__base_default__';
const SEASONAL_DEFAULT_THEME_VALUE = themeSelectValues.SEASONAL_DEFAULT || '__seasonal_default__';

function resolveBaseThemeName() {
  if (themeConfig && typeof themeConfig.getBaseTheme === 'function') {
    return themeConfig.getBaseTheme() || '';
  }
  return '';
}

function resolveDefaultThemeName() {
  if (themeConfig && typeof themeConfig.resolveDefaultTheme === 'function') {
    return themeConfig.resolveDefaultTheme(new Date()) || '';
  }
  return '';
}

function resolveThemeFromStorageOrDefault() {
  if (themeConfig && typeof themeConfig.resolveThemeFromStorageOrDefault === 'function') {
    return themeConfig.resolveThemeFromStorageOrDefault(new Date()) || '';
  }
  const saved = (localStorage.getItem('theme') || '').trim();
  if (saved === BASE_DEFAULT_THEME_VALUE) return resolveBaseThemeName();
  if (saved === SEASONAL_DEFAULT_THEME_VALUE) return resolveDefaultThemeName();
  if (saved) return saved;
  return resolveDefaultThemeName();
}

// Theme switcher (call setTheme('name') in the DevTools console)
const initialTheme = resolveThemeFromStorageOrDefault();
if (initialTheme) document.documentElement.setAttribute('data-theme', initialTheme);
else document.documentElement.removeAttribute('data-theme');

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

if ((document.documentElement.getAttribute('data-theme') || '') === 'custom') window._injectCustomCSS('theme');
if (savedFont === 'custom') window._injectCustomCSS('font');

window.setTheme = (name) => {
  const prev = document.documentElement.getAttribute('data-theme') || '';
  if (name === undefined || name === null) return `Current theme: ${prev || 'default'}`;
  const nextRequested = (name || '').trim();
  if (!nextRequested || nextRequested === SEASONAL_DEFAULT_THEME_VALUE) {
    localStorage.removeItem('theme');
    const resolvedDefault = resolveThemeFromStorageOrDefault();
    if (resolvedDefault) document.documentElement.setAttribute('data-theme', resolvedDefault);
    else document.documentElement.removeAttribute('data-theme');
  } else if (nextRequested === BASE_DEFAULT_THEME_VALUE) {
    localStorage.setItem('theme', BASE_DEFAULT_THEME_VALUE);
    const baseTheme = resolveBaseThemeName();
    if (baseTheme) document.documentElement.setAttribute('data-theme', baseTheme);
    else document.documentElement.removeAttribute('data-theme');
  } else {
    localStorage.setItem('theme', nextRequested);
    const resolvedDefault = resolveThemeFromStorageOrDefault();
    if (resolvedDefault) document.documentElement.setAttribute('data-theme', resolvedDefault);
    else document.documentElement.removeAttribute('data-theme');
  }
  const current = document.documentElement.getAttribute('data-theme') || '';
  if (current === 'custom') window._injectCustomCSS('theme');
  else window._removeCustomCSS('theme');
  if (window.ThemeConfig && typeof window.ThemeConfig.ensureBuiltInThemeStylesLoaded === 'function') {
    window.ThemeConfig.ensureBuiltInThemeStylesLoaded();
  }
  if (window.ThemeColors && window.ThemeColors.invalidateCache) window.ThemeColors.invalidateCache();
  if (window.ThemeImages && window.ThemeImages.invalidateCache) window.ThemeImages.invalidateCache();
  window.dispatchEvent(new Event('themechange'));
  if (current === prev) return `Theme already set to '${current || 'default'}'`;
  return `Theme changed: '${prev || 'default'}' → '${current || 'default'}'`;
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
