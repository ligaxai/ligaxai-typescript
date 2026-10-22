---
'@ligaxai/sdk': minor
'@ligaxai/react': minor
'@ligaxai/widget': minor
---

End users connect their own accounts (`public-api-spec-v0.3.0`). `@ligaxai/sdk`:
`client.connectSessions.create/get`, `client.endUsers.connections.list/delete`, the
`connection.created` / `connection.deleted` webhook events, and `connectAccount()` — opens the
consent popup from a click, polls the session to `succeeded`/`denied`/`failed`/`expired` and closes
the popup (`ConnectAccountError` for a blocked or closed popup, `TimeoutError` when it runs out),
and `client.connectSessions.wait()`. `@ligaxai/react`: `useConnectAccount()`. `@ligaxai/widget`:
`data-connectors="gmail,outlook"` shows a "Connect your account" area with one button per connector.
