# **PROJECT_TITLE** TypeScript SDK

[![CI](https://github.com/ligaxai/ligaxai-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/ligaxai/ligaxai-typescript/actions/workflows/ci.yml)

Official TypeScript packages for the **PROJECT_TITLE** API. Node 22+, ESM and CJS, works in Bun,
Deno, workerd and (with a client token) the browser.

| Package           | Use it for                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `@ligaxai/sdk`    | The API client: typed resources, streaming, retries, pagination, errors. Subpaths: `/next`, `/ai-sdk`, `/webhooks`, `/errors`. |
| `@ligaxai/react`  | `LigaXProvider` + `useLigaXChat` for Vercel AI SDK `useChat` apps.                                                             |
| `@ligaxai/widget` | A chat panel for any site: one `<script>` tag, no framework.                                                                   |

## Quickstart

```sh
pnpm add @ligaxai/sdk
export LIGAX_API_KEY=sk_...
```

```ts
import { LigaX } from '@ligaxai/sdk';

const client = new LigaX(); // reads LIGAX_API_KEY
const health = await client.health.get();
console.log(health.status, health._request_id);
```

Streaming, with the raw response available when you need it:

```ts
const stream = await client.post<Stream<RunEvent>>('/runs', {
  body: { input: 'hi' },
  stream: true,
});
for await (const event of stream) console.log(event);

const { data, response, request_id } = await client.health.get().withResponse();
```

### Next.js

```ts
// app/api/chat/route.ts
import { createRouteHandler } from '@ligaxai/sdk/next';
export const { GET, POST } = createRouteHandler({
  resolve: ({ body }) => ({ path: '/runs', body, stream: true }),
});
```

```tsx
// a client component
import { useChat } from '@ai-sdk/react';
import { useLigaXChat } from '@ligaxai/react';
const { messages, sendMessage } = useLigaXChat({ useChat, profile: 'support' });
```

### Webhooks

```ts
import { Webhook } from '@ligaxai/sdk/webhooks';
const event = await new Webhook(process.env.WEBHOOK_SECRET!).verify(rawBody, request.headers);
```

### Widget

```html
<script
  src="https://unpkg.com/@ligaxai/widget/dist/widget.global.js"
  data-publishable-key="pk_..."
  data-profile="support"
  defer
></script>
```

## Client options

| Option / env                        | Default                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `apiKey` / `LIGAX_API_KEY`          | —                                                                                                 |
| `baseURL` / `LIGAX_BASE_URL`        | `https://api.ligax.ai/api/public/v1`                                                              |
| `timeout`                           | `600000` ms                                                                                       |
| `maxRetries`                        | `2` — connection errors, 408/409/429/5xx; never 402/403; honours `retry-after-ms` / `retry-after` |
| `defaultHeaders`, `fetch`, `logger` | —                                                                                                 |
| `logLevel` / `LIGAX_LOG`            | `warn` (`off error warn info debug`)                                                              |
| `dangerouslyAllowBrowser`           | `false`                                                                                           |

Every POST carries an `Idempotency-Key` (UUID, reused across retries); pass `idempotencyKey` to
control it. Errors extend `LigaXError`: `APIConnectionError`, `APITimeoutError`, and `APIError`
subclasses by status (`AuthenticationError`, `RateLimitError`, ...) with `status`, `request_id`,
`code`, `type`, `param`.

## Developing

```sh
pnpm install
pnpm check          # typecheck + prettier + vitest + build + publint — the CI gate
pnpm test           # vitest across all packages
pnpm changeset      # describe a user-facing change before opening a PR
```

- `SPEC_VERSION` pins the public API spec tag; `pnpm sync-spec` fetches `openapi/openapi.json` and
  the `conformance/` fixtures, `pnpm gen:types` regenerates the typed models.
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
