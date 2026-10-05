import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { BunSQLSession } from 'drizzle-orm/bun-sql/session';
import { db } from '@/db';
import { claimConversations, claimConversationMembers } from '@/db/conversations';
import { listingImages } from '@/db/listing-images';
import { users } from '@/db/schema';
import { createClaim } from '@/claims/create';
import { decideClaim } from '@/claims/decide';
import { archiveOwnedListing } from '@/listings/management';
import { setListingVisibility } from '@/admin/service';
import { sendClaimMessage } from '@/conversations/send';
import {
  listConversations,
  findConversationDetail,
  findConversationMessages,
  countUnreadConversations,
} from '@/conversations/queries';
import { decodeCursor } from '@/pagination/cursor';
import { MemoryObjectStorage } from '@tests/support/memory-storage';
import { clearDatabase, user } from './fixtures';
import { room, seedMessages } from './read-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);
const storage = new MemoryObjectStorage();

async function inbox(userId: string, cursor?: string, limit = 20) {
  const result = await listConversations(userId, { cursor, limit }, storage);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

async function setRead(conversationId: string, userId: string, sequence: number) {
  await db
    .update(claimConversationMembers)
    .set({ lastReadSequence: sequence })
    .where(
      and(
        eq(claimConversationMembers.conversationId, conversationId),
        eq(claimConversationMembers.userId, userId),
      ),
    );
}

test('empty rooms expose context and the opposite participant without creating synthetic messages', async () => {
  const owner = await user('owner');
  const claimant = await user('claimant');
  const conversation = await room(owner.id, claimant.id);
  for (const [viewer, other, role] of [
    [owner, claimant, 'owner'],
    [claimant, owner, 'claimant'],
  ] as const) {
    const page = await inbox(viewer.id);
    expect(page.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
    expect(page.conversations).toHaveLength(1);
    const summary = page.conversations[0]!;
    expect(summary).toMatchObject({
      id: conversation.id,
      claim: { status: 'pending' },
      otherParticipant: { id: other.id },
      listing: { id: conversation.listing.id, coverImage: null },
      lastMessage: null,
      unreadCount: 0,
      canSendMessages: true,
    });
    expect(summary.lastActivityAt).toBeInstanceOf(Date);
    expect(summary).not.toHaveProperty('cursorValue');
    expect(summary.claim).not.toHaveProperty('verificationDetails');
    const detail = await findConversationDetail(conversation.id, viewer.id, storage);
    expect(detail).toMatchObject({
      id: conversation.id,
      participantRole: role,
      unreadCount: 0,
      otherParticipant: { id: other.id, displayName: role === 'owner' ? 'claimant' : 'owner' },
      claim: { verificationDetails: conversation.claim.verificationDetails, handoverDetails: null },
      listing: { location: 'Berlin', occurredOn: '2026-09-01', coverImage: null },
    });
    expect(detail!.claim.createdAt).toEqual(conversation.claim.createdAt);
    expect(await countUnreadConversations(viewer.id)).toEqual({ unreadConversationCount: 0 });
    expect(await findConversationMessages(conversation.id, viewer.id, { after: 0 })).toEqual({
      ok: true,
      value: { messages: [], pageInfo: { hasMore: false } },
    });
  }
});

test('all read queries share membership, original participant and visibility checks without an admin bypass', async () => {
  const owner = await user('owner');
  const claimant = await user('claimant');
  const stranger = await user('stranger');
  const admin = await user('admin');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));
  const conversation = await room(owner.id, claimant.id);
  await seedMessages(conversation.id, [owner.id, claimant.id]);
  async function unavailable(viewerId: string, id = conversation.id) {
    expect(await findConversationDetail(id, viewerId, storage)).toBeNull();
    expect(await findConversationMessages(id, viewerId)).toEqual({
      ok: false,
      reason: 'conversation-not-found',
    });
    expect((await inbox(viewerId)).conversations).toEqual([]);
    expect(await countUnreadConversations(viewerId)).toEqual({ unreadConversationCount: 0 });
  }
  for (const viewer of [stranger, admin]) {
    await unavailable(viewer.id);
    await db
      .insert(claimConversationMembers)
      .values({ conversationId: conversation.id, userId: viewer.id });
    await unavailable(viewer.id);
  }
  await unavailable(stranger.id, crypto.randomUUID());
  await db
    .delete(claimConversationMembers)
    .where(
      and(
        eq(claimConversationMembers.conversationId, conversation.id),
        eq(claimConversationMembers.userId, admin.id),
      ),
    );
  const emptyRoom = await room(admin.id, stranger.id);
  await db
    .delete(claimConversationMembers)
    .where(
      and(
        eq(claimConversationMembers.conversationId, emptyRoom.id),
        eq(claimConversationMembers.userId, admin.id),
      ),
    );
  await unavailable(admin.id, emptyRoom.id);
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, owner.id));
  expect((await inbox(owner.id)).conversations.map((item) => item.id)).toEqual([conversation.id]);
  expect(await findConversationDetail(conversation.id, owner.id, storage)).not.toBeNull();
  expect(await countUnreadConversations(owner.id)).toEqual({ unreadConversationCount: 1 });
  const before = await db.select().from(claimConversationMembers);
  expect(
    await setListingVisibility(conversation.listing.id, admin.id, 'hide', {
      expectedVersion: 1,
      reason: 'Review',
    }),
  ).toBe('ok');
  await unavailable(owner.id);
  await unavailable(claimant.id);
  expect(
    await setListingVisibility(conversation.listing.id, admin.id, 'restore', {
      expectedVersion: 2,
      reason: 'Restore',
    }),
  ).toBe('ok');
  expect((await inbox(owner.id)).conversations[0]).toMatchObject({
    id: conversation.id,
    unreadCount: 1,
  });
  expect(await findConversationMessages(conversation.id, claimant.id)).toMatchObject({
    ok: true,
    value: { messages: [{ sequence: 1 }, { sequence: 2 }] },
  });
  expect(await db.select().from(claimConversationMembers)).toEqual(before);
});

test('unread counts incoming messages only, global count counts rooms and reads never change state', async () => {
  const viewer = await user('viewer');
  const other = await user('other');
  const owned = await room(viewer.id, other.id);
  const claimed = await room(other.id, viewer.id);
  const ownOnly = await room(viewer.id, other.id);
  await seedMessages(owned.id, [viewer.id, other.id, other.id, viewer.id]);
  await seedMessages(claimed.id, [other.id, viewer.id, other.id]);
  await seedMessages(ownOnly.id, [viewer.id, viewer.id]);
  const beforeMembers = await db.select().from(claimConversationMembers);
  const beforeRooms = await db.select().from(claimConversations);
  expect(await countUnreadConversations(viewer.id)).toEqual({ unreadConversationCount: 2 });
  const page = await inbox(viewer.id);
  for (const [id, expected] of [
    [owned.id, 2],
    [claimed.id, 2],
    [ownOnly.id, 0],
  ] as const) {
    expect(page.conversations.find((item) => item.id === id)).toMatchObject({
      unreadCount: expected,
      otherParticipant: { id: other.id },
    });
    expect(await findConversationDetail(id, viewer.id, storage)).toMatchObject({
      unreadCount: expected,
    });
    expect((await findConversationMessages(id, viewer.id)).ok).toBe(true);
  }
  expect(await db.select().from(claimConversationMembers)).toEqual(beforeMembers);
  expect(await db.select().from(claimConversations)).toEqual(beforeRooms);
  await setRead(owned.id, viewer.id, 2);
  expect(await findConversationDetail(owned.id, viewer.id, storage)).toMatchObject({
    unreadCount: 1,
  });
  await setRead(owned.id, viewer.id, 4);
  expect(await countUnreadConversations(viewer.id)).toEqual({ unreadConversationCount: 1 });
  expect((await inbox(viewer.id)).conversations.map((item) => item.id)).toEqual(
    page.conversations.map((item) => item.id),
  );
});

test('rejected rooms remain readable and approved archived rooms keep handover context and capability', async () => {
  const owner = await user('owner');
  const first = await user('first');
  const second = await user('second');
  const approved = await room(owner.id, first.id);
  const rejected = await createClaim({
    listingId: approved.listing.id,
    claimantUserId: second.id,
    verificationDetails: 'Competing proof',
  });
  if (!rejected.ok) throw new Error('Expected competing claim');
  await seedMessages(approved.id, [first.id]);
  await seedMessages(rejected.value.conversationId, [second.id]);
  expect(
    await decideClaim({
      claimId: approved.claim.id,
      reviewerUserId: owner.id,
      decision: 'approved',
      handoverDetails: 'Meet at reception',
    }),
  ).toMatchObject({ ok: true });
  expect(
    await archiveOwnedListing({ listingId: approved.listing.id, ownerUserId: owner.id }),
  ).toMatchObject({ ok: true });
  const page = await inbox(owner.id);
  expect(page.conversations).toHaveLength(2);
  for (const [id, state, canSendMessages] of [
    [approved.id, 'approved', true],
    [rejected.value.conversationId, 'rejected', false],
  ] as const) {
    expect(page.conversations.find((item) => item.id === id)).toMatchObject({
      claim: { status: state },
      listing: { status: 'archived' },
      canSendMessages,
      unreadCount: 1,
    });
    expect((await findConversationMessages(id, owner.id)).ok).toBe(true);
  }
  expect(await findConversationDetail(approved.id, first.id, storage)).toMatchObject({
    claim: { handoverDetails: 'Meet at reception' },
    canSendMessages: true,
  });
  expect(await countUnreadConversations(owner.id)).toEqual({ unreadConversationCount: 2 });
});

test('inbox cursor preserves microseconds, equal timestamps and account scope', async () => {
  const owner = await user('owner');
  const claimant = await user('claimant');
  const rooms = await Promise.all(Array.from({ length: 4 }, () => room(owner.id, claimant.id)));
  const byId = rooms.sort((a, b) => a.id.localeCompare(b.id));
  for (const [index, conversation] of byId.entries()) {
    const time = index < 2 ? '2026-09-01T10:00:00.123200Z' : '2026-09-01T10:00:00.123100Z';
    if (index % 2 === 0) await seedMessages(conversation.id, [claimant.id]);
    await db
      .update(claimConversations)
      .set(
        index % 2 === 0
          ? {
              createdAt: new Date('2026-01-01T00:00:00Z'),
              lastMessageAt: sql`${time}::timestamptz`,
            }
          : { createdAt: sql`${time}::timestamptz` },
      )
      .where(eq(claimConversations.id, conversation.id));
  }
  const expected = [byId[1]!.id, byId[0]!.id, byId[3]!.id, byId[2]!.id];
  let cursor: string | undefined;
  const received: string[] = [];
  for (let page = 0; page < 4; page++) {
    const response = await inbox(owner.id, cursor, 1);
    received.push(...response.conversations.map((item) => item.id));
    expect(response.conversations[0]!.lastActivityAt.toISOString()).toBe(
      '2026-09-01T10:00:00.123Z',
    );
    if (response.pageInfo.endCursor) {
      const decoded = decodeCursor(response.pageInfo.endCursor, `conversation-inbox:${owner.id}`);
      expect(decoded?.value).toBe(
        page < 2 ? '2026-09-01T10:00:00.123200Z' : '2026-09-01T10:00:00.123100Z',
      );
      expect(
        await listConversations(claimant.id, { cursor: response.pageInfo.endCursor }, storage),
      ).toEqual({ ok: false, reason: 'invalid-cursor' });
    }
    cursor = response.pageInfo.endCursor ?? undefined;
  }
  expect(received).toEqual(expected);
  expect(cursor).toBeUndefined();
  expect(await listConversations(owner.id, { cursor: 'invalid' }, storage)).toEqual({
    ok: false,
    reason: 'invalid-cursor',
  });
});

test('inbox is a live list: messages move rooms, refresh finds moved items, context and reads do not move them', async () => {
  const owner = await user('owner');
  const claimant = await user('claimant');
  const older = await room(owner.id, claimant.id);
  const newer = await room(owner.id, claimant.id);
  for (const [conversation, day] of [
    [older, '01'],
    [newer, '02'],
  ] as const) {
    await db
      .update(claimConversations)
      .set({ createdAt: new Date(`2026-01-${day}T00:00:00Z`) })
      .where(eq(claimConversations.id, conversation.id));
  }
  const page1 = await inbox(owner.id, undefined, 1);
  expect(page1.conversations[0]!.id).toBe(newer.id);
  const sent = await sendClaimMessage({
    conversationId: older.id,
    userId: claimant.id,
    body: 'Newest activity',
    clientOperationId: crypto.randomUUID(),
  });
  if (!sent.ok) throw new Error('Expected send');
  expect((await inbox(owner.id, page1.pageInfo.endCursor!, 1)).conversations).toEqual([]);
  const refreshed = await inbox(owner.id);
  expect(refreshed.conversations.map((item) => item.id)).toEqual([older.id, newer.id]);
  expect(refreshed.conversations[0]).toMatchObject({
    lastActivityAt: sent.value.message.createdAt,
    lastMessage: { id: sent.value.message.id, body: 'Newest activity' },
  });
  expect(refreshed.conversations[0]!.lastMessage).not.toHaveProperty('clientOperationId');
  expect(
    await decideClaim({ claimId: newer.claim.id, reviewerUserId: owner.id, decision: 'rejected' }),
  ).toMatchObject({ ok: true });
  await setRead(older.id, owner.id, 1);
  expect((await inbox(owner.id)).conversations.map((item) => item.id)).toEqual([
    older.id,
    newer.id,
  ]);
});

test('covers use existing signed URLs and query counts stay constant across inbox sizes', async () => {
  const owner = await user('owner');
  const claimant = await user('claimant');
  const first = await room(owner.id, claimant.id);
  await db.insert(listingImages).values(
    [2, 0].map((position) => ({
      listingId: first.listing.id,
      objectKey: `cover-${position}`,
      contentType: 'image/webp',
      sizeBytes: 100,
      width: 20,
      height: 30,
      position,
    })),
  );
  const execute = spyOn(BunSQLSession.prototype, 'prepareQuery');
  try {
    const small = await inbox(owner.id);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(small.conversations[0]!.listing.coverImage).toMatchObject({
      position: 0,
      width: 20,
      height: 30,
    });
    expect(small.conversations[0]!.listing.coverImage!.url).toContain('/cover-0?expires=');
    expect(small.conversations[0]!.listing.coverImage).not.toHaveProperty('objectKey');
    for (let i = 0; i < 5; i++) await room(owner.id, claimant.id);
    execute.mockClear();
    expect((await inbox(owner.id)).conversations).toHaveLength(6);
    expect(execute).toHaveBeenCalledTimes(2);
    execute.mockClear();
    expect(await findConversationDetail(first.id, owner.id, storage)).toMatchObject({
      listing: { coverImage: { position: 0 } },
    });
    expect(execute).toHaveBeenCalledTimes(2);
    execute.mockClear();
    await countUnreadConversations(owner.id);
    expect(execute).toHaveBeenCalledTimes(1);
    execute.mockClear();
    await findConversationMessages(first.id, owner.id);
    // Reference/access, listing lock, and authorized empty page; no attachment query.
    expect(execute).toHaveBeenCalledTimes(3);
  } finally {
    execute.mockRestore();
  }
});
