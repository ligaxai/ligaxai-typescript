import { useMemo } from 'react';
import type { ChatInit, ChatTransport, UIMessage } from 'ai';
import type { useChat as UseChat } from '@ai-sdk/react';
import { createLigaXTransport, type LigaXTransportOptions } from '@ligaxai/sdk/ai-sdk';

import { useLigaX } from './provider.js';

export type UseChatOptions<M extends UIMessage> = Parameters<typeof UseChat<M>>[0];
export type UseChatHelpers<M extends UIMessage> = ReturnType<typeof UseChat<M>>;

export interface UseLigaXTransportOptions extends Omit<LigaXTransportOptions, 'headers' | 'body'> {
  /**
   * Profile for this chat; falls back to the provider's. Sent as `profile` in the body for a route
   * that chooses among profiles itself — `createRunRoute` ignores it, because it pins the profile
   * on the server.
   */
  profile?: string | undefined;
  headers?: LigaXTransportOptions['headers'];
  body?: Record<string, unknown> | undefined;
}

/**
 * Which mode a transport runs in. Direct (browser → API with a client token) when `getToken` is
 * given, or when the provider has both `baseURL` and `getClientToken`; otherwise through your route,
 * with the provider's `getClientToken` (if any) sent as `Authorization` to that route.
 */
function directToken(
  options: UseLigaXTransportOptions,
  ctx: ReturnType<typeof useLigaX>,
): LigaXTransportOptions['getToken'] {
  if (options.getToken) return options.getToken;
  if (ctx.baseURL && ctx.getClientToken) return ctx.getClientToken;
  return undefined;
}

/**
 * A memoised `ChatTransport` wired to the nearest `LigaXProvider`: posts to its `api` (your
 * `createRunRoute` route), translates the LAE event stream into `useChat` chunks, carries the
 * conversation id between turns, and attaches a client token from `getClientToken` when one is
 * configured. Use it directly with `new Chat({ transport })` or hand it to `useLigaXChat`.
 *
 * **Direct mode:** pass `getToken` (e.g. a fetch to your `createTokenRoute`) and `profileId`, or put
 * `baseURL` + `getClientToken` + `profile` on the provider, and the browser calls the LigaX API
 * itself with the short-lived client token. Keep `getToken` a stable reference — a new transport
 * starts with no cached token and no conversation ids.
 */
export function useLigaXTransport<M extends UIMessage = UIMessage>(
  options: UseLigaXTransportOptions = {},
): ChatTransport<M> {
  const ctx = useLigaX();
  const { api, profile, headers, body, fetch, credentials, onRun, baseURL, profileId } = options;
  const getClientToken = ctx.getClientToken;
  const resolvedProfile = profile ?? ctx.profile;
  const getToken = directToken(options, ctx);
  const directBaseURL = baseURL ?? ctx.baseURL;
  const directProfile = profileId ?? resolvedProfile;

  return useMemo(() => {
    if (getToken) {
      return createLigaXTransport<M>({
        getToken,
        baseURL: directBaseURL,
        profileId: directProfile,
        onRun,
        fetch,
        headers,
        body,
      });
    }
    const resolveHeaders = async (): Promise<Record<string, string>> => {
      const base = typeof headers === 'function' ? await headers() : (headers ?? {});
      if (!getClientToken) return base;
      const value = await getClientToken({ refresh: false });
      const token = typeof value === 'string' ? value : value.token;
      return { ...base, Authorization: `Bearer ${token}` };
    };
    return createLigaXTransport<M>({
      api: api ?? ctx.api,
      onRun,
      fetch,
      credentials,
      headers: resolveHeaders,
      body: { ...body, ...(resolvedProfile ? { profile: resolvedProfile } : {}) },
    });
    // `body`, `headers` and `onRun` are compared by identity; pass stable references. A new
    // transport also forgets the conversation ids it was carrying.
  }, [
    api,
    ctx.api,
    onRun,
    fetch,
    credentials,
    headers,
    body,
    getClientToken,
    resolvedProfile,
    getToken,
    directBaseURL,
    directProfile,
  ]);
}

/** `useChat`'s own options minus the transport (which this hook supplies) and the `chat` form. */
export type UseChatPassThrough<M extends UIMessage> = Omit<ChatInit<M>, 'transport'> &
  Omit<UseChatOptions<M>, keyof ChatInit<M> | 'chat'>;

export interface UseLigaXChatOptions<M extends UIMessage>
  extends UseLigaXTransportOptions, UseChatPassThrough<M> {
  /**
   * `useChat` from `@ai-sdk/react`, passed in rather than imported here: `@ai-sdk/react` stays
   * an optional peer (nothing to install if you only want the transport), and your app controls
   * which copy of the AI SDK runs — the hook must come from the same React tree as your `useChat`.
   */
  useChat: typeof UseChat;
}

/**
 * `useChat` with the LigaX transport pre-built. Everything `useChat` accepts (`id`, `messages`,
 * `onFinish`, ...) passes straight through; `api` is your server route (default `/api/chat`, or the
 * provider's).
 *
 * ```tsx
 * import { useChat } from '@ai-sdk/react';
 * const { messages, sendMessage, status } = useLigaXChat({ useChat, api: '/api/chat' });
 * // or straight to the API with a client token from your createTokenRoute
 * const getToken = () => fetch('/api/ligax-token', { method: 'POST' }).then((r) => r.json());
 * useLigaXChat({ useChat, getToken, profileId: 'prf_…' }); // define getToken outside the component
 * ```
 */
export function useLigaXChat<M extends UIMessage = UIMessage>(
  options: UseLigaXChatOptions<M>,
): UseChatHelpers<M> {
  const {
    useChat,
    api,
    profile,
    headers,
    body,
    fetch,
    credentials,
    onRun,
    getToken,
    baseURL,
    profileId,
    ...chatOptions
  } = options;
  const transport = useLigaXTransport<M>({
    api,
    profile,
    headers,
    body,
    fetch,
    credentials,
    onRun,
    getToken,
    baseURL,
    profileId,
  });
  return useChat<M>({ ...(chatOptions as UseChatPassThrough<M>), transport });
}
