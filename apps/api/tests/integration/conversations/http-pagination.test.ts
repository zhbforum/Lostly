import { afterAll, beforeEach, expect, test } from 'bun:test';
import { eq, sql } from 'drizzle-orm';
import type {
  ClaimMessageResponse,
  ConversationInboxResponse,
  ConversationMessagesResponse,
} from '@lostly/contracts/conversations';
import { db } from '@/db';
import { claimConversations, claimConversationMembers } from '@/db/conversations';
import { decodeCursor } from '@/pagination/cursor';
import { clearDatabase, conversationFixture, user } from './fixtures';
import { room, seedMessages } from './read-fixtures';
import { jsonOf, request, send } from './http-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

test('HTTP history pages backwards and catches up forwards without gaps, duplicates or implicit reads', async () => {
  const { conversation, owner, claimant } = await conversationFixture();
  const messages = await seedMessages(
    conversation.id,
    Array.from({ length: 230 }, () => claimant.id),
  );
  const pointers = await db.select().from(claimConversationMembers);
  const history = (query = '') =>
    jsonOf<ConversationMessagesResponse>(
      request(`/conversations/${conversation.id}/messages${query}`, owner.cookie),
    );
  const latest = await history();
  expect(latest.messages.map((message) => message.sequence)).toEqual(
    Array.from({ length: 50 }, (_, index) => index + 181),
  );
  expect(latest.pageInfo.hasMore).toBe(true);
  let backwards = latest;
  const oldIds = latest.messages.map((message) => message.id);
  while (backwards.pageInfo.hasMore) {
    backwards = await history(`?before=${backwards.messages[0]!.sequence}&limit=50`);
    oldIds.unshift(...backwards.messages.map((message) => message.id));
  }
  expect(oldIds).toEqual(messages.map((message) => message.id));
  expect(new Set(oldIds).size).toBe(230);
  const first = await history('?after=0&limit=100');
  expect(first.messages.map((message) => message.sequence)).toEqual(
    Array.from({ length: 100 }, (_, index) => index + 1),
  );
  expect(first.pageInfo.hasMore).toBe(true);
  const added = await jsonOf<ClaimMessageResponse>(send(conversation.id, claimant.cookie), 201);
  const second = await history('?after=100&limit=100');
  const third = await history('?after=200&limit=100');
  expect(second.pageInfo.hasMore).toBe(true);
  expect(third.pageInfo.hasMore).toBe(false);
  const caughtUp = [...first.messages, ...second.messages, ...third.messages];
  expect(caughtUp.map((message) => message.sequence)).toEqual(
    Array.from({ length: 231 }, (_, index) => index + 1),
  );
  expect(caughtUp.map((message) => message.id)).toEqual([...oldIds, added.message.id]);
  expect(new Set(caughtUp.map((message) => message.id)).size).toBe(231);
  expect(await history('?after=231')).toEqual({ messages: [], pageInfo: { hasMore: false } });
  expect(await history('?before=1')).toEqual({ messages: [], pageInfo: { hasMore: false } });
  expect(await db.select().from(claimConversationMembers)).toEqual(pointers);
});

test('HTTP empty history and after=0 work, while combined boundaries return 400', async () => {
  const { conversation, owner } = await conversationFixture();
  for (const query of ['', '?after=0', '?before=1']) {
    expect(
      await jsonOf<ConversationMessagesResponse>(
        request(`/conversations/${conversation.id}/messages${query}`, owner.cookie),
      ),
    ).toEqual({ messages: [], pageInfo: { hasMore: false } });
  }
  expect(
    await jsonOf(
      request(`/conversations/${conversation.id}/messages?before=84&after=0`, owner.cookie),
      400,
    ),
  ).toMatchObject({ error: { code: 'INVALID_MESSAGE_QUERY' } });
});

test('HTTP inbox cursor preserves microseconds, ID tie-breaks and authenticated account scope', async () => {
  const owner = await user('owner');
  const claimant = await user('claimant');
  const rooms = await Promise.all(Array.from({ length: 4 }, () => room(owner.id, claimant.id)));
  rooms.sort((a, b) => a.id.localeCompare(b.id));
  for (const [index, conversation] of rooms.entries()) {
    const timestamp = index < 2 ? '2026-01-01T10:00:00.123200Z' : '2026-01-01T10:00:00.123100Z';
    await db
      .update(claimConversations)
      .set({ createdAt: sql`${timestamp}::timestamptz` })
      .where(eq(claimConversations.id, conversation.id));
  }
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 4; page++) {
    const result: ConversationInboxResponse = await jsonOf<ConversationInboxResponse>(
      request(
        '/me/conversations?limit=1' + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''),
        owner.cookie,
      ),
    );
    ids.push(...result.conversations.map((conversation) => conversation.id));
    expect(result.conversations[0]!.lastActivityAt).toBe('2026-01-01T10:00:00.123Z');
    expect(result.pageInfo.hasNextPage).toBe(page < 3);
    cursor = result.pageInfo.endCursor;
    if (cursor) {
      expect(decodeCursor(cursor, `conversation-inbox:${owner.id}`)?.value).toBe(
        page < 2 ? '2026-01-01T10:00:00.123200Z' : '2026-01-01T10:00:00.123100Z',
      );
      expect(
        await jsonOf(
          request('/me/conversations?cursor=' + encodeURIComponent(cursor), claimant.cookie),
          400,
        ),
      ).toMatchObject({ error: { code: 'INVALID_CURSOR' } });
    }
  }
  expect(ids).toEqual([rooms[1]!.id, rooms[0]!.id, rooms[3]!.id, rooms[2]!.id]);
  expect(cursor).toBeNull();
  expect(
    await jsonOf(request('/me/conversations?cursor=invalid', owner.cookie), 400),
  ).toMatchObject({ error: { code: 'INVALID_CURSOR' } });
});

test('HTTP inbox is live: send moves a room above a cursor; refresh finds it; reads and decisions never reorder', async () => {
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
  const first = await jsonOf<ConversationInboxResponse>(
    request('/me/conversations?limit=1', owner.cookie),
  );
  expect(first.conversations[0]!.id).toBe(newer.id);
  const sent = await jsonOf<ClaimMessageResponse>(send(older.id, claimant.cookie), 201);
  const next = await jsonOf<ConversationInboxResponse>(
    request(
      '/me/conversations?cursor=' + encodeURIComponent(first.pageInfo.endCursor!),
      owner.cookie,
    ),
  );
  expect(next.conversations).toEqual([]);
  const refreshed = await jsonOf<ConversationInboxResponse>(
    request('/me/conversations', owner.cookie),
  );
  expect(refreshed.conversations.map((conversation) => conversation.id)).toEqual([
    older.id,
    newer.id,
  ]);
  await jsonOf(
    request(`/conversations/${older.id}/read`, owner.cookie, { messageId: sent.message.id }),
  );
  await jsonOf(
    request(`/claims/${newer.claim.id}`, owner.cookie, { decision: 'rejected' }, 'PATCH'),
  );
  const after = await jsonOf<ConversationInboxResponse>(request('/me/conversations', owner.cookie));
  expect(after.conversations.map(({ id, lastActivityAt }) => ({ id, lastActivityAt }))).toEqual(
    refreshed.conversations.map(({ id, lastActivityAt }) => ({ id, lastActivityAt })),
  );
});
