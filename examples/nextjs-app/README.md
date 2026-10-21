# Next.js example

Minimal App Router app that calls the **PROJECT_TITLE** API through a server route built with
`@ligaxai/sdk/next`, so the secret key never reaches the browser.

```sh
pnpm install                 # from the repo root
pnpm --filter nextjs-app-example dev
```

Set `LIGAX_API_KEY` (and `LIGAX_BASE_URL` for a non-production API) in the shell or a local dotenv
file before `dev`. Open http://localhost:3000 and press the button.

Files:

- `app/api/chat/route.ts` — `createRouteHandler`, the only place the key is used.
- `app/page.tsx` — a client component that posts to the route.

This example is typechecked in CI (`pnpm typecheck`) but not built; `pnpm build` at the root only
builds the publishable packages.
