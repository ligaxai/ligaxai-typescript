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
    const frame = (type: string, seq: number, payload: Record<string, unknown>) =>
      `event: ${type}\ndata: ${JSON.stringify({ v: 1, type, seq, payload })}\n\n`;
    const fetch = vi.fn(
      async () =>
        new Response(
          frame('part.start', 1, { part_id: 'p', kind: 'text' }) +
            frame('text.delta', 2, { part_id: 'p', offset: 0, text: 'Hi' }) +
            frame('part.end', 3, { part_id: 'p' }) +
            frame('run.end', 4, { status: 'completed', finish_reason: 'stop' }),
          {
            headers: {
              'content-type': 'text/event-stream',
              'x-conversation-id': 'conv_CCCCCCCCCCCCCCCCCCCCCCCC',
            },
          },
        ),
    );
    const getClientToken = async () => 'ct_123';
    const wrapper = ({ children }: { children: ReactNode }) => (
      <LigaXProvider api="/api/chat" profile="support" getClientToken={getClientToken}>
        {children}
      </LigaXProvider>
    );
    const { result } = renderHook(() => useLigaXTransport({ fetch }), { wrapper });
    const send = () =>
      result.current.sendMessages({
        trigger: 'submit-message',
        chatId: 'c1',
        messageId: undefined,
        messages: [],
        abortSignal: undefined,
      });
    const chunks: Array<{ type: string }> = [];
    const reader = (await send()).getReader();
    for (let next = await reader.read(); !next.done; next = await reader.read()) {
      chunks.push(next.value);
    }
    expect(chunks.map((c) => c.type)).toEqual([
      'start',
      'text-start',
      'text-delta',
      'text-end',
      'finish',
    ]);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/chat');
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer ct_123');
    expect(JSON.parse(init.body as string)).toMatchObject({ id: 'c1', profile: 'support' });

    // The next turn of the same chat carries the conversation the route echoed.
    await send();
    const [, second] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(second.body as string)).toMatchObject({
      conversation_id: 'conv_CCCCCCCCCCCCCCCCCCCCCCCC',
    });
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
