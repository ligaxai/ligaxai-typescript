# Project Summary — LigaX TypeScript SDK

> Living summary maintained alongside every substantive change (see "Living docs" in
> [`CLAUDE.md`](../CLAUDE.md)). For authoritative stack facts prefer
> [`docs/ai-stack.md`](./ai-stack.md) — this file contextualises and builds on it.

## What this project is

**`ligaxai-typescript`** publishes the official TypeScript packages for the **LigaX Agent API**:
`@ligaxai/sdk` (the client), `@ligaxai/react` (hooks for Vercel AI SDK apps) and `@ligaxai/widget`
(a script-tag chat panel). It is hand-written in the openai-node shape — only the request/response
types are generated from the API's OpenAPI spec — and shares language-neutral conformance fixtures
with the Python SDK so both behave identically.

On the template branch the repo is also the **base project** for other SDKs: every product-specific
string is a token listed in [`TEMPLATE-TOKENS.md`](./TEMPLATE-TOKENS.md) and rewritten by
`scripts/bootstrap.mjs`.

## What works today

1. **Client** —
   `new LigaX({ apiKey, baseURL, timeout, maxRetries, defaultHeaders, fetch, logLevel, logger, dangerouslyAllowBrowser })`,
   env fallbacks, browser guard, redacting logger.
2. **Request pipeline** — Bearer auth, User-Agent with the build-time version, `X-Request-Id`
   capture, automatic `Idempotency-Key` on POST reused across retries, the full retry policy
   (`retry-after-ms`, `retry-after`, jittered backoff, `x-should-retry`, never 402/403), per-request
   timeout and `AbortSignal`, `APIPromise` with `withResponse()` / `asResponse()`.
3. **Streaming** — `Stream<T>` over `eventsource-parser/stream`; `[DONE]`, `lastEventId`, `tee()`,
   abort on early exit.
4. **Pagination** — `Page<T>` with `hasNextPage()` / `getNextPage()` and item-level `for await`.
5. **Errors** — `LigaXError` → `APIConnectionError` / `APITimeoutError` / `APIError` subclasses by
   status (incl. `PaymentRequiredError` with `resetsAt`), with `status`, `requestId`, `code`,
   `type`, `param`. Never retried: 402, 403, 422.
6. **Agent API v0.1 resources** (spec `public-api-spec-v0.2.0`) — `runs` (`create`, `stream`,
   `wait`, `get`, `events`, `followEvents`, `cancel`, `resolveInterrupt`), `conversations.get`,
   `profiles.list/get`, `keys.self`, `usage.get`, `webhooks` (`create/list/get/update/delete/ test`,
   scope `webhooks:manage`), `clientTokens.create`. `apiKey` may be a token provider (refreshed once
   on `401 token_expired`; `cachedTokenProvider`); in a browser only `lgx_ct_`/`lgx_pk_` keys and
   providers are accepted without `dangerouslyAllowBrowser`. `RunStream` over the LAE event stream
   with `TextAssembler` (offset-addressed, replay-safe text).
7. **Subpaths** — `/errors`, `/webhooks` (Standard Webhooks with WebCrypto; `verify()` typed as the
   `WebhookEvent` union, spec reference vector pinned), `/next` (`createRunRoute`, `createRunProxy`,
   `createTokenRoute`, generic `createRouteHandler`), `/ai-sdk` (`createLigaXTransport` LAE →
   `UIMessageChunk`, through your route or directly with `getToken`; `createChatTransport` for
   UI-message-stream routes).
8. **React** — `LigaXProvider`, `useLigaX`, `useLigaXTransport`, `useLigaXChat({ useChat, ... })` on
   the LAE transport, in route mode or direct token mode.
9. **Widget** — `<ligax-chat>` custom element (Shadow DOM) on the v0.1 API: publishable key
   (`/widget/sessions`) or token URL, streaming, approvals, safe markdown, theming; `mount()` /
   `define()` / `autoInit()`; `<LigaXChat>` at `@ligaxai/widget/react`; ESM/CJS plus IIFE
   `dist/widget.global.js` (`window.LigaXWidget`).
10. **Tests** — vitest across the three packages, all through an injected `fetch`; conformance
    runner over `conformance/` (cases + LAE transcripts).
11. **Build & release** — tsdown ESM + CJS + d.ts, publint strict, Changesets, CI matrix (Node 22/24
    × ubuntu/windows + Bun), release workflow with npm provenance.
12. **Spec tooling** — `SPEC_VERSION`, `sync-spec.mjs`, `gen-types.mjs --check` (with `$defs`
    normalisation).

## Repo layout

```
ligaxai-typescript/
├── .github/workflows/     ci.yml · release.yml
├── .changeset/            config.json · README.md
├── conformance/           cases/*.json · sse/*.txt (+ .expected.json) · README.md
├── docs/                  ai-stack · SUMMARY · STATUS · DECISIONS · TEMPLATE-TOKENS · .last-tracked-commit
├── examples/nextjs-app/   App Router chat: createRunRoute + useLigaXChat
├── openapi/               openapi.json — the Agent API contract (public-api-spec-v0.2.0)
├── packages/
│   ├── sdk/               src/{client,index,types,errors,webhooks,next,ai-sdk,version}.ts, src/core/*, src/lib/{lae,run-stream,text-assembler}.ts, src/resources/*, src/generated/*
│   ├── react/             src/{provider.tsx,chat.ts,index.ts}
│   └── widget/            src/{index,global,element,session,markdown,styles,react}.ts
├── scripts/               bootstrap.mjs · gen-types.mjs · sync-spec.mjs
├── SPEC_VERSION           public-api-spec-v0.2.0
└── package.json · pnpm-workspace.yaml · tsconfig.base.json · vitest.config.ts · CLAUDE.md · README.md · SECURITY.md · LICENSE
```

## Deliberately left out of the base

ESLint, a runtime schema validator in the SDK, a browser E2E suite, Deno/workerd CI jobs (add when a
consumer needs them), Dependabot/Renovate config (org policy decides).

## What's next

- Once the spec repo publishes release assets, switch `openapi/` and `conformance/` to
  `pnpm sync-spec` instead of the hand copy.
- Stream resume in the AI SDK transport (`reconnectToStream`), and the widget on the LAE stream.
- First manual publish of each package, then enable trusted publishing on npm.
- Replace `security@ligaments.ai` in SECURITY.md.
