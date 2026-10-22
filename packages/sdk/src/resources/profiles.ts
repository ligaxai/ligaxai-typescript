import type { APIPromise } from '../core/base-client.js';
import type { Profile, ProfileList } from '../types.js';
import { APIResource } from './resource.js';
import { seg, type CallOptions } from './shared.js';

export class Profiles extends APIResource {
  /** `GET /profiles` — the published agent profiles this key may run. */
  list(options: CallOptions = {}): APIPromise<ProfileList> {
    return this._client.get<ProfileList>('/profiles', options);
  }

  /** `GET /profiles/{profile_id}` — one profile: its models and connectors. */
  get(profileId: string, options: CallOptions = {}): APIPromise<Profile> {
    return this._client.get<Profile>(`/profiles/${seg(profileId)}`, options);
  }
}
