import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { TokenFetcher } from '@ligaxai/sdk';

/**
 * Context for the browser side of the SDK. The browser never holds a secret API key: it either
 * calls your own backend route (built with `@ligaxai/sdk/next`) or presents a short-lived client
 * token that `getClientToken` fetches from that backend (`createTokenRoute`) on demand. With
 * `baseURL` set too, the chat hooks call the API directly with that token.
 */
export interface LigaXContextValue {
  /** Your backend route the transport posts to. Default `/api/chat`. */
  api: string;
  /**
   * The API base URL. Set together with `getClientToken` to switch the chat hooks to direct mode
   * (e.g. `https://enterprise.ligax.ai/api/public/v1`).
   */
  baseURL?: string | undefined;
  /**
   * Resolve a client token: a string, or `{ token, expires_at }` as `createTokenRoute` answers. In
   * direct mode it is cached until shortly before `expires_at` and called with `{ refresh: true }`
   * after a `401 token_expired`; in route mode it is called per request and sent as
   * `Authorization`.
   */
  getClientToken?: TokenFetcher | undefined;
  /** Default profile (assistant configuration) for chats started under this provider. */
  profile?: string | undefined;
}

const LigaXContext = createContext<LigaXContextValue | null>(null);

export interface LigaXProviderProps extends Partial<LigaXContextValue> {
  children?: ReactNode;
}

export function LigaXProvider({
  children,
  api,
  baseURL,
  getClientToken,
  profile,
}: LigaXProviderProps) {
  // Memoised on the individual fields so consumers' effects do not re-run on every parent render.
  const value = useMemo<LigaXContextValue>(
    () => ({ api: api ?? '/api/chat', baseURL, getClientToken, profile }),
    [api, baseURL, getClientToken, profile],
  );
  return <LigaXContext.Provider value={value}>{children}</LigaXContext.Provider>;
}

/** The nearest provider's config, or sensible defaults when there is none. */
export function useLigaX(): LigaXContextValue {
  return useContext(LigaXContext) ?? { api: '/api/chat' };
}
