import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, renderHook, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import { LigaXProvider, useLigaX, useLigaXChat, useLigaXTransport } from '../src/index.js';

function Probe() {
  const ctx = useLigaX();
  return <div data-testid="probe">{`${ctx.api}|${ctx.profile ?? '-'}`}</div>;
}

describe('LigaXProvider', () => {
  afterEach(cleanup);

  it('exposes api and profile to descendants, with defaults when absent', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('/api/chat|-');
  });

  it('passes configured values through context', () => {
    render(
      <LigaXProvider api="/api/chat" profile="support">
        <Probe />
      </LigaXProvider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('/api/chat|support');
  });

  it('builds a transport that posts to the provider api with a client token and profile', async () => {
    const fetch = vi.fn(
      async () =>
        new Response('data: [DONE]\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        }),
    );
    const getClientToken = async () => 'ct_123';
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LigaXProvider api="/api/chat" profile="support" getClientToken={getClientToken}>
        {children}
      </LigaXProvider>
    );
    const { result } = renderHook(() => useLigaXTransport({ fetch }), { wrapper });
    await result.current.sendMessages({
      trigger: 'submit-message',
      chatId: 'c1',
      messageId: undefined,
      messages: [],
      abortSignal: undefined,
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/chat');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer ct_123');
    expect(JSON.parse(init.body as string)).toMatchObject({ id: 'c1', profile: 'support' });
  });

  it('useLigaXChat hands the transport and the remaining options to the injected useChat', () => {
    const useChat = vi.fn((opts: { transport?: unknown; id?: string }) => ({ opts }));
    const { result } = renderHook(() =>
      useLigaXChat({ useChat: useChat as never, id: 'chat_9', profile: 'sales' }),
    );
    const passed = (result.current as unknown as { opts: { transport?: unknown; id?: string } })
      .opts;
    expect(passed.id).toBe('chat_9');
    expect(passed.transport).toBeDefined();
    expect(typeof (passed.transport as { sendMessages: unknown }).sendMessages).toBe('function');
  });
});
