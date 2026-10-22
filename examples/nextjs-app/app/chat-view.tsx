'use client';

import { useState } from 'react';
import type { UseChatHelpers } from '@ligaxai/react';
import type { UIMessage } from 'ai';

/** The chat UI both pages share; only where the transport sends the run differs. */
export function ChatView({ title, chat }: { title: string; chat: UseChatHelpers<UIMessage> }) {
  const { messages, sendMessage, status, stop, error } = chat;
  const [input, setInput] = useState('');
  const busy = status === 'submitted' || status === 'streaming';

  return (
    <main style={{ maxWidth: 720 }}>
      <h1>{title}</h1>
      <div aria-live="polite">
        {messages.map((message) => (
          <div key={message.id} style={{ margin: '0.75rem 0' }}>
            <strong>{message.role === 'user' ? 'You' : 'Agent'}</strong>
            {message.parts.map((part, i) => {
              if (part.type === 'text') {
                return (
                  <p key={i} style={{ whiteSpace: 'pre-wrap', margin: '0.25rem 0' }}>
                    {part.text}
                  </p>
                );
              }
              if (part.type === 'dynamic-tool') {
                return (
                  <p key={i} style={{ color: '#6b7280', margin: '0.25rem 0' }}>
                    Tool {part.toolName}: {part.state}
                  </p>
                );
              }
              return null;
            })}
          </div>
        ))}
      </div>
      {error ? <p style={{ color: '#b91c1c' }}>{error.message}</p> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!input.trim()) return;
          void sendMessage({ text: input });
          setInput('');
        }}
        style={{ display: 'flex', gap: '0.5rem' }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Ask the agent…"
          style={{ flex: 1, padding: '0.5rem' }}
        />
        {busy ? (
          <button type="button" onClick={() => void stop()}>
            Stop
          </button>
        ) : (
          <button type="submit">Send</button>
        )}
      </form>
    </main>
  );
}
