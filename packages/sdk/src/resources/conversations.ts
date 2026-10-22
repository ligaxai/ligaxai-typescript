import type { APIPromise } from '../core/base-client.js';
import type { Conversation } from '../types.js';
import { APIResource } from './resource.js';
import { seg, type CallOptions } from './shared.js';

export interface ConversationGetParams {
  /**
   * The end user the conversation was started for. Required to read a conversation that has one —
   * a conversation is only readable by naming its end user.
   */
  endUserId?: string | undefined;
}

export class Conversations extends APIResource {
  /** `GET /conversations/{conversation_id}` — the conversation and its runs, oldest first. */
  get(
    conversationId: string,
    params: ConversationGetParams = {},
    options: CallOptions = {},
  ): APIPromise<Conversation> {
    return this._client.get<Conversation>(`/conversations/${seg(conversationId)}`, {
      ...options,
      query: { end_user_id: params.endUserId },
    });
  }
}
