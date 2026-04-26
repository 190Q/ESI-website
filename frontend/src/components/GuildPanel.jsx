import LoadingState, { ErrorState } from './LoadingState'
import CollapsibleCard from './CollapsibleCard'

export default function GuildPanel() {
  return (
    <section className="panel" id="panel-guild">
      <div className="panel-header">
        <h1 className="panel-title">Guild Stats</h1>
        <p className="panel-subtitle">The standing of the Empire of Sindria</p>
      </div>

      <LoadingState id="guildLoading" message="Fetching the Wynncraft API..." />
      <ErrorState id="guildError" />

      <div id="guildContent" style={{ display: 'none' }}>

        {/* Guild profile card */}
        <div className="guild-profile-card">
          <div className="guild-profile-emblem-wrap">
            <img src="/images/guild_emblem.avif" alt="Guild Emblem" className="guild-profile-emblem" />
          </div>
          <div className="guild-profile-info">
            <div className="guild-profile-name-row">
              <span id="guildCardName" className="guild-profile-name" />
              <span id="guildCardPrefix" className="guild-profile-prefix" />
            </div>
            <div className="guild-profile-meta-row">
              <span id="guildCardLevel" className="guild-profile-meta-item" />
              <span id="guildCardOnline" className="status-pill" />
            </div>
            <div className="guild-profile-xp-row" id="guildCardXpRow" />
            <div className="guild-profile-details-row">
              <span id="guildCardMembers" className="guild-profile-detail" />
              <span id="guildCardWars" className="guild-profile-detail" />
              <span id="guildCardFounded" className="guild-profile-detail" />
            </div>
            <div className="guild-profile-owner-row">
              <span id="guildCardOwner" className="guild-profile-owner" />
            </div>
          </div>
        </div>

        <div className="owed-cards" id="guildOwedCards" />

        <div className="guild-split-layout">

          {/* Graph */}
          <div className="graph-panels-col">
            <div className="graph-panel" style={{ position: 'relative', overflow: 'hidden' }}>
              <div className="graph-share-zone" />
              <button className="graph-share-btn" id="guildGraphShareBtn" title="Share graph">{"\uD83D\uDDD2"}</button>
              <div className="graph-panel-header">
                <span>Activity Comparison</span>
                <span className="compare-area">
                  <span className="compare-trigger" id="guildCompareTrigger">𓍝 Compare</span>
                  <span className="compare-input-area" id="guildCompareInputArea" style={{ display: 'none' }}>
                    <label htmlFor="guildComparePlayerInput" className="sr-only">Compare guild member username</label>
                    <input
                      type="text"
                      id="guildComparePlayerInput"
                      className="compare-inline-input"
                      placeholder="Username..."
                      aria-label="Compare guild member username"
                    />
                    <span className="compare-status" id="guildCompareStatus" />
                  </span>
                  <span className="compare-pill" id="guildComparePill" style={{ display: 'none' }}>
                    vs <strong id="guildComparePillName" />
                    <button className="compare-pill-x" id="guildBtnCompareClear">{'\u2715'}</button>
                  </span>
                </span>
              </div>
              <div className="graph-controls">
                <div id="guildGraphMetricRows" />
                <button className="btn-add-metric" id="guildBtnAddMetric">+ Add Metric</button>
                <div className="graph-control-row">
                  <label className="graph-ctrl-label" htmlFor="guildGraphRange">Range</label>
                  <input
                    type="range"
                    id="guildGraphRange"
                    min="2"
                    max="60"
                    defaultValue="30"
                    className="graph-range"
                    aria-label="Guild graph range in days"
                  />
                  <span id="guildGraphDaysLabel" className="graph-days-val">30d</span>
                </div>
              </div>
              <div className="graph-canvas-wrap">
                <canvas id="guildGraphCanvas" />
              </div>
              <div className="graph-legend" id="guildGraphLegend" />
              <div id="guildGraphSummaries" />
            </div>
          </div>

          {/* Views */}
          <div className="guild-views-col">

            <div className="view-selector">
              <button className="view-btn active" id="guildViewGlobal">Global Data</button>
              <button className="view-btn" id="guildViewLogs">Guild Logs</button>
              <button className="view-btn" id="guildViewSnipes" style={{ display: 'none' }}>Snipes</button>
              <button className="view-btn" id="guildViewStatistics">Statistics</button>
            </div>

            {/* Global */}
            <div id="guildGlobalView">
              <div className="global-stats-list" id="guildStatsGrid" />
              <CollapsibleCard
                id="guildRaidsCard"
                style={{ display: 'none' }}
                label="Guild Raids"
                totalId="guildRaidsTotal"
                bodyId="guildRaidsList"
              />
              <CollapsibleCard
                label="Members"
                totalId="guildMembersTotal"
                bodyId="guildMembersList"
              />
            </div>

            {/* Logs */}
            <div id="guildLogsView" style={{ display: 'none' }}>
              <div className="info-card">
                <div className="info-card-header">Recent Guild Activity</div>
                <div id="guildLogsList" />
              </div>
            </div>

            {/* Snipes */}
            <div id="guildSnipesView" style={{ display: 'none' }}>
              <div className="global-stats-list" id="guildSnipesStatsGrid" />
              <CollapsibleCard
                label="Snipers"
                totalId="guildSnipesPlayersTotal"
                bodyId="guildSnipesPlayersList"
              />
              <CollapsibleCard
                label="Recent Snipes"
                totalId="guildSnipesListTotal"
                bodyId="guildSnipesList"
              />
            </div>

            {/* Statistics */}
            <div id="guildStatisticsView" style={{ display: 'none' }}>
              <div className="guild-stats-filters info-card" id="guildStatsFilters">
                <div className="info-card-header">Filters</div>
                <div className="guild-stats-filters-body">
                  <div className="guild-stats-filter-group">
                    <label className="guild-stats-filter-label">Guild Rank</label>
                    <div className="guild-stats-rank-chips" id="guildStatsRankChips" />
                  </div>
                  <div className="guild-stats-filter-group">
                    <label className="guild-stats-filter-label" htmlFor="guildStatsJoinedFrom">Joined From</label>
                    <input type="date" id="guildStatsJoinedFrom" className="guild-stats-date-input" />
                  </div>
                  <div className="guild-stats-filter-group">
                    <label className="guild-stats-filter-label" htmlFor="guildStatsJoinedTo">Joined To</label>
                    <input type="date" id="guildStatsJoinedTo" className="guild-stats-date-input" />
                  </div>
                  <button className="guild-stats-reset-btn" id="guildStatsResetBtn" type="button">Reset</button>
                </div>
                <div className="guild-stats-filter-summary" id="guildStatsFilterSummary" />
              </div>

              <div className="info-card">
                <div className="info-card-header">Rank Distribution</div>
                <div id="guildStatsRankDist" className="guild-stats-rank-dist" />
              </div>

              <div className="info-card">
                <div className="info-card-header">Queue Activity</div>
                <div id="guildStatsQueue" className="guild-stats-block" />
              </div>

              <div className="info-card">
                <div className="info-card-header">Joins / Leaves</div>
                <div id="guildStatsFlow" className="guild-stats-block" />
              </div>

              <div className="info-card">
                <div className="info-card-header">Leaves by Rank</div>
                <div id="guildStatsLeavesByRank" className="guild-stats-rank-dist" />
              </div>

              <div className="info-card">
                <div className="info-card-header">Leaves by Tenure</div>
                <div id="guildStatsLeavesByTenure" className="guild-stats-rank-dist" />
              </div>

              <div className="info-card">
                <div className="info-card-header">Average Per-Member Stats</div>
                <div id="guildStatsAverages" className="guild-stats-averages" />
              </div>

              <div className="info-card">
                <div className="info-card-header" id="guildStatsTopHeader">Top Recruiters</div>
                <div id="guildStatsTopRecruiters" className="guild-stats-leaderboard" />
              </div>
            </div>

          </div>
        </div>
      </div>
    </section>
  )
}
