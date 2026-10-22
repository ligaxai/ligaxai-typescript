import { createElement, useEffect, useRef, type CSSProperties } from 'react';
import type { Fetch } from '@ligaxai/sdk';

import { define, TAG_NAME, type LigaXChatElement } from './element.js';

/**
 * `@ligaxai/widget/react` — `<LigaXChat>`, the website widget as a React component. It renders the
 * same `<ligax-chat>` custom element (registered on mount, so it is safe in server components'
 * client children and during SSR); every prop maps to an attribute.
 *
 * For a chat UI built from your own components, use `useLigaXChat` from `@ligaxai/react` instead.
 */
export interface LigaXChatProps {
  publishableKey?: string | undefined;
  profileId?: string | undefined;
  /** Your endpoint answering `{ token, expires_at, profile_id }` (e.g. `createTokenRoute`). */
  tokenUrl?: string | undefined;
  baseURL?: string | undefined;
  title?: string | undefined;
  greeting?: string | undefined;
  placeholder?: string | undefined;
  position?: 'bottom-right' | 'bottom-left' | undefined;
  open?: boolean | undefined;
  /** Connector keys the visitor may connect their own account for, e.g. `['gmail', 'outlook']`. */
  connectors?: readonly string[] | undefined;
  className?: string | undefined;
  /** Theme with custom properties, e.g. `{ '--ligax-accent': '#7c3aed' }`. */
  style?: (CSSProperties & Record<`--${string}`, string>) | undefined;
  fetch?: Fetch | undefined;
}

export function LigaXChat(props: LigaXChatProps) {
  const ref = useRef<LigaXChatElement | null>(null);
  useEffect(() => define(), []);
  useEffect(() => {
    if (ref.current) ref.current.fetch = props.fetch;
  }, [props.fetch]);
  // Attribute names (kebab-case strings) work the same on React 18 and 19.
  return createElement(TAG_NAME, {
    ref,
    'publishable-key': props.publishableKey,
    'profile-id': props.profileId,
    'token-url': props.tokenUrl,
    'base-url': props.baseURL,
    'chat-title': props.title,
    greeting: props.greeting,
    placeholder: props.placeholder,
    position: props.position,
    open: props.open ? '' : undefined,
    connectors: props.connectors?.length ? props.connectors.join(',') : undefined,
    className: props.className,
    style: props.style,
  });
}
