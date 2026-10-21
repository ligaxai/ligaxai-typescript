# CLAUDE.md

**PROJECT_TITLE** TypeScript SDK (`base-project-slug`) — a pnpm workspace publishing
`@base-project-scope/sdk`, `@base-project-scope/react` and `@base-project-scope/widget`. Node 22+,
pnpm 10. Hand-written in the openai-node / anthropic-sdk-typescript shape; only the request and
response **types** are generated from the API spec.

**Ground truth:** `docs/ai-stack.md` for stack facts; `docs/SUMMARY.md` + `docs/STATUS.md` for where
the project stands. This file holds the invariants.

## Commands

- `pnpm check` — typecheck + prettier + vitest + build + publint. **Must pass before "done".**
- `pnpm test` / `pnpm --filter @base-project-scope/sdk test` — vitest (root runs all projects).
- `pnpm build` — tsdown for the three packages (the example app is deliberately not built).
- `pnpm sync-spec` then `pnpm gen:types` — refresh `openapi/openapi.json` and the generated types
  for the tag in `SPEC_VERSION`. `node scripts/gen-types.mjs --check` is the CI drift gate.
- `pnpm changeset` — every user-visible change to a package ships with one.
- **`pnpm` only.** Never npm/yarn; never edit `pnpm-lock.yaml` by hand. Pin exact versions.

## Non-negotiables

1. **The request pipeline lives in one place.** `packages/sdk/src/core/base-client.ts` owns auth,
   User-Agent, idempotency, retries, timeouts, request-id capture and parsing. A resource method is
   a path plus a type (`src/resources/health.ts` is the reference). Never call `fetch` from a
   resource, adapter or React hook.
2. **Retry policy is a contract.** Retry on network errors, 408/409/429 and 5xx; honour
   `retry-after-ms`, then `retry-after` (seconds or HTTP-date, capped at 120 s), else 0.5 s → 8 s
   with 25 % jitter; `x-should-retry` overrides; **never** retry 402/403; never retry once a stream
   has started; the same `Idempotency-Key` is reused across attempts. The conformance fixtures and
   Python SDK encode the same rules — change them together or not at all.
3. **Secrets never reach a browser bundle.** The client throws in a browser-like environment unless
   `dangerouslyAllowBrowser` is set; `react` and `widget` work with client tokens / publishable keys
   only. The logger redacts `Authorization` at every level.
4. **Optional peers are type-only.** `ai`, `next`, `@ai-sdk/react` are imported with `import type`
   and listed in `tsdown` `external`. Importing one at runtime makes it mandatory for every consumer
   — the React hook takes `useChat` as a parameter for exactly this reason.
5. **Types are generated, never hand-edited.** `packages/sdk/src/generated/types.ts` comes from
   `openapi/openapi.json`; the stub in the template exists only so the SDK compiles before a spec
   exists. Anything hand-written there is lost on the next `pnpm gen:types`.
6. **Exports map is the public surface.** Every subpath (`.`, `./next`, `./ai-sdk`, `./webhooks`,
   `./errors`) ships `types/import/require` conditions, ESM + CJS, and `publint --strict` must stay
   clean. A new subpath = `tsdown` entry + `exports` entry + test.
7. **Conformance fixtures are shared with the Python SDK.** `conformance/cases/*.json` and
   `conformance/sse/*.txt` are language-neutral; a case that only one SDK can pass is a spec bug.
   The runner is `packages/sdk/tests/conformance.test.ts`.
8. **Template tokens stay intact on the template branch.** `docs/TEMPLATE-TOKENS.md` lists them;
   `scripts/bootstrap.mjs` rewrites them. Don't hard-code a product name where a token belongs.

## Layout

```
packages/sdk     src/{client,index,errors,webhooks,next,ai-sdk,version}.ts
                 src/core/{base-client,errors,streaming,pagination,logging}.ts
                 src/resources/{resource,health}.ts · src/generated/types.ts · tests/
packages/react   src/{provider.tsx,chat.ts,index.ts} · tests/
packages/widget  src/{index,global}.ts · tests/        (IIFE: dist/widget.global.js)
examples/nextjs-app   typechecked in CI, never built there
conformance/     cases/*.json · sse/*.txt (+ .expected.json)
scripts/         bootstrap.mjs · gen-types.mjs · sync-spec.mjs
docs/            ai-stack · SUMMARY · STATUS · DECISIONS · CHANGELOG (root) · TEMPLATE-TOKENS
```

## Do / Don't

- Do keep the why-comments: the code explains a decision where one was made.
- Do test through an injected `fetch` (`tests/helpers.ts`); never hit the network in tests.
- Do use WebCrypto / Web Streams / `fetch` — no `node:` imports in `packages/*/src`.
- Don't add ESLint rules, a second bundler, or a runtime schema validator without a decision in
  `docs/DECISIONS.md`.
- Don't commit real secrets or dotenv files; the example reads env vars by name only.

## Living docs

`docs/CHANGELOG.md` is the root `CHANGELOG.md` (Keep a Changelog; Changesets writes the per-package
ones). `docs/SUMMARY.md`, `docs/STATUS.md`, `docs/DECISIONS.md` are updated with every substantive
change; `docs/.last-tracked-commit` is the sync checkpoint.
