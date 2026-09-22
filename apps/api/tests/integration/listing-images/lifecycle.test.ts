import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { createApp } from '@/app';
import { db } from '@/db';
import { listings } from '@/db/schema';
import { listingImages, listingImageUploads } from '@/db/listing-images';
import { StorageUnavailableError } from '@/storage/object-storage';
import { MemoryObjectStorage } from '@tests/support/memory-storage';
import { imageFixture } from '@tests/support/image-fixture';
import { clearDatabase, report, user } from '@tests/integration/listings/management-fixtures';
import type {
  ListingDetailResponse,
  ListingImageResponse,
  ListingListResponse,
} from '@lostly/contracts/listings';
import type { ApiErrorResponse } from '@lostly/contracts/errors';

async function bodyOf<T>(response: Response | Promise<Response>): Promise<T> {
  return (await (await response).json()) as T;
}
const imageOf = async (response: Response | Promise<Response>) =>
  (await bodyOf<ListingImageResponse>(response)).image;

let storage: MemoryObjectStorage;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  await clearDatabase();
  storage = new MemoryObjectStorage();
  app = createApp(storage);
});
afterAll(clearDatabase);

function request(
  path: string,
  cookie?: string,
  body?: unknown,
  method = 'GET',
  extra: Record<string, string> = {},
) {
  const headers = new Headers({ 'X-CSRF-Protection': '1', ...extra });
  if (cookie) headers.set('Cookie', cookie);
  if (body !== undefined && !(body instanceof FormData))
    headers.set('Content-Type', 'application/json');
  return app.handle(
    new Request('http://localhost' + path, {
      method,
      headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    }),
  );
}

async function upload(
  listingId: string,
  cookie: string,
  requestId = crypto.randomUUID(),
  file?: File,
) {
  const form = new FormData();
  form.append('file', file ?? (await imageFixture()));
  return request(`/listings/${listingId}/images`, cookie, form, 'POST', {
    'Idempotency-Key': requestId,
  });
}

describe('listing photo HTTP lifecycle', () => {
  test('uploads, displays, reorders and deletes without modifying the listing', async () => {
    const owner = await user('photo-owner');
    const listing = await report(owner.id);
    const path = '/listings/' + listing.id;
    const firstResponse = await upload(listing.id, owner.cookie);
    expect(firstResponse.status).toBe(201);
    const first = await imageOf(firstResponse);
    const second = await imageOf(upload(listing.id, owner.cookie));
    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
    expect(first.width).toBe(32);
    expect(first.urlExpiresAt).toBeDefined();
    expect(Object.keys(first).sort()).toEqual([
      'height',
      'id',
      'position',
      'url',
      'urlExpiresAt',
      'width',
    ]);
    expect([...storage.objects.keys()][0]).toBe(`listings/${listing.id}/${first.id}.webp`);
    expect(JSON.stringify(first)).not.toContain('private-original-name');
    const detail = await bodyOf<ListingDetailResponse>(request(path, owner.cookie));
    expect(detail.images.map((image: { id: string }) => image.id)).toEqual([first.id, second.id]);
    expect(detail.capabilities.canManageImages).toBe(true);
    const ordered = await request(
      path + '/images/order',
      owner.cookie,
      { imageIds: [second.id, first.id] },
      'PUT',
    );
    expect(ordered.status).toBe(200);
    const feed = await bodyOf<ListingListResponse>(request('/listings', owner.cookie));
    expect(feed.listings[0]?.coverImage?.id).toBe(second.id);
    const mine = await bodyOf<ListingListResponse>(request('/me/listings', owner.cookie));
    expect(mine.listings[0]?.coverImage?.id).toBe(second.id);
    expect(
      (await request(path + '/images/' + second.id, owner.cookie, undefined, 'DELETE')).status,
    ).toBe(204);
    expect(storage.objects.size).toBe(1);
    const [remaining] = await db.select().from(listingImages);
    expect(remaining?.id).toBe(first.id);
    expect(remaining?.position).toBe(0);
    const [after] = await db.select().from(listings).where(eq(listings.id, listing.id));
    expect(after?.version).toBe(listing.version);
    expect(after?.updatedAt).toEqual(listing.updatedAt);
  });

  test('replays a committed upload, rejects changed payloads and never resurrects a deleted image', async () => {
    const owner = await user('photo-retry');
    const listing = await report(owner.id);
    const id = crypto.randomUUID();
    const first = await imageOf(upload(listing.id, owner.cookie, id));
    const replay = await upload(listing.id, owner.cookie, id);
    expect(replay.status).toBe(200);
    expect((await imageOf(replay)).id).toBe(first.id);
    expect(storage.objects.size).toBe(1);
    expect(
      (await upload(listing.id, owner.cookie, id, await imageFixture('png', '#ff0000'))).status,
    ).toBe(409);
    await request(`/listings/${listing.id}/images/${first.id}`, owner.cookie, undefined, 'DELETE');
    const deletedReplay = await upload(listing.id, owner.cookie, id);
    expect(deletedReplay.status).toBe(409);
    expect((await bodyOf<ApiErrorResponse>(deletedReplay)).error.code).toBe(
      'IMAGE_UPLOAD_CONFLICT',
    );
    expect(storage.objects.size).toBe(0);
    const [operation] = await db.select().from(listingImageUploads);
    expect(operation?.imageId).toBeNull();
  });

  test('checks ownership for every mutation and status before calling storage', async () => {
    const owner = await user('photo-owner');
    const other = await user('photo-other');
    const listing = await report(owner.id);
    const path = '/listings/' + listing.id + '/images';
    const image = await imageOf(upload(listing.id, owner.cookie));
    expect((await upload(listing.id, other.cookie)).status).toBe(403);
    expect((await request(path + '/' + image.id, other.cookie, undefined, 'DELETE')).status).toBe(
      403,
    );
    expect(
      (await request(path + '/order', other.cookie, { imageIds: [image.id] }, 'PUT')).status,
    ).toBe(403);
    for (const status of ['resolved', 'archived'] as const) {
      await db.update(listings).set({ status }).where(eq(listings.id, listing.id));
      expect((await upload(listing.id, owner.cookie)).status).toBe(409);
      expect((await request(path + '/' + image.id, owner.cookie, undefined, 'DELETE')).status).toBe(
        409,
      );
      expect(
        (await request(path + '/order', owner.cookie, { imageIds: [image.id] }, 'PUT')).status,
      ).toBe(409);
    }
    expect(storage.objects.size).toBe(1);
  });

  test('rejects missing, duplicate and foreign reorder IDs', async () => {
    const owner = await user('photo-order');
    const listing = await report(owner.id);
    const first = await imageOf(upload(listing.id, owner.cookie));
    const second = await imageOf(upload(listing.id, owner.cookie));
    for (const imageIds of [
      [],
      [first.id],
      [first.id, first.id],
      [first.id, crypto.randomUUID()],
    ]) {
      expect(
        (await request(`/listings/${listing.id}/images/order`, owner.cookie, { imageIds }, 'PUT'))
          .status,
      ).toBe(409);
    }
    expect(
      await db
        .select({ id: listingImages.id, position: listingImages.position })
        .from(listingImages)
        .orderBy(listingImages.position, listingImages.id),
    ).toEqual([
      { id: first.id, position: 0 },
      { id: second.id, position: 1 },
    ]);
  });

  test('keeps storage failures private and commits deletion when cleanup fails', async () => {
    const owner = await user('photo-failure');
    const listing = await report(owner.id);
    const log = spyOn(console, 'error').mockImplementation(() => {});
    const put = spyOn(storage, 'put').mockRejectedValue(new StorageUnavailableError());
    try {
      const failed = await upload(listing.id, owner.cookie);
      expect(failed.status).toBe(503);
      expect((await bodyOf<ApiErrorResponse>(failed)).error.code).toBe('IMAGE_STORAGE_UNAVAILABLE');
      expect(await db.select().from(listingImages)).toHaveLength(0);
    } finally {
      put.mockRestore();
    }
    const image = await imageOf(upload(listing.id, owner.cookie));
    const deletion = spyOn(storage, 'delete').mockRejectedValue(new StorageUnavailableError());
    try {
      expect(
        (
          await request(
            `/listings/${listing.id}/images/${image.id}`,
            owner.cookie,
            undefined,
            'DELETE',
          )
        ).status,
      ).toBe(204);
      expect(await db.select().from(listingImages)).toHaveLength(0);
      expect(log).toHaveBeenCalled();
    } finally {
      deletion.mockRestore();
      log.mockRestore();
    }
  });

  test('protects multipart with authentication, CSRF and strict single-file parsing', async () => {
    const owner = await user('photo-http');
    const listing = await report(owner.id);
    const path = `/listings/${listing.id}/images`;
    const form = new FormData();
    form.append('file', await imageFixture());
    expect((await request(path, undefined, form, 'POST')).status).toBe(401);
    expect(
      (
        await app.handle(
          new Request('http://localhost' + path, {
            method: 'POST',
            headers: { Cookie: owner.cookie },
            body: form,
          }),
        )
      ).status,
    ).toBe(403);
    form.append('file', await imageFixture());
    expect(
      (await request(path, owner.cookie, form, 'POST', { 'Idempotency-Key': crypto.randomUUID() }))
        .status,
    ).toBe(400);
    const invalid = await upload(
      listing.id,
      owner.cookie,
      crypto.randomUUID(),
      new File(['not a png'], 'file.png', { type: 'image/png' }),
    );
    expect(invalid.status).toBe(422);
    expect(storage.objects.size).toBe(0);
  });

  test('releases ingress slots after rejected requests and then accepts a valid upload', async () => {
    const owner = await user('photo-ingress');
    const listing = await report(owner.id);
    const path = `/listings/${listing.id}/images`;
    for (let attempt = 0; attempt < 6; attempt++) {
      expect((await request(path, undefined, undefined, 'POST')).status).toBe(401);
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      expect((await request(path, owner.cookie, undefined, 'POST')).status).toBe(400);
    }
    expect((await upload(listing.id, owner.cookie)).status).toBe(201);
  });

  test('documents multipart, idempotency and all three mutation endpoints', async () => {
    const spec = await bodyOf<{
      paths: Record<
        string,
        Record<
          string,
          {
            requestBody?: { content: Record<string, unknown> };
            parameters?: { name: string }[];
            responses: Record<string, unknown>;
          }
        >
      >;
    }>(request('/openapi/json'));
    const operation = spec.paths['/listings/{id}/images']?.post;
    expect(Object.keys(spec.paths)).toContain('/listings/{id}/images');
    expect(operation?.requestBody?.content).toEqual({ 'multipart/form-data': expect.anything() });
    expect(operation?.requestBody?.content['multipart/form-data']).toBeDefined();
    expect(operation?.parameters?.some((parameter) => parameter.name === 'idempotency-key')).toBe(
      true,
    );
    expect(spec.paths['/listings/{id}/images/{imageId}']?.delete?.responses['204']).toBeDefined();
    expect(spec.paths['/listings/{id}/images/order']?.put).toBeDefined();
  });
});
