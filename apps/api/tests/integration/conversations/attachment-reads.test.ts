import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { BunSQLSession } from 'drizzle-orm/bun-sql';
import type {
  ConversationInboxResponse,
  ConversationMessagesResponse,
  ReadConversationResponse,
} from '@lostly/contracts/conversations';
import { db } from '@/db';
import { claimMessages, claimConversationMembers } from '@/db/conversations';
import { claims, listings, users } from '@/db/schema';
import { findConversationMessages } from '@/conversations/queries';
import { clearDatabase, conversationFixture, user } from './fixtures';
import { seedAttachmentMessage } from './attachment-fixtures';
import { jsonOf, request, storage } from './http-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

test('history hydrates ordered attachments without changing message pagination or leaking internal fields', async () => {
  const fixture = await conversationFixture();
  const first = await seedAttachmentMessage(fixture, 'Historical text', []);
  const second = await seedAttachmentMessage(fixture, null, [3, 1, 0, 2]);
  const third = await seedAttachmentMessage(fixture, 'Caption', [0]);
  const pointers = await db.select().from(claimConversationMembers);
  const stored = await db.select().from(claimMessages);
  const base = `/conversations/${fixture.conversation.id}/messages`;
  const sign = spyOn(storage, 'createReadUrl');
  try {
    const latest = await jsonOf<ConversationMessagesResponse>(
      request(base + '?limit=1', fixture.owner.cookie),
    );
    expect(latest.messages.map((message) => message.id)).toEqual([third.message.id]);
    expect(latest.pageInfo.hasMore).toBe(true);
    expect(sign).toHaveBeenCalledTimes(1); // The extra row used for hasMore is never hydrated.
    sign.mockClear();
    const older = await jsonOf<ConversationMessagesResponse>(
      request(base + '?before=3&limit=1', fixture.owner.cookie),
    );
    expect(older.messages.map((message) => message.id)).toEqual([second.message.id]);
    expect(older.pageInfo.hasMore).toBe(true);
    expect(older.messages[0]!.body).toBeNull();
    expect(older.messages[0]!.attachments.map((image) => image.position)).toEqual([0, 1, 2, 3]);
    expect(sign).toHaveBeenCalledTimes(4);
    for (const row of second.attachments) expect(sign).toHaveBeenCalledWith(row.objectKey, 900);
    for (const image of older.messages[0]!.attachments) {
      expect(Object.keys(image).sort()).toEqual(
        ['id', 'kind', 'position', 'url', 'urlExpiresAt', 'width', 'height'].sort(),
      );
      expect(image).toMatchObject({ kind: 'image', width: 40, height: 60 });
      const remaining = Date.parse(image.urlExpiresAt) - Date.now();
      expect(remaining).toBeGreaterThan(890_000);
      expect(remaining).toBeLessThanOrEqual(900_000);
    }
    const all = await jsonOf<ConversationMessagesResponse>(
      request(base + '?after=0&limit=3', fixture.owner.cookie),
    );
    expect(all.messages.map((message) => message.id)).toEqual([
      first.message.id,
      second.message.id,
      third.message.id,
    ]);
    expect(all.pageInfo.hasMore).toBe(false);
    expect(all.messages[0]!.attachments).toEqual([]);
    for (const message of all.messages) {
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
    }
    const serialized = JSON.stringify(all);
    for (const row of stored) expect(serialized).not.toContain(row.clientOperationId);
    for (const row of second.attachments) expect(serialized).not.toContain(row.sourceHash);
    expect(await db.select().from(claimConversationMembers)).toEqual(pointers);
  } finally {
    sign.mockRestore();
  }
});

test('inbox counts attachments without signing their URLs; image-only read state counts messages', async () => {
  const fixture = await conversationFixture();
  const { message } = await seedAttachmentMessage(fixture, null, [0, 1, 2, 3]);
  const sign = spyOn(storage, 'createReadUrl');
  try {
    const inbox = await jsonOf<ConversationInboxResponse>(
      request('/me/conversations', fixture.owner.cookie),
    );
    expect(inbox.conversations[0]).toMatchObject({
      unreadCount: 1,
      lastMessage: { id: message.id, body: null, attachmentCount: 4 },
    });
    expect(Object.keys(inbox.conversations[0]!.lastMessage!).sort()).toEqual(
      ['id', 'sequence', 'senderUserId', 'body', 'attachmentCount', 'createdAt'].sort(),
    );
    expect(sign).not.toHaveBeenCalled();
    expect(
      await jsonOf<ReadConversationResponse>(
        request(`/conversations/${fixture.conversation.id}/read`, fixture.owner.cookie, {
          messageId: message.id,
        }),
      ),
    ).toEqual({ lastReadSequence: 1, unreadCount: 0 });
    const readInbox = await jsonOf<ConversationInboxResponse>(
      request('/me/conversations', fixture.owner.cookie),
    );
    expect(readInbox.conversations[0]!.unreadCount).toBe(0);
    expect(readInbox.conversations[0]!.lastMessage!.attachmentCount).toBe(4);
  } finally {
    sign.mockRestore();
  }
});

test('rejected conversations remain readable; nonparticipants, admins and hidden listings receive no attachment URLs', async () => {
  const fixture = await conversationFixture();
  const { message } = await seedAttachmentMessage(fixture);
  const stranger = await user('stranger');
  const admin = await user('admin');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));
  const base = `/conversations/${fixture.conversation.id}/messages`;
  const sign = spyOn(storage, 'createReadUrl');
  try {
    for (const cookie of [undefined, stranger.cookie, admin.cookie]) {
      await jsonOf(request(base, cookie), cookie ? 404 : 401);
    }
    expect(sign).not.toHaveBeenCalled();
    await db.update(claims).set({ status: 'rejected' }).where(eq(claims.id, fixture.claim.id));
    for (const viewer of [fixture.owner, fixture.claimant]) {
      const history = await jsonOf<ConversationMessagesResponse>(request(base, viewer.cookie));
      expect(history.messages[0]).toMatchObject({
        id: message.id,
        body: null,
        attachments: [{ kind: 'image' }],
      });
    }
    expect(sign).toHaveBeenCalledTimes(2);
    sign.mockClear();
    await db.update(listings).set({ isHidden: true }).where(eq(listings.id, fixture.listing.id));
    for (const viewer of [fixture.owner, fixture.claimant])
      await jsonOf(request(base, viewer.cookie), 404);
    expect(sign).not.toHaveBeenCalled();
    await db.update(listings).set({ isHidden: false }).where(eq(listings.id, fixture.listing.id));
    expect(
      (await jsonOf<ConversationMessagesResponse>(request(base, fixture.owner.cookie))).messages[0]!
        .id,
    ).toBe(message.id);
    expect(sign).toHaveBeenCalledTimes(1);
  } finally {
    sign.mockRestore();
  }
});

test('attachment hydration uses one batch query for an entire message page', async () => {
  const fixture = await conversationFixture();
  await seedAttachmentMessage(fixture, null, [0, 1, 2, 3]);
  await seedAttachmentMessage(fixture, 'Caption', [0, 1]);
  const execute = spyOn(BunSQLSession.prototype, 'prepareQuery');
  try {
    const history = await findConversationMessages(
      fixture.conversation.id,
      fixture.owner.id,
      {},
      storage,
    );
    expect(history.ok).toBe(true);
    // Reference/access, listing lock, authorized page, and one attachment batch.
    expect(execute).toHaveBeenCalledTimes(4);
    execute.mockClear();
    await findConversationMessages(
      fixture.conversation.id,
      fixture.owner.id,
      { limit: 1 },
      storage,
    );
    expect(execute).toHaveBeenCalledTimes(4);
  } finally {
    execute.mockRestore();
  }
});
