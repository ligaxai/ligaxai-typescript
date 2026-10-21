import type { Fetch } from '../src/core/base-client.js';

export interface Captured {
  url: string;
  init: RequestInit;
  headers: Headers;
  body: unknown;
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function sse(text: string, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'text/event-stream');
  return new Response(text, { ...init, headers });
}

/**
 * A scripted fetch: each call pops the next responder. A responder may be a Response, an Error
 * to throw (simulated network failure) or a function of the captured request.
 */
export function scriptedFetch(
  script: Array<Response | Error | ((req: Captured) => Response | Promise<Response>)>,
): Fetch & { calls: Captured[] } {
  const calls: Captured[] = [];
  const fn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    const raw = typeof init.body === 'string' ? init.body : undefined;
    let body: unknown = raw;
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        /* keep text */
      }
    }
    const captured: Captured = { url: String(input), init, headers, body };
    calls.push(captured);
    const next = script.shift();
    if (!next)
      throw new Error(`scriptedFetch: unexpected call #${calls.length} to ${captured.url}`);
    if (next instanceof Error) throw next;
    if (typeof next === 'function') return next(captured);
    return next;
  }) as Fetch & { calls: Captured[] };
  fn.calls = calls;
  return fn;
}

/** Split a string into a byte stream delivered in the given pieces (to simulate TCP chunking). */
export function chunkedBody(pieces: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      for (const piece of pieces) {
        controller.enqueue(enc.encode(piece));
        await new Promise((r) => setTimeout(r, 0));
      }
      controller.close();
    },
  });
}
