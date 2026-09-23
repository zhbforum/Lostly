import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { claimConversations, claimConversationMembers, claimMessages } from '@/db/conversations';
import { findConversationForMember } from '@/conversations/authorization';
import { sendClaimMessage } from '@/conversations/send';
import * as locking from '@/listings/locking';
import { createClaim } from '@/claims/create';
import { decideClaim } from '@/claims/decide';
import { archiveOwnedListing, resolveOwnedListing } from '@/listings/management';
import { setListingVisibility } from '@/admin/service';
import { clearDatabase, conversationFixture, report, user } from './fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

test('gates reads and sends by membership and gives admins only their own participant access', async () => {
  const { owner, claimant, conversation } = await conversationFixture();
  const stranger = await user('stranger');
  const admin = await user('admin');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));
  for (const member of [owner, claimant]) {
    expect(await findConversationForMember(conversation.id, member.id)).toMatchObject({
      id: conversation.id,
      canSendMessages: true,
      lastReadSequence: 0,
    });
  }
  for (const outsider of [stranger, admin]) {
    expect(await findConversationForMember(conversation.id, outsider.id)).toBeNull();
    expect(
      await sendClaimMessage({
        conversationId: conversation.id,
        userId: outsider.id,
        clientOperationId: crypto.randomUUID(),
        body: 'Unauthorized',
      }),
    ).toEqual({ ok: false, reason: 'conversation-not-found' });
  }
  expect(await findConversationForMember(crypto.randomUUID(), owner.id)).toBeNull();
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, owner.id));
  expect(await findConversationForMember(conversation.id, owner.id)).toMatchObject({
    canSendMessages: true,
  });
  expect(
    await sendClaimMessage({
      conversationId: conversation.id,
      userId: owner.id,
      clientOperationId: crypto.randomUUID(),
      body: 'My own claim conversation',
    }),
  ).toMatchObject({ ok: true });
});

test('authorizes the claim participants as well as the membership row', async () => {
  const { conversation, claimant } = await conversationFixture();
  const stranger = await user('stranger');
  await db
    .insert(claimConversationMembers)
    .values({ conversationId: conversation.id, userId: stranger.id });
  expect(await findConversationForMember(conversation.id, stranger.id)).toBeNull();
  await db
    .delete(claimConversationMembers)
    .where(
      and(
        eq(claimConversationMembers.conversationId, conversation.id),
        eq(claimConversationMembers.userId, claimant.id),
      ),
    );
  expect(await findConversationForMember(conversation.id, claimant.id)).toBeNull();
});

test('replays normalized text without consuming sequence or changing inbox activity/read state', async () => {
  const { conversation, claimant, owner } = await conversationFixture();
  const input = {
    conversationId: conversation.id,
    userId: claimant.id,
    clientOperationId: crypto.randomUUID(),
    body: '  First line\r\n**plain text**  ',
  };
  const first = await sendClaimMessage(input);
  expect(first).toMatchObject({
    ok: true,
    value: {
      created: true,
      message: {
        sequence: 1,
        senderUserId: claimant.id,
        body: 'First line\n**plain text**',
      },
    },
  });
  const before = await db.select().from(claimConversations);
  const replay = await sendClaimMessage({ ...input, body: 'First line\n**plain text**' });
  if (!first.ok || !replay.ok) throw new Error('Expected successful replay');
  expect(replay.value).toEqual({ message: first.value.message, created: false });
  expect(Object.keys(replay.value.message)).not.toContain('clientOperationId');
  expect(await sendClaimMessage({ ...input, body: 'Changed content' })).toEqual({
    ok: false,
    reason: 'idempotency-conflict',
  });
  expect(await db.select().from(claimConversations)).toEqual(before);
  expect(await db.select().from(claimMessages)).toHaveLength(1);
  await findConversationForMember(conversation.id, owner.id);
  expect(
    (await db.select().from(claimConversationMembers)).every(
      (member) => member.lastReadSequence === 0,
    ),
  ).toBe(true);
});

test('scopes operation IDs to both participant and conversation', async () => {
  const { owner, claimant, conversation } = await conversationFixture();
  const operation = crypto.randomUUID();
  for (const member of [owner, claimant]) {
    expect(
      await sendClaimMessage({
        conversationId: conversation.id,
        userId: member.id,
        clientOperationId: operation,
        body: 'A separate send',
      }),
    ).toMatchObject({ ok: true, value: { created: true } });
  }
  const listing = await report(owner.id);
  const result = await createClaim({
    listingId: listing.id,
    claimantUserId: claimant.id,
    verificationDetails: 'Different claim proof.',
  });
  if (!result.ok) throw new Error('Missing second claim');
  const [other] = await db
    .select()
    .from(claimConversations)
    .where(eq(claimConversations.claimId, result.value.id));
  expect(
    await sendClaimMessage({
      conversationId: other!.id,
      userId: owner.id,
      clientOperationId: operation,
      body: 'A separate send',
    }),
  ).toMatchObject({ ok: true, value: { created: true, message: { sequence: 1 } } });
  expect(await db.select().from(claimMessages)).toHaveLength(3);
});

test('serializes simultaneous sends from both participants without sequence gaps', async () => {
  const { conversation, owner, claimant } = await conversationFixture();
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) =>
      sendClaimMessage({
        conversationId: conversation.id,
        userId: i % 2 ? owner.id : claimant.id,
        clientOperationId: crypto.randomUUID(),
        body: 'Concurrent message ' + i,
      }),
    ),
  );
  expect(results.every((result) => result.ok && result.value.created)).toBe(true);
  const messages = await db.select().from(claimMessages).orderBy(asc(claimMessages.sequence));
  expect(messages.map((message) => message.sequence)).toEqual(
    Array.from({ length: 12 }, (_, i) => i + 1),
  );
  expect(new Set(messages.map((message) => message.body)).size).toBe(12);
  expect((await db.select().from(claimConversations))[0]).toMatchObject({
    nextMessageSequence: 13,
    lastMessageAt: messages.at(-1)!.createdAt,
  });
});

test.each([false, true])(
  'concurrent retries share one message; conflicting bodies: %s',
  async (conflicting) => {
    const { conversation, owner } = await conversationFixture();
    const input = {
      conversationId: conversation.id,
      userId: owner.id,
      clientOperationId: crypto.randomUUID(),
      body: 'First body',
    };
    const results = await Promise.all([
      sendClaimMessage(input),
      sendClaimMessage({ ...input, body: conflicting ? 'Second body' : input.body }),
    ]);
    expect(results.filter((result) => result.ok && result.value.created)).toHaveLength(1);
    if (conflicting) {
      expect(results.find((result) => !result.ok)).toEqual({
        ok: false,
        reason: 'idempotency-conflict',
      });
    } else {
      const messages = results.map((result) => (result.ok ? result.value.message : null));
      expect(messages[0]).toEqual(messages[1]);
      expect(results.filter((result) => result.ok && !result.value.created)).toHaveLength(1);
    }
    expect(await db.select().from(claimMessages)).toHaveLength(1);
    expect((await db.select().from(claimConversations))[0]!.nextMessageSequence).toBe(2);
  },
);

test('rejects new messages after rejection but acknowledges an earlier successful send', async () => {
  const { claim, conversation, owner, claimant } = await conversationFixture();
  const input = {
    conversationId: conversation.id,
    userId: claimant.id,
    clientOperationId: crypto.randomUUID(),
    body: 'Before rejection',
  };
  const first = await sendClaimMessage(input);
  expect(
    await decideClaim({ claimId: claim.id, reviewerUserId: owner.id, decision: 'rejected' }),
  ).toMatchObject({ ok: true });
  expect(await findConversationForMember(conversation.id, claimant.id)).toMatchObject({
    canSendMessages: false,
  });
  const retry = await sendClaimMessage(input);
  if (!first.ok || !retry.ok) throw new Error('Expected retry after rejection');
  expect(retry.value).toEqual({ created: false, message: first.value.message });
  for (const member of [claimant, owner]) {
    expect(
      await sendClaimMessage({
        ...input,
        userId: member.id,
        clientOperationId: crypto.randomUUID(),
      }),
    ).toEqual({ ok: false, reason: 'conversation-read-only' });
  }
  expect(await sendClaimMessage({ ...input, body: 'Conflicting retry after rejection' })).toEqual({
    ok: false,
    reason: 'idempotency-conflict',
  });
});

test('keeps an approved room writable after resolution and archive while competitors become read-only', async () => {
  const { claim, conversation, listing, owner, claimant } = await conversationFixture();
  const competitor = await user('competitor');
  const other = await createClaim({
    listingId: listing.id,
    claimantUserId: competitor.id,
    verificationDetails: 'Competing proof.',
  });
  if (!other.ok) throw new Error('Missing competing claim');
  const [otherRoom] = await db
    .select()
    .from(claimConversations)
    .where(eq(claimConversations.claimId, other.value.id));
  expect(
    await decideClaim({
      claimId: claim.id,
      reviewerUserId: owner.id,
      decision: 'approved',
      handoverDetails: 'Meet at the main entrance.',
    }),
  ).toMatchObject({ ok: true });
  expect(await findConversationForMember(conversation.id, owner.id)).toMatchObject({
    claimStatus: 'approved',
    listingStatus: 'resolved',
    canSendMessages: true,
  });
  const input = {
    conversationId: conversation.id,
    userId: claimant.id,
    clientOperationId: crypto.randomUUID(),
    body: 'Arrange handover',
  };
  expect(await sendClaimMessage(input)).toMatchObject({ ok: true });
  expect(await archiveOwnedListing({ listingId: listing.id, ownerUserId: owner.id })).toMatchObject(
    { ok: true },
  );
  expect(
    await sendClaimMessage({ ...input, userId: owner.id, clientOperationId: crypto.randomUUID() }),
  ).toMatchObject({ ok: true });
  expect(
    await sendClaimMessage({ ...input, conversationId: otherRoom!.id, userId: competitor.id }),
  ).toEqual({ ok: false, reason: 'conversation-read-only' });
});

test.each(['resolve', 'archive'] as const)(
  'manual %s makes pending claim conversations read-only',
  async (action) => {
    const { listing, conversation, owner, claimant } = await conversationFixture();
    const close = action === 'resolve' ? resolveOwnedListing : archiveOwnedListing;
    expect(await close({ listingId: listing.id, ownerUserId: owner.id })).toMatchObject({
      ok: true,
    });
    expect(
      await sendClaimMessage({
        conversationId: conversation.id,
        userId: claimant.id,
        clientOperationId: crypto.randomUUID(),
        body: 'Too late',
      }),
    ).toEqual({ ok: false, reason: 'conversation-read-only' });
  },
);

test('hide blocks reads and all retries; restore retains messages, activity and read pointers', async () => {
  const { conversation, listing, owner, claimant } = await conversationFixture();
  const admin = await user('moderator');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));
  const input = {
    conversationId: conversation.id,
    userId: claimant.id,
    clientOperationId: crypto.randomUUID(),
    body: 'Private conversation text',
  };
  const sent = await sendClaimMessage(input);
  expect(sent.ok).toBe(true);
  await db
    .update(claimConversationMembers)
    .set({ lastReadSequence: 1 })
    .where(
      and(
        eq(claimConversationMembers.conversationId, conversation.id),
        eq(claimConversationMembers.userId, owner.id),
      ),
    );
  const rooms = await db.select().from(claimConversations);
  const members = await db
    .select()
    .from(claimConversationMembers)
    .orderBy(asc(claimConversationMembers.userId));
  const messages = await db.select().from(claimMessages);
  expect(
    await setListingVisibility(listing.id, admin.id, 'hide', {
      expectedVersion: 1,
      reason: 'Hide for review',
    }),
  ).toBe('ok');
  for (const member of [owner, claimant]) {
    expect(await findConversationForMember(conversation.id, member.id)).toBeNull();
  }
  expect(await sendClaimMessage(input)).toEqual({ ok: false, reason: 'conversation-not-found' });
  expect(await sendClaimMessage({ ...input, body: 'Conflicting retry' })).toEqual({
    ok: false,
    reason: 'conversation-not-found',
  });
  expect(await sendClaimMessage({ ...input, clientOperationId: crypto.randomUUID() })).toEqual({
    ok: false,
    reason: 'conversation-not-found',
  });
  expect(
    await setListingVisibility(listing.id, admin.id, 'restore', {
      expectedVersion: 2,
      reason: 'Restore after review',
    }),
  ).toBe('ok');
  expect(await findConversationForMember(conversation.id, owner.id)).toMatchObject({
    lastReadSequence: 1,
  });
  expect(await sendClaimMessage(input)).toMatchObject({ ok: true, value: { created: false } });
  expect(await db.select().from(claimConversations)).toEqual(rooms);
  expect(
    await db.select().from(claimConversationMembers).orderBy(asc(claimConversationMembers.userId)),
  ).toEqual(members);
  expect(await db.select().from(claimMessages)).toEqual(messages);
});

test('invalid text or operation IDs never acquire the listing lock or change message state', async () => {
  const { conversation, owner } = await conversationFixture();
  const input = {
    conversationId: conversation.id,
    userId: owner.id,
    clientOperationId: crypto.randomUUID(),
    body: 'Valid text',
  };
  const lock = spyOn(locking, 'lockListing');
  try {
    for (const body of ['  \r\n ', 'a'.repeat(2001), 'NUL\0', '\uD800']) {
      expect(await sendClaimMessage({ ...input, body })).toEqual({
        ok: false,
        reason: 'invalid-message',
      });
    }
    expect(await sendClaimMessage({ ...input, clientOperationId: 'invalid' })).toEqual({
      ok: false,
      reason: 'invalid-operation-id',
    });
    expect(lock).not.toHaveBeenCalled();
    expect(await db.select().from(claimMessages)).toHaveLength(0);
    expect((await db.select().from(claimConversations))[0]).toEqual(conversation);
    expect(await sendClaimMessage(input)).toMatchObject({
      ok: true,
      value: { message: { sequence: 1 } },
    });
    expect(lock).toHaveBeenCalledTimes(1);
  } finally {
    lock.mockRestore();
  }
});
