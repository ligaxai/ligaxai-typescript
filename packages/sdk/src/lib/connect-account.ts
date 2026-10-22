import { sleep } from '../core/base-client.js';
import { ConnectAccountError } from '../core/errors.js';
import type { ConnectSessions } from '../resources/connect-sessions.js';
import type { CallOptions } from '../resources/shared.js';
import {
  TERMINAL_CONNECT_SESSION_STATUSES,
  type ConnectSession,
  type ConnectSessionCreateParams,
} from '../types.js';

/** The slice of `Window` the flow touches — kept structural so tests can hand in a plain object. */
export interface ConnectPopup {
  readonly closed: boolean;
  close(): void;
  location: { href: string };
}

export interface ConnectAccountOptions {
  /** The connector to connect (`gmail`, `outlook`, …), as installed in the agent. */
  connectorKey: string;
  /** Needed only with a secret key; a client token is bound to its profile already. */
  profileId?: string | undefined;
  /**
   * A window you opened yourself — `window.open('', 'ligax-connect', …)` as the very first thing in
   * your click handler — for when other awaits run before `connectAccount()`. Passing `null` (what a
   * blocked `window.open` returns) rejects with `ConnectAccountError('popup_blocked')`. Omit it and
   * the helper opens the popup itself, synchronously, before its first await.
   */
  popup?: ConnectPopup | Window | null | undefined;
  /** How often to ask how the session stands. Default 2 s. */
  pollIntervalMs?: number | undefined;
  /** Give up (and close the popup) after this long. Default 10 minutes. */
  timeoutMs?: number | undefined;
  /** Abort the flow; the popup is closed and the promise rejects. */
  signal?: AbortSignal | undefined;
  /** `window.open` features for the popup the helper opens. Default `width=520,height=720`. */
  popupFeatures?: string | undefined;
}

interface ConnectClient {
  connectSessions: ConnectSessions;
}

const DEFAULT_POLL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 10 * 60_000;
/**
 * The provider's callback closes the popup itself on success, so a closed popup is not a cancel on
 * its own: the session usually reads `succeeded` on the next poll. Only after this many further
 * polls still `pending` is the close taken to mean the user walked away.
 */
const POLLS_AFTER_CLOSE = 2;

function isTerminal(session: ConnectSession): boolean {
  return TERMINAL_CONNECT_SESSION_STATUSES.includes(session.status);
}

function openPopup(features: string | undefined): ConnectPopup | null {
  if (typeof window === 'undefined' || typeof window.open !== 'function') return null;
  return window.open('', 'ligax-connect', features ?? 'width=520,height=720');
}

function closeQuietly(popup: ConnectPopup): void {
  try {
    if (!popup.closed) popup.close();
  } catch {
    /* a popup we can no longer reach is as good as closed */
  }
}

/**
 * Let the end user connect their own account from the browser, start to finish: open a popup,
 * create a connect session, send the popup to the provider's consent page, poll until the session
 * ends, close the popup if it is still open, and resolve with the final session — check `status`
 * (`succeeded`, `denied`, `failed`, `expired`).
 *
 * **Call it from a click handler.** Browsers only allow a popup during a user gesture; the helper
 * opens it synchronously before its first await so the gesture still counts. If your handler awaits
 * something first, open the window yourself at the top of the handler and pass it as `popup`.
 *
 * Works with a client-token client (`lgx_ct_…`), which acts for its own end user and profile.
 *
 * ```ts
 * button.onclick = async () => {
 *   const session = await connectAccount(client, { connectorKey: 'gmail' });
 *   if (session.status === 'succeeded') showConnected();
 * };
 * ```
 */
export async function connectAccount(
  client: ConnectClient,
  options: ConnectAccountOptions,
): Promise<ConnectSession> {
  // Synchronous on purpose: everything up to the first await still runs inside the click.
  const popup: ConnectPopup | null =
    options.popup === undefined ? openPopup(options.popupFeatures) : options.popup;
  if (!popup) {
    throw new ConnectAccountError(
      'popup_blocked',
      'The browser blocked the connect popup. Call connectAccount() from a click handler, or open ' +
        'the window yourself and pass it as `popup`.',
    );
  }

  const { signal } = options;
  const call: CallOptions = signal ? { signal } : {};
  const interval = options.pollIntervalMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const body: ConnectSessionCreateParams = { connector_key: options.connectorKey };
    if (options.profileId) body.profile_id = options.profileId;
    const created = await client.connectSessions.create(body, call);
    if (isTerminal(created) || !created.connect_url) return created;

    popup.location.href = created.connect_url;

    let session = created;
    let pollsSinceClose = 0;
    for (;;) {
      if (Date.now() >= deadline) {
        throw new ConnectAccountError(
          'timeout',
          'The account was not connected in time.',
          session,
        );
      }
      await sleep(interval, signal);
      const polled = await client.connectSessions.get(created.id, {}, call);
      // A poll answers `connector_key: ""` and no `connect_url`; keep what creation told us.
      session = {
        ...polled,
        connector_key: polled.connector_key || created.connector_key,
        connect_url: polled.connect_url ?? created.connect_url,
        expires_at: polled.expires_at ?? created.expires_at,
      };
      if (isTerminal(session)) return session;
      if (popup.closed && ++pollsSinceClose > POLLS_AFTER_CLOSE) {
        throw new ConnectAccountError(
          'popup_closed',
          'The connect window was closed before the account was connected.',
          session,
        );
      }
    }
  } finally {
    closeQuietly(popup);
  }
}
