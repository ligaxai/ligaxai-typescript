import { WebhookVerificationError } from './core/errors.js';
import type { WebhookEvent } from './types.js';

export { WebhookVerificationError };
export type {
  ApiKeyLimitWebhookEvent,
  ConnectionCreatedWebhookEvent,
  ConnectionDeletedWebhookEvent,
  ConnectionWebhookEvent,
  RunWebhookEvent,
  WebhookEvent,
  WebhookEventType,
  WebhookTestEvent,
} from './types.js';

/**
 * Standard Webhooks (https://www.standardwebhooks.com) verification with WebCrypto, so it runs
 * unchanged in Node, Bun, Deno, workerd and the browser. ~40 lines instead of a dependency; the
 * header names and signing scheme are the standard's, so the official `standardwebhooks`
 * package is a drop-in replacement if you prefer it.
 *
 * Signed payload: `${webhook-id}.${webhook-timestamp}.${raw body}`; HMAC-SHA256 with the
 * base64-decoded secret (`whsec_` prefix stripped); `webhook-signature` carries one or more
 * space-separated `v1,<base64>` entries so a secret can be rotated without a gap.
 */

export const DEFAULT_TOLERANCE_SECONDS = 5 * 60;

export interface WebhookHeaders {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
}

export interface VerifyOptions {
  /** Reject timestamps further than this from now (replay protection). Default 300 s. */
  toleranceSeconds?: number | undefined;
  /** Override "now" in tests, in seconds since the epoch. */
  now?: number | undefined;
}

export class Webhook {
  private readonly keyPromise: Promise<CryptoKey>;

  constructor(secret: string) {
    const raw =
      typeof secret === 'string' && secret.startsWith('whsec_')
        ? secret.slice('whsec_'.length)
        : secret;
    // Checked here, synchronously: a missing secret (an unset env var) must fail at startup, not
    // as an unhandled rejection from a key import nobody awaited yet.
    if (typeof raw !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw) || raw.length < 24) {
      throw new WebhookVerificationError(
        'Invalid webhook secret: pass the endpoint’s signing secret (whsec_…).',
      );
    }
    this.keyPromise = crypto.subtle.importKey(
      'raw',
      base64Decode(raw),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    // Never leave a rejection unobserved before the first verify() awaits it.
    this.keyPromise.catch(() => undefined);
  }

  /**
   * Resolve to the parsed JSON body on success; throw `WebhookVerificationError` otherwise. The body
   * is typed as `WebhookEvent` (switch on `type`); the type parameter is a cast, not a check, and
   * exists for receivers that verify something other than a LigaX event with this class.
   */
  async verify<T = WebhookEvent>(
    payload: string | Uint8Array,
    headers: WebhookHeaders | Headers | Record<string, string | undefined>,
    options: VerifyOptions = {},
  ): Promise<T> {
    const get = (name: keyof WebhookHeaders): string => {
      const value = headers instanceof Headers ? headers.get(name) : headers[name];
      if (!value) throw new WebhookVerificationError(`Missing required header: ${name}`);
      return value;
    };
    const id = get('webhook-id');
    const timestamp = get('webhook-timestamp');
    const signatureHeader = get('webhook-signature');

    verifyTimestamp(timestamp, options);

    const body = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
    const expected = await this.sign(id, timestamp, body);

    const candidates = signatureHeader
      .split(' ')
      .map((entry) => entry.split(',', 2))
      .filter(([version]) => version === 'v1')
      .map(([, sig]) => sig ?? '');

    if (!candidates.some((candidate) => constantTimeEqual(candidate, expected))) {
      throw new WebhookVerificationError('No matching signature found');
    }
    return JSON.parse(body) as T;
  }

  /** Produce the `v1,<base64>` value for a payload — useful for tests and for emitting webhooks. */
  async sign(id: string, timestamp: string | number, body: string): Promise<string> {
    const key = await this.keyPromise;
    const data = new TextEncoder().encode(`${id}.${timestamp}.${body}`);
    const mac = await crypto.subtle.sign('HMAC', key, data);
    return base64Encode(new Uint8Array(mac));
  }
}

function verifyTimestamp(raw: string, options: VerifyOptions): void {
  // Whole seconds only, as the Standard Webhooks spec writes them — not `1e9`, `0x…` or `  12 `.
  const timestamp = /^\d{1,12}$/.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isFinite(timestamp)) {
    throw new WebhookVerificationError('Invalid signature headers: bad timestamp');
  }
  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (now - timestamp > tolerance) throw new WebhookVerificationError('Message timestamp too old');
  if (timestamp > now + tolerance) throw new WebhookVerificationError('Message timestamp too new');
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64Decode(value: string): Uint8Array<ArrayBuffer> {
  const bin = atob(value);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64Encode(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
