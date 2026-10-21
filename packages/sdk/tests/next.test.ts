import { describe, expect, it } from 'vitest';

import { createRouteHandler } from '../src/next.js';
import { chunkedBody, json, scriptedFetch } from './helpers.js';

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
    const res = await POST(new Request('http://localhost/x', { method: 'POST', body: '{}' }));
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
    expect((await POST(new Request('http://x', { method: 'POST', body: 'not json' }))).status).toBe(
      400,
    );
    expect((await POST(new Request('http://x', { method: 'POST', body: '{}' }))).status).toBe(400);
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
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }));
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
