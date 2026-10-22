import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UIMessage, UIMessageChunk } from 'ai';

import { LigaX, cachedTokenProvider } from '../src/index.js';
import { createLigaXTransport } from '../src/ai-sdk.js';
import {
  AuthenticationError,
  BrowserEnvironmentError,
  PermissionDeniedError,
} from '../src/errors.js';
import { createTokenRoute } from '../src/next.js';
import { json, scriptedFetch } from './helpers.js';
import { laeResponse, simpleRun } from './lae.js';

const silent = { error() {}, warn() {}, info() {}, debug() {} };
const PROFILE = 'prf_AAAAAAAAAAAAAAAAAAAA';

const expired = () =>
  json(
    {
      error: {
        type: 'authentication_error',
        code: 'token_expired',
        message: 'This client token has expired.',
        request_id: 'req_x',
      },
    },
    { status: 401 },
  );

function stubBrowser(): void {
  vi.stubGlobal('window', {});
  vi.stubGlobal('document', {});
  vi.stubGlobal('navigator', {});
}

afterEach(() => vi.unstubAllGlobals());

describe('token provider', () => {
  it('calls the provider before the request and sends its token', async () => {
    const fetch = scriptedFetch([json({ id: 'run_1', status: 'completed' })]);
    const provider = vi.fn(() => 'lgx_ct_one');
    const client = new LigaX({ apiKey: provider, baseURL: 'https://api.example', fetch });
    await client.runs.get('run_1');
    expect(provider).toHaveBeenCalledWith({ refresh: false });
    expect(fetch.calls[0]?.headers.get('authorization')).toBe('Bearer lgx_ct_one');
    expect(client.apiKey).toBeUndefined();
  });

  it('refreshes once on 401 token_expired and resends with the same idempotency key', async () => {
    const fetch = scriptedFetch([expired(), json({ id: 'run_1', status: 'queued' })]);
    let n = 0;
    const provider = vi.fn(async (_ctx: { refresh: boolean }) => `lgx_ct_${++n}`);
    const client = new LigaX({
      apiKey: provider,
      baseURL: 'https://api.example',
      fetch,
      maxRetries: 0,
      logger: silent,
    });
    const run = await client.runs.create({ profile_id: PROFILE, input: 'hi', mode: 'async' });
    expect(run.id).toBe('run_1');
    expect(provider.mock.calls.map((c) => c[0])).toEqual([{ refresh: false }, { refresh: true }]);
    expect(fetch.calls.map((c) => c.headers.get('authorization'))).toEqual([
      'Bearer lgx_ct_1',
      'Bearer lgx_ct_2',
    ]);
    const keys = fetch.calls.map((c) => c.headers.get('idempotency-key'));
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('refreshes only once: a second token_expired surfaces as AuthenticationError', async () => {
    const fetch = scriptedFetch([expired(), expired()]);
    const provider = vi.fn(() => 'lgx_ct_stale');
    const client = new LigaX({
      apiKey: provider,
      baseURL: 'https://api.example',
      fetch,
      logger: silent,
    });
    const error = await client.runs.get('run_1').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as AuthenticationError).code).toBe('token_expired');
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it('does not refresh a fixed key, nor on another 401', async () => {
    const fixed = scriptedFetch([expired()]);
    const client = new LigaX({
      apiKey: 'lgx_ct_fixed',
      baseURL: 'https://api.example',
      fetch: fixed,
      logger: silent,
    });
    await expect(client.runs.get('run_1')).rejects.toBeInstanceOf(AuthenticationError);
    expect(fixed.calls).toHaveLength(1);

    const other = scriptedFetch([
      json({ error: { code: 'invalid_client_token', message: 'bad' } }, { status: 401 }),
    ]);
    const provider = vi.fn(() => 'lgx_ct_x');
    const viaProvider = new LigaX({
      apiKey: provider,
      baseURL: 'https://api.example',
      fetch: other,
      logger: silent,
    });
    await expect(viaProvider.runs.get('run_1')).rejects.toBeInstanceOf(AuthenticationError);
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('cachedTokenProvider reuses a token until shortly before expiry, and refetches on refresh', async () => {
    let now = Date.parse('2026-10-22T10:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let n = 0;
    const fetchToken = vi.fn(async (_ctx: { refresh: boolean }) => ({
      token: `lgx_ct_${++n}`,
      expires_at: new Date(now + 600_000).toISOString(),
    }));
    const provider = cachedTokenProvider(fetchToken);
    const [a, b] = await Promise.all([provider({ refresh: false }), provider({ refresh: false })]);
    expect([a, b]).toEqual(['lgx_ct_1', 'lgx_ct_1']);
    expect(fetchToken).toHaveBeenCalledTimes(1);

    now += 560_000; // still > 30 s left
    expect(await provider({ refresh: false })).toBe('lgx_ct_1');
    now += 20_000; // inside the refresh window
    expect(await provider({ refresh: false })).toBe('lgx_ct_2');
    expect(await provider({ refresh: true })).toBe('lgx_ct_3');
    expect(fetchToken.mock.calls.at(-1)?.[0]).toEqual({ refresh: true });
    vi.restoreAllMocks();
  });
});

describe('browser guard', () => {
  it('refuses a secret key in a browser, accepts client tokens, publishable keys and providers', () => {
    stubBrowser();
    expect(() => new LigaX({ apiKey: 'lgx_sk_live_abc' })).toThrow(BrowserEnvironmentError);
    expect(() => new LigaX({})).toThrow(BrowserEnvironmentError);
    expect(() => new LigaX({ apiKey: 'lgx_ct_abc.def' })).not.toThrow();
    expect(() => new LigaX({ apiKey: 'lgx_pk_live_abc' })).not.toThrow();
    expect(() => new LigaX({ apiKey: () => 'lgx_ct_abc' })).not.toThrow();
    expect(
      () => new LigaX({ apiKey: 'lgx_sk_live_abc', dangerouslyAllowBrowser: true }),
    ).not.toThrow();
  });

  it('refuses a provider that hands a secret key to a browser, before anything is sent', async () => {
    stubBrowser();
    const fetch = scriptedFetch([]);
    const client = new LigaX({
      apiKey: () => 'lgx_sk_live_abc',
      baseURL: 'https://api.example',
      fetch,
    });
    await expect(client.runs.get('run_1')).rejects.toBeInstanceOf(BrowserEnvironmentError);
    expect(fetch.calls).toHaveLength(0);
  });
});

describe('client.clientTokens.create', () => {
  it('POSTs /client_tokens with the body and an idempotency key', async () => {
    const minted = {
      object: 'client_token',
      token: 'lgx_ct_abc.def',
      expires_at: '2026-10-22T10:10:00.000Z',
      profile_id: PROFILE,
      end_user_id: 'user_42',
      conversation_id: null,
    };
    const fetch = scriptedFetch([json(minted, { status: 201 })]);
    const client = new LigaX({ apiKey: 'lgx_sk_test', baseURL: 'https://api.example', fetch });
    const token = await client.clientTokens.create({
      profile_id: PROFILE,
      end_user: { id: 'user_42', name: 'Ada' },
      expires_in: 300,
    });
    expect(token).toEqual(minted);
    const call = fetch.calls[0]!;
    expect(call.url).toBe('https://api.example/client_tokens');
    expect(call.init.method).toBe('POST');
    expect(call.headers.get('authorization')).toBe('Bearer lgx_sk_test');
    expect(call.headers.get('idempotency-key')).toBeTruthy();
    expect(call.body).toEqual({
      profile_id: PROFILE,
      end_user: { id: 'user_42', name: 'Ada' },
      expires_in: 300,
    });
  });
});

describe('createTokenRoute', () => {
  const minted = (over: Record<string, unknown> = {}) =>
    json(
      {
        object: 'client_token',
        token: 'lgx_ct_abc.def',
        expires_at: '2026-10-22T10:10:00.000Z',
        profile_id: PROFILE,
        end_user_id: 'user_42',
        conversation_id: null,
        ...over,
      },
      { status: 201 },
    );
  const req = () => new Request('http://localhost/api/ligax-token', { method: 'POST' });

  it('mints a token for the signed-in user and answers it uncached', async () => {
    const fetch = scriptedFetch([minted()]);
    const { POST } = createTokenRoute({
      apiKey: 'lgx_sk_server',
      baseURL: 'https://api.example',
      fetch,
      logger: silent,
      profileId: PROFILE,
      expiresIn: 900,
      resolveEndUser: () => ({ id: 'user_42', name: 'Ada' }),
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({
      token: 'lgx_ct_abc.def',
      expires_at: '2026-10-22T10:10:00.000Z',
      profile_id: PROFILE,
    });
    const call = fetch.calls[0]!;
    expect(call.url).toBe('https://api.example/client_tokens');
    expect(call.headers.get('authorization')).toBe('Bearer lgx_sk_server');
    expect(call.body).toEqual({
      profile_id: PROFILE,
      end_user: { id: 'user_42', name: 'Ada' },
      expires_in: 900,
    });
  });

  it('answers 401 without calling the API when there is no user', async () => {
    const fetch = scriptedFetch([]);
    const { POST } = createTokenRoute({
      apiKey: 'lgx_sk_server',
      fetch,
      profileId: PROFILE,
      resolveEndUser: () => null,
    });
    const res = await POST(req());
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_signed_in');
    expect(fetch.calls).toHaveLength(0);
  });

  it('accepts a string user id, pins a conversation, and hides the server key’s own refusals', async () => {
    const fetch = scriptedFetch([
      minted({ conversation_id: 'conv_CCCCCCCCCCCCCCCCCCCCCCCC' }),
      json(
        { error: { type: 'permission_error', code: 'insufficient_scope', message: 'no' } },
        { status: 403, headers: { 'x-request-id': 'req_403' } },
      ),
    ]);
    const { POST } = createTokenRoute({
      apiKey: 'lgx_sk_server',
      baseURL: 'https://api.example',
      fetch,
      logger: silent,
      profileId: PROFILE,
      resolveEndUser: () => 'user_42',
      resolveConversationId: () => 'conv_CCCCCCCCCCCCCCCCCCCCCCCC',
    });
    const ok = await POST(req());
    expect(((await ok.json()) as { conversation_id?: string }).conversation_id).toBe(
      'conv_CCCCCCCCCCCCCCCCCCCCCCCC',
    );
    expect(fetch.calls[0]?.body).toEqual({
      profile_id: PROFILE,
      end_user: { id: 'user_42' },
      conversation_id: 'conv_CCCCCCCCCCCCCCCCCCCCCCCC',
    });
    // A scope the server's key lacks is a server problem: the browser gets a generic 502.
    const denied = await POST(req());
    expect(denied.status).toBe(502);
    expect(await denied.text()).not.toContain('insufficient_scope');
    expect(denied.headers.get('x-request-id')).toBe('req_403');
  });
});

describe('createLigaXTransport direct mode', () => {
  const messages: UIMessage[] = [
    { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
  ];
  const send = (transport: ReturnType<typeof createLigaXTransport>, chatId = 'chat_1') =>
    transport.sendMessages({
      trigger: 'submit-message',
      chatId,
      messageId: undefined,
      messages,
      abortSignal: undefined,
    });
  async function collect(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
    const out: UIMessageChunk[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return out;
      out.push(value);
    }
  }

  it('POSTs /runs to the API with the token, the profile and the conversation from the last turn', async () => {
    const fetch = scriptedFetch([
      laeResponse(simpleRun('Hi there')),
      laeResponse(simpleRun('Again')),
    ]);
    const getToken = vi.fn(async () => ({
      token: 'lgx_ct_abc.def',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    }));
    const runs: unknown[] = [];
    const transport = createLigaXTransport({
      baseURL: 'https://api.example/api/public/v1',
      profileId: PROFILE,
      getToken,
      fetch,
      body: { metadata: { page: 'pricing' } },
      onRun: (r) => runs.push(r),
    });

    const chunks = await collect(await send(transport));
    const text = chunks
      .filter((c): c is Extract<UIMessageChunk, { type: 'text-delta' }> => c.type === 'text-delta')
      .map((c) => c.delta)
      .join('');
    expect(text).toBe('Hi there');
    expect(chunks.at(-1)).toEqual({ type: 'finish', finishReason: 'stop' });

    const first = fetch.calls[0]!;
    expect(first.url).toBe('https://api.example/api/public/v1/runs');
    expect(first.headers.get('authorization')).toBe('Bearer lgx_ct_abc.def');
    expect(first.headers.get('accept')).toBe('text/event-stream');
    expect(first.body).toEqual({
      metadata: { page: 'pricing' },
      profile_id: PROFILE,
      input: 'hello',
      mode: 'stream',
    });
    expect(runs[0]).toEqual({
      chatId: 'chat_1',
      runId: 'run_test_1',
      conversationId: 'conv_CCCCCCCCCCCCCCCCCCCCCCCC',
    });

    await collect(await send(transport));
    expect((fetch.calls[1]?.body as { conversation_id?: string }).conversation_id).toBe(
      'conv_CCCCCCCCCCCCCCCCCCCCCCCC',
    );
    // The token was cached across both turns.
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('refreshes an expired token and maps API errors to typed errors', async () => {
    const fetch = scriptedFetch([
      expired(),
      laeResponse(simpleRun('ok')),
      json({ error: { code: 'token_scope', message: 'no' } }, { status: 403 }),
    ]);
    let n = 0;
    const transport = createLigaXTransport({
      profileId: PROFILE,
      getToken: () => `lgx_ct_${++n}`,
      fetch,
    });
    await collect(await send(transport));
    expect(fetch.calls.map((c) => c.headers.get('authorization'))).toEqual([
      'Bearer lgx_ct_1',
      'Bearer lgx_ct_2',
    ]);
    await expect(send(transport, 'chat_2')).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it('learns the profile from the token answer when no profileId is given', async () => {
    const fetch = scriptedFetch([laeResponse(simpleRun('ok'))]);
    const transport = createLigaXTransport({
      getToken: async () => ({ token: 'lgx_ct_x', expires_at: null, profile_id: PROFILE }),
      fetch,
    });
    await collect(await send(transport));
    expect((fetch.calls[0]?.body as { profile_id: string }).profile_id).toBe(PROFILE);
  });

  it('fails clearly with no profile anywhere', async () => {
    const transport = createLigaXTransport({
      getToken: () => 'lgx_ct_x',
      fetch: scriptedFetch([]),
    });
    await expect(send(transport)).rejects.toThrow(/profileId/);
  });
});
