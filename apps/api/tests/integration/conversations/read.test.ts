import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { claimConversations, claimConversationMembers } from '@/db/conversations';
import { users } from '@/db/schema';
import { readConversation } from '@/conversations/read';
import * as unread from '@/conversations/unread';
import { countUnreadConversations, findConversationDetail } from '@/conversations/queries';
import { sendClaimMessage } from '@/conversations/send';
import { decideClaim } from '@/claims/decide';
import { archiveOwnedListing } from '@/listings/management';
import { setListingVisibility } from '@/admin/service';
import { lockListing } from '@/listings/locking';
import { runInListingLockOrder } from '@tests/support/listing-lock-order';
import { clearDatabase, conversationFixture, user } from './fixtures';
import { room, seedMessages } from './read-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

async function fixture() {
  const state = await conversationFixture();
  const messages = await seedMessages(
    state.conversation.id,
    Array.from({ length: 50 }, () => state.claimant.id),
  );
  const input = {
    conversationId: state.conversation.id,
    userId: state.owner.id,
    messageId: messages[49]!.id,
  };
  return { ...state, messages, input };
}

test('read advances monotonically, is idempotent and returns the current unread count without moving inbox activity', async () => {
  const { conversation, owner, claimant, messages, input } = await fixture();
  const activity = await db.select().from(claimConversations);
  expect(await readConversation({ ...input, messageId: messages[41]!.id })).toEqual({
    ok: true,
    value: { lastReadSequence: 42, unreadCount: 8 },
  });
  expect(await countUnreadConversations(owner.id)).toEqual({ unreadConversationCount: 1 });
  for (const messageId of [input.messageId, input.messageId, messages[41]!.id]) {
    expect(await readConversation({ ...input, messageId })).toEqual({
      ok: true,
      value: { lastReadSequence: 50, unreadCount: 0 },
    });
  }
  expect(await countUnreadConversations(owner.id)).toEqual({ unreadConversationCount: 0 });
  expect(await db.select().from(claimConversations)).toEqual(activity);
  expect(
    await db
      .select()
      .from(claimConversationMembers)
      .where(
        and(
          eq(claimConversationMembers.conversationId, conversation.id),
          eq(claimConversationMembers.userId, claimant.id),
        ),
      ),
  ).toMatchObject([{ lastReadSequence: 0 }]);
});

test('acknowledging a displayed own message marks earlier incoming messages, never later ones', async () => {
  const { conversation, owner, claimant } = await conversationFixture();
  const messages = await seedMessages(conversation.id, [
    claimant.id,
    owner.id,
    claimant.id,
    owner.id,
  ]);
  expect(
    await readConversation({
      conversationId: conversation.id,
      userId: owner.id,
      messageId: messages[1]!.id,
    }),
  ).toEqual({ ok: true, value: { lastReadSequence: 2, unreadCount: 1 } });
  expect(
    await readConversation({
      conversationId: conversation.id,
      userId: owner.id,
      messageId: messages[3]!.id,
    }),
  ).toEqual({ ok: true, value: { lastReadSequence: 4, unreadCount: 0 } });
});

test('read hides nonexistent, foreign and inaccessible message targets without changing membership', async () => {
  const { owner, claimant, conversation, input } = await fixture();
  const stranger = await user('stranger');
  const admin = await user('admin');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));
  const foreign = await room(owner.id, claimant.id);
  const [foreignMessage] = await seedMessages(foreign.id, [claimant.id]);
  const before = await db.select().from(claimConversationMembers);
  for (const messageId of [foreignMessage!.id, crypto.randomUUID()]) {
    expect(await readConversation({ ...input, messageId })).toEqual({
      ok: false,
      reason: 'message-not-found',
    });
  }
  for (const viewer of [stranger, admin]) {
    expect(await readConversation({ ...input, userId: viewer.id })).toEqual({
      ok: false,
      reason: 'conversation-not-found',
    });
    await db
      .insert(claimConversationMembers)
      .values({ conversationId: conversation.id, userId: viewer.id });
    expect(await readConversation({ ...input, userId: viewer.id })).toEqual({
      ok: false,
      reason: 'conversation-not-found',
    });
    await db.delete(claimConversationMembers).where(eq(claimConversationMembers.userId, viewer.id));
  }
  expect(await readConversation({ ...input, conversationId: crypto.randomUUID() })).toEqual({
    ok: false,
    reason: 'conversation-not-found',
  });
  expect(await db.select().from(claimConversationMembers)).toEqual(before);
});

test.each(['approved', 'rejected'] as const)(
  'read remains available for %s claims on archived listings, including participant admins',
  async (decision) => {
    const { claim, listing, owner, input } = await fixture();
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, owner.id));
    expect(
      await decideClaim({
        claimId: claim.id,
        reviewerUserId: owner.id,
        ...(decision === 'approved'
          ? { decision, handoverDetails: 'Meet at reception' }
          : { decision }),
      }),
    ).toMatchObject({ ok: true });
    expect(
      await archiveOwnedListing({ listingId: listing.id, ownerUserId: owner.id }),
    ).toMatchObject({ ok: true });
    expect(await readConversation(input)).toEqual({
      ok: true,
      value: { lastReadSequence: 50, unreadCount: 0 },
    });
  },
);

test.each([false, true])('read 50 versus read 42, high pointer first: %s', async (highFirst) => {
  const { input, messages } = await fixture();
  const high = () => readConversation(input);
  const low = () => readConversation({ ...input, messageId: messages[41]!.id });
  const { responses } = await runInListingLockOrder(highFirst ? high : low, highFirst ? low : high);
  expect(responses[1]).toEqual({ ok: true, value: { lastReadSequence: 50, unreadCount: 0 } });
  expect(await readConversation(input)).toEqual({
    ok: true,
    value: { lastReadSequence: 50, unreadCount: 0 },
  });
});

test.each([false, true])('read 50 versus send 51, send first: %s', async (sendFirst) => {
  const { input, conversation, claimant, owner } = await fixture();
  const read = async () => {
    const result = await readConversation(input);
    expect(result).toEqual({
      ok: true,
      value: { lastReadSequence: 50, unreadCount: sendFirst ? 1 : 0 },
    });
  };
  const send = async () => {
    expect(
      await sendClaimMessage({
        conversationId: conversation.id,
        userId: claimant.id,
        clientOperationId: crypto.randomUUID(),
        body: 'Message 51',
      }),
    ).toMatchObject({ ok: true, value: { message: { sequence: 51 } } });
  };
  await runInListingLockOrder(sendFirst ? send : read, sendFirst ? read : send);
  expect(await readConversation(input)).toEqual({
    ok: true,
    value: { lastReadSequence: 50, unreadCount: 1 },
  });
  expect(await findConversationDetail(conversation.id, owner.id)).toMatchObject({ unreadCount: 1 });
});

test.each([false, true])('read versus hide, hide first: %s', async (hideFirst) => {
  const { input, listing, owner } = await fixture();
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, owner.id));
  const read = async () => {
    expect(await readConversation(input)).toEqual(
      hideFirst
        ? { ok: false, reason: 'conversation-not-found' }
        : { ok: true, value: { lastReadSequence: 50, unreadCount: 0 } },
    );
  };
  const hide = async () => {
    expect(
      await setListingVisibility(listing.id, owner.id, 'hide', {
        expectedVersion: 1,
        reason: 'Review',
      }),
    ).toBe('ok');
  };
  await runInListingLockOrder(hideFirst ? hide : read, hideFirst ? read : hide);
  expect(await readConversation(input)).toEqual({ ok: false, reason: 'conversation-not-found' });
  expect(await countUnreadConversations(owner.id)).toEqual({ unreadConversationCount: 0 });
  expect(
    await setListingVisibility(listing.id, owner.id, 'restore', {
      expectedVersion: 2,
      reason: 'Restore',
    }),
  ).toBe('ok');
  expect(await findConversationDetail(input.conversationId, owner.id)).toMatchObject({
    unreadCount: hideFirst ? 50 : 0,
  });
  expect(await readConversation(input)).toEqual({
    ok: true,
    value: { lastReadSequence: 50, unreadCount: 0 },
  });
});

test('read rechecks membership after acquiring the listing lock', async () => {
  const { listing, owner, conversation, input } = await fixture();
  await runInListingLockOrder(
    () =>
      db.transaction(async (tx) => {
        await lockListing(tx, listing.id);
        await tx
          .delete(claimConversationMembers)
          .where(
            and(
              eq(claimConversationMembers.conversationId, conversation.id),
              eq(claimConversationMembers.userId, owner.id),
            ),
          );
      }),
    async () => {
      expect(await readConversation(input)).toEqual({
        ok: false,
        reason: 'conversation-not-found',
      });
    },
  );
});

test('failure calculating the returned count rolls back the read pointer', async () => {
  const { input } = await fixture();
  const before = await db.select().from(claimConversationMembers);
  const spy = spyOn(unread, 'unreadMessageCount').mockReturnValue(sql<number>`1 / 0`);
  try {
    await expect(readConversation(input)).rejects.toThrow();
  } finally {
    spy.mockRestore();
  }
  expect(await db.select().from(claimConversationMembers)).toEqual(before);
  expect(await readConversation(input)).toEqual({
    ok: true,
    value: { lastReadSequence: 50, unreadCount: 0 },
  });
});
