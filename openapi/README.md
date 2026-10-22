# openapi/

`openapi.json` is the public Agent API contract (OpenAPI 3.1) for the tag in `SPEC_VERSION`
(`public-api-spec-v0.1.0`, `info.version` 0.1.0). It is committed so the generated types can be
checked against it: `pnpm gen:types` regenerates `packages/sdk/src/generated/types.ts`, and CI runs
`node scripts/gen-types.mjs --check` so the committed types can never drift from the spec they claim
to come from.

**Source.** Until the spec repository publishes release assets, the file is copied by hand from
`ligax-enterprise/docs/public-api/spec/openapi.json` (generated there from the route schemas by
`src/lib/public-api/openapi.ts`). Once releases exist, `pnpm sync-spec` replaces that step.

**Never edit it here.** The platform emits zod `$defs` blocks whose `#/$defs/…` pointers do not
resolve inside an OpenAPI document; `scripts/gen-types.mjs` normalises them (hoists each into
`components.schemas`) on the way into openapi-typescript instead of changing the contract file.
