# Project Summary — **PROJECT_TITLE** TypeScript SDK

> Living summary maintained alongside every substantive change (see "Living docs" in
> [`CLAUDE.md`](../CLAUDE.md)). For authoritative stack facts prefer
> [`docs/ai-stack.md`](./ai-stack.md) — this file contextualises and builds on it.

## What this project is

**`ligaxai-typescript`** publishes the official TypeScript packages for the **PROJECT_TITLE** API:
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
   status, with `status`, `request_id`, `code`, `type`, `param`.
6. **Subpaths** — `/errors`, `/webhooks` (Standard Webhooks with WebCrypto), `/next`
   (`createRouteHandler` → `{ GET, POST }` with stream passthrough), `/ai-sdk`
   (`createChatTransport` → Vercel AI SDK `ChatTransport`).
7. **React** — `LigaXProvider`, `useLigaX`, `useLigaXTransport`, `useLigaXChat({ useChat, ... })`.
8. **Widget** — `init()` / `autoInit()`; ESM/CJS library plus IIFE `dist/widget.global.js` exposing
   `window.LigaXWidget`.
9. **Tests** — 71 vitest cases across the three packages, all through an injected `fetch`;
   conformance runner over `conformance/`.
10. **Build & release** — tsdown ESM + CJS + d.ts, publint strict, Changesets, CI matrix (Node 22/24
    × ubuntu/windows + Bun), release workflow with npm provenance.
11. **Spec tooling** — `SPEC_VERSION`, `sync-spec.mjs`, `gen-types.mjs --check`.

## Repo layout

```
ligaxai-typescript/
├── .github/workflows/     ci.yml · release.yml
├── .changeset/            config.json · README.md
├── conformance/           cases/*.json · sse/*.txt (+ .expected.json) · README.md
├── docs/                  ai-stack · SUMMARY · STATUS · DECISIONS · TEMPLATE-TOKENS · .last-tracked-commit
├── examples/nextjs-app/   App Router example using @ligaxai/sdk/next
├── openapi/               openapi.json lands here via sync-spec (not committed until SPEC_VERSION is set)
├── packages/
│   ├── sdk/               src/{client,index,errors,webhooks,next,ai-sdk,version}.ts, src/core/*, src/resources/*, src/generated/*
│   ├── react/             src/{provider.tsx,chat.ts,index.ts}
│   └── widget/            src/{index,global}.ts
├── scripts/               bootstrap.mjs · gen-types.mjs · sync-spec.mjs
├── SPEC_VERSION           "unset" until the first spec release
└── package.json · pnpm-workspace.yaml · tsconfig.base.json · vitest.config.ts · CLAUDE.md · README.md · SECURITY.md · LICENSE
```

## Deliberately left out of the base

Real resources beyond `health` (they come from the spec), ESLint, a runtime schema validator in the
SDK, a browser E2E suite, Deno/workerd CI jobs (add when a consumer needs them), Dependabot/Renovate
config (org policy decides).

## What's next

- Set `SPEC_VERSION` once the spec repo publishes `spec-v0.1.0`; run
  `pnpm sync-spec && pnpm gen:types`; replace the `health` stub with the real resources.
- First manual publish of each package, then enable trusted publishing on npm.
- Replace `security@ligaments.ai` in SECURITY.md.
