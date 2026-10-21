import { BaseProject, type ClientOptions } from './client.js';
import { APIError } from './core/errors.js';
import type { HTTPMethod } from './core/base-client.js';

/**
 * `@base-project-scope/sdk/next` — a Next.js App Router route handler that keeps the secret key
 * on the server and proxies the browser's request to the API. It only uses the Web `Request` and
 * `Response` types, so it also works in any framework that speaks those (Remix, SvelteKit, Hono,
 * Bun.serve); `next` is a type-only, optional peer.
 *
 * ```ts
 * // app/api/chat/route.ts
 * export const { GET, POST } = createRouteHandler({
 *   resolve: ({ body }) => ({ path: '/runs', body, stream: true }),
 * });
 * ```
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
  client?: BaseProject | undefined;
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
  const client = given ?? new BaseProject(clientOptions);

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
      if (error instanceof APIError) {
        return Response.json(error.body ?? { error: { message: error.message } }, {
          status: error.status,
          headers: error.request_id ? { 'x-request-id': error.request_id } : {},
        });
      }
      const message = error instanceof Error ? error.message : 'Upstream request failed';
      return Response.json({ error: { type: 'proxy_error', message } }, { status: 502 });
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
