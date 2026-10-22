import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ConnectSession, LigaX } from '@ligaxai/sdk';

import { LigaXProvider, useConnectAccount } from '../src/index.js';

const URL_ = 'https://accounts.example/consent';

function session(over: Partial<ConnectSession> = {}): ConnectSession {
  return {
    object: 'connect_session',
    id: 'flow_ABCDEFGH',
    status: 'pending',
    connect_url: URL_,
    expires_at: null,
    connector_key: 'gmail',
    end_user_id: 'visitor:v1',
    connection_id: null,
    failure_code: null,
    ...over,
  };
}

function popup() {
  return {
    closed: false,
    location: { href: '' },
    close: vi.fn(function (this: { closed: boolean }) {
      this.closed = true;
    }),
  };
}

function fakeClient(polls: ConnectSession[]): Pick<LigaX, 'connectSessions'> {
  const connectSessions = {
    create: vi.fn(async () => session()),
    get: vi.fn(async () => polls.shift() ?? session({ connect_url: null })),
  };
  return { connectSessions } as unknown as Pick<LigaX, 'connectSessions'>;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useConnectAccount', () => {
  it('goes idle → connecting → succeeded', async () => {
    const client = fakeClient([session({ status: 'succeeded', connection_id: 'conn_1' })]);
    const win = popup();
    const { result } = renderHook(() => useConnectAccount({ client }));
    expect(result.current.state).toBe('idle');
    let pending!: Promise<ConnectSession | undefined>;
    act(() => {
      pending = result.current.connect({ connectorKey: 'gmail', popup: win, pollIntervalMs: 1 });
    });
    expect(result.current.state).toBe('connecting');
    await act(async () => {
      await pending;
    });
    expect(result.current.state).toBe('succeeded');
    expect(result.current.session?.connection_id).toBe('conn_1');
    expect(win.location.href).toBe(URL_);
    expect(win.closed).toBe(true);
  });

  it('reports a denied session as failed with the session, no error', async () => {
    const client = fakeClient([session({ status: 'denied', failure_code: 'access_denied' })]);
    const { result } = renderHook(() => useConnectAccount({ client }));
    await act(async () => {
      await result.current.connect({ connectorKey: 'gmail', popup: popup(), pollIntervalMs: 1 });
    });
    expect(result.current.state).toBe('failed');
    expect(result.current.session?.failure_code).toBe('access_denied');
    expect(result.current.error).toBeUndefined();
  });

  it('reports a blocked popup as failed with the error', async () => {
    const client = fakeClient([]);
    const { result } = renderHook(() => useConnectAccount({ client }));
    await act(async () => {
      await result.current.connect({ connectorKey: 'gmail', popup: null });
    });
    expect(result.current.state).toBe('failed');
    expect(result.current.error?.name).toBe('ConnectAccountError');
    expect(client.connectSessions.create).not.toHaveBeenCalled();
  });

  it('builds a client-token client from the provider', async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string, init: RequestInit) => {
        calls.push({ url: String(input), auth: new Headers(init.headers).get('authorization') });
        const body =
          init.method === 'POST'
            ? session()
            : session({ status: 'succeeded', connect_url: null, connection_id: 'conn_2' });
        return new Response(JSON.stringify(body), {
          status: init.method === 'POST' ? 201 : 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LigaXProvider baseURL="https://api.example" getClientToken={async () => 'lgx_ct_abc'}>
        {children}
      </LigaXProvider>
    );
    const { result } = renderHook(() => useConnectAccount(), { wrapper });
    await act(async () => {
      await result.current.connect({ connectorKey: 'gmail', popup: popup(), pollIntervalMs: 1 });
    });
    await waitFor(() => expect(result.current.state).toBe('succeeded'));
    expect(calls[0]?.url).toBe('https://api.example/connect_sessions');
    expect(calls[0]?.auth).toBe('Bearer lgx_ct_abc');
  });

  it('fails clearly without a client or a direct-mode provider', async () => {
    const { result } = renderHook(() => useConnectAccount());
    await act(async () => {
      await result.current.connect({ connectorKey: 'gmail', popup: popup() });
    });
    expect(result.current.state).toBe('failed');
    expect(result.current.error?.message).toMatch(/needs a client/);
  });
});
