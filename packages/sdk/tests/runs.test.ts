import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LigaX, RunStream } from '../src/index.js';
import { NotFoundError, PaymentRequiredError, RateLimitError } from '../src/errors.js';
import { chunkedBody, json, scriptedFetch } from './helpers.js';
import { frame, laeResponse, simpleRun } from './lae.js';

const silent = { error() {}, warn() {}, info() {}, debug() {} };
const PROFILE = 'prf_AAAAAAAAAAAAAAAAAAAA';
const BASE = 'https://enterprise.example/api/public/v1';

function client(fetch: ReturnType<typeof scriptedFetch>, maxRetries = 2) {
  return new LigaX({ apiKey: 'lgx_sk_test', baseURL: BASE, fetch, maxRetries, logger: silent });
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    object: 'run',
    id: 'run_1',
    status: 'completed',
    profile_id: PROFILE,
    conversation_id: 'conv_BBBBBBBBBBBBBBBBBBBBBBBB',
    end_user_id: null,
    model: null,
    created_at: '2026-10-22T10:00:00.000Z',
    completed_at: '2026-10-22T10:00:01.000Z',
    output: { text: 'Done.', artifacts: [], sources: [], tool_calls: [] },
    required_action: null,
    usage: { input_tokens: 1, output_tokens: 1, cost_usd: '0.000001' },
    error: null,
    metadata: {},
    ...overrides,
  };
}

describe('runs.create', () => {
  it('POSTs /runs in wait mode with bearer auth and an auto Idempotency-Key', async () => {
    const fetch = scriptedFetch([json(run(), { headers: { 'x-request-id': 'req_1' } })]);
    const result = await client(fetch).runs.create({ profile_id: PROFILE, input: 'Hi' });

    expect(result.status).toBe('completed');
    expect(result.output.text).toBe('Done.');
    const call = fetch.calls[0]!;
    expect(call.url).toBe(`${BASE}/runs`);
    expect(call.init.method).toBe('POST');
    expect(call.headers.get('authorization')).toBe('Bearer lgx_sk_test');
    expect(call.headers.get('content-type')).toBe('application/json');
    expect(call.headers.get('accept')).toBe('application/json');
    expect(call.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    expect(call.body).toEqual({ profile_id: PROFILE, input: 'Hi', mode: 'wait' });
  });

  it('passes snake_case wire fields through unchanged and keeps mode async', async () => {
    const fetch = scriptedFetch([json(run({ status: 'queued' }), { status: 202 })]);
    const body = {
      profile_id: PROFILE,
      input: { text: 'Hi' },
      conversation_id: 'conv_BBBBBBBBBBBBBBBBBBBBBBBB',
      end_user: { id: 'u-1', name: 'Ada' },
      model: 'gemini/gemini-flash/latest',
      metadata: { order: '42' },
      mode: 'async' as const,
    };
    const result = await client(fetch).runs.create(body, { idempotencyKey: 'order-42-attempt' });
    expect(result.status).toBe('queued');
    expect(fetch.calls[0]!.body).toEqual(body);
    expect(fetch.calls[0]!.headers.get('idempotency-key')).toBe('order-42-attempt');
  });

  it('reuses the same Idempotency-Key when a 503 is retried, honouring Retry-After', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetch = scriptedFetch([
        json(
          {
            error: {
              type: 'api_error',
              code: 'upstream_unavailable',
              message: 'x',
              request_id: 'r',
            },
          },
          { status: 503, headers: { 'retry-after': '1' } },
        ),
        json(run()),
      ]);
      const started = Date.now();
      const promise = client(fetch).runs.create({ profile_id: PROFILE, input: 'Hi' });
      await vi.advanceTimersByTimeAsync(1000);
      await promise;
      expect(Date.now() - started).toBeGreaterThanOrEqual(1000);
      const [a, b] = fetch.calls.map((c) => c.headers.get('idempotency-key'));
      expect(a).toBeTruthy();
      expect(a).toBe(b);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('errors from the Agent API', () => {
  it('maps a 402 to PaymentRequiredError with code, requestId and resetsAt — and never retries it', async () => {
    const fetch = scriptedFetch([
      json(
        {
          error: {
            type: 'billing_error',
            code: 'key_limit_reached',
            message: 'This API key has reached its spend limit.',
            request_id: 'req_402',
          },
        },
        { status: 402, headers: { 'x-limit-resets-at': '2026-11-01T00:00:00.000Z' } },
      ),
    ]);
    const err = await client(fetch)
      .runs.create({ profile_id: PROFILE, input: 'Hi' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentRequiredError);
    const e = err as PaymentRequiredError;
    expect(e.code).toBe('key_limit_reached');
    expect(e.type).toBe('billing_error');
    expect(e.requestId).toBe('req_402');
    expect(e.request_id).toBe('req_402');
    expect(e.resetsAt?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(fetch.calls).toHaveLength(1);
  });

  it('exposes param on a 404', async () => {
    const fetch = scriptedFetch([
      json(
        {
          error: {
            type: 'not_found_error',
            code: 'profile_not_found',
            message: 'No profile with that id is available to this key.',
            request_id: 'req_404',
            param: 'profile_id',
          },
        },
        { status: 404, headers: { 'x-request-id': 'req_404' } },
      ),
    ]);
    const err = (await client(fetch)
      .runs.create({ profile_id: PROFILE, input: 'Hi' })
      .catch((e: unknown) => e)) as NotFoundError;
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.param).toBe('profile_id');
    expect(err.requestId).toBe('req_404');
  });

  it('retries a 429 after Retry-After seconds, then surfaces RateLimitError when exhausted', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const limited = () =>
        json(
          {
            error: {
              type: 'rate_limit_error',
              code: 'rate_limited',
              message: 'x',
              request_id: 'r',
            },
          },
          { status: 429, headers: { 'retry-after': '2' } },
        );
      const fetch = scriptedFetch([limited(), limited()]);
      const promise = client(fetch, 1)
        .keys.self()
        .catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(1999);
      expect(fetch.calls).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await promise).toBeInstanceOf(RateLimitError);
      expect(fetch.calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('runs.stream', () => {
  it('POSTs mode stream, exposes the run and conversation ids, and yields typed events', async () => {
    const fetch = scriptedFetch([laeResponse(chunkedBody(simpleRun().match(/[\s\S]{1,11}/g)!))]);
    const stream = await client(fetch).runs.stream({ profile_id: PROFILE, input: 'Hi' });

    expect(stream).toBeInstanceOf(RunStream);
    expect(stream.runId).toBe('run_test_1');
    expect(stream.conversationId).toBe('conv_CCCCCCCCCCCCCCCCCCCCCCCC');
    expect(stream.requestId).toBe('req_stream_1');
    const call = fetch.calls[0]!;
    expect(call.body).toEqual({ profile_id: PROFILE, input: 'Hi', mode: 'stream' });
    expect(call.headers.get('accept')).toBe('text/event-stream');
    expect(call.headers.get('idempotency-key')).toBeTruthy();

    const types: string[] = [];
    for await (const event of stream) {
      types.push(event.type);
      if (event.type === 'stream.ready') expect(event.seq).toBeNull();
      if (event.type === 'run.start') {
        expect(event.seq).toBe(1);
        expect(event.runId).toBe('run_test_1');
      }
    }
    expect(types).toEqual([
      'stream.ready',
      'run.start',
      'tool.start',
      'tool.end',
      'part.start',
      'text.delta',
      'text.delta',
      'part.end',
      'run.end',
    ]);
    const result = await stream.finalResult();
    expect(result.text).toBe('Hello world');
    expect(result.status).toBe('completed');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ tokens: { input: 3, output: 2 } });
  });

  it('textStream() yields only new text and finalText() resolves after', async () => {
    const body =
      frame({ type: 'part.start', seq: 1, payload: { part_id: 'p', kind: 'text' } }) +
      frame({ type: 'text.delta', seq: 2, payload: { part_id: 'p', offset: 0, text: 'Hel' } }) +
      // a replay of seq 2, as a resume would send it
      frame({ type: 'text.delta', seq: 2, payload: { part_id: 'p', offset: 0, text: 'Hel' } }) +
      frame({
        type: 'reasoning.delta',
        seq: 3,
        payload: { part_id: 'r', offset: 0, text: 'hmm' },
      }) +
      frame({ type: 'text.delta', seq: 4, payload: { part_id: 'p', offset: 3, text: 'lo' } }) +
      frame({ type: 'brand.new.event', seq: 5, payload: {} }) +
      frame({ type: 'run.end', seq: 6, payload: { status: 'completed', finish_reason: 'stop' } });
    const fetch = scriptedFetch([laeResponse(body)]);
    const stream = await client(fetch).runs.stream({ profile_id: PROFILE, input: 'Hi' });
    const chunks: string[] = [];
    for await (const text of stream.textStream()) chunks.push(text);
    expect(chunks).toEqual(['Hel', 'lo']);
    expect(await stream.finalText()).toBe('Hello');
  });

  it('finalText() alone consumes the stream; a second iteration is refused', async () => {
    const fetch = scriptedFetch([laeResponse(simpleRun('Answer.'))]);
    const stream = await client(fetch).runs.stream({ profile_id: PROFILE, input: 'Hi' });
    expect(await stream.finalText()).toBe('Answer.');
    expect(await stream.finalText()).toBe('Answer.');
    await expect(async () => {
      for await (const _ of stream) void _;
    }).rejects.toThrow(/already been consumed/);
  });

  it('records interrupt.raised on the result', async () => {
    const body =
      frame({
        type: 'interrupt.raised',
        seq: 1,
        payload: {
          interrupt_id: 'int_1',
          kind: 'approval',
          tool_call: { tool_name: 'send_email' },
        },
      }) + frame({ type: 'run.state', seq: 2, payload: { status: 'awaiting_input' } });
    const fetch = scriptedFetch([laeResponse(body)]);
    const stream = await client(fetch).runs.stream({ profile_id: PROFILE, input: 'Hi' });
    const result = await stream.finalResult();
    expect(result.interrupt).toMatchObject({ interrupt_id: 'int_1' });
    expect(result.status).toBeNull();
  });

  it('rejects before streaming when the API refuses the run', async () => {
    const fetch = scriptedFetch([
      json(
        {
          error: {
            type: 'not_found_error',
            code: 'profile_not_found',
            message: 'x',
            request_id: 'r',
            param: 'profile_id',
          },
        },
        { status: 404 },
      ),
    ]);
    await expect(
      client(fetch).runs.stream({ profile_id: PROFILE, input: 'Hi' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('abort() ends iteration quietly with the text so far', async () => {
    let enqueue!: (s: string) => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        enqueue = (s) => controller.enqueue(enc.encode(s));
      },
    });
    // The body never closes on its own: only abort() can end this loop.
    const fetch = scriptedFetch([laeResponse(body)]);
    const stream = await client(fetch).runs.stream({ profile_id: PROFILE, input: 'Hi' });
    enqueue(frame({ type: 'part.start', seq: 1, payload: { part_id: 'p', kind: 'text' } }));
    enqueue(
      frame({ type: 'text.delta', seq: 2, payload: { part_id: 'p', offset: 0, text: 'partial' } }),
    );
    const seen: string[] = [];
    for await (const event of stream) {
      seen.push(event.type);
      if (event.type === 'text.delta') stream.abort();
    }
    expect(seen).toEqual(['part.start', 'text.delta']);
    expect(await stream.finalText()).toBe('partial');
    expect(stream.controller.signal.aborted).toBe(true);
  });

  it('an idempotent replay answered with JSON still streams the stored answer', async () => {
    const fetch = scriptedFetch([
      json(run({ output: { text: 'Stored.', artifacts: [], sources: [], tool_calls: [] } })),
    ]);
    const stream = await client(fetch).runs.stream(
      { profile_id: PROFILE, input: 'Hi' },
      { idempotencyKey: 'same-key-1' },
    );
    expect(stream.replayedRun?.id).toBe('run_1');
    expect(stream.runId).toBe('run_1');
    expect(stream.conversationId).toBe('conv_BBBBBBBBBBBBBBBBBBBBBBBB');
    const result = await stream.finalResult();
    expect(result.text).toBe('Stored.');
    expect(result.status).toBe('completed');
  });

  it('toReadableStream() hands the upstream SSE through byte-for-byte', async () => {
    const text = simpleRun();
    const fetch = scriptedFetch([laeResponse(text)]);
    const stream = await client(fetch).runs.stream({ profile_id: PROFILE, input: 'Hi' });
    expect(await new Response(stream.toReadableStream()).text()).toBe(text);
  });
});

describe('runs.wait', () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => vi.useRealTimers());

  it('returns at once when the wait finished', async () => {
    const fetch = scriptedFetch([json(run())]);
    const result = await client(fetch).runs.wait({ profile_id: PROFILE, input: 'Hi' });
    expect(result.status).toBe('completed');
    expect(fetch.calls).toHaveLength(1);
    expect(fetch.calls[0]!.body).toMatchObject({ mode: 'wait' });
  });

  it('polls runs.get with backoff after a 202 until the run is terminal', async () => {
    const fetch = scriptedFetch([
      json(run({ status: 'running', completed_at: null }), { status: 202 }),
      json(run({ status: 'running', completed_at: null })),
      json(run({ status: 'completed' })),
    ]);
    const promise = client(fetch).runs.wait(
      { profile_id: PROFILE, input: 'Hi' },
      { pollIntervalMs: 100, maxPollIntervalMs: 150 },
    );
    await vi.advanceTimersByTimeAsync(100);
    expect(fetch.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(150);
    const result = await promise;
    expect(result.status).toBe('completed');
    expect(fetch.calls.map((c) => `${c.init.method} ${new URL(c.url).pathname}`)).toEqual([
      'POST /api/public/v1/runs',
      'GET /api/public/v1/runs/run_1',
      'GET /api/public/v1/runs/run_1',
    ]);
    expect(fetch.calls[1]!.headers.get('idempotency-key')).toBeNull();
  });

  it('stops polling at requires_action', async () => {
    const fetch = scriptedFetch([
      json(run({ status: 'running' }), { status: 202 }),
      json(run({ status: 'requires_action' })),
    ]);
    const promise = client(fetch).runs.wait(
      { profile_id: PROFILE, input: 'Hi' },
      { pollIntervalMs: 10 },
    );
    await vi.advanceTimersByTimeAsync(10);
    expect((await promise).status).toBe('requires_action');
  });
});

describe('other run endpoints', () => {
  it('get, events, cancel and resolveInterrupt hit the documented paths', async () => {
    const fetch = scriptedFetch([
      json(run()),
      json({
        object: 'list',
        run_id: 'run_1',
        data: [{ seq: 4, type: 'text.delta', payload: {}, created_at: 'x' }],
        has_more: false,
      }),
      json(run({ status: 'canceled' })),
      json(run({ status: 'running' })),
    ]);
    const c = client(fetch);
    await c.runs.get('run_1');
    const events = await c.runs.events('run_1', { after: 3 });
    await c.runs.cancel('run_1');
    await c.runs.resolveInterrupt('run_1', 'int/1', { decision: 'answer', payload: { to: 'x' } });

    expect(events.data[0]!.seq).toBe(4);
    const [get, list, cancel, resolve] = fetch.calls;
    expect(get!.init.method).toBe('GET');
    expect(get!.url).toBe(`${BASE}/runs/run_1`);
    expect(list!.url).toBe(`${BASE}/runs/run_1/events?after=3`);
    expect(cancel!.init.method).toBe('POST');
    expect(cancel!.url).toBe(`${BASE}/runs/run_1/cancel`);
    expect(cancel!.init.body).toBeNull();
    expect(resolve!.url).toBe(`${BASE}/runs/run_1/interrupts/int%2F1`);
    expect(resolve!.body).toEqual({ decision: 'answer', payload: { to: 'x' } });
    expect(resolve!.headers.get('idempotency-key')).toBeTruthy();
  });

  it('followEvents GETs ?stream=true with after and returns a RunStream keyed by the run id', async () => {
    const fetch = scriptedFetch([
      new Response(simpleRun('Resumed'), { headers: { 'content-type': 'text/event-stream' } }),
    ]);
    const stream = await client(fetch).runs.followEvents('run_1', { after: 4 });
    const call = fetch.calls[0]!;
    expect(call.init.method).toBe('GET');
    expect(call.url).toBe(`${BASE}/runs/run_1/events?after=4&stream=true`);
    expect(call.headers.get('accept')).toBe('text/event-stream');
    expect(stream.runId).toBe('run_1');
    expect(await stream.finalText()).toBe('Resumed');
  });
});

describe('conversations, profiles, keys, usage', () => {
  it('build the documented requests and return the parsed bodies', async () => {
    const fetch = scriptedFetch([
      json({ object: 'conversation', id: 'conv_1', runs: [] }),
      json({ object: 'list', data: [{ object: 'profile', id: PROFILE }], has_more: false }),
      json({ object: 'profile', id: PROFILE }),
      json({ object: 'api_key', id: 'key_1', scopes: ['runs:write'] }),
      json({ object: 'usage', data: [], bucket_width: '1d' }),
    ]);
    const c = client(fetch);
    const conversation = await c.conversations.get('conv_1', { endUserId: 'user 1' });
    const profiles = await c.profiles.list();
    const profile = await c.profiles.get(PROFILE);
    const key = await c.keys.self();
    const usage = await c.usage.get({
      start: new Date('2026-10-01T00:00:00.000Z'),
      end: '2026-10-08',
      groupBy: 'model',
    });

    expect(conversation.object).toBe('conversation');
    expect(profiles.data[0]!.id).toBe(PROFILE);
    expect(profile.object).toBe('profile');
    expect(key.scopes).toEqual(['runs:write']);
    expect(usage.object).toBe('usage');

    const urls = fetch.calls.map((call) => call.url);
    expect(urls).toEqual([
      `${BASE}/conversations/conv_1?end_user_id=user+1`,
      `${BASE}/profiles`,
      `${BASE}/profiles/${PROFILE}`,
      `${BASE}/keys/self`,
      `${BASE}/usage?start=2026-10-01T00%3A00%3A00.000Z&end=2026-10-08&group_by=model`,
    ]);
    expect(fetch.calls.every((call) => call.init.method === 'GET')).toBe(true);
    expect(fetch.calls.every((call) => call.headers.get('idempotency-key') === null)).toBe(true);
  });

  it('omits the end_user_id query when none is given', async () => {
    const fetch = scriptedFetch([json({ object: 'conversation' })]);
    await client(fetch).conversations.get('conv_1');
    expect(fetch.calls[0]!.url).toBe(`${BASE}/conversations/conv_1`);
  });
});
