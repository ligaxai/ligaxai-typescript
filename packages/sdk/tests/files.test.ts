import { afterEach, describe, expect, it, vi } from 'vitest';

import { LigaX, MAX_FILE_BYTES, type FileObject, type Run } from '../src/index.js';
import { FileTooLargeError, LigaXError, PermissionDeniedError } from '../src/errors.js';
import { json, scriptedFetch } from './helpers.js';

const silent = { error() {}, warn() {}, info() {}, debug() {} };
const BASE = 'https://enterprise.example/api/public/v1';
const FILE_ID = 'file_AAAAAAAAAAAAAAAAAAAAAAAA';
const PROFILE = 'prf_AAAAAAAAAAAAAAAAAAAA';

function client(fetch: ReturnType<typeof scriptedFetch>, apiKey = 'lgx_sk_test') {
  return new LigaX({ apiKey, baseURL: BASE, fetch, maxRetries: 2, logger: silent });
}

const stored: FileObject = {
  object: 'file',
  id: FILE_ID,
  filename: 'contract.pdf',
  content_type: 'application/pdf',
  size_bytes: 5,
  end_user_id: 'user_42',
  created_at: '2026-10-22T10:00:00.000Z',
  expires_at: '2026-11-21T10:00:00.000Z',
};

function formOf(call: { init: RequestInit }): FormData {
  const body = call.init.body;
  expect(body).toBeInstanceOf(FormData);
  return body as FormData;
}

/** Bun's FormData may append `;charset=utf-8` to text MIME types on round-trip. */
function mimeBase(type: string): string {
  return type.split(';')[0]!.trim().toLowerCase();
}

afterEach(() => vi.unstubAllGlobals());

describe('files', () => {
  it('create POSTs multipart /files with the file and end_user_id', async () => {
    const fetch = scriptedFetch([json(stored, { status: 201 })]);
    const file = new File(['%PDF-'], 'contract.pdf', { type: 'application/pdf' });

    const result = await client(fetch).files.create(file, { endUserId: 'user_42' });

    expect(result).toEqual(stored);
    const call = fetch.calls[0]!;
    expect(call.url).toBe(`${BASE}/files`);
    expect(call.init.method).toBe('POST');
    // fetch sets multipart/form-data with the boundary itself; a JSON content type would break it.
    expect(call.headers.get('content-type')).toBeNull();
    expect(call.headers.get('idempotency-key')).toMatch(/^[0-9a-f-]{36}$/);
    const form = formOf(call);
    const sent = form.get('file') as File;
    expect(sent.name).toBe('contract.pdf');
    expect(sent.type).toBe('application/pdf');
    expect(await sent.text()).toBe('%PDF-');
    expect(form.get('end_user_id')).toBe('user_42');
  });

  it('create accepts raw bytes with a filename and content type', async () => {
    const fetch = scriptedFetch([json(stored, { status: 201 })]);
    const data = new TextEncoder().encode('hello');

    await client(fetch).files.create({ data, filename: 'notes.txt', contentType: 'text/plain' });

    const form = formOf(fetch.calls[0]!);
    const sent = form.get('file') as File;
    expect(sent.name).toBe('notes.txt');
    expect(mimeBase(sent.type)).toBe('text/plain');
    expect(await sent.text()).toBe('hello');
    expect(form.has('end_user_id')).toBe(false);
  });

  it('create accepts an ArrayBuffer and defaults the content type', async () => {
    const fetch = scriptedFetch([json(stored, { status: 201 })]);
    const data = new TextEncoder().encode('bytes').buffer;

    await client(fetch).files.create({ data, filename: 'blob.bin' });

    const sent = formOf(fetch.calls[0]!).get('file') as File;
    expect(sent.type).toBe('application/octet-stream');
    expect(sent.size).toBe(5);
  });

  it('create refuses a file over 25 MB before sending anything', async () => {
    const fetch = scriptedFetch([]);
    const big = new Blob([new Uint8Array(MAX_FILE_BYTES + 1)]);

    const promise = client(fetch).files.create(big);

    await expect(promise).rejects.toBeInstanceOf(FileTooLargeError);
    await expect(promise).rejects.toBeInstanceOf(LigaXError);
    await expect(promise).rejects.toThrow(/limited to 25 MB/);
    expect(fetch.calls).toHaveLength(0);
  });

  it('create accepts a file of exactly 25 MB', async () => {
    const fetch = scriptedFetch([json(stored, { status: 201 })]);
    await client(fetch).files.create(new Blob([new Uint8Array(MAX_FILE_BYTES)]));
    expect(fetch.calls).toHaveLength(1);
  });

  it('create resends the same parts and Idempotency-Key on a retry', async () => {
    const fetch = scriptedFetch([
      json({ error: { type: 'api_error', code: 'x', message: 'x' } }, { status: 503 }),
      json(stored, { status: 201 }),
    ]);
    const file = new File(['abc'], 'a.txt', { type: 'text/plain' });

    await client(fetch).files.create(file);

    expect(fetch.calls).toHaveLength(2);
    const [first, second] = fetch.calls;
    expect(second!.headers.get('idempotency-key')).toBe(first!.headers.get('idempotency-key'));
    expect(await (formOf(second!).get('file') as File).text()).toBe('abc');
  });

  it('create works with a client token in a browser', async () => {
    vi.stubGlobal('window', {});
    vi.stubGlobal('document', {});
    vi.stubGlobal('navigator', {});
    const fetch = scriptedFetch([json(stored, { status: 201 })]);

    await client(fetch, 'lgx_ct_browser').files.create(new File(['x'], 'x.txt'));

    expect(fetch.calls[0]!.headers.get('authorization')).toBe('Bearer lgx_ct_browser');
  });

  it('get and delete address /files/{id}', async () => {
    const fetch = scriptedFetch([
      json(stored),
      json({ object: 'file', id: FILE_ID, deleted: true }),
    ]);
    const c = client(fetch);

    expect((await c.files.get(FILE_ID)).filename).toBe('contract.pdf');
    expect(await c.files.delete(FILE_ID)).toEqual({ object: 'file', id: FILE_ID, deleted: true });
    expect(fetch.calls.map((x) => [x.init.method, x.url])).toEqual([
      ['GET', `${BASE}/files/${FILE_ID}`],
      ['DELETE', `${BASE}/files/${FILE_ID}`],
    ]);
  });

  it('a token uploading for another user surfaces as PermissionDeniedError, not retried', async () => {
    const fetch = scriptedFetch([
      json(
        {
          error: {
            type: 'permission_error',
            code: 'token_scope',
            message: 'A client token uploads files for its own user only.',
            request_id: 'req_1',
            param: 'end_user_id',
          },
        },
        { status: 403 },
      ),
    ]);
    await expect(
      client(fetch).files.create(new File(['x'], 'x.txt'), { endUserId: 'someone_else' }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(fetch.calls).toHaveLength(1);
  });
});

describe('runs attachments', () => {
  const run = {
    object: 'run',
    id: 'run_AAAAAAAAAAAAAAAAAAAAAAAA',
    status: 'completed',
  } as unknown as Run;

  it('create, wait and stream pass attachments through in the body', async () => {
    const fetch = scriptedFetch([
      json(run),
      json(run),
      new Response('', { headers: { 'content-type': 'text/event-stream' } }),
    ]);
    const c = client(fetch);
    const body = { profile_id: PROFILE, input: 'Summarise it', attachments: [FILE_ID] };

    await c.runs.create(body);
    await c.runs.wait(body);
    await c.runs.stream(body).catch(() => undefined);

    for (const call of fetch.calls) {
      expect((call.body as { attachments: string[] }).attachments).toEqual([FILE_ID]);
      expect(call.headers.get('content-type')).toBe('application/json');
    }
  });
});
