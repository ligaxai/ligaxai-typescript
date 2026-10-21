import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * Context for the browser side of the SDK. The browser never holds a secret API key: it either
 * calls your own backend route (built with `@ligaxai/sdk/next`) or presents a
 * short-lived client token that `getClientToken` fetches from that backend on demand.
 */
export interface LigaXContextValue {
  /** Your backend route the transport posts to. Default `/api/chat`. */
  api: string;
  /** Direct API base URL, used only when calling the API with a client token. */
  baseURL?: string | undefined;
  /** Resolve a client token; called per request so it can refresh. */
  getClientToken?: (() => Promise<string> | string) | undefined;
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
