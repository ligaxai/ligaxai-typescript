# @ligaxai/widget

## 0.1.0

### Minor Changes

- [#5](https://github.com/ligaxai/ligaxai-typescript/pull/5) [`259e164`](https://github.com/ligaxai/ligaxai-typescript/commit/259e1642d06a6d8c5af3c69dfb0029d0653523b3) Thanks [@sadain](https://github.com/sadain)! - Browser access with client tokens. `@ligaxai/sdk`: `client.clientTokens.create()`; `apiKey` accepts
  a token provider (refreshed once on `401 token_expired`) and `cachedTokenProvider()`; in a browser
  the client accepts `lgx_ct_`/`lgx_pk_` keys and providers and still refuses secret keys;
  `createTokenRoute` in `/next`; `createLigaXTransport({ getToken })` direct mode in `/ai-sdk`.
  `@ligaxai/react`: `useLigaXChat` / `useLigaXTransport` direct mode (`getToken`, or provider
  `baseURL` + `getClientToken`, which may now return `{ token, expires_at }`). `@ligaxai/widget`:
  rebuilt on the v0.1 API as the `<ligax-chat>` custom element (publishable key or token URL,
  streaming, approvals, safe rendering, theming) with `mount()`, `define()`, `autoInit()` and
  `<LigaXChat>` from `@ligaxai/widget/react`; the old `init()` API is removed.

- [#7](https://github.com/ligaxai/ligaxai-typescript/pull/7) [`f4d6a28`](https://github.com/ligaxai/ligaxai-typescript/commit/f4d6a2861d16519bbb4c2793a6ead5fb0feb99dd) Thanks [@sadain](https://github.com/sadain)! - End users connect their own accounts (`public-api-spec-v0.3.0`). `@ligaxai/sdk`:
  `client.connectSessions.create/get`, `client.endUsers.connections.list/delete`, the
  `connection.created` / `connection.deleted` webhook events, and `connectAccount()` — opens the
  consent popup from a click, polls the session to `succeeded`/`denied`/`failed`/`expired` and closes
  the popup (`ConnectAccountError` for a blocked or closed popup, `TimeoutError` when it runs out),
  and `client.connectSessions.wait()`. `@ligaxai/react`: `useConnectAccount()`. `@ligaxai/widget`:
  `data-connectors="gmail,outlook"` shows a "Connect your account" area with one button per connector.

- [#8](https://github.com/ligaxai/ligaxai-typescript/pull/8) [`7ae017c`](https://github.com/ligaxai/ligaxai-typescript/commit/7ae017c4a2ca2adac396b4b71dc65984a2e8b6f1) Thanks [@sadain](https://github.com/sadain)! - Files for runs (`public-api-spec-v0.5.0`). `@ligaxai/sdk`:
  `client.files.create(file, { endUserId })` uploads a `Blob`/`File` or raw bytes as
  `multipart/form-data` (over 25 MB throws `FileTooLargeError` before anything is sent), plus
  `files.get` and `files.delete`; pass the ids as `attachments` to `runs.create`, `runs.stream` or
  `runs.wait`. Works with client tokens in the browser. `webhooks.create` replays are documented and
  tested: a repeated `Idempotency-Key` returns the same endpoint and secret. `@ligaxai/widget`:
  `data-files="true"` adds a file attach button whose uploads go with the visitor's next message.

- [#34](https://github.com/ligaxai/ligaxai-typescript/pull/34) [`051e3d0`](https://github.com/ligaxai/ligaxai-typescript/commit/051e3d06693ce2d104515a091a533849de2aa807) Thanks [@ligaments-sadain](https://github.com/ligaments-sadain)! - **Breaking: no built-in base URL.** `DEFAULT_BASE_URL` is removed. The API root comes from `baseURL`
  or `LIGAX_BASE_URL` for every environment, production included; without one the constructor throws
  the new `MissingBaseURLError` before any request. A browser has no environment, so browser code
  (direct mode, `LigaXProvider`, the widget) must pass `baseURL` — for the widget, `data-base-url` /
  `base-url` / `baseURL` is now required. The vendored spec's `servers` entry is the relative
  `/api/public/v1`, and `pnpm sync-spec` rewrites it that way on each sync, so no deployment host
  ships in the packages or their docs.

- [#8](https://github.com/ligaxai/ligaxai-typescript/pull/8) [`511f174`](https://github.com/ligaxai/ligaxai-typescript/commit/511f174f4f2429b23a1d498857cff0acbeb1127a) Thanks [@sadain](https://github.com/sadain)! - Anonymous website visitors chat only: the widget hides file attach and account connections on a
  website key and shows a "waiting for the team" notice instead of an approval card. The approval card
  also reads the tool name from the safe `interrupt.raised` payload. The SDK pins spec 0.6.0
  (`409 idempotency_in_progress` is retried; run events are a safe subset).

### Patch Changes

- [#21](https://github.com/ligaxai/ligaxai-typescript/pull/21) [`5507e23`](https://github.com/ligaxai/ligaxai-typescript/commit/5507e234760d4a307e5392037642ea5706c0b715) Thanks [@ligaments-sadain](https://github.com/ligaments-sadain)! - Spec 0.7.0: a profile reports `tool_access` (`read_only`, `read_write` or `custom`) and `approvals`
  (`server` or `end_users`). The widget shows a "your team will answer" notice when a profile keeps
  approvals for the site's server, instead of an error.

- [#15](https://github.com/ligaxai/ligaxai-typescript/pull/15) [`4a7f680`](https://github.com/ligaxai/ligaxai-typescript/commit/4a7f68026d69aee8678e21b117710881540d367c) Thanks [@ligaments-sadain](https://github.com/ligaments-sadain)! - Safer defaults before the first public release:
  
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

- [#34](https://github.com/ligaxai/ligaxai-typescript/pull/34) [`051e3d0`](https://github.com/ligaxai/ligaxai-typescript/commit/051e3d06693ce2d104515a091a533849de2aa807) Thanks [@ligaments-sadain](https://github.com/ligaments-sadain)! - Each package's README is now its complete user guide, which is also its npm page: what you need
  (base URL, key, profile id) and the words it uses, install, configure with both required variables,
  a complete quickstart, common tasks, reference tables (configuration, errors, retries and timeouts)
  and a section for AI coding assistants. All links are absolute so they work on npm. Package
  descriptions and keywords now say what each package does.
- Updated dependencies [[`3430d07`](https://github.com/ligaxai/ligaxai-typescript/commit/3430d074486d58abbd69ddd4d1f68149946a3a95), [`259e164`](https://github.com/ligaxai/ligaxai-typescript/commit/259e1642d06a6d8c5af3c69dfb0029d0653523b3), [`f4d6a28`](https://github.com/ligaxai/ligaxai-typescript/commit/f4d6a2861d16519bbb4c2793a6ead5fb0feb99dd), [`7ae017c`](https://github.com/ligaxai/ligaxai-typescript/commit/7ae017c4a2ca2adac396b4b71dc65984a2e8b6f1), [`051e3d0`](https://github.com/ligaxai/ligaxai-typescript/commit/051e3d06693ce2d104515a091a533849de2aa807), [`085891a`](https://github.com/ligaxai/ligaxai-typescript/commit/085891ad5cbf5b2e058d16d1bd44a42ed38eda89), [`5507e23`](https://github.com/ligaxai/ligaxai-typescript/commit/5507e234760d4a307e5392037642ea5706c0b715), [`4a7f680`](https://github.com/ligaxai/ligaxai-typescript/commit/4a7f68026d69aee8678e21b117710881540d367c), [`051e3d0`](https://github.com/ligaxai/ligaxai-typescript/commit/051e3d06693ce2d104515a091a533849de2aa807), [`511f174`](https://github.com/ligaxai/ligaxai-typescript/commit/511f174f4f2429b23a1d498857cff0acbeb1127a), [`0c92357`](https://github.com/ligaxai/ligaxai-typescript/commit/0c92357480a6879c35ba35d4b511f9a23b4b85ac)]:
  - @ligaxai/sdk@0.1.0
