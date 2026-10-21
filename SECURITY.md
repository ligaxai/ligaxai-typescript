# Security Policy

## Reporting a vulnerability

Email **security@example.com** with a description and reproduction steps (replace before the first
public release). Do not open a public issue for security reports. We aim to acknowledge within 2
business days.

## Supported versions

The latest minor of each package (`@base-project-scope/sdk`, `/react`, `/widget`) receives fixes.
Older majors receive security fixes for 6 months after the next major ships.

## What the SDK does and does not do with secrets

- A secret API key (`BASE_PROJECT_API_KEY`) is sent only as `Authorization: Bearer` to `baseURL`. It
  is never logged: the logger redacts `Authorization`, `X-Api-Key` and cookies even at `debug`.
- The client refuses to construct in a browser-like environment unless
  `dangerouslyAllowBrowser: true` is passed; the React and widget packages are designed for
  short-lived client tokens / publishable keys, never a secret key.
- Webhook verification (`@base-project-scope/sdk/webhooks`) uses a constant-time compare and a
  5-minute timestamp tolerance.
- Dependencies are pinned to exact versions; `pnpm audit --prod` runs in CI. Releases are published
  from CI with npm provenance, so every tarball is traceable to a commit and workflow.
