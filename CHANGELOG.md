# Changelog

Repository-level changes (tooling, docs, CI). Package changelogs are written by Changesets into
`packages/*/CHANGELOG.md`. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added — Files, attachments and MCP/A2A docs (`feat/files-and-protocols`)

- **Contract** — `openapi/openapi.json` re-copied (0.5.0): `POST /files`, `GET`/`DELETE /files/{id}`,
  `attachments` on `POST /runs`, and the MCP (`/mcp/{profile_id}`) and A2A (`/a2a/{profile_id}`,
  agent card) operations. `SPEC_VERSION` = `public-api-spec-v0.5.0`; generated types regenerated.
- **SDK** — `client.files.create(file, { endUserId })` (a `Blob`/`File` or `{ data, filename,
  contentType }`, sent as `multipart/form-data`; over 25 MB throws `FileTooLargeError` before
  sending), `files.get`, `files.delete`; `FileObject` / `FileDeleted` aliases; `MAX_FILE_BYTES`.
  The base client now sends a `FormData` body as is (no JSON `Content-Type`, so `fetch` sets the
  boundary) and re-sends it with the same `Idempotency-Key` on retry. `runs.create/stream/wait`
  carry `attachments` from the regenerated `RunCreateParams`.
- **Webhooks** — `webhooks.create` already sent an `Idempotency-Key`; it now documents and tests the
  platform's replay (`200`, `Idempotent-Replayed: true`, same endpoint and secret) and the retried
  `409 idempotency_in_progress` (`x-should-retry: true`).
- **Widget** — `data-files="true"` (`files` attribute / `mount()` option / `<LigaXChat files>`): a
  paperclip button uploads with the widget's client token and sends the ids as `attachments` on the
  next message.
- **Docs** — README "Files" and "Use from MCP and A2A clients" (Claude Code `claude mcp add`
  snippet, A2A card URL; no SDK code needed).

### Added — End users connect their own accounts (`feat/end-user-connections`)

- **Contract** — `openapi/openapi.json` re-copied (0.3.0): `POST /connect_sessions`,
  `GET /connect_sessions/{id}`, `GET /end_users/{end_user_id}/connections`,
  `DELETE /end_users/{end_user_id}/connections/{connection_id}`, and `connection.created` /
  `connection.deleted` as subscribable event types. `SPEC_VERSION` = `public-api-spec-v0.3.0`;
  generated types regenerated.
- **SDK** — `client.connectSessions.create/get`, `client.endUsers.connections.list/delete`;
  `ConnectionCreatedWebhookEvent` / `ConnectionDeletedWebhookEvent` in the `WebhookEvent` union
  (hand-written from the platform's emit code — the spec's `webhooks` section does not describe
  them); `connectAccount()` browser helper (popup opened inside the click, poll to a terminal status,
  popup closed), `ConnectAccountError` (`popup_blocked | popup_closed`), and
  `client.connectSessions.wait()` — fixed-interval poll, `denied`/`failed`/`expired` returned as
  outcomes, `TimeoutError` on the client-side timeout, `timeoutMs: null` to wait for the server's
  expiry (the Python SDK's `connect_sessions.wait` contract).
- **React** — `useConnectAccount()` (`idle | connecting | succeeded | failed`, `session`, `error`,
  `reset`), using the provider's direct-mode token when no client is passed.
- **Widget** — `data-connectors="gmail,outlook"` (`connectors` attribute / `mount()` option /
  `<LigaXChat connectors>`): a "Connect your account" area with one humanised button per connector;
  hides itself on `409 end_user_connections_off`.

### Added — Browser access and the website widget (`feat/browser-access`)

- **Contract** — `openapi/openapi.json` re-copied from `ligax-enterprise/docs/public-api/spec`:
  `POST /client_tokens` (secret key, scope `client_tokens:write`) and `POST /widget/sessions`
  (publishable key). `SPEC_VERSION` = `public-api-spec-v0.2.0`; generated types regenerated.
- **Client tokens** — `client.clientTokens.create()`; `apiKey` may be a token provider
  (`({ refresh }) => string`), called before requests and once more on `401 token_expired` (no retry
  budget spent, same `Idempotency-Key`); `cachedTokenProvider()`. In a browser the client accepts
  `lgx_ct_` / `lgx_pk_` keys and providers without `dangerouslyAllowBrowser`; a secret key (or a
  provider returning one) is still refused.
- **`/next` `createTokenRoute`** — mints a client token for the signed-in user; answers
  `{ token, expires_at, profile_id, conversation_id? }` with `Cache-Control: no-store`; no user →
  401 without calling the API.
- **Direct mode** — `createLigaXTransport({ getToken, profileId?, baseURL? })` and
  `useLigaXChat({ getToken })` (or `LigaXProvider` `baseURL` + `getClientToken`) call `POST /runs`
  from the browser with the token; the BFF `api` mode is unchanged.
- **`@ligaxai/widget` rebuilt** — `<ligax-chat>` custom element in Shadow DOM; script-tag mount
  from `data-publishable-key` + `data-profile-id` (anonymous visitors, `visitor_id` in
  `localStorage`) or `data-token-url`; streaming, tool activity, approval card for
  `requires_action`, friendly errors, safe markdown subset (never `innerHTML` of model output),
  `--ligax-*` theming, dark mode, keyboard and screen-reader support. `@ligaxai/widget/react`
  exports `<LigaXChat>`. IIFE ≈ 42 KB min / 15 KB gzip. The "preview" label is gone.
- **Docs** — README "Browser access (client tokens)" and "Website widget"; widget README; the
  Next.js example gains `/api/ligax-token` and a `/direct` page. (by @sadain, 2026-10-22)

### Added — Webhook endpoints (`feat/agent-api-v0.1`)

- **Contract** — `openapi/openapi.json` re-copied from `ligax-enterprise/docs/public-api/spec`:
  `/webhooks`, `/webhooks/{id}`, `/webhooks/{id}/test` (scope `webhooks:manage`) and the OpenAPI 3.1
  `webhooks` section (`run.completed|failed|canceled|requires_action`, `api_key.limit_reached`).
  Generated types regenerated; `SPEC_VERSION` unchanged (no new spec tag yet).
- **`client.webhooks`** — `create` (returns the `whsec_` secret once), `list`, `get`, `update`,
  `delete`, `test`; aliases `WebhookEndpoint`, `WebhookEndpointWithSecret`, `WebhookDelivery`,
  `WebhookEventType`, and the `WebhookEvent` union (`RunWebhookEvent | ApiKeyLimitWebhookEvent |
  WebhookTestEvent`).
- **`/webhooks`** — `Webhook.verify()` now types its result as `WebhookEvent` by default and the
  subpath re-exports the event types; tests pin the Standard Webhooks reference vector and a
  two-signature rotation header.
- **README** — a Webhooks guide: create and store the secret, verify the raw body in a Next.js
  route handler, answer 2xx fast, dedupe on `webhook-id`, Zapier/Make/n8n REST-hook mapping.
  (by @sadain, 2026-10-22)

### Added — Agent API v0.1 (`feat/agent-api-v0.1`)

- **Contract** — `openapi/openapi.json` copied from `ligax-enterprise/docs/public-api/spec`,
  `SPEC_VERSION` = `public-api-spec-v0.1.0`, generated types regenerated. `gen-types.mjs` hoists the
  platform's zod `$defs` into `components.schemas` (their `#/$defs` pointers do not resolve inside an
  OpenAPI document), so the contract file itself is never hand-edited.
- **`@ligaxai/sdk` resources** — `runs.create/stream/wait/get/events/followEvents/cancel/
  resolveInterrupt`, `conversations.get`, `profiles.list/get`, `keys.self`, `usage.get`; snake_case
  wire bodies passed through; named type aliases (`Run`, `RunCreateParams`, `Profile`, …) over the
  generated file. The example `health` resource is gone.
- **`RunStream` + `TextAssembler`** — typed LAE events (`seq: null` on `stream.*` control frames,
  unknown types kept), `runId`/`conversationId` from response headers, `textStream()`,
  `finalText()`, `finalResult()`, `toReadableStream()`, `abort()`. Text is written at its UTF-16
  offset per part (replays are no-ops, out-of-order deltas held until contiguous, surrogate pairs
  never split), joined in `part.start` order, reasoning excluded. A final SSE event without a
  trailing blank line is still delivered.
- **Errors** — `APIError.requestId`, `PaymentRequiredError.resetsAt` (`X-Limit-Resets-At`); 422
  joins 402/403 as never retried.
- **`/ai-sdk`** — `createLigaXTransport` (LAE → `UIMessageChunk`, conversation id carried per
  chat, `reconnectToStream` → `null`), `laeToUIMessageStream`, `toUIMessageChunks`.
- **`/next`** — `createRunRoute` (useChat `messages` or `{ input }` in, LAE stream out, profile and
  end user pinned server-side) and `createRunProxy` (raw `POST /runs` passthrough).
- **`@ligaxai/react`** — `useLigaXChat` / `useLigaXTransport` on the LAE transport.
- **Example** — `examples/nextjs-app` is a working chat on `createRunRoute` + `useLigaXChat`.
- **Conformance** — cases for `runs.create`, `runs.get`, a 402 and a 404; an `lae-run` SSE
  transcript run through `RunStream`. (by @sadain, 2026-10-22)

### Added — Project base setup

Template skeleton for the LigaX AI TypeScript SDK monorepo (`ligaxai-typescript`).

- **Workspace** — pnpm 10 workspace (`packages/*`, `examples/*`), strict `tsconfig.base.json`
  (ES2022, Bundler resolution, `exactOptionalPropertyTypes`), Prettier, EditorConfig, Changesets
  (linked versions, public access), Apache-2.0.
- **`@ligaxai/sdk`** — `LigaX` client (env/arg options, browser guard, injected
  fetch, leveled redacting logger); request pipeline with Bearer auth, User-Agent stamped from
  package.json at build, `X-Request-Id` capture (`_request_id`), auto `Idempotency-Key` reused
  across retries, retry policy (`retry-after-ms` → `retry-after` → 0.5–8 s jittered backoff,
  `x-should-retry` override, never 402/403), `AbortSignal`, `APIPromise.withResponse()` /
  `.asResponse()`; `Stream<T>` over `eventsource-parser` with `[DONE]`, `lastEventId`, `tee()`;
  cursor `Page<T>`; error hierarchy mapped from status and `{error:{type,code,message,
  request_id,param}}`; subpaths `/errors`, `/webhooks` (Standard Webhooks, WebCrypto), `/next`
  (`createRouteHandler` → `{ GET, POST }`, streams passthrough), `/ai-sdk`
  (`createChatTransport` implementing the Vercel AI SDK `ChatTransport`). ESM + CJS + d.ts via
  tsdown; publint clean. 63 vitest cases including a conformance runner over
  `conformance/cases/*.json` and `conformance/sse/*.txt`.
- **`@ligaxai/react`** — `LigaXProvider`, `useLigaX`,
  `useLigaXTransport`, `useLigaXChat` (takes `useChat` as a parameter so
  `@ai-sdk/react` stays an optional peer). Testing Library test under jsdom.
- **`@ligaxai/widget`** — vanilla-DOM chat panel, `init()` + `autoInit()` from script
  data attributes; library build plus a self-contained IIFE `dist/widget.global.js` exposing
  `window.LigaXWidget`.
- **Example** — `examples/nextjs-app` (Next 16 App Router) using `createRouteHandler`;
  typechecked in CI, not built.
- **Scripts** — `bootstrap.mjs` (token rename over `git ls-files`), `gen-types.mjs`
  (openapi-typescript with `--check` drift gate), `sync-spec.mjs` (release-asset download for
  `SPEC_VERSION`).
- **CI** — `ci.yml` (Node 22/24 × ubuntu/windows running `pnpm check`, plus a Bun vitest job and
  `pnpm audit --prod`), `release.yml` (Changesets version PR + publish with npm provenance).
- **Docs** — README, CLAUDE.md, SECURITY.md, `docs/{ai-stack,SUMMARY,STATUS,DECISIONS,
  TEMPLATE-TOKENS}.md`, `conformance/README.md`. (by @sadain, 2026-10-22)
