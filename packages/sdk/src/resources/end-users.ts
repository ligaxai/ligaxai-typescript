import type { APIPromise } from '../core/base-client.js';
import type { EndUserConnectionDeleted, EndUserConnectionList } from '../types.js';
import { APIResource } from './resource.js';
import { seg, type CallOptions } from './shared.js';

/**
 * The accounts an end user connected themselves — never the workspace's shared connections, even
 * those the user reaches through a profile's fallback. A client token may only name its own end
 * user (`403 token_scope` otherwise).
 */
export class EndUserConnections extends APIResource {
  /** `GET /end_users/{end_user_id}/connections` (scope `connections:read`). */
  list(endUserId: string, options: CallOptions = {}): APIPromise<EndUserConnectionList> {
    return this._client.get<EndUserConnectionList>(
      `/end_users/${seg(endUserId)}/connections`,
      options,
    );
  }

  /**
   * `DELETE /end_users/{end_user_id}/connections/{connection_id}` (scope `connections:write`) —
   * disconnect one of the end user's own accounts; webhook subscribers get `connection.deleted`.
   */
  delete(
    endUserId: string,
    connectionId: string,
    options: CallOptions = {},
  ): APIPromise<EndUserConnectionDeleted> {
    return this._client.delete<EndUserConnectionDeleted>(
      `/end_users/${seg(endUserId)}/connections/${seg(connectionId)}`,
      options,
    );
  }
}

/** `client.endUsers` — what the API keeps per end user of yours. Today: their own connections. */
export class EndUsers extends APIResource {
  readonly connections: EndUserConnections = new EndUserConnections(this._client);
}
