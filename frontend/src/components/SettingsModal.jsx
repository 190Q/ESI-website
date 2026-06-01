export default function SettingsModal() {
  return (
    <div className="modal-backdrop" id="settingsModalBackdrop">
      <div className="modal settings-modal">
        <button className="modal-close" id="settingsModalClose">{'\u2715'}</button>
        <h2 className="modal-title">Settings</h2>
        <p className="modal-sub" style={{ fontWeight: 500 }}>Customize your dashboard experience</p>

        <div className="settings-body">

          {/* Appearance */}
          <div className="settings-section">
            <div className="settings-section-label">
              Appearance
              <span className="settings-section-hint">
                Get more themes on the{' '}
                <a href="https://discord.gg/YwnAyzefdV" target="_blank" rel="noopener noreferrer">ESI Dev Discord</a>
              </span>
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">Colour theme</div>
                <div className="settings-row-desc">
                  Switch the dashboard colour scheme
                </div>
              </div>
              <div className="settings-row-control">
                <select className="settings-select" id="settingTheme" aria-label="Colour theme">
                  <option value="">Default</option>
                </select>
              </div>
            </div>

            <div className="settings-add-custom-wrap">
              <button type="button" className="settings-add-custom" id="addCustomThemeBtn">+ Add Custom</button>
              <button type="button" className="settings-add-custom-x" id="removeCustomThemeBtn" style={{ display: 'none' }}>{"\u00d7"}</button>
              <input type="file" id="customThemeFileInput" accept=".css,.zip,image/*" multiple style={{ display: 'none' }} />
            </div>

            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">Font</div>
                <div className="settings-row-desc">
                  Change the typeface used across the dashboard
                </div>
              </div>
              <div className="settings-row-control">
                <select className="settings-select" id="settingFont" aria-label="Font">
                  <option value="">Cinzel &amp; Crimson Pro</option>
                  <option value="inter">Inter</option>
                  <option value="minecraft">Minecraft</option>
                </select>
              </div>
            </div>

            <div className="settings-add-custom-wrap">
              <button type="button" className="settings-add-custom" id="addCustomFontBtn">+ Add Custom</button>
              <button type="button" className="settings-add-custom-x" id="removeCustomFontBtn" style={{ display: 'none' }}>{"\u00d7"}</button>
              <input type="file" id="customFontFileInput" accept=".css,.zip" style={{ display: 'none' }} />
            </div>
          </div>

          {/* Search & Lookup */}
          <div className="settings-section" id="settingsSearchSection">
            <div className="settings-section-label">Search &amp; Lookup</div>

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
                  maxLength={16}
                />
              </div>
            </div>
          </div>

          {/* Graphs & Metrics */}
          <div className="settings-section" id="settingsGraphsSection">
            <div className="settings-section-label">Graphs &amp; Metrics</div>

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
          </div>

          {/* Notifications */}
          <div className="settings-section" id="settingsNotificationsSection">
            <div className="settings-section-label">Notifications</div>

            {/* Toast notifications master toggle */}
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">Toast notifications</div>
                <div className="settings-row-desc">
                  Enable or disable in-app toast notifications entirely
                </div>
              </div>
              <div className="settings-row-control">
                <label className="settings-toggle">
                  <input type="checkbox" id="settingToastsEnabled" aria-label="Enable toast notifications" />
                  <span className="settings-toggle-track" aria-hidden="true">
                    <span className="settings-toggle-thumb"></span>
                  </span>
                </label>
              </div>
            </div>

            {/* Toast notification customization */}
            <div className="settings-row" id="settingToastRow">
              <div className="settings-row-info">
                <div className="settings-row-title">Toast customization</div>
                <div className="settings-row-desc">
                  Duration and maximum visible at once
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
                    maxLength={2}
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
                    maxLength={1}
                    defaultValue="3"
                    aria-label="Maximum visible toasts"
                  />
                </div>
              </div>
            </div>

            {/* Events nav badge toggle */}
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">Events nav badge</div>
                <div className="settings-row-desc">
                  Show the upcoming/ongoing indicator on the Events sidebar button
                </div>
              </div>
              <div className="settings-row-control">
                <label className="settings-toggle">
                  <input type="checkbox" id="settingEventsNavBadge" aria-label="Show events nav badge" />
                  <span className="settings-toggle-track" aria-hidden="true">
                    <span className="settings-toggle-thumb"></span>
                  </span>
                </label>
              </div>
            </div>

            {/* Pinned events banner toggle */}
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">Pinned events banner</div>
                <div className="settings-row-desc">
                  Display the pinned events banner across every page
                </div>
              </div>
              <div className="settings-row-control">
                <label className="settings-toggle">
                  <input type="checkbox" id="settingPinnedBanner" aria-label="Show pinned events banner" />
                  <span className="settings-toggle-track" aria-hidden="true">
                    <span className="settings-toggle-thumb"></span>
                  </span>
                </label>
              </div>
            </div>

            {/* Auction DM opt-out toggle */}
            <div className="settings-row">
              <div className="settings-row-info">
                <div className="settings-row-title">Reduce auction DMs</div>
                <div className="settings-row-desc">
                  Disable low-urgency auction DMs (bid confirmations, ending soon reminders, extension alerts). Critical notifications like outbid, won, and cancelled are always sent.
                </div>
              </div>
              <div className="settings-row-control">
                <label className="settings-toggle">
                  <input type="checkbox" id="settingShopAuctionDmOptOut" aria-label="Reduce auction DMs" />
                  <span className="settings-toggle-track" aria-hidden="true">
                    <span className="settings-toggle-thumb"></span>
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Member Management */}
          <div className="settings-section" id="settingsMemberMgmtSection">
            <div className="settings-section-label">Member Management</div>

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
                    maxLength={2}
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
