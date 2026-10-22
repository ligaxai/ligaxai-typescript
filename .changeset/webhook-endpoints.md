---
'@ligaxai/sdk': minor
---

Webhook endpoints: `client.webhooks.create/list/get/update/delete/test` (scope `webhooks:manage`;
`create` returns the signing secret once), with `WebhookEndpoint`, `WebhookEndpointWithSecret`,
`WebhookDelivery`, `WebhookEventType` and the `WebhookEvent` union (`RunWebhookEvent`,
`ApiKeyLimitWebhookEvent`, `WebhookTestEvent`). `Webhook.verify()` from `@ligaxai/sdk/webhooks` now
types the verified body as `WebhookEvent` by default.
