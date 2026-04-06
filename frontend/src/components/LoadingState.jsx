export default function LoadingState({ id, message }) {
  return (
    <div id={id} className="loading-state" style={{ display: 'none', fontWeight: 500 }}>
      <div className="loading-spinner" />
      <span>{message}</span>
    </div>
  )
}

export function ErrorState({ id }) {
  return <div id={id} className="error-state" style={{ display: 'none' }} />
}
