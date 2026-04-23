import { DiscordIcon, GitHubIcon } from './Icons'

export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer" id="siteFooter" role="contentinfo">
      <div className="site-footer-ornament" />

      <div className="site-footer-inner">
        <div className="site-footer-col site-footer-brand">
          <div className="site-footer-title">
            <img
              src="/images/guild_emblem.avif"
              alt=""
              className="site-footer-emblem"
              aria-hidden="true"
            />
            <div>
              <div className="site-footer-name">Empire of Sindria</div>
              <div className="site-footer-tagline">Dashboard Portal</div>
            </div>
          </div>
          <p className="site-footer-disclaimer">
            This is a fan-made project created a member of the Empire of Sindria
            guild. It is not affiliated with, endorsed by, or sponsored by
            Wynncraft, Mojang Studios, Microsoft, or any of their subsidiaries.
            All trademarks, game content, and assets are the property of their
            respective owners.
          </p>
        </div>

        <nav className="site-footer-col site-footer-links" aria-label="Legal">
          <span className="site-footer-col-label">Legal</span>
          <ul>
            <li>
              <a
                href="#privacy"
                className="site-footer-link"
                data-legal-tab="privacy"
                id="footerPrivacyLink"
              >
                Privacy Policy
              </a>
            </li>
            <li>
              <a
                href="#terms"
                className="site-footer-link"
                data-legal-tab="terms"
                id="footerTermsLink"
              >
                Terms of Service
              </a>
            </li>
            <li>
              <a
                href="#cookies"
                className="site-footer-link"
                data-legal-tab="cookies"
                id="footerCookiesLink"
              >
                Cookie Policy
              </a>
            </li>
            <li>
              <a
                href="#notice"
                className="site-footer-link"
                data-legal-tab="notice"
                id="footerNoticeLink"
              >
                Legal Notice
              </a>
            </li>
          </ul>
        </nav>

        <nav className="site-footer-col site-footer-links" aria-label="Community">
          <span className="site-footer-col-label">Community</span>
          <ul>
            <li>
              <a
                href="https://discord.gg/sindria"
                target="_blank"
                rel="noopener noreferrer"
                className="site-footer-link site-footer-link-icon"
              >
                <DiscordIcon />
                Discord
              </a>
            </li>
            <li>
              <a
                href="https://github.com/190Q/ESI-website"
                target="_blank"
                rel="noopener noreferrer"
                className="site-footer-link site-footer-link-icon"
              >
                <GitHubIcon />
                GitHub
              </a>
            </li>
            <li>
              <a
                href="mailto:esi.dashboard.support@gmail.com"
                className="site-footer-link"
              >
                Contact
              </a>
            </li>
          </ul>
        </nav>
      </div>

      <div className="site-footer-bottom">
        <span className="site-footer-copy">
          {'\u00A9'} {year} Empire of Sindria. All rights reserved.
        </span>
        <span className="site-footer-meta">
          Made with {'\u2726'} for the guild
        </span>
      </div>
    </footer>
  )
}
