import { LigaX, type ClientOptions } from './client.js';
import { APIError } from './core/errors.js';
import type { HTTPMethod } from './core/base-client.js';
import type { EndUser, RunCreateParams, RunInput } from './types.js';

/**
 * `@ligaxai/sdk/next` — Next.js App Router route handlers that keep the **secret key on the server**
 * and talk to the API for the browser. They only use the Web `Request` and `Response` types, so they
 * also work in any framework that speaks those (Remix, SvelteKit, Hono, Bun.serve); `next` is a
 * type-only, optional peer.
 *
 * `LIGAX_API_KEY` (an `lgx_sk_…` secret) must only ever be read by server code: never prefix it
 * `NEXT_PUBLIC_`, never import a module that reads it from a client component.
 *
 * - `createRunRoute` — `useChat`'s `{ messages }` (or `{ input }`) in, the run's LAE event stream
 *   out. Pair it with `createLigaXTransport` / `useLigaXChat` in the browser.
 * - `createRunProxy` — a thin `POST /runs` passthrough with the profile and end user pinned
 *   server-side.
 * - `createRouteHandler` — the generic building block: map any request to any upstream call.
 */

export interface UpstreamCall {
  path: string;
  method?: HTTPMethod | undefined;
  body?: unknown;
  headers?: Record<string, string> | undefined;
  /** Ask for `text/event-stream`; the handler then pipes the upstream body straight through. */
  stream?: boolean | undefined;
}

export interface RouteHandlerOptions extends Omit<ClientOptions, 'dangerouslyAllowBrowser'> {
  /** Reuse an existing client instead of constructing one from the options. */
  client?: LigaX | undefined;
  /** Map an incoming JSON POST to the upstream call. Return `null` to answer 400. */
  resolve: (ctx: {
    request: Request;
    body: unknown;
  }) => UpstreamCall | null | Promise<UpstreamCall | null>;
  /**
   * Map an incoming GET (an AI SDK `reconnectToStream`) to the upstream call that replays the
   * stream. Return `null` for "nothing to resume" and the handler answers 204.
   */
  resolveReconnect?:
    ((ctx: { request: Request }) => UpstreamCall | null | Promise<UpstreamCall | null>) | undefined;
}

export interface RouteHandlers {
  GET: (request: Request) => Promise<Response>;
  POST: (request: Request) => Promise<Response>;
}

export function createRouteHandler(options: RouteHandlerOptions): RouteHandlers {
  const { client: given, resolve, resolveReconnect, ...clientOptions } = options;
  const client = given ?? new LigaX(clientOptions);

  async function proxy(call: UpstreamCall, request: Request): Promise<Response> {
    try {
      const upstream = await client
        .request<unknown>({
          method: call.method ?? (call.body === undefined ? 'GET' : 'POST'),
          path: call.path,
          body: call.body,
          headers: call.headers,
          stream: call.stream,
          signal: request.signal,
        })
        .asResponse();
      return passthrough(upstream);
    } catch (error) {
      return errorResponse(error);
    }
  }

  return {
    async POST(request) {
      let body: unknown = null;
      const text = await request.text();
      if (text.length > 0) {
        try {
          body = JSON.parse(text);
        } catch {
          return Response.json({ error: { message: 'Body must be JSON' } }, { status: 400 });
        }
      }
      const call = await resolve({ request, body });
      if (!call) return Response.json({ error: { message: 'Bad request' } }, { status: 400 });
      return proxy(call, request);
    },
    async GET(request) {
      if (!resolveReconnect) return new Response(null, { status: 204 });
      const call = await resolveReconnect({ request });
      if (!call) return new Response(null, { status: 204 });
      return proxy(call, request);
    },
  };
}

/** Copy status and the headers a client cares about; stream the body without buffering. */
function passthrough(upstream: Response): Response {
  const headers = new Headers();
  for (const name of [
    'content-type',
    'cache-control',
    'x-request-id',
    'x-run-id',
    'x-conversation-id',
    'x-vercel-ai-ui-message-stream',
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (upstream.headers.get('content-type')?.includes('text/event-stream')) {
    headers.set('cache-control', 'no-cache, no-transform');
    headers.set('connection', 'keep-alive');
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

// ── run routes ──────────────────────────────────────────────────────────────────────────────────

type MaybePromise<T> = T | Promise<T>;

export interface RunRouteOptions extends Omit<ClientOptions, 'dangerouslyAllowBrowser'> {
  /** Reuse an existing client instead of constructing one from the options. */
  client?: LigaX | undefined;
  /** The `prf_…` profile every run from this route uses. Pinned here, never taken from the browser. */
  profileId: string;
  /**
   * Who the browser's user is, from your own session — never from the request body. Return a
   * string id, `{ id, name? }`, or nothing for an anonymous run. Required when the profile's
   * end-user identity is `required`.
   */
  resolveEndUser?:
    ((request: Request) => MaybePromise<EndUser | string | null | undefined>) | undefined;
  /**
   * Turn the request body into the run's `input`. Default: `body.input` when present, else the
   * text of the last user message in `body.messages` (the `useChat` shape). Return `null` to answer
   * 400.
   */
  mapInput?: ((body: unknown) => MaybePromise<RunInput | null | undefined>) | undefined;
}

export interface RunRouteHandlers {
  POST: (request: Request) => Promise<Response>;
}

const CONVERSATION_ID = /^conv_[0-9A-Za-z]{24}$/;

/**
 * `POST` handler that runs the profile on the user's message and streams the LAE events back.
 * Continues a conversation when the body carries the `conversation_id` an earlier turn echoed in
 * `X-Conversation-Id` (`createLigaXTransport` does this per chat). A conversation is bound to its
 * profile and end user by the API, so a browser cannot continue someone else's.
 *
 * ```ts
 * // app/api/chat/route.ts — server only
 * export const { POST } = createRunRoute({
 *   profileId: process.env.LIGAX_PROFILE_ID!,
 *   resolveEndUser: async () => (await auth())?.user?.id,
 * });
 * ```
 */
export function createRunRoute(options: RunRouteOptions): RunRouteHandlers {
  const { client: given, profileId, resolveEndUser, mapInput, ...clientOptions } = options;
  const client = given ?? new LigaX(clientOptions);

  return {
    async POST(request) {
      const parsed = await readJson(request);
      if (!parsed.ok) return badRequest('The request body must be JSON.');
      const body = parsed.value;

      const input = mapInput ? await mapInput(body) : defaultInput(body);
      if (!input || (typeof input === 'string' && input.length === 0)) {
        return badRequest('No input: send `input`, or `messages` ending with a user message.');
      }
      const endUser = await endUserFrom(resolveEndUser, request);
      const conversationId = (body as { conversation_id?: unknown } | null)?.conversation_id;

      const params: Omit<RunCreateParams, 'mode'> = {
        profile_id: profileId,
        input,
        ...(typeof conversationId === 'string' && CONVERSATION_ID.test(conversationId)
          ? { conversation_id: conversationId }
          : {}),
        ...(endUser ? { end_user: endUser } : {}),
      };

      try {
        const stream = await client.runs.stream(params, { signal: request.signal });
        const headers = new Headers({
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        if (stream.runId) headers.set('x-run-id', stream.runId);
        if (stream.conversationId) headers.set('x-conversation-id', stream.conversationId);
        if (stream.requestId) headers.set('x-request-id', stream.requestId);
        return new Response(stream.toReadableStream(), { status: 200, headers });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

export interface RunProxyOptions extends Omit<ClientOptions, 'dangerouslyAllowBrowser'> {
  client?: LigaX | undefined;
  /** Pin the profile. Without it the browser chooses any profile the key may run. */
  profileId?: string | undefined;
  /** Pin the end user from your session; overrides any `end_user` the browser sent. */
  resolveEndUser?:
    ((request: Request) => MaybePromise<EndUser | string | null | undefined>) | undefined;
}

/**
 * Raw `POST /runs` passthrough: the browser sends a run body (`input`, `conversation_id`,
 * `metadata`, `model`, `mode` — default `stream`), the route adds the key and pins `profile_id` /
 * `end_user` when configured, and the API's answer (JSON or the LAE stream) is returned as is, with
 * `X-Run-Id` / `X-Conversation-Id`. An incoming `Idempotency-Key` is forwarded.
 */
export function createRunProxy(options: RunProxyOptions = {}): RunRouteHandlers {
  const { client: given, profileId, resolveEndUser, ...clientOptions } = options;
  const client = given ?? new LigaX(clientOptions);

  return {
    async POST(request) {
      const parsed = await readJson(request);
      if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') {
        return badRequest('The request body must be a JSON object.');
      }
      const incoming = parsed.value as Record<string, unknown>;
      const endUser = resolveEndUser ? await endUserFrom(resolveEndUser, request) : undefined;
      const body: Record<string, unknown> = {
        ...incoming,
        mode: incoming['mode'] ?? 'stream',
        ...(profileId ? { profile_id: profileId } : {}),
      };
      if (resolveEndUser) {
        if (endUser) body['end_user'] = endUser;
        else delete body['end_user'];
      }
      const idempotencyKey = request.headers.get('idempotency-key') ?? undefined;
      try {
        const upstream = await client
          .request<unknown>({
            method: 'POST',
            path: '/runs',
            body,
            stream: body['mode'] === 'stream',
            signal: request.signal,
            ...(idempotencyKey ? { idempotencyKey } : {}),
          })
          .asResponse();
        return passthrough(upstream);
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

/** `body.input`, else the last user message's text parts (UIMessage) or string `content`. */
export function defaultInput(body: unknown): RunInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { input?: unknown; messages?: unknown };
  if (typeof b.input === 'string' && b.input.length > 0) return b.input;
  if (
    b.input &&
    typeof b.input === 'object' &&
    typeof (b.input as { text?: unknown }).text === 'string'
  ) {
    return { text: (b.input as { text: string }).text };
  }
  if (!Array.isArray(b.messages)) return null;
  for (let i = b.messages.length - 1; i >= 0; i--) {
    const message = b.messages[i] as { role?: unknown; parts?: unknown; content?: unknown };
    if (message?.role !== 'user') continue;
    if (Array.isArray(message.parts)) {
      const text = message.parts
        .filter((part: { type?: unknown }) => part?.type === 'text')
        .map((part: { text?: unknown }) => (typeof part.text === 'string' ? part.text : ''))
        .join('');
      return text || null;
    }
    return typeof message.content === 'string' && message.content ? message.content : null;
  }
  return null;
}

async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await request.text();
  if (text.length === 0) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

async function endUserFrom(
  resolve: RunRouteOptions['resolveEndUser'],
  request: Request,
): Promise<EndUser | undefined> {
  if (!resolve) return undefined;
  const value = await resolve(request);
  if (!value) return undefined;
  return typeof value === 'string' ? { id: value } : value;
}

function badRequest(message: string): Response {
  return Response.json(
    { error: { type: 'invalid_request_error', code: 'invalid_request', message } },
    { status: 400 },
  );
}

function errorResponse(error: unknown): Response {
  if (error instanceof APIError) {
    return Response.json(error.body ?? { error: { message: error.message } }, {
      status: error.status,
      headers: error.request_id ? { 'x-request-id': error.request_id } : {},
    });
  }
  const message = error instanceof Error ? error.message : 'Upstream request failed';
  return Response.json({ error: { type: 'proxy_error', message } }, { status: 502 });
}
