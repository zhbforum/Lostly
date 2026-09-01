import { beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import { hashPassword } from '@/auth/password';
import { getSession, logout } from '@/auth/service';
import { generateSessionToken, hashSessionToken } from '@/auth/session';
import { db } from '@/db';
import { sessions, users } from '@/db/schema';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl?.endsWith('/lostly_test')) {
  throw new Error('Integration tests require the lostly_test database');
}

beforeEach(async () => {
  await db.delete(users);
});

async function createUser() {
  const passwordHash = await hashPassword('correct horse battery staple');

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

describe('getSession', () => {
  test('returns the authenticated user and session', async () => {
    const user = await createUser();
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);
    const expiresAt = new Date(Date.now() + 60_000);

    const [session] = await db
      .insert(sessions)
      .values({
        userId: user.id,
        tokenHash,
        expiresAt,
      })
      .returning();

    if (!session) {
      throw new Error('Failed to create test session');
    }

    const result = await getSession(token);

    expect(result).toEqual({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
      session: {
        id: session.id,
        userId: session.userId,
        expiresAt: session.expiresAt,
      },
    });
  });

  test('returns null for an unknown token', async () => {
    expect(await getSession('unknown-token')).toBeNull();
  });

  test('removes and rejects an expired session', async () => {
    const user = await createUser();
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);

    await db.insert(sessions).values({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() - 60_000),
    });

    expect(await getSession(token)).toBeNull();

    const storedSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash));

    expect(storedSessions).toHaveLength(0);
  });
});

describe('logout', () => {
  test('removes the current session', async () => {
    const user = await createUser();
    const token = generateSessionToken();
    const tokenHash = hashSessionToken(token);

    await db.insert(sessions).values({
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60_000),
    });

    await logout(token);

    const storedSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.tokenHash, tokenHash));

    expect(storedSessions).toHaveLength(0);
  });

  test('succeeds for an unknown token', async () => {
    await expect(logout('unknown-token')).resolves.toBeUndefined();
  });
});
