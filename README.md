# LigaX TypeScript SDK

[![CI](https://github.com/ligaxai/ligaxai-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/ligaxai/ligaxai-typescript/actions/workflows/ci.yml)

Official TypeScript packages for the **LigaX Agent API** — run the agents you configure in LigaX
from your own software. Node 22+, ESM and CJS, works in Bun, Deno and workerd.

| Package           | Use it for                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ligaxai/sdk`    | The API client: runs (wait, stream, poll), conversations, profiles, keys, usage, retries, errors. Subpaths: `/next`, `/ai-sdk`, `/webhooks`, `/errors`. |
| `@ligaxai/react`  | `useLigaXChat` for Vercel AI SDK `useChat` apps.                                                                                                        |
| `@ligaxai/widget` | A chat panel for any site: one `<script>` tag, no framework (preview — see below).                                                                      |

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

```ts
import { Webhook } from '@ligaxai/sdk/webhooks';
const event = await new Webhook(process.env.WEBHOOK_SECRET!).verify(rawBody, request.headers);
```

### Widget

Preview: the widget expects a publishable key, which the v0.1 API does not issue yet.

```html
<script
  src="https://unpkg.com/@ligaxai/widget/dist/widget.global.js"
  data-publishable-key="pk_..."
  data-profile="support"
  defer
></script>
```

## Client options

| Option / env                        | Default                                                                                               |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `apiKey` / `LIGAX_API_KEY`          | —                                                                                                     |
| `baseURL` / `LIGAX_BASE_URL`        | `https://enterprise.ligax.ai/api/public/v1`                                                           |
| `timeout`                           | `600000` ms                                                                                           |
| `maxRetries`                        | `2` — connection errors, 408/409/429/5xx; never 402/403/422; honours `retry-after-ms` / `retry-after` |
| `defaultHeaders`, `fetch`, `logger` | —                                                                                                     |
| `logLevel` / `LIGAX_LOG`            | `warn` (`off error warn info debug`)                                                                  |
| `dangerouslyAllowBrowser`           | `false`                                                                                               |

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

- `SPEC_VERSION` pins the public API spec tag (`public-api-spec-v0.1.0`); `openapi/openapi.json` is
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
