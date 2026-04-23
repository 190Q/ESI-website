import { DiscordIcon, TicketIcon, GitHubIcon } from './Icons'

export default function SupportModal() {
  return (
    <div className="modal-backdrop" id="modalBackdrop">
      <div className="modal" id="supportModal">
        <button className="modal-close" id="modalClose">{'\u2715'}</button>

        {/* Links view */}
        <div id="supportLinksView">
          <div className="modal-emblem">
            <img src="/images/guild_emblem.avif" alt="ESI" />
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
              <div className="ticket-editor">
                <div className="ticket-tabs">
                  <button type="button" className="ticket-tab active" id="tabWrite" data-tab="write">Write</button>
                  <button type="button" className="ticket-tab" id="tabPreview" data-tab="preview">Preview</button>
                </div>
                <div className="ticket-write-pane" id="ticketWritePane">
                  <div className="ticket-slash-dropdown" id="slashDropdown" style={{ display: 'none' }}></div>
                  <textarea
                    className="ticket-textarea ticket-body"
                    id="ticketBody"
                    rows="8"
                    placeholder="Add a description..."
                    aria-label="Ticket description"
                  />
                  <div className="ticket-file-area" id="ticketFileArea">
                    <button type="button" className="ticket-file-btn" id="ticketFileBtn">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M12.5 1a3.5 3.5 0 0 1 .59 6.95L13 8v5.5a2.5 2.5 0 0 1-2.336 2.495L10.5 16h-5a2.5 2.5 0 0 1-2.495-2.336L3 13.5V4a2 2 0 0 1 1.85-1.995L5 2h3.5a.5.5 0 0 1 0 1H5a1 1 0 0 0-.993.883L4 4v9.5a1.5 1.5 0 0 0 1.356 1.493L5.5 15h5a1.5 1.5 0 0 0 1.493-1.356L12 13.5V8a2.5 2.5 0 0 1-2.336-2.495L9.5 5.5v-1a.5.5 0 0 1 1 0v1a1.5 1.5 0 0 0 1.356 1.493L12 7a2.5 2.5 0 0 0 .164-4.995L12.5 2h-1a.5.5 0 0 1 0-1h1z"/></svg>
                      Attach files by dragging &amp; dropping, pasting, or clicking here.
                    </button>
                    <input type="file" id="ticketFileInput" style={{ display: 'none' }} multiple accept="image/*,.pdf,.txt,.log,.json,.csv" />
                  </div>
                </div>
                <div className="ticket-preview-pane" id="ticketPreviewPane" style={{ display: 'none' }}>
                  <div className="ticket-preview-content" id="ticketPreviewContent">
                    <p className="ticket-preview-empty">Nothing to preview</p>
                  </div>
                </div>
              </div>
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
