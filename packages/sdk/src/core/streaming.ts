import { EventSourceParserStream } from 'eventsource-parser/stream';

/**
 * A server-sent-event stream of JSON payloads, consumed with `for await`.
 *
 * Wire contract: each `data:` line is a JSON document; a literal `data: [DONE]` ends the stream.
 * The parser is `eventsource-parser`, which already handles chunk boundaries that split a line,
 * CRLF vs LF, comments and multi-line `data:` fields, so the SDK only decides what a complete
 * event means.
 */
export class Stream<T> implements AsyncIterable<T> {
  /** The most recent `id:` field seen, for a resume request after a disconnect. */
  lastEventId: string | undefined;
  /** The most recent `event:` name seen. */
  lastEventName: string | undefined;

  readonly controller: AbortController;
  private readonly iterator: () => AsyncIterator<T>;

  constructor(iterator: () => AsyncIterator<T>, controller: AbortController) {
    this.iterator = iterator;
    this.controller = controller;
  }

  /** Build a stream from a `fetch` Response whose body is `text/event-stream`. */
  static fromSSEResponse<T>(response: Response, controller: AbortController): Stream<T> {
    if (!response.body) {
      throw new Error('Attempted to iterate over a response with no body');
    }
    const body = response.body;
    const stream = new Stream<T>(() => iterate(), controller);

    async function* iterate(): AsyncGenerator<T> {
      const reader = body
        .pipeThrough(new TextDecoderStream())
        .pipeThrough(new EventSourceParserStream())
        .getReader();
      let done = false;
      try {
        for (;;) {
          const result = await reader.read();
          if (result.done) break;
          const event = result.value;
          if (event.id !== undefined) stream.lastEventId = event.id;
          if (event.event !== undefined) stream.lastEventName = event.event;
          if (event.data === '[DONE]') {
            done = true;
            break;
          }
          yield JSON.parse(event.data) as T;
        }
      } finally {
        // Consumer broke out early (or an error was thrown): release the socket.
        if (!done) controller.abort();
        reader.releaseLock();
      }
    }
    return stream;
  }

  /** Build a stream from an already-materialised async iterable (used by `tee` and tests). */
  static fromIterable<T>(
    iterable: AsyncIterable<T>,
    controller = new AbortController(),
  ): Stream<T> {
    return new Stream(() => iterable[Symbol.asyncIterator](), controller);
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this.iterator();
  }

  /** Abort the underlying request. Any pending `next()` rejects. */
  abort(): void {
    this.controller.abort();
  }

  /**
   * Split into two independent streams that both see every item. Items are buffered for the
   * slower side, so do not tee a stream you intend to leave half-read.
   */
  tee(): [Stream<T>, Stream<T>] {
    const left: Array<Promise<IteratorResult<T>>> = [];
    const right: Array<Promise<IteratorResult<T>>> = [];
    const source = this.iterator();

    const make = (mine: typeof left, other: typeof left): AsyncIterator<T> => ({
      next: () => {
        if (mine.length === 0) {
          const p = source.next();
          mine.push(p);
          other.push(p);
        }
        return mine.shift()!;
      },
    });

    return [
      new Stream(() => make(left, right), this.controller),
      new Stream(() => make(right, left), this.controller),
    ];
  }

  /** Collect every item (handy in tests; defeats the purpose in production). */
  async toArray(): Promise<T[]> {
    const out: T[] = [];
    for await (const item of this) out.push(item);
    return out;
  }
}
