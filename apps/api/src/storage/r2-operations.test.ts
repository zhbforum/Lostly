import { S3Client } from 'bun';
import { afterEach, beforeEach, expect, mock, setSystemTime, spyOn, test } from 'bun:test';
import { StorageUnavailableError } from './object-storage';
import { R2ObjectStorage } from './r2-storage';

const config = {
  R2_ENDPOINT: 'https://coverage.r2.cloudflarestorage.com',
  R2_BUCKET: 'test-bucket',
  R2_ACCESS_KEY_ID: 'test-access-key',
  R2_SECRET_ACCESS_KEY: 'test-secret-key',
};
const saved = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
const image = new Blob(['image bytes'], { type: 'image/webp' });
const privateError = new Error('private storage credentials and object key');
let write: ReturnType<typeof spyOn<S3Client, 'write'>>;
let remove: ReturnType<typeof spyOn<S3Client, 'delete'>>;

beforeEach(() => {
  Object.assign(process.env, config);
  write = spyOn(S3Client.prototype, 'write').mockResolvedValue(image.size);
  remove = spyOn(S3Client.prototype, 'delete').mockResolvedValue(undefined);
});

afterEach(() => {
  mock.restore();
  setSystemTime();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('PUT preserves bytes and content type, disables native retries, and reuses its client', async () => {
  const storage = new R2ObjectStorage();

  await expect(storage.put('photos/one.webp', image, 'image/webp')).resolves.toBeUndefined();
  await expect(storage.delete('photos/one.webp')).resolves.toBeUndefined();

  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith('photos/one.webp', image, {
    type: 'image/webp',
    retry: 0,
  });
  expect(remove).toHaveBeenCalledTimes(1);
  expect(remove).toHaveBeenCalledWith('photos/one.webp');
  expect(write.mock.contexts[0]).toBe(remove.mock.contexts[0]);
});

test.each(['put', 'delete'] as const)(
  '%s sanitizes transport failures and remains usable',
  async (operation) => {
    const transport = operation === 'put' ? write : remove;
    const storage = new R2ObjectStorage();
    const perform = () =>
      operation === 'put'
        ? storage.put('private/key.webp', image, 'image/webp')
        : storage.delete('private/key.webp');
    for (const fail of [
      () => Promise.reject(privateError),
      () => {
        throw privateError;
      },
    ]) {
      transport.mockImplementation(fail);
      for (let attempt = 0; attempt < 4; attempt++) {
        await expect(perform()).rejects.toEqual(new StorageUnavailableError());
      }
    }

    write.mockResolvedValue(image.size);
    remove.mockResolvedValue(undefined);
    await expect(perform()).resolves.toBeUndefined();
    expect(transport).toHaveBeenCalledTimes(9);
  },
);

test('deleting an absent object succeeds, but other storage errors are not swallowed', async () => {
  const storage = new R2ObjectStorage();
  remove.mockRejectedValueOnce(
    Object.assign(new Error('missing private key'), { code: 'NoSuchKey' }),
  );

  await expect(storage.delete('missing.webp')).resolves.toBeUndefined();

  remove.mockRejectedValueOnce(
    Object.assign(new Error('private access details'), { code: 'AccessDenied' }),
  );
  await expect(storage.delete('denied.webp')).rejects.toEqual(new StorageUnavailableError());
});

test('PUT and DELETE share four slots, reject overflow without transport calls, and release completed slots', async () => {
  const storage = new R2ObjectStorage();
  const gate = Promise.withResolvers<number>();
  write.mockReturnValue(gate.promise);
  remove.mockImplementation(async () => {
    await gate.promise;
  });
  const pending = [
    storage.put('one.webp', image, 'image/webp'),
    storage.delete('two.webp'),
    storage.put('three.webp', image, 'image/webp'),
    storage.delete('four.webp'),
  ];

  try {
    await expect(storage.put('overflow.webp', image, 'image/webp')).rejects.toBeInstanceOf(
      StorageUnavailableError,
    );
    await expect(storage.delete('overflow.webp')).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(write).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);

    gate.resolve(image.size);
    await Promise.all(pending);

    await expect(storage.put('next.webp', image, 'image/webp')).resolves.toBeUndefined();
    await expect(storage.delete('next.webp')).resolves.toBeUndefined();
  } finally {
    gate.resolve(image.size);
    await Promise.allSettled(pending);
  }
});

test.each(['resolve', 'reject'] as const)(
  'a timed-out PUT holds its slot until the native operation settles: %s',
  async (outcome) => {
    const storage = new R2ObjectStorage();
    const late = Promise.withResolvers<number>();
    const other = Promise.withResolvers<number>();
    const timeout = spyOn(globalThis, 'setTimeout');
    const clear = spyOn(globalThis, 'clearTimeout');
    write.mockReturnValue(other.promise).mockReturnValueOnce(late.promise);
    const first = storage.put('late.webp', image, 'image/webp');
    const pending = Array.from({ length: 3 }, (_, index) =>
      storage.put(`other-${index}.webp`, image, 'image/webp'),
    );

    try {
      await Promise.resolve();
      expect(write).toHaveBeenCalledTimes(4);
      const [expire, delay] = timeout.mock.calls[0]!;
      expect(delay).toBe(15_000);
      expire();
      await expect(first).rejects.toEqual(new StorageUnavailableError());

      // THEN: a caller timeout is not cancellation of the underlying PUT.
      await expect(storage.put('too-early.webp', image, 'image/webp')).rejects.toBeInstanceOf(
        StorageUnavailableError,
      );
      expect(write).toHaveBeenCalledTimes(4);
      expect(remove).not.toHaveBeenCalled();
      expect(clear).toHaveBeenCalledWith(timeout.mock.results[0]!.value);

      if (outcome === 'resolve') late.resolve(image.size);
      else late.reject(privateError);
      await new Promise<void>((resolve) => setImmediate(resolve));

      const replacement = storage.put('replacement.webp', image, 'image/webp');
      pending.push(replacement);
      await expect(storage.delete('still-full.webp')).rejects.toBeInstanceOf(
        StorageUnavailableError,
      );
      expect(write).toHaveBeenCalledTimes(5);
      expect(remove).not.toHaveBeenCalled();

      other.resolve(image.size);
      await Promise.all(pending);
    } finally {
      late.resolve(image.size);
      other.resolve(image.size);
      await Promise.allSettled([first, ...pending]);
    }
  },
);

test('read URLs are signed for GET with the requested expiry and do not upload an object', () => {
  setSystemTime(new Date('2026-10-21T12:00:00Z'));
  const presign = spyOn(S3Client.prototype, 'presign');
  const storage = new R2ObjectStorage();

  const result = storage.createReadUrl('photos/private image.webp', 120);
  const url = new URL(result.url);

  expect(presign).toHaveBeenCalledTimes(1);
  expect(presign).toHaveBeenCalledWith('photos/private image.webp', {
    method: 'GET',
    expiresIn: 120,
  });
  expect(url.protocol).toBe('https:');
  expect(decodeURIComponent(url.pathname)).toBe('/test-bucket/photos/private image.webp');
  expect(url.searchParams.get('X-Amz-Expires')).toBe('120');
  expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
  expect(result.expiresAt).toBe('2026-10-21T12:02:00.000Z');
  expect(result.url).not.toContain(config.R2_SECRET_ACCESS_KEY);
  expect(write).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});

test('signing errors expose only the storage-unavailable error', () => {
  spyOn(S3Client.prototype, 'presign').mockImplementation(() => {
    throw privateError;
  });

  expect(() => new R2ObjectStorage().createReadUrl('private/key.webp', 120)).toThrow(
    new StorageUnavailableError(),
  );
});

test('construction is lazy and invalid configuration fails closed for every operation', async () => {
  process.env.R2_ENDPOINT = 'https://invalid.example';
  const storage = new R2ObjectStorage();

  await expect(storage.put('one.webp', image, 'image/webp')).rejects.toEqual(
    new StorageUnavailableError(),
  );
  await expect(storage.delete('one.webp')).rejects.toEqual(new StorageUnavailableError());
  expect(() => storage.createReadUrl('one.webp', 120)).toThrow(new StorageUnavailableError());
  expect(write).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
});
