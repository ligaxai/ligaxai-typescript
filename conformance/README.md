# Conformance fixtures

Language-neutral request/response cases that every **LigaX** SDK must pass. The canonical copies are
meant to live in the spec repository and arrive through `pnpm sync-spec` for the tag in
`SPEC_VERSION`; until that repository publishes them, the cases here are maintained by hand against
`openapi/openapi.json` (`public-api-spec-v0.1.0`). The runner is
`packages/sdk/tests/conformance.test.ts`.

## `cases/*.json`

```json
{
  "name": "runs.get ok",
  "request": { "method": "GET", "path": "/runs/run_1", "headers": {}, "body": null },
  "response": { "status": 200, "headers": { "x-request-id": "req_1" }, "body": { "id": "run_1" } },
  "expect": { "call": "runs.get", "args": ["run_1"], "result": { "id": "run_1" } }
}
```

- `request` is what the SDK must send (method, path relative to the base URL, a subset of headers,
  JSON body). Header values support `*` as a wildcard.
- `response` is what the fake server answers.
- `expect.call` is the dotted resource method on the client; `expect.args` its arguments (an options
  object uses the SDK's camelCase option names, e.g. `{ "idempotencyKey": "…" }`; request bodies are
  always the wire's snake_case).
- Exactly one of `expect.result` (deep-equal on the parsed body) or `expect.error`
  (`{ "class": "NotFoundError", "status": 404 }`) is present.

## `sse/*.txt`

Raw `text/event-stream` transcripts (chunk boundaries are irrelevant; the runner re-chunks). A
sibling `<name>.expected.json` holds the array of parsed events the transcript must yield and the
`lastEventId` after the stream ends.

`lae-*.txt` transcripts are **LAE run streams** (`POST /runs` in `stream` mode). Their
`.expected.json` holds `events` (each `{ type, seq, payload, runId?, ts? }`, `seq: null` for
`stream.*` control frames, unknown types kept), `text` (the answer assembled by offset — replayed
deltas must not duplicate, `reasoning.*` excluded) and `status` (`run.end.payload.status`). A
transcript may end without a trailing blank line; the final event still counts.
