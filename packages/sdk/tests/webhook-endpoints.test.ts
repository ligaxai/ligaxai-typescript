import { describe, expect, it } from 'vitest';

import {
  LigaX,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEndpointCreateParams,
  type WebhookEndpointWithSecret,
} from '../src/index.js';
import {
  PaymentRequiredError,
  PermissionDeniedError,
  UnprocessableEntityError,
} from '../src/errors.js';
import { json, scriptedFetch } from './helpers.js';

const silent = { error() {}, warn() {}, info() {}, debug() {} };
const BASE = 'https://enterprise.example/api/public/v1';
const ID = 'we_AAAAAAAAAAAAAAAAAAAA';

function client(fetch: ReturnType<typeof scriptedFetch>, maxRetries = 2) {
  return new LigaX({ apiKey: 'lgx_sk_test', baseURL: BASE, fetch, maxRetries, logger: silent });
}

function endpoint(overrides: Partial<WebhookEndpoint> = {}): WebhookEndpoint {
  return {
    object: 'webhook_endpoint',
    id: ID,
    url: 'https://hooks.example.com/ligax',
    description: 'Orders',
    event_types: ['run.completed', 'run.failed'],
    profile_ids: [],
    status: 'active',
    disabled_reason: null,
    secret_hint: 'whsec_…LaSw',
    created_at: '2026-10-22T10:00:00.000Z',
    updated_at: '2026-10-22T10:00:00.000Z',
    ...overrides,
  };
}

const delivery: WebhookDelivery = {
  object: 'webhook_delivery',
  id: 'wd_1',
  event_id: 'msg_1',
  event_type: 'webhook.test',
  status: 'succeeded',
  attempt: 1,
  last_status_code: 204,
  last_error: null,
  last_attempt_at: '2026-10-22T10:00:01.000Z',
  next_attempt_at: null,
  delivered_at: '2026-10-22T10:00:01.000Z',
  created_at: '2026-10-22T10:00:01.000Z',
};

describe('webhooks', () => {
  it('create POSTs /webhooks with the body and an Idempotency-Key, and returns the secret', async () => {
    const created: WebhookEndpointWithSecret = {
      ...endpoint(),
      secret: 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
    };
    const fetch = scriptedFetch([json(created, { status: 201 })]);
    const body: WebhookEndpointCreateParams = {
      url: 'https://hooks.example.com/ligax',
      description: 'Orders',
      event_types: ['run.completed', 'run.failed'],
      profile_ids: ['prf_AAAAAAAAAAAAAAAAAAAA'],
    };
    const result = await client(fetch).webhooks.create(body);

    expect(result.secret).toBe(created.secret);
    const call = fetch.calls[0]!;
    expect(call.url).toBe(`${BASE}/webhooks`);
    expect(call.init.method).toBe('POST');
    expect(call.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(call.body).toEqual(body);
  });

  it('create sends a caller-supplied Idempotency-Key', async () => {
    const fetch = scriptedFetch([json({ ...endpoint(), secret: 'whsec_x' }, { status: 201 })]);
    await client(fetch).webhooks.create(
      { url: 'https://hooks.example.com/ligax', event_types: ['run.completed'] },
      { idempotencyKey: 'zap-sub-42' },
    );
    expect(fetch.calls[0]!.headers.get('idempotency-key')).toBe('zap-sub-42');
  });

  it('list GETs /webhooks', async () => {
    const fetch = scriptedFetch([json({ object: 'list', data: [endpoint()], has_more: false })]);
    const page = await client(fetch).webhooks.list();
    expect(page.data[0]!.id).toBe(ID);
    const call = fetch.calls[0]!;
    expect(call.url).toBe(`${BASE}/webhooks`);
    expect(call.init.method).toBe('GET');
    expect(call.init.body ?? null).toBeNull();
  });

  it('get GETs /webhooks/{id} with the id escaped', async () => {
    const fetch = scriptedFetch([json(endpoint()), json(endpoint())]);
    await client(fetch).webhooks.get(ID);
    await client(fetch).webhooks.get('we_x/../keys');
    expect(fetch.calls[0]!.url).toBe(`${BASE}/webhooks/${ID}`);
    expect(fetch.calls[0]!.init.method).toBe('GET');
    expect(fetch.calls[1]!.url).toBe(`${BASE}/webhooks/we_x%2F..%2Fkeys`);
  });

  it('update PATCHes /webhooks/{id} with only the fields given, and no Idempotency-Key', async () => {
    const fetch = scriptedFetch([
      json(endpoint({ status: 'disabled', disabled_reason: 'manual' })),
    ]);
    const result = await client(fetch).webhooks.update(ID, {
      status: 'disabled',
      event_types: ['run.requires_action'],
    });
    expect(result.status).toBe('disabled');
    const call = fetch.calls[0]!;
    expect(call.url).toBe(`${BASE}/webhooks/${ID}`);
    expect(call.init.method).toBe('PATCH');
    expect(call.body).toEqual({ status: 'disabled', event_types: ['run.requires_action'] });
    expect(call.headers.get('idempotency-key')).toBeNull();
  });

  it('delete DELETEs /webhooks/{id} and returns the deletion marker', async () => {
    const fetch = scriptedFetch([json({ object: 'webhook_endpoint', id: ID, deleted: true })]);
    const result = await client(fetch).webhooks.delete(ID);
    expect(result).toEqual({ object: 'webhook_endpoint', id: ID, deleted: true });
    const call = fetch.calls[0]!;
    expect(call.url).toBe(`${BASE}/webhooks/${ID}`);
    expect(call.init.method).toBe('DELETE');
    expect(call.init.body ?? null).toBeNull();
  });

  it('test POSTs /webhooks/{id}/test with no body and returns the delivery', async () => {
    const fetch = scriptedFetch([json(delivery)]);
    const result = await client(fetch).webhooks.test(ID);
    expect(result.event_type).toBe('webhook.test');
    expect(result.last_status_code).toBe(204);
    const call = fetch.calls[0]!;
    expect(call.url).toBe(`${BASE}/webhooks/${ID}/test`);
    expect(call.init.method).toBe('POST');
    expect(call.init.body ?? null).toBeNull();
  });

  it('never retries 402, 403 or 422 on any webhook method', async () => {
    const calls: Array<(c: LigaX) => Promise<unknown>> = [
      (c) => c.webhooks.create({ url: 'https://h.example', event_types: ['run.completed'] }),
      (c) => c.webhooks.list(),
      (c) => c.webhooks.get(ID),
      (c) => c.webhooks.update(ID, { url: 'https://h.example' }),
      (c) => c.webhooks.delete(ID),
      (c) => c.webhooks.test(ID),
    ];
    for (const [status, Err] of [
      [402, PaymentRequiredError],
      [403, PermissionDeniedError],
      [422, UnprocessableEntityError],
    ] as const) {
      for (const call of calls) {
        const fetch = scriptedFetch([
          json({ error: { type: 'permission_error', message: 'no' } }, { status }),
        ]);
        await expect(call(client(fetch))).rejects.toBeInstanceOf(Err);
        expect(fetch.calls).toHaveLength(1);
      }
    }
  });
});
