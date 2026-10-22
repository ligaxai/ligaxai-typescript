import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  Webhook,
  WebhookVerificationError,
  type RunWebhookEvent,
  type WebhookEvent,
} from '../src/webhooks.js';

// Generated for the test only; `whsec_` + base64 of 24 random bytes.
const SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
const BODY = JSON.stringify({ type: 'run.completed', data: { id: 'run_1' } });
const ID = 'msg_2b3c';

async function headers(ts: number, body = BODY, secret = SECRET) {
  const sig = await new Webhook(secret).sign(ID, ts, body);
  return {
    'webhook-id': ID,
    'webhook-timestamp': String(ts),
    'webhook-signature': `v1,${sig}`,
  };
}

describe('Webhook.verify', () => {
  const now = 1_800_000_000;

  it('accepts a valid signature and returns the parsed body', async () => {
    const wh = new Webhook(SECRET);
    const payload = await wh.verify<{ type: string }>(BODY, await headers(now), { now });
    expect(payload.type).toBe('run.completed');
  });

  it('accepts Headers instances and byte payloads', async () => {
    const wh = new Webhook(SECRET);
    const h = new Headers(await headers(now));
    await expect(wh.verify(new TextEncoder().encode(BODY), h, { now })).resolves.toBeTruthy();
  });

  it('accepts a rotated secret listed among several space-separated signatures', async () => {
    const wh = new Webhook(SECRET);
    const good = await wh.sign(ID, now, BODY);
    const h = {
      'webhook-id': ID,
      'webhook-timestamp': String(now),
      'webhook-signature': `v1,AAAA v1,${good} v0,junk`,
    };
    await expect(wh.verify(BODY, h, { now })).resolves.toBeTruthy();
  });

  it('rejects a tampered body', async () => {
    const wh = new Webhook(SECRET);
    await expect(
      wh.verify(BODY.replace('run_1', 'run_2'), await headers(now), { now }),
    ).rejects.toBeInstanceOf(WebhookVerificationError);
  });

  it('rejects a signature made with a different secret', async () => {
    const wh = new Webhook(SECRET);
    const other = await headers(now, BODY, 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    await expect(wh.verify(BODY, other, { now })).rejects.toThrow('No matching signature');
  });

  it('rejects timestamps outside the tolerance window', async () => {
    const wh = new Webhook(SECRET);
    await expect(wh.verify(BODY, await headers(now - 301), { now })).rejects.toThrow('too old');
    await expect(wh.verify(BODY, await headers(now + 301), { now })).rejects.toThrow('too new');
    await expect(wh.verify(BODY, await headers(now - 299), { now })).resolves.toBeTruthy();
  });

  it('rejects missing headers', async () => {
    const wh = new Webhook(SECRET);
    await expect(wh.verify(BODY, { 'webhook-id': ID }, { now })).rejects.toThrow(
      'Missing required header',
    );
  });
});

/**
 * The Standard Webhooks reference vector (the spec's own example, also used by the official
 * libraries). Passing it is what makes "drop-in compatible with `standardwebhooks`" a fact rather
 * than a claim; the clock is pinned to the vector's timestamp because it is from 2021.
 */
describe('Standard Webhooks spec vector', () => {
  const secret = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';
  const id = 'msg_p5jXN8AQM9LWM0D4loKWxJek';
  const timestamp = 1614265330;
  const body = '{"test": 2432232314}';
  const signature = 'v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=';
  const vectorHeaders = (sig = signature) => ({
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': sig,
  });

  it('signs the vector to the published signature', async () => {
    expect(`v1,${await new Webhook(secret).sign(id, timestamp, body)}`).toBe(signature);
  });

  it('verifies the vector with a fixed clock', async () => {
    const payload = await new Webhook(secret).verify<{ test: number }>(body, vectorHeaders(), {
      now: timestamp,
    });
    expect(payload).toEqual({ test: 2432232314 });
  });

  it('rejects the vector on the real clock (replay protection)', async () => {
    await expect(new Webhook(secret).verify(body, vectorHeaders())).rejects.toThrow('too old');
  });

  it('verifies during a rotation, whichever of two signatures is the current secret', async () => {
    const next = 'whsec_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const nextSig = `v1,${await new Webhook(next).sign(id, timestamp, body)}`;
    const both = vectorHeaders(`${nextSig} ${signature}`);
    await expect(new Webhook(secret).verify(body, both, { now: timestamp })).resolves.toEqual({
      test: 2432232314,
    });
    await expect(new Webhook(next).verify(body, both, { now: timestamp })).resolves.toEqual({
      test: 2432232314,
    });
    await expect(
      new Webhook('whsec_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB').verify(body, both, { now: timestamp }),
    ).rejects.toThrow('No matching signature');
  });
});

describe('verify typing', () => {
  it('types the body as WebhookEvent by default, narrowing on type', async () => {
    const now = 1_800_000_000;
    const event = {
      type: 'run.requires_action',
      timestamp: '2027-01-15T08:00:00.000Z',
      data: {
        object: 'run',
        id: 'run_1',
        status: 'requires_action',
        profile_id: 'prf_AAAAAAAAAAAAAAAAAAAA',
        conversation_id: null,
        end_user_id: null,
        metadata: {},
        interrupt_id: 'int_1',
        interrupt_kind: 'approval',
      },
    } satisfies RunWebhookEvent;
    const raw = JSON.stringify(event);
    const sig = await new Webhook(SECRET).sign(ID, now, raw);
    const parsed = await new Webhook(SECRET).verify(
      raw,
      { 'webhook-id': ID, 'webhook-timestamp': String(now), 'webhook-signature': `v1,${sig}` },
      { now },
    );

    expectTypeOf(parsed).toEqualTypeOf<WebhookEvent>();
    switch (parsed.type) {
      case 'webhook.test':
        expectTypeOf(parsed.data.object).toEqualTypeOf<'webhook_endpoint'>();
        break;
      case 'api_key.limit_reached':
        expectTypeOf(parsed.data.object).toEqualTypeOf<'api_key'>();
        break;
      default:
        expectTypeOf(parsed.data.object).toEqualTypeOf<'run'>();
        expect(parsed.data.interrupt_id).toBe('int_1');
    }
    expect(parsed).toEqual(event);
  });
});
