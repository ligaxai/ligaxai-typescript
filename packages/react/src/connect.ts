import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LigaX,
  cachedTokenProvider,
  connectAccount,
  type ConnectAccountOptions,
  type ConnectSession,
} from '@ligaxai/sdk';

import { useLigaX } from './provider.js';

export type ConnectAccountState = 'idle' | 'connecting' | 'succeeded' | 'failed';

export interface UseConnectAccountOptions {
  /**
   * The client to connect with — a client-token client in the browser. Omit it to build one from the
   * nearest `LigaXProvider`'s `baseURL` + `getClientToken` (direct mode).
   */
  client?: Pick<LigaX, 'connectSessions'> | undefined;
}

/** What `connect()` takes: `connectAccount()`'s options minus `signal` (the hook owns that). */
export type ConnectOptions = Omit<ConnectAccountOptions, 'signal'>;

export interface UseConnectAccountResult {
  /**
   * Start connecting. **Call it straight from a click handler** (no await before it) so the browser
   * allows the popup. Resolves with the final session, or `undefined` when it failed with an error
   * (read `error`) or was superseded / unmounted. Never rejects.
   */
  connect: (options: ConnectOptions) => Promise<ConnectSession | undefined>;
  /** `failed` covers both an error and a session that ended `denied`, `failed` or `expired`. */
  state: ConnectAccountState;
  /** The last session seen; check `status` and `failure_code` when `state` is `failed`. */
  session: ConnectSession | undefined;
  /** Why it failed, when it threw: `ConnectAccountError` (popup blocked/closed, timeout) or an `APIError`. */
  error: Error | undefined;
  /** Back to `idle`, abandoning a flow in progress (its popup is closed). */
  reset: () => void;
}

/**
 * Let the signed-in end user connect their own account (Gmail, Outlook, …) from React, with
 * `connectAccount()` underneath: popup, consent, poll, close.
 *
 * ```tsx
 * const { connect, state } = useConnectAccount();
 * <button onClick={() => connect({ connectorKey: 'gmail' })} disabled={state === 'connecting'}>
 *   Connect Gmail
 * </button>
 * ```
 */
export function useConnectAccount(options: UseConnectAccountOptions = {}): UseConnectAccountResult {
  const ctx = useLigaX();
  const given = options.client;
  const client = useMemo(() => {
    if (given) return given;
    if (!ctx.baseURL || !ctx.getClientToken) return undefined;
    return new LigaX({ baseURL: ctx.baseURL, apiKey: cachedTokenProvider(ctx.getClientToken) });
  }, [given, ctx.baseURL, ctx.getClientToken]);

  const [state, setState] = useState<ConnectAccountState>('idle');
  const [session, setSession] = useState<ConnectSession | undefined>();
  const [error, setError] = useState<Error | undefined>();
  const current = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      current.current?.abort();
      current.current = null;
    },
    [],
  );

  const reset = useCallback(() => {
    current.current?.abort();
    current.current = null;
    setState('idle');
    setSession(undefined);
    setError(undefined);
  }, []);

  const connect = useCallback(
    async (connectOptions: ConnectOptions): Promise<ConnectSession | undefined> => {
      current.current?.abort();
      const controller = new AbortController();
      current.current = controller;
      setState('connecting');
      setSession(undefined);
      setError(undefined);
      if (!client) {
        setState('failed');
        setError(
          new Error(
            'useConnectAccount needs a client: pass `client`, or give LigaXProvider `baseURL` and `getClientToken`.',
          ),
        );
        return undefined;
      }
      try {
        // No await before this call: connectAccount opens the popup synchronously, in the click.
        const result = await connectAccount(client, {
          ...connectOptions,
          signal: controller.signal,
        });
        if (current.current !== controller) return undefined;
        setSession(result);
        setState(result.status === 'succeeded' ? 'succeeded' : 'failed');
        return result;
      } catch (err) {
        if (current.current !== controller) return undefined;
        const failure = err instanceof Error ? err : new Error(String(err));
        setError(failure);
        const seen = (err as { session?: ConnectSession }).session;
        if (seen) setSession(seen);
        setState('failed');
        return undefined;
      } finally {
        if (current.current === controller) current.current = null;
      }
    },
    [client],
  );

  return { connect, state, session, error, reset };
}
