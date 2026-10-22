/**
 * Error hierarchy. Every failure the SDK raises extends `LigaXError`, so a caller can
 * `catch (e) { if (e instanceof LigaXError) ... }` without caring whether the cause was the
 * network, a timeout or the API. The HTTP subclasses mirror the OpenAI/Anthropic SDK shape so the
 * mental model transfers.
 */

import type { ConnectSession } from '../types.js';

export class LigaXError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The request never reached the API or no response came back (DNS, TLS, reset, aborted). */
export class APIConnectionError extends LigaXError {
  constructor(message = 'Connection error.', options?: ErrorOptions) {
    super(message, options);
  }
}

/** The request exceeded `timeout` (default 10 minutes). */
export class APITimeoutError extends APIConnectionError {
  constructor(message = 'Request timed out.', options?: ErrorOptions) {
    super(message, options);
  }
}

/**
 * The wire shape of an API error body. Everything is optional because a proxy or load balancer
 * in front of the API may answer with an empty or non-JSON body; the SDK still maps on status.
 */
export interface APIErrorBody {
  error?: {
    type?: string;
    code?: string;
    message?: string;
    request_id?: string;
    param?: string | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export class APIError extends LigaXError {
  readonly status: number;
  readonly headers: Headers;
  readonly body: unknown;
  /** The `X-Request-Id` the API attached, or the body's `request_id`. Quote it in support requests. */
  readonly request_id: string | undefined;
  readonly code: string | undefined;
  readonly type: string | undefined;
  readonly param: string | null | undefined;

  constructor(status: number, body: unknown, message: string | undefined, headers: Headers) {
    const err = (body as APIErrorBody | undefined)?.error;
    super(message ?? err?.message ?? APIError.describe(status, body));
    this.status = status;
    this.headers = headers;
    this.body = body;
    this.request_id = headers.get('x-request-id') ?? err?.request_id ?? undefined;
    this.code = err?.code;
    this.type = err?.type;
    this.param = err?.param;
  }

  /** camelCase alias of `request_id`. */
  get requestId(): string | undefined {
    return this.request_id;
  }

  private static describe(status: number, body: unknown): string {
    if (body == null) return `${status} status code (no body)`;
    try {
      return `${status} ${JSON.stringify(body)}`;
    } catch {
      return `${status} status code`;
    }
  }

  /** Pick the most specific subclass for a status. */
  static generate(
    status: number,
    body: unknown,
    message: string | undefined,
    headers: Headers,
  ): APIError {
    switch (status) {
      case 400:
        return new BadRequestError(status, body, message, headers);
      case 401:
        return new AuthenticationError(status, body, message, headers);
      case 402:
        return new PaymentRequiredError(status, body, message, headers);
      case 403:
        return new PermissionDeniedError(status, body, message, headers);
      case 404:
        return new NotFoundError(status, body, message, headers);
      case 409:
        return new ConflictError(status, body, message, headers);
      case 422:
        return new UnprocessableEntityError(status, body, message, headers);
      case 429:
        return new RateLimitError(status, body, message, headers);
      default:
        if (status >= 500) return new InternalServerError(status, body, message, headers);
        return new APIError(status, body, message, headers);
    }
  }
}

export class BadRequestError extends APIError {}
export class AuthenticationError extends APIError {}
/**
 * 402 — the key's spend limit is reached (`key_limit_reached`), the organisation is out of credits
 * (`insufficient_credits`) or has no plan (`payment_required`). Never retried: nothing changes until
 * the window resets or someone adds funds.
 */
export class PaymentRequiredError extends APIError {
  /** When the key's spend window resets (`X-Limit-Resets-At`), if the API said. */
  get resetsAt(): Date | undefined {
    const value = this.headers.get('x-limit-resets-at');
    const date = value ? new Date(value) : undefined;
    return date && !Number.isNaN(date.getTime()) ? date : undefined;
  }
}
export class PermissionDeniedError extends APIError {}
export class NotFoundError extends APIError {}
export class ConflictError extends APIError {}
export class UnprocessableEntityError extends APIError {}
export class RateLimitError extends APIError {}
export class InternalServerError extends APIError {}

/** Raised when the caller tries to use the SDK in a browser without opting in. */
export class BrowserEnvironmentError extends LigaXError {}

/** Raised by `@ligaxai/sdk/webhooks` when a signature does not verify. */
export class WebhookVerificationError extends LigaXError {}

/**
 * Raised by `connectAccount()` when the flow cannot finish: the browser blocked the popup, the user
 * closed it before finishing, or `timeoutMs` passed. `session` is the connect session as last seen
 * (absent when the popup was blocked before one was created). A `denied`/`failed`/`expired` session
 * is not an error — `connectAccount()` resolves with it.
 */
export class ConnectAccountError extends LigaXError {
  readonly reason: 'popup_blocked' | 'popup_closed' | 'timeout';
  readonly session: ConnectSession | undefined;

  constructor(reason: ConnectAccountError['reason'], message: string, session?: ConnectSession) {
    super(message);
    this.reason = reason;
    this.session = session;
  }
}
