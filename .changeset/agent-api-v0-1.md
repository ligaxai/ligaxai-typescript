---
'@ligaxai/sdk': minor
'@ligaxai/react': minor
---

Agent API v0.1 (`public-api-spec-v0.1.0`). `@ligaxai/sdk`: `client.runs` (`create`, `stream`,
`wait`, `get`, `events`, `followEvents`, `cancel`, `resolveInterrupt`), `client.conversations.get`,
`client.profiles.list/get`, `client.keys.self`, `client.usage.get`; `RunStream` over the LAE event
stream with offset-addressed text assembly (`TextAssembler`); `PaymentRequiredError.resetsAt`,
`APIError.requestId`, and 422 is never retried. `/ai-sdk`: `createLigaXTransport`. `/next`:
`createRunRoute` and `createRunProxy`. The example `health` resource is removed. `@ligaxai/react`:
`useLigaXChat` / `useLigaXTransport` run on the LAE transport (`reconnectApi` removed, `onRun`
added).
