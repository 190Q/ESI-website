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
  document.documentElement.setAttribute('data-theme', name);
  localStorage.setItem('theme', name);
};

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
