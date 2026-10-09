import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import type { AdminReview } from '@lostly/contracts/admin';
import { createApp } from '@/app';
import { db } from '@/db';
import { moderationEvents, users } from '@/db/schema';
import { listingImages } from '@/db/listing-images';
import { setListingVisibility } from '@/admin/service';
import { createImageUploader } from '@/listing-images/upload';
import { createImageProcessingAdmission } from '@/image-upload/processing-admission';
import { clearDatabase, report, user, claim } from './listings/management-fixtures';
import { imageFixture } from '@tests/support/image-fixture';
import { MemoryObjectStorage } from '@tests/support/memory-storage';

async function clear() {
  await db.delete(moderationEvents);
  await clearDatabase();
}
beforeEach(clear);
afterAll(clear);

async function setup() {
  const actor = await user('photo-moderator');
  await db.update(users).set({ role: 'admin' }).where(eq(users.id, actor.id));
  const owner = await user('photo-owner');
  const listing = await report(owner.id);
  const storage = new MemoryObjectStorage();
  const app = createApp(storage);
  const file = await imageFixture();
  const input = {
    listingId: listing.id,
    ownerUserId: owner.id,
    requestId: crypto.randomUUID(),
    file,
  };
  const upload = createImageUploader(storage, createImageProcessingAdmission());
  const image = (await upload(input)).image;
  function request(path: string, cookie?: string, body?: unknown, method = 'GET', headers = {}) {
    return app.handle(
      new Request('http://localhost' + path, {
        method,
        headers: {
          'X-CSRF-Protection': '1',
          ...(cookie ? { Cookie: cookie } : {}),
          ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body:
          body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
      }),
    );
  }
  return { actor, owner, listing, storage, input, upload, image, request };
}

test('hiding blocks photo upload, replay, deletion and reorder while retaining photos for admin review and restoration', async () => {
  const { actor, owner, listing, storage, input, image, request } = await setup();
  const path = `/listings/${listing.id}`;
  await setListingVisibility(listing.id, actor.id, 'hide', {
    expectedVersion: 1,
    reason: 'Photo policy violation',
  });
  const put = spyOn(storage, 'put');
  try {
    for (const requestId of [input.requestId, crypto.randomUUID()]) {
      const form = new FormData();
      form.append('file', input.file);
      expect(
        (
          await request(path + '/images', owner.cookie, form, 'POST', {
            'Idempotency-Key': requestId,
          })
        ).status,
      ).toBe(404);
    }
    expect(
      (await request(path + '/images/' + image.id, owner.cookie, undefined, 'DELETE')).status,
    ).toBe(404);
    expect(
      (await request(path + '/images/order', owner.cookie, { imageIds: [image.id] }, 'PUT')).status,
    ).toBe(404);
    expect((await request(path, owner.cookie)).status).toBe(404);
    expect(put).not.toHaveBeenCalled();
    expect(storage.objects.size).toBe(1);
    const reviewPath = `/admin/listings/${listing.id}/review`;
    expect((await request(reviewPath)).status).toBe(401);
    expect((await request(reviewPath, owner.cookie)).status).toBe(403);
    const response = await request(reviewPath, actor.cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const review = (await response.json()) as AdminReview;
    expect(review.images[0]?.id).toBe(image.id);
    expect(review.events.items[0]).toMatchObject({
      actorUserId: actor.id,
      actorName: 'photo-moderator',
      action: 'hide_listing',
      reason: 'Photo policy violation',
    });
    await setListingVisibility(listing.id, actor.id, 'restore', {
      expectedVersion: 2,
      reason: 'Reviewed and restored',
    });
    expect((await request(path, owner.cookie)).status).toBe(200);
    expect(
      (await request(path + '/images/order', owner.cookie, { imageIds: [image.id] }, 'PUT')).status,
    ).toBe(200);
  } finally {
    put.mockRestore();
  }
});

test('an upload already in storage cannot commit after hiding; its extra object is removed', async () => {
  const { actor, listing, storage, input, upload } = await setup();
  const stored = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const put = storage.put.bind(storage);
  const spy = spyOn(storage, 'put').mockImplementation(async (...args) => {
    await put(...args);
    stored.resolve();
    await release.promise;
  });
  const pending = Promise.allSettled([upload({ ...input, requestId: crypto.randomUUID() })]);
  try {
    await stored.promise;
    await setListingVisibility(listing.id, actor.id, 'hide', {
      expectedVersion: 1,
      reason: 'Hidden during upload',
    });
    release.resolve();
    expect((await pending)[0]).toMatchObject({
      status: 'rejected',
      reason: { reason: 'listing-not-found' },
    });
    expect(storage.objects.size).toBe(1);
    expect(await db.select().from(listingImages)).toHaveLength(1);
  } finally {
    release.resolve();
    await pending;
    spy.mockRestore();
  }
});

test('review history has scoped cursors, preserves deleted actors and never reveals claim proof', async () => {
  const { actor, owner, listing, request } = await setup();
  const deleted = await user('former-moderator');
  await db.insert(moderationEvents).values(
    [1, 2, 3].map(() => ({
      actorUserId: deleted.id,
      targetId: listing.id,
      action: 'hide_listing' as const,
      reason: 'Historical reason',
      createdAt: new Date('2026-09-01T12:00:00Z'),
    })),
  );
  await db.delete(users).where(eq(users.id, deleted.id));
  const path = `/admin/listings/${listing.id}/review`;
  const first = (await (await request(path + '?limit=2', actor.cookie)).json()) as AdminReview;
  expect(first.events.items).toHaveLength(2);
  expect(first.events.items[0]).toMatchObject({ actorUserId: deleted.id, actorName: null });
  const cursor = encodeURIComponent(first.events.pageInfo.endCursor!);
  const next = (await (
    await request(path + '?limit=2&cursor=' + cursor, actor.cookie)
  ).json()) as AdminReview;
  expect(new Set([...first.events.items, ...next.events.items].map((event) => event.id)).size).toBe(
    3,
  );
  const other = await report(owner.id);
  expect(
    (await request(`/admin/listings/${other.id}/review?cursor=${cursor}`, actor.cookie)).status,
  ).toBe(400);
  expect(
    (await request('/admin/listings/' + crypto.randomUUID() + '/review', actor.cookie)).status,
  ).toBe(404);
  const proof = await claim(listing.id, actor.id);
  const claimPath = `/admin/claims/${proof.id}/review`;
  expect((await request(claimPath, owner.cookie)).status).toBe(403);
  const response = await request(claimPath, actor.cookie);
  expect(response.status).toBe(200);
  const body = (await response.json()) as AdminReview;
  expect(body.images).toEqual([]);
  expect(JSON.stringify(body)).not.toContain('Private proof');
  await db.update(users).set({ role: 'user' }).where(eq(users.id, actor.id));
  expect((await request(path, actor.cookie)).status).toBe(403);
});
