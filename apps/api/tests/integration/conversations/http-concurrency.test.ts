import { afterAll, beforeEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { ClaimResponse } from '@lostly/contracts/claims';
import type {
  ClaimMessageResponse,
  ConversationResponse,
  ConversationMessagesResponse,
  ReadConversationResponse,
} from '@lostly/contracts/conversations';
import { db } from '@/db';
import { claimMessages } from '@/db/conversations';
import { users } from '@/db/schema';
import { runInListingLockOrder } from '@tests/support/listing-lock-order';
import { clearDatabase, conversationFixture, user } from './fixtures';
import { seedMessages } from './read-fixtures';
import { jsonOf, request, send } from './http-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

test.each([false, true])(
  'HTTP concurrent retry persists one operation, conflicting body: %s',
  async (conflict) => {
    const { conversation, claimant } = await conversationFixture();
    const key = crypto.randomUUID();
    const { responses } = await runInListingLockOrder(
      () => send(conversation.id, claimant.cookie, 'Original', key),
      () => send(conversation.id, claimant.cookie, conflict ? 'Different' : ' \r\nOriginal ', key),
    );
    const first = await jsonOf<ClaimMessageResponse>(responses[0], 201);
    if (conflict) {
      expect(await jsonOf(responses[1], 409)).toMatchObject({
        error: { code: 'IDEMPOTENCY_CONFLICT' },
      });
    } else {
      expect(await jsonOf<ClaimMessageResponse>(responses[1])).toEqual(first);
    }
    expect(await db.select().from(claimMessages)).toHaveLength(1);
  },
);

test('HTTP concurrent new sends persist strictly sequential messages', async () => {
  const { conversation, claimant, owner } = await conversationFixture();
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      jsonOf<ClaimMessageResponse>(
        send(conversation.id, index % 2 ? claimant.cookie : owner.cookie, `Message ${index}`),
        201,
      ),
    ),
  );
  expect(results.map(({ message }) => message.sequence).sort((a, b) => a - b)).toEqual(
    Array.from({ length: 12 }, (_, index) => index + 1),
  );
  expect(new Set(results.map(({ message }) => message.id)).size).toBe(12);
  expect(await db.select().from(claimMessages)).toHaveLength(12);
});

const transitions = [
  'reject',
  'approve-other',
  'resolve',
  'archive',
  'hide',
  'approve-self',
  'archive-approved',
] as const;
for (const transition of transitions) {
  test.each([false, true])(
    `HTTP send versus ${transition}, transition first: %s`,
    async (transitionFirst) => {
      const { conversation, listing, claim, owner, claimant } = await conversationFixture();
      const key = crypto.randomUUID();
      const original = await jsonOf<ClaimMessageResponse>(
        send(conversation.id, claimant.cookie, 'Before decision', key),
        201,
      );
      let competingId = '';
      if (transition === 'approve-other') {
        const other = await user('other');
        const competing = await jsonOf<ClaimResponse>(
          request(`/listings/${listing.id}/claims`, other.cookie, {
            verificationDetails: 'Another private proof',
          }),
          201,
        );
        competingId = competing.claim.id;
      }
      if (transition === 'archive-approved') {
        await jsonOf(
          request(
            `/claims/${claim.id}`,
            owner.cookie,
            {
              decision: 'approved',
              handoverDetails: 'Meet at reception',
            },
            'PATCH',
          ),
        );
      }
      if (transition === 'hide')
        await db.update(users).set({ role: 'admin' }).where(eq(users.id, owner.id));
      const staysWritable = transition === 'approve-self' || transition === 'archive-approved';
      const mutate = async () => {
        if (transition === 'hide') {
          expect(
            (
              await request(`/admin/listings/${listing.id}/hide`, owner.cookie, {
                expectedVersion: 1,
                reason: 'Review listing',
              })
            ).status,
          ).toBe(204);
        } else if (
          transition === 'resolve' ||
          transition === 'archive' ||
          transition === 'archive-approved'
        ) {
          await jsonOf(
            request(
              `/listings/${listing.id}/${transition === 'resolve' ? 'resolve' : 'archive'}`,
              owner.cookie,
              {},
            ),
          );
        } else {
          const decision = transition === 'reject' ? 'rejected' : 'approved';
          await jsonOf(
            request(
              `/claims/${competingId || claim.id}`,
              owner.cookie,
              {
                decision,
                ...(decision === 'approved' ? { handoverDetails: 'Meet at reception' } : {}),
              },
              'PATCH',
            ),
          );
        }
      };
      const sendDuring = async () => {
        const expected =
          !transitionFirst || staysWritable ? 201 : transition === 'hide' ? 404 : 409;
        const response = await jsonOf(
          send(conversation.id, claimant.cookie, 'During decision'),
          expected,
        );
        if (expected !== 201)
          expect(response).toMatchObject({
            error: {
              code: transition === 'hide' ? 'CONVERSATION_NOT_FOUND' : 'CONVERSATION_READ_ONLY',
            },
          });
      };
      await runInListingLockOrder(
        transitionFirst ? mutate : sendDuring,
        transitionFirst ? sendDuring : mutate,
      );
      expect(await db.select().from(claimMessages)).toHaveLength(
        !transitionFirst || staysWritable ? 2 : 1,
      );
      if (transition === 'hide') {
        expect((await request(`/conversations/${conversation.id}`, owner.cookie)).status).toBe(404);
        expect((await send(conversation.id, claimant.cookie, 'Before decision', key)).status).toBe(
          404,
        );
        return;
      }
      const context = await jsonOf<ConversationResponse>(
        request(`/conversations/${conversation.id}`, owner.cookie),
      );
      expect(context.conversation.canSendMessages).toBe(staysWritable);
      expect(context.conversation.claim.status).toBe(staysWritable ? 'approved' : 'rejected');
      const history = await jsonOf<ConversationMessagesResponse>(
        request(`/conversations/${conversation.id}/messages`, owner.cookie),
      );
      expect(history.messages[0]).toEqual(original.message);
      expect(
        await jsonOf<ClaimMessageResponse>(
          send(conversation.id, claimant.cookie, 'Before decision', key),
        ),
      ).toEqual(original);
      if (!staysWritable)
        expect(await jsonOf(send(conversation.id, claimant.cookie), 409)).toMatchObject({
          error: { code: 'CONVERSATION_READ_ONLY' },
        });
    },
  );
}

async function readFixture() {
  const state = await conversationFixture();
  const messages = await seedMessages(
    state.conversation.id,
    Array.from({ length: 50 }, () => state.claimant.id),
  );
  const read = (sequence = 50) =>
    request(`/conversations/${state.conversation.id}/read`, state.owner.cookie, {
      messageId: messages[sequence - 1]!.id,
    });
  return { ...state, read };
}

test.each([false, true])(
  'HTTP concurrent read 50 and read 42, high first: %s',
  async (highFirst) => {
    const { read } = await readFixture();
    const { responses } = await runInListingLockOrder(
      () => read(highFirst ? 50 : 42),
      () => read(highFirst ? 42 : 50),
    );
    expect(await jsonOf<ReadConversationResponse>(responses[0])).toEqual({
      lastReadSequence: highFirst ? 50 : 42,
      unreadCount: highFirst ? 0 : 8,
    });
    expect(await jsonOf<ReadConversationResponse>(responses[1])).toEqual({
      lastReadSequence: 50,
      unreadCount: 0,
    });
    expect(await jsonOf<ReadConversationResponse>(read(42))).toEqual({
      lastReadSequence: 50,
      unreadCount: 0,
    });
  },
);

test.each([false, true])('HTTP read 50 versus send 51, send first: %s', async (sendFirst) => {
  const { read, conversation, claimant } = await readFixture();
  const readDuring = async () => {
    expect(await jsonOf<ReadConversationResponse>(read())).toEqual({
      lastReadSequence: 50,
      unreadCount: sendFirst ? 1 : 0,
    });
  };
  const sendDuring = async () => {
    expect(
      (await jsonOf<ClaimMessageResponse>(send(conversation.id, claimant.cookie), 201)).message
        .sequence,
    ).toBe(51);
  };
  await runInListingLockOrder(
    sendFirst ? sendDuring : readDuring,
    sendFirst ? readDuring : sendDuring,
  );
  expect(await jsonOf<ReadConversationResponse>(read())).toEqual({
    lastReadSequence: 50,
    unreadCount: 1,
  });
});

test.each([false, true])('HTTP read versus hide, hide first: %s', async (hideFirst) => {
  const { read, listing, owner, conversation } = await readFixture();
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, owner.id));
  const readDuring = async () => {
    const response = await read();
    if (hideFirst)
      expect(await jsonOf(response, 404)).toMatchObject({
        error: { code: 'CONVERSATION_NOT_FOUND' },
      });
    else
      expect(await jsonOf<ReadConversationResponse>(response)).toEqual({
        lastReadSequence: 50,
        unreadCount: 0,
      });
  };
  const hide = async () => {
    expect(
      (
        await request(`/admin/listings/${listing.id}/hide`, owner.cookie, {
          expectedVersion: 1,
          reason: 'Review listing',
        })
      ).status,
    ).toBe(204);
  };
  await runInListingLockOrder(hideFirst ? hide : readDuring, hideFirst ? readDuring : hide);
  expect((await read()).status).toBe(404);
  expect(
    (
      await request(`/admin/listings/${listing.id}/restore`, owner.cookie, {
        expectedVersion: 2,
        reason: 'Restore listing',
      })
    ).status,
  ).toBe(204);
  const context = await jsonOf<ConversationResponse>(
    request(`/conversations/${conversation.id}`, owner.cookie),
  );
  expect(context.conversation.unreadCount).toBe(hideFirst ? 50 : 0);
});
