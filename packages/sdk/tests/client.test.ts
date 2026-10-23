import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LigaX, DEFAULT_BASE_URL } from '../src/index.js';
import { BrowserEnvironmentError, MissingApiKeyError } from '../src/core/errors.js';
import { json, scriptedFetch } from './helpers.js';

describe('LigaX client options', () => {
  const env = { ...process.env };
  beforeEach(() => {
    delete process.env.LIGAX_API_KEY;
    delete process.env.LIGAX_BASE_URL;
    delete process.env.LIGAX_LOG;
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  it('reads the API key and base URL from the environment', () => {
    process.env.LIGAX_API_KEY = 'sk_env';
    process.env.LIGAX_BASE_URL = 'https://env.example/v1';
    const client = new LigaX();
    expect(client.apiKey).toBe('sk_env');
    expect(client.baseURL).toBe('https://env.example/v1');
  });

  it('prefers explicit arguments over the environment, and falls back to the default URL', () => {
    process.env.LIGAX_API_KEY = 'sk_env';
    const client = new LigaX({ apiKey: 'sk_arg' });
    expect(client.apiKey).toBe('sk_arg');
    expect(client.baseURL).toBe(DEFAULT_BASE_URL);
  });

  it('sends Authorization, User-Agent, Accept and default headers', async () => {
    const fetch = scriptedFetch([json({ object: 'api_key', id: 'key_1' })]);
    const client = new LigaX({
      apiKey: 'sk_test',
      baseURL: 'https://api.example/v1',
      fetch,
      defaultHeaders: { 'X-Tenant': 'acme' },
    });
    await client.keys.self();
    const [call] = fetch.calls;
    expect(call?.url).toBe('https://api.example/v1/keys/self');
    expect(call?.headers.get('authorization')).toBe('Bearer sk_test');
    expect(call?.headers.get('user-agent')).toMatch(
      /^ligaxai-typescript-typescript\/\d+\.\d+\.\d+/,
    );
    expect(call?.headers.get('accept')).toBe('application/json');
    expect(call?.headers.get('x-tenant')).toBe('acme');
    expect(call?.headers.get('idempotency-key')).toBeNull();
  });

  it('refuses to build a client with no usable key, before any request', () => {
    const fetch = scriptedFetch([]);
    const saved = process.env['LIGAX_API_KEY'];
    delete process.env['LIGAX_API_KEY'];
    try {
      expect(() => new LigaX({ baseURL: 'https://api.example', fetch })).toThrow(
        MissingApiKeyError,
      );
      expect(() => new LigaX({ apiKey: '', baseURL: 'https://api.example', fetch })).toThrow(
        MissingApiKeyError,
      );
      expect(
        () => new LigaX({ apiKey: 'lgx_sk_dev_abc\n', baseURL: 'https://api.example', fetch }),
      ).toThrow(MissingApiKeyError);
    } finally {
      if (saved !== undefined) process.env['LIGAX_API_KEY'] = saved;
    }
    expect(fetch.calls).toHaveLength(0);
  });

  it('a per-request token comes from a provider', async () => {
    const fetch = scriptedFetch([json({ object: 'api_key', id: 'key_1' })]);
    const client = new LigaX({ apiKey: () => 'lgx_ct_abc', baseURL: 'https://api.example', fetch });
    await client.keys.self();
    expect(fetch.calls[0]?.headers.get('authorization')).toBe('Bearer lgx_ct_abc');
  });

  it('never shows the key when the client is logged or serialised', async () => {
    const { inspect } = await import('node:util');
    const client = new LigaX({ apiKey: 'lgx_sk_dev_SECRETVALUE', baseURL: 'https://api.example' });
    expect(inspect(client, { depth: 5 })).not.toContain('SECRETVALUE');
    expect(JSON.stringify(client)).not.toContain('SECRETVALUE');
    expect(Object.keys(client)).not.toContain('apiKey');
    expect(client.apiKey).toBe('lgx_sk_dev_SECRETVALUE');
  });

  it('accepts https, and http only on this machine', () => {
    const ok = (baseURL: string) => new LigaX({ apiKey: 'k', baseURL });
    expect(() => ok('https://api.example/api/public/v1')).not.toThrow();
    expect(() => ok('http://localhost:3000/api/public/v1')).not.toThrow();
    expect(() => ok('http://api.example/api/public/v1')).toThrow(TypeError);
  });

  it('refuses request paths that would leave the API', async () => {
    const fetch = scriptedFetch([]);
    const client = new LigaX({ apiKey: 'k', baseURL: 'https://api.example/api/public/v1', fetch });
    for (const path of [
      'https://evil.example/x',
      '//evil.example/x',
      '/runs/../../admin',
      '/runs/%2e%2e/keys',
    ]) {
      await expect(client.get(path)).rejects.toThrow(TypeError);
    }
    expect(fetch.calls).toHaveLength(0);
  });

  it('exposes the request id on the result and via withResponse()', async () => {
    const fetch = scriptedFetch([
      json({ object: 'api_key', id: 'key_1' }, { headers: { 'x-request-id': 'req_123' } }),
      json({ object: 'api_key', id: 'key_1' }, { headers: { 'x-request-id': 'req_456' } }),
    ]);
    const client = new LigaX({ apiKey: 'k', baseURL: 'https://api.example', fetch });
    const key = await client.keys.self();
    expect((key as { _request_id?: string })._request_id).toBe('req_123');
    expect(JSON.stringify(key)).not.toContain('req_123');

    const { data, response, request_id } = await client.keys.self().withResponse();
    expect(data.object).toBe('api_key');
    expect(response.status).toBe(200);
    expect(request_id).toBe('req_456');
  });

  it('asResponse() hands back the unread Response', async () => {
    const fetch = scriptedFetch([json({ object: 'api_key', id: 'key_1' })]);
    const client = new LigaX({ apiKey: 'k', baseURL: 'https://api.example', fetch });
    const response = await client.keys.self().asResponse();
    expect(response.bodyUsed).toBe(false);
    expect(await response.json()).toEqual({ object: 'api_key', id: 'key_1' });
  });

  it('refuses to construct in a browser-like environment unless opted in', () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', {});
    expect(() => new LigaX({ apiKey: 'k' })).toThrow(BrowserEnvironmentError);
    expect(() => new LigaX({ apiKey: 'k', dangerouslyAllowBrowser: true })).not.toThrow();
  });

  it('routes logs through the injected logger and redacts Authorization', async () => {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const fetch = scriptedFetch([json({ object: 'api_key', id: 'key_1' })]);
    const client = new LigaX({
      apiKey: 'sk_secret',
      baseURL: 'https://api.example',
      fetch,
      logger,
      logLevel: 'debug',
    });
    await client.keys.self();
    expect(logger.debug).toHaveBeenCalled();
    const serialized = JSON.stringify(logger.debug.mock.calls);
    expect(serialized).not.toContain('sk_secret');
    expect(serialized).toContain('***');
  });
});
