import { Elysia } from 'elysia';
import { LISTING_IMAGE_CONSTRAINTS } from '@lostly/contracts/listings';
import { ImageUploadBodyError } from '@/image-upload/errors';
import { readBoundedRequestBody } from '@/image-upload/read-body';

export const LEGACY_REQUEST_MAX_BYTES = LISTING_IMAGE_CONSTRAINTS.maxSizeBytes + 64 * 1024;
const originals = new WeakMap<Request, Request>();

// Bun's requestIP/timeout APIs require the original native request, not its buffered replacement.
export function nativeRequest(request: Request) {
  return originals.get(request) ?? request;
}

export function mediaType(request: Request) {
  return request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
}

export function isConversationMultipart(request: Request) {
  return (
    request.method === 'POST' &&
    /^\/conversations\/[^/]+\/messages\/?$/.test(new URL(request.url).pathname) &&
    mediaType(request) === 'multipart/form-data'
  );
}

function hasUploadReader(request: Request) {
  return (
    isConversationMultipart(request) ||
    (request.method === 'POST' &&
      /^\/listings\/[^/]+\/images\/?$/.test(new URL(request.url).pathname))
  );
}

// Buffer bytes only. Elysia still owns the existing JSON/form/text decoding, validation and errors.
// Upload routes own their bounded reads so this hook never reads ahead of their admission.
export const legacyBodyLimit = new Elysia({ name: 'legacy-body-limit' }).onRequest(
  async (context) => {
    const request = context.request;
    if (hasUploadReader(request) || !request.body) return;
    try {
      if (Number(request.headers.get('content-length')) > LEGACY_REQUEST_MAX_BYTES) {
        void request.body.cancel().catch(() => {});
        throw new ImageUploadBodyError('body-too-large');
      }
      const body = await readBoundedRequestBody(request, { maxBytes: LEGACY_REQUEST_MAX_BYTES });
      const replacement = new Request(request.url, {
        method: request.method,
        headers: request.headers,
        signal: request.signal,
        body: request.method === 'GET' || request.method === 'HEAD' ? undefined : body,
      });
      originals.set(replacement, request);
      context.request = replacement;
    } catch (error) {
      if (!(error instanceof ImageUploadBodyError)) throw error;
      context.set.headers['Cache-Control'] = 'private, no-store';
      return context.status(error.reason === 'body-too-large' ? 413 : 400, {
        error:
          error.reason === 'body-too-large'
            ? { code: 'REQUEST_TOO_LARGE', message: 'The request body is too large' }
            : { code: 'REQUEST_ABORTED', message: 'The request was cancelled' },
      });
    }
  },
);
