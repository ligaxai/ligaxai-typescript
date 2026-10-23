import { describe, expect, it } from 'vitest';

import { createRouteHandler, createRunProxy, createRunRoute } from '../src/next.js';
import { chunkedBody, json, scriptedFetch } from './helpers.js';
import { laeResponse, simpleRun } from './lae.js';

const JSON_HEADERS = { 'content-type': 'application/json' };

const silent = { error() {}, warn() {}, info() {}, debug() {} };

describe('createRouteHandler', () => {
  it('proxies a JSON POST to the SDK and returns the upstream JSON', async () => {
    const fetch = scriptedFetch([
      json({ id: 'run_1', status: 'queued' }, { headers: { 'x-request-id': 'req_9' } }),
    ]);
    const { POST } = createRouteHandler({
      apiKey: 'sk_server',
      baseURL: 'https://api.example',
      fetch,
      logger: silent,
      resolve: ({ body }) => ({ path: '/runs', body: { ...(body as object), profile: 'support' } }),
    });

    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ input: 'hi' }),
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('x-request-id')).toBe('req_9');
    expect(await res.json()).toEqual({ id: 'run_1', status: 'queued' });

    const upstream = fetch.calls[0];
    expect(upstream?.url).toBe('https://api.example/runs');
    expect(upstream?.headers.get('authorization')).toBe('Bearer sk_server');
    expect(upstream?.body).toEqual({ input: 'hi', profile: 'support' });
  });

  it('streams an upstream text/event-stream body straight through', async () => {
    const fetch = scriptedFetch([
      new Response(chunkedBody(['data: {"a":1}\n\n', 'data: [DONE]\n\n']), {
        headers: { 'content-type': 'text/event-stream' },
      }),
    ]);
    const { POST } = createRouteHandler({
      apiKey: 'k',
      baseURL: 'https://api.example',
      fetch,
      logger: silent,
      resolve: () => ({ path: '/runs', body: {}, stream: true }),
    });
    const res = await POST(
      new Request('http://localhost/x', { method: 'POST', headers: JSON_HEADERS, body: '{}' }),
    );
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(res.headers.get('cache-control')).toContain('no-cache');
    expect(await res.text()).toBe('data: {"a":1}\n\ndata: [DONE]\n\n');
    expect(fetch.calls[0]?.headers.get('accept')).toBe('text/event-stream');
  });

  it('answers 400 on a non-JSON body or a null resolve', async () => {
    const { POST } = createRouteHandler({
      apiKey: 'k',
      baseURL: 'https://api.example',
      fetch: scriptedFetch([]),
      logger: silent,
      resolve: () => null,
    });
    expect(
      (
        await POST(
          new Request('http://x', { method: 'POST', headers: JSON_HEADERS, body: 'not json' }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(new Request('http://x', { method: 'POST', headers: JSON_HEADERS, body: '{}' })))
        .status,
    ).toBe(400);
  });

  it('forwards upstream API errors with their status and body', async () => {
    const fetch = scriptedFetch([
      json({ error: { type: 'invalid_request_error', message: 'bad' } }, { status: 422 }),
    ]);
    const { POST } = createRouteHandler({
      apiKey: 'k',
      baseURL: 'https://api.example',
      fetch,
      logger: silent,
      resolve: () => ({ path: '/runs', body: {} }),
    });
    const res = await POST(
      new Request('http://x', { method: 'POST', headers: JSON_HEADERS, body: '{}' }),
    );
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: { type: 'invalid_request_error', message: 'bad' } });
  });

  it('GET answers 204 without a reconnect resolver, and proxies with one', async () => {
    const noReconnect = createRouteHandler({
      apiKey: 'k',
      baseURL: 'https://api.example',
      fetch: scriptedFetch([]),
      logger: silent,
      resolve: () => null,
    });
    expect((await noReconnect.GET(new Request('http://x/chat_1/stream'))).status).toBe(204);

    const fetch = scriptedFetch([
      new Response('data: {"a":1}\n\n', { headers: { 'content-type': 'text/event-stream' } }),
    ]);
    const { GET } = createRouteHandler({
      apiKey: 'k',
      baseURL: 'https://api.example',
      fetch,
      logger: silent,
      resolve: () => null,
      resolveReconnect: ({ request }) => ({
        path: `/runs/${new URL(request.url).pathname.split('/')[1]}/events`,
        stream: true,
      }),
    });
    const res = await GET(new Request('http://x/run_7/stream'));
    expect(res.status).toBe(200);
    expect(fetch.calls[0]?.url).toBe('https://api.example/runs/run_7/events');
    expect(fetch.calls[0]?.init.method).toBe('GET');
  });
});

describe('createRunRoute', () => {
  const PROFILE = 'prf_AAAAAAAAAAAAAAAAAAAA';

  it('turns useChat messages into a streamed run and returns the LAE stream with its ids', async () => {
    const upstream = simpleRun('Hi!');
    const fetch = scriptedFetch([laeResponse(upstream)]);
    const { POST } = createRunRoute({
      apiKey: 'lgx_sk_server',
      baseURL: 'https://api.example/v1',
      fetch,
      logger: silent,
      profileId: PROFILE,
      resolveEndUser: (request) => request.headers.get('x-session-user'),
    });

    const res = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'x-session-user': 'user-7' },
        body: JSON.stringify({
          id: 'chat_1',
          conversation_id: 'conv_CCCCCCCCCCCCCCCCCCCCCCCC',
          profile_id: 'prf_ZZZZZZZZZZZZZZZZZZZZ',
          messages: [
            { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'first' }] },
            { id: 'a1', role: 'assistant', parts: [{ type: 'text', text: 'ok' }] },
            {
              id: 'u2',
              role: 'user',
              parts: [
                { type: 'text', text: 'Hello ' },
                { type: 'text', text: 'there' },
              ],
            },
          ],
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('x-run-id')).toBe('run_test_1');
    expect(res.headers.get('x-conversation-id')).toBe('conv_CCCCCCCCCCCCCCCCCCCCCCCC');
    expect(await res.text()).toBe(upstream);

    const call = fetch.calls[0]!;
    expect(call.url).toBe('https://api.example/v1/runs');
    expect(call.headers.get('authorization')).toBe('Bearer lgx_sk_server');
    // The profile is pinned server-side; the browser's profile_id is ignored.
    expect(call.body).toEqual({
      profile_id: PROFILE,
      input: 'Hello there',
      conversation_id: 'conv_CCCCCCCCCCCCCCCCCCCCCCCC',
      end_user: { id: 'user-7' },
      mode: 'stream',
    });
  });

  it('accepts { input } and a custom mapInput, and drops a malformed conversation id', async () => {
    const fetch = scriptedFetch([laeResponse(simpleRun()), laeResponse(simpleRun())]);
    const plain = createRunRoute({
      apiKey: 'k',
      baseURL: 'https://api.example',
      fetch,
      logger: silent,
      profileId: PROFILE,
      allowAnonymous: true,
    });
    await (
      await plain.POST(
        new Request('http://x', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ input: 'Hi', conversation_id: 'nope' }),
        }),
      )
    ).text();
    expect(fetch.calls[0]!.body).toEqual({ profile_id: PROFILE, input: 'Hi', mode: 'stream' });

    const mapped = createRunRoute({
      apiKey: 'k',
      baseURL: 'https://api.example',
      fetch,
      logger: silent,
      profileId: PROFILE,
      allowAnonymous: true,
      mapInput: (body) => ({ text: `Q: ${(body as { q: string }).q}` }),
    });
    await (
      await mapped.POST(
        new Request('http://x', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ q: 'why' }),
        }),
      )
    ).text();
    expect(fetch.calls[1]!.body).toMatchObject({ input: { text: 'Q: why' } });
  });

  it('answers 400 without input and forwards an API refusal with its status', async () => {
    const fetch = scriptedFetch([
      json(
        {
          error: {
            type: 'billing_error',
            code: 'insufficient_credits',
            message: 'x',
            request_id: 'req_9',
          },
        },
        { status: 402, headers: { 'x-request-id': 'req_9' } },
      ),
    ]);
    const { POST } = createRunRoute({
      apiKey: 'k',
      baseURL: 'https://api.example',
      fetch,
      logger: silent,
      profileId: PROFILE,
      allowAnonymous: true,
    });
    expect(
      (
        await POST(
          new Request('http://x', {
            method: 'POST',
            headers: JSON_HEADERS,
            body: '{"messages":[]}',
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await POST(new Request('http://x', { method: 'POST', headers: JSON_HEADERS, body: 'nope' })))
        .status,
    ).toBe(400);
    const res = await POST(
      new Request('http://x', { method: 'POST', headers: JSON_HEADERS, body: '{"input":"Hi"}' }),
    );
    expect(res.status).toBe(402);
    expect(res.headers.get('x-request-id')).toBe('req_9');
    expect(await res.json()).toMatchObject({ error: { code: 'insufficient_credits' } });
    expect(fetch.calls).toHaveLength(1);
  });
});

describe('createRunProxy', () => {
  it('pins profile and end user, defaults mode to stream and forwards the Idempotency-Key', async () => {
    const fetch = scriptedFetch([laeResponse(simpleRun())]);
    const { POST } = createRunProxy({
      apiKey: 'k',
      baseURL: 'https://api.example',
      fetch,
      logger: silent,
      profileId: 'prf_AAAAAAAAAAAAAAAAAAAA',
      resolveEndUser: () => ({ id: 'session-user' }),
    });
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'idempotency-key': 'browser-key-123' },
        body: JSON.stringify({
          input: 'Hi',
          profile_id: 'prf_other',
          end_user: { id: 'spoofed' },
          metadata: { a: 'b' },
        }),
      }),
    );
    expect(res.headers.get('x-run-id')).toBe('run_test_1');
    expect(res.headers.get('x-conversation-id')).toBe('conv_CCCCCCCCCCCCCCCCCCCCCCCC');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const call = fetch.calls[0]!;
    expect(call.body).toEqual({
      input: 'Hi',
      profile_id: 'prf_AAAAAAAAAAAAAAAAAAAA',
      end_user: { id: 'session-user' },
      metadata: { a: 'b' },
      mode: 'stream',
    });
    expect(call.headers.get('idempotency-key')).toBe('browser-key-123');
    expect(call.headers.get('accept')).toBe('text/event-stream');
  });

  it('passes a wait-mode JSON answer through', async () => {
    const fetch = scriptedFetch([json({ object: 'run', id: 'run_1', status: 'completed' })]);
    const { POST } = createRunProxy({
      apiKey: 'k',
      baseURL: 'https://api.example',
      fetch,
      logger: silent,
      profileId: 'prf_AAAAAAAAAAAAAAAAAAAA',
      allowAnonymous: true,
    });
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ profile_id: 'prf_AAAAAAAAAAAAAAAAAAAA', input: 'Hi', mode: 'wait' }),
      }),
    );
    expect(await res.json()).toMatchObject({ id: 'run_1' });
    expect(fetch.calls[0]!.headers.get('accept')).toBe('application/json');
  });
});

describe('safe defaults for browser-facing routes', () => {
  const PROFILE = 'prf_AAAAAAAAAAAAAAAAAAAA';
  const base = { apiKey: 'k', baseURL: 'https://api.example', logger: silent };

  it('refuses to build a run route that would run for anyone', () => {
    expect(() => createRunRoute({ ...base, profileId: PROFILE })).toThrow(/resolveEndUser/);
    expect(() =>
      createRunProxy({ ...base, profileId: PROFILE } as Parameters<typeof createRunProxy>[0]),
    ).toThrow(/resolveEndUser/);
    expect(() =>
      createRunProxy({ ...base, resolveEndUser: () => 'u' } as unknown as Parameters<
        typeof createRunProxy
      >[0]),
    ).toThrow(/profileId/);
  });

  it('answers 401 without a signed-in user, before calling the API', async () => {
    const fetch = scriptedFetch([]);
    const { POST } = createRunRoute({
      ...base,
      fetch,
      profileId: PROFILE,
      resolveEndUser: () => null,
    });
    const res = await POST(
      new Request('http://x', { method: 'POST', headers: JSON_HEADERS, body: '{"input":"Hi"}' }),
    );
    expect(res.status).toBe(401);
    expect(fetch.calls).toHaveLength(0);
  });

  it('refuses cross-site requests and bodies not sent as JSON (CSRF)', async () => {
    const fetch = scriptedFetch([]);
    const { POST } = createRunRoute({
      ...base,
      fetch,
      profileId: PROFILE,
      resolveEndUser: () => 'u',
    });
    const crossSite = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'sec-fetch-site': 'cross-site' },
        body: '{"input":"Hi"}',
      }),
    );
    expect(crossSite.status).toBe(403);
    const plainText = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: '{"input":"Hi"}',
      }),
    );
    expect(plainText.status).toBe(415);
    expect(fetch.calls).toHaveLength(0);
  });

  it('the proxy forwards only the fields a browser may set', async () => {
    const fetch = scriptedFetch([json({ object: 'run', id: 'run_1', status: 'completed' })]);
    const { POST } = createRunProxy({
      ...base,
      fetch,
      profileId: PROFILE,
      resolveEndUser: () => 'u',
    });
    await POST(
      new Request('http://x', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          input: 'Hi',
          mode: 'wait',
          model: 'expensive/x',
          end_user: { id: 'v' },
          extra: 1,
        }),
      }),
    );
    expect(fetch.calls[0]!.body).toEqual({
      input: 'Hi',
      mode: 'wait',
      profile_id: PROFILE,
      end_user: { id: 'u' },
    });
  });

  it('never passes the server key’s own refusal to the browser', async () => {
    const fetch = scriptedFetch([
      json(
        {
          error: {
            type: 'authentication_error',
            code: 'key_revoked',
            message: 'Key lgx_sk… revoked',
          },
        },
        { status: 401, headers: { 'x-request-id': 'req_1' } },
      ),
    ]);
    const { POST } = createRunProxy({
      ...base,
      fetch,
      maxRetries: 0,
      profileId: PROFILE,
      resolveEndUser: () => 'u',
    });
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: '{"input":"Hi","mode":"wait"}',
      }),
    );
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('key_revoked');
    expect(res.headers.get('x-request-id')).toBe('req_1');
  });
});
