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
const fontConfig = (typeof window !== 'undefined' && window.FontConfig) ? window.FontConfig : null;
if (themeConfig && typeof themeConfig.ensureBuiltInThemeStylesLoaded === 'function') {
  themeConfig.ensureBuiltInThemeStylesLoaded();
}
if (fontConfig && typeof fontConfig.ensureBuiltInFontStylesLoaded === 'function') {
  fontConfig.ensureBuiltInFontStylesLoaded();
}

function resolveBaseThemeName() {
  if (themeConfig && typeof themeConfig.getBaseTheme === 'function') {
    return themeConfig.getBaseTheme() || '';
  }
  return '';
}

function isKnownThemeValue(rawValue) {
  const value = (rawValue || '').trim();
  if (!value) return false;
  if (value === 'custom') return true;
  if (!themeConfig || typeof themeConfig.getBuiltInThemes !== 'function') return true;
  const builtIns = themeConfig.getBuiltInThemes();
  if (!Array.isArray(builtIns)) return false;
  for (let i = 0; i < builtIns.length; i++) {
    const entry = builtIns[i] || {};
    if ((entry.value || '').trim() === value) return true;
  }
  return false;
}

function resolveThemeFromStorageOrDefault() {
  if (themeConfig && typeof themeConfig.resolveThemeFromStorageOrDefault === 'function') {
    return themeConfig.resolveThemeFromStorageOrDefault(new Date()) || '';
  }
  const saved = (localStorage.getItem('theme') || '').trim();
  if (isKnownThemeValue(saved)) return saved;
  return resolveBaseThemeName();
}

function resolveBaseFontName() {
  if (fontConfig && typeof fontConfig.getBaseFont === 'function') {
    return fontConfig.getBaseFont() || '';
  }
  return '';
}

function isKnownFontValue(rawValue) {
  const value = (rawValue || '').trim();
  if (!value) return false;
  if (value === 'custom') return true;
  if (!fontConfig || typeof fontConfig.getBuiltInFonts !== 'function') return true;
  const builtIns = fontConfig.getBuiltInFonts();
  if (!Array.isArray(builtIns)) return false;
  for (let i = 0; i < builtIns.length; i++) {
    const entry = builtIns[i] || {};
    if ((entry.value || '').trim() === value) return true;
  }
  return false;
}

function resolveFontFromStorageOrDefault() {
  if (fontConfig && typeof fontConfig.resolveFontFromStorageOrDefault === 'function') {
    return fontConfig.resolveFontFromStorageOrDefault() || '';
  }
  const saved = (localStorage.getItem('font') || '').trim();
  if (isKnownFontValue(saved)) return saved;
  return resolveBaseFontName();
}

// Theme switcher (call setTheme('name') in the DevTools console)
const initialTheme = resolveThemeFromStorageOrDefault();
if (initialTheme) document.documentElement.setAttribute('data-theme', initialTheme);
else document.documentElement.removeAttribute('data-theme');

// Font switcher (call setFont('name') in the DevTools console)
const savedFont = resolveFontFromStorageOrDefault();
if (savedFont) document.documentElement.setAttribute('data-font', savedFont);
else document.documentElement.removeAttribute('data-font');

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
  if (!nextRequested) {
    localStorage.removeItem('theme');
  } else {
    localStorage.setItem('theme', nextRequested);
  }
  const resolvedDefault = resolveThemeFromStorageOrDefault();
  if (resolvedDefault) document.documentElement.setAttribute('data-theme', resolvedDefault);
  else document.documentElement.removeAttribute('data-theme');
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
  const prev = document.documentElement.getAttribute('data-font') || '';
  if (name === undefined || name === null) return `Current font: ${prev || 'default'}`;
  const nextRequested = (name || '').trim();
  if (!nextRequested) {
    localStorage.removeItem('font');
  } else {
    localStorage.setItem('font', nextRequested);
  }
  const resolvedDefault = resolveFontFromStorageOrDefault();
  if (resolvedDefault) document.documentElement.setAttribute('data-font', resolvedDefault);
  else document.documentElement.removeAttribute('data-font');
  const current = document.documentElement.getAttribute('data-font') || '';
  if (current === 'custom') window._injectCustomCSS('font');
  else window._removeCustomCSS('font');
  if (window.FontConfig && typeof window.FontConfig.ensureBuiltInFontStylesLoaded === 'function') {
    window.FontConfig.ensureBuiltInFontStylesLoaded();
  }
  if (current === prev) return `Font already set to '${current || 'default'}'`;
  return `Font changed: '${prev || 'default'}' → '${current || 'default'}'`;
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
