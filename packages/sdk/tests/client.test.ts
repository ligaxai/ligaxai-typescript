import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LigaX, DEFAULT_BASE_URL } from '../src/index.js';
import { BrowserEnvironmentError } from '../src/core/errors.js';
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
    const fetch = scriptedFetch([json({ status: 'ok', version: '1' })]);
    const client = new LigaX({
      apiKey: 'sk_test',
      baseURL: 'https://api.example/v1',
      fetch,
      defaultHeaders: { 'X-Tenant': 'acme' },
    });
    await client.health.get();
    const [call] = fetch.calls;
    expect(call?.url).toBe('https://api.example/v1/health');
    expect(call?.headers.get('authorization')).toBe('Bearer sk_test');
    expect(call?.headers.get('user-agent')).toMatch(
      /^ligaxai-typescript-typescript\/\d+\.\d+\.\d+/,
    );
    expect(call?.headers.get('accept')).toBe('application/json');
    expect(call?.headers.get('x-tenant')).toBe('acme');
    expect(call?.headers.get('idempotency-key')).toBeNull();
  });

  it('omits Authorization when no key is configured (client-token flows set their own header)', async () => {
    const fetch = scriptedFetch([json({ status: 'ok', version: '1' })]);
    const client = new LigaX({ baseURL: 'https://api.example', fetch });
    await client.health.get({ headers: { Authorization: 'Bearer lgx_ct_abc' } });
    expect(fetch.calls[0]?.headers.get('authorization')).toBe('Bearer lgx_ct_abc');
  });

  it('exposes the request id on the result and via withResponse()', async () => {
    const fetch = scriptedFetch([
      json({ status: 'ok', version: '1' }, { headers: { 'x-request-id': 'req_123' } }),
      json({ status: 'ok', version: '1' }, { headers: { 'x-request-id': 'req_456' } }),
    ]);
    const client = new LigaX({ apiKey: 'k', baseURL: 'https://api.example', fetch });
    const health = await client.health.get();
    expect((health as { _request_id?: string })._request_id).toBe('req_123');
    expect(JSON.stringify(health)).not.toContain('req_123');

    const { data, response, request_id } = await client.health.get().withResponse();
    expect(data.status).toBe('ok');
    expect(response.status).toBe(200);
    expect(request_id).toBe('req_456');
  });

  it('asResponse() hands back the unread Response', async () => {
    const fetch = scriptedFetch([json({ status: 'ok', version: '1' })]);
    const client = new LigaX({ apiKey: 'k', baseURL: 'https://api.example', fetch });
    const response = await client.health.get().asResponse();
    expect(response.bodyUsed).toBe(false);
    expect(await response.json()).toEqual({ status: 'ok', version: '1' });
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
    const fetch = scriptedFetch([json({ status: 'ok', version: '1' })]);
    const client = new LigaX({
      apiKey: 'sk_secret',
      baseURL: 'https://api.example',
      fetch,
      logger,
      logLevel: 'debug',
    });
    await client.health.get();
    expect(logger.debug).toHaveBeenCalled();
    const serialized = JSON.stringify(logger.debug.mock.calls);
    expect(serialized).not.toContain('sk_secret');
    expect(serialized).toContain('***');
  });
});
