import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  autoInit,
  connectorName,
  define,
  friendlyError,
  mount,
  renderMarkdown,
  type LigaXChatElement,
} from '../src/index.js';
import { APIError } from '@ligaxai/sdk';

const PROFILE = 'prf_AAAAAAAAAAAAAAAAAAAA';
const CONV = 'conv_CCCCCCCCCCCCCCCCCCCCCCCC';
const BASE = 'https://api.example/api/public/v1';

interface Call {
  url: string;
  init: RequestInit;
  headers: Headers;
  body: unknown;
}

type Responder = Response | ((call: Call) => Response);

/** A scripted fetch keyed by "METHOD path" so the order of unrelated calls does not matter. */
function fakeFetch(routes: Record<string, Responder | Responder[]>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const raw = typeof init.body === 'string' ? init.body : undefined;
    const call: Call = {
      url,
      init,
      headers: new Headers(init.headers),
      body: raw ? JSON.parse(raw) : undefined,
    };
    calls.push(call);
    const path = url.startsWith(BASE) ? url.slice(BASE.length).split('?')[0] : url;
    const key = `${init.method ?? 'GET'} ${path}`;
    const entry = routes[key];
    const next = Array.isArray(entry) ? entry.shift() : entry;
    if (!next) throw new Error(`unexpected ${key}`);
    return typeof next === 'function' ? next(call) : next.clone();
  });
  return Object.assign(fn, { calls });
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

function frame(type: string, seq: number | null, payload: Record<string, unknown> = {}): string {
  const body = { v: 1, type, seq, run: { id: 'run_1' }, payload };
  return `event: ${type}\ndata: ${JSON.stringify(body)}\n\n`;
}

const sse = (body: string) =>
  new Response(body, {
    headers: {
      'content-type': 'text/event-stream',
      'x-run-id': 'run_1',
      'x-conversation-id': CONV,
    },
  });

function answer(text: string, from = 1): string {
  const half = Math.ceil(text.length / 2);
  return (
    frame('stream.ready', null) +
    frame('part.start', from, { part_id: `p${from}`, kind: 'text', ord: 0 }) +
    frame('text.delta', from + 1, { part_id: `p${from}`, offset: 0, text: text.slice(0, half) }) +
    frame('text.delta', from + 2, { part_id: `p${from}`, offset: half, text: text.slice(half) }) +
    frame('part.end', from + 3, { part_id: `p${from}` }) +
    frame('run.end', from + 4, { status: 'completed', finish_reason: 'stop' })
  );
}

const session = (over: Record<string, unknown> = {}) =>
  json(
    {
      object: 'client_token',
      token: 'lgx_ct_visitor.sig',
      expires_at: new Date(Date.now() + 900_000).toISOString(),
      profile_id: PROFILE,
      end_user_id: 'visitor:abc',
      conversation_id: null,
      visitor_id: 'server_visitor_id_123',
      ...over,
    },
    201,
  );

const shadow = (el: LigaXChatElement) => el.shadowRoot!;
const bubbles = (el: LigaXChatElement, kind: string) =>
  [...shadow(el).querySelectorAll<HTMLElement>(`.msg.${kind}`)].map((b) => b.textContent);

function widget(fetch: ReturnType<typeof fakeFetch>, extra: Record<string, unknown> = {}) {
  return mount({
    publishableKey: 'lgx_pk_live_abc',
    profileId: PROFILE,
    baseURL: BASE,
    fetch,
    ...extra,
  });
}

beforeEach(() => {
  define();
});

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  localStorage.clear();
  sessionStorage.clear();
});

describe('<ligax-chat> mounting', () => {
  it('mounts from the script tag data attributes', async () => {
    const script = document.createElement('script');
    script.setAttribute('data-publishable-key', 'lgx_pk_live_abc');
    script.setAttribute('data-profile-id', PROFILE);
    script.setAttribute('data-title', 'Acme help');
    script.setAttribute('data-greeting', 'Hi! How can I help?');
    script.setAttribute('data-position', 'bottom-left');
    script.setAttribute('data-open', '');
    document.head.appendChild(script);

    const el = (await autoInit(document, script))!;
    expect(el.tagName.toLowerCase()).toBe('ligax-chat');
    expect(el.getAttribute('publishable-key')).toBe('lgx_pk_live_abc');
    expect(el.getAttribute('profile-id')).toBe(PROFILE);
    expect(el.getAttribute('position')).toBe('bottom-left');
    expect(shadow(el).querySelector('h2')?.textContent).toBe('Acme help');
    // data-open: the panel is open and focus is in the composer.
    expect(shadow(el).querySelector<HTMLElement>('.panel')!.hidden).toBe(false);
    expect(shadow(el).activeElement).toBe(shadow(el).querySelector('textarea'));
    expect(bubbles(el, 'assistant')).toEqual(['Hi! How can I help?']);
  });

  it('does nothing without a key + profile or a token URL', async () => {
    const script = document.createElement('script');
    script.setAttribute('data-publishable-key', 'lgx_pk_live_abc');
    expect(await autoInit(document, script)).toBeUndefined();
    expect(document.querySelector('ligax-chat')).toBeNull();
  });

  it('opens, closes on Escape and returns focus to the launcher', () => {
    const el = widget(fakeFetch({}));
    const launcher = shadow(el).querySelector<HTMLButtonElement>('.launcher')!;
    const panel = shadow(el).querySelector<HTMLElement>('.panel')!;
    expect(panel.hidden).toBe(true);
    launcher.click();
    expect(panel.hidden).toBe(false);
    expect(launcher.getAttribute('aria-expanded')).toBe('true');
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.hidden).toBe(true);
    expect(shadow(el).activeElement).toBe(launcher);
  });

  it('sends on Enter from the keyboard', async () => {
    const fetch = fakeFetch({
      'POST /widget/sessions': session(),
      'POST /runs': sse(answer('Hi')),
    });
    const el = widget(fetch, { open: true });
    const input = shadow(el).querySelector('textarea')!;
    input.value = 'hello';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(bubbles(el, 'assistant')).toEqual(['Hi']));
    expect(input.value).toBe('');
  });
});

describe('<ligax-chat> conversation', () => {
  it('opens a widget session, streams the answer and keeps the conversation per tab', async () => {
    const fetch = fakeFetch({
      'POST /widget/sessions': session(),
      'POST /runs': [sse(answer('Hello there')), sse(answer('Again'))],
    });
    const el = widget(fetch);
    await el.send('hi');
    expect(bubbles(el, 'user')).toEqual(['hi']);
    expect(bubbles(el, 'assistant')).toEqual(['Hello there']);

    const [open, run] = fetch.calls;
    expect(open?.headers.get('authorization')).toBe('Bearer lgx_pk_live_abc');
    expect(open?.body).toMatchObject({ profile_id: PROFILE });
    expect(run?.headers.get('authorization')).toBe('Bearer lgx_ct_visitor.sig');
    expect(run?.body).toEqual({ profile_id: PROFILE, input: 'hi', mode: 'stream' });
    expect(sessionStorage.getItem(`ligax.conversation.${PROFILE}`)).toBe(CONV);

    await el.send('more');
    // Same token (cached), and the conversation carried on.
    expect(fetch.calls).toHaveLength(3);
    expect((fetch.calls[2]?.body as { conversation_id?: string }).conversation_id).toBe(CONV);
  });

  it('keeps a visitor id in localStorage and reuses it', async () => {
    const echo = (call: Call) =>
      session({ visitor_id: (call.body as { visitor_id: string }).visitor_id });
    const fetch = fakeFetch({
      'POST /widget/sessions': [echo, echo],
      'POST /runs': [sse(answer('a')), sse(answer('b'))],
    });
    await widget(fetch).send('one');
    const stored = localStorage.getItem('ligax.visitor_id');
    expect(stored).toMatch(/^[0-9A-Za-z_-]{16,64}$/);
    expect((fetch.calls[0]?.body as { visitor_id: string }).visitor_id).toBe(stored);

    document.body.innerHTML = '';
    await widget(fetch).send('two'); // a new page load: a new element, same browser
    const second = fetch.calls.filter((c) => c.url.endsWith('/widget/sessions'))[1];
    expect((second?.body as { visitor_id: string }).visitor_id).toBe(stored);
  });

  it('still works when storage throws', async () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const fetch = fakeFetch({
      'POST /widget/sessions': session(),
      'POST /runs': sse(answer('ok')),
    });
    const el = widget(fetch);
    await el.send('hi');
    expect(bubbles(el, 'assistant')).toEqual(['ok']);
    get.mockRestore();
    set.mockRestore();
  });

  it('never turns model output into HTML', async () => {
    const hostile =
      'Hi <img src=x onerror="window.__pwned=1"> **bold** `<b>code</b>` ' +
      '[bad](javascript:alert(1)) [plain](http://example.com) [good](https://example.com/a)' +
      '\n\n<script>x</script>';
    const fetch = fakeFetch({
      'POST /widget/sessions': session(),
      'POST /runs': sse(answer(hostile)),
    });
    const el = widget(fetch);
    await el.send('hi');
    const bubble = shadow(el).querySelector<HTMLElement>('.msg.assistant')!;
    expect(bubble.querySelector('img, script, b')).toBeNull();
    expect(bubble.textContent).toContain('<img src=x onerror="window.__pwned=1">');
    expect(bubble.textContent).toContain('<script>x</script>');
    expect(bubble.querySelector('strong')?.textContent).toBe('bold');
    expect(bubble.querySelector('code')?.textContent).toBe('<b>code</b>');
    const links = [...bubble.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/a']);
    expect(links[0]?.rel).toBe('noopener noreferrer');
    expect(links[0]?.target).toBe('_blank');
    expect((window as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('shows an approval card on requires_action; Approve posts the interrupt and follows the run', async () => {
    const asking =
      frame('stream.ready', null) +
      frame('tool.start', 1, { tool_call_id: 'call_1', name: 'crm_create_ticket' }) +
      frame('interrupt.raised', 2, {
        interrupt_id: 'int_1',
        kind: 'tool_approval',
        tool_call_id: 'call_1',
        prompt: 'Create a support ticket?',
      });
    const fetch = fakeFetch({
      'POST /widget/sessions': session(),
      'POST /runs': sse(asking),
      'POST /runs/run_1/interrupts/int_1': json({ id: 'run_1', status: 'running' }),
      'GET /runs/run_1/events': (call) => {
        expect(call.url).toContain('after=2');
        return sse(answer('Ticket created.', 3));
      },
    });
    const el = widget(fetch);
    const done = el.send('open a ticket');
    const card = await vi.waitFor(() => {
      const found = shadow(el).querySelector<HTMLElement>('.card');
      if (!found) throw new Error('no card yet');
      return found;
    });
    expect(card.textContent).toContain('Create a support ticket?');
    card.querySelector<HTMLButtonElement>('.approve')!.click();
    await done;

    const resolve = fetch.calls.find((c) => c.url.endsWith('/interrupts/int_1'));
    expect(resolve?.init.method).toBe('POST');
    expect(resolve?.body).toEqual({ decision: 'approve' });
    expect(resolve?.headers.get('authorization')).toBe('Bearer lgx_ct_visitor.sig');
    expect(bubbles(el, 'assistant')).toEqual(['Ticket created.']);
    expect(card.querySelector('.actions')).toBeNull();
  });

  it('refreshes an expired token once', async () => {
    const fetch = fakeFetch({
      'POST /widget/sessions': [
        session({ token: 'lgx_ct_old.sig' }),
        session({ token: 'lgx_ct_new.sig' }),
      ],
      'POST /runs': [
        json({ error: { type: 'authentication_error', code: 'token_expired', message: 'x' } }, 401),
        sse(answer('fresh')),
      ],
    });
    const el = widget(fetch);
    await el.send('hi');
    expect(bubbles(el, 'assistant')).toEqual(['fresh']);
    const runs = fetch.calls.filter((c) => c.url.endsWith('/runs'));
    expect(runs.map((c) => c.headers.get('authorization'))).toEqual([
      'Bearer lgx_ct_old.sig',
      'Bearer lgx_ct_new.sig',
    ]);
  });

  it('shows a friendly error instead of the API body', async () => {
    const fetch = fakeFetch({
      'POST /widget/sessions': session(),
      'POST /runs': json(
        { error: { type: 'billing_error', code: 'key_limit_reached', message: 'internal detail' } },
        402,
      ),
    });
    const el = widget(fetch);
    await el.send('hi');
    const error = shadow(el).querySelector<HTMLElement>('.msg.error')!;
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toBe(
      'This assistant is unavailable right now. Please try again later.',
    );
    expect(shadow(el).querySelector('.send')!.hasAttribute('disabled')).toBe(false);
  });

  it('token URL mode: fetches the token with credentials and learns the profile from it', async () => {
    const fetch = fakeFetch({
      'POST /api/ligax-token': json({
        token: 'lgx_ct_user.sig',
        expires_at: new Date(Date.now() + 600_000).toISOString(),
        profile_id: PROFILE,
      }),
      'POST /runs': sse(answer('Hello Ada')),
    });
    const el = mount({ tokenUrl: '/api/ligax-token', baseURL: BASE, fetch });
    await el.send('hi');
    const [token, run] = fetch.calls;
    expect(token?.init.credentials).toBe('include');
    expect(run?.headers.get('authorization')).toBe('Bearer lgx_ct_user.sig');
    expect((run?.body as { profile_id: string }).profile_id).toBe(PROFILE);
    expect(bubbles(el, 'assistant')).toEqual(['Hello Ada']);
  });
});

describe('<ligax-chat> connect your account', () => {
  const CONNECT_URL = 'https://accounts.example/consent?flow=1';
  const connectSession = (over: Record<string, unknown> = {}, status = 200) =>
    json(
      {
        object: 'connect_session',
        id: 'flow_ABCDEFGH',
        status: 'pending',
        connect_url: CONNECT_URL,
        expires_at: null,
        connector_key: 'gmail',
        end_user_id: 'visitor:abc',
        connection_id: null,
        failure_code: null,
        ...over,
      },
      status,
    );

  function fakePopup() {
    const popup = {
      closed: false,
      location: { href: '' },
      close: vi.fn(() => {
        popup.closed = true;
      }),
    };
    vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    return popup;
  }

  const area = (el: LigaXChatElement) => shadow(el).querySelector<HTMLElement>('.connect')!;
  const buttons = (el: LigaXChatElement) => [
    ...shadow(el).querySelectorAll<HTMLButtonElement>('.connect-buttons button'),
  ];
  const status = (el: LigaXChatElement) =>
    shadow(el).querySelector<HTMLElement>('.connect-status')!.textContent;

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('is hidden without connectors, and shows one humanised button per key', () => {
    expect(area(widget(fakeFetch({}))).hidden).toBe(true);
    const el = widget(fakeFetch({}), { connectors: 'gmail, google_calendar,github,<b>x</b>' });
    expect(area(el).hidden).toBe(false);
    expect(buttons(el).map((b) => b.textContent)).toEqual(['Gmail', 'Google Calendar', 'GitHub']);
    expect(buttons(el)[0]?.getAttribute('aria-label')).toBe('Connect Gmail');
  });

  it('reads data-connectors from the script tag', async () => {
    const script = document.createElement('script');
    script.setAttribute('data-publishable-key', 'lgx_pk_live_abc');
    script.setAttribute('data-profile-id', PROFILE);
    script.setAttribute('data-connectors', 'gmail,outlook');
    const el = (await autoInit(document, script))!;
    expect(el.getAttribute('connectors')).toBe('gmail,outlook');
    expect(buttons(el).map((b) => b.textContent)).toEqual(['Gmail', 'Outlook']);
  });

  it('opens the popup in the click, polls to succeeded and confirms', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const popup = fakePopup();
    const fetch = fakeFetch({
      'POST /widget/sessions': session(),
      'POST /connect_sessions': connectSession({}, 201),
      'GET /connect_sessions/flow_ABCDEFGH': connectSession({
        status: 'succeeded',
        connect_url: null,
        connector_key: '',
        connection_id: 'conn_1',
      }),
    });
    const el = widget(fetch, { connectors: ['gmail', 'outlook'], open: true });
    buttons(el)[0]!.click();
    // Synchronously, inside the click: the popup is open and every button waits.
    expect(window.open).toHaveBeenCalledTimes(1);
    expect(buttons(el).every((b) => b.disabled)).toBe(true);
    expect(status(el)).toBe('Connecting Gmail…');

    await vi.waitFor(() => expect(popup.location.href).toBe(CONNECT_URL));
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => expect(status(el)).toBe('Gmail is connected.'));
    expect(popup.closed).toBe(true);
    expect(buttons(el).map((b) => [b.textContent, b.disabled])).toEqual([
      ['Gmail connected', true],
      ['Outlook', false],
    ]);
    const create = fetch.calls.find((c) => c.url.endsWith('/connect_sessions'))!;
    // The visitor's client token, and nothing but the connector: the token fixes user and profile.
    expect(create.headers.get('authorization')).toBe('Bearer lgx_ct_visitor.sig');
    expect(create.body).toEqual({ connector_key: 'gmail' });
  });

  it('says so when the visitor declines', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    fakePopup();
    const fetch = fakeFetch({
      'POST /widget/sessions': session(),
      'POST /connect_sessions': connectSession({}, 201),
      'GET /connect_sessions/flow_ABCDEFGH': connectSession({ status: 'denied' }),
    });
    const el = widget(fetch, { connectors: 'gmail' });
    buttons(el)[0]!.click();
    await vi.waitFor(() => expect(fetch.calls.length).toBe(2));
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.waitFor(() => expect(status(el)).toBe('Gmail was not connected.'));
    expect(buttons(el)[0]?.disabled).toBe(false);
  });

  it('hides the area when the profile does not allow end-user connections', async () => {
    const popup = fakePopup();
    const fetch = fakeFetch({
      'POST /widget/sessions': session(),
      'POST /connect_sessions': json(
        {
          error: {
            type: 'conflict_error',
            code: 'end_user_connections_off',
            message: 'off',
            request_id: 'req_x',
          },
        },
        409,
        { 'x-should-retry': 'false' },
      ),
    });
    const el = widget(fetch, { connectors: 'gmail' });
    buttons(el)[0]!.click();
    await vi.waitFor(() => expect(area(el).hidden).toBe(true));
    expect(popup.closed).toBe(true);
    expect(buttons(el)).toHaveLength(0);
  });

  it('asks to allow pop-ups when the browser blocks one', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    const fetch = fakeFetch({});
    const el = widget(fetch, { connectors: 'gmail' });
    buttons(el)[0]!.click();
    return vi.waitFor(() => {
      expect(status(el)).toBe('Allow pop-ups for this site to connect Gmail.');
      expect(fetch.calls).toHaveLength(0);
    });
  });
});

describe('connectorName', () => {
  it('humanises connector keys', () => {
    expect(connectorName('gmail')).toBe('Gmail');
    expect(connectorName('microsoft_outlook')).toBe('Microsoft Outlook');
    expect(connectorName('servicenow')).toBe('ServiceNow');
    expect(connectorName('google-drive')).toBe('Google Drive');
  });
});

describe('friendlyError', () => {
  const err = (status: number, code?: string) =>
    APIError.generate(status, { error: { code, message: 'raw' } }, undefined, new Headers());
  it('maps the statuses a visitor can hit', () => {
    expect(friendlyError(err(401), true)).toBe('Please sign in to chat.');
    expect(friendlyError(err(401), false)).toMatch(/session has ended/);
    expect(friendlyError(err(403, 'origin_not_allowed'), false)).toMatch(/not enabled/);
    expect(friendlyError(err(429), false)).toMatch(/too quickly/);
    expect(friendlyError(new Error('boom'), false)).not.toContain('boom');
  });
});

describe('renderMarkdown', () => {
  it('renders paragraphs, line breaks and fenced code as nodes', () => {
    const host = document.createElement('div');
    host.appendChild(renderMarkdown('one\ntwo\n\n```js\nconst a = "<i>";\n```\nlast'));
    expect(host.querySelectorAll('p')).toHaveLength(2);
    expect(host.querySelector('br')).not.toBeNull();
    expect(host.querySelector('pre code')?.textContent).toBe('const a = "<i>";');
    expect(host.querySelector('i')).toBeNull();
  });
});
