import { beforeEach, describe, expect, test } from 'bun:test';

import { app } from '@/app';
import { hashPassword } from '@/auth/password';
import { db } from '@/db';
import { users } from '@/db/schema';
import { CSRF_HEADER_NAME, CSRF_HEADER_VALUE } from '@/http/csrf';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl?.endsWith('/lostly_test')) {
  throw new Error('Integration tests require the lostly_test database');
}

const PASSWORD = 'correct horse battery staple';

beforeEach(async () => {
  await db.delete(users);
});

function postJson(path: string, body: unknown) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE,
      },
      body: JSON.stringify(body),
    }),
  );
}

function getCookieHeader(response: Response): string {
  const setCookie = response.headers.get('set-cookie');

  if (!setCookie) {
    throw new Error('Expected Set-Cookie header');
  }

  const [cookie] = setCookie.split(';');

  if (!cookie) {
    throw new Error('Expected session cookie');
  }

  return cookie;
}

describe('POST /auth/register', () => {
  test('registers a user and sets a session cookie', async () => {
    const response = await postJson('/auth/register', {
      email: '  User@Example.COM  ',
      password: PASSWORD,
      displayName: '  Test User  ',
    });

    expect(response.status).toBe(201);

    expect(await response.json()).toMatchObject({
      user: {
        email: 'user@example.com',
        displayName: 'Test User',
        role: 'user',
      },
    });

    const setCookie = response.headers.get('set-cookie');

    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain('lostly_session=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Path=/');
    expect(setCookie).toContain('Max-Age=604800');
    expect(setCookie).not.toContain('Secure');
  });

  test('does not expose the session token in the response body', async () => {
    const response = await postJson('/auth/register', {
      email: 'user@example.com',
      password: PASSWORD,
      displayName: 'Test User',
    });

    const body = JSON.stringify(await response.json());

    expect(body).not.toContain('sessionToken');
    expect(body).not.toContain('passwordHash');
  });

  test('rejects a duplicate email', async () => {
    await postJson('/auth/register', {
      email: 'user@example.com',
      password: PASSWORD,
      displayName: 'First User',
    });

    const response = await postJson('/auth/register', {
      email: 'USER@example.com',
      password: PASSWORD,
      displayName: 'Second User',
    });

    expect(response.status).toBe(409);

    expect(await response.json()).toEqual({
      error: {
        code: 'EMAIL_TAKEN',
        message: 'An account with this email already exists',
      },
    });
  });

  test('rejects invalid input', async () => {
    const response = await postJson('/auth/register', {
      email: 'not-an-email',
      password: 'short',
      displayName: ' ',
    });

    expect(response.status).toBe(422);
  });
});

describe('POST /auth/login', () => {
  test('logs in and sets a fresh session cookie', async () => {
    await db.insert(users).values({
      email: 'user@example.com',
      passwordHash: await hashPassword(PASSWORD),
      displayName: 'Test User',
    });

    const response = await postJson('/auth/login', {
      email: '  USER@EXAMPLE.COM  ',
      password: PASSWORD,
    });

    expect(response.status).toBe(200);

    expect(await response.json()).toMatchObject({
      user: {
        email: 'user@example.com',
        displayName: 'Test User',
        role: 'user',
      },
    });

    const setCookie = response.headers.get('set-cookie');

    expect(setCookie).toContain('lostly_session=');
    expect(setCookie).toContain('HttpOnly');
  });

  test('returns a generic error for invalid credentials', async () => {
    const response = await postJson('/auth/login', {
      email: 'missing@example.com',
      password: PASSWORD,
    });

    expect(response.status).toBe(401);

    expect(await response.json()).toEqual({
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      },
    });
  });
});

describe('GET /auth/me', () => {
  test('returns the current authenticated user', async () => {
    const registerResponse = await postJson('/auth/register', {
      email: 'user@example.com',
      password: PASSWORD,
      displayName: 'Test User',
    });

    const cookie = getCookieHeader(registerResponse);

    const response = await app.handle(
      new Request('http://localhost/auth/me', {
        headers: {
          cookie,
        },
      }),
    );

    expect(response.status).toBe(200);

    expect(await response.json()).toMatchObject({
      user: {
        email: 'user@example.com',
        displayName: 'Test User',
        role: 'user',
      },
    });
  });

  test('rejects a request without a session', async () => {
    const response = await app.handle(new Request('http://localhost/auth/me'));

    expect(response.status).toBe(401);

    expect(await response.json()).toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });
  });

  test('rejects an invalid session and clears its cookie', async () => {
    const response = await app.handle(
      new Request('http://localhost/auth/me', {
        headers: {
          cookie: 'lostly_session=invalid-token',
        },
      }),
    );

    expect(response.status).toBe(401);

    expect(await response.json()).toEqual({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Authentication required',
      },
    });

    const setCookie = response.headers.get('set-cookie');

    expect(setCookie).not.toBeNull();
    expect(setCookie).toContain('lostly_session=');
    expect(setCookie).toContain('Path=/');
  });
});

describe('POST /auth/logout', () => {
  test('logs out the current session', async () => {
    const registerResponse = await postJson('/auth/register', {
      email: 'user@example.com',
      password: PASSWORD,
      displayName: 'Test User',
    });

    const cookie = getCookieHeader(registerResponse);

    const logoutResponse = await app.handle(
      new Request('http://localhost/auth/logout', {
        method: 'POST',
        headers: {
          cookie,
          [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE,
        },
      }),
    );

    expect(logoutResponse.status).toBe(204);
    expect(logoutResponse.headers.get('set-cookie')).not.toBeNull();

    const meResponse = await app.handle(
      new Request('http://localhost/auth/me', {
        headers: {
          cookie,
        },
      }),
    );

    expect(meResponse.status).toBe(401);
  });

  test('is idempotent without a session', async () => {
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

  test('is idempotent with an invalid session', async () => {
    const response = await app.handle(
      new Request('http://localhost/auth/logout', {
        method: 'POST',
        headers: {
          cookie: 'lostly_session=invalid-token',
          [CSRF_HEADER_NAME]: CSRF_HEADER_VALUE,
        },
      }),
    );

    expect(response.status).toBe(204);
  });
});
