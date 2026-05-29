import { LogoutIcon } from './Icons'

export default function AccountModal() {
  return (
    <div className="modal-backdrop" id="accountModalBackdrop">
      <div className="modal account-modal">
        <button className="modal-close" id="accountModalClose">{'\u2715'}</button>

        {/* Header */}
        <div className="account-modal-header">
          <img className="account-modal-avatar" id="accountModalAvatar" src="" alt="" />
          <div className="account-modal-name" id="accountModalName" />
          <div className="account-modal-sub" id="accountModalSub" />
        </div>

        {/* Tabs */}
        <div className="account-tabs" id="accountModalTabs">
          <button className="account-tab active" data-acctab="ranks">Ranks</button>
          <button className="account-tab" data-acctab="echelon">Echelon</button>
          <button className="account-tab" data-acctab="badges">Badges</button>
        </div>

        {/* Tab panels */}
        <div className="account-modal-body popup-scroll" id="accountModalBody">
          <div className="account-tab-panel active" id="accountTabRanks">
            <div className="account-rank-tree" id="accountRankTree" />
          </div>
          <div className="account-tab-panel" id="accountTabEchelon">
            <div className="account-echelon-grid" id="accountEchelonGrid" />
          </div>
          <div className="account-tab-panel" id="accountTabBadges">
            <div className="account-badges" id="accountBadges" />
          </div>
          <div className="account-tab-panel" id="accountTabShop" style={{ display: 'none' }}>
            <div id="accountShopContent" />
          </div>

          {/* Application form */}
          <div className="account-apply-form" id="accountApplyForm" style={{ display: 'none' }}>
            <button className="account-apply-back" id="accountApplyBack">{'\u2190'} Back</button>
            <div className="account-apply-title" id="accountApplyTitle" />
            <div className="account-apply-questions" id="accountApplyQuestions" />
            <button className="account-apply-submit" id="accountApplySubmit">Submit Application</button>
          </div>
        </div>

        {/* Footer */}
        <div className="account-modal-footer">
          <button className="account-modal-logout" id="logoutBtn">
            <LogoutIcon />
            Log Out
          </button>
        </div>
      </div>
    </div>
  )
}
