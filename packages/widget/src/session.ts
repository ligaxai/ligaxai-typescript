import {
  APIError,
  LigaX,
  type ClientTokenLike,
  type Fetch,
  type TokenFetcher,
  type WidgetSession,
} from '@ligaxai/sdk';

/**
 * Where the widget's client token comes from. Two doors, and neither is a secret key:
 *
 * - **Publishable key** (`lgx_pk_…` + a profile id) — anonymous visitors. `POST /widget/sessions`
 *   answers a 15-minute token for `visitor:<visitor_id>`; the visitor id is a random value kept in
 *   `localStorage` so a returning visitor is the same end user (their conversations stay theirs).
 * - **Token URL** — signed-in users. The widget POSTs to the host site's own endpoint (e.g. one built
 *   with `createTokenRoute`) with the site's cookies, and gets a token minted for that user.
 */

export interface SessionSource {
  publishableKey?: string | undefined;
  profileId?: string | undefined;
  tokenUrl?: string | undefined;
  baseURL?: string | undefined;
  fetch?: Fetch | undefined;
}

/** A token answer plus the profile it was minted for (the run body needs `profile_id`). */
export type MintedToken = ClientTokenLike & { profile_id?: string | undefined };

const VISITOR_KEY = 'ligax.visitor_id';
const VISITOR_ID = /^[0-9A-Za-z_-]{16,64}$/;

/** Storage that may be missing or throw (private mode, blocked cookies, sandboxed iframes). */
export function readStorage(kind: 'local' | 'session', key: string): string | null {
  try {
    return (kind === 'local' ? localStorage : sessionStorage).getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(kind: 'local' | 'session', key: string, value: string | null): void {
  try {
    const store = kind === 'local' ? localStorage : sessionStorage;
    if (value === null) store.removeItem(key);
    else store.setItem(key, value);
  } catch {
    /* storage unavailable: the widget still works, it just forgets across reloads */
  }
}

/** 128 random bits, base64url — what `/widget/sessions` accepts as `visitor_id`. */
function newVisitorId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let binary = '';
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function visitorId(): string {
  const stored = readStorage('local', VISITOR_KEY);
  if (stored && VISITOR_ID.test(stored)) return stored;
  const id = newVisitorId();
  writeStorage('local', VISITOR_KEY, id);
  return id;
}

/**
 * A fetcher for `cachedTokenProvider`. `onMinted` sees every answer, so the element can learn the
 * profile id from a token URL that pins it server-side.
 */
export function tokenFetcher(
  source: SessionSource,
  onMinted: (token: MintedToken) => void,
): TokenFetcher {
  if (source.tokenUrl) {
    const url = source.tokenUrl;
    const fetchImpl: Fetch = source.fetch ?? globalThis.fetch.bind(globalThis);
    return async () => {
      // The host's own endpoint, not the LigaX API: its cookies say who the user is.
      const response = await fetchImpl(url, {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* keep the text */
      }
      if (!response.ok) throw APIError.generate(response.status, body, undefined, response.headers);
      const minted = body as MintedToken;
      if (!minted || typeof minted.token !== 'string') {
        throw new APIError(502, body, 'The token URL did not answer a token.', response.headers);
      }
      onMinted(minted);
      return minted;
    };
  }

  const { publishableKey, profileId } = source;
  if (!publishableKey || !profileId) {
    throw new TypeError('@ligaxai/widget: set a publishable key and a profile id, or a token URL.');
  }
  const client = new LigaX({
    apiKey: publishableKey,
    baseURL: source.baseURL,
    fetch: source.fetch,
  });
  return async () => {
    const session = await client.post<WidgetSession>('/widget/sessions', {
      body: { profile_id: profileId, visitor_id: visitorId() },
    });
    // The server keeps a visitor id it was given; store whatever it answered in case it differs.
    if (session.visitor_id && VISITOR_ID.test(session.visitor_id)) {
      writeStorage('local', VISITOR_KEY, session.visitor_id);
    }
    onMinted(session);
    return session;
  };
}
