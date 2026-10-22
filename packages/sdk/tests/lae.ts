/** Test helpers for LAE (LigaX Agent Events) SSE transcripts. */

export interface Frame {
  type: string;
  seq?: number | null;
  payload?: Record<string, unknown>;
}

const RUN_ID = 'run_test_1';

/** One frame on the wire, exactly as the platform passes the engine's frame through. */
export function frame({ type, seq = null, payload = {} }: Frame, runId = RUN_ID): string {
  const body = { v: 1, type, seq, ts: '2026-10-22T10:00:00.000Z', run: { id: runId }, payload };
  return `event: ${type}\ndata: ${JSON.stringify(body)}\n\n`;
}

/** A small but complete run: ready, a text part in two deltas, a tool call, run.end. */
export function simpleRun(text = 'Hello world'): string {
  const half = Math.floor(text.length / 2);
  return [
    frame({ type: 'stream.ready', payload: {} }),
    frame({ type: 'run.start', seq: 1, payload: { mode: 'chat' } }),
    frame({
      type: 'tool.start',
      seq: 2,
      payload: { tool_call_id: 'call_1', name: 'search', kind: 'connector' },
    }),
    frame({
      type: 'tool.end',
      seq: 3,
      payload: { tool_call_id: 'call_1', status: 'ok', duration_ms: 12, result_preview: '3 hits' },
    }),
    frame({ type: 'part.start', seq: 4, payload: { part_id: 'p0', kind: 'text', ord: 0 } }),
    frame({
      type: 'text.delta',
      seq: 5,
      payload: { part_id: 'p0', offset: 0, text: text.slice(0, half) },
    }),
    frame({
      type: 'text.delta',
      seq: 6,
      payload: { part_id: 'p0', offset: half, text: text.slice(half) },
    }),
    frame({ type: 'part.end', seq: 7, payload: { part_id: 'p0' } }),
    frame({
      type: 'run.end',
      seq: 8,
      payload: {
        status: 'completed',
        finish_reason: 'stop',
        usage: { tokens: { input: 3, output: 2 } },
      },
    }),
  ].join('');
}

export function laeResponse(
  body: string | ReadableStream<Uint8Array>,
  headers: Record<string, string> = {},
): Response {
  return new Response(body, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'x-run-id': RUN_ID,
      'x-conversation-id': 'conv_CCCCCCCCCCCCCCCCCCCCCCCC',
      'x-request-id': 'req_stream_1',
      ...headers,
    },
  });
}
