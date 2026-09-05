import { describe, expect, test, spyOn } from 'bun:test';
import { Elysia, t } from 'elysia';
import { errorHandler } from './errors';

describe('safe error responses', () => {
  test('redacts unexpected exceptions in responses and structured logs', async () => {
    const log = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = new Elysia().use(errorHandler).get('/', () => {
        throw new Error('database password private-secret');
      });
      const response = await app.handle(new Request('http://localhost/'));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      });
      expect(response.headers.get('x-request-id')).toBeTruthy();
      expect(JSON.stringify(log.mock.calls)).not.toContain('private-secret');
      expect(JSON.parse(log.mock.calls[0]![0] as string).requestId).toBe(
        response.headers.get('x-request-id'),
      );
    } finally {
      log.mockRestore();
    }
  });

  test('treats invalid server responses as server errors, not client mistakes', async () => {
    const log = spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = new Elysia()
        .use(errorHandler)
        .get('/', () => ({ value: 'private' as unknown as number }), {
          response: t.Object({ value: t.Number() }),
        });
      const response = await app.handle(new Request('http://localhost/'));
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('private');
    } finally {
      log.mockRestore();
    }
  });
});
