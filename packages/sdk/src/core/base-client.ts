import { APIConnectionError, APIError, APITimeoutError } from './errors.js';
import { type Logger, redactHeaders } from './logging.js';
import { Page, type PageResponse } from './pagination.js';
import { Stream } from './streaming.js';
import { VERSION } from '../version.js';

export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

/**
 * A credential resolved per request instead of fixed at construction — how a browser holds a
 * short-lived client token (`lgx_ct_…`). Called before each request with `refresh: false`, and once
 * more with `refresh: true` when the API answers `401 token_expired`, so a provider that caches its
 * token knows to fetch a new one. A provider taking no arguments is fine.
 */
export type ApiKeyProvider = (context: { refresh: boolean }) => string | Promise<string>;

export interface RequestOptions {
  method: HTTPMethod;
  path: string;
  query?: Record<string, string | number | boolean | null | undefined> | undefined;
  /** JSON-encoded, except a `FormData`, which is sent as `multipart/form-data` as is. */
  body?: unknown;
  headers?: Record<string, string | null | undefined> | undefined;
  signal?: AbortSignal | null | undefined;
  /** Per-request override of the client timeout, in ms. */
  timeout?: number | undefined;
  /** Per-request override of the client retry budget. */
  maxRetries?: number | undefined;
  /** Supply your own key to make a POST safely re-sendable across process restarts. */
  idempotencyKey?: string | undefined;
  /** Parse the response as `text/event-stream` and return a `Stream`. */
  stream?: boolean | undefined;
}

export interface BaseClientConfig {
  baseURL: string;
  apiKey: string | ApiKeyProvider | undefined;
  timeout: number;
  maxRetries: number;
  defaultHeaders: Record<string, string>;
  fetch: Fetch;
  logger: Logger;
}

/** Max wait the SDK will honour from a `Retry-After`; anything larger falls back to backoff. */
const MAX_RETRY_AFTER_MS = 120_000;
const INITIAL_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;

interface Exchange {
  response: Response;
  controller: AbortController;
  options: RequestOptions;
}

/**
 * The promise every resource method returns. It resolves to the parsed body like any promise,
 * and additionally offers the raw `Response` for callers that need headers or want to pipe the
 * body somewhere themselves.
 */
export class APIPromise<T> extends Promise<T> {
  private readonly exchange: Promise<Exchange>;
  private readonly parse: (exchange: Exchange) => Promise<T>;
  private parsed: Promise<T> | undefined;

  constructor(exchange: Promise<Exchange>, parse: (exchange: Exchange) => Promise<T>) {
    // The executor never settles directly; `then` defers to the lazily parsed result so that
    // `.asResponse()` can hand the unread body to the caller instead.
    super((resolve) => resolve(undefined as unknown as T));
    this.exchange = exchange;
    this.parse = parse;
  }

  /** The parsed body plus the `Response` and the request id the API echoed. */
  async withResponse(): Promise<{ data: T; response: Response; request_id: string | undefined }> {
    const [data, { response }] = await Promise.all([this.parsedResult(), this.exchange]);
    return { data, response, request_id: response.headers.get('x-request-id') ?? undefined };
  }

  /** The raw `Response`, body unread. Use it to proxy a stream straight to your own client. */
  async asResponse(): Promise<Response> {
    return (await this.exchange).response;
  }

  private parsedResult(): Promise<T> {
    this.parsed ??= this.exchange.then(this.parse);
    return this.parsed;
  }

  override then<R1 = T, R2 = never>(
    onfulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.parsedResult().then(onfulfilled, onrejected);
  }

  override catch<R = never>(
    onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null,
  ): Promise<T | R> {
    return this.parsedResult().catch(onrejected);
  }

  override finally(onfinally?: (() => void) | null): Promise<T> {
    return this.parsedResult().finally(onfinally);
  }

  // Keep `Promise.all`/`.then` chains building plain promises rather than APIPromise instances.
  static override get [Symbol.species](): PromiseConstructor {
    return Promise;
  }
}

export class BaseClient {
  declare protected readonly config: BaseClientConfig;

  constructor(config: BaseClientConfig) {
    // Holds the key: not enumerable, so logging or serialising the client never prints it.
    Object.defineProperty(this, 'config', { value: config, enumerable: false, writable: false });
  }

  /** What `console.log(client)` / `util.inspect` show: where it points, never the credential. */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `${this.constructor.name} { baseURL: ${JSON.stringify(this.config.baseURL)} }`;
  }

  toJSON(): { baseURL: string } {
    return { baseURL: this.config.baseURL };
  }

  get<T>(path: string, opts: Omit<RequestOptions, 'method' | 'path'> = {}): APIPromise<T> {
    return this.request<T>({ ...opts, method: 'GET', path });
  }
  post<T>(path: string, opts: Omit<RequestOptions, 'method' | 'path'> = {}): APIPromise<T> {
    return this.request<T>({ ...opts, method: 'POST', path });
  }
  put<T>(path: string, opts: Omit<RequestOptions, 'method' | 'path'> = {}): APIPromise<T> {
    return this.request<T>({ ...opts, method: 'PUT', path });
  }
  patch<T>(path: string, opts: Omit<RequestOptions, 'method' | 'path'> = {}): APIPromise<T> {
    return this.request<T>({ ...opts, method: 'PATCH', path });
  }
  delete<T>(path: string, opts: Omit<RequestOptions, 'method' | 'path'> = {}): APIPromise<T> {
    return this.request<T>({ ...opts, method: 'DELETE', path });
  }

  /** A list call: the returned `Page` follows `next_page` cursors on `for await`. */
  getPage<T>(path: string, opts: Omit<RequestOptions, 'method' | 'path'> = {}): Promise<Page<T>> {
    const fetchPage = (cursor?: string): Promise<PageResponse<T>> =>
      this.request<PageResponse<T>>({
        ...opts,
        method: 'GET',
        path,
        query: cursor === undefined ? opts.query : { ...opts.query, page: cursor },
      });
    return fetchPage().then((body) => new Page(body, fetchPage));
  }

  request<T>(options: RequestOptions): APIPromise<T> {
    return new APIPromise(this.exchange(options), (ex) => this.parseResponse<T>(ex));
  }

  /**
   * Resolve `path` under `baseURL` — and only there. An absolute URL (`https://elsewhere/…`), a
   * scheme-relative one (`//elsewhere`) or a `.`/`..` segment (also percent-encoded, as an id
   * from user input could be) would otherwise send this client's key to another host or another
   * endpoint, so each is refused before anything is sent.
   */
  buildURL(path: string, query: RequestOptions['query']): string {
    const base = this.config.baseURL.endsWith('/')
      ? this.config.baseURL
      : `${this.config.baseURL}/`;
    const relative = path.replace(/^\//, '');
    const segments = relative.split(/[?#]/, 1)[0]!.split('/');
    if (
      /^[a-z][a-z0-9+.-]*:/i.test(relative) ||
      relative.startsWith('/') ||
      relative.includes('\\') ||
      segments.some((s) => {
        const decoded = safeDecode(s);
        // WHATWG URL parsing treats `%2e%2e` as `..`. An escaped `/` (`%2F`) inside an id stays
        // one segment and is fine.
        return decoded === '.' || decoded === '..';
      })
    ) {
      throw new TypeError(`Refusing request path outside the API: ${JSON.stringify(path)}`);
    }
    const url = new URL(relative, base);
    if (url.origin !== new URL(base).origin || !url.href.startsWith(base)) {
      throw new TypeError(`Refusing request path outside the API: ${JSON.stringify(path)}`);
    }
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  protected buildHeaders(
    options: RequestOptions,
    idempotencyKey: string | undefined,
    apiKey: string | undefined,
  ): Headers {
    const headers = new Headers({
      Accept: options.stream ? 'text/event-stream' : 'application/json',
      'User-Agent': `ligaxai-typescript-typescript/${VERSION}`,
      ...this.config.defaultHeaders,
    });
    if (apiKey) headers.set('Authorization', `Bearer ${apiKey}`);
    // A multipart body's Content-Type carries the boundary, which only `fetch` knows: leave it unset.
    if (options.body !== undefined && !isFormData(options.body)) {
      headers.set('Content-Type', 'application/json');
    }
    if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      if (value === null || value === undefined) headers.delete(key);
      else headers.set(key, value);
    }
    return headers;
  }

  private async exchange(options: RequestOptions): Promise<Exchange> {
    const maxRetries = options.maxRetries ?? this.config.maxRetries;
    const timeout = options.timeout ?? this.config.timeout;
    const url = this.buildURL(options.path, options.query);
    // Minted once so every retry of the same POST carries the same key: the server can then
    // de-duplicate a request whose first attempt it did process but whose response we lost.
    const idempotencyKey =
      options.idempotencyKey ?? (options.method === 'POST' ? crypto.randomUUID() : undefined);
    // A `FormData` is re-readable, so every retry re-sends the same parts (unlike a stream body).
    const body: BodyInit | null =
      options.body === undefined
        ? null
        : isFormData(options.body)
          ? options.body
          : JSON.stringify(options.body);
    const log = this.config.logger;
    const provider = typeof this.config.apiKey === 'function' ? this.config.apiKey : undefined;
    let apiKey: string | undefined = provider
      ? await provider({ refresh: false })
      : (this.config.apiKey as string | undefined);
    // One refresh per request: a provider that keeps answering with an expired token must surface
    // the 401, not loop on it.
    let refreshed = false;

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const signals: AbortSignal[] = [controller.signal, AbortSignal.timeout(timeout)];
      if (options.signal) signals.push(options.signal);
      const signal = AbortSignal.any(signals);
      const headers = this.buildHeaders(options, idempotencyKey, apiKey);

      log.debug(`${options.method} ${url}`, { attempt, headers: redactHeaders(headers) });

      let response: Response;
      try {
        // The API never redirects. Following one would replay this request — body included — to
        // wherever the redirect points.
        response = await this.config.fetch(url, {
          method: options.method,
          headers,
          body,
          signal,
          redirect: 'error',
        });
      } catch (cause) {
        if (options.signal?.aborted) {
          throw new APIConnectionError('Request was aborted.', { cause });
        }
        const timedOut = signal.aborted && !controller.signal.aborted;
        const error = timedOut
          ? new APITimeoutError(`Request timed out after ${timeout}ms.`, { cause })
          : new APIConnectionError(undefined, { cause });
        if (attempt < maxRetries) {
          const delay = backoffDelay(attempt);
          log.warn(`${error.name}; retrying in ${delay}ms (${attempt + 1}/${maxRetries})`);
          await sleep(delay, options.signal);
          continue;
        }
        throw error;
      }

      if (response.ok) return { response, controller, options };

      if (attempt < maxRetries && shouldRetry(response)) {
        const delay = retryDelay(response, attempt);
        log.warn(
          `${response.status} from ${options.method} ${url}; retrying in ${delay}ms (${attempt + 1}/${maxRetries})`,
        );
        // Drain so the connection goes back to the pool before we re-use it.
        await response.body?.cancel().catch(() => undefined);
        await sleep(delay, options.signal);
        continue;
      }

      const errBody = await readBody(response);
      if (provider && !refreshed && response.status === 401 && isTokenExpired(errBody)) {
        // A short-lived client token ran out between mint and use. Not a retry (the budget is
        // untouched): the request never ran, and the same idempotency key is resent.
        refreshed = true;
        log.info(`${options.method} ${url}: client token expired; refreshing once`);
        apiKey = await provider({ refresh: true });
        attempt -= 1;
        continue;
      }
      const error = APIError.generate(response.status, errBody, undefined, response.headers);
      log.error(`${options.method} ${url} failed`, {
        status: response.status,
        request_id: error.request_id,
      });
      throw error;
    }
  }

  private async parseResponse<T>({ response, controller, options }: Exchange): Promise<T> {
    if (options.stream) {
      return Stream.fromSSEResponse(response, controller) as unknown as T;
    }
    const parsed = await readBody(response);
    return attachRequestId(parsed, response) as T;
  }
}

/**
 * Server says explicitly, else: retry on timeout/throttle/5xx. A `409` is retried only when the
 * server marks it retryable (`x-should-retry: true`, e.g. `idempotency_in_progress`): other
 * conflicts will not resolve themselves. Never on 402 (a spend limit
 * or credits — retrying spends nothing and changes nothing), 403 (a scope the key lacks) or 422 (the
 * request itself is wrong, e.g. an `Idempotency-Key` reused with a different body).
 */
export function shouldRetry(response: Response): boolean {
  const override = response.headers.get('x-should-retry');
  if (override === 'true') return true;
  if (override === 'false') return false;
  const s = response.status;
  if (s === 402 || s === 403 || s === 422) return false;
  return s === 408 || s === 429 || s >= 500;
}

/** `retry-after-ms`, then `retry-after` (seconds or HTTP-date), both capped; else backoff. */
export function retryDelay(response: Response, attempt: number): number {
  const ms = Number(response.headers.get('retry-after-ms'));
  if (Number.isFinite(ms) && ms > 0 && ms <= MAX_RETRY_AFTER_MS) return ms;

  const header = response.headers.get('retry-after');
  if (header) {
    const seconds = Number(header);
    const fromHeader = Number.isFinite(seconds)
      ? seconds * 1000
      : new Date(header).getTime() - Date.now();
    if (fromHeader > 0 && fromHeader <= MAX_RETRY_AFTER_MS) return Math.ceil(fromHeader);
  }
  return backoffDelay(attempt);
}

/** 0.5s doubling to 8s, minus up to 25% jitter so a fleet of clients does not retry in lockstep. */
export function backoffDelay(attempt: number): number {
  const base = Math.min(INITIAL_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
  const jitter = 1 - Math.random() * 0.25;
  return Math.round(base * jitter);
}

/** Wait `ms`, rejecting with `APIConnectionError` if `signal` aborts first. */
export function sleep(ms: number, signal: AbortSignal | null | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new APIConnectionError('Request was aborted.'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new APIConnectionError('Request was aborted.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isFormData(value: unknown): value is FormData {
  return typeof FormData !== 'undefined' && value instanceof FormData;
}

function isTokenExpired(body: unknown): boolean {
  const error = (body as { error?: { code?: unknown } } | null)?.error;
  return !!error && typeof error === 'object' && error.code === 'token_expired';
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (text.length === 0) return null;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function attachRequestId(value: unknown, response: Response): unknown {
  const id = response.headers.get('x-request-id');
  if (id && value !== null && typeof value === 'object' && !Array.isArray(value)) {
    Object.defineProperty(value, '_request_id', { value: id, enumerable: false, writable: true });
  }
  return value;
}
