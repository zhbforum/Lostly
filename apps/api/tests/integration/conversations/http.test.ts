import { afterAll, beforeEach, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import type { ClaimResponse } from '@lostly/contracts/claims';
import type { ApiErrorResponse } from '@lostly/contracts/errors';
import type {
  ClaimMessageResponse,
  ConversationInboxResponse,
  ConversationMessagesResponse,
  ConversationResponse,
  ReadConversationResponse,
  UnreadConversationsResponse,
} from '@lostly/contracts/conversations';
import { db } from '@/db';
import { claimConversations, claimConversationMembers, claimMessages } from '@/db/conversations';
import { listingImages } from '@/db/listing-images';
import { sessions, users } from '@/db/schema';
import { generateSessionToken, getSessionExpiresAt, hashSessionToken } from '@/auth/session';
import { CONVERSATION_SEND_RATE_LIMIT } from '@/conversations/rate-limit';
import { clearDatabase, conversationFixture, report, user } from './fixtures';
import { room } from './read-fixtures';
import { app, jsonOf, origin, request, send } from './http-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

test('HTTP claim → conversation → send/replay → unread/read → approval and archived handover', async () => {
  const owner = await user('owner');
  const claimant = await user('claimant');
  const listing = await report(owner.id);
  await db.insert(listingImages).values({
    listingId: listing.id,
    objectKey: 'private/listing-cover.webp',
    contentType: 'image/webp',
    sizeBytes: 100,
    width: 40,
    height: 60,
    position: 0,
  });
  const { claim } = await jsonOf<ClaimResponse>(
    request(`/listings/${listing.id}/claims`, claimant.cookie, {
      verificationDetails: 'Only the claimant and owner can see this proof.',
    }),
    201,
  );
  const base = `/conversations/${claim.conversationId}`;
  const initial = await jsonOf<ConversationInboxResponse>(
    request('/me/conversations', owner.cookie),
  );
  expect(initial.conversations).toHaveLength(1);
  expect(initial.conversations[0]).toMatchObject({
    id: claim.conversationId,
    lastMessage: null,
    unreadCount: 0,
    otherParticipant: { id: claimant.id },
    canSendMessages: true,
  });
  expect(initial.conversations[0]!.listing.coverImage).toMatchObject({ width: 40, height: 60 });
  expect(initial.conversations[0]!.listing.coverImage!.url).toContain('?expires=');
  expect(initial.conversations[0]!.lastActivityAt).toBe(claim.createdAt);
  const detail = await jsonOf<ConversationResponse>(request(base, claimant.cookie));
  expect(detail.conversation).toMatchObject({
    participantRole: 'claimant',
    otherParticipant: { id: owner.id },
    claim: { verificationDetails: claim.verificationDetails },
  });
  expect(detail.conversation.claim.createdAt).toBe(claim.createdAt);
  const key = crypto.randomUUID();
  const raw = '  **No Markdown**\r\n<script>alert("text only")</script>  ';
  const sent = await jsonOf<ClaimMessageResponse>(
    send(claim.conversationId, claimant.cookie, raw, key),
    201,
  );
  expect(sent.message).toMatchObject({
    conversationId: claim.conversationId,
    senderUserId: claimant.id,
    sequence: 1,
    body: raw.trim().replaceAll('\r\n', '\n'),
  });
  expect(typeof sent.message.createdAt).toBe('string');
  expect(Object.keys(sent.message).sort()).toEqual(
    ['id', 'conversationId', 'sequence', 'senderUserId', 'body', 'createdAt'].sort(),
  );
  expect(
    await jsonOf<ClaimMessageResponse>(
      send(claim.conversationId, claimant.cookie, sent.message.body, key),
    ),
  ).toEqual(sent);
  expect(
    await jsonOf(send(claim.conversationId, claimant.cookie, 'Different', key), 409),
  ).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
  const pointers = await db.select().from(claimConversationMembers);
  for (const viewer of [owner, claimant]) {
    const unread = viewer.id === owner.id ? 1 : 0;
    const inbox = await jsonOf<ConversationInboxResponse>(
      request('/me/conversations', viewer.cookie),
    );
    expect(inbox.conversations[0]).toMatchObject({
      unreadCount: unread,
      lastMessage: { id: sent.message.id },
      lastActivityAt: sent.message.createdAt,
    });
    expect(
      await jsonOf<UnreadConversationsResponse>(
        request('/me/conversations/unread-count', viewer.cookie),
      ),
    ).toEqual({
      unreadConversationCount: unread,
    });
    expect(
      (await jsonOf<ConversationResponse>(request(base, viewer.cookie))).conversation.unreadCount,
    ).toBe(unread);
    expect(
      await jsonOf<ConversationMessagesResponse>(
        request(base + '/messages?after=0', viewer.cookie),
      ),
    ).toEqual({ messages: [sent.message], pageInfo: { hasMore: false } });
  }
  expect(await db.select().from(claimConversationMembers)).toEqual(pointers);
  for (let i = 0; i < 2; i++)
    expect(
      await jsonOf<ReadConversationResponse>(
        request(base + '/read', owner.cookie, { messageId: sent.message.id }),
      ),
    ).toEqual({ lastReadSequence: 1, unreadCount: 0 });
  expect(
    await jsonOf<UnreadConversationsResponse>(
      request('/me/conversations/unread-count', owner.cookie),
    ),
  ).toEqual({
    unreadConversationCount: 0,
  });
  const approved = await jsonOf<ClaimResponse>(
    request(
      `/claims/${claim.id}`,
      owner.cookie,
      { decision: 'approved', handoverDetails: 'Meet at the main entrance.' },
      'PATCH',
    ),
  );
  expect(approved.claim.conversationId).toBe(claim.conversationId);
  expect(
    (await jsonOf<ConversationResponse>(request(base, claimant.cookie))).conversation,
  ).toMatchObject({
    claim: { status: 'approved', handoverDetails: 'Meet at the main entrance.' },
    listing: { status: 'resolved' },
    canSendMessages: true,
  });
  await jsonOf(request(`/listings/${listing.id}/archive`, owner.cookie, {}));
  expect(
    (await jsonOf<ConversationResponse>(request(base, owner.cookie))).conversation.listing.status,
  ).toBe('archived');
  expect(
    (
      await jsonOf<ClaimMessageResponse>(
        send(claim.conversationId, owner.cookie, 'See you there'),
        201,
      )
    ).message.sequence,
  ).toBe(2);
  const spec = await request('/openapi/json');
  const text = await spec.text();
  expect(text).not.toContain(claim.verificationDetails);
  expect(text).not.toContain(sent.message.body);
});

test('strangers, unrelated admins and extra memberships receive the same 404 across private endpoints', async () => {
  const { conversation, owner, claimant } = await conversationFixture();
  const sent = await jsonOf<ClaimMessageResponse>(send(conversation.id, claimant.cookie), 201);
  const stranger = await user('stranger');
  const admin = await user('admin');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));
  for (const viewer of [stranger, admin]) {
    for (const corrupted of [false, true]) {
      if (corrupted)
        await db
          .insert(claimConversationMembers)
          .values({ conversationId: conversation.id, userId: viewer.id });
      for (const id of [conversation.id, crypto.randomUUID()]) {
        for (const response of [
          request(`/conversations/${id}`, viewer.cookie),
          request(`/conversations/${id}/messages`, viewer.cookie),
          send(id, viewer.cookie),
          request(`/conversations/${id}/read`, viewer.cookie, { messageId: sent.message.id }),
        ])
          expect(await jsonOf<ApiErrorResponse>(response, 404)).toEqual({
            error: { code: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' },
          });
      }
      expect(
        (
          await jsonOf<ConversationInboxResponse>(
            request('/me/conversations?userId=' + owner.id, viewer.cookie),
          )
        ).conversations,
      ).toEqual([]);
      expect(
        await jsonOf<UnreadConversationsResponse>(
          request('/me/conversations/unread-count', viewer.cookie),
        ),
      ).toEqual({
        unreadConversationCount: 0,
      });
    }
  }
  await db
    .delete(claimConversationMembers)
    .where(
      and(
        eq(claimConversationMembers.conversationId, conversation.id),
        eq(claimConversationMembers.userId, owner.id),
      ),
    );
  expect((await request(`/conversations/${conversation.id}`, owner.cookie)).status).toBe(404);
  expect((await send(conversation.id, owner.cookie)).status).toBe(404);
  expect(
    (
      await request(`/conversations/${conversation.id}/read`, owner.cookie, {
        messageId: sent.message.id,
      })
    ).status,
  ).toBe(404);
  expect(
    (await jsonOf<ConversationInboxResponse>(request('/me/conversations', owner.cookie)))
      .conversations,
  ).toEqual([]);
});

test('hide blocks all reads and retries; restore preserves history and read pointers', async () => {
  const { conversation, listing, owner, claimant } = await conversationFixture();
  const admin = await user('admin');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, admin.id));
  const key = crypto.randomUUID();
  const first = await jsonOf<ClaimMessageResponse>(
    send(conversation.id, claimant.cookie, 'First', key),
    201,
  );
  await jsonOf(
    request(`/conversations/${conversation.id}/read`, owner.cookie, {
      messageId: first.message.id,
    }),
  );
  const second = await jsonOf<ClaimMessageResponse>(
    send(conversation.id, claimant.cookie, 'Second'),
    201,
  );
  const pointers = await db.select().from(claimConversationMembers);
  expect(
    (
      await request(`/admin/listings/${listing.id}/hide`, admin.cookie, {
        expectedVersion: 1,
        reason: 'Review listing',
      })
    ).status,
  ).toBe(204);
  for (const viewer of [owner, claimant]) {
    for (const path of [
      `/conversations/${conversation.id}`,
      `/conversations/${conversation.id}/messages`,
    ])
      expect((await request(path, viewer.cookie)).status).toBe(404);
    expect(
      (
        await request(`/conversations/${conversation.id}/read`, viewer.cookie, {
          messageId: second.message.id,
        })
      ).status,
    ).toBe(404);
    expect(
      (await jsonOf<ConversationInboxResponse>(request('/me/conversations', viewer.cookie)))
        .conversations,
    ).toEqual([]);
    expect(
      await jsonOf<UnreadConversationsResponse>(
        request('/me/conversations/unread-count', viewer.cookie),
      ),
    ).toEqual({
      unreadConversationCount: 0,
    });
  }
  expect((await send(conversation.id, claimant.cookie, 'First', key)).status).toBe(404);
  expect(
    (
      await request(`/admin/listings/${listing.id}/restore`, admin.cookie, {
        expectedVersion: 2,
        reason: 'Restore listing',
      })
    ).status,
  ).toBe(204);
  expect(await db.select().from(claimConversationMembers)).toEqual(pointers);
  expect(
    await jsonOf<ClaimMessageResponse>(send(conversation.id, claimant.cookie, 'First', key)),
  ).toEqual(first);
  expect(
    (await jsonOf<ConversationResponse>(request(`/conversations/${conversation.id}`, owner.cookie)))
      .conversation.unreadCount,
  ).toBe(1);
  expect(
    await jsonOf<ConversationMessagesResponse>(
      request(`/conversations/${conversation.id}/messages`, owner.cookie),
    ),
  ).toEqual({ messages: [first.message, second.message], pageInfo: { hasMore: false } });
});

test('foreign and missing read targets are indistinguishable and never change read state', async () => {
  const { conversation, owner, claimant } = await conversationFixture();
  const other = await room(owner.id, claimant.id);
  const foreign = await jsonOf<ClaimMessageResponse>(send(other.id, claimant.cookie), 201);
  const before = await db.select().from(claimConversationMembers);
  for (const messageId of [foreign.message.id, crypto.randomUUID()]) {
    expect(
      await jsonOf<ApiErrorResponse>(
        request(`/conversations/${conversation.id}/read`, owner.cookie, { messageId }),
        404,
      ),
    ).toEqual({
      error: { code: 'MESSAGE_NOT_FOUND', message: 'Message not found in this conversation' },
    });
  }
  expect(await db.select().from(claimConversationMembers)).toEqual(before);
});

test('HTTP send uses domain Unicode normalization, rejects invalid text and offers no edit/delete/DM routes', async () => {
  const { conversation, owner } = await conversationFixture();
  const body = '😀'.repeat(2000);
  const sent = await jsonOf<ClaimMessageResponse>(
    send(conversation.id, owner.cookie, ' \r\n' + body + ' '),
    201,
  );
  expect(sent.message.body).toBe(body);
  for (const invalid of ['', ' \r\n ', 'a'.repeat(2001), '😀'.repeat(2001), '\0', '\ud800']) {
    const response = await send(conversation.id, owner.cookie, invalid);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  }
  for (const method of ['PATCH', 'DELETE'])
    expect(
      (
        await request(
          `/conversations/${conversation.id}/messages/${sent.message.id}`,
          owner.cookie,
          {},
          method,
        )
      ).status,
    ).toBe(404);
  expect((await request(`/users/${owner.id}/messages`, owner.cookie, { body: 'DM' })).status).toBe(
    404,
  );
  expect(await db.select().from(claimMessages)).toHaveLength(1);
});

test('exhausted HTTP quota retains replay/conflict semantics and exposes Retry-After for credentialed clients', async () => {
  const { conversation, owner, claimant } = await conversationFixture();
  const key = crypto.randomUUID();
  const first = await jsonOf<ClaimMessageResponse>(
    send(conversation.id, claimant.cookie, 'Retriable', key),
    201,
  );
  for (let i = 1; i < CONVERSATION_SEND_RATE_LIMIT.limit; i++)
    await jsonOf(send(conversation.id, claimant.cookie, 'New operation ' + i), 201);
  const before = await db.select().from(claimConversations);
  const rejected = await send(conversation.id, claimant.cookie);
  expect(await jsonOf(rejected, 429)).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  expect(Number(rejected.headers.get('Retry-After'))).toBeGreaterThan(0);
  expect(Number(rejected.headers.get('Retry-After'))).toBeLessThanOrEqual(60);
  expect(
    rejected.headers
      .get('Access-Control-Expose-Headers')
      ?.toLowerCase()
      .split(',')
      .map((value) => value.trim()),
  ).toContain('retry-after');
  expect(rejected.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  expect(rejected.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  expect(
    await jsonOf<ClaimMessageResponse>(send(conversation.id, claimant.cookie, 'Retriable', key)),
  ).toEqual(first);
  const conflict = await send(conversation.id, claimant.cookie, 'Conflict', key);
  expect(await jsonOf(conflict, 409)).toMatchObject({ error: { code: 'IDEMPOTENCY_CONFLICT' } });
  expect(conflict.headers.has('Retry-After')).toBe(false);
  expect(await db.select().from(claimConversations)).toEqual(before);
  const token = generateSessionToken();
  await db.insert(sessions).values({
    userId: claimant.id,
    tokenHash: hashSessionToken(token),
    expiresAt: getSessionExpiresAt(),
  });
  expect((await send(conversation.id, 'lostly_session=' + token)).status).toBe(429);
  await jsonOf(send(conversation.id, owner.cookie), 201);
  const preflight = await app.handle(
    new Request(`http://localhost/conversations/${conversation.id}/messages`, {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type,x-csrf-protection,idempotency-key',
      },
    }),
  );
  expect(preflight.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain(
    'idempotency-key',
  );
  expect(preflight.headers.get('Access-Control-Allow-Credentials')).toBe('true');
});
