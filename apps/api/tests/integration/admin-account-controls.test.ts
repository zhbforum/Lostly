import { afterAll, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  authIdentities,
  moderationCases,
  moderationEvents,
  moderationNotifications,
  sessions,
  users,
} from '@/db/schema';
import { listingImages } from '@/db/listing-images';
import { restrictUser } from '@/admin/operations';
import { createApp } from '@/app';
import { deleteOwnedImage } from '@/listing-images/management';
import { createReport, revealEvidence } from '@/moderation/cases';
import { MemoryObjectStorage } from '../support/memory-storage';
import { clearDatabase, report, request, user } from './listings/management-fixtures';
import type { AdminUserDetail } from '@lostly/contracts/admin-operations';
import { usernameIssue } from '@lostly/contracts/profile';

async function clear() {
  await db.delete(moderationCases);
  await db.delete(moderationEvents);
  await clearDatabase();
}
beforeEach(clear);
afterAll(clear);
async function admin() {
  const actor = await user('admin');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, actor.id));
  return actor;
}

test('profile resets preserve account identity, allow corrections and reject stale writes', async () => {
  const actor = await admin();
  const member = await user('member');
  const now = new Date();
  await db
    .update(users)
    .set({
      username: 'old_username',
      bio: 'Offending bio',
      displayNameChangedAt: now,
      usernameChangedAt: now,
    })
    .where(eq(users.id, member.id));
  await db
    .insert(authIdentities)
    .values({ userId: member.id, provider: 'google', subject: 'private-provider-subject' });
  const input = {
    reason: 'Profile violates content policy',
    publicReason: 'Please correct your profile.',
    expectedVersion: 1,
    fields: ['bio', 'displayName', 'username', 'avatar'],
  };
  expect(
    (await request('/admin/users/' + member.id + '/profile', actor.cookie, input)).status,
  ).toBe(200);
  const [person] = await db.select().from(users).where(eq(users.id, member.id));
  expect(person).toMatchObject({
    id: member.id,
    email: 'member@example.com',
    role: 'user',
    bio: '',
    displayName: 'Lostly member',
    profileVersion: 2,
    avatarId: null,
    displayNameChangedAt: null,
    usernameChangedAt: null,
  });
  expect(person!.username).not.toBe('old_username');
  expect(usernameIssue(person!.username!)).toBeNull();
  expect(
    (await request('/admin/users/' + member.id + '/profile', actor.cookie, input)).status,
  ).toBe(409);
  const storage = new MemoryObjectStorage();
  const app = createApp(storage);
  const response = await app.handle(
    new Request('http://localhost/admin/users/' + member.id, { headers: { cookie: actor.cookie } }),
  );
  expect(response.status).toBe(200);
  const detail = (await response.json()) as AdminUserDetail;
  expect(detail.identities.map((identity) => identity.provider)).toEqual(['google']);
  expect(JSON.stringify(detail)).not.toMatch(
    /passwordHash|tokenHash|private-provider-subject|suspensionReason/,
  );
  expect(
    (
      await request('/admin/users/' + member.id + '/revoke-sessions', actor.cookie, {
        reason: 'Account recovery',
        expectedVersion: 1,
      })
    ).status,
  ).toBe(200);
  expect(await db.select().from(sessions).where(eq(sessions.userId, member.id))).toEqual([]);
  expect((await request('/auth/me', member.cookie)).status).toBe(401);
});

test('failed audit insertion rolls back restrictions, session revocation and notifications', async () => {
  const actor = await admin();
  const member = await user('member');
  const before = await db.select().from(users).where(eq(users.id, member.id));
  const previousSessions = await db.select().from(sessions).where(eq(sessions.userId, member.id));
  await expect(
    restrictUser(member.id, actor.id, {
      reason: 'x'.repeat(501),
      expectedVersion: 1,
      permanent: true,
    }),
  ).rejects.toThrow();
  expect(await db.select().from(users).where(eq(users.id, member.id))).toEqual(before);
  expect(await db.select().from(sessions).where(eq(sessions.userId, member.id))).toEqual(
    previousSessions,
  );
  expect(await db.select().from(moderationEvents)).toEqual([]);
  expect(await db.select().from(moderationNotifications)).toEqual([]);
});

test('retains reported image evidence after the owner removes its ordinary metadata', async () => {
  const actor = await admin();
  const owner = await user('owner');
  const reporter = await user('reporter');
  const listing = await report(owner.id);
  const storage = new MemoryObjectStorage();
  const objectKey = 'listings/' + listing.id + '/evidence.webp';
  await storage.put(objectKey, new Blob(['retained evidence']), 'image/webp');
  const [image] = await db
    .insert(listingImages)
    .values({
      listingId: listing.id,
      objectKey,
      contentType: 'image/webp',
      sizeBytes: 100,
      width: 20,
      height: 20,
      position: 0,
    })
    .returning();
  const record = await createReport(reporter.id, {
    targetType: 'listing_image',
    targetId: image!.id,
    category: 'other',
    description: 'Please inspect the content of this photo.',
  });
  await deleteOwnedImage(
    { listingId: listing.id, ownerUserId: owner.id, imageId: image!.id },
    storage,
  );
  expect(await db.select().from(listingImages)).toEqual([]);
  expect(storage.objects.has(objectKey)).toBe(true);
  const evidence = await revealEvidence(
    record.case.id,
    actor.id,
    'Investigating the reported photo',
    storage,
  );
  expect(evidence.images).toHaveLength(1);
  expect(evidence.images[0]!.url).toContain('evidence.webp');
  expect(JSON.stringify(evidence)).not.toContain('objectKey');
});
