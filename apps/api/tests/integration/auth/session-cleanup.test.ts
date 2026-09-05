import { afterAll, beforeEach, expect, test } from 'bun:test';
import { db } from '@/db';
import { claims, listings, sessions, users } from '@/db/schema';
import { purgeExpiredSessions } from '@/auth/session-cleanup';

if (!process.env.DATABASE_URL?.endsWith('/lostly_test'))
  throw new Error('Integration tests require lostly_test');
async function clearDatabase() {
  await db.delete(claims);
  await db.delete(listings);
  await db.delete(users);
}
beforeEach(clearDatabase);
afterAll(clearDatabase);

test('removes expired sessions without removing active sessions or their user', async () => {
  const [user] = await db
    .insert(users)
    .values({
      email: 'cleanup@example.com',
      displayName: 'Cleanup',
      passwordHash: 'unused-test-hash',
    })
    .returning();
  await db.insert(sessions).values([
    { userId: user!.id, tokenHash: 'expired', expiresAt: new Date(Date.now() - 60_000) },
    { userId: user!.id, tokenHash: 'active', expiresAt: new Date(Date.now() + 60_000) },
  ]);
  expect(await purgeExpiredSessions()).toBe(1);
  expect((await db.select().from(sessions)).map((session) => session.tokenHash)).toEqual([
    'active',
  ]);
  expect(await db.select().from(users)).toHaveLength(1);
  expect(await purgeExpiredSessions()).toBe(0);
});
