# Project Status

Dashboard of plans, implementation progress, review verdicts, and team activity. Maintained
alongside every substantive change (see "Living docs" in [`CLAUDE.md`](../CLAUDE.md)).

**Status values:** `planned` · `in-progress` · `implemented` · `reviewed` · `published`

## Plans

| Plan ID | Title                                                                                                | Size | Date       | Author  | Status      | Review |
| ------- | ---------------------------------------------------------------------------------------------------- | ---- | ---------- | ------- | ----------- | ------ |
| SDK-0   | Project base setup — TypeScript SDK monorepo template (`ligax-enterprise` PLAN-2026-10-22-sdk-repos) | 🔴 L | 2026-10-22 | @sadain | implemented | —      |
| SDK-1   | First spec tag → `SPEC_VERSION`, generated types, real resources                                     | 🟡 M | —          | —       | planned     | —      |
| SDK-8   | First publish (manual) + trusted publishing                                                          | 🟢 S | —          | —       | planned     | —      |

## Team Activity

### @sadain

- **Project base setup (2026-10-22)** — Scaffolded the workspace from the design brief: the
  `@ligaxai/sdk` client with the full request pipeline, streaming, pagination, errors and the
  `/next`, `/ai-sdk`, `/webhooks`, `/errors` subpaths; `@ligaxai/react`; `@ligaxai/widget` with an
  IIFE build; the Next.js example; spec/bootstrap scripts; CI + release workflows; living docs.
  `pnpm check` green on Node 24.12.

## Unplanned Changes

_None tracked yet._
