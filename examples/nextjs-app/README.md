# Next.js example

An App Router chat page on a LigaX agent: `useChat` in the browser via `useLigaXChat`, and a server
route built with `createRunRoute` from `@ligaxai/sdk/next`, so the secret key never reaches the
browser.

```sh
pnpm install                 # from the repo root
pnpm build                   # the example imports the packages' built output
pnpm --filter nextjs-app-example dev
```

Set these in the shell or a local dotenv file before `dev` (see `.env.example`; server-only, never
`NEXT_PUBLIC_`):

- `LIGAX_API_KEY` — an `lgx_sk_…` key from Settings → Developers.
- `LIGAX_PROFILE_ID` — the `prf_…` profile to run.
- `LIGAX_BASE_URL` — only for a non-production platform, e.g. `https://<dev-host>/api/public/v1`.
- `LIGAX_DEMO_USER` — for a local try-out only: signs every visitor in as this one user. It is
  ignored in production builds.

**Before you deploy this anywhere:** replace `lib/session.ts` with your own auth. Every run acts as
the user it returns (with the accounts they connected) and is billed to your key, so without real
sign-in the routes answer 401. Give the key a spend limit and only the scopes it needs, and put a
rate limit in front of `/api/chat`.

Open http://localhost:3000 and ask something; http://localhost:3000/direct is the same chat in
direct mode.

Files:

- `app/api/chat/route.ts` — `createRunRoute`, the only place the key is used for runs. Wire
  `resolveEndUser` to your session.
- `app/page.tsx` — a client component on `useLigaXChat({ useChat })`, through `/api/chat`.
- `app/api/ligax-token/route.ts` — `createTokenRoute`: mints a short-lived client token for the
  signed-in user (the key needs the `client_tokens:write` scope).
- `app/direct/page.tsx` — **direct mode**: `useLigaXChat({ useChat, getToken })` streams the run
  straight from the API with that token. Add `http://localhost:3000` to the profile's allowed
  origins first, or the API answers `403 origin_not_allowed`. For a non-production platform set
  `NEXT_PUBLIC_LIGAX_BASE_URL` (the base URL is not a secret; the key still is).
- `app/chat-view.tsx` — the chat UI both pages share.

This example is typechecked in CI (`pnpm typecheck`) but not built; `pnpm build` at the root only
builds the publishable packages.
