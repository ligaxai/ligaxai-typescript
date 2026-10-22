import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LigaX,
  connectAccount,
  type ConnectPopup,
  type ConnectSession,
  type Fetch,
} from '../src/index.js';
import {
  ConflictError,
  ConnectAccountError,
  PermissionDeniedError,
  TimeoutError,
} from '../src/errors.js';
import { json, scriptedFetch } from './helpers.js';

const silent = { error() {}, warn() {}, info() {}, debug() {} };
const BASE = 'https://api.example';
const CONNECT_URL = 'https://accounts.example/consent?flow=1';

function session(over: Partial<ConnectSession> = {}): ConnectSession {
  return {
    object: 'connect_session',
    id: 'flow_ABCDEFGH',
    status: 'pending',
    connect_url: CONNECT_URL,
    expires_at: '2026-10-22T12:10:00.000Z',
    connector_key: 'gmail',
    end_user_id: 'user-42',
    connection_id: null,
    failure_code: null,
    ...over,
  };
}

/** What `GET /connect_sessions/{id}` answers: no connector key, no URL. */
function polled(over: Partial<ConnectSession> = {}): ConnectSession {
  return session({ connector_key: '', connect_url: null, expires_at: null, ...over });
}

function apiError(status: number, type: string, code: string) {
  return json(
    { error: { type, code, message: code, request_id: 'req_x' } },
    { status, headers: { 'x-should-retry': 'false' } },
  );
}

class FakePopup implements ConnectPopup {
  closed = false;
  location = { href: '' };
  closeCalls = 0;
  close(): void {
    this.closeCalls++;
    this.closed = true;
  }
}

function client(fetch: Fetch, apiKey = 'lgx_sk_test'): LigaX {
  return new LigaX({ apiKey, baseURL: BASE, fetch, maxRetries: 0, logger: silent });
}

afterEach(() => vi.unstubAllGlobals());

describe('connectSessions', () => {
  it('create posts the body with an idempotency key', async () => {
    const fetch = scriptedFetch([json(session(), { status: 201 })]);
    const body = { connector_key: 'gmail', profile_id: 'prf_1', end_user: { id: 'user-42' } };
    const result = await client(fetch).connectSessions.create(body);
    expect(result.connect_url).toBe(CONNECT_URL);
    const call = fetch.calls[0]!;
    expect(call.url).toBe(`${BASE}/connect_sessions`);
    expect(call.init.method).toBe('POST');
    expect(call.body).toEqual(body);
    expect(call.headers.get('idempotency-key')).toBeTruthy();
  });

  it('get names the end user only when asked', async () => {
    const fetch = scriptedFetch([json(polled()), json(polled())]);
    const c = client(fetch);
    await c.connectSessions.get('flow_ABCDEFGH', { endUserId: 'user 42' });
    await c.connectSessions.get('flow_ABCDEFGH');
    expect(fetch.calls[0]?.url).toBe(`${BASE}/connect_sessions/flow_ABCDEFGH?end_user_id=user+42`);
    expect(fetch.calls[1]?.url).toBe(`${BASE}/connect_sessions/flow_ABCDEFGH`);
  });

  it('maps 409 end_user_connections_off to ConflictError with its code', async () => {
    const fetch = scriptedFetch([apiError(409, 'conflict_error', 'end_user_connections_off')]);
    const err = await client(fetch)
      .connectSessions.create({ connector_key: 'gmail' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConflictError);
    expect((err as ConflictError).code).toBe('end_user_connections_off');
  });

  it('maps 403 token_scope to PermissionDeniedError and does not retry it', async () => {
    const fetch = scriptedFetch([
      json(
        {
          error: {
            type: 'permission_error',
            code: 'token_scope',
            message: "This client token can only manage its own user's connections.",
            param: 'end_user',
            request_id: 'req_x',
          },
        },
        { status: 403 },
      ),
    ]);
    const c = new LigaX({ apiKey: 'lgx_ct_tok', baseURL: BASE, fetch, logger: silent });
    const err = await c.endUsers.connections.list('someone-else').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermissionDeniedError);
    expect((err as PermissionDeniedError).code).toBe('token_scope');
    expect((err as PermissionDeniedError).param).toBe('end_user');
    expect(fetch.calls).toHaveLength(1);
  });
});

describe('endUsers.connections', () => {
  it('lists an end user’s own connections', async () => {
    const list = {
      object: 'list',
      has_more: false,
      data: [
        {
          object: 'connection',
          id: 'conn_1',
          connector_key: 'gmail',
          display_name: 'me@example.com',
          status: 'active',
          status_code: null,
        },
      ],
    };
    const fetch = scriptedFetch([json(list)]);
    const result = await client(fetch).endUsers.connections.list('user/42');
    expect(result.data[0]?.connector_key).toBe('gmail');
    expect(fetch.calls[0]?.url).toBe(`${BASE}/end_users/user%2F42/connections`);
    expect(fetch.calls[0]?.init.method).toBe('GET');
  });

  it('deletes one connection', async () => {
    const fetch = scriptedFetch([json({ object: 'connection', id: 'conn_1', deleted: true })]);
    const result = await client(fetch).endUsers.connections.delete('user-42', 'conn_1');
    expect(result.deleted).toBe(true);
    expect(fetch.calls[0]?.url).toBe(`${BASE}/end_users/user-42/connections/conn_1`);
    expect(fetch.calls[0]?.init.method).toBe('DELETE');
  });
});

describe('connectSessions.wait', () => {
  it('polls at a fixed interval and resolves with a denied session', async () => {
    const fetch = scriptedFetch([
      json(polled()),
      json(polled()),
      json(polled({ status: 'denied', failure_code: 'access_denied' })),
    ]);
    const result = await client(fetch).connectSessions.wait('flow_ABCDEFGH', {
      endUserId: 'user-42',
      pollIntervalMs: 1,
    });
    expect(result.status).toBe('denied');
    expect(fetch.calls).toHaveLength(3);
    expect(fetch.calls[0]?.url).toBe(`${BASE}/connect_sessions/flow_ABCDEFGH?end_user_id=user-42`);
  });

  it('throws TimeoutError when still pending after timeoutMs', async () => {
    const pending: Fetch = async () => json(polled());
    const err = await client(pending)
      .connectSessions.wait('flow_ABCDEFGH', { pollIntervalMs: 2, timeoutMs: 10 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).session.status).toBe('pending');
  });

  it('timeoutMs: null waits until the server expires the session', async () => {
    let n = 0;
    const later: Fetch = async () => json(polled(++n < 4 ? {} : { status: 'expired' }));
    const result = await client(later).connectSessions.wait('flow_ABCDEFGH', {
      pollIntervalMs: 1,
      timeoutMs: null,
    });
    expect(result.status).toBe('expired');
    expect(n).toBe(4);
  });
});

describe('connectAccount', () => {
  it('sends the popup to the consent page, polls to succeeded and closes it', async () => {
    const fetch = scriptedFetch([
      json(session(), { status: 201 }),
      json(polled()),
      json(polled({ status: 'succeeded', connection_id: 'conn_1' })),
    ]);
    const popup = new FakePopup();
    const result = await connectAccount(client(fetch, 'lgx_ct_tok'), {
      connectorKey: 'gmail',
      popup,
      pollIntervalMs: 1,
    });
    expect(result.status).toBe('succeeded');
    expect(result.connection_id).toBe('conn_1');
    // The poll answers an empty connector key; the helper keeps the one creation reported.
    expect(result.connector_key).toBe('gmail');
    expect(popup.location.href).toBe(CONNECT_URL);
    expect(popup.closeCalls).toBe(1);
    // A client token is its own end user and profile: only the connector key goes up.
    expect(fetch.calls[0]?.body).toEqual({ connector_key: 'gmail' });
    expect(fetch.calls[1]?.url).toBe(`${BASE}/connect_sessions/flow_ABCDEFGH`);
  });

  it('resolves with a denied session rather than throwing', async () => {
    const fetch = scriptedFetch([
      json(session(), { status: 201 }),
      json(polled({ status: 'denied', failure_code: 'access_denied' })),
    ]);
    const popup = new FakePopup();
    const result = await connectAccount(client(fetch), {
      connectorKey: 'gmail',
      profileId: 'prf_1',
      popup,
      pollIntervalMs: 1,
    });
    expect(result.status).toBe('denied');
    expect(result.failure_code).toBe('access_denied');
    expect(fetch.calls[0]?.body).toEqual({ connector_key: 'gmail', profile_id: 'prf_1' });
    expect(popup.closed).toBe(true);
  });

  it('returns at once when the session is already succeeded', async () => {
    const done = session({
      id: '',
      status: 'succeeded',
      connect_url: null,
      connection_id: 'conn_9',
    });
    const fetch = scriptedFetch([json(done, { status: 201 })]);
    const popup = new FakePopup();
    const result = await connectAccount(client(fetch), { connectorKey: 'gmail', popup });
    expect(result).toEqual(done);
    expect(popup.location.href).toBe('');
    expect(popup.closed).toBe(true);
    expect(fetch.calls).toHaveLength(1);
  });

  it('times out with the last session and closes the popup', async () => {
    const pending: Fetch = async (input, init) =>
      String(input).endsWith('/connect_sessions') && init?.method === 'POST'
        ? json(session(), { status: 201 })
        : json(polled());
    const popup = new FakePopup();
    const err = await connectAccount(client(pending), {
      connectorKey: 'gmail',
      popup,
      pollIntervalMs: 2,
      timeoutMs: 20,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).session.status).toBe('pending');
    expect(popup.closed).toBe(true);
  });

  it('gives up once the user closed the popup and the session stays pending', async () => {
    const popup = new FakePopup();
    const pending: Fetch = async (_input, init) => {
      if (init?.method === 'POST') return json(session(), { status: 201 });
      popup.closed = true; // the user closed it themselves
      return json(polled());
    };
    const err = await connectAccount(client(pending), {
      connectorKey: 'gmail',
      popup,
      pollIntervalMs: 1,
    }).catch((e: unknown) => e);
    expect((err as ConnectAccountError).reason).toBe('popup_closed');
    expect(popup.closeCalls).toBe(0);
  });

  it('a popup closed by the provider callback still resolves with the outcome', async () => {
    const popup = new FakePopup();
    const fetch = scriptedFetch([
      json(session(), { status: 201 }),
      () => {
        popup.closed = true;
        return json(polled());
      },
      json(polled({ status: 'succeeded', connection_id: 'conn_1' })),
    ]);
    const result = await connectAccount(client(fetch), {
      connectorKey: 'gmail',
      popup,
      pollIntervalMs: 1,
    });
    expect(result.status).toBe('succeeded');
  });

  it('rejects popup_blocked for a null popup without calling the API', async () => {
    const fetch = scriptedFetch([]);
    const err = await connectAccount(client(fetch), { connectorKey: 'gmail', popup: null }).catch(
      (e: unknown) => e,
    );
    expect((err as ConnectAccountError).reason).toBe('popup_blocked');
    expect(fetch.calls).toHaveLength(0);
  });

  it('opens the popup itself, synchronously, when none is given', async () => {
    const popup = new FakePopup();
    const open = vi.fn(() => popup);
    vi.stubGlobal('window', { open });
    const fetch = scriptedFetch([
      json(session(), { status: 201 }),
      json(polled({ status: 'succeeded', connection_id: 'conn_1' })),
    ]);
    const pending = connectAccount(client(fetch), { connectorKey: 'gmail', pollIntervalMs: 1 });
    // Before any await resolved: still inside the caller's click handler.
    expect(open).toHaveBeenCalledWith('', 'ligax-connect', 'width=520,height=720');
    await expect(pending).resolves.toMatchObject({ status: 'succeeded' });
    expect(popup.location.href).toBe(CONNECT_URL);
  });

  it('closes the popup and rethrows when creating the session fails', async () => {
    const fetch = scriptedFetch([
      apiError(422, 'invalid_request_error', 'connector_not_connectable'),
    ]);
    const popup = new FakePopup();
    const err = await connectAccount(client(fetch), { connectorKey: 'dynamics', popup }).catch(
      (e: unknown) => e,
    );
    expect((err as { code?: string }).code).toBe('connector_not_connectable');
    expect(popup.closed).toBe(true);
  });

  it('closes the popup when aborted', async () => {
    const controller = new AbortController();
    const fetch = scriptedFetch([json(session(), { status: 201 })]);
    const popup = new FakePopup();
    const pending = connectAccount(client(fetch), {
      connectorKey: 'gmail',
      popup,
      pollIntervalMs: 1_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(popup.location.href).toBe(CONNECT_URL));
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);
    expect(popup.closed).toBe(true);
  });
});
