# Base-project find-and-replace tokens

On the **template branch** this repo is `base-project-slug` / `__PROJECT_TITLE__`. Run
`scripts/bootstrap.mjs` to turn it into a real SDK; the table lists every token it rewrites.

```sh
node scripts/bootstrap.mjs <slug> <scope-without-@> <ClassPrefix> "<Title>" <org> <base-url> [ENV_PREFIX]
node scripts/bootstrap.mjs ligaxai-typescript ligaxai LigaX "LigaX" ligaxai https://api.ligax.ai/v1
pnpm install     # refresh pnpm-lock.yaml for the renamed packages
pnpm check
```

The script is idempotent, skips `pnpm-lock.yaml`, itself, this file and binary files, replaces
longer tokens before shorter ones (so `@base-project-scope` never half-matches `base-project-slug`),
and prints a per-token count.

## Tokens

| Token                  | Replace with                       | Where it appears                                                                                                                                       |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `base-project-slug`    | kebab-case repo name               | root `package.json` name, repository URLs, User-Agent `base-project-slug-typescript/<v>`, log prefix, sync-spec repo (`<slug minus -typescript>-spec`) |
| `@base-project-scope`  | npm scope with `@`                 | package names `@base-project-scope/{sdk,react,widget}`, workspace deps, imports, tsdown `external`, docs                                               |
| `BaseProject`          | PascalCase class prefix            | `class BaseProject`, `BaseProjectError`, `BaseProjectProvider`, `useBaseProject*`, `window.BaseProjectWidget`, `BaseProjectContextValue`               |
| `BASE_PROJECT_`        | derived: SCREAMING_SNAKE of prefix | env vars `BASE_PROJECT_API_KEY`, `BASE_PROJECT_BASE_URL`, `BASE_PROJECT_LOG` (derived automatically; not an argument)                                  |
| `__PROJECT_TITLE__`    | human title                        | README heading, package descriptions, LICENSE appendix, widget aria-label, Next example metadata                                                       |
| `__GITHUB_ORG__`       | GitHub org or user                 | repository URLs, CI badge, changeset changelog repo, `sync-spec` default                                                                               |
| `__DEFAULT_BASE_URL__` | production API base URL            | `DEFAULT_BASE_URL` in `packages/sdk/src/client.ts`, README options table                                                                               |

## Not tokens (edit by hand after bootstrap)

- `security@example.com` in `SECURITY.md`.
- `SPEC_VERSION` (`unset`) and the `health` example resource / generated-types stub.
- The `Copyright 2026 … contributors` line in `LICENSE`.
- `.nvmrc` if your team standardises on a different Node 22/24 patch.
