# LigaX TypeScript SDK

[![CI](https://github.com/ligaxai/ligaxai-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/ligaxai/ligaxai-typescript/actions/workflows/ci.yml)

Official TypeScript packages for the **LigaX Agent API** — run the agents you configure in LigaX
from your own software. Node 22+, ESM and CJS, works in Bun, Deno and workerd.

| Package           | Use it for                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ligaxai/sdk`    | The API client: runs (wait, stream, poll), conversations, profiles, keys, usage, webhooks, client tokens, retries, errors. Subpaths: `/next`, `/ai-sdk`, `/webhooks`, `/errors`. |
| `@ligaxai/react`  | `useLigaXChat` for Vercel AI SDK `useChat` apps — through your route or directly with a client token.                                                                            |
| `@ligaxai/widget` | A chat assistant for any website: one `<script>` tag, a `<ligax-chat>` element, or `<LigaXChat>` for React.                                                                      |

## Quickstart

```sh
pnpm add @ligaxai/sdk
export LIGAX_API_KEY=lgx_sk_...        # Settings → Developers. Server-side only.
# export LIGAX_BASE_URL=https://<dev-host>/api/public/v1   # only for a non-production platform
```

```ts
import { LigaX } from '@ligaxai/sdk';

const client = new LigaX(); // reads LIGAX_API_KEY (and LIGAX_BASE_URL)
const run = await client.runs.wait({ profile_id: 'prf_…', input: 'Summarise yesterday’s tickets' });
console.log(run.status, run.output.text);
```

`runs.wait` asks the API to wait for the answer and, if the run is still going after the API's 240 s
budget, polls `runs.get` until it is finished or needs a decision (`requires_action`).
`client.keys.self()` is the cheapest way to check a key against a deployment.

Request bodies and results use the API's own field names (`profile_id`, `conversation_id`,
`end_user`, `output.text`, …) exactly as the [OpenAPI spec](openapi/openapi.json) defines them.

### Streaming

```ts
const stream = await client.runs.stream({ profile_id: 'prf_…', input: 'Hello' });
console.log(stream.runId, stream.conversationId);

for await (const text of stream.textStream()) process.stdout.write(text);
const { status, usage } = await stream.finalResult();
```

A `RunStream` is an async iterable of typed LAE events — `{ type, seq, payload, runId? }`, with
`seq: null` on `stream.*` control frames. Text arrives as offset-addressed `text.delta` frames; the
SDK assembles them by offset (`TextAssembler`), so `textStream()` yields only new text and a
replayed frame never duplicates anything. Also: `finalText()`, `toReadableStream()`, `abort()` (or
pass `signal`). Resume a dropped stream with `client.runs.followEvents(runId, { after: lastSeq })`.

Continue a conversation with `conversation_id: stream.conversationId` (or `run.conversation_id`).
When a run stops with `status: 'requires_action'`, answer it:

```ts
await client.runs.resolveInterrupt(run.id, run.required_action!.interrupt_id, {
  decision: 'approve',
});
```

### Next.js + `useChat`

The browser never sees the key: your route runs the agent server-side and streams the events back.

```ts
// app/api/chat/route.ts — server only
import { createRunRoute } from '@ligaxai/sdk/next';

export const { POST } = createRunRoute({
  profileId: process.env.LIGAX_PROFILE_ID!,
  resolveEndUser: async (request) => (await getSession(request))?.userId, // your auth
});
```

```tsx
// app/page.tsx
'use client';
import { useChat } from '@ai-sdk/react';
import { useLigaXChat } from '@ligaxai/react';

const { messages, sendMessage, status, stop } = useLigaXChat({ useChat, api: '/api/chat' });
```

`useLigaXChat` is `useChat` with `createLigaXTransport` (from `@ligaxai/sdk/ai-sdk`): it translates
the event stream into text and tool parts and carries the conversation id between turns. Keep
`LIGAX_API_KEY` out of anything prefixed `NEXT_PUBLIC_` and out of client components.
`createRunProxy` is a raw `POST /runs` passthrough when you want the API's own responses. See
[`examples/nextjs-app`](examples/nextjs-app).

### Errors

```ts
import { PaymentRequiredError, RateLimitError } from '@ligaxai/sdk';

try {
  await client.runs.create({ profile_id: 'prf_…', input: 'Hi' });
} catch (err) {
  if (err instanceof PaymentRequiredError)
    console.log(err.code, err.resetsAt); // key_limit_reached
  else if (err instanceof RateLimitError) console.log('retried and still limited', err.requestId);
  else throw err;
}
```

### Webhooks

LigaX can call your URL when a run finishes, fails, is canceled or needs an approval
(`run.completed`, `run.failed`, `run.canceled`, `run.requires_action`), when an API key reaches its
spend limit (`api_key.limit_reached`), and when an end user connects or disconnects their own
account (`connection.created`, `connection.deleted` — see below). Managing endpoints needs a key
with the `webhooks:manage` scope.

**1. Create an endpoint and store its secret.** The signing secret (`whsec_…`) is in the create
response and nowhere else — later reads show only `secret_hint`.

```ts
const endpoint = await client.webhooks.create({
  url: 'https://example.com/api/ligax-webhook',
  event_types: ['run.completed', 'run.failed', 'run.requires_action'],
  profile_ids: ['prf_...'], // optional: only runs of these profiles
});
await saveSecret(endpoint.id, endpoint.secret); // your secret store, not source control

await client.webhooks.test(endpoint.id); // sends a `webhook.test` event; resolves with the delivery
```

`list()`, `get(id)`, `update(id, { url?, description?, event_types?, profile_ids?, status? })` and
`delete(id)` cover the rest; `update(id, { status: 'disabled' })` pauses an endpoint without losing
it.

**2. Verify every delivery against the raw body.** Deliveries are signed per
[Standard Webhooks](https://www.standardwebhooks.com) (`webhook-id`, `webhook-timestamp`,
`webhook-signature`; HMAC-SHA256, 5-minute tolerance, several signatures during a secret rotation).
Verify the bytes you received — re-serialising parsed JSON changes them and the signature will not
match. In a Next.js route handler:

```ts
// app/api/ligax-webhook/route.ts
import { after } from 'next/server';
import { Webhook, WebhookVerificationError } from '@ligaxai/sdk/webhooks';

const webhook = new Webhook(process.env.LIGAX_WEBHOOK_SECRET!);

export async function POST(request: Request) {
  const body = await request.text(); // the raw body, not request.json()
  const event = await webhook.verify(body, request.headers).catch((err: unknown) => {
    if (err instanceof WebhookVerificationError) return null;
    throw err;
  }); // typed as WebhookEvent
  if (!event) return new Response(null, { status: 400 });

  const id = request.headers.get('webhook-id')!;
  after(async () => {
    if (await alreadyProcessed(id)) return; // deliveries are at-least-once: dedupe on webhook-id
    switch (event.type) {
      case 'run.completed':
      case 'run.failed':
      case 'run.canceled':
      case 'run.requires_action':
        await onRun(event.data); // { id, status, profile_id, conversation_id, metadata, ... }
        break;
      case 'api_key.limit_reached':
        await onKeyLimit(event.data); // { id, name, limit_usd, spent_usd, resets_at, ... }
        break;
      case 'webhook.test':
        break;
    }
    await markProcessed(id);
  });
  return new Response(null, { status: 204 });
}
```

**3. Answer 2xx fast.** Anything other than a 2xx within 15 seconds counts as a failure and is
retried on a backoff ladder, and an endpoint that keeps failing is disabled
(`disabled_reason: 'failing'`). Acknowledge first and do the work afterwards (`after()` above, or a
queue). A retry carries the same `webhook-id`, which is why that is the dedupe key.

**Zapier, Make, n8n.** These platforms subscribe a REST hook when a user turns a trigger on and
unsubscribe when they turn it off. Map "subscribe" to
`client.webhooks.create({ url: hookUrl, event_types })` (keep the returned `id` and `secret`) and
"unsubscribe" to `client.webhooks.delete(id)`.

`webhooks.create` is safe to retry. The SDK sends an `Idempotency-Key` (one per call, reused across
its retries), and the API answers a repeat with the endpoint it already made — the same `id` and
`secret`, status `200`, `Idempotent-Replayed: true` — rather than creating a second one. If a
subscribe step can itself run twice, pass a stable key so the guarantee survives a restart:
`client.webhooks.create(body, { idempotencyKey: 'zap-sub-' + subscriptionId })`.

### Files

Upload a file, then attach its id to a run so the agent can read it:

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
  attachments: [file.id], // up to 10; also on runs.create and runs.stream
});
```

`files.create` takes a `Blob` or `File` (an `<input type="file">` pick in the browser) or
`{ data, filename, contentType? }` with raw bytes, and sends it as `multipart/form-data`. A secret
key may name the end user the file belongs to (`files.create(file, { endUserId: user.id })`); a
client token (scope `files:write`) always uploads for its own user, so a browser can upload its
user's documents directly and only that user's runs can attach them.

- **Limits.** 25 MB per file — a larger one throws `FileTooLargeError` before anything is sent — and
  10 files per run. Whether a type can be read depends on the profile's model; a model that cannot
  read it refuses the attachment.
- **Lifetime.** Files are kept for 30 days. `files.get(id)` returns the metadata (`filename`,
  `content_type`, `size_bytes`, `expires_at`) and `files.delete(id)` removes one early. There is no
  download.

### Browser access (client tokens)

A secret key (`lgx_sk_…`) never goes to a browser — the client refuses one there. To let a browser
call the API itself (the stream then comes straight from LigaX, not through your server), your
server mints a **client token** for the signed-in user:

```ts
// server only — the key needs the client_tokens:write scope
const { token, expires_at } = await client.clientTokens.create({
  profile_id: 'prf_…',
  end_user: { id: user.id, name: user.name },
  expires_in: 600, // 60–3600 s, default 600
});
```

A client token (`lgx_ct_…`) runs **one profile as one end user**: `POST /runs`, reads and cancels of
that user's runs, interrupt answers, and `GET /conversations/{id}`. A request body may repeat the
profile, end user or conversation but never change them (`403 token_scope`). From a browser it is
accepted only from the profile's **allowed origins** (`403 origin_not_allowed`) — add your site's
origin to the profile in LigaX first. Revoking or disabling the key that minted it ends it at once.

In Next.js, `createTokenRoute` is that server endpoint:

```ts
// app/api/ligax-token/route.ts
import { createTokenRoute } from '@ligaxai/sdk/next';

export const { POST } = createTokenRoute({
  profileId: process.env.LIGAX_PROFILE_ID!,
  // From YOUR session, never the request body. null → 401.
  resolveEndUser: async () => {
    const user = (await auth())?.user;
    return user ? { id: user.id, name: user.name } : null;
  },
  expiresIn: 600,
});
// → 200 { token, expires_at, profile_id, conversation_id? }, Cache-Control: no-store
```

In the browser, pass the token — or better, a function that fetches it — as `apiKey`. A function is
called before requests and once more when the API answers `401 token_expired`; `cachedTokenProvider`
reuses a token until shortly before `expires_at`:

```ts
import { LigaX, cachedTokenProvider } from '@ligaxai/sdk';

const client = new LigaX({
  apiKey: cachedTokenProvider(() =>
    fetch('/api/ligax-token', { method: 'POST' }).then((r) => r.json()),
  ),
});
const stream = await client.runs.stream({ profile_id: 'prf_…', input: 'Hi' });
```

With `useChat`, give the transport `getToken` instead of `api` (`profileId` is optional when the
token answer carries `profile_id`):

```tsx
const getToken = () => fetch('/api/ligax-token', { method: 'POST' }).then((r) => r.json());
// in the component — getToken defined outside it, so the transport and its token cache persist
const chat = useLigaXChat({ useChat, getToken });
// or: createLigaXTransport({ getToken, profileId, baseURL }) from '@ligaxai/sdk/ai-sdk'
```

`<LigaXProvider baseURL=… getClientToken=…>` switches the hooks under it to direct mode the same
way.

### End users' own accounts

By default a profile acts with the workspace's shared connections. With **End users can connect
their own accounts** switched on for the profile (in LigaX: the agent's **API & Integrations** tab),
each of your users connects their own Gmail, Outlook and so on, and runs that name that user
(`end_user.id`) act with their account. The connector must be part of the agent; only connectors
that need no typed credentials can be connected this way.

In the browser, with a client-token client (it acts for its own end user and profile), call
`connectAccount` **from a click handler** — browsers only allow a popup during a user gesture, and
the helper opens it before its first await:

```ts
import { connectAccount, ConnectAccountError, TimeoutError } from '@ligaxai/sdk';

button.onclick = async () => {
  try {
    const session = await connectAccount(client, { connectorKey: 'gmail' });
    if (session.status === 'succeeded') showConnected(session.connection_id);
    else showNotConnected(session.status); // 'denied' | 'failed' | 'expired'
  } catch (err) {
    if (err instanceof ConnectAccountError)
      showHint(err.reason); // popup_blocked | popup_closed
    else if (err instanceof TimeoutError)
      showHint('timeout'); // still pending after timeoutMs
    else throw err; // APIError: 409 end_user_connections_off, 422 connector_not_available / _not_connectable
  }
};
```

It opens a popup, creates a connect session, sends the popup to the provider's consent page, polls
until the session leaves `pending` (every 2 s, up to 10 minutes: `pollIntervalMs`, `timeoutMs` —
`null` waits for the server to expire the session — and `signal`), closes the popup if it is still
open and resolves with the final session. If your handler has to await something first, open the
window at the top of the handler and pass it in:
`connectAccount(client, { connectorKey, popup: window.open('', 'ligax-connect', 'width=520,height=720') })`.
In React, `useConnectAccount()` from `@ligaxai/react` wraps it with `state`
(`idle | connecting | succeeded | failed`), `session` and `error`.

The same calls from your server, with a secret key (scopes `connections:write` / `connections:read`)
naming the profile and end user:

```ts
const session = await client.connectSessions.create({
  connector_key: 'gmail',
  profile_id: 'prf_…',
  end_user: { id: user.id, name: user.name },
});
// open session.connect_url in a popup on the user's page, then poll until it settles:
const settled = await client.connectSessions.wait(session.id, { endUserId: user.id });
// settled.status: 'succeeded' | 'denied' | 'failed' | 'expired' — outcomes, not errors;
// TimeoutError if still pending after timeoutMs (default 10 min; null = until the server expires it)

const { data } = await client.endUsers.connections.list(user.id); // their own accounts only
await client.endUsers.connections.delete(user.id, data[0]!.id);
```

A client token may only name its own end user (`403 token_scope` otherwise). LigaX never redirects
back to an address from the request, so popup-and-poll is the only way to finish a connection.

### Website widget

`@ligaxai/widget` is a chat assistant for any website: a `<ligax-chat>` custom element in Shadow DOM
(no framework, the page's CSS cannot break it), streaming answers, tool activity, an approval card
when the agent asks before acting, and friendly errors. One script tag:

```html
<!-- Anonymous visitors: a publishable key -->
<script
  src="https://cdn.jsdelivr.net/npm/@ligaxai/widget@0.1.0/dist/widget.global.js"
  integrity="sha384-…"
  crossorigin="anonymous"
  data-publishable-key="lgx_pk_live_…"
  data-profile-id="prf_…"
  data-title="Acme support"
  data-greeting="Hi! How can I help?"
  async
></script>

<!-- Signed-in users: your own token endpoint (e.g. createTokenRoute above) -->
<script
  src="https://cdn.jsdelivr.net/npm/@ligaxai/widget@0.1.0/dist/widget.global.js"
  integrity="sha384-…"
  crossorigin="anonymous"
  data-token-url="/api/ligax-token"
  async
></script>
```

Before it works:

- **Origins.** Add your site's origin (e.g. `https://www.acme.com`) to the **profile's** allowed
  origins — and, for a publishable key, to the **key's** origins too. Anything else gets
  `403 origin_not_allowed`.
- **Publishable keys need a spend limit.** `lgx_pk_` keys are public by design and can only open
  anonymous widget sessions (`POST /widget/sessions`, a 15-minute token for `visitor:<id>`); the
  platform requires a spend limit on them because anyone can use one from your site. The profile's
  end-user identity must be `optional`; a `required` profile needs `data-token-url`.
- **Token URL.** The widget POSTs to it with the page's cookies (`credentials: 'include'`) and
  expects `{ token, expires_at, profile_id }` — exactly what `createTokenRoute` answers.

Optional attributes: `data-base-url` (non-production platform), `data-title`, `data-greeting`,
`data-placeholder`, `data-position` (`bottom-right` | `bottom-left`), `data-open`, and
`data-connectors="gmail,outlook"` (a "Connect your account" area — see the widget README) and
`data-files="true"` (a paperclip button: files go with the visitor's next message). Those two, and
answering approvals, need a signed-in user (`data-token-url`): anonymous visitors on a website key
can chat only, and an approval waits for your team. Theme it from your CSS with custom properties
(`ligax-chat { --ligax-accent: #7c3aed; --ligax-radius: 8px }`); it follows `prefers-color-scheme`.
In React, use `<LigaXChat publishableKey profileId />` from `@ligaxai/widget/react`. See
[packages/widget/README.md](packages/widget/README.md) for the full reference and the bundle size.

### Use from MCP and A2A clients

Every published agent profile is also an **MCP server** and an **A2A agent**, so Claude Code,
Cursor, VS Code, agent frameworks and other agents can call it directly. No SDK code is involved —
the client connects to the API with a secret key that has **Start runs** and **Read runs** (and
**Read agent profiles** for the A2A card). Runs started this way are ordinary runs: the same spend
limits, webhooks and audit trail.

```bash
claude mcp add --transport http ligax-support \
  https://enterprise.ligax.ai/api/public/v1/mcp/prf_… \
  --header "Authorization: Bearer $LIGAX_API_KEY"
```

The MCP server offers `ask`, `get_run` and `respond`. For A2A, the agent card is at
`https://enterprise.ligax.ai/api/public/v1/a2a/prf_…/.well-known/agent-card.json` (send the same
`Authorization` header) and the JSON-RPC endpoint is `…/a2a/prf_…` (A2A 1.0 and 0.3). Add
`X-LigaX-End-User: <your user id>` to act for one of your users. The platform's
`docs/public-api/mcp-and-a2a.md` guide covers client configuration, the tool and task mappings, and
what is not supported yet (A2A file parts and push notifications — upload with `files.create` and
pass `attachments` instead).

## Before you integrate: security

An agent you run through this SDK acts with your workspace's connected accounts (mail, files,
tickets) and spends your credit. The rules that matter:

- **Secret keys (`lgx_sk_…`) stay on your server.** Never in a browser, mobile app, repository or
  log; the SDK and the API both refuse one in a browser. A secret key can act as **any** of your end
  users, so restrict it to the profiles it needs and only the scopes it uses, and give it a spend
  limit.
- **Website keys (`lgx_pk_…`) are public.** Anyone can copy one from your page. Visitors on a
  website key can only chat (no account connections, uploads or approvals); give the key a small
  spend limit and attach it only to profiles anyone may use.
- **Say who the user is from your own session.** The server helpers require it (or an explicit
  anonymous opt-in) and answer 401 otherwise. Never take the end user from the request body or a
  header the browser sets.
- **Anything the agent reads can try to instruct it** — emails, documents, web pages, tool results.
  Keep approvals on for sending, writing and deleting, and answer them from your server or a
  signed-in user, never automatically.
- **Treat the agent's answer as untrusted input** to your app: never `eval` it or put it into HTML
  unescaped; don't auto-load links or images it writes.
- **Verify every webhook** with the SDK's verifier, deduplicate on `webhook-id`, and answer fast.
- **Pin versions** and commit your lockfile. Releases carry provenance: `npm audit signatures` (npm)
  or the PyPI attestation. Report vulnerabilities to security@ligaments.ai.

## Client options

| Option / env                        | Default                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apiKey` / `LIGAX_API_KEY`          | — (a string, or a token provider `({ refresh }) => string` for client tokens)                         |
| `baseURL` / `LIGAX_BASE_URL`        | `https://enterprise.ligax.ai/api/public/v1`                                                           |
| `timeout`                           | `600000` ms                                                                                           |
| `maxRetries`                        | `2` — connection errors, 408/409/429/5xx; never 402/403/422; honours `retry-after-ms` / `retry-after` |
| `defaultHeaders`, `fetch`, `logger` | —                                                                                                     |
| `logLevel` / `LIGAX_LOG`            | `warn` (`off error warn info debug`)                                                                  |
| `dangerouslyAllowBrowser`           | `false` — in a browser only `lgx_ct_` / `lgx_pk_` keys and token providers are accepted without it    |

Every POST carries an `Idempotency-Key` (UUID, reused across retries); pass `idempotencyKey` to
control it — the API returns the same run for the same key and body. Errors extend `LigaXError`:
`APIConnectionError`, `APITimeoutError`, and `APIError` subclasses by status (`BadRequestError`,
`AuthenticationError`, `PaymentRequiredError`, `PermissionDeniedError`, `NotFoundError`,
`ConflictError`, `UnprocessableEntityError`, `RateLimitError`, `InternalServerError`) with `status`,
`code`, `type`, `param` and `requestId` (quote it to support).

## Developing

```sh
pnpm install
pnpm check          # build + typecheck + prettier + vitest + publint — the CI gate
pnpm test           # vitest across all packages
pnpm changeset      # describe a user-facing change before opening a PR
```

- `SPEC_VERSION` pins the public API spec tag (`public-api-spec-v0.7.0`); `openapi/openapi.json` is
  the contract and `pnpm gen:types` regenerates the typed models from it (`openapi/README.md`).
- `examples/nextjs-app` is typechecked in CI but not built; run it with
  `pnpm --filter nextjs-app-example dev`.
- Releases: merge the Changesets "Version Packages" PR; CI publishes with npm provenance. The first
  publish of each package is manual (see `.github/workflows/release.yml`).

## Using this repository as a template

This repo is also the base template for other SDKs. See
[`docs/TEMPLATE-TOKENS.md`](docs/TEMPLATE-TOKENS.md) and run
`node scripts/bootstrap.mjs <slug> <scope> <ClassPrefix> "<Title>" <org> <base-url>`.

## License

Apache-2.0 — see [LICENSE](LICENSE).

## Release channels

| Channel | Source                       | Version shape                  | Install                                       |
| ------- | ---------------------------- | ------------------------------ | --------------------------------------------- |
| dev     | every push to `dev`          | `0.1.0-dev.42`, dist-tag `dev` | `pnpm add @ligaxai/sdk@dev` (or an exact pin) |
| stable  | Changesets release on `main` | `0.1.0`, dist-tag `latest`     | `pnpm add @ligaxai/sdk`                       |

`@ligaxai/sdk@latest` never resolves a `-dev.` build. Point a dev install at the development
platform with `LIGAX_BASE_URL=https://<dev-host>/api/public/v1`; the built-in default is the
production host.
