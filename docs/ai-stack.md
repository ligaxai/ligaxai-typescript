# AI stack reference — **PROJECT_TITLE** TypeScript SDK

Authoritative stack facts for this repository. When another doc disagrees, this one wins.

## Runtime and toolchain

| Concern         | Choice                                                  | Notes                                                                                              |
| --------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Node            | `>=22` (`.nvmrc` 24.12.0)                               | Node 20 is EOL; `ai@7` and `eventsource-parser@4` need 22.12+. CJS build relies on `require(esm)`. |
| Package manager | pnpm 10 (`packageManager` pinned)                       | `engine-strict`, `auto-install-peers=false`; exact versions everywhere.                            |
| Language        | TypeScript 5.9, `strict` + `exactOptionalPropertyTypes` | `moduleResolution: Bundler`, `verbatimModuleSyntax`; sources import with `.js` suffixes.           |
| Bundler         | tsdown 0.23 (Rolldown)                                  | `format: esm+cjs`, `fixedExtension` (`.mjs`/`.cjs`), `dts`, `platform: neutral` for the SDK.       |
| Tests           | vitest 5 (vite 8 peer)                                  | Root `vitest.config.ts` lists the package projects; sdk = node, react/widget = jsdom 29.           |
| Lint            | Prettier only (`pnpm lint` = `prettier --check`)        | No ESLint by decision; see DECISIONS.                                                              |
| Packaging check | publint `--strict` on each publishable package          | Runs in `pnpm check`.                                                                              |
| Versioning      | Changesets 3, packages `linked`, `access: public`       | `pnpm version` → `changeset version && pnpm install --lockfile-only`.                              |
| Publishing      | `changesets/action` + npm OIDC provenance               | First publish per package is manual.                                                               |

## Packages

| Package           | Platform | Runtime deps                           | Optional peers (type-only)                |
| ----------------- | -------- | -------------------------------------- | ----------------------------------------- |
| `@ligaxai/sdk`    | neutral  | `eventsource-parser`                   | `ai`, `next`                              |
| `@ligaxai/react`  | browser  | `@ligaxai/sdk`                         | `react` (required), `ai`, `@ai-sdk/react` |
| `@ligaxai/widget` | browser  | `@ligaxai/sdk` (library) / none (IIFE) | `react` (only for `./react`)              |

## Wire contracts the SDK encodes

- **Auth** `Authorization: Bearer <key>`; **UA** `ligaxai-typescript-typescript/<version>`.
- **Request id** response header `x-request-id` → `error.request_id` / `result._request_id`.
- **Errors** `{ error: { type, code, message, request_id, param } }`; class chosen by status; 402
  may carry `X-Limit-Resets-At`.
- **Idempotency** `Idempotency-Key` UUIDv4 on every POST, reused across retries.
- **Retries** see CLAUDE.md non-negotiable 2.
- **Streaming** generic `Stream<T>`: SSE, JSON per `data:` line, `data: [DONE]` sentinel, `id:`
  tracked for resume.
- **LAE run stream** (`POST /runs` `mode: "stream"`, `GET /runs/{id}/events?stream=true`):
  `event: <type>` + `data: {v, type, seq, ts, run:{id}, payload}`; `seq` null on `stream.*`;
  `X-Run-Id` / `X-Conversation-Id` headers. `text.delta` `{part_id, offset, text}` is written at its
  UTF-16 offset (`TextAssembler`); answer = text parts in `part.start` order; terminal `run.end`
  `{status, finish_reason, usage, error}`. An `Idempotency-Key` replay answers JSON (the run).
- **Pagination** `{ data: T[], next_page: string | null }`, cursor sent as `?page=`.
- **Webhooks** Standard Webhooks: `webhook-id`, `webhook-timestamp`, `webhook-signature` (`v1,<b64>`
  HMAC-SHA256 over `id.timestamp.body`, `whsec_` secret, 5-minute tolerance).
- **AI SDK** `createLigaXTransport` translates LAE → `UIMessageChunk` in the browser and resolves
  `reconnectToStream` to `null`; `createChatTransport` reads a route that already emits the AI SDK
  UI stream (`UIMessageChunk` JSON per SSE event, `[DONE]` dropped, reconnect GET 204 = nothing).

## Spec and parity

`SPEC_VERSION` (file) names the spec release tag — `public-api-spec-v0.7.0`; until the spec repo
publishes assets `openapi/openapi.json` is copied by hand from `ligax-enterprise`. `pnpm sync-spec`
downloads `openapi.json` and `conformance.tar.gz` from the `<org>/<slug>-spec` GitHub release;
`pnpm gen:types` regenerates `packages/sdk/src/generated/types.ts`; CI runs `gen-types --check`. The
Python SDK pins the same tag and runs the same fixtures.

## Environment variables

`LIGAX_API_KEY`, `LIGAX_BASE_URL`, `LIGAX_LOG` (`off|error|warn|info|debug`). `GITHUB_TOKEN` is
optional for `sync-spec`. Nothing is read at import time; only the client constructor reads env.
