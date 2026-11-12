import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  claims,
  listings,
  moderationCases,
  moderationEvents,
  moderationEvidence,
  moderationNotifications,
  sessions,
  users,
} from '@/db/schema';
import { listingImages } from '@/db/listing-images';
import { claimConversations, claimMessages } from '@/db/conversations';
import { createApp } from '@/app';
import { moderateListingImage, resetUserProfile, restrictUser } from '@/admin/operations';
import { moderateClaim, setListingVisibility } from '@/admin/service';
import { createAppeal, createReport, revealEvidence } from '@/moderation/cases';
import { purgeExpiredEvidence } from '@/moderation/evidence-retention';
import { deleteOwnedImage } from '@/listing-images/management';
import { MemoryObjectStorage } from '../support/memory-storage';
import { clearDatabase, claim, report, request, user } from './listings/management-fixtures';

async function clear() {
  await db.delete(moderationCases);
  await db.delete(moderationEvents);
  await db.delete(moderationEvidence);
  await clearDatabase();
}
beforeEach(clear);
afterAll(clear);
const reason = 'Investigating reported content';
async function admin() {
  const actor = await user('moderator');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, actor.id));
  return actor;
}
async function photo(listingId: string, storage: MemoryObjectStorage) {
  const objectKey = 'listings/' + listingId + '/' + crypto.randomUUID() + '.webp';
  await storage.put(objectKey, new Blob(['photo']), 'image/webp');
  const [image] = await db
    .insert(listingImages)
    .values({
      listingId,
      objectKey,
      contentType: 'image/webp',
      sizeBytes: 5,
      width: 20,
      height: 20,
      position: 0,
    })
    .returning();
  return image!;
}
async function reported(
  userId: string,
  targetId: string,
  targetType: 'listing' | 'message' | 'listing_image' = 'listing',
) {
  return (
    await createReport(userId, {
      targetType,
      targetId,
      category: 'other',
      description: 'Please investigate this content.',
    })
  ).case;
}
async function decision(action: typeof moderationEvents.$inferSelect.action) {
  const [event] = await db
    .select()
    .from(moderationEvents)
    .where(eq(moderationEvents.action, action));
  expect(event!.evidenceId).not.toBeNull();
  return event!;
}

test('rejects unrelated case targets without changing entities, sessions, audit, notices or snapshots', async () => {
  const actor = await admin();
  const owner = await user('owner');
  const other = await user('other');
  const claimant = await user('claimant');
  const first = await report(owner.id);
  const second = await report(other.id);
  const pending = await claim(second.id, claimant.id);
  const storage = new MemoryObjectStorage();
  const image = await photo(second.id, storage);
  const record = await reported(owner.id, first.id);
  const state = async () => ({
    users: await db.select().from(users),
    listings: await db.select().from(listings),
    claims: await db.select().from(claims),
    images: await db.select().from(listingImages),
    sessions: await db.select().from(sessions),
    events: await db.select().from(moderationEvents),
    notices: await db.select().from(moderationNotifications),
    evidence: await db.select().from(moderationEvidence),
  });
  const before = await state();
  const commands = [
    ['/admin/listings/' + second.id + '/hide', {}],
    ['/admin/listings/' + second.id + '/archive', {}],
    ['/admin/claims/' + pending.id + '/reject', {}],
    ['/admin/images/' + image.id + '/visibility', { hidden: true }],
    ['/admin/users/' + other.id + '/restriction', { permanent: true }],
    ['/admin/users/' + other.id + '/revoke-sessions', {}],
    ['/admin/users/' + other.id + '/profile', { fields: ['bio', 'avatar', 'username'] }],
  ] as const;
  for (const [path, body] of commands) {
    const response = await request(path, actor.cookie, {
      reason,
      expectedVersion: 1,
      caseId: record.id,
      ...body,
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'CASE_SCOPE_MISMATCH' } });
    expect(await state()).toEqual(before);
  }
});

test('keeps valid related-image and owner actions scoped to a listing case', async () => {
  const actor = await admin();
  const owner = await user('owner');
  const listing = await report(owner.id);
  const image = await photo(listing.id, new MemoryObjectStorage());
  const record = await reported(owner.id, listing.id);
  await moderateListingImage(image.id, actor.id, true, {
    reason,
    caseId: record.id,
    expectedVersion: 1,
  });
  await resetUserProfile(owner.id, actor.id, {
    reason,
    caseId: record.id,
    expectedVersion: 1,
    fields: ['bio'],
  });
  expect((await db.select().from(moderationEvents)).map((e) => e.caseId)).toEqual([
    record.id,
    record.id,
  ]);
});

test('appeal uses the decision-time listing snapshot, not the earlier report or later edits', async () => {
  const actor = await admin();
  const owner = await user('owner');
  const listing = await report(owner.id);
  const record = await reported(owner.id, listing.id);
  await db
    .update(listings)
    .set({ description: 'Content at decision time' })
    .where(eq(listings.id, listing.id));
  await setListingVisibility(listing.id, actor.id, 'hide', {
    reason,
    caseId: record.id,
    expectedVersion: 1,
  });
  const event = await decision('hide_listing');
  await db
    .update(listings)
    .set({ description: 'Edited after moderation' })
    .where(eq(listings.id, listing.id));
  const appeal = await createAppeal(owner.id, event.id, 'Please reconsider this decision.');
  const storage = new MemoryObjectStorage();
  expect((await revealEvidence(record.id, actor.id, reason, storage)).text).toContain(
    'Original description',
  );
  const historical = await revealEvidence(appeal.case.id, actor.id, reason, storage);
  expect(historical.text).toContain('Content at decision time');
  expect(historical.text).not.toMatch(/Original description|Edited after moderation/);
  const [appealRow] = await db
    .select()
    .from(moderationCases)
    .where(eq(moderationCases.id, appeal.case.id));
  expect(appealRow!.evidenceId).toBe(event.evidenceId);
});

test('direct photo decisions retain the original file after removal and replacement', async () => {
  const actor = await admin();
  const owner = await user('owner');
  const listing = await report(owner.id);
  const storage = new MemoryObjectStorage();
  const original = await photo(listing.id, storage);
  await moderateListingImage(original.id, actor.id, true, { reason, expectedVersion: 1 });
  const event = await decision('hide_listing_image');
  await deleteOwnedImage(
    { listingId: listing.id, ownerUserId: owner.id, imageId: original.id },
    storage,
  );
  const replacement = await photo(listing.id, storage);
  const appeal = await createAppeal(owner.id, event.id, 'Please review the original photo.');
  const evidence = await revealEvidence(appeal.case.id, actor.id, reason, storage);
  expect(evidence.images.map((image) => image.id)).toEqual([original.id]);
  expect(JSON.stringify(evidence)).not.toContain(replacement.id);
  expect(storage.objects.has(original.objectKey)).toBe(true);
});

test('removed profile content is only available through an audited reveal, including old audit metadata', async () => {
  const actor = await admin();
  const owner = await user('owner');
  const avatarId = crypto.randomUUID();
  await db
    .update(users)
    .set({ bio: 'Sensitive removed bio', username: 'removed_name', avatarId })
    .where(eq(users.id, owner.id));
  await resetUserProfile(owner.id, actor.id, {
    reason,
    expectedVersion: 1,
    fields: ['bio', 'username', 'avatar'],
  });
  const event = await decision('reset_profile');
  expect(event.metadata).toEqual({ fields: ['bio', 'username', 'avatar'] });
  await db.update(users).set({ bio: 'Replacement bio' }).where(eq(users.id, owner.id));
  // Defense in depth for rows from an older application version.
  await db
    .update(moderationEvents)
    .set({
      metadata: {
        ...event.metadata,
        previousProfile: { bio: 'Legacy secret' },
        previousAvatarId: avatarId,
      },
    })
    .where(eq(moderationEvents.id, event.id));
  const audit = await request('/admin/audit', actor.cookie);
  expect(audit.status).toBe(200);
  expect(await audit.text()).not.toMatch(
    /Sensitive removed bio|removed_name|Legacy secret|previousProfile|previousAvatarId|evidenceId/,
  );
  const appeal = await createAppeal(owner.id, event.id, 'Please review my former profile.');
  const safe = await request('/admin/cases/' + appeal.case.id, actor.cookie);
  expect(await safe.text()).not.toMatch(/Sensitive removed bio|removed_name|objectKey/);
  const revealed = await revealEvidence(
    appeal.case.id,
    actor.id,
    reason,
    new MemoryObjectStorage(),
  );
  expect(revealed.text).toContain('Sensitive removed bio');
  expect(revealed.text).toContain('removed_name');
  expect(revealed.text).not.toContain('Replacement bio');
  expect(revealed.images[0]!.id).toBe(avatarId);
  expect(
    await db
      .select()
      .from(moderationEvents)
      .where(eq(moderationEvents.action, 'view_case_evidence')),
  ).toHaveLength(1);
});

test('direct claim and account decisions preserve historical content for later appeals', async () => {
  const actor = await admin();
  const owner = await user('owner');
  const member = await user('claimant');
  const listing = await report(owner.id);
  const pending = await claim(listing.id, member.id);
  await db
    .update(claims)
    .set({ verificationDetails: 'Original private proof' })
    .where(eq(claims.id, pending.id));
  await moderateClaim(pending.id, actor.id, { reason });
  const rejected = await decision('reject_claim');
  await db
    .update(claims)
    .set({ verificationDetails: 'Later proof' })
    .where(eq(claims.id, pending.id));
  const appeal = await createAppeal(member.id, rejected.id, 'Please reconsider my original proof.');
  expect(
    (await revealEvidence(appeal.case.id, actor.id, reason, new MemoryObjectStorage())).text,
  ).toBe('Original private proof');
  await db.update(users).set({ bio: 'Profile when restricted' }).where(eq(users.id, member.id));
  await restrictUser(member.id, actor.id, { reason, permanent: true, expectedVersion: 1 });
  const restricted = await decision('suspend_user');
  await db.update(users).set({ bio: 'Changed profile' }).where(eq(users.id, member.id));
  const accountAppeal = await createAppeal(
    member.id,
    restricted.id,
    'Please reconsider my account restriction.',
  );
  expect(
    (await revealEvidence(accountAppeal.case.id, actor.id, reason, new MemoryObjectStorage())).text,
  ).toContain('Profile when restricted');
});

test('message decisions capture the moderated message and reject unrelated message cases', async () => {
  const actor = await admin();
  const owner = await user('owner');
  const member = await user('claimant');
  const listing = await report(owner.id);
  const pending = await claim(listing.id, member.id);
  const [conversation] = await db
    .select()
    .from(claimConversations)
    .where(eq(claimConversations.claimId, pending.id));
  const [message, other] = await db
    .insert(claimMessages)
    .values(
      [1, 2].map((sequence) => ({
        conversationId: conversation!.id,
        sequence,
        senderUserId: member.id,
        clientOperationId: crypto.randomUUID(),
        body: 'Message ' + sequence,
      })),
    )
    .returning();
  const record = await reported(owner.id, message!.id, 'message');
  const command = { reason, caseId: record.id, hidden: true };
  expect(
    (await request('/admin/messages/' + other!.id + '/visibility', actor.cookie, command)).status,
  ).toBe(403);
  expect(await db.select().from(moderationEvents)).toEqual([]);
  expect(
    (await request('/admin/messages/' + message!.id + '/visibility', actor.cookie, command)).status,
  ).toBe(200);
  const event = await decision('hide_message');
  await db
    .update(claimMessages)
    .set({ body: 'Changed later' })
    .where(eq(claimMessages.id, message!.id));
  const appeal = await createAppeal(member.id, event.id, 'Please reconsider the original message.');
  expect(
    (await revealEvidence(appeal.case.id, actor.id, reason, new MemoryObjectStorage())).text,
  ).toBe('Message 1');
});

test('expired evidence is denied before cleanup; appeals never renew retention and URLs cannot outlive it', async () => {
  const actor = await admin();
  const owner = await user('owner');
  const listing = await report(owner.id);
  const storage = new MemoryObjectStorage();
  await photo(listing.id, storage);
  await setListingVisibility(listing.id, actor.id, 'hide', { reason, expectedVersion: 1 });
  const event = await decision('hide_listing');
  const expiresAt = new Date(Date.now() + 30_500);
  await db
    .update(moderationEvidence)
    .set({ expiresAt })
    .where(eq(moderationEvidence.id, event.evidenceId!));
  const appeal = await createAppeal(owner.id, event.id, 'Please reconsider this decision.');
  const sign = spyOn(storage, 'createReadUrl');
  const evidence = await revealEvidence(appeal.case.id, actor.id, reason, storage);
  expect(evidence.expiresAt).toBe(expiresAt.toISOString());
  expect(new Date(evidence.images[0]!.expiresAt).getTime()).toBeLessThanOrEqual(
    expiresAt.getTime(),
  );
  expect(sign.mock.calls[0]![1]).toBeLessThanOrEqual(30);
  sign.mockClear();
  await db
    .update(moderationEvidence)
    .set({ expiresAt: new Date(Date.now() - 1) })
    .where(eq(moderationEvidence.id, event.evidenceId!));
  const app = createApp(storage);
  const response = await app.handle(
    new Request('http://localhost/admin/cases/' + appeal.case.id + '/evidence', {
      method: 'POST',
      headers: {
        cookie: actor.cookie,
        'Content-Type': 'application/json',
        'X-CSRF-Protection': '1',
      },
      body: JSON.stringify({ reason }),
    }),
  );
  expect(response.status).toBe(410);
  expect(await response.json()).toMatchObject({ error: { code: 'EVIDENCE_EXPIRED' } });
  expect(sign).not.toHaveBeenCalled();
  sign.mockRestore();
  const [snapshot] = await db
    .select()
    .from(moderationEvidence)
    .where(eq(moderationEvidence.id, event.evidenceId!));
  expect(snapshot!.purgedAt).toBeNull();
  expect(snapshot!.payload.text).toContain('Original description');
  expect(
    await db
      .select()
      .from(moderationEvents)
      .where(eq(moderationEvents.action, 'view_case_evidence')),
  ).toHaveLength(1);
});

test('cleanup retries partial deletion, preserves live references and then removes expired content', async () => {
  const owner = await user('owner');
  const listing = await report(owner.id);
  const storage = new MemoryObjectStorage();
  const current = await photo(listing.id, storage);
  const keys = [
    'avatars/' + owner.id + '/' + crypto.randomUUID() + '.webp',
    'listings/retained.webp',
  ];
  const preview = keys[0]!.slice(0, -5) + '-still.webp';
  for (const key of [...keys, preview]) await storage.put(key, new Blob(['private']), 'image/webp');
  const past = new Date(Date.now() - 1000);
  const payload = {
    text: 'Expired sensitive content',
    images: [current.objectKey, ...keys].map((objectKey) => ({
      id: crypto.randomUUID(),
      objectKey,
      width: 20,
      height: 20,
    })),
  };
  const [expired, active] = await db
    .insert(moderationEvidence)
    .values([
      { payload, expiresAt: past },
      { payload: { images: [payload.images[2]!] }, expiresAt: new Date(Date.now() + 60_000) },
    ])
    .returning();
  const remove = spyOn(storage, 'delete').mockImplementation(async (key) => {
    if (key === preview) throw new Error('Temporary storage failure');
    storage.objects.delete(key);
  });
  const log = spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(await purgeExpiredEvidence(storage)).toBe(0);
    expect(storage.objects.has(keys[0]!)).toBe(false);
    expect(storage.objects.has(preview)).toBe(true);
    expect(
      (await db.select().from(moderationEvidence).where(eq(moderationEvidence.id, expired!.id)))[0]!
        .purgedAt,
    ).toBeNull();
    remove.mockRestore();
    expect(await purgeExpiredEvidence(storage)).toBe(1);
    expect(await purgeExpiredEvidence(storage)).toBe(0);
    expect(storage.objects.has(preview)).toBe(false);
    expect(storage.objects.has(current.objectKey)).toBe(true);
    expect(storage.objects.has(keys[1]!)).toBe(true);
    const [purged] = await db
      .select()
      .from(moderationEvidence)
      .where(eq(moderationEvidence.id, expired!.id));
    expect(purged!.purgedAt).not.toBeNull();
    expect(purged!.payload).toEqual({});
    await db
      .update(moderationEvidence)
      .set({ expiresAt: past })
      .where(eq(moderationEvidence.id, active!.id));
    expect(await purgeExpiredEvidence(storage)).toBe(1);
    expect(storage.objects.has(keys[1]!)).toBe(false);
    expect(storage.objects.has(current.objectKey)).toBe(true);
  } finally {
    remove.mockRestore();
    log.mockRestore();
  }
});
