import { LogoutIcon } from './Icons'

export default function AccountModal() {
  return (
    <div className="modal-backdrop" id="accountModalBackdrop">
      <div className="modal account-modal">
        <button className="modal-close" id="accountModalClose">{'\u2715'}</button>
        <img className="account-modal-avatar" id="accountModalAvatar" src="" alt="" />
        <div className="account-modal-name" id="accountModalName" />
        <div className="account-modal-sub" id="accountModalSub" />
        <div className="account-modal-roles" id="accountModalRoles" />
        <div className="account-modal-divider" />
        <button className="account-modal-logout" id="logoutBtn">
          <LogoutIcon />
          Log Out
        </button>
      </div>
    </div>
  )
}
