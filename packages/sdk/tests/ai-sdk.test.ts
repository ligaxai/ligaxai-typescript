import { describe, expect, it } from 'vitest';
import type { UIMessage, UIMessageChunk } from 'ai';

import { createChatTransport, createLigaXTransport } from '../src/ai-sdk.js';
import { PaymentRequiredError, RateLimitError } from '../src/errors.js';
import { chunkedBody, json, scriptedFetch } from './helpers.js';
import { frame, laeResponse, simpleRun } from './lae.js';

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

describe('createLigaXTransport (LAE → UIMessageChunk)', () => {
  const send = (transport: ReturnType<typeof createLigaXTransport>, chatId = 'chat_1') =>
    transport.sendMessages({
      trigger: 'submit-message',
      chatId,
      messageId: undefined,
      messages,
      abortSignal: undefined,
    });

  it('translates a run into start, tool, text and finish chunks', async () => {
    const fetch = scriptedFetch([
      laeResponse(chunkedBody(simpleRun('Hi there').match(/[\s\S]{1,9}/g)!)),
    ]);
    const runs: unknown[] = [];
    const transport = createLigaXTransport({ api: '/api/chat', fetch, onRun: (r) => runs.push(r) });
    const chunks = await collect(await send(transport));

    expect(chunks).toEqual([
      { type: 'start' },
      {
        type: 'tool-input-start',
        toolCallId: 'call_1',
        toolName: 'search',
        dynamic: true,
        providerExecuted: true,
      },
      {
        type: 'tool-input-available',
        toolCallId: 'call_1',
        toolName: 'search',
        input: {},
        dynamic: true,
        providerExecuted: true,
      },
      {
        type: 'tool-output-available',
        toolCallId: 'call_1',
        output: { status: 'ok', preview: '3 hits', duration_ms: 12 },
        dynamic: true,
        providerExecuted: true,
      },
      { type: 'text-start', id: 'p0' },
      { type: 'text-delta', id: 'p0', delta: 'Hi t' },
      { type: 'text-delta', id: 'p0', delta: 'here' },
      { type: 'text-end', id: 'p0' },
      { type: 'finish', finishReason: 'stop' },
    ]);
    expect(runs).toEqual([
      { chatId: 'chat_1', runId: 'run_test_1', conversationId: 'conv_CCCCCCCCCCCCCCCCCCCCCCCC' },
    ]);
    const call = fetch.calls[0]!;
    expect(call.init.method).toBe('POST');
    expect(call.headers.get('accept')).toBe('text/event-stream');
    expect(call.body).toMatchObject({ id: 'chat_1', trigger: 'submit-message' });
    expect((call.body as Record<string, unknown>)['conversation_id']).toBeUndefined();
  });

  it('sends the echoed conversation id back on the next turn of the same chat only', async () => {
    const fetch = scriptedFetch([
      laeResponse(simpleRun()),
      laeResponse(simpleRun()),
      laeResponse(simpleRun()),
    ]);
    const transport = createLigaXTransport({ fetch, body: { locale: 'en' } });
    await collect(await send(transport, 'a'));
    await collect(await send(transport, 'a'));
    await collect(await send(transport, 'b'));
    expect(fetch.calls[1]!.body).toMatchObject({
      conversation_id: 'conv_CCCCCCCCCCCCCCCCCCCCCCCC',
      locale: 'en',
    });
    expect((fetch.calls[2]!.body as Record<string, unknown>)['conversation_id']).toBeUndefined();
  });

  it('drops replayed deltas, reasoning and unknown events; reports a failed run as an error', async () => {
    const body =
      frame({ type: 'stream.ready' }) +
      frame({ type: 'part.start', seq: 1, payload: { part_id: 'r', kind: 'reasoning' } }) +
      frame({
        type: 'reasoning.delta',
        seq: 2,
        payload: { part_id: 'r', offset: 0, text: 'hmm' },
      }) +
      frame({ type: 'text.delta', seq: 3, payload: { part_id: 't', offset: 0, text: 'Par' } }) +
      frame({ type: 'text.delta', seq: 3, payload: { part_id: 't', offset: 0, text: 'Par' } }) +
      frame({ type: 'mystery.event', seq: 4, payload: {} }) +
      frame({ type: 'tool.start', seq: 5, payload: { tool_call_id: 'c', name: 'crm_write' } }) +
      frame({
        type: 'tool.end',
        seq: 6,
        payload: { tool_call_id: 'c', status: 'blocked', error: { message: 'Blocked by policy' } },
      }) +
      frame({
        type: 'run.end',
        seq: 7,
        payload: {
          status: 'failed',
          finish_reason: 'error',
          error: { code: 'X', message: 'Model unavailable' },
        },
      });
    const fetch = scriptedFetch([laeResponse(body)]);
    const chunks = await collect(await send(createLigaXTransport({ fetch })));
    expect(chunks.map((c) => c.type)).toEqual([
      'start',
      'text-start',
      'text-delta',
      'tool-input-start',
      'tool-input-available',
      'tool-output-error',
      'text-end',
      'error',
      'finish',
    ]);
    expect(chunks.find((c) => c.type === 'tool-output-error')).toMatchObject({
      errorText: 'Blocked by policy',
    });
    expect(chunks.find((c) => c.type === 'error')).toEqual({
      type: 'error',
      errorText: 'Model unavailable',
    });
    expect(chunks.at(-1)).toEqual({ type: 'finish', finishReason: 'error' });
  });

  it('surfaces an interrupt as a data part and still finishes when run.end never comes', async () => {
    const body =
      frame({ type: 'tool.start', seq: 1, payload: { tool_call_id: 'c', name: 'send_email' } }) +
      frame({
        type: 'tool.args.end',
        seq: 2,
        payload: { tool_call_id: 'c', args: { to: 'a@b.c' } },
      }) +
      frame({
        type: 'interrupt.raised',
        seq: 3,
        payload: { interrupt_id: 'int_1', kind: 'approval' },
      });
    const fetch = scriptedFetch([laeResponse(body)]);
    const chunks = await collect(await send(createLigaXTransport({ fetch })));
    expect(chunks.find((c) => c.type === 'tool-input-available')).toMatchObject({
      input: { to: 'a@b.c' },
    });
    expect(chunks.find((c) => c.type === 'data-ligax-interrupt')).toEqual({
      type: 'data-ligax-interrupt',
      id: 'int_1',
      data: { interrupt_id: 'int_1', kind: 'approval' },
    });
    expect(chunks.at(-1)).toEqual({ type: 'finish', finishReason: 'other' });
  });

  it('maps a non-2xx answer from the route to the SDK error classes', async () => {
    const fetch = scriptedFetch([
      json(
        { error: { type: 'billing_error', code: 'key_limit_reached', message: 'limit' } },
        { status: 402 },
      ),
    ]);
    await expect(send(createLigaXTransport({ fetch }))).rejects.toBeInstanceOf(
      PaymentRequiredError,
    );
  });

  it('reconnectToStream resolves null', async () => {
    const transport = createLigaXTransport({ fetch: scriptedFetch([]) });
    expect(await transport.reconnectToStream({ chatId: 'c' })).toBeNull();
  });
});
