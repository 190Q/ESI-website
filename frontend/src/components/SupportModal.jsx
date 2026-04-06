import { DiscordIcon, TicketIcon, GitHubIcon } from './Icons'

export default function SupportModal() {
  return (
    <div className="modal-backdrop" id="modalBackdrop">
      <div className="modal" id="supportModal">
        <button className="modal-close" id="modalClose">{'\u2715'}</button>

        {/* Links view */}
        <div id="supportLinksView">
          <div className="modal-emblem">
            <img src="images/guild_emblem.avif" alt="ESI" />
          </div>
          <h2 className="modal-title">Contact Support</h2>
          <p className="modal-sub" style={{ fontWeight: 500 }}>
            Get in touch with members of the Empire of Sindria
          </p>
          <ul className="support-links">
            <li>
              <a href="https://discord.gg/sindria" target="_blank" rel="noopener" className="support-link discord">
                <DiscordIcon />
                Join our Discord
              </a>
            </li>
            <li>
              <a href="#" className="support-link ticket" id="openTicketBtn">
                <TicketIcon />
                Open a Support Ticket
              </a>
            </li>
            <li>
              <a href="https://github.com/190Q/ESI-website" target="_blank" rel="noopener" className="support-link github">
                <GitHubIcon />
                View this project on GitHub
              </a>
            </li>
          </ul>
        </div>

        {/* Ticket form view */}
        <div id="ticketFormView" style={{ display: 'none' }}>
          <h2 className="modal-title">Open a Ticket</h2>
          <p className="modal-sub">Describe your issue and we{"'"}ll get back to you</p>
          <div className="ticket-form">
            <label className="ticket-label" htmlFor="ticketCategory">Category</label>
            <select className="ticket-select" id="ticketCategory" aria-label="Ticket category" defaultValue="">
              <option value="">Select a category...</option>
              <option value="bug">Bug Report</option>
              <option value="suggestion">Suggestion</option>
              <option value="help">Help</option>
              <option value="other">Other</option>
            </select>
            <label className="ticket-label" htmlFor="ticketSubject">Subject</label>
            <input
              type="text"
              className="ticket-input"
              id="ticketSubject"
              placeholder="Brief summary..."
              aria-label="Ticket subject"
            />
            <label className="ticket-label" htmlFor="ticketMessage">Message</label>
            <textarea
              className="ticket-textarea"
              id="ticketMessage"
              rows="4"
              placeholder="Describe your issue or suggestion in detail..."
              aria-label="Ticket message"
            />
            <div className="ticket-actions">
              <button className="ticket-back" id="ticketBack">{'\u2190'} Back</button>
              <button className="btn-post" id="ticketSubmit">{'\u21AA\u00A0\u00A0'}Submit Ticket</button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
