import { afterAll, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { ConversationMessagesQuery } from '@lostly/contracts/conversations';
import { db } from '@/db';
import { claimMessages, claimConversationMembers } from '@/db/conversations';
import { findConversationMessages, listConversations } from '@/conversations/queries';
import { sendClaimMessage } from '@/conversations/send';
import { MemoryObjectStorage } from '@tests/support/memory-storage';
import { clearDatabase, user } from './fixtures';
import { room, seedMessages } from './read-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

async function fixture(count = 230) {
  const owner = await user('owner');
  const claimant = await user('claimant');
  const conversation = await room(owner.id, claimant.id);
  await seedMessages(
    conversation.id,
    Array.from({ length: count }, (_, i) => (i % 2 ? owner.id : claimant.id)),
  );
  return { owner, claimant, conversation };
}

function sequences(from: number, to: number) {
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}

async function page(id: string, userId: string, query: ConversationMessagesQuery = {}) {
  const result = await findConversationMessages(id, userId, query);
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

test('latest and before return the nearest older messages ascending, exclusively and without gaps', async () => {
  const { owner, conversation } = await fixture();
  const latest = await page(conversation.id, owner.id);
  expect(latest.messages.map((message) => message.sequence)).toEqual(sequences(181, 230));
  expect(latest.pageInfo.hasMore).toBe(true);
  const firstOlder = await page(conversation.id, owner.id, { before: 181, limit: 50 });
  expect(firstOlder.messages.map((message) => message.sequence)).toEqual(sequences(131, 180));
  const received = [...latest.messages];
  let before = 181;
  for (let i = 0; i < 5; i++) {
    const older = await page(conversation.id, owner.id, { before, limit: 50 });
    received.unshift(...older.messages);
    if (!older.pageInfo.hasMore) break;
    before = older.messages[0]!.sequence;
  }
  expect(received.map((message) => message.sequence)).toEqual(sequences(1, 230));
  expect(new Set(received.map((message) => message.id)).size).toBe(230);
  expect(await page(conversation.id, owner.id, { before: 1 })).toEqual({
    messages: [],
    pageInfo: { hasMore: false },
  });
  expect((await page(conversation.id, owner.id, { before: 51 })).pageInfo.hasMore).toBe(false);
  expect(
    (await page(conversation.id, owner.id, { before: 2147483647, limit: 1 })).messages[0]!.sequence,
  ).toBe(230);
});

test('after=0 catches up multiple pages and includes new concurrent sends without duplicates', async () => {
  const { owner, claimant, conversation } = await fixture();
  const pointers = await db.select().from(claimConversationMembers);
  const received = [] as Awaited<ReturnType<typeof page>>['messages'];
  let after = 0;
  for (let i = 0; i < 4; i++) {
    const newer = await page(conversation.id, owner.id, { after, limit: 100 });
    received.push(...newer.messages);
    expect(newer.messages[0]!.sequence).toBe(after + 1);
    after = newer.messages.at(-1)!.sequence;
    if (i === 0) {
      const sent = await Promise.all(
        [owner, claimant].map((sender) =>
          sendClaimMessage({
            conversationId: conversation.id,
            userId: sender.id,
            clientOperationId: crypto.randomUUID(),
            body: 'Arrived during catch-up',
          }),
        ),
      );
      expect(sent.every((result) => result.ok)).toBe(true);
    }
    if (!newer.pageInfo.hasMore) break;
  }
  expect(received.map((message) => message.sequence)).toEqual(sequences(1, 232));
  expect(new Set(received.map((message) => message.id)).size).toBe(232);
  expect(await page(conversation.id, owner.id, { after: 232 })).toEqual({
    messages: [],
    pageInfo: { hasMore: false },
  });
  expect(await page(conversation.id, owner.id, { after: 2147483647 })).toEqual({
    messages: [],
    pageInfo: { hasMore: false },
  });
  expect(await db.select().from(claimConversationMembers)).toEqual(pointers);
});

test('history and inbox previews follow sequence, never timestamp, and exclude operation keys', async () => {
  const { owner, claimant, conversation } = await fixture(3);
  const another = await room(owner.id, claimant.id);
  await seedMessages(another.id, [claimant.id]);
  await db
    .update(claimMessages)
    .set({ createdAt: new Date('2030-01-01T00:00:00Z') })
    .where(eq(claimMessages.sequence, 1));
  const messages = (await page(conversation.id, owner.id)).messages;
  expect(messages.map((message) => message.sequence)).toEqual([1, 2, 3]);
  for (const message of messages) {
    expect(message.conversationId).toBe(conversation.id);
    expect(Object.keys(message).sort()).toEqual(
      [
        'id',
        'conversationId',
        'sequence',
        'senderUserId',
        'body',
        'attachments',
        'createdAt',
      ].sort(),
    );
    expect(message.attachments).toEqual([]);
    expect(message.createdAt).toBeInstanceOf(Date);
  }
  const inbox = await listConversations(owner.id, {}, new MemoryObjectStorage());
  if (!inbox.ok) throw new Error(inbox.reason);
  expect(
    inbox.value.conversations.find((item) => item.id === conversation.id)!.lastMessage,
  ).toMatchObject({ id: messages[2]!.id, sequence: 3 });
  expect(await page(conversation.id, owner.id, { after: 1, limit: 1 })).toMatchObject({
    messages: [{ sequence: 2 }],
    pageInfo: { hasMore: true },
  });
  expect(await page(conversation.id, owner.id, { before: 3, limit: 1 })).toMatchObject({
    messages: [{ sequence: 2 }],
    pageInfo: { hasMore: true },
  });
});

test('empty rooms, exact page sizes and exclusive edges report directional hasMore accurately', async () => {
  const { owner, conversation } = await fixture(0);
  for (const query of [{}, { after: 0 }, { before: 1 }]) {
    expect(await page(conversation.id, owner.id, query)).toEqual({
      messages: [],
      pageInfo: { hasMore: false },
    });
  }
  await seedMessages(
    conversation.id,
    Array.from({ length: 100 }, () => owner.id),
  );
  for (const query of [{ limit: 100 }, { after: 0, limit: 100 }, { before: 101, limit: 100 }]) {
    const result = await page(conversation.id, owner.id, query);
    expect(result.messages.map((message) => message.sequence)).toEqual(sequences(1, 100));
    expect(result.pageInfo.hasMore).toBe(false);
  }
  const tail = await page(conversation.id, owner.id, { after: 50 });
  expect(tail.messages.map((message) => message.sequence)).toEqual(sequences(51, 100));
  expect(tail.pageInfo.hasMore).toBe(false);
});

test.each([
  { before: 1, after: 0 },
  { before: 0 },
  { before: -1 },
  { after: -1 },
  { after: 0.5 },
  { before: 1.5 },
  { after: Number.NaN },
  { before: Infinity },
  { after: 2147483648 },
  { before: 2147483648 },
  { limit: 0 },
  { limit: -1 },
  { limit: 101 },
  { limit: 1.5 },
  { limit: Number.NaN },
])('rejects ambiguous or out-of-range message pagination: %j', async (query) => {
  const { owner, conversation } = await fixture(0);
  expect(await findConversationMessages(conversation.id, owner.id, query)).toEqual({
    ok: false,
    reason: 'invalid-message-query',
  });
});
