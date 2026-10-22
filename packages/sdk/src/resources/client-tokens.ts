import type { APIPromise } from '../core/base-client.js';
import type { ClientToken, ClientTokenCreateParams } from '../types.js';
import { APIResource } from './resource.js';
import type { MutationOptions } from './shared.js';

export class ClientTokens extends APIResource {
  /**
   * `POST /client_tokens` — mint a short-lived token (`lgx_ct_…`, 60–3600 s, default 600) that one
   * browser may use to run one profile as one end user. **Server only**: it needs a secret key with
   * the `client_tokens:write` scope. Hand `token` to that user's browser and nothing else; the body
   * a browser sends with it can repeat the profile, end user and conversation but never change them.
   */
  create(body: ClientTokenCreateParams, options: MutationOptions = {}): APIPromise<ClientToken> {
    return this._client.post<ClientToken>('/client_tokens', { ...options, body });
  }
}
