import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { hashPassword } from '@/auth/password';
import { login } from '@/auth/service';
import { hashSessionToken } from '@/auth/session';
import { db } from '@/db';
import { sessions, users } from '@/db/schema';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl?.endsWith('/lostly_test')) {
  throw new Error('Integration tests require the lostly_test database');
}

const PASSWORD = 'correct horse battery staple';

beforeEach(async () => {
  await db.delete(users);
});

async function createUser() {
  const passwordHash = await hashPassword(PASSWORD);

  const [user] = await db
    .insert(users)
    .values({
      email: 'user@example.com',
      passwordHash,
      displayName: 'Test User',
    })
    .returning();

  if (!user) {
    throw new Error('Failed to create test user');
  }

  return user;
}

describe('login', () => {
  test('logs in with valid credentials', async () => {
    const user = await createUser();

    const result = await login({
      email: 'user@example.com',
      password: PASSWORD,
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error('Login unexpectedly failed');
    }

    expect(result.value.user).toEqual({
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    });

    const [storedSession] = await db.select().from(sessions).where(eq(sessions.userId, user.id));

    expect(storedSession).toBeDefined();
    expect(storedSession?.tokenHash).toBe(hashSessionToken(result.value.sessionToken));
    expect(storedSession?.tokenHash).not.toBe(result.value.sessionToken);
    expect(storedSession?.expiresAt).toEqual(result.value.sessionExpiresAt);
  });

  test('normalizes email before login', async () => {
    await createUser();

    const result = await login({
      email: '  USER@EXAMPLE.COM  ',
      password: PASSWORD,
    });

    expect(result.ok).toBe(true);
  });

  test('rejects an incorrect password', async () => {
    await createUser();

    const result = await login({
      email: 'user@example.com',
      password: 'incorrect password',
    });

    expect(result).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });

    const storedSessions = await db.select().from(sessions);

    expect(storedSessions).toHaveLength(0);
  });

  test('rejects a nonexistent user', async () => {
    const result = await login({
      email: 'missing@example.com',
      password: PASSWORD,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'invalid_credentials',
    });

    const storedSessions = await db.select().from(sessions);

    expect(storedSessions).toHaveLength(0);
  });

  test('allows multiple sessions for the same user', async () => {
    const user = await createUser();

    const firstResult = await login({
      email: user.email,
      password: PASSWORD,
    });

    const secondResult = await login({
      email: user.email,
      password: PASSWORD,
    });

    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);

    const storedSessions = await db.select().from(sessions).where(eq(sessions.userId, user.id));

    expect(storedSessions).toHaveLength(2);
  });
});
