import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { EventSourceParserStream } from 'eventsource-parser/stream';

import type { Fetch } from './core/base-client.js';
import { APIError } from './core/errors.js';

/**
 * `@base-project-scope/sdk/ai-sdk` — a Vercel AI SDK `ChatTransport` so `useChat` from
 * `@ai-sdk/react` talks to a __PROJECT_TITLE__ endpoint (normally your own route built with
 * `createRouteHandler`, so the secret key never reaches the browser).
 *
 * The wire is the AI SDK's UI message stream: SSE with one JSON `UIMessageChunk` per `data:`
 * line and a trailing `data: [DONE]`. `ai` is imported for types only, so it stays an optional
 * peer and this module adds nothing to the bundle beyond the SSE parser.
 */

type SendMessagesOptions<M extends UIMessage> = Parameters<ChatTransport<M>['sendMessages']>[0];
type ReconnectOptions<M extends UIMessage> = Parameters<ChatTransport<M>['reconnectToStream']>[0];

export interface ChatTransportOptions {
  /** Where to POST. Default `/api/chat`. */
  api?: string | undefined;
  /**
   * Where to GET on reconnect. A function receives the chat id; a string gets `/{chatId}/stream`
   * appended. Default: `${api}/${chatId}/stream`.
   */
  reconnectApi?: string | ((chatId: string) => string) | undefined;
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>)
    | undefined;
  /** Extra JSON merged into every request body (e.g. a profile id). */
  body?: Record<string, unknown> | undefined;
  credentials?: RequestCredentials | undefined;
  fetch?: Fetch | undefined;
}

export function createChatTransport<M extends UIMessage = UIMessage>(
  options: ChatTransportOptions = {},
): ChatTransport<M> {
  const api = options.api ?? '/api/chat';
  const fetchImpl: Fetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  const resolveHeaders = async (extra?: HeadersInit): Promise<Headers> => {
    const base = typeof options.headers === 'function' ? await options.headers() : options.headers;
    const headers = new Headers(base);
    new Headers(extra).forEach((value, key) => headers.set(key, value));
    return headers;
  };

  return {
    async sendMessages(opts: SendMessagesOptions<M>): Promise<ReadableStream<UIMessageChunk>> {
      const headers = await resolveHeaders(opts.headers);
      headers.set('Content-Type', 'application/json');
      headers.set('Accept', 'text/event-stream');
      const init: RequestInit = {
        method: 'POST',
        headers,
        body: JSON.stringify({
          ...options.body,
          ...opts.body,
          id: opts.chatId,
          messages: opts.messages,
          trigger: opts.trigger,
          messageId: opts.messageId,
        }),
        signal: opts.abortSignal ?? null,
      };
      if (options.credentials) init.credentials = options.credentials;
      const response = await fetchImpl(api, init);
      if (!response.ok) await throwFromResponse(response);
      if (!response.body) throw new Error('Chat endpoint returned no body');
      return toChunkStream(response.body);
    },

    async reconnectToStream(
      opts: ReconnectOptions<M>,
    ): Promise<ReadableStream<UIMessageChunk> | null> {
      const url =
        typeof options.reconnectApi === 'function'
          ? options.reconnectApi(opts.chatId)
          : `${options.reconnectApi ?? api}/${encodeURIComponent(opts.chatId)}/stream`;
      const headers = await resolveHeaders(opts.headers);
      headers.set('Accept', 'text/event-stream');
      const init: RequestInit = { method: 'GET', headers, signal: opts.abortSignal ?? null };
      if (options.credentials) init.credentials = options.credentials;
      const response = await fetchImpl(url, init);
      if (response.status === 204) return null;
      if (!response.ok) await throwFromResponse(response);
      if (!response.body) return null;
      return toChunkStream(response.body);
    },
  };
}

/** Bytes → SSE events → parsed chunks, dropping the `[DONE]` sentinel. */
export function toChunkStream(
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
): ReadableStream<UIMessageChunk> {
  return body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream())
    .pipeThrough(
      new TransformStream<{ data: string }, UIMessageChunk>({
        transform(event, controller) {
          if (event.data === '[DONE]') return;
          controller.enqueue(JSON.parse(event.data) as UIMessageChunk);
        },
      }),
    );
}

async function throwFromResponse(response: Response): Promise<never> {
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* non-JSON error body; keep the text */
  }
  throw APIError.generate(response.status, body, undefined, response.headers);
}
