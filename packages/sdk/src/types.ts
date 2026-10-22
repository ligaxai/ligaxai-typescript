/**
 * Named aliases over the generated types. **Aliases only** — every shape here is a path into
 * `generated/types.ts`, so a spec change flows through `pnpm gen:types` and nothing in this file can
 * drift from the contract. Field names are the wire's (snake_case) on purpose: the SDK passes bodies
 * through exactly as the API defines them, so the API reference and the types read the same.
 */
import type { components, operations } from './generated/types.js';

type JSONBody<Op extends keyof operations, Status extends number> = operations[Op] extends {
  responses: { [S in Status]: { content: { 'application/json': infer B } } };
}
  ? B
  : never;

type RequestBody<Op extends keyof operations> = operations[Op] extends {
  requestBody: { content: { 'application/json': infer B } };
}
  ? B
  : never;

/** A run: its status, the answer so far (`output.text`), what it is waiting on, usage. */
export type Run = components['schemas']['Run'];
export type RunStatus = components['schemas']['RunStatus'];
/** `run.required_action` when the run waits on an approval, a question or a form. */
export type RequiredAction = NonNullable<Run['required_action']>;
export type RunUsage = NonNullable<Run['usage']>;
export type RunOutput = Run['output'];

/** The body of `POST /runs`, exactly as the API takes it. */
export type RunCreateParams = RequestBody<'runs.create'>;
export type RunInput = RunCreateParams['input'];
export type RunMode = NonNullable<RunCreateParams['mode']>;
export type EndUser = NonNullable<RunCreateParams['end_user']>;

/** One recorded LAE frame from `GET /runs/{id}/events` (the JSON form). */
export type RunEventRecord = components['schemas']['RunEvent'];
export type RunEventList = JSONBody<'runs.events', 200>;

export type InterruptDecisionParams = RequestBody<'runs.resolveInterrupt'>;
export type InterruptDecision = InterruptDecisionParams['decision'];

export type Conversation = JSONBody<'conversations.get', 200>;

export type Profile = components['schemas']['Profile'];
export type ProfileList = JSONBody<'profiles.list', 200>;

/** `GET /keys/self` — the presented key, its scopes and what it may still spend. */
export type ApiKeyInfo = JSONBody<'keys.self', 200>;

export type Usage = JSONBody<'usage.get', 200>;
export type UsageGroupBy = NonNullable<Usage['group_by']>;

/** The API's error body. `param` names the offending field when there is one. */
export type ErrorBody = JSONBody<'runs.get', 401>;
export type ErrorType = ErrorBody['error']['type'];

/** Statuses after which a run will not change again. */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  'completed',
  'failed',
  'canceled',
  'expired',
];

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}
