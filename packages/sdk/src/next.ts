import { LigaX, type ClientOptions } from './client.js';
import { APIError } from './core/errors.js';
import type { HTTPMethod } from './core/base-client.js';
import { defaultInput } from './lib/input.js';
import type { ClientTokenCreateParams, EndUser, RunCreateParams, RunInput } from './types.js';

export { defaultInput };

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
 * - `createTokenRoute` — mint a client token (`lgx_ct_…`) for the signed-in user, so the browser
 *   can call the API directly (`createLigaXTransport({ baseURL, getToken, profileId })`, the widget's
 *   `data-token-url`).
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

/**
 * Browser-facing options every route shares. These routes spend your secret key on a visitor's
 * behalf, so each refuses a cross-site request (a form or `fetch` from another website riding the
 * visitor's cookies — CSRF) unless you opt in, and reads a JSON body only when it is sent as
 * `application/json`, which a cross-site page cannot do without a CORS preflight.
 */
export interface BrowserRouteOptions {
  /**
   * Accept requests a browser marks `Sec-Fetch-Site: cross-site`. Leave off unless another site you
   * own calls this route, and then check its `Origin` yourself.
   */
  allowCrossSite?: boolean | undefined;
}

export interface RouteHandlerOptions
  extends Omit<ClientOptions, 'dangerouslyAllowBrowser'>, BrowserRouteOptions {
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
  const { client: given, resolve, resolveReconnect, allowCrossSite, ...clientOptions } = options;
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
      const refused = refuseCrossSite(request, allowCrossSite);
      if (refused) return refused;
      const parsed = await readJson(request);
      if (!parsed.ok) return parsed.response;
      const body = parsed.value;
      const call = await resolve({ request, body });
      if (!call) return Response.json({ error: { message: 'Bad request' } }, { status: 400 });
      return proxy(call, request);
    },
    async GET(request) {
      const refused = refuseCrossSite(request, allowCrossSite);
      if (refused) return refused;
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

/**
 * Who a run is for. A run acts as its end user — with **their** connected accounts — and is billed
 * to your key, so the routes refuse to run for nobody unless you say so.
 */
export interface EndUserPolicy {
  /**
   * Who the browser's user is, from your own session — never from the request body. Return a
   * string id or `{ id, name? }`; return nothing when no one is signed in, and the route answers
   * `401` without calling the API.
   */
  resolveEndUser?:
    ((request: Request) => MaybePromise<EndUser | string | null | undefined>) | undefined;
  /**
   * Run for visitors who are not signed in (a public assistant) instead of answering `401`. Their
   * runs carry no end user, so they cannot use anyone's own accounts — but they spend your key:
   * put a spend limit on it and rate-limit this route.
   */
  allowAnonymous?: boolean | undefined;
}

export interface RunRouteOptions
  extends Omit<ClientOptions, 'dangerouslyAllowBrowser'>, BrowserRouteOptions, EndUserPolicy {
  /** Reuse an existing client instead of constructing one from the options. */
  client?: LigaX | undefined;
  /** The `prf_…` profile every run from this route uses. Pinned here, never taken from the browser. */
  profileId: string;
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
  const {
    client: given,
    profileId,
    resolveEndUser,
    allowAnonymous,
    allowCrossSite,
    mapInput,
    ...clientOptions
  } = options;
  requireProfile('createRunRoute', profileId);
  requireEndUserPolicy('createRunRoute', resolveEndUser, allowAnonymous);
  const client = given ?? new LigaX(clientOptions);

  return {
    async POST(request) {
      const refused = refuseCrossSite(request, allowCrossSite);
      if (refused) return refused;
      const endUser = await endUserFrom(resolveEndUser, request);
      if (!endUser && !allowAnonymous) return notSignedIn();
      const parsed = await readJson(request);
      if (!parsed.ok) return parsed.response;
      const body = parsed.value;

      const input = mapInput ? await mapInput(body) : defaultInput(body);
      if (!input || (typeof input === 'string' && input.length === 0)) {
        return badRequest('No input: send `input`, or `messages` ending with a user message.');
      }
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

export interface RunProxyOptions
  extends Omit<ClientOptions, 'dangerouslyAllowBrowser'>, BrowserRouteOptions, EndUserPolicy {
  client?: LigaX | undefined;
  /** The `prf_…` profile every run uses. Pinned here, never taken from the browser. */
  profileId: string;
  /**
   * Let the browser pick `model` (still limited to the profile's allowed models). Off by default:
   * the profile's default model is used.
   */
  allowModel?: boolean | undefined;
}

/** What the browser may set on a proxied run. Everything else — `profile_id`, `end_user` — is the server's. */
const PROXY_FIELDS = ['input', 'conversation_id', 'attachments', 'metadata', 'mode'] as const;

/**
 * Raw `POST /runs` passthrough: the browser sends a run body (`input`, `conversation_id`,
 * `attachments`, `metadata`, `mode` — default `stream`; `model` only with `allowModel`), the route
 * adds the key, the pinned `profile_id` and the `end_user` from your session, and returns the API's
 * answer (JSON or the LAE stream) with `X-Run-Id` / `X-Conversation-Id`. Any other field the
 * browser sends is dropped. An incoming `Idempotency-Key` is forwarded.
 */
export function createRunProxy(options: RunProxyOptions): RunRouteHandlers {
  const {
    client: given,
    profileId,
    resolveEndUser,
    allowAnonymous,
    allowCrossSite,
    allowModel,
    ...clientOptions
  } = options ?? ({} as RunProxyOptions);
  requireProfile('createRunProxy', profileId);
  requireEndUserPolicy('createRunProxy', resolveEndUser, allowAnonymous);
  const client = given ?? new LigaX(clientOptions);

  return {
    async POST(request) {
      const refused = refuseCrossSite(request, allowCrossSite);
      if (refused) return refused;
      const endUser = await endUserFrom(resolveEndUser, request);
      if (!endUser && !allowAnonymous) return notSignedIn();
      const parsed = await readJson(request);
      if (!parsed.ok) return parsed.response;
      if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
        return badRequest('The request body must be a JSON object.');
      }
      const incoming = parsed.value as Record<string, unknown>;
      const body: Record<string, unknown> = {};
      for (const field of allowModel ? [...PROXY_FIELDS, 'model'] : PROXY_FIELDS) {
        if (incoming[field] !== undefined) body[field] = incoming[field];
      }
      body['mode'] ??= 'stream';
      body['profile_id'] = profileId;
      if (endUser) body['end_user'] = endUser;
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

// ── token route ─────────────────────────────────────────────────────────────────────────────────

export interface TokenRouteOptions
  extends Omit<ClientOptions, 'dangerouslyAllowBrowser'>, BrowserRouteOptions {
  /** Reuse an existing client instead of constructing one from the options. */
  client?: LigaX | undefined;
  /** The `prf_…` profile the token may run. Pinned here, never taken from the browser. */
  profileId: string;
  /**
   * Who is asking, from your own session — never from the request body. Return `null` (or nothing)
   * for "not signed in" and the route answers `401` without calling the API.
   */
  resolveEndUser: (request: Request) => MaybePromise<EndUser | string | null | undefined>;
  /** Token lifetime in seconds, 60–3600. Default: the API's (600). */
  expiresIn?: number | undefined;
  /**
   * Pin the token to one conversation the user already has (`conv_…`). Default: not pinned — the
   * browser starts conversations and continues them with the `conversation_id` each run echoes.
   */
  resolveConversationId?:
    ((request: Request) => MaybePromise<string | null | undefined>) | undefined;
}

/** What `createTokenRoute` answers: the token, when it stops working, and what it is bound to. */
export interface TokenRouteResponse {
  token: string;
  expires_at: string;
  profile_id: string;
  conversation_id?: string;
}

/**
 * `POST` handler that mints a client token for the signed-in user with your secret key, so the
 * browser can call the API itself — the run streams straight from LigaX instead of through your
 * server. The token runs only `profileId`, only as the user `resolveEndUser` named, and only from the
 * origins on the profile; it expires in minutes (the browser side asks again on `401
 * token_expired`). The key needs the `client_tokens:write` scope.
 *
 * ```ts
 * // app/api/ligax-token/route.ts — server only
 * export const { POST } = createTokenRoute({
 *   profileId: process.env.LIGAX_PROFILE_ID!,
 *   resolveEndUser: async () => {
 *     const user = (await auth())?.user;
 *     return user ? { id: user.id, name: user.name } : null;
 *   },
 * });
 * ```
 */
export function createTokenRoute(options: TokenRouteOptions): RunRouteHandlers {
  const {
    client: given,
    profileId,
    resolveEndUser,
    expiresIn,
    resolveConversationId,
    allowCrossSite,
    ...clientOptions
  } = options;
  requireProfile('createTokenRoute', profileId);
  requireEndUserPolicy('createTokenRoute', resolveEndUser, false);
  const client = given ?? new LigaX(clientOptions);

  return {
    async POST(request) {
      // Minting a token is a credential handed to whoever asks: never for another site's page.
      const refused = refuseCrossSite(request, allowCrossSite);
      if (refused) return refused;
      const endUser = await endUserFrom(resolveEndUser, request);
      if (!endUser) return notSignedIn();
      const conversationId = resolveConversationId
        ? await resolveConversationId(request)
        : undefined;
      const body: ClientTokenCreateParams = {
        profile_id: profileId,
        end_user: endUser,
        ...(expiresIn !== undefined ? { expires_in: expiresIn } : {}),
        ...(conversationId ? { conversation_id: conversationId } : {}),
      };
      try {
        const minted = await client.clientTokens.create(body, { signal: request.signal });
        const out: TokenRouteResponse = {
          token: minted.token,
          expires_at: minted.expires_at,
          profile_id: minted.profile_id,
          ...(minted.conversation_id ? { conversation_id: minted.conversation_id } : {}),
        };
        // A bearer credential for one user: no shared cache may keep it.
        return Response.json(out, { status: 200, headers: { 'cache-control': 'no-store' } });
      } catch (error) {
        return errorResponse(error);
      }
    },
  };
}

type JsonBody = { ok: true; value: unknown } | { ok: false; response: Response };

/** An empty body is `null`; a non-empty one must be sent as JSON and parse as JSON. */
async function readJson(request: Request): Promise<JsonBody> {
  const text = await request.text();
  if (text.length === 0) return { ok: true, value: null };
  const type = request.headers.get('content-type') ?? '';
  if (!/^application\/([a-z0-9.+-]+\+)?json\b/i.test(type.trim())) {
    return {
      ok: false,
      response: Response.json(
        {
          error: {
            type: 'invalid_request_error',
            code: 'unsupported_media_type',
            message: 'Send the body as application/json.',
          },
        },
        { status: 415 },
      ),
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: badRequest('The request body must be JSON.') };
  }
}

/** `403` for a request a browser says came from another site, unless the route opted in. */
function refuseCrossSite(request: Request, allow: boolean | undefined): Response | null {
  if (allow) return null;
  if (request.headers.get('sec-fetch-site')?.toLowerCase() !== 'cross-site') return null;
  return Response.json(
    {
      error: {
        type: 'permission_error',
        code: 'cross_site_request',
        message: 'This route only accepts requests from its own site.',
      },
    },
    { status: 403, headers: { 'cache-control': 'no-store' } },
  );
}

function requireProfile(route: string, profileId: string | undefined): void {
  if (typeof profileId !== 'string' || !/^prf_[0-9A-Za-z]+$/.test(profileId)) {
    throw new TypeError(`${route}: \`profileId\` must be a profile id (prf_…), set on the server.`);
  }
}

function requireEndUserPolicy(
  route: string,
  resolveEndUser: EndUserPolicy['resolveEndUser'],
  allowAnonymous: boolean | undefined,
): void {
  if (!resolveEndUser && !allowAnonymous) {
    throw new TypeError(
      `${route}: pass \`resolveEndUser\` (the signed-in user from your session), or ` +
        '`allowAnonymous: true` for a public assistant. Without either, any visitor would run ' +
        'agents on your key.',
    );
  }
}

async function endUserFrom(
  resolve: EndUserPolicy['resolveEndUser'],
  request: Request,
): Promise<EndUser | undefined> {
  if (!resolve) return undefined;
  const value = await resolve(request);
  if (!value) return undefined;
  return typeof value === 'string' ? { id: value } : value;
}

function notSignedIn(): Response {
  return Response.json(
    { error: { type: 'authentication_error', code: 'not_signed_in', message: 'Sign in to chat.' } },
    { status: 401, headers: { 'cache-control': 'no-store' } },
  );
}

function badRequest(message: string): Response {
  return Response.json(
    { error: { type: 'invalid_request_error', code: 'invalid_request', message } },
    { status: 400 },
  );
}

/** Statuses about the browser's own request, whose API message is safe and useful to show it. */
const CALLER_STATUSES = new Set([400, 404, 409, 413, 415, 422, 429]);

/**
 * What the browser learns when the API refuses. These routes call with **your** key, so a `401` or
 * `403` is about your server's configuration and a `5xx` about LigaX — neither is the visitor's to
 * read, and a front end would mistake a `401` for "you are signed out". They become a generic
 * `502`; the request id is kept so your logs can find the real cause. Spend refusals keep their
 * status and `code` with generic wording. Nothing from a non-API failure (whose message can carry
 * internals) is passed on.
 */
function errorResponse(error: unknown): Response {
  if (error instanceof APIError) {
    const headers = new Headers({ 'cache-control': 'no-store' });
    if (error.request_id) headers.set('x-request-id', error.request_id);
    const detail = (
      error.body as {
        error?: { type?: unknown; code?: unknown; message?: unknown; param?: unknown };
      } | null
    )?.error;
    const code = typeof detail?.code === 'string' ? detail.code : undefined;
    if (CALLER_STATUSES.has(error.status)) {
      const retryAfter = error.headers?.get('retry-after');
      if (retryAfter) headers.set('retry-after', retryAfter);
      return Response.json(
        {
          error: {
            type: typeof detail?.type === 'string' ? detail.type : 'invalid_request_error',
            ...(code ? { code } : {}),
            message:
              typeof detail?.message === 'string' ? detail.message : 'The request was refused.',
            ...(typeof detail?.param === 'string' ? { param: detail.param } : {}),
          },
        },
        { status: error.status, headers },
      );
    }
    if (error.status === 402) {
      return Response.json(
        {
          error: {
            type: 'payment_required',
            ...(code ? { code } : {}),
            message: 'The assistant is unavailable right now.',
          },
        },
        { status: 402, headers },
      );
    }
    return Response.json(
      {
        error: {
          type: 'upstream_error',
          code: 'upstream_error',
          message: 'The assistant is unavailable right now.',
        },
      },
      { status: 502, headers },
    );
  }
  return Response.json(
    {
      error: {
        type: 'upstream_error',
        code: 'upstream_unavailable',
        message: 'The assistant could not be reached.',
      },
    },
    { status: 502, headers: { 'cache-control': 'no-store' } },
  );
}
