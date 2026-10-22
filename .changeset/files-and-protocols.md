---
'@ligaxai/sdk': minor
'@ligaxai/widget': minor
---

Files for runs (`public-api-spec-v0.5.0`). `@ligaxai/sdk`:
`client.files.create(file, { endUserId })` uploads a `Blob`/`File` or raw bytes as
`multipart/form-data` (over 25 MB throws `FileTooLargeError` before anything is sent), plus
`files.get` and `files.delete`; pass the ids as `attachments` to `runs.create`, `runs.stream` or
`runs.wait`. Works with client tokens in the browser. `webhooks.create` replays are documented and
tested: a repeated `Idempotency-Key` returns the same endpoint and secret. `@ligaxai/widget`:
`data-files="true"` adds a file attach button whose uploads go with the visitor's next message.
