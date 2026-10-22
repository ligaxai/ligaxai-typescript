import { APIPromise } from '../core/base-client.js';
import { FileTooLargeError } from '../core/errors.js';
import type { FileDeleted, FileObject } from '../types.js';
import { APIResource } from './resource.js';
import { seg, type CallOptions, type MutationOptions } from './shared.js';

/** The API's per-file limit. Checked here too, so an oversized file is refused before it is sent. */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * What `files.create` uploads: a `Blob`/`File` (an `<input type="file">` pick, a `fetch` body read
 * with `.blob()`), or raw bytes with the name the agent should see.
 */
export type FileUpload =
  | Blob
  | {
      data: Uint8Array | ArrayBuffer;
      filename: string;
      /** Defaults to `application/octet-stream`; the model decides from it whether it can read the file. */
      contentType?: string | undefined;
    };

export interface FileCreateParams {
  /**
   * Secret keys only: the end user the file belongs to, so only that user's runs can attach it. A
   * client token always uploads for its own end user and may leave this out.
   */
  endUserId?: string | undefined;
}

/**
 * Files an agent reads in a run (scope `files:write`, which client tokens carry, so a browser can
 * upload its own user's documents). Upload with `create`, then pass the ids as `attachments` to
 * `runs.create`/`stream`/`wait`. Files are kept for 30 days; there is no download.
 */
export class Files extends APIResource {
  /**
   * `POST /files` — upload one file (≤ 25 MB) as `multipart/form-data`. A file over the limit is
   * refused with `FileTooLargeError` before any bytes are sent.
   */
  create(
    file: FileUpload,
    params: FileCreateParams = {},
    options: MutationOptions = {},
  ): APIPromise<FileObject> {
    const { blob, filename } = toBlob(file);
    if (blob.size > MAX_FILE_BYTES) {
      const error = new FileTooLargeError(blob.size, MAX_FILE_BYTES);
      // Still an `APIPromise`, so callers can chain `.withResponse()` uniformly; it just rejects.
      return new APIPromise<FileObject>(Promise.reject(error), () => Promise.reject(error));
    }
    const form = new FormData();
    if (filename === undefined) form.append('file', blob);
    else form.append('file', blob, filename);
    if (params.endUserId) form.append('end_user_id', params.endUserId);
    return this._client.post<FileObject>('/files', { ...options, body: form });
  }

  /** `GET /files/{id}` — a file's metadata: name, type, size, owner and when it expires. */
  get(id: string, options: CallOptions = {}): APIPromise<FileObject> {
    return this._client.get<FileObject>(`/files/${seg(id)}`, options);
  }

  /** `DELETE /files/{id}` — remove the file now rather than at its 30-day expiry. */
  delete(id: string, options: CallOptions = {}): APIPromise<FileDeleted> {
    return this._client.delete<FileDeleted>(`/files/${seg(id)}`, options);
  }
}

function toBlob(file: FileUpload): { blob: Blob; filename: string | undefined } {
  if (file instanceof Blob) {
    // A `File` carries its own name; a bare `Blob` gets the platform's default.
    const name = (file as Partial<File>).name;
    return { blob: file, filename: typeof name === 'string' && name ? name : undefined };
  }
  const blob = new File([file.data as BlobPart], file.filename, {
    type: file.contentType ?? 'application/octet-stream',
  });
  // `File` already carries `filename`; a third argument to `FormData.append` is only for bare blobs.
  return { blob, filename: undefined };
}
