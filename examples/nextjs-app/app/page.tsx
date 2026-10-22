'use client';

import { useChat } from '@ai-sdk/react';
import { useLigaXChat } from '@ligaxai/react';

import { ChatView } from './chat-view';

/**
 * A chat page on `useChat`. `useLigaXChat` supplies the transport: it posts to `/api/chat` (the
 * route in `app/api/chat/route.ts`, which holds the key), turns the LAE event stream into `useChat`
 * messages, and continues the same conversation on the next turn. Nothing here sees the API key.
 *
 * `/direct` is the alternative: the browser calls the API itself with a short-lived client token.
 */
export default function Page() {
  const chat = useLigaXChat({ useChat, api: '/api/chat' });
  return (
    <>
      <ChatView title="LigaX · Next.js example" chat={chat} />
      <p>
        <a href="/direct">Direct mode (client token) →</a>
      </p>
    </>
  );
}
