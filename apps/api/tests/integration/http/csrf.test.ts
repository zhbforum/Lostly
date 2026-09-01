import { describe, expect, test } from 'bun:test';

import { app } from '@/app';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '@/http/csrf';

describe('CSRF protection', () => {
  test('allows safe requests without the protection header', async () => {
    const response = await app.handle(new Request('http://localhost/'));

    expect(response.status).toBe(200);
  });

  test('rejects unsafe requests without the protection header', async () => {
    const response = await app.handle(
      new Request('http://localhost/auth/logout', {
        method: 'POST',
      }),
    );

    expect(response.status).toBe(403);

    expect(await response.json()).toEqual({
      error: {
        code: 'CSRF_VALIDATION_FAILED',
        message: 'CSRF protection header is required',
      },
    });
  });

  test('rejects unsafe requests with an invalid protection header', async () => {
    const response = await app.handle(
      new Request('http://localhost/auth/logout', {
        method: 'POST',
        headers: {
          [CSRF_HEADER_NAME]: 'invalid',
        },
      }),
    );

    expect(response.status).toBe(403);
  });

  test('allows unsafe requests with the protection header', async () => {
    const response = await app.handle(
      new Request('http://localhost/auth/logout', {
        method: 'POST',
        headers: {
          [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE,
        },
      }),
    );

    expect(response.status).toBe(204);
  });
});
