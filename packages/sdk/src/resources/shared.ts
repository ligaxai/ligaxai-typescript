import type { RequestOptions } from '../core/base-client.js';

/** Per-call options every resource method accepts: headers, signal, timeout, retries. */
export type CallOptions = Omit<
  RequestOptions,
  'method' | 'path' | 'body' | 'query' | 'stream' | 'idempotencyKey'
>;

/** Per-call options for a POST that creates something: `CallOptions` plus an idempotency key. */
export type MutationOptions = CallOptions & {
  /**
   * Sent as `Idempotency-Key`. Omit it and the SDK mints a UUID per call and reuses it across that
   * call's retries; pass your own to make a request safely re-sendable across process restarts.
   */
  idempotencyKey?: string | undefined;
};

/** A path segment, escaped: ids come from callers and must not change the path. */
export function seg(value: string): string {
  return encodeURIComponent(value);
}
