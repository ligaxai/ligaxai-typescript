# Project Status

Dashboard of plans, implementation progress, review verdicts, and team activity. Maintained
alongside every substantive change (see "Living docs" in [`CLAUDE.md`](../CLAUDE.md)).

**Status values:** `planned` · `in-progress` · `implemented` · `reviewed` · `published`

## Plans

| Plan ID | Title                                                                                                | Size | Date       | Author  | Status      | Review |
| ------- | ---------------------------------------------------------------------------------------------------- | ---- | ---------- | ------- | ----------- | ------ |
| SDK-0   | Project base setup — TypeScript SDK monorepo template (`ligax-enterprise` PLAN-2026-10-22-sdk-repos) | 🔴 L | 2026-10-22 | @sadain | implemented | —      |
| SDK-1   | First spec tag → `SPEC_VERSION`, generated types, real resources                                     | 🟡 M | 2026-10-22 | @sadain | implemented | —      |
| SDK-8   | First publish (manual) + trusted publishing                                                          | 🟢 S | —          | —       | planned     | —      |

## Team Activity

- 2026-10-24 — CI gate (`ci-gate`) on `main` and `dev`, and an allow-list that closes pull requests
  from other logins. GitHub rulesets for `main`/`dev` are repository settings.

### @sadain

- **Project base setup (2026-10-22)** — Scaffolded the workspace from the design brief: the
  `@ligaxai/sdk` client with the full request pipeline, streaming, pagination, errors and the
  `/next`, `/ai-sdk`, `/webhooks`, `/errors` subpaths; `@ligaxai/react`; `@ligaxai/widget` with an
  IIFE build; the Next.js example; spec/bootstrap scripts; CI + release workflows; living docs.
  `pnpm check` green on Node 24.12.

- **Agent API v0.1 (2026-10-22, `feat/agent-api-v0.1`, unpushed)** — spec `public-api-spec-v0.1.0`
  and generated types; runs/conversations/profiles/keys/usage resources; `RunStream` +
  `TextAssembler`; `createLigaXTransport`; `createRunRoute` / `createRunProxy`; `useLigaXChat` on
  the LAE transport; working Next.js example. `pnpm check` green.

- **Webhook endpoints (2026-10-22, `feat/agent-api-v0.1`, unpushed)** — spec re-copied with
  `/webhooks*` and the outgoing-event `webhooks` section; `client.webhooks`
  (`create/list/get/update/delete/test`); `Webhook.verify()` typed as `WebhookEvent`, Standard
  Webhooks reference vector pinned; README Webhooks guide. `pnpm check` green.

- **Browser access + widget (2026-10-22, `feat/browser-access`, unpushed)** — platform Phase 5 on
  the SDK side: spec `public-api-spec-v0.2.0` (client tokens, widget sessions);
  `clientTokens.create`, token providers with one refresh on `token_expired`, browser guard by key
  prefix; `createTokenRoute`; direct token mode in `createLigaXTransport` / `useLigaXChat`;
  `@ligaxai/widget` rebuilt as `<ligax-chat>` (+ `@ligaxai/widget/react`); example `/direct` page.
  `pnpm check` green. Not yet run against a live platform.

- **End users' own accounts (2026-10-22, `feat/end-user-connections`, unpushed)** — platform Phase 6
  on the SDK side: spec `public-api-spec-v0.3.0`; `connectSessions.create/get`,
  `endUsers.connections.list/delete`, `connection.*` webhook events; `connectAccount()`
  popup-and-poll helper; `useConnectAccount()`; widget `data-connectors`. `pnpm check` green. Not
  yet run against a live platform.

- **Files and protocols (2026-10-22, `feat/files-and-protocols`, unpushed)** — platform Phases 7–8
  on the SDK side: spec `public-api-spec-v0.5.0`; `files.create/get/delete` (multipart, client-side
  25 MB guard, `FileTooLargeError`); `attachments` on runs; `webhooks.create` idempotent replay
  documented and tested; widget `data-files` attach button; README sections for files and for
  MCP/A2A clients (no SDK surface — clients connect directly). `pnpm check` green. Not yet run
  against a live platform.

## Unplanned Changes

_None tracked yet._
