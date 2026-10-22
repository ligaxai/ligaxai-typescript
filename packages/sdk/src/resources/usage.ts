import type { APIPromise } from '../core/base-client.js';
import type { Usage as UsageResponse, UsageGroupBy } from '../types.js';
import { APIResource } from './resource.js';
import type { CallOptions } from './shared.js';

export interface UsageGetParams {
  /** Start of the range (ISO date or `Date`). Default: 7 days before `end`. */
  start?: string | Date | undefined;
  /** End of the range (ISO date or `Date`). Default: now. At most 31 days after `start`. */
  end?: string | Date | undefined;
  /** Split each daily bucket by `profile`, `model` or `end_user`. */
  groupBy?: UsageGroupBy | undefined;
}

const iso = (value: string | Date | undefined): string | undefined =>
  value instanceof Date ? value.toISOString() : value;

export class Usage extends APIResource {
  /** `GET /usage` — this key's spend in daily buckets. */
  get(params: UsageGetParams = {}, options: CallOptions = {}): APIPromise<UsageResponse> {
    return this._client.get<UsageResponse>('/usage', {
      ...options,
      query: { start: iso(params.start), end: iso(params.end), group_by: params.groupBy },
    });
  }
}
