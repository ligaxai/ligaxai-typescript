import { describe, expect, it } from 'vitest';
import type { UIMessage, UIMessageChunk } from 'ai';

import { createChatTransport } from '../src/ai-sdk.js';
import { RateLimitError } from '../src/errors.js';
import { chunkedBody, json, scriptedFetch } from './helpers.js';

async function collect(stream: ReadableStream<UIMessageChunk>): Promise<UIMessageChunk[]> {
  const out: UIMessageChunk[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(value);
  }
}

const messages: UIMessage[] = [
  { id: 'u1', role: 'user', parts: [{ type: 'text', text: 'hello' }] },
];

describe('createChatTransport', () => {
  it('sendMessages POSTs the chat and yields parsed UI message chunks, dropping [DONE]', async () => {
    const fetch = scriptedFetch([
      new Response(
        chunkedBody([
          'data: {"type":"start"}\n\ndata: {"type":"text-start","id":"t1"}\n\n',
          'data: {"type":"text-delta","id":"t1","delta":"Hi"}\n\n',
          'data: {"type":"text-end","id":"t1"}\n\ndata: {"type":"finish"}\n\ndata: [DONE]\n\n',
        ]),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
    ]);
    const transport = createChatTransport({
      api: '/api/chat',
      fetch,
      headers: async () => ({ 'x-client-token': 'ct_1' }),
      body: { profile: 'support' },
    });
    const stream = await transport.sendMessages({
      trigger: 'submit-message',
      chatId: 'chat_1',
      messageId: undefined,
      messages,
      abortSignal: undefined,
    });
    const chunks = await collect(stream);
    expect(chunks.map((c) => c.type)).toEqual([
      'start',
      'text-start',
      'text-delta',
      'text-end',
      'finish',
    ]);

    const call = fetch.calls[0];
    expect(call?.url).toBe('/api/chat');
    expect(call?.init.method).toBe('POST');
    expect(call?.headers.get('x-client-token')).toBe('ct_1');
    expect(call?.body).toMatchObject({
      id: 'chat_1',
      profile: 'support',
      trigger: 'submit-message',
    });
    expect((call?.body as { messages: unknown[] }).messages).toHaveLength(1);
  });

  it('reconnectToStream returns null on 204 and a stream otherwise', async () => {
    const fetch = scriptedFetch([
      new Response(null, { status: 204 }),
      new Response('data: {"type":"finish"}\n\ndata: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      }),
    ]);
    const transport = createChatTransport({ api: '/api/chat', fetch });

    expect(await transport.reconnectToStream({ chatId: 'chat_1' })).toBeNull();
    expect(fetch.calls[0]?.url).toBe('/api/chat/chat_1/stream');
    expect(fetch.calls[0]?.init.method).toBe('GET');

    const stream = await transport.reconnectToStream({ chatId: 'chat_1' });
    expect(stream).not.toBeNull();
    expect((await collect(stream!)).map((c) => c.type)).toEqual(['finish']);
  });

  it('uses a custom reconnect URL builder', async () => {
    const fetch = scriptedFetch([new Response(null, { status: 204 })]);
    const transport = createChatTransport({
      fetch,
      reconnectApi: (id) => `/resume?chat=${id}`,
    });
    await transport.reconnectToStream({ chatId: 'c9' });
    expect(fetch.calls[0]?.url).toBe('/resume?chat=c9');
  });

  it('maps a non-2xx answer to the SDK error classes', async () => {
    const fetch = scriptedFetch([json({ error: { message: 'slow down' } }, { status: 429 })]);
    const transport = createChatTransport({ fetch });
    await expect(
      transport.sendMessages({
        trigger: 'submit-message',
        chatId: 'c',
        messageId: undefined,
        messages,
        abortSignal: undefined,
      }),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});
