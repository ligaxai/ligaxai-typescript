# @ligaxai/sdk

Run the AI agents you build in LigaX from your own TypeScript or JavaScript code.

`@ligaxai/sdk` is the official client for the LigaX Agent API. It runs on Node 22+, Bun, Deno and
Cloudflare Workers, ships ESM and CJS with full types, retries safely, and streams answers with
resume support.

**Contents:**
[What you need](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/sdk#what-you-need)
· [Install](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/sdk#install) ·
[Configure](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/sdk#configure) ·
[Quickstart](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/sdk#quickstart) ·
[Common tasks](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/sdk#common-tasks) ·
[Web apps](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/sdk#web-apps) ·
[Webhooks](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/sdk#webhooks) ·
[Configuration reference](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/sdk#configuration-reference)
· [Errors](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/sdk#errors) ·
[Retries and timeouts](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/sdk#retries-and-timeouts)
· [Security](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/sdk#security) ·
[API reference](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/sdk#api-reference)
·
[For AI coding assistants](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/sdk#for-ai-coding-assistants)

## What you need

Get these from your LigaX workspace before you write any code:

| You need             | Looks like                                | Where to get it                                                                  |
| -------------------- | ----------------------------------------- | -------------------------------------------------------------------------------- |
| **API base URL**     | `https://<your-ligax-host>/api/public/v1` | Your LigaX administrator. It is the address of _your_ LigaX platform.            |
| **Secret API key**   | `lgx_sk_…`                                | LigaX → **Settings → Developers → API keys**. Keep it on your server.            |
| **Agent profile ID** | `prf_…`                                   | LigaX → **Settings → Developers**. A profile is a published agent your key runs. |
| **Runtime**          | Node 22+, Bun, Deno or Workers            |                                                                                  |

Words used on this page:

- **Agent profile** (`prf_…`): an agent you built in LigaX and published for API use.
- **Run**: one request to an agent. You send `input` text and get back `output.text`.
- **Conversation** (`conv_…`): a thread of runs. Pass its id to continue where you left off.
- **End user**: a person in _your_ app that a run acts for, named by your own user id.
- **Approval**: a run can stop with status `requires_action` to ask before it acts. You approve or
  reject it.
- **Client token** (`lgx_ct_…`): a short-lived token your server mints so a browser can call LigaX
  without your secret key.

## Install

```sh
npm install @ligaxai/sdk
```

Or `pnpm add @ligaxai/sdk`, `yarn add @ligaxai/sdk`, `bun add @ligaxai/sdk`.

## Configure

Set two environment variables. Both are required.

| Variable         | Required | Value                                                                           |
| ---------------- | -------- | ------------------------------------------------------------------------------- |
| `LIGAX_BASE_URL` | yes      | Your platform's API root, for example `https://<your-ligax-host>/api/public/v1` |
| `LIGAX_API_KEY`  | yes      | Your secret API key, `lgx_sk_…`                                                 |

```sh
export LIGAX_BASE_URL="https://<your-ligax-host>/api/public/v1"
export LIGAX_API_KEY="lgx_sk_..."
```

`<your-ligax-host>` is a placeholder: replace it with your platform's host. The SDK has **no
built-in address**, for any environment. If the base URL is missing, `new LigaX()` throws
`MissingBaseURLError`. If the key is missing, it throws `MissingApiKeyError`. Both happen before any
network call.

You can also pass both values in code: `new LigaX({ baseURL: '...', apiKey: '...' })`. An option
wins over the environment variable. In a browser there are no environment variables, so browser code
always passes `baseURL`.

## Quickstart

Save this as `hello.mjs` and run `node hello.mjs`:

```ts
import { LigaX } from '@ligaxai/sdk';

const client = new LigaX(); // reads LIGAX_BASE_URL and LIGAX_API_KEY

const run = await client.runs.wait({
  profile_id: 'prf_...', // your agent profile ID
  input: 'Summarise yesterday’s P1 incidents.',
});

if (run.status === 'completed') console.log(run.output.text);
else console.log('Run ended with status:', run.status, run.error);
```

It prints the agent's answer. `runs.wait` sends the request and waits until the run finishes or
needs your approval.

To check your setup first, call `await client.keys.self()`. It returns your key's name, scopes and
spend limit. `await client.profiles.list()` returns the profiles your key may run.

Request bodies and results use the API's own field names (`profile_id`, `conversation_id`,
`end_user`, `output.text`), exactly as the API defines them.

## Common tasks

### Stream the answer as it is written

```ts
const stream = await client.runs.stream({ profile_id: 'prf_...', input: 'Draft a reply to 4411.' });

for await (const text of stream.textStream()) process.stdout.write(text);

const { status, usage } = await stream.finalResult();
console.log(status, stream.runId, stream.conversationId, usage);
```

`textStream()` yields only the new text each time. To see every event (tool calls, sources,
artifacts), iterate `stream` itself: each item is `{ type, seq, payload, runId }`. Read a stream
once; afterwards `finalText()` and `finalResult()` can be called as often as you like. Stop it with
`stream.abort()` or an `AbortSignal` (`signal` option).

If the connection drops, resume from the last event you received. Nothing is repeated:

```ts
const resumed = await client.runs.followEvents(runId, { after: lastSeq });
```

### Continue a conversation

```ts
const first = await client.runs.wait({ profile_id: 'prf_...', input: 'Open a VPN ticket' });
const followUp = await client.runs.wait({
  profile_id: 'prf_...',
  input: 'Make it priority 2',
  conversation_id: first.conversation_id,
});
```

### Act for one of your users

Pass `end_user` with your own user id. The run then uses that user's connected accounts and
conversations, and only that user can continue them:

```ts
const run = await client.runs.wait({
  profile_id: 'prf_...',
  input: 'What is on my calendar?',
  end_user: { id: 'user-42', name: 'Ada' },
});
```

Take the user id from your own login session, never from the browser's request.

### Approve or reject an action

An agent can stop and ask before it acts, for example before it sends an email. The run then has
status `requires_action`:

```ts
let run = await client.runs.wait({ profile_id: 'prf_...', input: 'Email the team' });

if (run.status === 'requires_action' && run.required_action) {
  console.log('The agent asks:', run.required_action.prompt);
  run = await client.runs.resolveInterrupt(run.id, run.required_action.interrupt_id, {
    decision: 'approve', // or 'reject'
  });
}
```

### Send a file

Upload a file, then attach its id to a run. The key needs the `files:write` scope:

```ts
import { readFile } from 'node:fs/promises';

const file = await client.files.create({
  data: await readFile('contract.pdf'),
  filename: 'contract.pdf',
  contentType: 'application/pdf',
});
const run = await client.runs.wait({
  profile_id: 'prf_...',
  input: 'Summarise the termination clause',
  attachments: [file.id],
});
```

- `files.create` also takes a `Blob` or a `File` (for example from `<input type="file">`).
- Up to 25 MB per file and 10 files per run. A larger file throws `FileTooLargeError` before upload.
- Files are kept for 30 days. `files.delete(id)` removes one early. `files.get(id)` returns metadata
  only; there is no download.
- Whether a file type can be read depends on the agent's model.

### Check a run later

```ts
const started = await client.runs.create({
  profile_id: 'prf_...',
  input: 'Weekly report',
  mode: 'async',
});
const current = await client.runs.get(started.id); // status: queued, running, completed, ...
await client.runs.cancel(started.id); // stop it if you no longer need it
```

A run's `status` is one of `queued`, `running`, `requires_action`, `completed`, `failed`, `canceled`
or `expired`.

## Web apps

### Next.js chat with the Vercel AI SDK

The browser never sees your key: a route on your server runs the agent and streams the answer back.
Install `@ligaxai/react` too (see its
[README](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/react#readme)).

```ts
// app/api/chat/route.ts (server only)
import { createRunRoute } from '@ligaxai/sdk/next';

export const { POST } = createRunRoute({
  profileId: process.env.LIGAX_PROFILE_ID!,
  resolveEndUser: async (request) => (await getSession(request))?.userId, // YOUR login session
});
```

```tsx
// app/page.tsx
'use client';
import { useChat } from '@ai-sdk/react';
import { useLigaXChat } from '@ligaxai/react';

export default function Chat() {
  const { messages, sendMessage, status, stop } = useLigaXChat({ useChat, api: '/api/chat' });
  // render messages and call sendMessage({ text }) from your form
}
```

Without a signed-in user, `createRunRoute` answers `401`. Keep `LIGAX_API_KEY` out of anything
prefixed `NEXT_PUBLIC_` and out of client components. A complete app is in
[examples/nextjs-app](https://github.com/ligaxai/ligaxai-typescript/tree/main/examples/nextjs-app).

### Let a browser call LigaX directly (client tokens)

Your server mints a short-lived **client token** for the signed-in user. The browser uses it instead
of your secret key:

```ts
// server only; the key needs the client_tokens:write scope
const { token, expires_at } = await client.clientTokens.create({
  profile_id: 'prf_...',
  end_user: { id: 'user-42', name: 'Ada' },
  expires_in: 600, // seconds, 60 to 3600; default 600
});
```

A client token runs one profile, as one end user, for a few minutes. It cannot manage keys, webhooks
or usage. The profile must list your website's origin (for example `https://app.example.com`) under
**allowed origins** in Settings → Developers, or the API answers `403 origin_not_allowed`.

In Next.js, `createTokenRoute` is that server endpoint:

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

In the browser, pass a function that fetches the token as `apiKey`. `cachedTokenProvider` reuses a
token until shortly before it expires and fetches a new one when the API answers
`401 token_expired`:

```ts
import { LigaX, cachedTokenProvider } from '@ligaxai/sdk';

const client = new LigaX({
  baseURL: 'https://<your-ligax-host>/api/public/v1', // a browser has no LIGAX_BASE_URL
  apiKey: cachedTokenProvider(() =>
    fetch('/api/ligax-token', { method: 'POST' }).then((r) => r.json()),
  ),
});
const stream = await client.runs.stream({ profile_id: 'prf_...', input: 'Hi' });
```

The SDK refuses a secret key in a browser and throws `BrowserEnvironmentError`.

### Let your users connect their own accounts

By default an agent uses the workspace's shared connections. If the profile allows it (_End users
can connect their own accounts_, on the agent's **API & Integrations** tab), each of your users can
connect their own Gmail, Outlook and so on. Runs for that `end_user` then use the user's own
account.

In the browser, with a client-token client, call `connectAccount` from a click handler (browsers
only allow popups during a click):

```ts
import { connectAccount, ConnectAccountError } from '@ligaxai/sdk';

button.onclick = async () => {
  try {
    const session = await connectAccount(client, { connectorKey: 'gmail' });
    if (session.status === 'succeeded') console.log('Connected:', session.connection_id);
    else console.log('Not connected:', session.status); // 'denied' | 'failed' | 'expired'
  } catch (err) {
    if (err instanceof ConnectAccountError)
      console.log(err.reason); // popup_blocked | popup_closed
    else throw err;
  }
};
```

From your server, with a secret key (scopes `connections:write` and `connections:read`):

```ts
const session = await client.connectSessions.create({
  connector_key: 'gmail',
  profile_id: 'prf_...',
  end_user: { id: 'user-42' },
});
// Open session.connect_url in a popup on the user's page, then wait until it settles:
const settled = await client.connectSessions.wait(session.id, { endUserId: 'user-42' });

const { data } = await client.endUsers.connections.list('user-42'); // their own accounts only
```

In React, `useConnectAccount()` from `@ligaxai/react` wraps `connectAccount`.

## Webhooks

LigaX can call your server when something happens, so you don't have to poll. Managing endpoints
needs the `webhooks:manage` scope.

| Event                                         | Sent when                                  |
| --------------------------------------------- | ------------------------------------------ |
| `run.completed`, `run.failed`, `run.canceled` | a run ends                                 |
| `run.requires_action`                         | a run waits for your approval              |
| `api_key.limit_reached`                       | a key reaches its spend limit              |
| `connection.created`, `connection.deleted`    | an end user connects or removes an account |
| `webhook.test`                                | you call `webhooks.test`                   |

**1. Create an endpoint and store its secret.** The secret (`whsec_…`) is returned only once:

```ts
const endpoint = await client.webhooks.create({
  url: 'https://example.com/api/ligax-webhook',
  event_types: ['run.completed', 'run.failed', 'run.requires_action'],
  profile_ids: ['prf_...'], // optional: only these profiles' runs
});
// Store endpoint.secret in your secret manager, not in source control.
await client.webhooks.test(endpoint.id); // sends a webhook.test event now
```

**2. Verify every delivery** against the raw request body:

```ts
// app/api/ligax-webhook/route.ts
import { Webhook, WebhookVerificationError } from '@ligaxai/sdk/webhooks';

const webhook = new Webhook(process.env.LIGAX_WEBHOOK_SECRET!);

export async function POST(request: Request) {
  const body = await request.text(); // the raw body, not request.json()
  let event;
  try {
    event = await webhook.verify(body, request.headers);
  } catch (err) {
    if (err instanceof WebhookVerificationError) return new Response(null, { status: 400 });
    throw err;
  }
  if (event.type === 'run.completed') {
    // queue the work; the event holds ids, so read the answer with client.runs.get(event.data.id)
  }
  return new Response(null, { status: 204 });
}
```

**3. Follow these rules:**

- **Use the raw bytes.** Re-encoding parsed JSON changes what was signed.
- **Answer 2xx within 15 seconds.** Do slow work afterwards (for example with Next.js `after()` or a
  queue). Failed deliveries are retried; an endpoint that keeps failing is disabled.
- **Skip duplicates.** A retry has the same `webhook-id` header. Remember the ids you handled.
- **Fetch the content.** Events carry ids and a status only.

Deliveries follow [Standard Webhooks](https://www.standardwebhooks.com). For Zapier, Make or n8n,
map _subscribe_ to `webhooks.create` and _unsubscribe_ to `webhooks.delete`.

## Use an agent from MCP or A2A clients

Every published agent profile is also an MCP server and an A2A agent, so Claude Code, Cursor or
another agent can call it without this SDK. Use a secret key with the **Start runs** and **Read
runs** scopes:

```sh
claude mcp add --transport http ligax-support \
  https://<your-ligax-host>/api/public/v1/mcp/prf_... \
  --header "Authorization: Bearer $LIGAX_API_KEY"
```

- MCP endpoint: `https://<your-ligax-host>/api/public/v1/mcp/prf_...` (tools `ask`, `get_run`,
  `respond`).
- A2A agent card: `https://<your-ligax-host>/api/public/v1/a2a/prf_.../.well-known/agent-card.json`
  (A2A 1.0 and 0.3; send the same `Authorization` header).
- Add the header `X-LigaX-End-User: <your user id>` to act for one of your users.

## Configuration reference

| Option                    | Environment variable | Default                                                            |
| ------------------------- | -------------------- | ------------------------------------------------------------------ |
| `baseURL`                 | `LIGAX_BASE_URL`     | none, **required**                                                 |
| `apiKey`                  | `LIGAX_API_KEY`      | none, **required** (a string, or a function that returns a token)  |
| `timeout`                 |                      | `600000` ms                                                        |
| `maxRetries`              |                      | `2`                                                                |
| `defaultHeaders`          |                      | none                                                               |
| `fetch`                   |                      | the global `fetch`                                                 |
| `logLevel`, `logger`      | `LIGAX_LOG`          | `warn` (`off`, `error`, `warn`, `info`, `debug`); `console`        |
| `dangerouslyAllowBrowser` |                      | `false`: a browser accepts only client tokens and publishable keys |

`baseURL` must use `https://`; `http://` is allowed only for `localhost`. Logs never show your key.

## Errors

Every error the SDK throws extends `LigaXError`:

```ts
import { APIError, LigaX, PaymentRequiredError, RateLimitError } from '@ligaxai/sdk';

const client = new LigaX();

try {
  await client.runs.create({ profile_id: 'prf_...', input: 'Hi' });
} catch (err) {
  if (err instanceof PaymentRequiredError)
    console.log(err.code, err.resetsAt); // spend limit
  else if (err instanceof RateLimitError) console.log('still limited', err.requestId);
  else if (err instanceof APIError) console.log(err.status, err.code, err.message, err.requestId);
  else throw err;
}
```

| HTTP status   | Error class                                                            |
| ------------- | ---------------------------------------------------------------------- |
| 400           | `BadRequestError`                                                      |
| 401           | `AuthenticationError`                                                  |
| 402           | `PaymentRequiredError`                                                 |
| 403           | `PermissionDeniedError`                                                |
| 404           | `NotFoundError`                                                        |
| 409           | `ConflictError`                                                        |
| 422           | `UnprocessableEntityError`                                             |
| 429           | `RateLimitError`                                                       |
| 500 and above | `InternalServerError`                                                  |
| no response   | `APIConnectionError`, `APITimeoutError`                                |
| setup         | `MissingBaseURLError`, `MissingApiKeyError`, `BrowserEnvironmentError` |

Each `APIError` has `status`, `code`, `type`, `param` and `requestId`. Quote `requestId` when you
contact support.

## Retries and timeouts

- **Retried, 2 times by default:** connection errors, timeouts, and answers 408, 409, 429 and 5xx.
  The SDK honours the server's `retry-after-ms` and `retry-after`.
- **Never retried:** 402, 403 and 422, and a stream that has already started.
- **No duplicate runs:** every `POST` carries an `Idempotency-Key` that stays the same across
  retries. Pass your own as the `idempotencyKey` request option to make a retry safe across
  processes.
- **Timeout:** 10 minutes per request, so `runs.wait` has room. The server answers a long run after
  up to 240 seconds, and `runs.wait` then keeps polling for you.

## Security

An agent run with your key acts with your workspace's connected accounts (mail, files, tickets) and
spends your credit.

- **Keep secret keys (`lgx_sk_…`) on your server.** Never in a browser, a mobile app, a repository
  or a log. Give each key only the profiles and scopes it needs, and a spend limit.
- **Treat website keys (`lgx_pk_…`) as public.** Anyone can copy one from your page. Visitors on a
  website key can only chat. Give it a small spend limit.
- **Take the user's identity from your own session**, never from the request body or a header the
  browser sets.
- **Keep approvals on** for sending, writing and deleting. Anything the agent reads (an email, a web
  page) can try to give it instructions.
- **Treat the agent's answer as untrusted input.** Never `eval` it or insert it into HTML unescaped.
- **Verify every webhook** and skip duplicates.
- **Pin the version** in your lockfile. Releases carry npm provenance; check with
  `npm audit signatures`.

Report a vulnerability to security@ligaments.ai (see
[SECURITY.md](https://github.com/ligaxai/ligaxai-typescript/blob/main/SECURITY.md)).

## API reference

| Method                                                                                            | API call                                   |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `runs.create({ profile_id, input, conversation_id?, end_user?, mode?, metadata?, attachments? })` | `POST /runs`                               |
| `runs.wait(body)`: create, then poll until the run ends or needs approval                         | `POST /runs`, `GET /runs/{id}`             |
| `runs.stream(body)`, returns a `RunStream`                                                        | `POST /runs` (streamed)                    |
| `runs.get(id)`, `runs.cancel(id)`                                                                 | `GET /runs/{id}`, `POST /runs/{id}/cancel` |
| `runs.events(id, { after })`, `runs.followEvents(id, { after })`                                  | `GET /runs/{id}/events`                    |
| `runs.resolveInterrupt(runId, interruptId, { decision, payload? })`                               | `POST /runs/{id}/interrupts/{iid}`         |
| `conversations.get(id)`                                                                           | `GET /conversations/{id}`                  |
| `profiles.list()`, `profiles.get(id)`                                                             | `GET /profiles[/{id}]`                     |
| `keys.self()`                                                                                     | `GET /keys/self`                           |
| `usage.get(params)`                                                                               | `GET /usage`                               |
| `files.create(file, { endUserId? })`, `files.get(id)`, `files.delete(id)`                         | `/files`                                   |
| `webhooks.create`, `list`, `get`, `update`, `delete`, `test`                                      | `/webhooks`                                |
| `clientTokens.create({ profile_id, end_user, conversation_id?, expires_in? })`                    | `POST /client_tokens`                      |
| `connectSessions.create`, `get`, `wait`                                                           | `/connect_sessions`                        |
| `endUsers.connections.list(endUserId)`, `delete(endUserId, connectionId)`                         | `/end_users/{id}/connections`              |

Entry points:

| Import from             | Contents                                                                         |
| ----------------------- | -------------------------------------------------------------------------------- |
| `@ligaxai/sdk`          | `LigaX`, every error class, `RunStream`, `cachedTokenProvider`, `connectAccount` |
| `@ligaxai/sdk/next`     | `createRunRoute`, `createTokenRoute`, `createRunProxy` (Next.js route handlers)  |
| `@ligaxai/sdk/ai-sdk`   | `createLigaXTransport` (a Vercel AI SDK chat transport)                          |
| `@ligaxai/sdk/webhooks` | `Webhook`, `WebhookVerificationError`                                            |
| `@ligaxai/sdk/errors`   | the error classes only                                                           |

## For AI coding assistants

If you are an AI assistant writing code with this package, follow these facts exactly:

1. Install `@ligaxai/sdk`. Import the client as `import { LigaX } from '@ligaxai/sdk'`.
2. There is **no default base URL**. Server code reads `LIGAX_BASE_URL` from the environment or
   passes `baseURL`. Browser code must pass `baseURL`. Never invent or hard-code a host. Without it
   `new LigaX()` throws `MissingBaseURLError`.
3. The key comes from `LIGAX_API_KEY` or `apiKey`. A secret key (`lgx_sk_…`) belongs in server code
   only. For a browser, mint a client token on the server (`client.clientTokens.create` or
   `createTokenRoute`) and pass a token function as `apiKey`.
4. Create the client once and reuse it.
5. The main call is `await client.runs.wait({ profile_id: 'prf_...', input: '...' })`. The answer is
   `run.output.text` when `run.status === 'completed'`. Handle `'requires_action'` with
   `runs.resolveInterrupt`.
6. Request and result fields are snake_case, exactly as in the API (`profile_id`, `conversation_id`,
   `end_user`). Client options and method names are camelCase (`baseURL`, `maxRetries`,
   `runs.resolveInterrupt`).
7. Catch `APIError` (or a subclass from the table in
   [Errors](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/sdk#errors)). Do not
   add your own retry loop: the client already retries safely.
8. Take `end_user` from the app's login session, never from user input.

## Versions and support

- **Runtimes:** Node 22+, Bun, Deno and Cloudflare Workers. ESM and CJS.
- **Release channels:** `npm install @ligaxai/sdk` installs the `latest` release. Preview builds
  from the `dev` branch are versioned like `0.1.0-dev.42` under the `dev` tag:
  `npm install @ligaxai/sdk@dev`. Every channel needs `LIGAX_BASE_URL`.
- **Related packages:**
  [@ligaxai/react](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/react#readme)
  (React hooks) and
  [@ligaxai/widget](https://github.com/ligaxai/ligaxai-typescript/tree/main/packages/widget#readme)
  (a chat widget for any website).
- **Changes:**
  [packages/sdk/CHANGELOG.md](https://github.com/ligaxai/ligaxai-typescript/blob/main/packages/sdk/CHANGELOG.md).
- **Bugs and questions:** [GitHub issues](https://github.com/ligaxai/ligaxai-typescript/issues).

## License

Apache-2.0. See [LICENSE](https://github.com/ligaxai/ligaxai-typescript/blob/main/LICENSE).
