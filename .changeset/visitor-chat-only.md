---
'@ligaxai/widget': minor
'@ligaxai/sdk': patch
---

Anonymous website visitors chat only: the widget hides file attach and account connections on a
website key and shows a "waiting for the team" notice instead of an approval card. The approval card
also reads the tool name from the safe `interrupt.raised` payload. The SDK pins spec 0.6.0
(`409 idempotency_in_progress` is retried; run events are a safe subset).
