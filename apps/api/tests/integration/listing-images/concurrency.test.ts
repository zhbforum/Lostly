import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { listings } from '@/db/schema';
import { listingImages, listingImageUploads } from '@/db/listing-images';
import { createImageUploader } from '@/listing-images/upload';
import * as processing from '@/image-upload/processing';
import { createImageProcessingAdmission } from '@/image-upload/processing-admission';
import * as queries from '@/listing-images/queries';
import { resolveOwnedListing, archiveOwnedListing } from '@/listings/management';
import { decideClaim } from '@/claims/decide';
import {
  clearDatabase,
  report,
  user,
  claim,
} from '@tests/integration/listings/management-fixtures';
import { MemoryObjectStorage } from '@tests/support/memory-storage';
import { imageFixture } from '@tests/support/image-fixture';

beforeEach(clearDatabase);
afterAll(clearDatabase);
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('serializes two uploads competing for the fifth slot and compensates the losing object', async () => {
  const owner = await user('photo-race');
  const listing = await report(owner.id);
  const storage = new MemoryObjectStorage();
  const upload = createImageUploader(storage, createImageProcessingAdmission());
  const input = { listingId: listing.id, ownerUserId: owner.id, file: await imageFixture() };
  for (let i = 0; i < 4; i++) await upload({ ...input, requestId: crypto.randomUUID() });
  const bothStored = deferred();
  let calls = 0;
  const put = storage.put.bind(storage);
  const spy = spyOn(storage, 'put').mockImplementation(async (...args) => {
    await put(...args);
    if (++calls === 2) bothStored.resolve();
    await bothStored.promise;
  });
  try {
    const results = await Promise.allSettled([
      upload({ ...input, requestId: crypto.randomUUID() }),
      upload({ ...input, requestId: crypto.randomUUID() }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find((result) => result.status === 'rejected');
    expect(failure?.status === 'rejected' && failure.reason.reason).toBe('limit');
    expect(await db.select().from(listingImages)).toHaveLength(5);
    expect(storage.objects.size).toBe(5);
  } finally {
    bothStored.resolve();
    spy.mockRestore();
  }
});

test('concurrent retries create one image and delete only the extra object', async () => {
  const owner = await user('photo-replay');
  const listing = await report(owner.id);
  const storage = new MemoryObjectStorage();
  const upload = createImageUploader(storage, createImageProcessingAdmission());
  const input = {
    listingId: listing.id,
    ownerUserId: owner.id,
    file: await imageFixture(),
    requestId: crypto.randomUUID(),
  };
  const bothStored = deferred();
  let calls = 0;
  const put = storage.put.bind(storage);
  const spy = spyOn(storage, 'put').mockImplementation(async (...args) => {
    await put(...args);
    if (++calls === 2) bothStored.resolve();
    await bothStored.promise;
  });
  try {
    const results = await Promise.all([upload(input), upload(input)]);
    expect(results[0].image.id).toBe(results[1].image.id);
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(storage.objects.size).toBe(1);
    expect(await db.select().from(listingImageUploads)).toHaveLength(1);
  } finally {
    bothStored.resolve();
    spy.mockRestore();
  }
});

test.each(['same file', 'different file'] as const)(
  'rechecks idempotency when the fifth image commits after the first lookup: %s',
  async (payload) => {
    const owner = await user('photo-preflight-replay');
    const listing = await report(owner.id);
    const storage = new MemoryObjectStorage();
    const upload = createImageUploader(storage, createImageProcessingAdmission());
    const input = {
      listingId: listing.id,
      ownerUserId: owner.id,
      file: await imageFixture(),
      requestId: crypto.randomUUID(),
    };
    for (let i = 0; i < 4; i++) await upload({ ...input, requestId: crypto.randomUUID() });

    const firstLookupFinished = deferred();
    const resumeRetry = deferred();
    const findUpload = queries.findUpload;
    let pauseNextLookup = true;
    const lookup = spyOn(queries, 'findUpload').mockImplementation(async (...args) => {
      const result = await findUpload(...args);
      if (pauseNextLookup) {
        pauseNextLookup = false;
        expect(result).toBeUndefined();
        firstLookupFinished.resolve();
        // B has read "no upload", but cannot check the count until A has committed.
        await resumeRetry.promise;
      }
      return result;
    });
    const prepare = spyOn(processing, 'prepareImage');
    const put = spyOn(storage, 'put');
    const retryFile = payload === 'same file' ? input.file : await imageFixture('png', '#ff0000');
    // Attach rejection handling immediately so cleanup can safely drain B on assertion failure.
    const retry = Promise.allSettled([upload({ ...input, file: retryFile })]);
    try {
      await firstLookupFinished.promise;
      const original = await upload(input);
      expect(original.created).toBe(true);
      expect(await db.select().from(listingImages)).toHaveLength(5);
      resumeRetry.resolve();

      const [result] = await retry;
      if (payload === 'same file') {
        expect(result).toMatchObject({
          status: 'fulfilled',
          value: { created: false, image: { id: original.image.id, position: 4 } },
        });
      } else {
        expect(result).toMatchObject({
          status: 'rejected',
          reason: { reason: 'request-conflict' },
        });
      }

      // A genuinely new upload to the full listing still fails before Sharp or storage.
      await expect(upload({ ...input, requestId: crypto.randomUUID() })).rejects.toMatchObject({
        reason: 'limit',
      });
      expect(prepare).toHaveBeenCalledTimes(1);
      expect(put).toHaveBeenCalledTimes(1);
      expect(storage.objects.size).toBe(5);
      expect(await db.select().from(listingImages)).toHaveLength(5);
      expect(await db.select().from(listingImageUploads)).toHaveLength(5);
    } finally {
      resumeRetry.resolve();
      await retry;
      lookup.mockRestore();
      prepare.mockRestore();
      put.mockRestore();
    }
  },
);

test.each(['resolve', 'archive', 'approve'] as const)(
  'rechecks status after storage when %s closes the report',
  async (action) => {
    const owner = await user('photo-owner');
    const listing = await report(owner.id);
    const claimant = await user('photo-claimant');
    const proof = await claim(listing.id, claimant.id);
    const storage = new MemoryObjectStorage();
    const upload = createImageUploader(storage, createImageProcessingAdmission());
    const stored = deferred();
    const release = deferred();
    const put = storage.put.bind(storage);
    const spy = spyOn(storage, 'put').mockImplementation(async (...args) => {
      await put(...args);
      stored.resolve();
      await release.promise;
    });
    const pending = upload({
      listingId: listing.id,
      ownerUserId: owner.id,
      file: await imageFixture(),
      requestId: crypto.randomUUID(),
    });
    try {
      await stored.promise;
      if (action === 'approve')
        await decideClaim({
          claimId: proof.id,
          reviewerUserId: owner.id,
          decision: 'approved',
          handoverDetails: 'Meet at reception.',
        });
      else
        await (action === 'resolve' ? resolveOwnedListing : archiveOwnedListing)({
          listingId: listing.id,
          ownerUserId: owner.id,
        });
      release.resolve();
      await expect(pending).rejects.toMatchObject({ reason: 'not-editable' });
      expect(storage.objects.size).toBe(0);
      expect(await db.select().from(listingImages)).toHaveLength(0);
    } finally {
      release.resolve();
      spy.mockRestore();
    }
  },
);

test('never removes a committed object when the COMMIT acknowledgement is lost', async () => {
  const owner = await user('photo-commit');
  const listing = await report(owner.id);
  const storage = new MemoryObjectStorage();
  const upload = createImageUploader(storage, createImageProcessingAdmission());
  const input = {
    listingId: listing.id,
    ownerUserId: owner.id,
    file: await imageFixture(),
    requestId: crypto.randomUUID(),
  };
  const transaction = db.transaction.bind(db);
  const log = spyOn(console, 'error').mockImplementation(() => {});
  const spy = spyOn(db, 'transaction').mockImplementation(async (callback, config) => {
    await transaction(callback, config);
    throw new Error('Simulated lost COMMIT acknowledgement');
  });
  try {
    await expect(upload(input)).rejects.toThrow('COMMIT');
    expect(storage.objects.size).toBe(1);
    expect(await db.select().from(listingImages)).toHaveLength(1);
  } finally {
    spy.mockRestore();
    log.mockRestore();
  }
  expect((await upload(input)).created).toBe(false);
  expect(storage.objects.size).toBe(1);
});

test('compensates the stored object when PostgreSQL rejects the image insert', async () => {
  const owner = await user('photo-insert-failure');
  const listing = await report(owner.id);
  const storage = new MemoryObjectStorage();
  const prepare = processing.prepareImage;
  // Simulate invalid processor metadata; the real DB CHECK rejects the insertion.
  const spy = spyOn(processing, 'prepareImage').mockImplementation(async (...args) => ({
    ...(await prepare(...args)),
    width: 0,
  }));
  try {
    await expect(
      createImageUploader(
        storage,
        createImageProcessingAdmission(),
      )({
        listingId: listing.id,
        ownerUserId: owner.id,
        file: await imageFixture(),
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
    expect(storage.objects.size).toBe(0);
    expect(await db.select().from(listingImages)).toHaveLength(0);
    expect(await db.select().from(listingImageUploads)).toHaveLength(0);
  } finally {
    spy.mockRestore();
  }
});

test('enforces row constraints and cascades both metadata and retry records', async () => {
  const owner = await user('photo-schema');
  const listing = await report(owner.id);
  const storage = new MemoryObjectStorage();
  await createImageUploader(
    storage,
    createImageProcessingAdmission(),
  )({
    listingId: listing.id,
    ownerUserId: owner.id,
    file: await imageFixture(),
    requestId: crypto.randomUUID(),
  });
  const row = {
    listingId: listing.id,
    objectKey: 'test-invalid',
    contentType: 'image/webp',
    sizeBytes: 100,
    width: 10,
    height: 10,
    position: 0,
  };
  for (const invalid of [
    { sizeBytes: 0 },
    { sizeBytes: 5242881 },
    { position: -1 },
    { width: 0 },
    { contentType: 'image/svg+xml' },
    { listingId: crypto.randomUUID() },
  ]) {
    await expect(
      db
        .insert(listingImages)
        .values({ ...row, ...invalid })
        .execute(),
    ).rejects.toThrow();
  }
  await db.delete(listings).where(eq(listings.id, listing.id));
  expect(await db.select().from(listingImages)).toHaveLength(0);
  expect(await db.select().from(listingImageUploads)).toHaveLength(0);
});
