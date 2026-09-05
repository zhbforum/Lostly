import { Elysia } from 'elysia';
import type { ApiErrorResponse } from '@lostly/contracts/errors';

const errors = {
  VALIDATION: { status: 422, code: 'VALIDATION_ERROR', message: 'Request fields are invalid' },
  PARSE: { status: 400, code: 'INVALID_JSON', message: 'Request body could not be parsed' },
  NOT_FOUND: { status: 404, code: 'NOT_FOUND', message: 'Route not found' },
} as const;

export const errorHandler = new Elysia({ name: 'error-handler' }).onError(
  { as: 'global' },
  ({ code, error, request, set, status }) => {
    set.headers['Cache-Control'] = 'private, no-store';
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
