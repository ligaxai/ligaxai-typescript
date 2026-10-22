'use client';

import { useChat } from '@ai-sdk/react';
import { useLigaXChat } from '@ligaxai/react';

import { ChatView } from '../chat-view';

/**
 * Direct mode: the browser asks `/api/ligax-token` (your server, `createTokenRoute`) for a client
 * token, then streams the run **straight from the LigaX API** — your server is not in the stream's
 * path. The token is bound to one profile and one user, lasts minutes, and works only from the
 * origins on the profile (add `http://localhost:3000` there for local development). The transport
 * caches it until shortly before it expires and fetches a new one on `401 token_expired`.
 *
 * Defined at module scope so the transport (and its token cache) survives re-renders.
 */
async function getToken() {
  const response = await fetch('/api/ligax-token', { method: 'POST' });
  if (!response.ok) throw new Error(`Token request failed (${response.status})`);
  // { token, expires_at, profile_id } — the profile comes with it, so the page needs no id.
  return (await response.json()) as { token: string; expires_at: string; profile_id: string };
}

export default function DirectPage() {
  const chat = useLigaXChat({
    useChat,
    getToken,
    // The API base URL is not a secret; omit it for production.
    baseURL: process.env.NEXT_PUBLIC_LIGAX_BASE_URL || undefined,
  });
  return <ChatView title="LigaX · direct mode (client token)" chat={chat} />;
}
