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

Open http://localhost:3000 and ask something.

Files:

- `app/api/chat/route.ts` — `createRunRoute`, the only place the key is used. Wire `resolveEndUser`
  to your session.
- `app/page.tsx` — a client component on `useLigaXChat({ useChat })`.

This example is typechecked in CI (`pnpm typecheck`) but not built; `pnpm build` at the root only
builds the publishable packages.
