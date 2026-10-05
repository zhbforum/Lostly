import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { createApp } from '@/app';
import { db } from '@/db';
import { listingImageUploads } from '@/db/listing-images';
import * as infrastructure from '@/image-upload/infrastructure';
import * as processing from '@/image-upload/processing';
import type { ImageProcessingAdmission } from '@/image-upload/processing-admission';
import { InvalidImageError } from '@/image-upload/errors';
import { createImageUploader } from '@/listing-images/upload';
import { clearDatabase, report, user } from '@tests/integration/listings/management-fixtures';
import { imageFixture } from '@tests/support/image-fixture';
import { MemoryObjectStorage } from '@tests/support/memory-storage';

beforeEach(clearDatabase);
afterAll(clearDatabase);

async function fixture() {
  const owner = await user('shared-image-admission');
  const listing = await report(owner.id);
  return {
    owner,
    input: {
      listingId: listing.id,
      ownerUserId: owner.id,
      requestId: crypto.randomUUID(),
      file: await imageFixture(),
    },
  };
}

function expectFullCapacity(admission: ImageProcessingAdmission) {
  const first = admission.tryAcquire();
  const second = admission.tryAcquire();
  const third = admission.tryAcquire();
  try {
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(third).toBeNull();
  } finally {
    first?.();
    second?.();
    third?.();
  }
}

test('two uploaders share capacity through storage and return it when one completes', async () => {
  const { input } = await fixture();
  const imageUploads = infrastructure.createImageUploadInfrastructure();
  const storageA = new MemoryObjectStorage();
  const storageB = new MemoryObjectStorage();
  const uploadA = createImageUploader(storageA, imageUploads.processing);
  const uploadB = createImageUploader(storageB, imageUploads.processing);
  const startedA = Promise.withResolvers<void>();
  const startedB = Promise.withResolvers<void>();
  const releaseA = Promise.withResolvers<void>();
  const releaseB = Promise.withResolvers<void>();
  const putA = storageA.put.bind(storageA);
  const putB = storageB.put.bind(storageB);
  const spyA = spyOn(storageA, 'put').mockImplementationOnce(async (...args) => {
    await putA(...args);
    startedA.resolve();
    await releaseA.promise;
  });
  const spyB = spyOn(storageB, 'put').mockImplementationOnce(async (...args) => {
    await putB(...args);
    startedB.resolve();
    await releaseB.promise;
  });
  const pendingA = Promise.allSettled([uploadA(input)]);
  const pendingB = Promise.allSettled([uploadB({ ...input, requestId: crypto.randomUUID() })]);
  try {
    await Promise.all([startedA.promise, startedB.promise]);
    // Requests through either consumer see the same global capacity.
    for (const upload of [uploadA, uploadB]) {
      await expect(upload(input)).rejects.toMatchObject({ reason: 'busy' });
    }
    releaseA.resolve();
    expect((await pendingA)[0]).toMatchObject({ status: 'fulfilled', value: { created: true } });
    const occupyReleasedPermit = imageUploads.processing.tryAcquire();
    try {
      expect(occupyReleasedPermit).not.toBeNull();
      // A is now persisted, but listing replays are not exempt from capacity admission.
      await expect(uploadA(input)).rejects.toMatchObject({ reason: 'busy' });
    } finally {
      occupyReleasedPermit?.();
    }
    // B still occupies its permit, but A's released permit is available to either consumer.
    expect((await uploadB(input)).created).toBe(false);
    releaseB.resolve();
    expect((await pendingB)[0]).toMatchObject({ status: 'fulfilled', value: { created: true } });
    expectFullCapacity(imageUploads.processing);
  } finally {
    releaseA.resolve();
    releaseB.resolve();
    await Promise.all([pendingA, pendingB]);
    spyA.mockRestore();
    spyB.mockRestore();
  }
});

test('capacity rejection spends no listing quota, but persisted replays still spend quota', async () => {
  const { input } = await fixture();
  const imageUploads = infrastructure.createImageUploadInfrastructure();
  const storage = new MemoryObjectStorage();
  const upload = createImageUploader(storage, imageUploads.processing);
  const occupied = [imageUploads.processing.tryAcquire(), imageUploads.processing.tryAcquire()];
  try {
    for (let attempt = 0; attempt < 21; attempt++) {
      await expect(upload(input)).rejects.toMatchObject({ reason: 'busy' });
    }
  } finally {
    occupied.forEach((release) => release?.());
  }
  const prepare = spyOn(processing, 'prepareImage');
  const put = spyOn(storage, 'put');
  try {
    expect((await upload(input)).created).toBe(true);
    for (let attempt = 1; attempt < 20; attempt++) {
      expect((await upload(input)).created).toBe(false);
    }
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);

    await expect(upload(input)).rejects.toMatchObject({ reason: 'busy' });
    expectFullCapacity(imageUploads.processing);
  } finally {
    prepare.mockRestore();
    put.mockRestore();
  }
});

test.each(['source', 'processing', 'storage', 'database', 'commit-unknown', 'signing'] as const)(
  'returns the processing permit after a %s error',
  async (failure) => {
    const { input } = await fixture();
    const imageUploads = infrastructure.createImageUploadInfrastructure();
    const storage = new MemoryObjectStorage();
    const upload = createImageUploader(storage, imageUploads.processing);
    const prepare = processing.prepareImage;
    const transaction = db.transaction.bind(db);
    const log = spyOn(console, 'error').mockImplementation(() => {});
    const spy = (() => {
      switch (failure) {
        case 'source':
          return spyOn(input.file, 'arrayBuffer').mockRejectedValue(
            new Error('Source read failed'),
          );
        case 'processing':
          return spyOn(processing, 'prepareImage').mockRejectedValue(new InvalidImageError());
        case 'storage':
          return spyOn(storage, 'put').mockRejectedValue(new Error('Storage failed'));
        case 'database':
          return spyOn(processing, 'prepareImage').mockImplementation(async (...args) => ({
            ...(await prepare(...args)),
            width: 0,
          }));
        case 'commit-unknown':
          return spyOn(db, 'transaction').mockImplementation(async (callback, config) => {
            await transaction(callback, config);
            throw new Error('Lost commit acknowledgement');
          });
        case 'signing':
          return spyOn(storage, 'createReadUrl').mockImplementation(() => {
            throw new Error('Signing failed');
          });
      }
    })();
    try {
      await expect(upload(input)).rejects.toThrow();
      expectFullCapacity(imageUploads.processing);
    } finally {
      spy.mockRestore();
      log.mockRestore();
    }
  },
);

test('listing upload reads once, processes that exact buffer and persists only the original hash', async () => {
  const { input } = await fixture();
  const storage = new MemoryObjectStorage();
  const imageUploads = infrastructure.createImageUploadInfrastructure();
  const read = spyOn(input.file, 'arrayBuffer');
  const source = spyOn(processing, 'readImageSource');
  const prepare = spyOn(processing, 'prepareImage');
  try {
    await createImageUploader(storage, imageUploads.processing)(input);
    expect(read).toHaveBeenCalledTimes(1);
    expect(source).toHaveBeenCalledTimes(1);
    expect(prepare).toHaveBeenCalledTimes(1);
    const sourceResult = source.mock.results[0]!;
    if (sourceResult.type !== 'return') throw new Error('Source read did not return');
    const { bytes, sourceHash } = await sourceResult.value;
    expect(prepare.mock.calls[0]![0]).toBe(bytes);
    expect(sourceHash).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect((await db.select().from(listingImageUploads))[0]!.sourceHash).toBe(sourceHash);
    const preparedResult = prepare.mock.results[0]!;
    if (preparedResult.type !== 'return') throw new Error('Image preparation did not return');
    const normalized = await preparedResult.value;
    const stored = [...storage.objects.values()][0]!;
    expect(stored.type).toBe('image/webp');
    expect(await stored.bytes()).toEqual(await normalized.data.bytes());
    expect(await stored.bytes()).not.toEqual(new Uint8Array(bytes));
  } finally {
    read.mockRestore();
    source.mockRestore();
    prepare.mockRestore();
  }
});

test('app constructs one infrastructure and listing routes use its ingress and processing admission', async () => {
  const { input, owner } = await fixture();
  const storage = new MemoryObjectStorage();
  const imageUploads = infrastructure.createImageUploadInfrastructure();
  const factory = spyOn(infrastructure, 'createImageUploadInfrastructure').mockReturnValue(
    imageUploads,
  );
  const acquire = spyOn(imageUploads.processing, 'tryAcquire').mockReturnValueOnce(null);
  const begin = spyOn(imageUploads.ingress, 'begin');
  const finished = Promise.withResolvers<void>();
  const finishRequest = imageUploads.ingress.finish;
  let finishedCount = 0;
  const finish = spyOn(imageUploads.ingress, 'finish').mockImplementation((request) => {
    finishRequest(request);
    if (++finishedCount === 2) finished.resolve();
  });
  const put = spyOn(storage, 'put');
  try {
    const app = createApp(storage);
    const send = () => {
      const form = new FormData();
      form.append('file', input.file);
      return app.handle(
        new Request(`http://localhost/listings/${input.listingId}/images`, {
          method: 'POST',
          body: form,
          headers: {
            Cookie: owner.cookie,
            'X-CSRF-Protection': '1',
            'Idempotency-Key': input.requestId,
          },
        }),
      );
    };
    const rejected = await send();
    expect(rejected.status).toBe(429);
    expect(await rejected.json()).toEqual({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many photo uploads. Please try again shortly',
      },
    });
    expect(rejected.headers.get('Retry-After')).toBe('60');
    expect(put).not.toHaveBeenCalled();
    expect((await send()).status).toBe(201);
    await finished.promise;
    expect(factory).toHaveBeenCalledTimes(1);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(begin).toHaveBeenCalledTimes(2);
    expect(finish).toHaveBeenCalledTimes(2);
    expect(put).toHaveBeenCalledTimes(1);
    expectFullCapacity(imageUploads.processing);
  } finally {
    factory.mockRestore();
    acquire.mockRestore();
    begin.mockRestore();
    finish.mockRestore();
    put.mockRestore();
  }
});
