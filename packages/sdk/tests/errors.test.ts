import { describe, expect, it } from 'vitest';

import {
  APIError,
  AuthenticationError,
  BadRequestError,
  BaseProjectError,
  ConflictError,
  InternalServerError,
  NotFoundError,
  PaymentRequiredError,
  PermissionDeniedError,
  RateLimitError,
  UnprocessableEntityError,
} from '../src/errors.js';

describe('APIError.generate', () => {
  const cases: Array<[number, typeof APIError]> = [
    [400, BadRequestError],
    [401, AuthenticationError],
    [402, PaymentRequiredError],
    [403, PermissionDeniedError],
    [404, NotFoundError],
    [409, ConflictError],
    [422, UnprocessableEntityError],
    [429, RateLimitError],
    [500, InternalServerError],
    [503, InternalServerError],
    [418, APIError],
  ];

  it.each(cases)('maps status %i', (status, Err) => {
    const err = APIError.generate(status, null, undefined, new Headers());
    expect(err).toBeInstanceOf(Err);
    expect(err).toBeInstanceOf(BaseProjectError);
    expect(err.status).toBe(status);
    expect(err.name).toBe(Err.name);
  });

  it('reads the structured error body', () => {
    const err = APIError.generate(
      422,
      {
        error: {
          type: 'invalid_request_error',
          code: 'missing_field',
          message: 'input is required',
          request_id: 'req_body',
          param: 'input',
        },
      },
      undefined,
      new Headers(),
    );
    expect(err.message).toBe('input is required');
    expect(err.type).toBe('invalid_request_error');
    expect(err.code).toBe('missing_field');
    expect(err.param).toBe('input');
    expect(err.request_id).toBe('req_body');
  });

  it('prefers the X-Request-Id header over the body', () => {
    const err = APIError.generate(
      500,
      { error: { request_id: 'req_body' } },
      undefined,
      new Headers({ 'x-request-id': 'req_header' }),
    );
    expect(err.request_id).toBe('req_header');
  });

  it('describes an empty or non-JSON body sensibly', () => {
    expect(APIError.generate(502, null, undefined, new Headers()).message).toBe(
      '502 status code (no body)',
    );
    expect(APIError.generate(502, 'Bad Gateway', undefined, new Headers()).message).toBe(
      '502 "Bad Gateway"',
    );
  });
});
