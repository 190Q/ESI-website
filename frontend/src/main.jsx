import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'

// Import all CSS (Vite bundles these into a single file)
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
import '../../css/auth-gate.css'

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
