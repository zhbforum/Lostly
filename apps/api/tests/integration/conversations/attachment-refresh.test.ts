import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  claimConversationMembers,
  claimMessages,
  claimMessageAttachments,
} from '@/db/conversations';
import { claims, listings, users } from '@/db/schema';
import { sendClaimMessage } from '@/conversations/send';
import { StorageUnavailableError } from '@/storage/object-storage';
import { runInListingLockOrder } from '@tests/support/listing-lock-order';
import { attachmentHttpApp, attachmentSendFixture } from './attachment-send-fixtures';
import { clearDatabase, user } from './fixtures';
import { room } from './read-fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

test('refresh preserves identities and all read/message state; pending/approved/rejected participants can read', async () => {
  const fixture = await attachmentSendFixture();
  fixture.input.images = Array.from({ length: 4 }, () => fixture.input.images[0]!);
  const sent = await fixture.send(fixture.input);
  if (!sent.ok) throw new Error('Expected send');
  const { api } = attachmentHttpApp(fixture.storage);
  const endpoint = `/conversations/${fixture.conversation.id}/messages/${sent.value.message.id}/attachments/refresh`;
  const state = {
    members: await db.select().from(claimConversationMembers),
    messages: await db.select().from(claimMessages),
    attachments: await db.select().from(claimMessageAttachments),
  };
  const sign = spyOn(fixture.storage, 'createReadUrl');
  try {
    for (const status of ['pending', 'approved', 'rejected'] as const) {
      await db.update(claims).set({ status }).where(eq(claims.id, fixture.claim.id));
      for (const cookie of [fixture.owner.cookie, fixture.claimant.cookie]) {
        const response = await api.handle(
          new Request('http://localhost' + endpoint, {
            method: 'POST',
            headers: { Cookie: cookie, 'X-CSRF-Protection': '1' },
          }),
        );
        expect(response.status).toBe(200);
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        const result = (await response.json()) as {
          attachments: { id: string; position: number }[];
        };
        expect(result.attachments.map((a) => a.id)).toEqual(
          sent.value.message.attachments.map((a) => a.id),
        );
      }
    }
    expect(sign.mock.calls.every(([, ttl]) => ttl === 900)).toBe(true);
    expect(fixture.quota).toHaveBeenCalledTimes(1);
    expect(await db.select().from(claimConversationMembers)).toEqual(state.members);
    expect(await db.select().from(claimMessages)).toEqual(state.messages);
    expect(await db.select().from(claimMessageAttachments)).toEqual(state.attachments);
  } finally {
    sign.mockRestore();
  }
});

test('refresh enforces session/CSRF/member access and message+conversation pairing; text returns an empty array', async () => {
  const fixture = await attachmentSendFixture();
  const text = await sendClaimMessage({ ...fixture.input, body: 'text' });
  if (!text.ok) throw new Error('Expected text');
  const { api } = attachmentHttpApp(fixture.storage);
  const endpoint = `/conversations/${fixture.conversation.id}/messages/${text.value.message.id}/attachments/refresh`;
  const refresh = (path = endpoint, cookie?: string, csrf = true) =>
    api.handle(
      new Request('http://localhost' + path, {
        method: 'POST',
        headers: {
          ...(cookie ? { Cookie: cookie } : {}),
          ...(csrf ? { 'X-CSRF-Protection': '1' } : {}),
        },
      }),
    );
  expect((await refresh()).status).toBe(401);
  expect((await refresh(endpoint, fixture.owner.cookie, false)).status).toBe(403);
  expect(await (await refresh(endpoint, fixture.claimant.cookie)).json()).toEqual({
    attachments: [],
  });
  const stranger = await user('refresh-outsider');
  for (const role of ['user', 'admin'] as const) {
    await db.update(users).set({ role }).where(eq(users.id, stranger.id));
    expect(await (await refresh(endpoint, stranger.cookie)).json()).toMatchObject({
      error: { code: 'CONVERSATION_NOT_FOUND' },
    });
  }
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, fixture.owner.id));
  expect((await refresh(endpoint, fixture.owner.cookie)).status).toBe(200);
  const other = await room(fixture.owner.id, fixture.claimant.id);
  for (const path of [
    endpoint.replace(text.value.message.id, crypto.randomUUID()),
    endpoint.replace(fixture.conversation.id, other.id),
  ]) {
    const response = await refresh(path, fixture.owner.cookie);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: 'MESSAGE_NOT_FOUND' } });
  }
  await db.update(listings).set({ isHidden: true }).where(eq(listings.id, fixture.listing.id));
  const hidden = await refresh(endpoint, fixture.owner.cookie);
  expect(hidden.status).toBe(404);
  expect(await hidden.json()).toMatchObject({ error: { code: 'CONVERSATION_NOT_FOUND' } });
});

test.each([false, true])(
  'refresh SHARE serialization against hide, hide first: %s',
  async (hideFirst) => {
    const fixture = await attachmentSendFixture();
    const sent = await fixture.send(fixture.input);
    if (!sent.ok) throw new Error('Expected send');
    const { api } = attachmentHttpApp(fixture.storage);
    const moderator = await user('refresh-moderator');
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, moderator.id));
    const events: string[] = [];
    const sign = fixture.storage.createReadUrl.bind(fixture.storage);
    const signing = spyOn(fixture.storage, 'createReadUrl').mockImplementation((...args) => {
      events.push('signed');
      return sign(...args);
    });
    const refresh = () =>
      api.handle(
        new Request(
          `http://localhost/conversations/${fixture.conversation.id}/messages/${sent.value.message.id}/attachments/refresh`,
          {
            method: 'POST',
            headers: { Cookie: fixture.owner.cookie, 'X-CSRF-Protection': '1' },
          },
        ),
      );
    const hide = async () => {
      const response = await api.handle(
        new Request(`http://localhost/admin/listings/${fixture.listing.id}/hide`, {
          method: 'POST',
          headers: {
            Cookie: moderator.cookie,
            'X-CSRF-Protection': '1',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expectedVersion: 1, reason: 'Refresh race' }),
        }),
      );
      expect(response.status).toBe(204);
      events.push('hidden');
      return response;
    };
    try {
      const { responses } = await runInListingLockOrder(
        hideFirst ? hide : refresh,
        hideFirst ? refresh : hide,
      );
      expect(responses[hideFirst ? 1 : 0].status).toBe(hideFirst ? 404 : 200);
      expect(events).toEqual(hideFirst ? ['hidden'] : ['signed', 'hidden']);
    } finally {
      signing.mockRestore();
    }
  },
  15000,
);

test('failed refresh signing releases SHARE for a waiting hide', async () => {
  const fixture = await attachmentSendFixture();
  const sent = await fixture.send(fixture.input);
  if (!sent.ok) throw new Error('Expected send');
  const { api } = attachmentHttpApp(fixture.storage);
  const moderator = await user('refresh-moderator');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, moderator.id));
  const sign = spyOn(fixture.storage, 'createReadUrl').mockImplementation(() => {
    throw new StorageUnavailableError();
  });
  try {
    const { responses } = await runInListingLockOrder(
      () =>
        api.handle(
          new Request(
            `http://localhost/conversations/${fixture.conversation.id}/messages/${sent.value.message.id}/attachments/refresh`,
            {
              method: 'POST',
              headers: { Cookie: fixture.owner.cookie, 'X-CSRF-Protection': '1' },
            },
          ),
        ),
      () =>
        api.handle(
          new Request(`http://localhost/admin/listings/${fixture.listing.id}/hide`, {
            method: 'POST',
            headers: {
              Cookie: moderator.cookie,
              'X-CSRF-Protection': '1',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ expectedVersion: 1, reason: 'After failed refresh' }),
          }),
        ),
    );
    expect(responses.map((r) => r.status)).toEqual([503, 204]);
    expect(fixture.storage.objects.size).toBe(1);
  } finally {
    sign.mockRestore();
  }
}, 15000);
