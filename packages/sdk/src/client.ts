import { BaseClient, type Fetch } from './core/base-client.js';
import { BrowserEnvironmentError } from './core/errors.js';
import { createLogger, type Logger, type LogLevel, parseLogLevel } from './core/logging.js';
import { Health } from './resources/health.js';

export const DEFAULT_BASE_URL = '__DEFAULT_BASE_URL__';
export const DEFAULT_TIMEOUT_MS = 600_000;
export const DEFAULT_MAX_RETRIES = 2;

export interface ClientOptions {
  /** Defaults to `process.env.BASE_PROJECT_API_KEY`. */
  apiKey?: string | undefined;
  /** Defaults to `process.env.BASE_PROJECT_BASE_URL`, then the production API. */
  baseURL?: string | undefined;
  /** Per-request timeout in ms. Default 10 minutes, matching long-running streamed calls. */
  timeout?: number | undefined;
  /** Retries for connection errors, 408/409/429 and 5xx. Default 2. */
  maxRetries?: number | undefined;
  /** Sent with every request; a per-call `headers` option wins on conflict. */
  defaultHeaders?: Record<string, string> | undefined;
  /** Inject a `fetch` (tests, proxies, custom agents). Defaults to the global. */
  fetch?: Fetch | undefined;
  /** `off | error | warn | info | debug`. Defaults to `BASE_PROJECT_LOG`, then `warn`. */
  logLevel?: LogLevel | undefined;
  /** Route SDK logs into your own logger; the default is `console`. */
  logger?: Logger | undefined;
  /**
   * The SDK refuses to run where `window` and `document` exist, because a secret API key in a
   * browser bundle is a leaked key. Set this only when you are deliberately using a short-lived,
   * publishable client token instead of a secret key.
   */
  dangerouslyAllowBrowser?: boolean | undefined;
}

function readEnv(name: string): string | undefined {
  // Guarded for runtimes without `process` (browsers, some edge runtimes).
  if (typeof process === 'undefined' || typeof process.env !== 'object') return undefined;
  return process.env[name]?.trim() || undefined;
}

export function isBrowserLike(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof navigator !== 'undefined'
  );
}

/**
 * The __PROJECT_TITLE__ API client. One instance per API key; it is safe to share across
 * requests. Resources hang off it as properties (`client.health.get()`).
 */
export class BaseProject extends BaseClient {
  readonly apiKey: string | undefined;
  readonly baseURL: string;

  readonly health: Health;

  constructor(options: ClientOptions = {}) {
    const apiKey = options.apiKey ?? readEnv('BASE_PROJECT_API_KEY');
    const baseURL = options.baseURL ?? readEnv('BASE_PROJECT_BASE_URL') ?? DEFAULT_BASE_URL;

    if (isBrowserLike() && options.dangerouslyAllowBrowser !== true) {
      throw new BrowserEnvironmentError(
        "It looks like you're running in a browser-like environment. This is disabled by default " +
          'because it risks exposing your secret API key. Use a client token from your own ' +
          "backend and pass `dangerouslyAllowBrowser: true` to the client if that's what you want.",
      );
    }

    const level =
      options.logLevel ?? parseLogLevel(readEnv('BASE_PROJECT_LOG'), 'BASE_PROJECT_LOG') ?? 'warn';

    super({
      baseURL,
      apiKey,
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      defaultHeaders: options.defaultHeaders ?? {},
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
      logger: createLogger(level, options.logger),
    });

    this.apiKey = apiKey;
    this.baseURL = baseURL;

    this.health = new Health(this);
  }
}
