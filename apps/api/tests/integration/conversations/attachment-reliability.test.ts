import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { claimConversations, claimMessages, claimMessageAttachments } from '@/db/conversations';
import { claims, listings } from '@/db/schema';
import * as imageProcessing from '@/image-upload/processing';
import { StorageUnavailableError } from '@/storage/object-storage';
import { MessageCommitUnknownError } from '@/conversations/send';
import * as attachmentReads from '@/conversations/attachments';
import * as sendQuota from '@/conversations/rate-limit';
import {
  attachmentHttpApp,
  attachmentSendFixture,
  multipartRequest,
} from './attachment-send-fixtures';
import { clearDatabase } from './fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

test('closing a claim after preflight still denies the final insert and cleans uploaded objects', async () => {
  const { send, input, claim, storage, quota } = await attachmentSendFixture();
  input.images.push(input.images[0]!);
  const originalPut = storage.put.bind(storage);
  const keys: string[] = [];
  const put = spyOn(storage, 'put').mockImplementation(async (...args) => {
    await originalPut(...args);
    keys.push(args[0]);
    if (keys.length === input.images.length)
      await db.update(claims).set({ status: 'rejected' }).where(eq(claims.id, claim.id));
  });
  const remove = spyOn(storage, 'delete');
  try {
    expect(await send(input)).toEqual({ ok: false, reason: 'conversation-read-only' });
    expect(keys).toHaveLength(2);
    expect(remove.mock.calls.map(([key]) => key)).toEqual(keys);
    expect(storage.objects.size).toBe(0);
    expect(quota).not.toHaveBeenCalled();
    expect(await db.select().from(claimMessages)).toEqual([]);
    expect(await db.select().from(claimMessageAttachments)).toEqual([]);
  } finally {
    put.mockRestore();
    remove.mockRestore();
  }
});

test.each([1, 2, 3])(
  'ambiguous PUT #%i keeps its candidate and cleans only previous successful keys',
  async (failAt) => {
    const { send, input, storage, quota, processing } = await attachmentSendFixture();
    input.images = Array.from({ length: 4 }, () => input.images[0]!);
    const keys: string[] = [];
    const originalPut = storage.put.bind(storage);
    const put = spyOn(storage, 'put').mockImplementation(async (...args) => {
      keys.push(args[0]);
      // The remote write succeeds but its acknowledgement is lost.
      await originalPut(...args);
      if (keys.length === failAt) throw new StorageUnavailableError();
    });
    const remove = spyOn(storage, 'delete');
    const log = spyOn(console, 'error').mockImplementation(() => {});
    const transaction = spyOn(db, 'transaction');
    try {
      await expect(send(input)).rejects.toBeInstanceOf(StorageUnavailableError);
      expect(remove.mock.calls.map(([key]) => key)).toEqual(keys.slice(0, -1));
      expect([...storage.objects.keys()]).toEqual([keys.at(-1)!]);
      expect(log.mock.calls.map(([line]) => JSON.parse(String(line)))).toContainEqual({
        level: 'error',
        event: 'conversation_attachment_storage_unknown',
        objectKey: keys.at(-1),
      });
      expect(transaction).not.toHaveBeenCalled();
      expect(quota).not.toHaveBeenCalled();
      expect(await db.select().from(claimMessages)).toEqual([]);
      const releases = [processing.tryAcquire(), processing.tryAcquire()];
      expect(releases.every(Boolean)).toBe(true);
      releases.forEach((release) => release?.());
    } finally {
      put.mockRestore();
      remove.mockRestore();
      log.mockRestore();
      transaction.mockRestore();
    }
  },
);

test('prepare failure after a successful PUT cleans earlier objects without starting a transaction', async () => {
  const { send, input, storage, quota } = await attachmentSendFixture();
  input.images.push(new Blob(['corrupt second image']));
  const remove = spyOn(storage, 'delete');
  const transaction = spyOn(db, 'transaction');
  try {
    await expect(send(input)).rejects.toMatchObject({ reason: 'invalid-image' });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(storage.objects.size).toBe(0);
    expect(transaction).not.toHaveBeenCalled();
    expect(quota).not.toHaveBeenCalled();
  } finally {
    remove.mockRestore();
    transaction.mockRestore();
  }
});

test('cleanup failure does not replace the original processing failure or leak private error text', async () => {
  const { send, input, storage } = await attachmentSendFixture();
  input.images.push(new Blob(['bad image']));
  const remove = spyOn(storage, 'delete').mockRejectedValue(new Error('private storage details'));
  const log = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(send(input)).rejects.toMatchObject({ reason: 'invalid-image' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(log.mock.calls[0]![0]))).toMatchObject({
      event: 'image_cleanup_failed',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private storage details');
  } finally {
    remove.mockRestore();
    log.mockRestore();
  }
});

test('HTTP business quota rejection after all PUTs returns 429 and cleans every own object', async () => {
  const { input, storage, owner, conversation } = await attachmentSendFixture();
  const images = Array.from({ length: 4 }, () => input.images[0]!);
  const put = spyOn(storage, 'put');
  const remove = spyOn(storage, 'delete');
  const sign = spyOn(storage, 'createReadUrl');
  const quota = spyOn(sendQuota, 'conversationSendRateLimit').mockImplementation(() => {
    expect(put).toHaveBeenCalledTimes(4);
    expect(storage.objects.size).toBe(4);
    expect(remove).not.toHaveBeenCalled();
    return 37;
  });
  try {
    const { api } = attachmentHttpApp(storage);
    const response = await api.handle(multipartRequest(conversation.id, owner.cookie, images));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(response.headers.get('Retry-After')).toBe('37');
    expect(quota).toHaveBeenCalledTimes(1);
    expect(quota).toHaveBeenCalledWith(conversation.id, owner.id);
    const keys = put.mock.calls.map(([key]) => key);
    expect(keys).toHaveLength(4);
    expect(remove.mock.calls.map(([key]) => key)).toEqual(keys);
    expect(storage.objects.size).toBe(0);
    expect(sign).not.toHaveBeenCalled();
    expect(await db.select().from(claimMessages)).toEqual([]);
    expect(await db.select().from(claimMessageAttachments)).toEqual([]);
    const [unchanged] = await db.select().from(claimConversations);
    expect(unchanged).toEqual(conversation);
  } finally {
    quota.mockRestore();
    sign.mockRestore();
    remove.mockRestore();
    put.mockRestore();
  }
});

test.each(['before callback', 'attachment insert', 'activity update'] as const)(
  'definite DB failure at %s cleans all own keys',
  async (failure) => {
    const { send, input, storage, quota, conversation } = await attachmentSendFixture();
    input.images.push(input.images[0]!);
    const prepare = imageProcessing.prepareImage;
    const prepareSpy = spyOn(imageProcessing, 'prepareImage').mockImplementation(
      async (...args) => ({
        ...(await prepare(...args)),
        ...(failure === 'attachment insert' ? { width: 0 } : {}),
      }),
    );
    if (failure === 'activity update')
      await db
        .update(claimConversations)
        .set({ nextMessageSequence: 2147483647 })
        .where(eq(claimConversations.id, conversation.id));
    const transaction =
      failure === 'before callback'
        ? spyOn(db, 'transaction').mockRejectedValue(new Error('No transaction connection'))
        : null;
    try {
      await expect(send(input)).rejects.toThrow();
      expect(storage.objects.size).toBe(0);
      expect(await db.select().from(claimMessages)).toEqual([]);
      expect(await db.select().from(claimMessageAttachments)).toEqual([]);
      expect(quota).toHaveBeenCalledTimes(failure === 'before callback' ? 0 : 1);
    } finally {
      prepareSpy.mockRestore();
      transaction?.mockRestore();
    }
  },
);

test('processing permit is released before write transaction, while images and PUTs run sequentially', async () => {
  const { send, input, storage, processing } = await attachmentSendFixture();
  input.images.push(input.images[0]!);
  const blocker = processing.tryAcquire()!; // Leave exactly one permit for this attempt.
  const events: string[] = [];
  const prepare = imageProcessing.prepareImage;
  const prepareSpy = spyOn(imageProcessing, 'prepareImage').mockImplementation(async (...args) => {
    events.push('prepare');
    expect(processing.tryAcquire()).toBeNull();
    return prepare(...args);
  });
  const put = storage.put.bind(storage);
  const putSpy = spyOn(storage, 'put').mockImplementation(async (...args) => {
    events.push('put');
    expect(processing.tryAcquire()).toBeNull();
    await put(...args);
  });
  const transaction = db.transaction.bind(db);
  const txSpy = spyOn(db, 'transaction').mockImplementation(async (callback, config) => {
    const release = processing.tryAcquire();
    expect(release).not.toBeNull();
    release?.();
    return transaction(callback, config);
  });
  try {
    expect(await send(input)).toMatchObject({ ok: true });
    expect(events).toEqual(['prepare', 'put', 'prepare', 'put']);
  } finally {
    blocker();
    prepareSpy.mockRestore();
    putSpy.mockRestore();
    txSpy.mockRestore();
  }
});

test('lost COMMIT acknowledgement never deletes possibly persisted objects; retry replays without PUT', async () => {
  const { send, input, storage, quota } = await attachmentSendFixture();
  input.images.push(input.images[0]!);
  const transaction = db.transaction.bind(db);
  const txSpy = spyOn(db, 'transaction').mockImplementationOnce(async (callback, config) => {
    await transaction(callback, config);
    throw new Error('Lost COMMIT acknowledgement');
  });
  const remove = spyOn(storage, 'delete');
  const log = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(send(input)).rejects.toBeInstanceOf(MessageCommitUnknownError);
    expect(remove).not.toHaveBeenCalled();
    expect(storage.objects.size).toBe(2);
    expect(await db.select().from(claimMessages)).toHaveLength(1);
    expect(log.mock.calls.map(([line]) => JSON.parse(String(line)).event)).toEqual([
      'conversation_attachment_commit_unknown',
      'conversation_attachment_commit_unknown',
    ]);
  } finally {
    txSpy.mockRestore();
    remove.mockRestore();
    log.mockRestore();
  }
  const put = spyOn(storage, 'put');
  try {
    expect(await send(input)).toMatchObject({ ok: true, value: { created: false } });
    expect(put).not.toHaveBeenCalled();
    expect(quota).toHaveBeenCalledTimes(1);
  } finally {
    put.mockRestore();
  }
});

test('post-commit signing failure keeps message and objects, and retry replays', async () => {
  const { send, input, storage, quota } = await attachmentSendFixture();
  const sign = spyOn(storage, 'createReadUrl').mockImplementation(() => {
    throw new StorageUnavailableError();
  });
  const remove = spyOn(storage, 'delete');
  try {
    await expect(send(input)).rejects.toBeInstanceOf(StorageUnavailableError);
    expect(remove).not.toHaveBeenCalled();
    expect(storage.objects.size).toBe(1);
    expect(await db.select().from(claimMessages)).toHaveLength(1);
  } finally {
    sign.mockRestore();
    remove.mockRestore();
  }
  expect(await send(input)).toMatchObject({ ok: true, value: { created: false } });
  expect(quota).toHaveBeenCalledTimes(1);
});

test('hide committed between send and hydration returns 404 without signing, preserves data and replays after restore', async () => {
  const { send, input, storage, listing } = await attachmentSendFixture();
  const hydrate = attachmentReads.findAuthorizedMessage;
  const hook = spyOn(attachmentReads, 'findAuthorizedMessage').mockImplementationOnce(
    async (...args) => {
      await db.update(listings).set({ isHidden: true }).where(eq(listings.id, listing.id));
      return hydrate(...args);
    },
  );
  const sign = spyOn(storage, 'createReadUrl');
  try {
    expect(await send(input)).toEqual({ ok: false, reason: 'conversation-not-found' });
    expect(sign).not.toHaveBeenCalled();
    expect(storage.objects.size).toBe(1);
    expect(await db.select().from(claimMessages)).toHaveLength(1);
  } finally {
    hook.mockRestore();
    sign.mockRestore();
  }
  await db.update(listings).set({ isHidden: false }).where(eq(listings.id, listing.id));
  expect(await send(input)).toMatchObject({ ok: true, value: { created: false } });
});
