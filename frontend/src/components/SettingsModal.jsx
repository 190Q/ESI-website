export default function SettingsModal() {
  return (
    <div className="modal-backdrop" id="settingsModalBackdrop">
      <div className="modal settings-modal">
        <button className="modal-close" id="settingsModalClose">{'\u2715'}</button>
        <h2 className="modal-title">Settings</h2>
        <p className="modal-sub" style={{ fontWeight: 500 }}>Customize your dashboard experience</p>

        <div className="settings-body">

          {/* Public settings */}
          <div className="settings-section">
            <div className="settings-section-label">General</div>

            {/* Default player lookup */}
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">Default player lookup</div>
                <div className="settings-row-desc">
                  Pre-fill the username search box when the dashboard loads
                </div>
              </div>
              <div className="settings-row-control">
                <input
                  type="text"
                  className="settings-input"
                  id="settingDefaultPlayer"
                  placeholder="Username..."
                  aria-label="Default player"
                />
              </div>
            </div>

            {/* Default player graph metric */}
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">Default player metric</div>
                <div className="settings-row-desc">
                  Pre-select a metric when the Activity Comparison graph opens
                </div>
              </div>
              <div className="settings-row-control">
                <select className="settings-select" id="settingDefaultMetric" aria-label="Default graph metric">
                  <option value="playtime">Playtime</option>
                  <option value="wars">Wars</option>
                  <option value="guildRaids">Guild Raids</option>
                  <option value="mobsKilled">Mobs Killed</option>
                  <option value="chestsFound">Chests Found</option>
                  <option value="questsDone">Quests Done</option>
                  <option value="totalLevel">Total Level</option>
                  <option value="contentDone">Content Done</option>
                  <option value="dungeons">Dungeons</option>
                  <option value="raids">Raids</option>
                  <option value="worldEvents">World Events</option>
                  <option value="caves">Caves</option>
                </select>
              </div>
            </div>

            {/* Default guild graph metric */}
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">Default guild metric</div>
                <div className="settings-row-desc">
                  Pre-select a metric for the Guild Stats graph
                </div>
              </div>
              <div className="settings-row-control">
                <select className="settings-select" id="settingGuildMetric" aria-label="Guild default metric">
                  <option value="playerCount">Active Players</option>
                  <option value="wars">Wars</option>
                  <option value="guildRaids">Guild Raids</option>
                  <option value="newMembers">New Members</option>
                  <option value="totalMembers">Total Members</option>
                </select>
              </div>
            </div>

            {/* Default player graph range */}
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">Default player range</div>
                <div className="settings-row-desc">
                  Set the default day range for the graph slider (2–60)
                </div>
              </div>
              <div className="settings-row-control settings-range-control">
                <input
                  type="range"
                  className="settings-range"
                  id="settingDefaultRange"
                  min="2"
                  max="60"
                  defaultValue="30"
                  aria-label="Default graph range"
                />
                <span className="settings-range-val" id="settingDefaultRangeVal">30</span>
              </div>
            </div>

            {/* Default guild graph range */}
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">Default guild range</div>
                <div className="settings-row-desc">
                  Set the default day range for the guild graph slider (2–60)
                </div>
              </div>
              <div className="settings-row-control settings-range-control">
                <input
                  type="range"
                  className="settings-range"
                  id="settingGuildRange"
                  min="2"
                  max="60"
                  defaultValue="30"
                  aria-label="Guild default range"
                />
                <span className="settings-range-val" id="settingGuildRangeVal">30</span>
              </div>
            </div>

            {/* Toast notification customization */}
            <div className="settings-row" id="settingToastRow">
              <div className="settings-row-info">
                <div className="settings-row-title">Toast notifications</div>
                <div className="settings-row-desc">
                  Duration, maximum visible, and color scheme
                </div>
              </div>
              <div className="settings-row-control settings-multi-control">
                <div className="settings-inline-group">
                  <input
                    type="number"
                    className="settings-input settings-input-sm"
                    id="settingToastDuration"
                    min="1"
                    max="15"
                    defaultValue="7"
                    aria-label="Toast duration in seconds"
                  />
                  <span className="settings-input-suffix">sec</span>
                </div>
                <div className="settings-inline-group">
                  <label className="settings-inline-label" htmlFor="settingToastMax">Max</label>
                  <input
                    type="number"
                    className="settings-input settings-input-sm"
                    id="settingToastMax"
                    min="1"
                    max="6"
                    defaultValue="3"
                    aria-label="Maximum visible toasts"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Login-required settings */}
          <div className="settings-section" id="settingsLoginSection">
            <div className="settings-section-label">
              Requires Login
            </div>

            {/* Inactivity checker defaults */}
            <div className="settings-row settings-row-login" id="settingInactivityRow">
              <div className="settings-row-info">
                <div className="settings-row-title">Inactivity checker defaults</div>
                <div className="settings-row-desc">
                  Default check type, hours threshold, and starting tab
                </div>
              </div>
              <div className="settings-row-control settings-multi-control">
                <select className="settings-select settings-select-sm" id="settingCheckerType" aria-label="Checker type">
                  <option value="first">First Check</option>
                  <option value="second">Second Check</option>
                </select>
                <div className="settings-inline-group">
                  <input
                    type="number"
                    className="settings-input settings-input-sm"
                    id="settingCheckerHours"
                    min="0"
                    max="10"
                    defaultValue="2"
                    aria-label="Hours threshold"
                  />
                  <span className="settings-input-suffix">hrs</span>
                </div>
                <select className="settings-select settings-select-sm" id="settingCheckerTab" aria-label="Default tab">
                  <option value="inactive">Inactive</option>
                  <option value="acive">Active</option>
                  <option value="exempt">Exempt</option>
                </select>
              </div>
            </div>

            {/* Promotions default tab */}
            <div className="settings-row settings-row-login" id="settingPromotionsRow">
              <div className="settings-row-info">
                <div className="settings-row-title">Promotions default tab</div>
                <div className="settings-row-desc">
                  Choose which promotion track opens first
                </div>
              </div>
              <div className="settings-row-control">
                <select className="settings-select" id="settingPromotionsTab" aria-label="Default promotions tab">
                  <option value="recruiter">Recruiter</option>
                  <option value="captain">Captain</option>
                </select>
              </div>
            </div>

          </div>

        </div>

        <div className="settings-footer">
          <button className="settings-reset-btn" id="settingsResetBtn">Reset to Defaults</button>
          <button className="settings-save-btn" id="settingsSaveBtn" style={{ display: 'none' }}>Save Changes</button>
        </div>
      </div>
    </div>
  )
}
