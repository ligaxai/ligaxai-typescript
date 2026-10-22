import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai';
import { EventSourceParserStream } from 'eventsource-parser/stream';

import { LigaX } from './client.js';
import type { Fetch } from './core/base-client.js';
import { APIError } from './core/errors.js';
import { defaultInput } from './lib/input.js';
import { parseRunEvent, readSSE, type RunEvent } from './lib/lae.js';
import { TextAssembler } from './lib/text-assembler.js';
import { cachedTokenProvider, type TokenFetcher } from './lib/token-provider.js';
import type { RunBody } from './resources/runs.js';

/**
 * `@ligaxai/sdk/ai-sdk` — Vercel AI SDK `ChatTransport`s so `useChat` from `@ai-sdk/react` talks to
 * LigaX either through **your own server route** (built with `@ligaxai/sdk/next`) or **directly**
 * with a short-lived client token your server minted — the secret key never reaches the browser. `ai` is imported for types only: it stays an optional peer and this module
 * adds nothing to the bundle beyond the SSE parser.
 *
 * - `createLigaXTransport` — the route returns the **LAE event stream** (what `createRunRoute`
 *   returns), or, given `getToken`, the transport calls `POST /runs` itself; either way the LAE
 *   events are translated to `UIMessageChunk`s in the browser.
 * - `createChatTransport` — the route already returns the AI SDK's own UI message stream
 *   (`data: <UIMessageChunk>` lines and `data: [DONE]`); chunks are passed through.
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

// ── LAE → UIMessageChunk ─────────────────────────────────────────────────────────────────────────

export interface LigaXTransportOptions {
  /** Your server route (e.g. one built with `createRunRoute`). Default `/api/chat`. */
  api?: string | undefined;
  /**
   * **Direct mode.** Returns a client token (`lgx_ct_…`) — a string, or `{ token, expires_at }` as
   * `createTokenRoute` answers — and switches the transport from your route to the API itself. It
   * is called once and reused until shortly before `expires_at`, and again on `401 token_expired`.
   */
  getToken?: TokenFetcher | undefined;
  /** Direct mode: the API base URL. Default `https://enterprise.ligax.ai/api/public/v1`. */
  baseURL?: string | undefined;
  /** Direct mode: the `prf_…` profile the token was minted for (required with `getToken`). */
  profileId?: string | undefined;
  headers?:
    | Record<string, string>
    | (() => Record<string, string> | Promise<Record<string, string>>)
    | undefined;
  /**
   * Extra JSON merged into every request body. In direct mode it is merged into the `POST /runs`
   * body, so only run fields belong there (`metadata`, `model`).
   */
  body?: Record<string, unknown> | undefined;
  /** Route mode only: sent with the request to your route (e.g. `'include'` for cookies). */
  credentials?: RequestCredentials | undefined;
  fetch?: Fetch | undefined;
  /** Called once per turn with the ids your route echoed (`X-Run-Id`, `X-Conversation-Id`). */
  onRun?: ((run: { chatId: string; runId?: string; conversationId?: string }) => void) | undefined;
}

/**
 * A `ChatTransport` for a route that returns the LAE event stream. Per chat, it remembers the
 * `X-Conversation-Id` the route echoed and sends it back as `conversation_id` on the next turn, so
 * the agent keeps the conversation's context server-side without the browser re-sending history.
 * `reconnectToStream` resolves `null` (stream resume is not offered in v0.1).
 *
 * ```ts
 * // through your route
 * createLigaXTransport({ api: '/api/chat' });
 * // directly, with a token from `createTokenRoute`
 * createLigaXTransport({
 *   profileId: 'prf_…',
 *   getToken: () => fetch('/api/ligax-token', { method: 'POST' }).then((r) => r.json()),
 * });
 * ```
 */
export function createLigaXTransport<M extends UIMessage = UIMessage>(
  options: LigaXTransportOptions = {},
): ChatTransport<M> {
  if (options.getToken) return directTransport<M>(options, options.getToken);
  const api = options.api ?? '/api/chat';
  const fetchImpl: Fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const conversations = new Map<string, string>();

  return {
    async sendMessages(opts: SendMessagesOptions<M>): Promise<ReadableStream<UIMessageChunk>> {
      const base =
        typeof options.headers === 'function' ? await options.headers() : options.headers;
      const headers = new Headers(base);
      new Headers(opts.headers).forEach((value, key) => headers.set(key, value));
      headers.set('Content-Type', 'application/json');
      headers.set('Accept', 'text/event-stream');
      const conversationId = conversations.get(opts.chatId);
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
          ...(conversationId ? { conversation_id: conversationId } : {}),
        }),
        signal: opts.abortSignal ?? null,
      };
      if (options.credentials) init.credentials = options.credentials;
      const response = await fetchImpl(api, init);
      if (!response.ok) await throwFromResponse(response);
      if (!response.body) throw new Error('Chat endpoint returned no body');

      const runId = response.headers.get('x-run-id') ?? undefined;
      const echoed = response.headers.get('x-conversation-id') ?? undefined;
      if (echoed) conversations.set(opts.chatId, echoed);
      options.onRun?.({
        chatId: opts.chatId,
        ...(runId ? { runId } : {}),
        ...(echoed ? { conversationId: echoed } : {}),
      });
      return laeToUIMessageStream(response.body);
    },

    async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
      return null;
    },
  };
}

/**
 * Direct mode: the browser holds a client token and calls `POST /runs` through the SDK client, so
 * retries, the token refresh and error mapping are the client's — not a second copy here. The token
 * fills in the end user; `profile_id` is still sent because the API's schema requires it.
 */
function directTransport<M extends UIMessage>(
  options: LigaXTransportOptions,
  getToken: TokenFetcher,
): ChatTransport<M> {
  const profileId = options.profileId;
  if (!profileId) {
    throw new TypeError('createLigaXTransport: `profileId` is required with `getToken`.');
  }
  const client = new LigaX({
    apiKey: cachedTokenProvider(getToken),
    baseURL: options.baseURL,
    fetch: options.fetch,
  });
  const conversations = new Map<string, string>();

  return {
    async sendMessages(opts: SendMessagesOptions<M>): Promise<ReadableStream<UIMessageChunk>> {
      const input = defaultInput({ messages: opts.messages });
      if (!input) throw new TypeError('No user message to send.');
      const base =
        typeof options.headers === 'function' ? await options.headers() : options.headers;
      const headers: Record<string, string> = { ...base };
      new Headers(opts.headers).forEach((value, key) => (headers[key] = value));
      const conversationId = conversations.get(opts.chatId);
      const body: RunBody = {
        ...options.body,
        ...(opts.body as Record<string, unknown> | undefined),
        profile_id: profileId,
        input,
        ...(conversationId ? { conversation_id: conversationId } : {}),
      };
      const stream = await client.runs.stream(body, {
        headers,
        ...(opts.abortSignal ? { signal: opts.abortSignal } : {}),
      });
      if (stream.conversationId) conversations.set(opts.chatId, stream.conversationId);
      options.onRun?.({
        chatId: opts.chatId,
        ...(stream.runId ? { runId: stream.runId } : {}),
        ...(stream.conversationId ? { conversationId: stream.conversationId } : {}),
      });
      const chunks = toUIMessageChunks(stream);
      return new ReadableStream<UIMessageChunk>({
        async pull(controller) {
          const { done, value } = await chunks.next();
          if (done) controller.close();
          else controller.enqueue(value);
        },
        async cancel() {
          stream.abort();
          await chunks.return(undefined);
        },
      });
    },

    async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
      return null;
    },
  };
}

/** An LAE SSE body → a `ReadableStream` of `UIMessageChunk`s. */
export function laeToUIMessageStream(
  body: ReadableStream<Uint8Array>,
): ReadableStream<UIMessageChunk> {
  const controller = new AbortController();
  const events = (async function* () {
    for await (const message of readSSE(body, controller.signal)) {
      if (message.data === '[DONE]') return;
      const event = parseRunEvent(message);
      if (event) yield event;
    }
  })();
  const chunks = toUIMessageChunks(events);
  return new ReadableStream<UIMessageChunk>({
    async pull(stream) {
      const { done, value } = await chunks.next();
      if (done) stream.close();
      else stream.enqueue(value);
    },
    async cancel() {
      controller.abort();
      await chunks.return(undefined);
    },
  });
}

type FinishReason = NonNullable<Extract<UIMessageChunk, { type: 'finish' }>['finishReason']>;

function finishReasonOf(status: string, reason: string): FinishReason {
  if (status === 'failed') return 'error';
  switch (reason) {
    case 'stop':
    case 'end_turn':
    case 'completed':
      return 'stop';
    case 'length':
    case 'max_tokens':
      return 'length';
    case 'content_filter':
    case 'content-filter':
      return 'content-filter';
    case 'tool_calls':
    case 'tool-calls':
      return 'tool-calls';
    default:
      return status === 'completed' ? 'stop' : 'other';
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * Translate LAE events into the AI SDK's chunk vocabulary. Usable server-side too, e.g. to feed
 * `createUIMessageStreamResponse` from a `RunStream`.
 *
 * - `part.start` / `text.delta` / `part.end` of a **text** part → `text-start` / `text-delta` /
 *   `text-end`, with deltas assembled by offset (a replayed delta produces nothing). Reasoning
 *   parts are not forwarded.
 * - `tool.start` → `tool-input-start`; `tool.args.end` (or `tool.end`) → `tool-input-available`;
 *   `tool.end` → `tool-output-available`, or `tool-output-error` when it failed or was blocked. Tools
 *   run on the server, so every tool chunk is `dynamic` and `providerExecuted`.
 * - `interrupt.raised` → a `data-ligax-interrupt` part carrying the payload, so a UI can render an
 *   approval or question.
 * - `run.end` (failed) or `stream.error` → `error`; the stream always ends with one `finish`.
 * - Everything else (`stream.*`, `step.*`, `usage.*`, unknown types) is dropped.
 */
export async function* toUIMessageChunks(
  events: AsyncIterable<RunEvent>,
): AsyncGenerator<UIMessageChunk, void, undefined> {
  const assembler = new TextAssembler();
  const openText = new Set<string>();
  const tools = new Map<string, { name: string; inputSent: boolean; done: boolean }>();
  let finishReason: FinishReason = 'other';
  let finished = false;

  yield { type: 'start' };

  function* closeText(partId: string): Generator<UIMessageChunk> {
    if (!openText.has(partId)) return;
    openText.delete(partId);
    yield { type: 'text-end', id: partId };
  }

  for await (const event of events) {
    const p = event.payload;
    switch (event.type) {
      case 'part.start': {
        assembler.apply(event);
        const partId = str(p['part_id']);
        if (partId && assembler.isText(partId) && !openText.has(partId)) {
          openText.add(partId);
          yield { type: 'text-start', id: partId };
        }
        break;
      }
      case 'text.delta': {
        const partId = str(p['part_id']);
        const delta = assembler.apply(event);
        if (!partId) break;
        if (!openText.has(partId) && delta) {
          openText.add(partId);
          yield { type: 'text-start', id: partId };
        }
        if (delta) yield { type: 'text-delta', id: partId, delta };
        break;
      }
      case 'reasoning.delta':
        assembler.apply(event);
        break;
      case 'part.end': {
        const partId = str(p['part_id']);
        const rest = assembler.apply(event);
        if (rest && openText.has(partId)) yield { type: 'text-delta', id: partId, delta: rest };
        yield* closeText(partId);
        break;
      }
      case 'tool.start': {
        const id = str(p['tool_call_id']);
        if (!id || tools.has(id)) break;
        const name = str(p['name']) || 'tool';
        tools.set(id, { name, inputSent: false, done: false });
        yield {
          type: 'tool-input-start',
          toolCallId: id,
          toolName: name,
          dynamic: true,
          providerExecuted: true,
        };
        break;
      }
      case 'tool.args.end': {
        const id = str(p['tool_call_id']);
        const tool = tools.get(id);
        if (!tool || tool.inputSent) break;
        tool.inputSent = true;
        const args = p['args'];
        yield {
          type: 'tool-input-available',
          toolCallId: id,
          toolName: tool.name,
          input: args && typeof args === 'object' ? args : {},
          dynamic: true,
          providerExecuted: true,
        };
        break;
      }
      case 'tool.end': {
        const id = str(p['tool_call_id']);
        const tool = tools.get(id);
        if (!tool || tool.done) break;
        tool.done = true;
        if (!tool.inputSent) {
          tool.inputSent = true;
          yield {
            type: 'tool-input-available',
            toolCallId: id,
            toolName: tool.name,
            input: {},
            dynamic: true,
            providerExecuted: true,
          };
        }
        const status = str(p['status']) || 'ok';
        if (status === 'ok') {
          const output: Record<string, unknown> = { status };
          if (typeof p['result_preview'] === 'string') output['preview'] = p['result_preview'];
          if (typeof p['duration_ms'] === 'number') output['duration_ms'] = p['duration_ms'];
          yield {
            type: 'tool-output-available',
            toolCallId: id,
            output,
            dynamic: true,
            providerExecuted: true,
          };
        } else {
          const error = p['error'] as { message?: unknown } | undefined;
          yield {
            type: 'tool-output-error',
            toolCallId: id,
            errorText: str(error?.message) || `Tool call ${status}.`,
            dynamic: true,
            providerExecuted: true,
          };
        }
        break;
      }
      case 'interrupt.raised': {
        const id = str(p['interrupt_id']);
        yield { type: 'data-ligax-interrupt', ...(id ? { id } : {}), data: p };
        break;
      }
      case 'stream.error': {
        yield { type: 'error', errorText: str(p['message']) || 'The event stream failed.' };
        break;
      }
      case 'run.end': {
        for (const partId of [...openText]) yield* closeText(partId);
        const status = str(p['status']);
        if (status === 'failed') {
          const error = p['error'] as { message?: unknown } | undefined;
          yield { type: 'error', errorText: str(error?.message) || 'The run failed.' };
        }
        finishReason = finishReasonOf(status, str(p['finish_reason']));
        finished = true;
        break;
      }
      default:
        break;
    }
  }

  for (const partId of [...openText]) yield* closeText(partId);
  // A run that stopped to ask something ends its stream without `run.end`; still finish the message
  // so `useChat` goes back to ready.
  yield { type: 'finish', finishReason: finished ? finishReason : 'other' };
}
