import type { Fetch } from '@ligaxai/sdk';

import { define, TAG_NAME, type LigaXChatElement } from './element.js';

/**
 * `@ligaxai/widget` — a chat assistant for any website: the framework-free custom element
 * `<ligax-chat>` (Shadow DOM, so the host page's CSS cannot break it and it cannot break the page).
 *
 * The browser never holds a secret key. Either a **publishable key** opens an anonymous visitor
 * session (`POST /widget/sessions`), or a **token URL** on your own site returns a client token for
 * the signed-in user (`createTokenRoute` from `@ligaxai/sdk/next`). Runs stream with that token;
 * the API holds it to one assistant, one user and the profile's allowed origins.
 *
 * Use it with one script tag (`dist/widget.global.js` mounts itself from its `data-*` attributes),
 * `mount()` from a bundle, `<ligax-chat>` in markup after `define()`, or `<LigaXChat>` from
 * `@ligaxai/widget/react`.
 */

export {
  connectorName,
  define,
  friendlyError,
  getElementClass,
  OBSERVED_ATTRIBUTES,
  TAG_NAME,
} from './element.js';
export type { LigaXChatElement } from './element.js';
export { renderMarkdown, safeHref } from './markdown.js';

export interface WidgetOptions {
  /** `lgx_pk_…` — anonymous visitors. Needs `profileId`. */
  publishableKey?: string | undefined;
  /** `prf_…`. Optional with `tokenUrl` when your endpoint answers `profile_id`. */
  profileId?: string | undefined;
  /** Your endpoint that answers `{ token, expires_at, profile_id }` for the signed-in user. */
  tokenUrl?: string | undefined;
  /** The API base URL. Default `https://enterprise.ligax.ai/api/public/v1`. */
  baseURL?: string | undefined;
  /** Panel heading. Default "Chat". */
  title?: string | undefined;
  /** First assistant message, shown locally (it is not sent to the agent). */
  greeting?: string | undefined;
  placeholder?: string | undefined;
  position?: 'bottom-right' | 'bottom-left' | undefined;
  /** Start with the panel open. */
  open?: boolean | undefined;
  /**
   * Connector keys (`['gmail', 'outlook']` or `"gmail,outlook"`) the visitor may connect their own
   * account for: a "Connect your account" area with one button each. Needs the profile's "End users
   * can connect their own accounts" switch; when it is off the area hides itself.
   */
  connectors?: readonly string[] | string | undefined;
  /** Element or selector to append to. Default `document.body`. */
  container?: HTMLElement | string | undefined;
  /** Inject a `fetch` (tests, proxies). */
  fetch?: Fetch | undefined;
}

/** Create a `<ligax-chat>`, configure it and append it to the page. */
export function mount(options: WidgetOptions): LigaXChatElement {
  if (typeof document === 'undefined') {
    throw new Error('@ligaxai/widget needs a DOM; call mount() in the browser.');
  }
  define();
  const el = document.createElement(TAG_NAME) as LigaXChatElement;
  el.fetch = options.fetch;
  const attrs: Record<string, string | undefined> = {
    'publishable-key': options.publishableKey,
    'profile-id': options.profileId,
    'token-url': options.tokenUrl,
    'base-url': options.baseURL,
    'chat-title': options.title,
    greeting: options.greeting,
    placeholder: options.placeholder,
    position: options.position,
    connectors:
      typeof options.connectors === 'string' ? options.connectors : options.connectors?.join(','),
  };
  for (const [name, value] of Object.entries(attrs)) if (value) el.setAttribute(name, value);
  if (options.open) el.setAttribute('open', '');
  resolveContainer(options.container).appendChild(el);
  return el;
}

/**
 * Mount from the script tag that loaded the widget:
 *
 * ```html
 * <script src="https://unpkg.com/@ligaxai/widget/dist/widget.global.js"
 *   data-publishable-key="lgx_pk_live_…" data-profile-id="prf_…" async></script>
 * ```
 *
 * or `data-token-url="/api/ligax-token"` for signed-in users. Also read: `data-base-url`,
 * `data-title`, `data-greeting`, `data-placeholder`, `data-position`, `data-open` and
 * `data-connectors` (e.g. `"gmail,outlook"`).
 */
export function autoInit(
  doc: Document = document,
  script: HTMLScriptElement | null = (doc.currentScript as HTMLScriptElement | null) ??
    doc.querySelector<HTMLScriptElement>('script[data-publishable-key], script[data-token-url]'),
): Promise<LigaXChatElement | undefined> {
  if (!script) return Promise.resolve(undefined);
  const data = (name: string) => script.getAttribute(`data-${name}`) ?? undefined;
  const publishableKey = data('publishable-key');
  const tokenUrl = data('token-url');
  const profileId = data('profile-id');
  if (!tokenUrl && !(publishableKey && profileId)) return Promise.resolve(undefined);
  const position = data('position');
  const open = data('open');
  const run = () =>
    mount({
      publishableKey,
      profileId,
      tokenUrl,
      baseURL: data('base-url'),
      title: data('title'),
      greeting: data('greeting'),
      placeholder: data('placeholder'),
      position: position === 'bottom-left' ? 'bottom-left' : 'bottom-right',
      open: open !== undefined && open !== 'false',
      connectors: data('connectors'),
      container: doc.body,
    });
  if (doc.readyState === 'loading') {
    return new Promise((resolve) =>
      doc.addEventListener('DOMContentLoaded', () => resolve(run()), { once: true }),
    );
  }
  return Promise.resolve(run());
}

function resolveContainer(container: WidgetOptions['container']): HTMLElement {
  if (container instanceof HTMLElement) return container;
  if (typeof container === 'string') {
    const el = document.querySelector<HTMLElement>(container);
    if (!el) throw new Error(`@ligaxai/widget: no element matches "${container}"`);
    return el;
  }
  return document.body;
}
