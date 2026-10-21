import { useMemo } from 'react';
import type { ChatInit, ChatTransport, UIMessage } from 'ai';
import type { useChat as UseChat } from '@ai-sdk/react';
import { createChatTransport, type ChatTransportOptions } from '@ligaxai/sdk/ai-sdk';

import { useLigaX } from './provider.js';

export type UseChatOptions<M extends UIMessage> = Parameters<typeof UseChat<M>>[0];
export type UseChatHelpers<M extends UIMessage> = ReturnType<typeof UseChat<M>>;

export interface UseLigaXTransportOptions extends Omit<ChatTransportOptions, 'headers' | 'body'> {
  /** Profile for this chat; falls back to the provider's. Sent as `profile` in the body. */
  profile?: string | undefined;
  headers?: ChatTransportOptions['headers'];
  body?: Record<string, unknown> | undefined;
}

/**
 * A memoised `ChatTransport` wired to the nearest `LigaXProvider`: posts to its `api`,
 * attaches a client token from `getClientToken` when one is configured, and sends the profile.
 * Use it directly with `new Chat({ transport })` or hand it to `useLigaXChat`.
 */
export function useLigaXTransport<M extends UIMessage = UIMessage>(
  options: UseLigaXTransportOptions = {},
): ChatTransport<M> {
  const ctx = useLigaX();
  const { api, profile, headers, body, fetch, credentials, reconnectApi } = options;
  const getClientToken = ctx.getClientToken;
  const resolvedProfile = profile ?? ctx.profile;

  return useMemo(() => {
    const resolveHeaders = async (): Promise<Record<string, string>> => {
      const base = typeof headers === 'function' ? await headers() : (headers ?? {});
      if (!getClientToken) return base;
      return { ...base, Authorization: `Bearer ${await getClientToken()}` };
    };
    return createChatTransport<M>({
      api: api ?? ctx.api,
      reconnectApi,
      fetch,
      credentials,
      headers: resolveHeaders,
      body: { ...body, ...(resolvedProfile ? { profile: resolvedProfile } : {}) },
    });
    // `body` and `headers` are compared by identity; pass stable references.
  }, [
    api,
    ctx.api,
    reconnectApi,
    fetch,
    credentials,
    headers,
    body,
    getClientToken,
    resolvedProfile,
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
 * `useChat` with the transport pre-built from the provider. Everything `useChat` accepts
 * (`id`, `messages`, `onFinish`, ...) passes straight through.
 *
 * ```tsx
 * import { useChat } from '@ai-sdk/react';
 * const { messages, sendMessage } = useLigaXChat({ useChat, profile: 'support' });
 * ```
 */
export function useLigaXChat<M extends UIMessage = UIMessage>(
  options: UseLigaXChatOptions<M>,
): UseChatHelpers<M> {
  const { useChat, api, profile, headers, body, fetch, credentials, reconnectApi, ...chatOptions } =
    options;
  const transport = useLigaXTransport<M>({
    api,
    profile,
    headers,
    body,
    fetch,
    credentials,
    reconnectApi,
  });
  return useChat<M>({ ...(chatOptions as UseChatPassThrough<M>), transport });
}
