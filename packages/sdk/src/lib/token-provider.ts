import type { ApiKeyProvider } from '../core/base-client.js';

/** What a token endpoint answers: `POST /client_tokens`, `createTokenRoute`, `/widget/sessions`. */
export interface ClientTokenLike {
  token: string;
  /** ISO 8601. Without it the token is kept until the API reports it expired. */
  expires_at?: string | null | undefined;
}

export type TokenFetcher = (context: {
  refresh: boolean;
}) => string | ClientTokenLike | Promise<string | ClientTokenLike>;

export interface CachedTokenProviderOptions {
  /** Fetch a new token this long before `expires_at`, so a request never leaves with a stale one. */
  refreshBeforeMs?: number | undefined;
}

export type CachedTokenProvider = ApiKeyProvider & {
  /** Forget the cached token; the next request fetches a new one. */
  clear(): void;
};

/**
 * Wrap "get me a client token" (usually a `fetch` to your own server) into an `ApiKeyProvider`
 * that asks once and reuses the answer until shortly before it expires. Concurrent requests share
 * one fetch; a `401 token_expired` from the API (`refresh: true`) always fetches anew.
 *
 * ```ts
 * const client = new LigaX({
 *   apiKey: cachedTokenProvider(() => fetch('/api/ligax-token', { method: 'POST' }).then((r) => r.json())),
 * });
 * ```
 */
export function cachedTokenProvider(
  fetchToken: TokenFetcher,
  options: CachedTokenProviderOptions = {},
): CachedTokenProvider {
  const skew = options.refreshBeforeMs ?? 30_000;
  let cached: { token: string; expiresAt: number } | undefined;
  let inflight: Promise<string> | undefined;

  const load = async (refresh: boolean): Promise<string> => {
    const value = await fetchToken({ refresh });
    const token = typeof value === 'string' ? value : value?.token;
    if (typeof token !== 'string' || token.length === 0) {
      throw new TypeError('The token provider returned no token.');
    }
    const at = typeof value === 'string' ? NaN : Date.parse(value.expires_at ?? '');
    cached = { token, expiresAt: Number.isFinite(at) ? at : Infinity };
    return token;
  };

  const provider = (async ({ refresh }: { refresh: boolean }) => {
    if (!refresh && cached && Date.now() < cached.expiresAt - skew) return cached.token;
    if (inflight && !refresh) return inflight;
    const pending = load(refresh).finally(() => {
      if (inflight === pending) inflight = undefined;
    });
    inflight = pending;
    return pending;
  }) as CachedTokenProvider;
  provider.clear = () => {
    cached = undefined;
  };
  return provider;
}

/** Credentials made to live in a browser: a client token, or a publishable key (widget sessions). */
export function isBrowserCredential(key: string): boolean {
  return key.startsWith('lgx_ct_') || key.startsWith('lgx_pk_');
}
