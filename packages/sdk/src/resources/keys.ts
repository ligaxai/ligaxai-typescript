import type { APIPromise } from '../core/base-client.js';
import type { ApiKeyInfo } from '../types.js';
import { APIResource } from './resource.js';
import type { CallOptions } from './shared.js';

export class Keys extends APIResource {
  /**
   * `GET /keys/self` — the key you are calling with: scopes, allowed profiles, spend limit and what
   * remains. The cheapest way to prove a key works against a deployment.
   */
  self(options: CallOptions = {}): APIPromise<ApiKeyInfo> {
    return this._client.get<ApiKeyInfo>('/keys/self', options);
  }
}
