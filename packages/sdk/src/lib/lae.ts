import { createParser, type EventSourceMessage } from 'eventsource-parser';

/**
 * The LAE (LigaX Agent Events) wire, as `POST /runs` with `mode: "stream"` and
 * `GET /runs/{id}/events?stream=true` deliver it. The platform passes the engine's frames through
 * untouched:
 *
 *   event: text.delta
 *   data: {"v":1,"type":"text.delta","seq":12,"ts":"…","run":{"id":"…"},"payload":{…}}
 *
 * `seq` is a number for every durable frame and `null` for the transient `stream.*` control frames
 * (`stream.ready`, `stream.heartbeat`, …). Unknown event types are passed on, not rejected: the
 * protocol grows by adding events, and a client that throws on a new one breaks on a server deploy.
 */

/** One LAE event, parsed. `payload` is the event's own object; see the protocol for each type. */
export interface RunEvent {
  type: string;
  /** Position in the run's durable log; `null` on `stream.*` control frames. */
  seq: number | null;
  payload: Record<string, unknown>;
  /** The run the frame belongs to, when the frame says. */
  runId?: string;
  /** When the engine wrote the frame (ISO 8601), when present. */
  ts?: string;
}

/**
 * Bytes → SSE messages. Uses `eventsource-parser` (chunk boundaries, CRLF, comments, multi-line
 * `data:`) and, unlike its stream wrapper, flushes a final event the producer did not terminate with
 * a blank line — a connection that closes straight after the last `data:` line is normal, and
 * dropping it would lose `run.end` from a finished run.
 */
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<EventSourceMessage> {
  const queue: EventSourceMessage[] = [];
  const parser = createParser({ onEvent: (message) => queue.push(message) });
  const reader = body.getReader();
  const decoder = new TextDecoder();
  // Cancelling the reader settles a pending `read()` at once; waiting for the transport to notice
  // the abort can take as long as the next byte does.
  const onAbort = () => void reader.cancel().catch(() => undefined);
  if (signal?.aborted) onAbort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        // A blank line dispatches whatever is buffered; with nothing buffered it is a no-op.
        // (`reset({ consume: true })` parses a pending line but does not dispatch the event.)
        parser.feed(`${decoder.decode()}\n\n`);
      } else {
        parser.feed(decoder.decode(value, { stream: true }));
      }
      while (queue.length > 0) yield queue.shift()!;
      if (done) return;
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
}

/** An SSE message → a `RunEvent`, or `null` for anything that is not a JSON frame. */
export function parseRunEvent(message: EventSourceMessage): RunEvent | null {
  if (!message.data || message.data === '[DONE]') return null;
  let frame: unknown;
  try {
    frame = JSON.parse(message.data);
  } catch {
    return null;
  }
  if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return null;
  const f = frame as Record<string, unknown>;
  const type = typeof f['type'] === 'string' ? f['type'] : message.event;
  if (!type) return null;
  const payload =
    f['payload'] && typeof f['payload'] === 'object' && !Array.isArray(f['payload'])
      ? (f['payload'] as Record<string, unknown>)
      : {};
  const event: RunEvent = { type, seq: typeof f['seq'] === 'number' ? f['seq'] : null, payload };
  const run = f['run'] as { id?: unknown } | undefined;
  const runId =
    run && typeof run === 'object' && typeof run.id === 'string'
      ? run.id
      : typeof f['run_id'] === 'string'
        ? f['run_id']
        : undefined;
  if (runId !== undefined) event.runId = runId;
  if (typeof f['ts'] === 'string') event.ts = f['ts'];
  return event;
}

/** A `RunEvent` back onto the wire, in the frame shape the platform sends. */
export function encodeRunEvent(event: RunEvent): string {
  const frame = {
    v: 1,
    type: event.type,
    seq: event.seq,
    ...(event.ts !== undefined ? { ts: event.ts } : {}),
    ...(event.runId !== undefined ? { run: { id: event.runId } } : {}),
    payload: event.payload,
  };
  return `event: ${event.type}\ndata: ${JSON.stringify(frame)}\n\n`;
}
