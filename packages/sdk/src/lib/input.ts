import type { RunInput } from '../types.js';

/** `body.input`, else the last user message's text parts (UIMessage) or string `content`. */
export function defaultInput(body: unknown): RunInput | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as { input?: unknown; messages?: unknown };
  if (typeof b.input === 'string' && b.input.length > 0) return b.input;
  if (
    b.input &&
    typeof b.input === 'object' &&
    typeof (b.input as { text?: unknown }).text === 'string'
  ) {
    return { text: (b.input as { text: string }).text };
  }
  if (!Array.isArray(b.messages)) return null;
  for (let i = b.messages.length - 1; i >= 0; i--) {
    const message = b.messages[i] as { role?: unknown; parts?: unknown; content?: unknown };
    if (message?.role !== 'user') continue;
    if (Array.isArray(message.parts)) {
      const text = message.parts
        .filter((part: { type?: unknown }) => part?.type === 'text')
        .map((part: { text?: unknown }) => (typeof part.text === 'string' ? part.text : ''))
        .join('');
      return text || null;
    }
    return typeof message.content === 'string' && message.content ? message.content : null;
  }
  return null;
}
