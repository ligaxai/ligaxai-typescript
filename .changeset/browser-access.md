---
'@ligaxai/sdk': minor
'@ligaxai/react': minor
'@ligaxai/widget': minor
---

Browser access with client tokens. `@ligaxai/sdk`: `client.clientTokens.create()`; `apiKey` accepts
a token provider (refreshed once on `401 token_expired`) and `cachedTokenProvider()`; in a browser
the client accepts `lgx_ct_`/`lgx_pk_` keys and providers and still refuses secret keys;
`createTokenRoute` in `/next`; `createLigaXTransport({ getToken })` direct mode in `/ai-sdk`.
`@ligaxai/react`: `useLigaXChat` / `useLigaXTransport` direct mode (`getToken`, or provider
`baseURL` + `getClientToken`, which may now return `{ token, expires_at }`). `@ligaxai/widget`:
rebuilt on the v0.1 API as the `<ligax-chat>` custom element (publishable key or token URL,
streaming, approvals, safe rendering, theming) with `mount()`, `define()`, `autoInit()` and
`<LigaXChat>` from `@ligaxai/widget/react`; the old `init()` API is removed.
