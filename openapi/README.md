# openapi/

`openapi.json` is **not committed** until `SPEC_VERSION` points at a published spec tag; then
`pnpm sync-spec` downloads it here and `pnpm gen:types` regenerates
`packages/sdk/src/generated/types.ts`. CI runs `node scripts/gen-types.mjs --check` so the
committed types can never drift from the spec they claim to come from.
