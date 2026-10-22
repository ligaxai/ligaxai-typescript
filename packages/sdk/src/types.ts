/**
 * Named aliases over the generated types. **Aliases only** — every shape here is a path into
 * `generated/types.ts`, so a spec change flows through `pnpm gen:types` and nothing in this file can
 * drift from the contract. Field names are the wire's (snake_case) on purpose: the SDK passes bodies
 * through exactly as the API defines them, so the API reference and the types read the same.
 */
import type { components, operations, webhooks } from './generated/types.js';

type JSONBody<Op extends keyof operations, Status extends number> = operations[Op] extends {
  responses: { [S in Status]: { content: { 'application/json': infer B } } };
}
  ? B
  : never;

type RequestBody<Op extends keyof operations> = operations[Op] extends {
  requestBody: { content: { 'application/json': infer B } };
}
  ? B
  : never;

/** A run: its status, the answer so far (`output.text`), what it is waiting on, usage. */
export type Run = components['schemas']['Run'];
export type RunStatus = components['schemas']['RunStatus'];
/** `run.required_action` when the run waits on an approval, a question or a form. */
export type RequiredAction = NonNullable<Run['required_action']>;
export type RunUsage = NonNullable<Run['usage']>;
export type RunOutput = Run['output'];

/** The body of `POST /runs`, exactly as the API takes it. */
export type RunCreateParams = RequestBody<'runs.create'>;
export type RunInput = RunCreateParams['input'];
export type RunMode = NonNullable<RunCreateParams['mode']>;
export type EndUser = NonNullable<RunCreateParams['end_user']>;

/** One recorded LAE frame from `GET /runs/{id}/events` (the JSON form). */
export type RunEventRecord = components['schemas']['RunEvent'];
export type RunEventList = JSONBody<'runs.events', 200>;

export type InterruptDecisionParams = RequestBody<'runs.resolveInterrupt'>;
export type InterruptDecision = InterruptDecisionParams['decision'];

/** `POST /client_tokens` body: the profile and end user the token is bound to, optional TTL. */
export type ClientTokenCreateParams = RequestBody<'clientTokens.create'>;
/** A minted client token (`lgx_ct_…`) and what it is bound to. */
export type ClientToken = JSONBody<'clientTokens.create', 201>;
/** `POST /widget/sessions` body — called by the website widget with a publishable key. */
export type WidgetSessionCreateParams = RequestBody<'widget.sessions.create'>;
/** A client token for an anonymous visitor (`end_user_id` = `visitor:<visitor_id>`). */
export type WidgetSession = JSONBody<'widget.sessions.create', 201>;

export type Conversation = JSONBody<'conversations.get', 200>;

/**
 * `POST /connect_sessions` body. A secret key names `end_user` and `profile_id`; a client token
 * acts for its own end user and profile, so it sends only `connector_key`.
 */
export type ConnectSessionCreateParams = RequestBody<'connectSessions.create'>;
/** An end user connecting one of their own accounts: open `connect_url` in a popup, then poll. */
export type ConnectSession = JSONBody<'connectSessions.create', 201>;
export type ConnectSessionStatus = ConnectSession['status'];
/** One account an end user connected themselves (not the workspace's shared ones). */
export type EndUserConnection = components['schemas']['EndUserConnection'];
export type EndUserConnectionList = JSONBody<'endUsers.connections.list', 200>;
export type EndUserConnectionDeleted = JSONBody<'endUsers.connections.delete', 200>;

/** Statuses after which a connect session will not change again. */
export const TERMINAL_CONNECT_SESSION_STATUSES: readonly ConnectSessionStatus[] = [
  'succeeded',
  'denied',
  'failed',
  'expired',
];

export type Profile = components['schemas']['Profile'];
export type ProfileList = JSONBody<'profiles.list', 200>;

/** `GET /keys/self` — the presented key, its scopes and what it may still spend. */
export type ApiKeyInfo = JSONBody<'keys.self', 200>;

export type Usage = JSONBody<'usage.get', 200>;
export type UsageGroupBy = NonNullable<Usage['group_by']>;

/** A webhook endpoint as the API returns it. The signing secret is never on this shape. */
export type WebhookEndpoint = components['schemas']['WebhookEndpoint'];
/** `POST /webhooks` answers with the endpoint plus `secret` (`whsec_…`) — shown once, store it now. */
export type WebhookEndpointWithSecret = JSONBody<'webhooks.create', 201>;
export type WebhookEndpointList = JSONBody<'webhooks.list', 200>;
export type WebhookEndpointCreateParams = RequestBody<'webhooks.create'>;
export type WebhookEndpointUpdateParams = RequestBody<'webhooks.update'>;
export type WebhookEndpointDeleted = JSONBody<'webhooks.delete', 200>;
/** One delivery attempt record; `webhooks.test` answers with the test event's. */
export type WebhookDelivery = JSONBody<'webhooks.test', 200>;
/** The event types an endpoint can subscribe to. `webhook.test` is not one of them. */
export type WebhookEventType = WebhookEndpoint['event_types'][number];

type WebhookBody<Name extends keyof webhooks> = webhooks[Name] extends {
  post: { requestBody: { content: { 'application/json': infer B } } };
}
  ? B
  : never;

/** `run.completed | run.failed | run.canceled | run.requires_action`, as delivered. */
export type RunWebhookEvent = WebhookBody<'run.completed'>;
/** `api_key.limit_reached`: a key hit its spend limit for the window. */
export type ApiKeyLimitWebhookEvent = WebhookBody<'api_key.limit_reached'>;
/**
 * Sent only by "Send test event" (`webhooks.test`) and not subscribable, so the spec's `webhooks`
 * section does not describe it; the shape is the platform's `WebhookPayload` for that type.
 */
export interface WebhookTestEvent {
  type: 'webhook.test';
  timestamp: string;
  data: { object: 'webhook_endpoint'; id: string };
}
/**
 * `connection.created`: an end user's connect session was first seen to succeed. Subscribable
 * (`WebhookEventType`), but the spec's `webhooks` section does not describe its body yet; the shape
 * is the platform's emit in `end-user-connections.ts`.
 */
export interface ConnectionCreatedWebhookEvent {
  type: 'connection.created';
  timestamp: string;
  data: { object: 'connection'; id: string; end_user_id: string; status: 'active' };
}
/** `connection.deleted`: an end user's account was disconnected through the API. Hand-written, as above. */
export interface ConnectionDeletedWebhookEvent {
  type: 'connection.deleted';
  timestamp: string;
  data: { object: 'connection'; id: string; connector_key: string; end_user_id: string };
}
export type ConnectionWebhookEvent = ConnectionCreatedWebhookEvent | ConnectionDeletedWebhookEvent;
/** Every body a LigaX webhook can carry. Switch on `type` to narrow. */
export type WebhookEvent =
  | RunWebhookEvent
  | ApiKeyLimitWebhookEvent
  | ConnectionWebhookEvent
  | WebhookTestEvent;

/** The API's error body. `param` names the offending field when there is one. */
export type ErrorBody = JSONBody<'runs.get', 401>;
export type ErrorType = ErrorBody['error']['type'];

/** Statuses after which a run will not change again. */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'completed',
  'failed',
  'canceled',
  'expired',
];

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}
