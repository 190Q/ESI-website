import Navbar from './components/Navbar'
import Sidebar from './components/Sidebar'
import PlayerPanel from './components/PlayerPanel'
import GuildPanel from './components/GuildPanel'
import BotPanel from './components/BotPanel'
import AccountModal from './components/AccountModal'
import SupportModal from './components/SupportModal'
import SettingsModal from './components/SettingsModal'
import LegalModal from './components/LegalModal'
import Footer from './components/Footer'
import useScriptLoader from './useScriptLoader'

export default function App() {
  useScriptLoader()

  return (
    <>
      {/* Navbar */}
      <Navbar />

      {/* Main layout */}
      <div className="layout">
        <Sidebar />

        <main className="content-area" id="contentArea">
          <PlayerPanel />
          <GuildPanel />
          <BotPanel />

          {/* Public events page (General tab) and management panels */}
          <section className="panel" id="panel-events" />
          <section className="panel" id="panel-inactivity" />
          <section className="panel" id="panel-promotions" />
          <section className="panel" id="panel-events-manage" />

          {/* Site-wide footer with legal info and community links */}
          <Footer />
        </main>
      </div>

      {/* Modals */}
      <AccountModal />
      <SupportModal />
      <SettingsModal />
      <LegalModal />
    </>
  )
}
