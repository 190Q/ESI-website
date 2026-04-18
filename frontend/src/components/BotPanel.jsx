import LoadingState, { ErrorState } from './LoadingState'
import CollapsibleCard from './CollapsibleCard'

export default function BotPanel() {
  return (
    <section className="panel" id="panel-bot">
      <div className="panel-header">
        <h1 className="panel-title">Bot Panel</h1>
        <p className="panel-subtitle">{"Monitor ESI\u2019s unpaid intern"}</p>
      </div>

      <LoadingState id="botLoading" message="Connecting to the bot..." />
      <ErrorState id="botError" />

      <div id="botContent" style={{ display: 'none' }}>

        {/* Bot profile card */}
        <div className="bot-profile-card">
          <div className="bot-avatar-wrap">
            <img id="botAvatar" src="" alt="Bot" className="bot-avatar" />
          </div>
          <div className="bot-info">
            <div className="bot-name-row">
              <span id="botName" className="bot-username" />
              <span id="botIdBadge" className="bot-id-badge" />
            </div>
            <div className="bot-meta-row">
              <span id="botStatusPill" className="status-pill" />
              <span id="botLatency" className="bot-meta-item" />
              <span id="botUptime" className="bot-meta-item" />
            </div>
          </div>
        </div>

        <div className="bot-split-layout">

          {/* Left: Discord + Trackers */}
          <div className="bot-left-col">
            <div className="info-card" id="botGuildSnapshot" />

            <div className="info-card">
              <div className="info-card-header tracker-card-header">
                <span>Tracker Countdowns</span>
                <span className="tracker-header-status">
                  <span className="status-pill online" id="trackerHeaderStatus">{'\u25CF'} Online</span>
                  <span className="tracker-uptime" id="trackerHeaderUptime">0s</span>
                </span>
              </div>
              <div className="tracker-list" id="trackerList" />
            </div>
          </div>

          {/* Right: Database */}
          <div className="bot-right-col">
            <CollapsibleCard label="Database Storage" totalId="dbTotalSize" bodyId="dbContent" />
          </div>

        </div>
      </div>
    </section>
  )
}
