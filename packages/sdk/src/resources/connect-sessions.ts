import type { APIPromise } from '../core/base-client.js';
import type { ConnectSession, ConnectSessionCreateParams } from '../types.js';
import { APIResource } from './resource.js';
import { seg, type CallOptions, type MutationOptions } from './shared.js';

export interface ConnectSessionGetParams {
  /**
   * The end user the session was started for. A secret key must name it; a client token is its own
   * end user and may leave it out (naming another one answers `403 token_scope`).
   */
  endUserId?: string | undefined;
}

/**
 * Connect sessions: an end user connecting **their own** account (Gmail, Outlook, …) so a profile's
 * runs act with it. The profile must have "End users can connect their own accounts" switched on
 * (`409 end_user_connections_off` otherwise). In a browser, `connectAccount()` drives the whole
 * popup-and-poll flow for you.
 */
export class ConnectSessions extends APIResource {
  /**
   * `POST /connect_sessions` (scope `connections:write`) — start a connection. Open `connect_url`
   * in a popup: the provider's consent page, which closes itself when the user finishes. Then poll
   * `get()` until `status` leaves `pending`. A session can also come back `succeeded` at once (no
   * consent needed), with `connect_url: null` and the `connection_id` set.
   */
  create(
    body: ConnectSessionCreateParams,
    options: MutationOptions = {},
  ): APIPromise<ConnectSession> {
    return this._client.post<ConnectSession>('/connect_sessions', { ...options, body });
  }

  /**
   * `GET /connect_sessions/{id}` (scope `connections:read`) — how the session stands:
   * `pending | succeeded | denied | failed | expired`, with `connection_id` on success.
   */
  get(
    id: string,
    params: ConnectSessionGetParams = {},
    options: CallOptions = {},
  ): APIPromise<ConnectSession> {
    return this._client.get<ConnectSession>(`/connect_sessions/${seg(id)}`, {
      ...options,
      query: { end_user_id: params.endUserId },
    });
  }
}
