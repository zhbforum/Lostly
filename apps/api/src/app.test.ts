import { describe, expect, test } from 'bun:test';

// Compiling/validating routes must not depend on a running database.
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/lostly_test';
const { app } = await import('@/app');

const id = '550e8400-e29b-41d4-a716-446655440001';

describe('API route compilation and validation', () => {
  test('requires an explicit listing kind instead of silently defaulting to lost', async () => {
    const response = await app.handle(
      new Request('http://localhost/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
        body: JSON.stringify({
          title: 'Blue backpack',
          description: 'A backpack beside the library.',
          location: 'Berlin library',
          occurredOn: '2026-09-01',
        }),
      }),
    );
    expect(response.status).toBe(422);
  });

  for (const path of ['/auth/register', '/auth/login', '/listings']) {
    test.each([
      {},
      null,
      [],
      { email: 42 },
      { email: null },
      { password: null },
      { title: 42 },
      { displayName: 42 },
    ])('returns a safe validation error for ' + path + ': %j', async (body) => {
      const response = await app.handle(
        new Request('http://localhost' + path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: { code: 'VALIDATION_ERROR', message: 'Request fields are invalid' },
      });
    });
  }

  test('does not echo malformed JSON or private field values', async () => {
    const response = await app.handle(
      new Request('http://localhost/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
        body: '{"password":"private-secret"',
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain('private-secret');
  });
  test('compiles all feature routes and serves the root without a database', async () => {
    const response = await app.handle(new Request('http://localhost/'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ name: 'Lostly API' });
  });

  test.each([
    '/listings',
    '/listings/' + id,
    '/listings/' + id + '/claims',
    '/me/listings',
    '/me/claims',
  ])('protects GET %s', async (path) => {
    const response = await app.handle(new Request('http://localhost' + path));
    expect(response.status).toBe(401);
  });

  test.each([
    { label: 'missing', body: {} },
    { label: 'null', body: { verificationDetails: null } },
    { label: 'number', body: { verificationDetails: 42 } },
    { label: 'whitespace', body: { verificationDetails: '     ' } },
    { label: 'too long', body: { verificationDetails: 'x'.repeat(2001) } },
  ])('rejects malformed claim bodies without crashing: $label', async ({ body }) => {
    const response = await app.handle(
      new Request('http://localhost/listings/' + id + '/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(422);
  });

  test.each(['1.5', '0', '51', 'NaN'])('rejects invalid page size %s', async (limit) => {
    const response = await app.handle(new Request('http://localhost/listings?limit=' + limit));
    expect(response.status).toBe(422);
  });

  test('requires private collection instructions for approval', async () => {
    const response = await app.handle(
      new Request('http://localhost/claims/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
        body: JSON.stringify({ decision: 'approved' }),
      }),
    );
    expect(response.status).toBe(422);
  });

  test('protects claim decisions against CSRF', async () => {
    const response = await app.handle(
      new Request('http://localhost/claims/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'rejected' }),
      }),
    );
    expect(response.status).toBe(403);
  });
});
