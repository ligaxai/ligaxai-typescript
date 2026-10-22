import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { LigaX } from '../src/index.js';
import * as errors from '../src/errors.js';
import { Stream } from '../src/core/streaming.js';
import { RunStream } from '../src/lib/run-stream.js';
import { chunkedBody, scriptedFetch } from './helpers.js';

/**
 * Runs the language-neutral fixtures in `conformance/` (see its README). The same files are fed
 * to the Python SDK's pytest runner; a case one SDK cannot pass is a spec bug, not an SDK quirk.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..', 'conformance');
const BASE_URL = 'https://conformance.example/v1';

interface Case {
  name: string;
  request: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  };
  response: { status: number; headers?: Record<string, string>; body?: unknown };
  expect: {
    call: string;
    args?: unknown[];
    result?: unknown;
    error?: { class: string; status?: number; code?: string };
  };
}

function loadCases(): Case[] {
  const dir = join(ROOT, 'cases');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Case);
}

function resolveCall(client: LigaX, dotted: string): (...args: unknown[]) => unknown {
  const parts = dotted.split('.');
  let target: unknown = client;
  let parent: unknown = client;
  for (const part of parts) {
    parent = target;
    target = (target as Record<string, unknown>)[part];
  }
  if (typeof target !== 'function') throw new Error(`conformance: ${dotted} is not a method`);
  return (target as (...a: unknown[]) => unknown).bind(parent);
}

describe('conformance cases', () => {
  const cases = loadCases();

  it.each(cases.map((c) => [c.name, c] as const))('%s', async (_name, c) => {
    const fetch = scriptedFetch([
      () =>
        new Response(c.response.body === undefined ? null : JSON.stringify(c.response.body), {
          status: c.response.status,
          headers: c.response.headers ?? {},
        }),
    ]);
    const client = new LigaX({
      apiKey: 'sk_conformance',
      baseURL: BASE_URL,
      fetch,
      maxRetries: 0,
      logLevel: 'off',
    });

    const call = resolveCall(client, c.expect.call);
    const outcome = await Promise.resolve()
      .then(() => call(...(c.expect.args ?? [])))
      .then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );

    // Request assertions: method, path, header subset (wildcard `*`), JSON body.
    const sent = fetch.calls[0];
    expect(sent, 'the SDK made a request').toBeDefined();
    expect(sent!.init.method).toBe(c.request.method);
    expect(new URL(sent!.url).pathname).toBe(
      new URL(c.request.path.replace(/^\//, ''), `${BASE_URL}/`).pathname,
    );
    for (const [name, want] of Object.entries(c.request.headers ?? {})) {
      const got = sent!.headers.get(name);
      if (want.endsWith('*')) expect(got?.startsWith(want.slice(0, -1))).toBe(true);
      else expect(got).toBe(want);
    }
    if (c.request.body !== undefined && c.request.body !== null)
      expect(sent!.body).toEqual(c.request.body);

    // Outcome assertions.
    if (c.expect.error) {
      expect('error' in outcome, 'expected an error').toBe(true);
      const err = (outcome as { error: unknown }).error;
      const Cls = (errors as Record<string, unknown>)[c.expect.error.class];
      expect(Cls, `unknown error class ${c.expect.error.class}`).toBeTypeOf('function');
      expect(err).toBeInstanceOf(Cls as new () => unknown);
      if (c.expect.error.status !== undefined)
        expect((err as errors.APIError).status).toBe(c.expect.error.status);
      if (c.expect.error.code !== undefined)
        expect((err as errors.APIError).code).toBe(c.expect.error.code);
    } else {
      expect(
        'result' in outcome,
        `expected a result, got ${String((outcome as { error?: unknown }).error)}`,
      ).toBe(true);
      expect((outcome as { result: unknown }).result).toEqual(c.expect.result);
    }
  });
});

describe('conformance SSE transcripts', () => {
  const dir = join(ROOT, 'sse');
  const transcripts = readdirSync(dir)
    .filter((f) => f.endsWith('.txt'))
    .sort();

  it.each(transcripts)('%s', async (file) => {
    const text = readFileSync(join(dir, file), 'utf8');
    // Re-chunk at awkward boundaries so the parser, not the fixture author, handles splitting.
    const pieces = text.match(/[\s\S]{1,7}/g) ?? [];
    const response = new Response(chunkedBody(pieces), {
      headers: { 'content-type': 'text/event-stream' },
    });

    // `lae-*.txt` are LAE run streams: parsed into RunEvents, text assembled by offset.
    if (file.startsWith('lae-')) {
      const expected = JSON.parse(
        readFileSync(join(dir, file.replace(/\.txt$/, '.expected.json')), 'utf8'),
      ) as { events: unknown[]; text: string; status?: string };
      const run = await RunStream.fromResponse(response, new AbortController());
      const events: unknown[] = [];
      for await (const event of run) events.push(event);
      expect(events).toEqual(expected.events);
      const result = await run.finalResult();
      expect(result.text).toBe(expected.text);
      if (expected.status !== undefined) expect(result.status).toBe(expected.status);
      return;
    }
    const stream = Stream.fromSSEResponse<unknown>(response, new AbortController());
    const events = await stream.toArray();

    const expectedPath = join(dir, file.replace(/\.txt$/, '.expected.json'));
    if (existsSync(expectedPath)) {
      const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as {
        events: unknown[];
        lastEventId?: string;
      };
      expect(events).toEqual(expected.events);
      if (expected.lastEventId !== undefined) expect(stream.lastEventId).toBe(expected.lastEventId);
    } else {
      expect(events.length).toBeGreaterThan(0);
    }
  });
});
