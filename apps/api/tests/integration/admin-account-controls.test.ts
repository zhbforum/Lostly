import { afterAll, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  authIdentities,
  claims,
  moderationCases,
  moderationEvents,
  moderationEvidence,
  moderationNotifications,
  sessions,
  users,
} from '@/db/schema';
import { listingImages } from '@/db/listing-images';
import { moderateListingImage } from '@/admin/operations';
import { restrictUser } from '@/admin/operations';
import { createApp } from '@/app';
import { deleteOwnedImage } from '@/listing-images/management';
import { createReport, revealEvidence } from '@/moderation/cases';
import { MemoryObjectStorage } from '../support/memory-storage';
import { clearDatabase, claim, report, request, user } from './listings/management-fixtures';
import type { ModerationCase } from '@lostly/contracts/moderation';
import type { AdminUserDetail } from '@lostly/contracts/admin-operations';
import { usernameIssue } from '@lostly/contracts/profile';

async function clear() {
  await db.delete(moderationCases);
  await db.delete(moderationEvents);
  await db.delete(moderationEvidence);
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
  const [profileDecision] = await db
    .select()
    .from(moderationEvents)
    .where(eq(moderationEvents.action, 'reset_profile'));
  const appealResponse = await request('/me/moderation/appeals', member.cookie, {
    eventId: profileDecision!.id,
    description: 'Please reconsider this profile reset.',
  });
  expect(appealResponse.status).toBe(200);
  const profileAppeal = (await appealResponse.json()) as { case: ModerationCase };
  expect(
    (
      await revealEvidence(
        profileAppeal.case.id,
        actor.id,
        'Reviewing the prior profile content',
        storage,
      )
    ).text,
  ).toContain('Offending bio');
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
  const [captured] = await db
    .select()
    .from(moderationCases)
    .where(eq(moderationCases.id, record.case.id));
  const [snapshot] = await db
    .select()
    .from(moderationEvidence)
    .where(eq(moderationEvidence.id, captured!.evidenceId!));
  expect(snapshot!.payload.images).toMatchObject([{ id: image!.id, objectKey }]);
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

test('photo moderation keeps visible order contiguous and appends a restored photo', async () => {
  const actor = await admin();
  const owner = await user('owner');
  const listing = await report(owner.id);
  const images = await db
    .insert(listingImages)
    .values(
      [0, 1, 2].map((position) => ({
        listingId: listing.id,
        objectKey: 'photo-' + position,
        contentType: 'image/webp',
        sizeBytes: 100,
        width: 20,
        height: 20,
        position,
      })),
    )
    .returning();
  await moderateListingImage(images[1]!.id, actor.id, true, {
    reason: 'Reported photo removed',
    expectedVersion: 1,
  });
  const afterHide = await db
    .select()
    .from(listingImages)
    .where(eq(listingImages.isHidden, false))
    .orderBy(listingImages.position);
  expect(afterHide.map((image) => image.position)).toEqual([0, 1]);
  await moderateListingImage(images[1]!.id, actor.id, false, {
    reason: 'Photo restored after review',
    expectedVersion: 2,
  });
  const restored = await db
    .select()
    .from(listingImages)
    .where(eq(listingImages.isHidden, false))
    .orderBy(listingImages.position);
  expect(restored.map((image) => image.position)).toEqual([0, 1, 2]);
  expect(restored[2]!.id).toBe(images[1]!.id);
});

test('an older appeal cannot reopen a later rejection even if review timestamps coincide', async () => {
  const actor = await admin();
  const owner = await user('owner');
  const claimant = await user('claimant');
  const listing = await report(owner.id);
  const pending = await claim(listing.id, claimant.id);
  expect(
    (
      await request('/admin/claims/' + pending.id + '/reject', actor.cookie, {
        reason: 'First moderation decision',
      })
    ).status,
  ).toBe(204);
  const [first] = await db.select().from(moderationEvents);
  const appealed = await request('/me/moderation/appeals', claimant.cookie, {
    eventId: first!.id,
    description: 'Please reconsider this rejection.',
  });
  expect(appealed.status).toBe(200);
  const appeal = (await appealed.json()) as { case: ModerationCase };
  expect(
    (
      await revealEvidence(
        appeal.case.id,
        actor.id,
        'Reviewing this claim appeal',
        new MemoryObjectStorage(),
      )
    ).text,
  ).toContain('Private proof of ownership.');
  const reverse = () =>
    request('/admin/cases/' + appeal.case.id + '/reverse-decision', actor.cookie, {
      reason: 'Reviewing the appealed decision',
      expectedVersion: 1,
    });
  expect((await reverse()).status).toBe(200);
  expect(
    (
      await request('/admin/claims/' + pending.id + '/reject', actor.cookie, {
        reason: 'A later moderation decision',
      })
    ).status,
  ).toBe(204);
  // Model two decisions recorded within the same application-clock millisecond.
  await db
    .update(claims)
    .set({ reviewedAt: new Date(String(first!.metadata['reviewedAt'])) })
    .where(eq(claims.id, pending.id));
  expect((await reverse()).status).toBe(409);
  expect((await db.select().from(claims).where(eq(claims.id, pending.id)))[0]!.status).toBe(
    'rejected',
  );
});
