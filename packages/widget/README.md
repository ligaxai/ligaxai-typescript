# @ligaxai/widget

A chat assistant for any website, on the LigaX Agent API: a framework-free `<ligax-chat>` custom
element in Shadow DOM. It streams answers, shows tool activity, asks for approval when the agent
wants to act, keeps the conversation for the tab, and never holds a secret key.

## Script tag

```html
<!-- Anonymous visitors -->
<script
  src="https://unpkg.com/@ligaxai/widget/dist/widget.global.js"
  data-publishable-key="lgx_pk_live_…"
  data-profile-id="prf_…"
  async
></script>

<!-- Signed-in users: your own endpoint mints the token -->
<script
  src="https://unpkg.com/@ligaxai/widget/dist/widget.global.js"
  data-token-url="/api/ligax-token"
  async
></script>
```

Pin a version in production (`@ligaxai/widget@x.y.z/dist/widget.global.js`) and add an `integrity`
hash if you serve it from a CDN. The script defines `window.LigaXWidget` (`mount`, `define`,
`autoInit`).

| Attribute              | Meaning                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `data-publishable-key` | `lgx_pk_…`. Opens an anonymous session per visitor (`POST /widget/sessions`).                                           |
| `data-profile-id`      | `prf_…`. Required with a publishable key; optional with a token URL that answers `profile_id`.                          |
| `data-token-url`       | Your endpoint answering `{ token, expires_at, profile_id }`; called with the page's cookies.                            |
| `data-base-url`        | API base URL for a non-production platform. Default `https://enterprise.ligax.ai/api/public/v1`.                        |
| `data-title`           | Panel heading. Default "Chat".                                                                                          |
| `data-greeting`        | A first message shown locally (not sent to the agent).                                                                  |
| `data-placeholder`     | Composer placeholder.                                                                                                   |
| `data-position`        | `bottom-right` (default) or `bottom-left`.                                                                              |
| `data-open`            | Start with the panel open.                                                                                              |
| `data-connectors`      | Comma-separated connector keys (`gmail,outlook`): a "Connect your account" area, one button each. Signed-in users only. |
| `data-files`           | `"true"` shows a paperclip button: the user attaches files to their next message. Signed-in users only.                 |

## Before it works

- **Allowed origins.** The API accepts browser requests only from the origins on the **profile**
  (and, for a publishable key, also on the **key**). Add `https://www.your-site.com` to the
  profile's (and key's) allowed origins in LigaX, or every request answers `403 origin_not_allowed`.
- **A publishable key needs a spend limit.** It is public by design — anyone can open a session from
  your site — so the platform requires a limit on it. It can do exactly one thing: open a 15-minute
  session for an anonymous visitor (`end_user = visitor:<id>`). The profile's end-user identity must
  be `optional`.
- **Signed-in users** use `data-token-url`. With Next.js, `createTokenRoute` from
  `@ligaxai/sdk/next` is that endpoint (it needs a secret key with `client_tokens:write`):

  ```ts
  // app/api/ligax-token/route.ts
  import { createTokenRoute } from '@ligaxai/sdk/next';
  export const { POST } = createTokenRoute({
    profileId: process.env.LIGAX_PROFILE_ID!,
    resolveEndUser: async () => {
      const user = (await auth())?.user; // your session, never the request body
      return user ? { id: user.id, name: user.name } : null; // null → 401
    },
  });
  ```

## From a bundle, or React

```ts
import { mount } from '@ligaxai/widget';
const chat = mount({ publishableKey: 'lgx_pk_live_…', profileId: 'prf_…', title: 'Help' });
chat.show(); // also hide(), toggle(), send(text), reset()
```

```tsx
import { LigaXChat } from '@ligaxai/widget/react';
<LigaXChat tokenUrl="/api/ligax-token" title="Help" style={{ '--ligax-accent': '#7c3aed' }} />;
```

`<LigaXChat>` renders the same custom element; `react` is an optional peer used only by that
subpath. For a chat UI made of your own components, use `useLigaXChat` from `@ligaxai/react`. Or
register the element and write it in markup: `define()`, then
`<ligax-chat publishable-key="…" profile-id="…" chat-title="Help"></ligax-chat>`.

## Behaviour

- **Visitors and conversations.** A random 128-bit `visitor_id` is kept in `localStorage`
  (`ligax.visitor_id`) so a returning visitor is the same end user; the `conversation_id` is kept
  per tab in `sessionStorage` and sent on later turns. If storage is blocked the widget still works
  and forgets on reload.
- **Tokens.** The client token is cached until shortly before it expires and refreshed once when the
  API answers `401 token_expired`.
- **Anonymous visitors chat only.** On a website key (`data-publishable-key` without
  `data-token-url`) the API gives a visitor no account connections, no uploads and no approvals,
  because anyone can load your page and claim any visitor id. The widget hides the connect area and
  the paperclip, and when a run needs an approval it shows a notice that your team must answer it
  (from your server, with a secret key). Use `data-token-url` for signed-in users to get the rest.
- **Approvals.** For a signed-in user, when a run stops with `requires_action`, a card shows the
  prompt with Approve / Reject (a form or question that the widget cannot render is offered as
  Dismiss); the decision is posted to `POST /runs/{id}/interrupts/{interrupt_id}` and the run is
  followed to its end.
- **Errors.** 401, 402, 403 and 429 become short, plain messages — the API's error body is never
  shown to a visitor.
- **Safe rendering.** Answers are built as DOM nodes from a tiny markdown subset — paragraphs,
  `**bold**`, `` `code` ``, fenced code, and links whose target is `https:` (opened with
  `rel="noopener noreferrer"`). Nothing from the model is ever assigned to `innerHTML`; images are
  not rendered.
- **Connect your account.** With `data-connectors` (or `connectors` in `mount()` / `<LigaXChat>`),
  the panel shows a "Connect your account" area with one button per connector, labelled with a
  readable name (`google_calendar` → "Google Calendar"). A click opens the provider's consent page
  in a popup — from the click itself, so pop-up blockers allow it — using the widget's own client
  token, so the visitor connects **their** account; the area then confirms "Gmail is connected."
  Needs the profile's **End users can connect their own accounts** switch and the connector on the
  agent; if the switch is off (`409 end_user_connections_off`) the area hides itself. A blocked
  popup, a declined consent or a connector that cannot be connected here each get a one-line
  message.
- **Files.** With `data-files="true"` (or `files: true` in `mount()` / `<LigaXChat files>`), a
  paperclip button opens the file picker. Each file (up to 25 MB, 10 per message) is uploaded at
  once with `POST /files` using the widget's own client token — so it belongs to that visitor and
  only their runs can attach it — and shown as a chip with a remove button. Send waits for uploads
  to finish, then the ids go with the next message as `attachments` and the chips clear. A file over
  25 MB is refused before upload; whether a type can be read depends on the profile's model. Names
  are shown with `textContent` only.
- **Accessibility.** The launcher is a labelled button with `aria-expanded`; opening moves focus to
  the composer, `Esc` closes and returns focus; Enter sends, Shift+Enter adds a line; the log is an
  `aria-live` region and a streaming answer is `aria-busy` until it finishes.

## Theming

Set custom properties on the element from your own CSS:

```css
ligax-chat {
  --ligax-accent: #7c3aed;
  --ligax-accent-text: #fff;
  --ligax-radius: 10px;
  --ligax-font: 15px/1.5 Inter, system-ui, sans-serif;
}
```

Also: `--ligax-bg`, `--ligax-surface`, `--ligax-text`, `--ligax-muted`, `--ligax-border`,
`--ligax-danger`, `--ligax-z-index`, and `-dark` variants of the colours (`--ligax-bg-dark`, …) used
under `prefers-color-scheme: dark`.

## Bundle size

`dist/widget.global.js` (IIFE, everything inlined including the SDK client and the SSE parser):
**about 54 KB minified, about 18 KB gzip** (≈ 16 KB brotli) at this release. The ESM build is a few
KB on top of `@ligaxai/sdk`, which your bundler shares with the rest of your app.
