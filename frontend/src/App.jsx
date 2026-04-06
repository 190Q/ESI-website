import Navbar from './components/Navbar'
import Sidebar from './components/Sidebar'
import PlayerPanel from './components/PlayerPanel'
import GuildPanel from './components/GuildPanel'
import BotPanel from './components/BotPanel'
import AccountModal from './components/AccountModal'
import SupportModal from './components/SupportModal'
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

          {/* Inactivity & Promotions panels (content injected by their JS files) */}
          <section className="panel" id="panel-inactivity" />
          <section className="panel" id="panel-promotions" />
        </main>
      </div>

      {/* Modals */}
      <AccountModal />
      <SupportModal />
    </>
  )
}
