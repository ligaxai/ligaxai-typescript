# Conformance fixtures

Language-neutral request/response cases that every **PROJECT_TITLE** SDK must pass. The canonical
copies live in the spec repository and are pulled in by `pnpm sync-spec` for the tag in
`SPEC_VERSION`; the files here are the local examples that keep the runner
(`packages/sdk/tests/conformance.test.ts`) exercised while `SPEC_VERSION` is `unset`.

## `cases/*.json`

```json
{
  "name": "health get ok",
  "request": { "method": "GET", "path": "/health", "headers": {}, "body": null },
  "response": { "status": 200, "headers": { "x-request-id": "req_1" }, "body": { "status": "ok" } },
  "expect": { "call": "health.get", "args": [], "result": { "status": "ok" } }
}
```

- `request` is what the SDK must send (method, path relative to the base URL, a subset of headers,
  JSON body). Header values support `*` as a wildcard.
- `response` is what the fake server answers.
- `expect.call` is the dotted resource method on the client; `expect.args` its arguments.
- Exactly one of `expect.result` (deep-equal on the parsed body) or `expect.error`
  (`{ "class": "NotFoundError", "status": 404 }`) is present.

## `sse/*.txt`

Raw `text/event-stream` transcripts (chunk boundaries are irrelevant; the runner re-chunks). A
sibling `<name>.expected.json` holds the array of parsed events the transcript must yield and the
`lastEventId` after the stream ends.
