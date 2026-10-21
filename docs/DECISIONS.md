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

**Reference:** `packages/sdk/src/resources/health.ts`, `scripts/gen-types.mjs`

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
`https://api.ligax.ai/api/public/v1`) replaced by a dependency-free Node script over `git ls-files`,
longest tokens first, skipping the lockfile.

**Reference:** `scripts/bootstrap.mjs`, `docs/TEMPLATE-TOKENS.md`
