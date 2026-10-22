# @ligaxai/sdk

The official TypeScript client for the **LigaX Agent API**: run the agents you configure in LigaX
from your own software. Node 22+, ESM and CJS; works in Bun, Deno and workerd.

```sh
npm i @ligaxai/sdk
export LIGAX_API_KEY=lgx_sk_...   # Settings → Developers. Server-side only.
```

```ts
import { LigaX } from '@ligaxai/sdk';

const client = new LigaX(); // reads LIGAX_API_KEY
const run = await client.runs.wait({ profile_id: 'prf_…', input: 'Summarise yesterday’s tickets' });
console.log(run.status, run.output.text);

const stream = await client.runs.stream({ profile_id: 'prf_…', input: 'Hello' });
for await (const text of stream.textStream()) process.stdout.write(text);
```

Also: conversations, files, profiles, keys, usage, webhooks (`/webhooks` verifies signatures),
client tokens for browsers, Next.js route helpers (`/next`) and a Vercel AI SDK transport
(`/ai-sdk`). Never put a secret key (`lgx_sk_…`) in browser code; mint a client token instead.

Full documentation: <https://github.com/ligaxai/ligaxai-typescript#readme>. Security issues: see
[SECURITY.md](https://github.com/ligaxai/ligaxai-typescript/blob/main/SECURITY.md).
