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

| Package                      | Platform | Runtime deps                                      | Optional peers (type-only)                |
| ---------------------------- | -------- | ------------------------------------------------- | ----------------------------------------- |
| `@base-project-scope/sdk`    | neutral  | `eventsource-parser`                              | `ai`, `next`                              |
| `@base-project-scope/react`  | browser  | `@base-project-scope/sdk`                         | `react` (required), `ai`, `@ai-sdk/react` |
| `@base-project-scope/widget` | browser  | `@base-project-scope/sdk` (library) / none (IIFE) | —                                         |

## Wire contracts the SDK encodes

- **Auth** `Authorization: Bearer <key>`; **UA** `base-project-slug-typescript/<version>`.
- **Request id** response header `x-request-id` → `error.request_id` / `result._request_id`.
- **Errors** `{ error: { type, code, message, request_id, param } }`; class chosen by status.
- **Idempotency** `Idempotency-Key` UUIDv4 on every POST, reused across retries.
- **Retries** see CLAUDE.md non-negotiable 2.
- **Streaming** SSE, JSON per `data:` line, `data: [DONE]` sentinel, `id:` tracked for resume.
- **Pagination** `{ data: T[], next_page: string | null }`, cursor sent as `?page=`.
- **Webhooks** Standard Webhooks: `webhook-id`, `webhook-timestamp`, `webhook-signature` (`v1,<b64>`
  HMAC-SHA256 over `id.timestamp.body`, `whsec_` secret, 5-minute tolerance).
- **AI SDK UI stream** `UIMessageChunk` JSON per SSE event, `[DONE]` dropped; reconnect GET answers
  204 for "nothing to resume".

## Spec and parity

`SPEC_VERSION` (file) names the spec release tag. `pnpm sync-spec` downloads `openapi.json` and
`conformance.tar.gz` from the `<org>/<slug>-spec` GitHub release; `pnpm gen:types` regenerates
`packages/sdk/src/generated/types.ts`; CI runs `gen-types --check`. The Python SDK pins the same tag
and runs the same fixtures.

## Environment variables

`BASE_PROJECT_API_KEY`, `BASE_PROJECT_BASE_URL`, `BASE_PROJECT_LOG` (`off|error|warn|info|debug`).
`GITHUB_TOKEN` is optional for `sync-spec`. Nothing is read at import time; only the client
constructor reads env.
