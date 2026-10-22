import type { BaseClient } from '../core/base-client.js';

/**
 * Every resource group (`client.runs`, `client.profiles`, ...) extends this and reaches the
 * request pipeline through `this._client`. Keeping the client on a protected field means a
 * resource method body is just the path and the type.
 */
export class APIResource {
  protected readonly _client: BaseClient;

  constructor(client: BaseClient) {
    this._client = client;
  }
}
