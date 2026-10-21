import type { APIPromise, RequestOptions } from '../core/base-client.js';
import type { HealthResponse } from '../generated/types.js';
import { APIResource } from './resource.js';

export type { HealthResponse };

/**
 * The one example resource. Copy this file for a real resource: one method per endpoint,
 * request/response types imported from `generated/types.ts`, no logic beyond the path.
 */
export class Health extends APIResource {
  /** `GET /health` — liveness of the API and the version it is serving. */
  get(options: Omit<RequestOptions, 'method' | 'path' | 'body'> = {}): APIPromise<HealthResponse> {
    return this._client.get<HealthResponse>('/health', options);
  }
}
