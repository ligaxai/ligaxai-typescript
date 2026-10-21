import { LigaX, Stream } from '@ligaxai/sdk';

/**
 * `@ligaxai/widget` — a dependency-free chat panel for sites that are not React apps.
 * One `<script>` tag (the IIFE build) or `init()` from the library build mounts it.
 *
 * It talks to the API with a **publishable key** (`pk_` — safe to embed; the API scopes it to a
 * single profile and origin), never a secret key, so `dangerouslyAllowBrowser` is correct here.
 */

export interface WidgetTheme {
  accent?: string | undefined;
  background?: string | undefined;
  text?: string | undefined;
  radius?: string | undefined;
}

export interface WidgetOptions {
  publishableKey: string;
  profile: string;
  baseURL?: string | undefined;
  /** Element or selector to mount into. Default: a new `<div>` appended to `<body>`. */
  container?: HTMLElement | string | undefined;
  theme?: WidgetTheme | undefined;
  /** Placeholder for the input. */
  placeholder?: string | undefined;
  /** Override for tests. */
  fetch?: typeof fetch | undefined;
}

export interface WidgetHandle {
  root: HTMLElement;
  send(text: string): Promise<void>;
  destroy(): void;
}

/** The streamed event shape the widget understands; anything else is ignored. */
interface ChatEvent {
  type: string;
  delta?: string;
  message?: string;
}

const ROOT_ATTR = 'data-chat-widget';

export function init(options: WidgetOptions): WidgetHandle {
  if (typeof document === 'undefined') {
    throw new Error('@ligaxai/widget needs a DOM; call init() in the browser');
  }
  const client = new LigaX({
    apiKey: options.publishableKey,
    baseURL: options.baseURL,
    fetch: options.fetch,
    dangerouslyAllowBrowser: true,
  });

  const container = resolveContainer(options.container);
  const root = document.createElement('div');
  root.setAttribute(ROOT_ATTR, '');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'LigaX AI chat');
  applyTheme(root, options.theme);
  root.innerHTML = `
    <style>${STYLES}</style>
    <div class="bpw-log" aria-live="polite"></div>
    <form class="bpw-form">
      <input class="bpw-input" type="text" autocomplete="off" placeholder="${escapeHtml(options.placeholder ?? 'Ask a question…')}" />
      <button class="bpw-send" type="submit">Send</button>
    </form>`;
  container.appendChild(root);

  const log = root.querySelector<HTMLDivElement>('.bpw-log')!;
  const form = root.querySelector<HTMLFormElement>('.bpw-form')!;
  const input = root.querySelector<HTMLInputElement>('.bpw-input')!;
  const button = root.querySelector<HTMLButtonElement>('.bpw-send')!;
  let conversationId: string | undefined;
  let active: Stream<ChatEvent> | undefined;

  const append = (role: 'user' | 'assistant' | 'error', text: string): HTMLDivElement => {
    const el = document.createElement('div');
    el.className = `bpw-msg bpw-${role}`;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  };

  async function send(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    append('user', trimmed);
    const reply = append('assistant', '');
    button.disabled = true;
    try {
      active = await client.post<Stream<ChatEvent>>('/runs', {
        body: { profile: options.profile, input: trimmed, conversation_id: conversationId },
        stream: true,
      });
      for await (const event of active) {
        if (event.type === 'text.delta' && event.delta) reply.textContent += event.delta;
        else if (event.type === 'error')
          reply.textContent = event.message ?? 'Something went wrong.';
        else if (
          event.type === 'run.started' &&
          typeof (event as { conversation_id?: string }).conversation_id === 'string'
        ) {
          conversationId = (event as { conversation_id?: string }).conversation_id;
        }
        log.scrollTop = log.scrollHeight;
      }
    } catch (error) {
      reply.className = 'bpw-msg bpw-error';
      reply.textContent = error instanceof Error ? error.message : 'Something went wrong.';
    } finally {
      active = undefined;
      button.disabled = false;
    }
  }

  const onSubmit = (event: Event) => {
    event.preventDefault();
    const text = input.value;
    input.value = '';
    void send(text);
  };
  form.addEventListener('submit', onSubmit);

  return {
    root,
    send,
    destroy() {
      active?.abort();
      form.removeEventListener('submit', onSubmit);
      root.remove();
    },
  };
}

/** Mount from `<script src="…/widget.global.js" data-publishable-key="pk_…" data-profile="support">`. */
export function autoInit(doc: Document = document): WidgetHandle | undefined {
  const script =
    doc.currentScript ?? doc.querySelector<HTMLScriptElement>('script[data-publishable-key]');
  const key = script?.getAttribute('data-publishable-key');
  const profile = script?.getAttribute('data-profile');
  if (!key || !profile) return undefined;
  const mount = () =>
    init({
      publishableKey: key,
      profile,
      baseURL: script?.getAttribute('data-base-url') ?? undefined,
      container: script?.getAttribute('data-container') ?? undefined,
    });
  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', () => mount(), { once: true });
    return undefined;
  }
  return mount();
}

function resolveContainer(container: WidgetOptions['container']): HTMLElement {
  if (container instanceof HTMLElement) return container;
  if (typeof container === 'string') {
    const el = document.querySelector<HTMLElement>(container);
    if (!el) throw new Error(`@ligaxai/widget: no element matches "${container}"`);
    return el;
  }
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function applyTheme(root: HTMLElement, theme: WidgetTheme | undefined): void {
  root.style.setProperty('--bpw-accent', theme?.accent ?? '#2563eb');
  root.style.setProperty('--bpw-bg', theme?.background ?? '#ffffff');
  root.style.setProperty('--bpw-text', theme?.text ?? '#111827');
  root.style.setProperty('--bpw-radius', theme?.radius ?? '12px');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const STYLES = `
[${ROOT_ATTR}]{position:fixed;right:16px;bottom:16px;width:min(360px,calc(100vw - 32px));height:480px;display:flex;flex-direction:column;background:var(--bpw-bg);color:var(--bpw-text);border-radius:var(--bpw-radius);box-shadow:0 10px 40px rgba(0,0,0,.18);font:14px/1.4 system-ui,sans-serif;overflow:hidden;z-index:2147483000}
.bpw-log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.bpw-msg{max-width:85%;padding:8px 12px;border-radius:var(--bpw-radius);white-space:pre-wrap;word-break:break-word}
.bpw-user{align-self:flex-end;background:var(--bpw-accent);color:#fff}
.bpw-assistant{align-self:flex-start;background:rgba(0,0,0,.06)}
.bpw-error{align-self:flex-start;background:#fee2e2;color:#991b1b}
.bpw-form{display:flex;gap:8px;padding:12px;border-top:1px solid rgba(0,0,0,.08)}
.bpw-input{flex:1;padding:8px 10px;border:1px solid rgba(0,0,0,.15);border-radius:8px;font:inherit;color:inherit;background:transparent}
.bpw-send{padding:8px 14px;border:0;border-radius:8px;background:var(--bpw-accent);color:#fff;font:inherit;cursor:pointer}
.bpw-send:disabled{opacity:.5;cursor:default}
`;
