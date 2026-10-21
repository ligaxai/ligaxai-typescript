/**
 * GENERATED FILE PLACEHOLDER.
 *
 * Once `SPEC_VERSION` is set, `pnpm sync-spec && pnpm gen:types` overwrites this file from
 * `openapi/openapi.json` via openapi-typescript. CI then checks the regenerated output matches
 * what is committed. Until a spec exists this hand-written stub keeps the SDK compiling; keep
 * it to the shapes the example resource needs.
 */

/** `GET /health` */
export interface HealthResponse {
  status: 'ok' | 'degraded';
  version: string;
}
