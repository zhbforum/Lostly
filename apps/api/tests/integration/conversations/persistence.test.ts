import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { claims } from '@/db/schema';
import { claimConversations, claimConversationMembers, claimMessages } from '@/db/conversations';
import { createClaim } from '@/claims/create';
import * as creation from '@/conversations/create';
import { sendClaimMessage } from '@/conversations/send';
import { clearDatabase, conversationFixture, report, user } from './fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

async function expectConstraint(query: PromiseLike<unknown>, code: string) {
  await expect(Promise.resolve(query)).rejects.toMatchObject({ cause: { errno: code } });
}

test('creates exactly one room with the claimant and listing owner in the claim transaction', async () => {
  const { owner, claimant, claim, conversation } = await conversationFixture();
  expect(conversation).toMatchObject({
    claimId: claim.id,
    nextMessageSequence: 1,
    lastMessageAt: null,
    createdAt: claim.createdAt,
  });
  const members = await db.select().from(claimConversationMembers);
  expect(members.map((member) => member.userId).sort()).toEqual([owner.id, claimant.id].sort());
  expect(
    members.every(
      (member) => member.conversationId === conversation.id && member.lastReadSequence === 0,
    ),
  ).toBe(true);
  expect(await db.select().from(claimMessages)).toHaveLength(0);
});

test('duplicate concurrent claims leave one conversation and two members', async () => {
  const owner = await user('owner');
  const claimant = await user('claimant');
  const listing = await report(owner.id);
  const input = {
    listingId: listing.id,
    claimantUserId: claimant.id,
    verificationDetails: 'Private ownership proof.',
  };
  const results = await Promise.all([createClaim(input), createClaim(input)]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.find((result) => !result.ok)).toEqual({
    ok: false,
    reason: 'claim-already-exists',
  });
  expect(await db.select().from(claims)).toHaveLength(1);
  expect(await db.select().from(claimConversations)).toHaveLength(1);
  expect(await db.select().from(claimConversationMembers)).toHaveLength(2);
});

test('a failure after room and member insertion rolls back the entire claim', async () => {
  const owner = await user('owner');
  const claimant = await user('claimant');
  const listing = await report(owner.id);
  const input = {
    listingId: listing.id,
    claimantUserId: claimant.id,
    verificationDetails: 'Private ownership proof.',
  };
  const original = creation.createClaimConversation;
  const failure = new Error('Injected failure after conversation persistence');
  const spy = spyOn(creation, 'createClaimConversation').mockImplementation(async (...args) => {
    await original(...args);
    throw failure;
  });
  try {
    await expect(createClaim(input)).rejects.toBe(failure);
    expect(await db.select().from(claims)).toHaveLength(0);
    expect(await db.select().from(claimConversations)).toHaveLength(0);
    expect(await db.select().from(claimConversationMembers)).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
  expect((await createClaim(input)).ok).toBe(true);
  expect(await db.select().from(claimConversations)).toHaveLength(1);
});

test('database constraints reject duplicate rooms, membership, ordering, operations and nonmember senders', async () => {
  const { claim, conversation, owner } = await conversationFixture();
  const stranger = await user('stranger');
  await expectConstraint(db.insert(claimConversations).values({ claimId: claim.id }), '23505');
  await expectConstraint(
    db
      .insert(claimConversationMembers)
      .values({ conversationId: conversation.id, userId: owner.id }),
    '23505',
  );
  const message = {
    conversationId: conversation.id,
    senderUserId: owner.id,
    sequence: 1,
    clientOperationId: crypto.randomUUID(),
    body: 'Test message',
  };
  await db.insert(claimMessages).values(message);
  await expectConstraint(
    db.insert(claimMessages).values({ ...message, clientOperationId: crypto.randomUUID() }),
    '23505',
  );
  await expectConstraint(db.insert(claimMessages).values({ ...message, sequence: 2 }), '23505');
  await expectConstraint(
    db.insert(claimMessages).values({ ...message, sequence: 2, senderUserId: stranger.id }),
    '23503',
  );
  await expectConstraint(
    db
      .insert(claimMessages)
      .values({ ...message, sequence: 0, clientOperationId: crypto.randomUUID() }),
    '23514',
  );
  await expectConstraint(
    db.insert(claimMessages).values({
      ...message,
      sequence: 2,
      clientOperationId: crypto.randomUUID(),
      body: 'a'.repeat(2001),
    }),
    '23514',
  );
  await expectConstraint(
    db.update(claimConversationMembers).set({ lastReadSequence: -1 }),
    '23514',
  );
  await expectConstraint(db.update(claimConversations).set({ nextMessageSequence: 0 }), '23514');
  expect(await db.select().from(claimMessages)).toHaveLength(1);
});

test('failure updating the sequence rolls back the message, operation key and activity', async () => {
  const { conversation, owner } = await conversationFixture();
  await db
    .update(claimConversations)
    .set({ nextMessageSequence: 2147483647 })
    .where(eq(claimConversations.id, conversation.id));
  const input = {
    conversationId: conversation.id,
    userId: owner.id,
    clientOperationId: crypto.randomUUID(),
    body: 'Retry me',
  };
  await expect(sendClaimMessage(input)).rejects.toThrow();
  expect(await db.select().from(claimMessages)).toHaveLength(0);
  const [stored] = await db.select().from(claimConversations);
  expect(stored).toMatchObject({ nextMessageSequence: 2147483647, lastMessageAt: null });
  await db
    .update(claimConversations)
    .set({ nextMessageSequence: 1 })
    .where(eq(claimConversations.id, conversation.id));
  expect(await sendClaimMessage(input)).toMatchObject({
    ok: true,
    value: { created: true, message: { sequence: 1 } },
  });
});

test('parent cleanup cascades through conversation members and messages without orphan records', async () => {
  const { claim, conversation, owner } = await conversationFixture();
  await sendClaimMessage({
    conversationId: conversation.id,
    userId: owner.id,
    clientOperationId: crypto.randomUUID(),
    body: 'Test message',
  });
  await db.delete(claims).where(eq(claims.id, claim.id));
  expect(await db.select().from(claimConversations)).toHaveLength(0);
  expect(await db.select().from(claimConversationMembers)).toHaveLength(0);
  expect(await db.select().from(claimMessages)).toHaveLength(0);
});
