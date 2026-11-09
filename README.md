# LigaX TypeScript SDK

[![CI](https://github.com/ligaxai/ligaxai-typescript/actions/workflows/ci.yml/badge.svg)](https://github.com/ligaxai/ligaxai-typescript/actions/workflows/ci.yml)

Run the AI agents you build in LigaX from your own TypeScript or JavaScript code, or add one to any
website as a chat assistant.

## Pick a package

| Package                                     | Use it to                                                                                    | Guide                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [`@ligaxai/sdk`](packages/sdk#readme)       | Call LigaX from a server, script or worker: runs, streaming, files, webhooks, client tokens. | [packages/sdk](packages/sdk#readme)       |
| [`@ligaxai/react`](packages/react#readme)   | Build your own chat UI in React with the Vercel AI SDK's `useChat`.                          | [packages/react](packages/react#readme)   |
| [`@ligaxai/widget`](packages/widget#readme) | Drop a ready-made chat assistant onto any website with one script tag.                       | [packages/widget](packages/widget#readme) |

Each package's guide is also its npm page.

## In 30 seconds

```sh
npm install @ligaxai/sdk
export LIGAX_BASE_URL="https://<your-ligax-host>/api/public/v1"   # your platform's API root
export LIGAX_API_KEY="lgx_sk_..."                                  # Settings → Developers
```

```ts
import { LigaX } from '@ligaxai/sdk';

const client = new LigaX(); // reads LIGAX_BASE_URL and LIGAX_API_KEY
const run = await client.runs.wait({ profile_id: 'prf_...', input: 'Hello' });
console.log(run.output.text);
```

`<your-ligax-host>` is a placeholder: ask your LigaX administrator for the address of your platform.
The packages have no built-in address; without one the client throws `MissingBaseURLError`. Keep the
secret key on your server. Full details: [packages/sdk](packages/sdk#readme).

## More

- A complete Next.js app: [examples/nextjs-app](examples/nextjs-app).
- Repository changes: [CHANGELOG.md](CHANGELOG.md). Security: [SECURITY.md](SECURITY.md).
- Contributing, tests and releases: [CONTRIBUTING.md](CONTRIBUTING.md).
- License: Apache-2.0, see [LICENSE](LICENSE).
