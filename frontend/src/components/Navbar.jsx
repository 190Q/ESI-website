import { DiscordIcon, HelpIcon } from './Icons'
import { resolveThemeImageKey } from '../themeImages'

export default function Navbar() {
  const emblemSrc = resolveThemeImageKey('guild-emblem-navbar', '/images/guild_emblem.avif')
  return (
    <header className="navbar">
      <div className="navbar-left">
        <div className="guild-logo">
          <img src={emblemSrc} data-theme-img-key="guild-emblem-navbar" alt="ESI Emblem" className="emblem-img" />
          <div className="guild-title">
            <span className="guild-acronym">ESI</span>
            <span className="guild-fullname">Empire of Sindria</span>
          </div>
        </div>
      </div>

      <nav className="navbar-center">
        <span className="navbar-tagline">
          {'꧁⎝ 𓆩༺\u00A0 Dashboard Portal \u00A0༻𓆪 ⎠꧂'}
        </span>
      </nav>

      <div className="navbar-right">
        <button className="btn-help" id="helpBtn" title="Contact Support">
          <HelpIcon />
          Support
        </button>
        <button className="btn-discord" id="loginBtn" style={{ opacity: 0 }}>
          <DiscordIcon />
          Login with Discord
        </button>
      </div>
    </header>
  )
}
