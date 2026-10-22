# @ligaxai/react

React hooks for the **LigaX Agent API** with the Vercel AI SDK: `useLigaXChat` is `useChat` wired to
a LigaX agent, through your own server route or directly with a short-lived client token.

```sh
npm i @ligaxai/react @ligaxai/sdk ai @ai-sdk/react
```

```tsx
'use client';
import { useChat } from '@ai-sdk/react';
import { useLigaXChat } from '@ligaxai/react';

const { messages, sendMessage, status, stop } = useLigaXChat({ useChat, api: '/api/chat' });
```

Serve `/api/chat` with `createRunRoute` from `@ligaxai/sdk/next`, which keeps your API key on the
server. `LigaXProvider` switches the hooks to direct mode with a client token, and
`useConnectAccount` lets a signed-in user connect their own accounts.

Full documentation: <https://github.com/ligaxai/ligaxai-typescript#readme>.
