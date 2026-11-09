---
'@ligaxai/sdk': minor
'@ligaxai/react': patch
'@ligaxai/widget': minor
---

**Breaking: no built-in base URL.** `DEFAULT_BASE_URL` is removed. The API root comes from `baseURL`
or `LIGAX_BASE_URL` for every environment, production included; without one the constructor throws
the new `MissingBaseURLError` before any request. A browser has no environment, so browser code
(direct mode, `LigaXProvider`, the widget) must pass `baseURL` — for the widget, `data-base-url` /
`base-url` / `baseURL` is now required. The vendored spec's `servers` entry is the relative
`/api/public/v1`, and `pnpm sync-spec` rewrites it that way on each sync, so no deployment host
ships in the packages or their docs.
