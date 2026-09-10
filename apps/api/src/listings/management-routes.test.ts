import { describe, expect, test } from 'bun:test';

process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/lostly_test';
const { app } = await import('@/app');
const id = '550e8400-e29b-41d4-a716-446655440001';
const input = {
  expectedVersion: 1,
  title: 'Blue backpack',
  description: 'A backpack',
  location: 'Berlin',
  occurredOn: '2026-09-01',
};

function patch(body: unknown, listingId = id) {
  return app.handle(
    new Request(`http://localhost/listings/${listingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Protection': '1' },
      body: JSON.stringify(body),
    }),
  );
}

describe('management route validation', () => {
  test.each([
    'status',
    'createdByUserId',
    'kind',
    'id',
    'version',
    'createdAt',
    'updatedAt',
    'unknown',
  ])('rejects extra field %s before authentication/normalization', async (field) => {
    const response = await patch({ ...input, [field]: 'private-value' });
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'Request fields are invalid' },
    });
  });

  test.each([
    null,
    [],
    {},
    { ...input, title: 42 },
    { ...input, title: '   ' },
    { ...input, occurredOn: '2026-02-30' },
    { ...input, occurredOn: '0000-01-01' },
    { ...input, occurredOn: null },
    { ...input, expectedVersion: undefined },
    { ...input, expectedVersion: null },
    { ...input, expectedVersion: 0 },
    { ...input, expectedVersion: -1 },
    { ...input, expectedVersion: 1.5 },
    { ...input, expectedVersion: '1' },
    { ...input, expectedVersion: 2147483648 },
  ])('rejects malformed editable payload %j', async (body) => {
    expect((await patch(body)).status).toBe(422);
  });

  test.each(['', '/resolve', '/archive'])('protects mutation %s', async (action) => {
    const response = action
      ? await app.handle(
          new Request(`http://localhost/listings/${id}${action}`, {
            method: 'POST',
            headers: { 'X-CSRF-Protection': '1' },
          }),
        )
      : await patch(input);
    expect(response.status).toBe(401);
  });

  test.each(['', '/resolve', '/archive'])('validates UUID for %s', async (action) => {
    const response = action
      ? await app.handle(
          new Request(`http://localhost/listings/invalid${action}`, {
            method: 'POST',
            headers: { 'X-CSRF-Protection': '1' },
          }),
        )
      : await patch(input, 'invalid');
    expect(response.status).toBe(422);
  });

  test.each(['', '/resolve', '/archive'])('protects %s against CSRF', async (action) => {
    const response = await app.handle(
      new Request(`http://localhost/listings/${id}${action}`, {
        method: action ? 'POST' : 'PATCH',
      }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'CSRF_VALIDATION_FAILED' } });
  });
});
