# Changelog

Repository-level changes (tooling, docs, CI). Package changelogs are written by Changesets into
`packages/*/CHANGELOG.md`. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

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
