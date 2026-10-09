import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { ConversationMessagesResponse } from '@lostly/contracts/conversations';
import { db } from '@/db';
import { claimConversationMembers } from '@/db/conversations';
import { listings, users } from '@/db/schema';
import { StorageUnavailableError } from '@/storage/object-storage';
import { runInListingLockOrder } from '@tests/support/listing-lock-order';
import { clearDatabase, conversationFixture, user } from './fixtures';
import { seedAttachmentMessage } from './attachment-fixtures';
import { jsonOf, request, storage } from './http-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

test.each([false, true])(
  'history URL issuance versus hide, hide acquires listing lock first: %s',
  async (hideFirst) => {
    const fixture = await conversationFixture();
    const { message } = await seedAttachmentMessage(fixture);
    const moderator = await user('moderator');
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, moderator.id));
    const pointers = await db.select().from(claimConversationMembers);
    const events: string[] = [];
    const originalSign = storage.createReadUrl.bind(storage);
    const sign = spyOn(storage, 'createReadUrl').mockImplementation((...args) => {
      events.push('signed');
      return originalSign(...args);
    });
    const history = () =>
      request(`/conversations/${fixture.conversation.id}/messages`, fixture.owner.cookie);
    const hide = async () => {
      const response = await request(
        `/admin/listings/${fixture.listing.id}/hide`,
        moderator.cookie,
        {
          expectedVersion: 1,
          reason: 'Attachment authorization race',
        },
      );
      expect(response.status).toBe(204);
      events.push('hide-committed');
      return response;
    };
    try {
      // Uses real transactions and pg_blocking_pids to prove the second request is waiting
      // on the first listing lock, before either request is allowed to finish.
      const { responses } = await runInListingLockOrder(
        hideFirst ? hide : history,
        hideFirst ? history : hide,
      );
      const response = responses[hideFirst ? 1 : 0];
      if (hideFirst) {
        expect(await jsonOf(response, 404)).toMatchObject({
          error: { code: 'CONVERSATION_NOT_FOUND' },
        });
        expect(sign).not.toHaveBeenCalled();
        expect(events).toEqual(['hide-committed']);
      } else {
        const result = await jsonOf<ConversationMessagesResponse>(response);
        expect(result.messages[0]).toMatchObject({
          id: message.id,
          attachments: [{ kind: 'image' }],
        });
        expect(sign).toHaveBeenCalledTimes(1);
        expect(events).toEqual(['signed', 'hide-committed']);
      }
      expect(await db.select().from(claimConversationMembers)).toEqual(pointers);
      const [listing] = await db.select().from(listings).where(eq(listings.id, fixture.listing.id));
      expect(listing!.isHidden).toBe(true);
      sign.mockClear();
      await jsonOf(history(), 404);
      expect(sign).not.toHaveBeenCalled();
    } finally {
      sign.mockRestore();
    }
  },
  15000,
);

test('a signing failure rolls back the read transaction and releases the listing lock for hide', async () => {
  const fixture = await conversationFixture();
  await seedAttachmentMessage(fixture);
  const moderator = await user('moderator');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, moderator.id));
  const sign = spyOn(storage, 'createReadUrl').mockImplementation(() => {
    throw new StorageUnavailableError();
  });
  try {
    const {
      responses: [history, hide],
    } = await runInListingLockOrder(
      () => request(`/conversations/${fixture.conversation.id}/messages`, fixture.owner.cookie),
      () =>
        request(`/admin/listings/${fixture.listing.id}/hide`, moderator.cookie, {
          expectedVersion: 1,
          reason: 'Hide after signing failure',
        }),
    );
    expect(await jsonOf(history, 503)).toMatchObject({
      error: { code: 'IMAGE_STORAGE_UNAVAILABLE' },
    });
    expect(sign).toHaveBeenCalledTimes(1);
    expect(hide.status).toBe(204);
  } finally {
    sign.mockRestore();
  }
}, 15000);
