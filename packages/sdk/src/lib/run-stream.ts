import { LigaXError } from '../core/errors.js';
import type { Run } from '../types.js';
import { encodeRunEvent, parseRunEvent, readSSE, type RunEvent } from './lae.js';
import { TextAssembler } from './text-assembler.js';

/** `run.end`'s payload, plus the answer assembled from the stream. */
export interface RunStreamResult {
  /** The answer: text parts in `part.start` order, assembled by offset. */
  text: string;
  /** `run.end.payload.status` (`completed`, `failed`, `canceled`, …); `null` if no `run.end` came. */
  status: string | null;
  finishReason: string | null;
  usage: Record<string, unknown> | null;
  error: { code?: string; message?: string; [key: string]: unknown } | null;
  /** The last `interrupt.raised` payload, when the run stopped to ask something. */
  interrupt: Record<string, unknown> | null;
  /** The `run.end` event itself, for fields this summary does not lift out. */
  end: RunEvent | null;
}

interface Step {
  event: RunEvent;
  text: string;
}

/**
 * A live run, as typed `RunEvent`s. Iterate it once — with `for await`, `textStream()`,
 * `toReadableStream()` or `finalText()` — then read `finalText()` / `finalResult()` as often as you
 * like.
 *
 * ```ts
 * const stream = await client.runs.stream({ profile_id, input: 'Hi' });
 * for await (const text of stream.textStream()) process.stdout.write(text);
 * const { status, usage } = await stream.finalResult();
 * ```
 *
 * `abort()` (or the `signal` you passed) ends iteration quietly with the text received so far; an
 * early `break` out of a loop releases the connection the same way.
 */
export class RunStream implements AsyncIterable<RunEvent> {
  /** `X-Run-Id` — use it with `runs.get`, `runs.cancel`, `runs.followEvents`. */
  readonly runId: string | undefined;
  /** `X-Conversation-Id` — pass it as `conversation_id` to continue the conversation. */
  readonly conversationId: string | undefined;
  readonly requestId: string | undefined;
  readonly response: Response;
  readonly controller: AbortController;
  /**
   * Set when `POST /runs` answered with the run as JSON instead of a stream — an
   * `Idempotency-Key` replay of a run that already exists. The stream then replays that run's
   * answer as `part.start` / `text.delta` / `part.end` / `run.end`, so every consumer still works.
   */
  readonly replayedRun: Run | undefined;

  private readonly assembler = new TextAssembler();
  private claimed = false;
  private readonly done: Promise<void>;
  private settle!: (error?: unknown) => void;
  private endEvent: RunEvent | null = null;
  private interrupt: Record<string, unknown> | null = null;
  private readonly source: () => AsyncGenerator<RunEvent>;

  private constructor(
    response: Response,
    controller: AbortController,
    source: () => AsyncGenerator<RunEvent>,
    replayedRun: Run | undefined,
    runId: string | undefined,
  ) {
    this.response = response;
    this.controller = controller;
    this.source = source;
    this.replayedRun = replayedRun;
    this.runId = response.headers.get('x-run-id') ?? runId ?? replayedRun?.id ?? undefined;
    this.conversationId =
      response.headers.get('x-conversation-id') ?? replayedRun?.conversation_id ?? undefined;
    this.requestId = response.headers.get('x-request-id') ?? undefined;
    this.done = new Promise<void>((resolve, reject) => {
      this.settle = (error) => (error === undefined ? resolve() : reject(error));
    });
    // Nobody may ever await `done`; an unobserved rejection must not crash the process.
    this.done.catch(() => undefined);
  }

  /**
   * Wrap a `POST /runs` or `GET /runs/{id}/events?stream=true` response. `runId` is a fallback for
   * the follow endpoint, which does not echo `X-Run-Id`.
   */
  static async fromResponse(
    response: Response,
    controller: AbortController,
    runId?: string,
  ): Promise<RunStream> {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const run = (await response.json()) as Run;
      return new RunStream(response, controller, () => replay(run), run, runId);
    }
    if (!response.body) throw new LigaXError('The run stream response has no body.');
    const body = response.body;
    return new RunStream(
      response,
      controller,
      () => events(body, controller.signal),
      undefined,
      runId,
    );
  }

  [Symbol.asyncIterator](): AsyncIterator<RunEvent> {
    const steps = this.steps();
    return (async function* () {
      for await (const step of steps) yield step.event;
    })();
  }

  /** The answer's text as it arrives — only new, contiguous text; replays yield nothing. */
  textStream(): AsyncIterable<string> {
    const steps = this.steps();
    return (async function* () {
      for await (const step of steps) if (step.text) yield step.text;
    })();
  }

  /** The whole answer once the stream ends. Consumes the stream if nothing else has. */
  async finalText(): Promise<string> {
    return (await this.finalResult()).text;
  }

  /** The answer plus `run.end`'s status, finish reason, usage and error. */
  async finalResult(): Promise<RunStreamResult> {
    if (!this.claimed) {
      for await (const _ of this.steps()) void _;
    }
    await this.done;
    const end = this.endEvent;
    const p = end?.payload ?? {};
    return {
      text: this.assembler.text(),
      status: typeof p['status'] === 'string' ? p['status'] : null,
      finishReason: typeof p['finish_reason'] === 'string' ? p['finish_reason'] : null,
      usage: isObject(p['usage']) ? p['usage'] : null,
      error: isObject(p['error']) ? p['error'] : null,
      interrupt: this.interrupt,
      end,
    };
  }

  /**
   * The LAE stream as SSE bytes, for returning from your own route. Unread, the upstream body is
   * handed over byte-for-byte; a replayed run is re-encoded in the same frame shape.
   */
  toReadableStream(): ReadableStream<Uint8Array> {
    if (!this.replayedRun && this.response.body && !this.claimed) {
      this.claimed = true;
      this.settle();
      return this.response.body;
    }
    const encoder = new TextEncoder();
    const iterator = this[Symbol.asyncIterator]();
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(encoder.encode(encodeRunEvent(value)));
      },
      async cancel() {
        await iterator.return?.();
      },
    });
  }

  /** Abort the request. Iteration ends without an error. */
  abort(): void {
    this.controller.abort();
  }

  private async *steps(): AsyncGenerator<Step> {
    if (this.claimed) {
      throw new LigaXError(
        'This RunStream has already been consumed; iterate it once, then use finalText().',
      );
    }
    this.claimed = true;
    let finished = false;
    try {
      for await (const event of this.source()) {
        if (event.type === 'run.end') this.endEvent = event;
        else if (event.type === 'interrupt.raised') this.interrupt = event.payload;
        const text = this.assembler.apply(event);
        yield { event, text };
      }
      finished = true;
      this.settle();
    } catch (error) {
      // Our own abort (or the caller's signal) is a stop, not a failure.
      if (this.controller.signal.aborted) {
        finished = true;
        this.settle();
        return;
      }
      this.settle(error);
      throw error;
    } finally {
      if (!finished) {
        // The consumer broke out early: release the socket, keep what was read.
        this.controller.abort();
        this.settle();
      }
    }
  }
}

async function* events(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<RunEvent> {
  for await (const message of readSSE(body, signal)) {
    if (message.data === '[DONE]') return;
    const event = parseRunEvent(message);
    if (event) yield event;
  }
}

/** A run that came back as JSON, replayed as the minimal frames that carry its answer. */
async function* replay(run: Run): AsyncGenerator<RunEvent> {
  const partId = `${run.id}:replay:0`;
  const base = { seq: null, runId: run.id };
  if (run.output.text) {
    yield { ...base, type: 'part.start', payload: { part_id: partId, kind: 'text', ord: 0 } };
    yield {
      ...base,
      type: 'text.delta',
      payload: { part_id: partId, offset: 0, text: run.output.text },
    };
    yield { ...base, type: 'part.end', payload: { part_id: partId } };
  }
  if (run.required_action) {
    yield { ...base, type: 'interrupt.raised', payload: { ...run.required_action } };
  }
  if (run.status !== 'queued' && run.status !== 'running' && run.status !== 'requires_action') {
    yield {
      ...base,
      type: 'run.end',
      payload: {
        status: run.status,
        finish_reason: run.status === 'completed' ? 'stop' : run.status,
        ...(run.usage ? { usage: { ...run.usage } } : {}),
        ...(run.error ? { error: { ...run.error } } : {}),
      },
    };
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
