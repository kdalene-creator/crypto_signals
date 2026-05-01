export default function Home() {
  return (
    <main style={{ fontFamily: 'system-ui', padding: '2rem' }}>
      <h1>BTC Scalping Signals</h1>
      <p>Alerts-only bot. Endpoints:</p>
      <ul>
        <li>
          <code>GET /api/health</code> — liveness probe
        </li>
        <li>
          <code>GET /api/cron/scan</code> — scan loop (auth required)
        </li>
        <li>
          <code>GET /api/signals/recent</code> — last 100 signals
        </li>
      </ul>
    </main>
  );
}
