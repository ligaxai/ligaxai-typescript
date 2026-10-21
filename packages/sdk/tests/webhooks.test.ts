import { describe, expect, it } from 'vitest';

import { Webhook, WebhookVerificationError } from '../src/webhooks.js';

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
