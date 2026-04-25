import { UserIcon, GroupIcon, BotIcon, ClockIcon, TrendIcon, EventIcon, CalendarIcon, SidebarToggleIcon, SettingsIcon } from './Icons'

export default function Sidebar() {
  return (
    <aside className="sidebar" id="sidebar">
      <div className="sidebar-ornament top" />

      <button className="sidebar-toggle" id="sidebarToggle" title="Toggle sidebar">
        <SidebarToggleIcon />
      </button>

      <nav className="sidebar-nav">
        <div className="nav-section">
          <span className="nav-section-label">General</span>
          <ul>
            <li>
              <a href="#" className="nav-item active" data-panel="player">
                <span className="nav-icon"><UserIcon /></span>
                <span className="nav-label">Player Stats</span>
              </a>
            </li>
            <li>
              <a href="#" className="nav-item" data-panel="guild">
                <span className="nav-icon"><GroupIcon /></span>
                <span className="nav-label">Guild Stats</span>
              </a>
            </li>
            <li>
              <a href="#" className="nav-item" data-panel="bot">
                <span className="nav-icon"><BotIcon /></span>
                <span className="nav-label">Bot Panel</span>
              </a>
            </li>
            <li>
              <a href="#" className="nav-item" data-panel="events">
                <span className="nav-icon"><CalendarIcon /></span>
                <span className="nav-label">Events</span>
              </a>
            </li>
          </ul>
        </div>

        {/* Management section, hidden until logged in */}
        <div className="nav-section" id="manageSection" style={{ display: 'none' }}>
          <span className="nav-section-label">Management</span>
          <ul>
            <li>
              <a href="#" className="nav-item" data-panel="inactivity">
                <span className="nav-icon"><ClockIcon /></span>
                <span className="nav-label">Inactivity</span>
              </a>
            </li>
            <li>
              <a href="#" className="nav-item" data-panel="promotions">
                <span className="nav-icon"><TrendIcon /></span>
                <span className="nav-label">Promotions</span>
              </a>
            </li>
            <li>
              <a href="#" className="nav-item" data-panel="events-manage">
                <span className="nav-icon"><EventIcon /></span>
                <span className="nav-label">Manage Events</span>
              </a>
            </li>
          </ul>
        </div>
      </nav>

      <div className="sidebar-bottom">
        <div className="sidebar-ornament bottom" />
        <button className="nav-item sidebar-settings-btn" id="settingsBtn" title="Settings">
          <span className="nav-icon"><SettingsIcon /></span>
          <span className="nav-label">Settings</span>
        </button>
      </div>
    </aside>
  )
}
