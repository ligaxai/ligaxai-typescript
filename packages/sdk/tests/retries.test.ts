import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LigaX } from '../src/index.js';
import {
  APIConnectionError,
  APITimeoutError,
  InternalServerError,
  PaymentRequiredError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from '../src/core/errors.js';
import { backoffDelay, retryDelay, shouldRetry } from '../src/core/base-client.js';
import { json, scriptedFetch } from './helpers.js';

const silent = { error() {}, warn() {}, info() {}, debug() {} };

function makeClient(fetch: ReturnType<typeof scriptedFetch>, maxRetries = 2) {
  return new LigaX({
    apiKey: 'k',
    baseURL: 'https://api.example',
    fetch,
    maxRetries,
    logger: silent,
    logLevel: 'off',
  });
}

describe('retries', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries 5xx with exponential backoff and then succeeds', async () => {
    const fetch = scriptedFetch([
      json({ error: { message: 'boom' } }, { status: 500 }),
      json({ error: { message: 'boom' } }, { status: 503 }),
      json({ object: 'api_key', id: 'key_1' }),
    ]);
    const result = await makeClient(fetch).keys.self();
    expect(result.object).toBe('api_key');
    expect(fetch.calls).toHaveLength(3);
  });

  it('gives up after maxRetries and throws the mapped error', async () => {
    const fetch = scriptedFetch([
      json({ error: { message: 'boom' } }, { status: 500 }),
      json({ error: { message: 'boom' } }, { status: 500 }),
      json({ error: { message: 'boom' } }, { status: 500 }),
    ]);
    await expect(makeClient(fetch).keys.self()).rejects.toBeInstanceOf(InternalServerError);
    expect(fetch.calls).toHaveLength(3);
  });

  it('honours retry-after-ms over retry-after', () => {
    const r = new Response(null, {
      status: 429,
      headers: { 'retry-after-ms': '1500', 'retry-after': '30' },
    });
    expect(retryDelay(r, 0)).toBe(1500);
  });

  it('honours retry-after in seconds and as an HTTP date, capped at 120s', () => {
    expect(
      retryDelay(new Response(null, { status: 429, headers: { 'retry-after': '3' } }), 0),
    ).toBe(3000);

    const future = new Date(Date.now() + 10_000).toUTCString();
    const dated = retryDelay(
      new Response(null, { status: 429, headers: { 'retry-after': future } }),
      0,
    );
    expect(dated).toBeGreaterThan(8_000);
    expect(dated).toBeLessThanOrEqual(10_000);

    const tooLong = retryDelay(
      new Response(null, { status: 429, headers: { 'retry-after': '600' } }),
      0,
    );
    expect(tooLong).toBeLessThanOrEqual(500);
  });

  it('backs off 0.5s → 8s with up to 25% jitter', () => {
    for (const [attempt, base] of [
      [0, 500],
      [1, 1000],
      [2, 2000],
      [3, 4000],
      [4, 8000],
      [9, 8000],
    ] as const) {
      const d = backoffDelay(attempt);
      expect(d).toBeLessThanOrEqual(base);
      expect(d).toBeGreaterThanOrEqual(base * 0.75);
    }
  });

  it('never retries 402, 403 or 422, even when they would otherwise look retryable', async () => {
    for (const [status, Err] of [
      [402, PaymentRequiredError],
      [403, PermissionDeniedError],
      [422, UnprocessableEntityError],
    ] as const) {
      const fetch = scriptedFetch([json({ error: { message: 'no' } }, { status })]);
      await expect(makeClient(fetch).keys.self()).rejects.toBeInstanceOf(Err);
      expect(fetch.calls).toHaveLength(1);
    }
    expect(
      shouldRetry(new Response(null, { status: 402, headers: { 'x-should-retry': 'true' } })),
    ).toBe(true);
    expect(shouldRetry(new Response(null, { status: 402 }))).toBe(false);
  });

  it('lets x-should-retry override the status heuristics', async () => {
    const fetch = scriptedFetch([
      json({ error: { message: 'nope' } }, { status: 500, headers: { 'x-should-retry': 'false' } }),
    ]);
    await expect(makeClient(fetch).keys.self()).rejects.toBeInstanceOf(InternalServerError);
    expect(fetch.calls).toHaveLength(1);

    const fetch2 = scriptedFetch([
      json({ error: { message: 'again' } }, { status: 400, headers: { 'x-should-retry': 'true' } }),
      json({ object: 'api_key', id: 'key_1' }),
    ]);
    await expect(makeClient(fetch2).keys.self()).resolves.toMatchObject({ object: 'api_key' });
  });

  it('retries 429 and reuses the same Idempotency-Key on every POST attempt', async () => {
    const fetch = scriptedFetch([
      json(
        { error: { message: 'slow down' } },
        { status: 429, headers: { 'retry-after-ms': '10' } },
      ),
      json({ id: 'run_1' }),
    ]);
    const client = makeClient(fetch);
    const result = await client.post<{ id: string }>('/runs', { body: { input: 'hi' } });
    expect(result.id).toBe('run_1');
    expect(fetch.calls).toHaveLength(2);
    const [a, b] = fetch.calls.map((c) => c.headers.get('idempotency-key'));
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(a).toBe(b);
  });

  it('uses a caller-supplied Idempotency-Key verbatim', async () => {
    const fetch = scriptedFetch([json({ id: 'run_1' })]);
    await makeClient(fetch).post('/runs', { body: {}, idempotencyKey: 'order-42' });
    expect(fetch.calls[0]?.headers.get('idempotency-key')).toBe('order-42');
  });

  it('retries connection errors and surfaces APIConnectionError when exhausted', async () => {
    const fetch = scriptedFetch([new TypeError('fetch failed'), new TypeError('fetch failed')]);
    await expect(makeClient(fetch, 1).keys.self()).rejects.toBeInstanceOf(APIConnectionError);
    expect(fetch.calls).toHaveLength(2);
  });

  it('maps a timeout to APITimeoutError', async () => {
    vi.useRealTimers();
    const fetch = scriptedFetch([
      (req) =>
        new Promise<Response>((_, reject) => {
          req.init.signal?.addEventListener('abort', () => reject(req.init.signal?.reason));
        }),
    ]);
    const client = new LigaX({
      apiKey: 'k',
      baseURL: 'https://api.example',
      fetch,
      maxRetries: 0,
      timeout: 20,
      logger: silent,
    });
    await expect(client.keys.self()).rejects.toBeInstanceOf(APITimeoutError);
  });

  it('does not retry when the caller aborted', async () => {
    vi.useRealTimers();
    const controller = new AbortController();
    const fetch = scriptedFetch([
      (req) =>
        new Promise<Response>((_, reject) => {
          req.init.signal?.addEventListener('abort', () => reject(req.init.signal?.reason));
        }),
    ]);
    const promise = makeClient(fetch).keys.self({ signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(APIConnectionError);
    expect(fetch.calls).toHaveLength(1);
  });

  it('maps 429 after exhausting retries to RateLimitError', async () => {
    const fetch = scriptedFetch([
      json({ error: { message: 'x' } }, { status: 429, headers: { 'retry-after-ms': '1' } }),
    ]);
    await expect(makeClient(fetch, 0).keys.self()).rejects.toBeInstanceOf(RateLimitError);
  });
});
