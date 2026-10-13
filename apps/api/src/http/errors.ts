import { Elysia, ParseError } from 'elysia';
import type { ApiErrorResponse } from '@lostly/contracts/errors';
import { IMAGE_ERRORS, ImageError } from '@/listing-images/errors';
import { StorageUnavailableError } from '@/storage/object-storage';
import { PROFILE_ERRORS, ProfileError } from '@/profile/errors';
import { CONVERSATION_UPLOAD_ERRORS, ConversationUploadError } from '@/conversations/upload-errors';

const errors = {
  VALIDATION: { status: 422, code: 'VALIDATION_ERROR', message: 'Request fields are invalid' },
  PARSE: { status: 400, code: 'INVALID_JSON', message: 'Request body could not be parsed' },
  NOT_FOUND: { status: 404, code: 'NOT_FOUND', message: 'Route not found' },
} as const;

export const errorHandler = new Elysia({ name: 'error-handler' }).onError(
  { as: 'global' },
  ({ code, error, request, set, status }) => {
    set.headers['Cache-Control'] = 'private, no-store';
    // Elysia wraps errors thrown by custom body parsers. Unwrap only our safe domain errors.
    const imageError = error instanceof ParseError ? error.cause : error;
    if (imageError instanceof ProfileError) {
      const [httpStatus, errorCode, message] = PROFILE_ERRORS[imageError.reason];
      if (httpStatus === 429) set.headers['Retry-After'] = '60';
      return status(httpStatus, { error: { code: errorCode, message } });
    }
    if (imageError instanceof ConversationUploadError) {
      const [httpStatus, errorCode, message] = CONVERSATION_UPLOAD_ERRORS[imageError.reason];
      if (httpStatus === 429) set.headers['Retry-After'] = '60';
      return status(httpStatus, { error: { code: errorCode, message } });
    }
    if (imageError instanceof ImageError) {
      const [httpStatus, errorCode, message] = IMAGE_ERRORS[imageError.reason];
      if (httpStatus === 429) set.headers['Retry-After'] = '60';
      return status(httpStatus, { error: { code: errorCode, message } });
    }
    if (error instanceof StorageUnavailableError) {
      return status(503, {
        error: {
          code: 'IMAGE_STORAGE_UNAVAILABLE',
          message: 'Image storage is temporarily unavailable',
        },
      });
    }
    if (
      (code === 'VALIDATION' && error.type !== 'response') ||
      code === 'PARSE' ||
      code === 'NOT_FOUND'
    ) {
      const failure = errors[code];
      return status(failure.status, {
        error: { code: failure.code, message: failure.message },
      } satisfies ApiErrorResponse);
    }
    // Never log request bodies, cookies, exception messages or SQL parameters.
    // A correlation ID permits private operational investigation without leaking secrets.
    const requestId = crypto.randomUUID();
    set.headers['X-Request-Id'] = requestId;
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'request_failed',
        requestId,
        method: request.method,
        code,
      }),
    );
    return status(500, {
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    } satisfies ApiErrorResponse);
  },
);
