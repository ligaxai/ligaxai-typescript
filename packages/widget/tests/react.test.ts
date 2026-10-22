import { afterEach, describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { LigaXChat } from '../src/react.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('<LigaXChat>', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders <ligax-chat> with the props as attributes and registers the element', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(LigaXChat, {
          publishableKey: 'lgx_pk_live_abc',
          profileId: 'prf_AAAAAAAAAAAAAAAAAAAA',
          title: 'Help',
          position: 'bottom-left',
          open: true,
        }),
      );
    });
    const el = host.querySelector('ligax-chat')!;
    expect(el.getAttribute('publishable-key')).toBe('lgx_pk_live_abc');
    expect(el.getAttribute('profile-id')).toBe('prf_AAAAAAAAAAAAAAAAAAAA');
    expect(el.getAttribute('position')).toBe('bottom-left');
    expect(el.hasAttribute('open')).toBe(true);
    expect(customElements.get('ligax-chat')).toBeDefined();
    // Upgraded once defined: the shadow root carries the panel, titled from the prop.
    expect(el.shadowRoot?.querySelector('h2')?.textContent).toBe('Help');
    await act(async () => root.unmount());
  });
});
