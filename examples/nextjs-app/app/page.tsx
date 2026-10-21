'use client';

import { useState } from 'react';

/**
 * Calls the route in `app/api/chat/route.ts`, which holds the secret key and proxies to
 * the API. Nothing in this file ever sees `BASE_PROJECT_API_KEY`.
 */
export default function Page() {
  const [output, setOutput] = useState<string>('');
  const [busy, setBusy] = useState(false);

  async function ping() {
    setBusy(true);
    setOutput('');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'health' }),
      });
      setOutput(`${res.status} ${await res.text()}`);
    } catch (error) {
      setOutput(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <h1>__PROJECT_TITLE__ · Next.js example</h1>
      <p>
        The button posts to <code>/api/chat</code>; the route handler calls the API with the
        server-side key.
      </p>
      <button onClick={ping} disabled={busy}>
        {busy ? 'Calling…' : 'Check API health'}
      </button>
      <pre style={{ marginTop: '1rem', padding: '1rem', background: '#f3f4f6' }}>{output}</pre>
    </main>
  );
}
