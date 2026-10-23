---
'@ligaxai/sdk': minor
'@ligaxai/widget': patch
---

Safer defaults before the first public release:

- `createRunRoute` and `createRunProxy` need `resolveEndUser` (or an explicit
  `allowAnonymous: true`) and answer 401 for a visitor who is not signed in; `createRunProxy` needs
  `profileId` and forwards only `input`, `conversation_id`, `attachments`, `metadata` and `mode`
  (`model` with `allowModel`).
- The Next.js helpers refuse cross-site requests and non-JSON bodies, and no longer pass refusals
  about your own key to the browser (they become a generic 502 with the request id).
- `new LigaX()` throws `MissingApiKeyError` without a usable key, accepts `http://` only for
  localhost, never prints the key when logged, refuses request paths outside `baseURL`, and does not
  follow redirects. A 409 is retried only when the API marks it retryable.
- `new Webhook()` throws on a missing or malformed secret.
- `connectAccount` only opens an https consent page, detached from your page.
