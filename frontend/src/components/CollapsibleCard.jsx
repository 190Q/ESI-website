export default function CollapsibleCard({ id, style, label, totalId, bodyId, children }) {
  const handleToggle = (e) => {
    const header = e.currentTarget
    header.classList.toggle('open')
    const body = header.nextElementSibling
    if (body) body.classList.toggle('open')
  }

  return (
    <div className="info-card" id={id} style={style}>
      <div className="collapsible-header" onClick={handleToggle}>
        {label}{'\u00A0'}
        {totalId && <span id={totalId} style={{ color: 'var(--text-faint)', fontSize: '0.85em' }} />}
        <span className="collapsible-arrow">{'\u25BC'}</span>
      </div>
      <div className="collapsible-body">
        {bodyId ? <div id={bodyId} /> : children}
      </div>
    </div>
  )
}
