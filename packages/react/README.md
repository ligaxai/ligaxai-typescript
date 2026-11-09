# @ligaxai/react

React hooks for chatting with your LigaX agents, built on the Vercel AI SDK.

`useLigaXChat` is the AI SDK's `useChat`, wired to a LigaX agent. It streams answers, shows tool
activity, and keeps the conversation between turns. `useConnectAccount` lets a signed-in user
connect their own accounts (Gmail, Outlook, …).

## What you need

| You need             | Looks like                                       | Where to get it                                                       |
| -------------------- | ------------------------------------------------ | --------------------------------------------------------------------- |
| **API base URL**     | `https://<your-ligax-host>/api/public/v1`        | Your LigaX administrator. It is the address of _your_ LigaX platform. |
| **Secret API key**   | `lgx_sk_…`                                       | LigaX → **Settings → Developers**. Used on your server only.          |
| **Agent profile ID** | `prf_…`                                          | LigaX → **Settings → Developers**.                                    |
| **React**            | 18 or newer, with `ai` 6+ and `@ai-sdk/react` 3+ |                                                                       |

`<your-ligax-host>` is a placeholder for your platform's host. The packages have no built-in
address.

## Install

```sh
npm install @ligaxai/react @ligaxai/sdk ai @ai-sdk/react
```

## Choose how the browser reaches LigaX

| Mode                     | How it works                                                                                                             | Use it when                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| **Through your route**   | The browser calls a route on your server. The route holds the secret key and streams the run back.                       | You want the simplest setup. Recommended.   |
| **Direct, with a token** | Your server mints a short-lived client token. The browser calls LigaX with it, and the stream comes straight from LigaX. | You want to skip your server for streaming. |

In both modes the secret key (`lgx_sk_…`) stays on your server.

## Quickstart: through your route (Next.js)

**1. The server route.** Set `LIGAX_BASE_URL`, `LIGAX_API_KEY` and `LIGAX_PROFILE_ID` in your server
environment:

```ts
// app/api/chat/route.ts (server only)
import { createRunRoute } from '@ligaxai/sdk/next';

export const { POST } = createRunRoute({
  profileId: process.env.LIGAX_PROFILE_ID!,
  resolveEndUser: async (request) => (await getSession(request))?.userId, // YOUR login session
});
```

Without a signed-in user the route answers `401`.

**2. The page:**

```tsx
// app/page.tsx
'use client';
import { useChat } from '@ai-sdk/react';
import { useLigaXChat } from '@ligaxai/react';

export default function Chat() {
  const { messages, sendMessage, status, stop } = useLigaXChat({ useChat, api: '/api/chat' });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem('q') as HTMLInputElement;
        sendMessage({ text: input.value });
        input.value = '';
      }}
    >
      {messages.map((m) => (
        <p key={m.id}>
          {m.role}: {m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')}
        </p>
      ))}
      <input name="q" />
      {status === 'streaming' ? (
        <button type="button" onClick={stop}>
          Stop
        </button>
      ) : (
        <button>Send</button>
      )}
    </form>
  );
}
```

`useLigaXChat` takes everything `useChat` takes (`id`, `messages`, `onFinish`, …). You pass
`useChat` in yourself, so your app controls which copy of the AI SDK runs.

## Direct mode, with a client token

**1. A token route on your server** (the secret key needs the `client_tokens:write` scope):

```ts
// app/api/ligax-token/route.ts
import { createTokenRoute } from '@ligaxai/sdk/next';

export const { POST } = createTokenRoute({
  profileId: process.env.LIGAX_PROFILE_ID!,
  resolveEndUser: async () => {
    const user = (await auth())?.user; // YOUR login session; null answers 401
    return user ? { id: user.id, name: user.name } : null;
  },
});
```

**2. The page.** A browser has no environment variables, so pass `baseURL`. The token answer carries
the profile id, so `profileId` is optional:

```tsx
'use client';
import { useChat } from '@ai-sdk/react';
import { useLigaXChat } from '@ligaxai/react';

// Defined outside the component, so the transport and its token cache persist between renders.
const getToken = () => fetch('/api/ligax-token', { method: 'POST' }).then((r) => r.json());

export default function Chat() {
  const chat = useLigaXChat({
    useChat,
    getToken,
    baseURL: process.env.NEXT_PUBLIC_LIGAX_BASE_URL, // https://<your-ligax-host>/api/public/v1
  });
  // render chat.messages and call chat.sendMessage({ text }) as above
}
```

Add your website's origin (for example `https://app.example.com`) to the profile's **allowed
origins** in LigaX, or the API answers `403 origin_not_allowed`. The base URL is not a secret; the
API key is.

To switch every hook under a component tree to direct mode at once, wrap it in a provider:

```tsx
import { LigaXProvider } from '@ligaxai/react';

<LigaXProvider baseURL="https://<your-ligax-host>/api/public/v1" getClientToken={getToken}>
  <App />
</LigaXProvider>;
```

## Let users connect their own accounts

When the profile allows it (_End users can connect their own accounts_, on the agent's **API &
Integrations** tab), a signed-in user can connect their own Gmail, Outlook and so on. Call `connect`
from a click, because browsers only allow popups during a click:

```tsx
import { useConnectAccount } from '@ligaxai/react';

function ConnectGmail() {
  const { connect, state, session, error } = useConnectAccount();
  return (
    <button onClick={() => connect({ connectorKey: 'gmail' })} disabled={state === 'connecting'}>
      {state === 'succeeded' ? 'Gmail connected' : 'Connect Gmail'}
    </button>
  );
}
```

`state` is `idle`, `connecting`, `succeeded` or `failed`. On `failed`, read `session.status`
(`denied`, `failed`, `expired`) or `error`. The hook needs a client-token client: pass `client`, or
put it under a `LigaXProvider` with `baseURL` and `getClientToken`.

## API reference

| Export                        | What it does                                                                                                                                                                            |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useLigaXChat(options)`       | `useChat` with the LigaX transport. Options: `useChat` (required), `api` (default `/api/chat`), or `getToken` + `baseURL` (+ `profileId`) for direct mode, plus every `useChat` option. |
| `useLigaXTransport(options)`  | Only the transport, for building your own `useChat` call.                                                                                                                               |
| `LigaXProvider`               | Defaults for the hooks below it: `api`, `baseURL`, `getClientToken`, `profile`.                                                                                                         |
| `useLigaX()`                  | Reads the provider's values.                                                                                                                                                            |
| `useConnectAccount(options?)` | `{ connect, state, session, error, reset }` for connecting an end user's own account.                                                                                                   |

## For AI coding assistants

1. Install `@ligaxai/react` with `@ligaxai/sdk`, `ai` and `@ai-sdk/react`. Pass `useChat` from
   `@ai-sdk/react` into `useLigaXChat`.
2. Never put a secret key (`lgx_sk_…`) or `LIGAX_API_KEY` in client components or `NEXT_PUBLIC_*`
   variables. The server route (`createRunRoute` or `createTokenRoute` from `@ligaxai/sdk/next`)
   holds it.
3. There is **no default base URL**. The server reads `LIGAX_BASE_URL`. Direct mode in the browser
   must pass `baseURL`, usually from `NEXT_PUBLIC_LIGAX_BASE_URL`. Never hard-code a host.
4. `resolveEndUser` must return the user from the app's own login session.

## More

- Full SDK guide (errors, retries, webhooks, files):
  [@ligaxai/sdk](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/sdk#readme).
- A complete Next.js app:
  [examples/nextjs-app](https://github.com/ligaxai/ligaxai-typescript/tree/main/examples/nextjs-app).
- A ready-made chat widget for any website:
  [@ligaxai/widget](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/widget#readme).
- Bugs and questions: [GitHub issues](https://github.com/ligaxai/ligaxai-typescript/issues).
- License: Apache-2.0.
