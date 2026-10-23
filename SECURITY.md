# Security Policy

## Reporting a vulnerability

Email **security@ligaments.ai** with a description and steps to reproduce. Please do not open a
public issue, pull request or discussion for a security report. We acknowledge reports within 2
business days and tell you when a fix ships; we credit reporters who want to be credited.

## Supported versions

The latest minor release of each package (`@ligaxai/sdk`, `@ligaxai/react`, `@ligaxai/widget`)
receives security fixes. Pre-releases under the `dev` dist-tag are for testing and receive none.

## What the SDK does with credentials

- **A secret key (`lgx_sk_…`) belongs on your server only.** In a browser-like environment the
  client refuses any credential that is not made for browsers — it accepts only a client token
  (`lgx_ct_…`), a publishable key (`lgx_pk_…`) or a function that returns one — unless you pass
  `dangerouslyAllowBrowser: true`. The API also refuses a secret key sent from a browser.
- The client refuses to start without a usable key, and accepts `http://` only for `localhost`.
- The key is sent only as `Authorization: Bearer` to `baseURL`. Request paths cannot leave
  `baseURL`, and redirects are not followed.
- The key is never logged: the logger redacts `Authorization`, `X-Api-Key` and cookies at every
  level, and `console.log(client)`, `util.inspect` and `JSON.stringify` do not show it.
- The Next.js helpers (`@ligaxai/sdk/next`) refuse to run for anyone unless you say who the
  signed-in user is (`resolveEndUser`) or opt in to anonymous use (`allowAnonymous`), pin the
  profile on the server, refuse cross-site requests, and never pass refusals about your own key on
  to the browser.
- Webhook verification (`@ligaxai/sdk/webhooks`) uses a constant-time comparison and a 5-minute
  timestamp window.

## Supply chain

- Runtime dependencies are pinned to exact versions, and CI runs `pnpm audit --prod`.
- Releases are built and published from GitHub Actions with npm trusted publishing (OIDC) and
  provenance, so each version can be traced to the commit and workflow that built it. No npm token
  is stored anywhere. Verify with `npm audit signatures`.
- Workflow actions are pinned to commit SHAs.
