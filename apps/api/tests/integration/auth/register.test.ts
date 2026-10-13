import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { register } from '@/auth/service';
import { hashSessionToken } from '@/auth/session';
import { verifyPassword } from '@/auth/password';
import { db } from '@/db';
import { sessions, users } from '@/db/schema';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl?.endsWith('/lostly_test')) {
  throw new Error('Integration tests require the lostly_test database');
}

beforeEach(async () => {
  await db.delete(users);
});

describe('register', () => {
  test('creates a user and session', async () => {
    const result = await register({
      email: '  User@Example.COM  ',
      password: 'correct horse battery staple',
      displayName: 'Test User',
    });

    expect(result.ok).toBe(true);

    if (!result.ok) {
      throw new Error('Registration unexpectedly failed');
    }

    expect(result.value.user.email).toBe('user@example.com');
    expect(result.value.user.displayName).toBe('Test User');
    expect(result.value.user.role).toBe('user');

    const [storedUser] = await db.select().from(users).where(eq(users.id, result.value.user.id));

    expect(storedUser).toBeDefined();
    expect(storedUser?.email).toBe('user@example.com');
    expect(storedUser?.passwordHash).not.toBe('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', storedUser!.passwordHash!)).toBe(
      true,
    );

    const [storedSession] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, result.value.user.id));

    expect(storedSession).toBeDefined();
    expect(storedSession?.tokenHash).toBe(hashSessionToken(result.value.sessionToken));
    expect(storedSession?.tokenHash).not.toBe(result.value.sessionToken);
    expect(storedSession?.expiresAt).toEqual(result.value.sessionExpiresAt);
  });

  test('rejects a case-insensitive duplicate email', async () => {
    const firstResult = await register({
      email: 'user@example.com',
      password: 'correct horse battery staple',
      displayName: 'First User',
    });

    expect(firstResult.ok).toBe(true);

    const secondResult = await register({
      email: 'USER@example.com',
      password: 'another correct horse battery staple',
      displayName: 'Second User',
    });

    expect(secondResult).toEqual({
      ok: false,
      reason: 'email_taken',
    });

    const storedUsers = await db.select().from(users);
    const storedSessions = await db.select().from(sessions);

    expect(storedUsers).toHaveLength(1);
    expect(storedSessions).toHaveLength(1);
  });
});
