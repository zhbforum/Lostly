import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { claimConversations, claimMessages } from '@/db/conversations';
import { sendClaimMessage } from '@/conversations/send';
import { createConversationSendRateLimiter } from '@/conversations/rate-limit';
import { decideClaim } from '@/claims/decide';
import { setListingVisibility } from '@/admin/service';
import { clearDatabase, conversationFixture, user } from './fixtures';
import { room } from './read-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

function quota() {
  const limiter = createConversationSendRateLimiter(1);
  let now = 0;
  return {
    consume: mock((conversationId: string, userId: string) => limiter(conversationId, userId, now)),
    resetWindow: () => {
      now += 60_000;
    },
  };
}

test('exhausted quota preserves matching replay and conflict priority without changing persisted state', async () => {
  const { conversation, owner } = await conversationFixture();
  const { consume } = quota();
  const input = {
    conversationId: conversation.id,
    userId: owner.id,
    clientOperationId: crypto.randomUUID(),
    body: '  Hello\r\nworld  ',
  };
  const first = await sendClaimMessage(input, consume);
  if (!first.ok) throw new Error('Expected first send');
  const before = await db.select().from(claimConversations);
  expect(await sendClaimMessage({ ...input, body: 'Hello\nworld' }, consume)).toEqual({
    ok: true,
    value: { created: false, message: first.value.message },
  });
  expect(await sendClaimMessage({ ...input, body: 'Different body' }, consume)).toEqual({
    ok: false,
    reason: 'idempotency-conflict',
  });
  expect(consume).toHaveBeenCalledTimes(1);
  expect(
    await sendClaimMessage(
      {
        ...input,
        conversationId: input.conversationId.toUpperCase(),
        clientOperationId: crypto.randomUUID(),
      },
      consume,
    ),
  ).toEqual({ ok: false, reason: 'rate-limited', retryAfterSeconds: 60 });
  expect(await db.select().from(claimMessages)).toHaveLength(1);
  expect(await db.select().from(claimConversations)).toEqual(before);
});

test('quota is separate for the other participant and another conversation', async () => {
  const { conversation, owner, claimant } = await conversationFixture();
  const other = await room(owner.id, claimant.id);
  const { consume } = quota();
  for (const [conversationId, userId] of [
    [conversation.id, owner.id],
    [conversation.id, claimant.id],
    [other.id, owner.id],
  ] as const) {
    const result = await sendClaimMessage(
      {
        conversationId,
        userId,
        body: 'Independent budget',
        clientOperationId: crypto.randomUUID(),
      },
      consume,
    );
    expect(result).toMatchObject({ ok: true, value: { created: true } });
  }
  expect(await db.select().from(claimMessages)).toHaveLength(3);
});

test.each([false, true])(
  'concurrent same-key requests consume one token, conflicting bodies: %s',
  async (conflict) => {
    const { conversation, owner } = await conversationFixture();
    const { consume } = quota();
    const input = {
      conversationId: conversation.id,
      userId: owner.id,
      clientOperationId: crypto.randomUUID(),
      body: 'First',
    };
    const results = await Promise.all([
      sendClaimMessage(input, consume),
      sendClaimMessage({ ...input, body: conflict ? 'Second' : input.body }, consume),
    ]);
    expect(results.filter((result) => result.ok && result.value.created)).toHaveLength(1);
    expect(results.filter((result) => result.ok && !result.value.created)).toHaveLength(
      conflict ? 0 : 1,
    );
    if (conflict)
      expect(results.find((result) => !result.ok)).toEqual({
        ok: false,
        reason: 'idempotency-conflict',
      });
    expect(consume).toHaveBeenCalledTimes(1);
    expect(await db.select().from(claimMessages)).toHaveLength(1);
    expect(await db.select().from(claimConversations)).toMatchObject([{ nextMessageSequence: 2 }]);
  },
);

test('concurrent new operations cannot overrun quota; denied operations can succeed in the next window', async () => {
  const { conversation, owner } = await conversationFixture();
  const { consume, resetWindow } = quota();
  const inputs = Array.from({ length: 6 }, () => ({
    conversationId: conversation.id,
    userId: owner.id,
    clientOperationId: crypto.randomUUID(),
    body: 'New operation',
  }));
  const results = await Promise.all(inputs.map((input) => sendClaimMessage(input, consume)));
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.filter((result) => !result.ok)).toEqual(
    Array.from({ length: 5 }, () => ({ ok: false, reason: 'rate-limited', retryAfterSeconds: 60 })),
  );
  expect(await db.select().from(claimMessages)).toHaveLength(1);
  expect(await db.select().from(claimConversations)).toMatchObject([{ nextMessageSequence: 2 }]);
  resetWindow();
  const denied = inputs[results.findIndex((result) => !result.ok)]!;
  expect(await sendClaimMessage(denied, consume)).toMatchObject({
    ok: true,
    value: { created: true, message: { sequence: 2 } },
  });
});

test('access, validation and read-only checks precede quota while rejected and restored rooms still replay', async () => {
  const { conversation, claim, listing, owner } = await conversationFixture();
  const stranger = await user('stranger');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, owner.id));
  const { consume } = quota();
  const input = {
    conversationId: conversation.id,
    userId: owner.id,
    clientOperationId: crypto.randomUUID(),
    body: 'Committed before closure',
  };
  expect(await sendClaimMessage({ ...input, userId: stranger.id }, consume)).toEqual({
    ok: false,
    reason: 'conversation-not-found',
  });
  expect(await sendClaimMessage({ ...input, body: '   ' }, consume)).toEqual({
    ok: false,
    reason: 'invalid-message',
  });
  expect(await sendClaimMessage({ ...input, clientOperationId: 'invalid' }, consume)).toEqual({
    ok: false,
    reason: 'invalid-operation-id',
  });
  expect(consume).not.toHaveBeenCalled();
  const sent = await sendClaimMessage(input, consume);
  if (!sent.ok) throw new Error('Expected committed send');
  expect(
    await decideClaim({ claimId: claim.id, reviewerUserId: owner.id, decision: 'rejected' }),
  ).toMatchObject({ ok: true });
  const replay = { ok: true, value: { created: false, message: sent.value.message } } as const;
  expect(await sendClaimMessage(input, consume)).toEqual(replay);
  expect(await sendClaimMessage({ ...input, body: 'Different' }, consume)).toEqual({
    ok: false,
    reason: 'idempotency-conflict',
  });
  expect(
    await sendClaimMessage({ ...input, clientOperationId: crypto.randomUUID() }, consume),
  ).toEqual({ ok: false, reason: 'conversation-read-only' });
  expect(
    await setListingVisibility(listing.id, owner.id, 'hide', {
      expectedVersion: 1,
      reason: 'Review',
    }),
  ).toBe('ok');
  expect(await sendClaimMessage(input, consume)).toEqual({
    ok: false,
    reason: 'conversation-not-found',
  });
  expect(
    await setListingVisibility(listing.id, owner.id, 'restore', {
      expectedVersion: 2,
      reason: 'Restore',
    }),
  ).toBe('ok');
  expect(await sendClaimMessage(input, consume)).toEqual(replay);
  expect(consume).toHaveBeenCalledTimes(1);
});

test('a database rollback preserves message state but does not refund a new-attempt quota token', async () => {
  const { conversation, owner } = await conversationFixture();
  const { consume, resetWindow } = quota();
  await db
    .update(claimConversations)
    .set({ nextMessageSequence: 2147483647 })
    .where(eq(claimConversations.id, conversation.id));
  const input = {
    conversationId: conversation.id,
    userId: owner.id,
    clientOperationId: crypto.randomUUID(),
    body: 'Retry after rollback',
  };
  await expect(sendClaimMessage(input, consume)).rejects.toThrow();
  expect(await db.select().from(claimMessages)).toEqual([]);
  expect(await db.select().from(claimConversations)).toMatchObject([
    { nextMessageSequence: 2147483647, lastMessageAt: null },
  ]);
  await db
    .update(claimConversations)
    .set({ nextMessageSequence: 1 })
    .where(eq(claimConversations.id, conversation.id));
  expect(await sendClaimMessage(input, consume)).toEqual({
    ok: false,
    reason: 'rate-limited',
    retryAfterSeconds: 60,
  });
  resetWindow();
  expect(await sendClaimMessage(input, consume)).toMatchObject({
    ok: true,
    value: { created: true, message: { sequence: 1 } },
  });
});
