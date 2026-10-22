import { BaseClient, type ApiKeyProvider, type Fetch } from './core/base-client.js';
import { BrowserEnvironmentError } from './core/errors.js';
import { createLogger, type Logger, type LogLevel, parseLogLevel } from './core/logging.js';
import { isBrowserCredential } from './lib/token-provider.js';
import { ClientTokens } from './resources/client-tokens.js';
import { ConnectSessions } from './resources/connect-sessions.js';
import { Conversations } from './resources/conversations.js';
import { EndUsers } from './resources/end-users.js';
import { Keys } from './resources/keys.js';
import { Profiles } from './resources/profiles.js';
import { Runs } from './resources/runs.js';
import { Usage } from './resources/usage.js';
import { Webhooks } from './resources/webhooks.js';

export const DEFAULT_BASE_URL = 'https://enterprise.ligax.ai/api/public/v1';
export const DEFAULT_TIMEOUT_MS = 600_000;
export const DEFAULT_MAX_RETRIES = 2;

export interface ClientOptions {
  /**
   * Defaults to `process.env.LIGAX_API_KEY`. On a server, a secret key (`lgx_sk_…`). In a browser, a
   * client token (`lgx_ct_…`) — or a function that returns one, called before each request and
   * again once when the API answers `401 token_expired` (see `cachedTokenProvider`).
   */
  apiKey?: string | ApiKeyProvider | undefined;
  /** Defaults to `process.env.LIGAX_BASE_URL`, then the production API. */
  baseURL?: string | undefined;
  /** Per-request timeout in ms. Default 10 minutes, matching long-running streamed calls. */
  timeout?: number | undefined;
  /** Retries for connection errors, 408/409/429 and 5xx. Default 2. */
  maxRetries?: number | undefined;
  /** Sent with every request; a per-call `headers` option wins on conflict. */
  defaultHeaders?: Record<string, string> | undefined;
  /** Inject a `fetch` (tests, proxies, custom agents). Defaults to the global. */
  fetch?: Fetch | undefined;
  /** `off | error | warn | info | debug`. Defaults to `LIGAX_LOG`, then `warn`. */
  logLevel?: LogLevel | undefined;
  /** Route SDK logs into your own logger; the default is `console`. */
  logger?: Logger | undefined;
  /**
   * Where `window` and `document` exist the SDK only accepts a credential made for browsers — a
   * client token (`lgx_ct_…`), a token provider, or a publishable key (`lgx_pk_…`) — because a
   * secret key in a browser bundle is a leaked key. Setting this lifts that check; the API still
   * refuses a secret key sent with an `Origin` header.
   */
  dangerouslyAllowBrowser?: boolean | undefined;
}

const BROWSER_MESSAGE =
  "It looks like you're running in a browser-like environment with a key that is not a client " +
  'token. This is refused because it risks exposing your secret API key. Mint a client token ' +
  '(`lgx_ct_…`) on your server with `client.clientTokens.create()` and pass it — or a function ' +
  'that fetches it — as `apiKey`.';

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
 * The LigaX AI API client. One instance per API key; it is safe to share across
 * requests. Resources hang off it as properties (`client.runs.create()`).
 */
export class LigaX extends BaseClient {
  /** The fixed key, when one was given; `undefined` when a token provider supplies it per request. */
  readonly apiKey: string | undefined;
  readonly baseURL: string;

  readonly runs: Runs;
  readonly clientTokens: ClientTokens;
  readonly conversations: Conversations;
  readonly connectSessions: ConnectSessions;
  readonly endUsers: EndUsers;
  readonly profiles: Profiles;
  readonly keys: Keys;
  readonly usage: Usage;
  readonly webhooks: Webhooks;

  constructor(options: ClientOptions = {}) {
    const given = options.apiKey ?? readEnv('LIGAX_API_KEY');
    const baseURL = options.baseURL ?? readEnv('LIGAX_BASE_URL') ?? DEFAULT_BASE_URL;
    const guarded = isBrowserLike() && options.dangerouslyAllowBrowser !== true;

    if (guarded && typeof given !== 'function' && !(given && isBrowserCredential(given))) {
      throw new BrowserEnvironmentError(BROWSER_MESSAGE);
    }
    // A provider is only known by what it returns; hold each answer to the same rule.
    const apiKey: string | ApiKeyProvider | undefined =
      guarded && typeof given === 'function'
        ? async (context) => {
            const key = await given(context);
            if (!isBrowserCredential(key)) throw new BrowserEnvironmentError(BROWSER_MESSAGE);
            return key;
          }
        : given;

    const level = options.logLevel ?? parseLogLevel(readEnv('LIGAX_LOG'), 'LIGAX_LOG') ?? 'warn';

    super({
      baseURL,
      apiKey,
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      defaultHeaders: options.defaultHeaders ?? {},
      fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
      logger: createLogger(level, options.logger),
    });

    this.apiKey = typeof given === 'string' ? given : undefined;
    this.baseURL = baseURL;

    this.runs = new Runs(this);
    this.clientTokens = new ClientTokens(this);
    this.conversations = new Conversations(this);
    this.connectSessions = new ConnectSessions(this);
    this.endUsers = new EndUsers(this);
    this.profiles = new Profiles(this);
    this.keys = new Keys(this);
    this.usage = new Usage(this);
    this.webhooks = new Webhooks(this);
  }
}
