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
                Open a Ticket
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
          <h2 className="modal-title" style={{ textAlign: 'left' }}>New Issue</h2>
          <p className="modal-sub" style={{ textAlign: 'left', fontWeight: 500 }}>
            Create a new issue to report bugs, request features, or ask questions
          </p>
          <div className="ticket-form">
            <div className="ticket-field">
              <label className="ticket-label" htmlFor="issueTitle">Title</label>
              <input
                type="text"
                className="ticket-input"
                id="issueTitle"
                placeholder="Title"
                aria-label="Ticket title"
              />
            </div>
            <div className="ticket-field">
              <label className="ticket-label" htmlFor="ticketBody">Description</label>
              <textarea
                className="ticket-textarea ticket-body"
                id="ticketBody"
                rows="8"
                placeholder="Add a description..."
                aria-label="Ticket description"
              />
            </div>
            <div className="ticket-field">
              <label className="ticket-label">Labels</label>
              <div className="ticket-labels" id="ticketLabels">
                <button type="button" className="ticket-label-pill" data-label="bug" style={{ '--pill-color': '#d73a4a' }}>bug</button>
                <button type="button" className="ticket-label-pill" data-label="enhancement" style={{ '--pill-color': '#a2eeef' }}>enhancement</button>
                <button type="button" className="ticket-label-pill" data-label="question" style={{ '--pill-color': '#d876e3' }}>question</button>
                <button type="button" className="ticket-label-pill" data-label="documentation" style={{ '--pill-color': '#0075ca' }}>documentation</button>
                <button type="button" className="ticket-label-pill" data-label="help wanted" style={{ '--pill-color': '#008672' }}>help wanted</button>
              </div>
            </div>
            <div className="ticket-actions">
              <button className="ticket-back" id="ticketBack">{'\u2190'} Back</button>
              <button className="btn-post" id="ticketSubmit">Submit new ticket</button>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
