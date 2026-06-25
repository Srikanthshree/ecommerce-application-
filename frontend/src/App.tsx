import React, { useEffect, useState } from 'react';
import './App.css';

interface HealthStatus {
  status: string;
  version: string;
  checks: { database: string };
}

const API_BASE = process.env.REACT_APP_API_URL ?? '';

function App(): React.ReactElement {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_BASE}/health`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Health check returned ${res.status}`);
        return res.json() as Promise<HealthStatus>;
      })
      .then(setHealth)
      .catch((err: unknown) => {
        if (err instanceof Error && err.name !== 'AbortError') {
          setError(err.message);
        }
      });

    return () => controller.abort();
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>E-Commerce Platform</h1>
        <p className="tagline">Production-ready · Secure · Cloud-native</p>
      </header>

      <main className="app-main">
        <section className="status-card">
          <h2>API Health</h2>
          {error && <p className="status-error">Unable to reach API: {error}</p>}
          {!error && !health && <p className="status-loading">Checking…</p>}
          {health && (
            <dl className="status-list">
              <dt>Status</dt>
              <dd className={health.status === 'ok' ? 'ok' : 'degraded'}>
                {health.status}
              </dd>
              <dt>Database</dt>
              <dd className={health.checks.database === 'healthy' ? 'ok' : 'degraded'}>
                {health.checks.database}
              </dd>
              <dt>Version</dt>
              <dd>{health.version}</dd>
            </dl>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
