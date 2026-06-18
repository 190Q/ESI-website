import { DiscordIcon, HelpIcon, NavTaglineOrnamentIcon } from './Icons'
import { resolveThemeImageKey } from '../themeImages'

export default function Navbar() {
  const emblemSrc = resolveThemeImageKey('guild-emblem-navbar', '/images/guild_emblem.avif')
  return (
    <header className="navbar">
      <div className="navbar-left">
        <div className="guild-logo">
          <img src={emblemSrc} data-theme-img-key="guild-emblem-navbar" data-theme-original="/images/guild_emblem.avif" alt="ESI Emblem" className="emblem-img" />
          <div className="guild-title">
            <span className="guild-acronym">ESI</span>
            <span className="guild-fullname">Empire of Sindria</span>
          </div>
        </div>
      </div>

      <nav className="navbar-center">
        <span className="navbar-tagline" aria-label="Dashboard Portal">
          <NavTaglineOrnamentIcon side="left" />
          <span className="navbar-tagline-text">Dashboard Portal</span>
          <NavTaglineOrnamentIcon side="right" />
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
