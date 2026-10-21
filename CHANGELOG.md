# Changelog

Repository-level changes (tooling, docs, CI). Package changelogs are written by Changesets into
`packages/*/CHANGELOG.md`. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added — Project base setup

Template skeleton for the __PROJECT_TITLE__ TypeScript SDK monorepo (`base-project-slug`).

- **Workspace** — pnpm 10 workspace (`packages/*`, `examples/*`), strict `tsconfig.base.json`
  (ES2022, Bundler resolution, `exactOptionalPropertyTypes`), Prettier, EditorConfig, Changesets
  (linked versions, public access), Apache-2.0.
- **`@base-project-scope/sdk`** — `BaseProject` client (env/arg options, browser guard, injected
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
- **`@base-project-scope/react`** — `BaseProjectProvider`, `useBaseProject`,
  `useBaseProjectTransport`, `useBaseProjectChat` (takes `useChat` as a parameter so
  `@ai-sdk/react` stays an optional peer). Testing Library test under jsdom.
- **`@base-project-scope/widget`** — vanilla-DOM chat panel, `init()` + `autoInit()` from script
  data attributes; library build plus a self-contained IIFE `dist/widget.global.js` exposing
  `window.BaseProjectWidget`.
- **Example** — `examples/nextjs-app` (Next 16 App Router) using `createRouteHandler`;
  typechecked in CI, not built.
- **Scripts** — `bootstrap.mjs` (token rename over `git ls-files`), `gen-types.mjs`
  (openapi-typescript with `--check` drift gate), `sync-spec.mjs` (release-asset download for
  `SPEC_VERSION`).
- **CI** — `ci.yml` (Node 22/24 × ubuntu/windows running `pnpm check`, plus a Bun vitest job and
  `pnpm audit --prod`), `release.yml` (Changesets version PR + publish with npm provenance).
- **Docs** — README, CLAUDE.md, SECURITY.md, `docs/{ai-stack,SUMMARY,STATUS,DECISIONS,
  TEMPLATE-TOKENS}.md`, `conformance/README.md`. (by @sadain, 2026-10-22)
