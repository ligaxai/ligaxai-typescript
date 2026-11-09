# Contributing to the LigaX TypeScript SDK

Pull requests are accepted from the logins listed in `.github/CONTRIBUTORS`; others are closed
automatically. Issues are open to everyone.

## Set up and run the gate

```sh
pnpm install
pnpm check          # build + typecheck + prettier + vitest + publint — the CI gate
pnpm test           # vitest across all packages
pnpm changeset      # describe a user-facing change before opening a PR
```

CI also runs `node scripts/gen-types.mjs --check`, `pnpm audit --prod --audit-level high`, the SDK
tests under Bun, and zizmor over the workflows, and ends in one `ci-gate` job that branch protection
requires.

## The API contract

- `SPEC_VERSION` pins the public API spec tag. `openapi/openapi.json` is that spec, and
  `pnpm gen:types` regenerates the typed models from it (`openapi/README.md`).
- `pnpm sync-spec` downloads a spec release and rewrites its `servers` entry to the relative
  `/api/public/v1`. These packages ship no deployment host (docs/DECISIONS.md, 2026-11-09), and
  `packages/sdk/tests/no-deployment-hosts.test.ts` fails if one appears anywhere.

## Documentation

- Each `packages/*/README.md` is that package's user guide **and its npm page** (npm updates it only
  on publish). Keep them self-contained and user-facing, and use **absolute**
  `https://github.com/ligaxai/ligaxai-typescript/...` links: npm does not resolve relative links
  from a package folder.
- The repository `README.md` is a short page for choosing a package; it may use relative links
  because only GitHub shows it.
- `packages/sdk/tests/readme.test.ts` checks that every `@ligaxai/*` import in the READMEs names a
  real export and that package READMEs have no relative links.
- Never write a real host; use `https://<your-ligax-host>/api/public/v1`.
- Update `CHANGELOG.md` (repository) or add a changeset (packages), and the living docs in `docs/`,
  in the same pull request.

## Examples

`examples/nextjs-app` is typechecked in CI but not built; run it with
`pnpm --filter nextjs-app-example dev`.

## Releases

| Channel | Source                       | Version shape                  | Install                        |
| ------- | ---------------------------- | ------------------------------ | ------------------------------ |
| dev     | every push to `dev`          | `0.1.0-dev.42`, dist-tag `dev` | `npm install @ligaxai/sdk@dev` |
| stable  | Changesets release on `main` | `0.1.0`, dist-tag `latest`     | `npm install @ligaxai/sdk`     |

`.github/workflows/release.yml` publishes through npm trusted publishing with provenance; no npm
token is stored. Two repository variables switch the channels: `PUBLISH_DEV_ENABLED` and
`PUBLISH_MAIN_ENABLED` (exactly `true` to publish). On `main`, Changesets opens a "Version packages"
pull request; merging it publishes under `latest`.

## Using this repository as a template

This repository is also the base template for other SDKs. See `docs/TEMPLATE-TOKENS.md` and run
`node scripts/bootstrap.mjs <slug> <scope> <ClassPrefix> "<Title>" <org> <base-url>`.
