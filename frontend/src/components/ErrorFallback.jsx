export default function ErrorFallback() {
  return (
    <div style={{ padding: 24, color: '#eee', background: '#0f1116', minHeight: '100vh', fontFamily: 'inherit' }}>
      <h1 style={{ fontSize: 20, marginBottom: 12 }}>Something went wrong.</h1>
      <p style={{ opacity: 0.7, marginBottom: 16 }}>
        The error has been reported. Try reloading the page.
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #333', background: '#1a1d24', color: '#eee', cursor: 'pointer' }}
      >
        Reload
      </button>
    </div>
  );
}
