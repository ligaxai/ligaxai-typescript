import { afterEach, describe, expect, it, vi } from 'vitest';

import { autoInit, init } from '../src/index.js';

const sseFetch = () =>
  vi.fn(
    async () =>
      new Response(
        'data: {"type":"run.started","conversation_id":"conv_1"}\n\ndata: {"type":"text.delta","delta":"Hi "}\n\ndata: {"type":"text.delta","delta":"there"}\n\ndata: [DONE]\n\n',
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  );

describe('widget init()', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('mounts a root element with a log and a form', () => {
    const handle = init({
      publishableKey: 'pk_test',
      profile: 'support',
      baseURL: 'https://api.example',
    });
    expect(document.querySelector('[data-chat-widget]')).toBe(handle.root);
    expect(handle.root.querySelector('.bpw-form')).not.toBeNull();
    expect(handle.root.querySelector('.bpw-log')).not.toBeNull();
    handle.destroy();
    expect(document.querySelector('[data-chat-widget]')).toBeNull();
  });

  it('mounts into a selector and applies the theme', () => {
    document.body.innerHTML = '<div id="host"></div>';
    const handle = init({
      publishableKey: 'pk_test',
      profile: 'support',
      container: '#host',
      theme: { accent: '#ff0000' },
    });
    expect(document.querySelector('#host > [data-chat-widget]')).toBe(handle.root);
    expect(handle.root.style.getPropertyValue('--bpw-accent')).toBe('#ff0000');
  });

  it('streams a reply into the log using the publishable key', async () => {
    const fetch = sseFetch();
    const handle = init({
      publishableKey: 'pk_test',
      profile: 'support',
      baseURL: 'https://api.example',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    await handle.send('hello');
    const messages = [...handle.root.querySelectorAll('.bpw-msg')].map((el) => el.textContent);
    expect(messages).toEqual(['hello', 'Hi there']);

    const [url, init2] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example/runs');
    expect(new Headers(init2.headers).get('authorization')).toBe('Bearer pk_test');
    expect(JSON.parse(init2.body as string)).toMatchObject({ profile: 'support', input: 'hello' });

    // The second turn carries the conversation id learned from the first stream.
    fetch.mockImplementationOnce(sseFetch());
    await handle.send('again');
    const [, init3] = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(JSON.parse(init3.body as string)).toMatchObject({ conversation_id: 'conv_1' });
  });

  it('autoInit reads the script tag data attributes', () => {
    document.body.innerHTML =
      '<script data-publishable-key="pk_auto" data-profile="docs" data-base-url="https://api.example"></script>';
    const handle = autoInit(document);
    expect(handle?.root.getAttribute('data-chat-widget')).toBe('');
    expect(
      autoInit(Object.assign(document.implementation.createHTMLDocument(''), {})),
    ).toBeUndefined();
  });
});
