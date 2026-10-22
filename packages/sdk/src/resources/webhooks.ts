import type { APIPromise } from '../core/base-client.js';
import type {
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEndpointCreateParams,
  WebhookEndpointDeleted,
  WebhookEndpointList,
  WebhookEndpointUpdateParams,
  WebhookEndpointWithSecret,
} from '../types.js';
import { APIResource } from './resource.js';
import { seg, type CallOptions, type MutationOptions } from './shared.js';

/**
 * Webhook endpoints (scope `webhooks:manage`). Managing them over the API is what lets an
 * automation platform (Zapier, Make, n8n) subscribe on connect with `create` and unsubscribe on
 * disconnect with `delete`. To verify what arrives, use `Webhook` from `@ligaxai/sdk/webhooks`.
 */
export class Webhooks extends APIResource {
  /**
   * `POST /webhooks` — register an endpoint. The answer carries the signing `secret` exactly once;
   * the API never returns it again (`secret_hint` is all later reads show).
   */
  create(
    body: WebhookEndpointCreateParams,
    options: MutationOptions = {},
  ): APIPromise<WebhookEndpointWithSecret> {
    return this._client.post<WebhookEndpointWithSecret>('/webhooks', { ...options, body });
  }

  /** `GET /webhooks` — every endpoint in the workspace. */
  list(options: CallOptions = {}): APIPromise<WebhookEndpointList> {
    return this._client.get<WebhookEndpointList>('/webhooks', options);
  }

  /** `GET /webhooks/{id}` — one endpoint (`we_…`). */
  get(id: string, options: CallOptions = {}): APIPromise<WebhookEndpoint> {
    return this._client.get<WebhookEndpoint>(`/webhooks/${seg(id)}`, options);
  }

  /**
   * `PATCH /webhooks/{id}` — change the URL, description, event types or profile filter, or set
   * `status` to `disabled` / `active`. Re-enabling clears `disabled_reason`.
   */
  update(
    id: string,
    body: WebhookEndpointUpdateParams,
    options: CallOptions = {},
  ): APIPromise<WebhookEndpoint> {
    return this._client.patch<WebhookEndpoint>(`/webhooks/${seg(id)}`, { ...options, body });
  }

  /** `DELETE /webhooks/{id}` — unsubscribe; nothing more is sent to it. */
  delete(id: string, options: CallOptions = {}): APIPromise<WebhookEndpointDeleted> {
    return this._client.delete<WebhookEndpointDeleted>(`/webhooks/${seg(id)}`, options);
  }

  /**
   * `POST /webhooks/{id}/test` — send a `webhook.test` event now and resolve with the delivery:
   * how your receiver answered. A disabled endpoint answers 409.
   */
  test(id: string, options: MutationOptions = {}): APIPromise<WebhookDelivery> {
    return this._client.post<WebhookDelivery>(`/webhooks/${seg(id)}/test`, options);
  }
}
