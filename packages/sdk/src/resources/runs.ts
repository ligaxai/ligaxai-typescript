import { sleep, type APIPromise } from '../core/base-client.js';
import { RunStream } from '../lib/run-stream.js';
import {
  isTerminalStatus,
  type InterruptDecisionParams,
  type Run,
  type RunCreateParams,
  type RunEventList,
} from '../types.js';
import { APIResource } from './resource.js';
import { seg, type CallOptions, type MutationOptions } from './shared.js';

/** `POST /runs` body for `create`: `mode` is `wait` (default) or `async`; use `stream()` to stream. */
export type RunCreateBody = Omit<RunCreateParams, 'mode'> & { mode?: 'wait' | 'async' | undefined };
/** `POST /runs` body for `stream` and `wait`: the SDK sets `mode`. */
export type RunBody = Omit<RunCreateParams, 'mode'>;

export interface RunWaitOptions extends MutationOptions {
  /** First poll delay after a `202`, in ms. Default 1000. Doubles per poll. */
  pollIntervalMs?: number | undefined;
  /** Ceiling for the poll delay, in ms. Default 8000. */
  maxPollIntervalMs?: number | undefined;
}

export interface RunEventsParams {
  /** Only events with `seq` greater than this. Default 0 (from the start). */
  after?: number | undefined;
}

export class Runs extends APIResource {
  /**
   * `POST /runs` — run an agent profile. With `mode: "wait"` (default) this resolves with the
   * finished run, or — if it is still going after the API's 240 s budget — the run so far
   * (`status: "running"`); `runs.wait()` keeps polling for you. `mode: "async"` returns at once.
   */
  create(body: RunCreateBody, options: MutationOptions = {}): APIPromise<Run> {
    return this._client.post<Run>('/runs', {
      ...options,
      body: { ...body, mode: body.mode ?? 'wait' },
    });
  }

  /**
   * `POST /runs` with `mode: "stream"` — the run's LAE events as they happen. Resolves once the
   * API has accepted the run (errors such as 402 or 404 reject here), with `runId` and
   * `conversationId` already known.
   */
  async stream(body: RunBody, options: MutationOptions = {}): Promise<RunStream> {
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;
    const response = await this._client
      .post<unknown>('/runs', {
        ...options,
        signal,
        stream: true,
        body: { ...body, mode: 'stream' },
      })
      .asResponse();
    return RunStream.fromResponse(response, controller);
  }

  /**
   * Run to completion: `create` in `wait` mode, then — if the API answered with the run still going
   * — poll `get` with backoff until it is terminal or `requires_action`.
   */
  async wait(body: RunBody, options: RunWaitOptions = {}): Promise<Run> {
    const { pollIntervalMs = 1000, maxPollIntervalMs = 8000, ...rest } = options;
    let run = await this.create({ ...body, mode: 'wait' }, rest);
    const { idempotencyKey: _ignored, ...readOptions } = rest;
    let delay = pollIntervalMs;
    while (!isTerminalStatus(run.status) && run.status !== 'requires_action') {
      await sleep(delay, rest.signal);
      delay = Math.min(delay * 2, maxPollIntervalMs);
      run = await this.get(run.id, readOptions);
    }
    return run;
  }

  /** `GET /runs/{run_id}` — the run as it stands: status, output so far, what it waits on. */
  get(runId: string, options: CallOptions = {}): APIPromise<Run> {
    return this._client.get<Run>(`/runs/${seg(runId)}`, options);
  }

  /** `GET /runs/{run_id}/events` — the run's recorded LAE frames after `after`, as JSON. */
  events(
    runId: string,
    params: RunEventsParams = {},
    options: CallOptions = {},
  ): APIPromise<RunEventList> {
    return this._client.get<RunEventList>(`/runs/${seg(runId)}/events`, {
      ...options,
      query: { after: params.after },
    });
  }

  /**
   * `GET /runs/{run_id}/events?stream=true` — the live event stream from after `after`. Resume a
   * dropped `runs.stream()` with the last `seq` you saw; replayed frames are harmless because text
   * is assembled by offset.
   */
  async followEvents(
    runId: string,
    params: RunEventsParams = {},
    options: CallOptions = {},
  ): Promise<RunStream> {
    const controller = new AbortController();
    const signal = options.signal
      ? AbortSignal.any([controller.signal, options.signal])
      : controller.signal;
    const response = await this._client
      .get<unknown>(`/runs/${seg(runId)}/events`, {
        ...options,
        signal,
        stream: true,
        query: { after: params.after, stream: 'true' },
      })
      .asResponse();
    return RunStream.fromResponse(response, controller, runId);
  }

  /** `POST /runs/{run_id}/cancel` — stop the run. A run that already ended is returned as is. */
  cancel(runId: string, options: MutationOptions = {}): APIPromise<Run> {
    return this._client.post<Run>(`/runs/${seg(runId)}/cancel`, options);
  }

  /**
   * `POST /runs/{run_id}/interrupts/{interrupt_id}` — answer what the run is waiting on
   * (`run.required_action`): `approve`, `reject`, or `answer` with a `payload` for a form or choice.
   */
  resolveInterrupt(
    runId: string,
    interruptId: string,
    body: InterruptDecisionParams,
    options: MutationOptions = {},
  ): APIPromise<Run> {
    return this._client.post<Run>(`/runs/${seg(runId)}/interrupts/${seg(interruptId)}`, {
      ...options,
      body,
    });
  }
}
