import { describe, expect, it } from 'vitest';

import { BaseProject } from '../src/index.js';
import { Stream } from '../src/core/streaming.js';
import { chunkedBody, scriptedFetch } from './helpers.js';

function sseResponse(pieces: string[]): Response {
  return new Response(chunkedBody(pieces), { headers: { 'content-type': 'text/event-stream' } });
}

describe('Stream', () => {
  it('parses events split across arbitrary chunk boundaries', async () => {
    const stream = Stream.fromSSEResponse<{ n: number }>(
      sseResponse(['data: {"n"', ':1}\n\ndata: {"n":2}\n', '\ndata: [DONE]\n\n']),
      new AbortController(),
    );
    expect(await stream.toArray()).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('accepts CRLF line endings', async () => {
    const stream = Stream.fromSSEResponse<{ n: number }>(
      sseResponse(['data: {"n":1}\r\n\r\ndata: {"n":2}\r\n\r\ndata: [DONE]\r\n\r\n']),
      new AbortController(),
    );
    expect(await stream.toArray()).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('stops at [DONE] and ignores anything after it', async () => {
    const stream = Stream.fromSSEResponse<{ n: number }>(
      sseResponse(['data: {"n":1}\n\ndata: [DONE]\n\ndata: {"n":99}\n\n']),
      new AbortController(),
    );
    expect(await stream.toArray()).toEqual([{ n: 1 }]);
  });

  it('tracks lastEventId and event names, and skips comments', async () => {
    const stream = Stream.fromSSEResponse<{ n: number }>(
      sseResponse([
        ': keep-alive\n\nid: 7\nevent: delta\ndata: {"n":1}\n\nid: 8\ndata: {"n":2}\n\n',
      ]),
      new AbortController(),
    );
    const seen: number[] = [];
    for await (const item of stream) {
      seen.push(item.n);
      if (item.n === 1) {
        expect(stream.lastEventId).toBe('7');
        expect(stream.lastEventName).toBe('delta');
      }
    }
    expect(seen).toEqual([1, 2]);
    expect(stream.lastEventId).toBe('8');
  });

  it('aborts the controller when the consumer breaks early', async () => {
    const controller = new AbortController();
    const stream = Stream.fromSSEResponse<{ n: number }>(
      sseResponse(['data: {"n":1}\n\ndata: {"n":2}\n\ndata: {"n":3}\n\n']),
      controller,
    );
    for await (const item of stream) {
      if (item.n === 1) break;
    }
    expect(controller.signal.aborted).toBe(true);
  });

  it('tee() yields the same items on both sides', async () => {
    const stream = Stream.fromSSEResponse<{ n: number }>(
      sseResponse(['data: {"n":1}\n\ndata: {"n":2}\n\ndata: [DONE]\n\n']),
      new AbortController(),
    );
    const [a, b] = stream.tee();
    const [left, right] = await Promise.all([a.toArray(), b.toArray()]);
    expect(left).toEqual([{ n: 1 }, { n: 2 }]);
    expect(right).toEqual(left);
  });

  it('is returned by the client for stream: true requests', async () => {
    const fetch = scriptedFetch([sseResponse(['data: {"n":1}\n\ndata: [DONE]\n\n'])]);
    const client = new BaseProject({ apiKey: 'k', baseURL: 'https://api.example', fetch });
    const stream = await client.post<Stream<{ n: number }>>('/runs', { body: {}, stream: true });
    expect(stream).toBeInstanceOf(Stream);
    expect(fetch.calls[0]?.headers.get('accept')).toBe('text/event-stream');
    expect(await stream.toArray()).toEqual([{ n: 1 }]);
  });
});
