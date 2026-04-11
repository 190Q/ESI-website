import LoadingState, { ErrorState } from './LoadingState'
import CollapsibleCard from './CollapsibleCard'

export default function PlayerPanel() {
  return (
    <section className="panel active" id="panel-player">
      <div className="panel-header">
        <h1 className="panel-title">Player Stats</h1>
        <p className="panel-subtitle">Live data from the Wynncraft API</p>
      </div>

      {/* Search */}
      <div className="player-search-row">
        <div className="player-search-wrap">
          <label htmlFor="playerInput" className="sr-only">Wynncraft username</label>
          <input
            type="text"
            id="playerInput"
            className="player-search-input"
            placeholder="Enter Wynncraft username..."
            defaultValue=""
            aria-label="Wynncraft username"
          />
          <button className="btn-search" id="searchPlayerBtn">{'\uD83D\uDD0D\uFE0E'} Look Up</button>
        </div>
      </div>

      <LoadingState id="playerLoading" message="Fetching the Wynncraft API..." />
      <ErrorState id="playerError" />

      {/* Player content (hidden until data loads) */}
      <div id="playerContent" style={{ display: 'none' }}>

        {/* Profile card */}
        <div className="profile-card">
          <div className="profile-avatar-wrap">
            <img id="playerSkin" src="" alt="skin" className="profile-skin" />
          </div>
          <div className="profile-info">
            <div className="profile-name-row">
              <span id="playerName" className="profile-username" />
              <span id="playerRankBadge" className="profile-rank-badge" />
            </div>
            <div className="profile-meta-row">
              <span id="playerOnlineStatus" className="status-pill" />
              <span id="playerLastSeen" className="profile-meta-item" />
              <span id="playerFirstJoin" className="profile-meta-item" />
            </div>
            <div className="profile-guild-row">
              <span id="playerGuild" className="profile-guild-tag" />
              <span id="playerGuildRank" className="profile-guild-rank" />
            </div>
            <div className="profile-guild-xp-row" id="guildXpRow" />
          </div>
        </div>

        <div className="player-split-layout">

          {/* Graphs */}
          <div className="graph-panels-col">
            <div className="graph-panel" id="graphPanelCompare" style={{ position: 'relative', overflow: 'hidden' }}>
              <div className="graph-share-zone" />
              <button className="graph-share-btn" id="playerGraphShareBtn" title="Share graph">{"\uD83D\uDDD2"}</button>
              <div className="graph-panel-header">
                <span>Activity Comparison</span>
                <span className="compare-area" id="compareArea">
                  <span className="compare-trigger" id="compareTrigger">𓍝 Compare</span>
                  <span className="compare-input-area" id="compareInputArea" style={{ display: 'none' }}>
                    <label htmlFor="comparePlayerInput" className="sr-only">Compare username</label>
                    <input
                      type="text"
                      id="comparePlayerInput"
                      className="compare-inline-input"
                      placeholder="Username..."
                      aria-label="Compare username"
                    />
                    <span className="compare-status" id="compareStatus" />
                  </span>
                  <span className="compare-pill" id="comparePill" style={{ display: 'none' }}>
                    vs <strong id="comparePillName" />
                    <button className="compare-pill-x" id="btnCompareClear">{'\u2715'}</button>
                  </span>
                </span>
              </div>
              <div className="graph-controls">
                <div id="graphMetricRows" />
                <button className="btn-add-metric" id="btnAddMetric">+ Add Metric</button>
                <div className="graph-control-row">
                  <label className="graph-ctrl-label" htmlFor="graphDaysRange">Range</label>
                  <input
                    type="range"
                    id="graphDaysRange"
                    min="2"
                    max="60"
                    defaultValue="30"
                    className="graph-range"
                    aria-label="Player graph range in days"
                  />
                  <span id="graphDaysLabel" className="graph-days-val">?</span>
                </div>
              </div>
              <div className="graph-canvas-wrap">
                <canvas id="graphCanvas" />
              </div>
              <div className="graph-legend" id="graphLegend" />
              <div id="graphSummaries" />
            </div>
          </div>

          {/* Views */}
          <div className="player-views-col">

            {/* View toggle */}
            <div className="view-selector">
              <button className="view-btn active" id="viewGlobal">Global Data</button>
              <button className="view-btn" id="viewCharacter">Character View</button>
              <button className="view-btn" id="viewRankHistory" style={{ display: 'none' }}>Rank History</button>
            </div>

            {/* Global view */}
            <div id="globalView">
              <div className="owed-cards" id="owedCards" />
              <div className="global-stats-list" id="globalStatsGrid" />
              <CollapsibleCard id="globalRaidsCard" label="Raids" totalId="globalRaidsTotal" bodyId="globalRaids" />
              <CollapsibleCard id="globalDungeonsCard" label="Dungeons" totalId="globalDungeonsTotal" bodyId="globalDungeons" />
            </div>

            {/* Character view */}
            <div id="characterView" style={{ display: 'none' }}>
              <div className="char-selector-row">
                <label className="char-selector-label" htmlFor="charSelect">Character:</label>
                <select id="charSelect" className="char-select" aria-label="Character selection" />
              </div>
              <div id="charDetails" />
            </div>

            {/* Rank history */}
            <div id="rankHistoryView" style={{ display: 'none' }}>
              <div id="rankHistoryContent" />
            </div>

          </div>
        </div>

      </div>
    </section>
  )
}
