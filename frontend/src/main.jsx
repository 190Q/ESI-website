import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Import all CSS (Vite bundles these into a single file)
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
  if (window.ThemeColors && window.ThemeColors.invalidateCache) window.ThemeColors.invalidateCache();
  window.dispatchEvent(new Event('themechange'));
  if (name === prev) return `Theme already set to '${name || 'default'}'`;
  return `Theme changed: '${prev || 'default'}' → '${name || 'default'}'`;
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
