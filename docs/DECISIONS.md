# Architectural Decisions

Append-only. ISO dates. Never delete existing entries.

---

## 2026-10-22 — Hand-written SDK in the openai-node shape; only types are generated

**Context:** The API is small (~15 endpoints) and the DX bar is "feels like the OpenAI SDK".
Generators (Stainless, Fern, openapi-generator) either cost money, impose their own shape, or
produce code nobody wants to read.

**Decision:** Hand-write `client`, `core/*`, resources and adapters. Generate **only**
`src/generated/types.ts` with openapi-typescript from the spec tag in `SPEC_VERSION`; CI fails if
the committed file differs from a fresh run.

**Consequences:** A new endpoint is a 5-line resource method plus a conformance case. The Python SDK
mirrors the same layout so behaviour stays in lockstep.

**Reference:** `packages/sdk/src/resources/runs.ts` (was `health.ts`), `scripts/gen-types.mjs`

---

## 2026-10-22 — tsdown, ESM + CJS with fixed extensions, `platform: neutral`

**Context:** Consumers include Next.js (ESM), Jest/`require` users, Bun, workerd. One more major of
CJS support was agreed; after that CJS is dropped.

**Decision:** tsdown with `format: ['esm','cjs']`, `fixedExtension: true` (`.mjs`/`.cjs` so the
consumer's `"type"` never changes meaning), `dts`, `platform: neutral` (no `node:` imports in
`src`). `exports` map lists `types/import/require` per subpath; publint `--strict` in `check`.

**Consequences:** `eventsource-parser@4` is ESM-only, so the CJS build loads it through Node's
`require(esm)` (Node ≥ 22.12, which the dependency itself already requires). Bundling it into the
CJS output was rejected to avoid two copies in apps that also use the AI SDK.

**Reference:** `packages/sdk/tsdown.config.ts`, `packages/sdk/package.json`

---

## 2026-10-22 — Optional peers are type-only; the React hook receives `useChat`

**Context:** `/ai-sdk` and `/next` must not force `ai` or `next` onto every consumer, and
`@ligaxai/react` must work for people who only want the transport.

**Decision:** `ai`, `next` and `@ai-sdk/react` are imported with `import type` and marked
`external`. `useLigaXChat({ useChat, ... })` takes the hook as a parameter instead of importing it —
a lazy `import()` cannot satisfy React's synchronous hook rules, and a static import would make the
peer mandatory.

**Consequences:** One extra argument in the hook call; in exchange the app controls which AI SDK
copy runs, and the package tests need neither `ai` nor `@ai-sdk/react` at runtime.

**Reference:** `packages/react/src/chat.ts`, `packages/sdk/src/ai-sdk.ts`

---

## 2026-10-22 — Retry policy fixed in code and fixtures, never 402/403

**Context:** Retries on a payment-required or forbidden response double-bill or hammer an auth
system; `Retry-After` from a load balancer can be hours.

**Decision:** Retry network errors, 408/409/429/5xx; honour `retry-after-ms`, then `retry-after`
(seconds or HTTP-date) capped at 120 s, else 0.5 s → 8 s with 25 % jitter;
`x-should-retry: true|false` overrides everything; never retry 402/403; never retry once a response
body stream has started. The `Idempotency-Key` is minted once per logical request.

**Consequences:** `shouldRetry`/`retryDelay`/`backoffDelay` are exported from `core/base-client` so
tests and the conformance runner assert on the exact rules.

**Reference:** `packages/sdk/src/core/base-client.ts`, `packages/sdk/tests/retries.test.ts`

---

## 2026-10-22 — Standard Webhooks re-implemented with WebCrypto (~40 lines)

**Context:** `standardwebhooks` on npm has no `exports` map and a sync pure-JS SHA-256; the SDK must
run in workerd and browsers.

**Decision:** Implement verify/sign with `crypto.subtle` under `@ligaxai/sdk/webhooks` using the
standard's header names and `v1,` scheme, so the official library stays a drop-in.

**Reference:** `packages/sdk/src/webhooks.ts`

---

## 2026-10-22 — Prettier only; no ESLint in the base

**Context:** The template must stay small and the gate must be fast and unambiguous.

**Decision:** `pnpm lint` is `prettier --check`. TypeScript strict mode carries the correctness
load. ESLint may be added per project with a decision entry.

**Reference:** `package.json`, `.prettierrc`

---

## 2026-10-22 — Template tokens + `bootstrap.mjs` (not cookiecutter)

**Context:** The repo must be a runnable, CI-tested SDK _and_ a clone-and-rename template.

**Decision:** Plain identifiers (`LigaX`, `@ligaxai`, `ligaxai-typescript`, `LigaX AI`, `ligaxai`,
`https://enterprise.ligax.ai/api/public/v1`) replaced by a dependency-free Node script over
`git ls-files`, longest tokens first, skipping the lockfile.

**Reference:** `scripts/bootstrap.mjs`, `docs/TEMPLATE-TOKENS.md`

---

## 2026-10-22 — Normalise the spec's `$defs` in `gen-types`, not in the contract file

**Context:** The platform builds `openapi.json` from zod with `toJSONSchema`, which emits shared
shapes as inline `$defs` referenced by `#/$defs/<Name>`. Inside an OpenAPI document that pointer
resolves against the document root, so openapi-typescript refuses the spec.

**Decision:** Commit the contract byte-for-byte as the platform publishes it; `gen-types.mjs` hoists
every `$defs` entry into `components.schemas` and rewrites the pointers before generation, and fails
if two same-named `$defs` differ. The drift check runs the same normalisation.

**Consequences:** The shared shapes get names (`Run`, `RunStatus`, `Profile`, `RunEvent`). The real
fix belongs in the platform's `src/lib/public-api/openapi.ts` (emit `components.schemas`); once it
does, the normalisation becomes a no-op.

**Reference:** `scripts/gen-types.mjs`, `openapi/README.md`

---

## 2026-10-22 — The SDK assembles text by offset; the browser gets LAE, not a UI stream

**Context:** `POST /runs` in `stream` mode passes the engine's LAE frames through. `text.delta` is
offset-addressed (UTF-16) and a resume replays frames; appending deltas works on a clean run and
duplicates text on every resume.

**Decision:** `TextAssembler` writes each delta at its offset per `part_id`, yields only new
contiguous text, and joins text parts in `part.start` order — the platform's own fold rule.
`createRunRoute` returns the LAE stream unchanged and `createLigaXTransport` translates it to
`UIMessageChunk`s in the browser, so one wire serves `useChat`, the raw SDK and any other client.

**Consequences:** The translation (and its tool/interrupt mapping) ships in the browser bundle of
`/ai-sdk`; a server-side translation is available as `toUIMessageChunks` for apps that prefer the AI
SDK's own stream. The conversation id rides `X-Conversation-Id` → `conversation_id`, held per chat
in the transport.

**Reference:** `packages/sdk/src/lib/text-assembler.ts`, `packages/sdk/src/ai-sdk.ts`,
`packages/sdk/src/next.ts`

---

## 2026-10-22 — The browser guard keys on the credential, and a token is a provider

**Context:** Phase 5 gives browsers their own credentials: client tokens (`lgx_ct_`, minutes long,
bound to one profile and end user) and publishable keys (`lgx_pk_`, widget sessions only). The
client refused every browser unless `dangerouslyAllowBrowser` was set, which taught integrators to
set it — and the flag then lets a secret key through too.

**Decision:** In a browser-like environment the client accepts an `lgx_ct_`/`lgx_pk_` string or a
token **provider** without the flag, and refuses anything else (a provider's answer is checked per
request). `apiKey` may be `({ refresh }) => string`: called before each request, and once with
`refresh: true` when the API answers `401 token_expired` — resent with the same idempotency key and
without spending the retry budget. `cachedTokenProvider` holds a token until 30 s before
`expires_at`. The refresh lives in `base-client.ts` with the rest of the pipeline.

**Consequences:** `dangerouslyAllowBrowser` is now only for the deliberate exception. The API still
refuses a secret key sent with an `Origin`. The Python SDK has no browser and needs no counterpart;
the refresh rule (one refresh, only on `token_expired`) is TS-only until a server-side token use
needs it.

**Reference:** `packages/sdk/src/client.ts`, `packages/sdk/src/core/base-client.ts`,
`packages/sdk/src/lib/token-provider.ts`

---

## 2026-10-22 — The widget is a custom element; model text never reaches `innerHTML`

**Context:** The template widget was an `innerHTML`-built panel on a pre-LAE event shape. A website
widget renders text a prompt injection may control, inside pages whose CSS it does not own.

**Decision:** `<ligax-chat>`, a framework-free custom element in an open Shadow DOM, created lazily
so SSR imports never touch `HTMLElement`. It runs on the SDK client (`runs.stream`,
`resolveInterrupt`, `followEvents`) and `TextAssembler`, not its own fetch/SSE code. Answers are
built as DOM nodes from a tiny markdown subset (paragraphs, bold, code, fenced code, `https:`-only
links with `rel="noopener noreferrer"`; no images). The React wrapper lives at
`@ligaxai/widget/react` with `react` as an optional peer, so `@ligaxai/react` does not depend on the
widget and widget users without React install nothing extra. File upload is deferred (no files API).

**Consequences:** The IIFE inlines the SDK client (≈ 42 KB min / 15 KB gzip). A richer markdown
(lists, tables) is a renderer change, never `innerHTML`. Interrupt kinds other than `tool_approval`
are offered only as Dismiss until the widget renders forms.

**Reference:** `packages/widget/src/element.ts`, `packages/widget/src/markdown.ts`,
`packages/widget/src/react.ts`
