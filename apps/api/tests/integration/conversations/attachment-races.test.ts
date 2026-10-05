import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test';
import { db } from '@/db';
import { claimMessages, claimMessageAttachments } from '@/db/conversations';
import * as replay from '@/conversations/replay';
import { imageFixture } from '@tests/support/image-fixture';
import { attachmentSendFixture } from './attachment-send-fixtures';
import { clearDatabase } from './fixtures';

beforeEach(clearDatabase);
afterAll(clearDatabase);

test.each([false, true])(
  'two preliminary misses, different fingerprints: %s; loser deletes only its namespace',
  async (different) => {
    const { send, input, storage, quota } = await attachmentSendFixture();
    input.images.push(await imageFixture('png', '#ff0000'));
    const competitor = {
      ...input,
      images: [
        input.images[0]!,
        different ? await imageFixture('png', '#00ff00') : input.images[1]!,
      ],
    };
    const bothMissed = Promise.withResolvers<void>();
    const bothUploaded = Promise.withResolvers<void>();
    const find = replay.findMessageOperation;
    let misses = 0;
    let puts = 0;
    const lookup = spyOn(replay, 'findMessageOperation').mockImplementation(async (...args) => {
      const result = await find(...args);
      if (!args[1]) {
        expect(result).toBeNull();
        if (++misses === 2) bothMissed.resolve();
        await bothMissed.promise;
      }
      return result;
    });
    const put = storage.put.bind(storage);
    const uploaded: string[] = [];
    const putSpy = spyOn(storage, 'put').mockImplementation(async (...args) => {
      await put(...args);
      uploaded.push(args[0]);
      if (++puts === 4) bothUploaded.resolve();
      if (args[0].endsWith('/1.webp')) await bothUploaded.promise;
    });
    const remove = spyOn(storage, 'delete');
    try {
      const results = await Promise.all([send(input), send(competitor)]);
      expect(results.filter((r) => r.ok && r.value.created)).toHaveLength(1);
      expect(results.filter((r) => r.ok && !r.value.created)).toHaveLength(different ? 0 : 1);
      if (different)
        expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: 'idempotency-conflict' });
      const rows = await db.select().from(claimMessageAttachments);
      const winners = rows.map((row) => row.objectKey).sort();
      const losers = uploaded.filter((key) => !winners.includes(key)).sort();
      expect([...storage.objects.keys()].sort()).toEqual(winners);
      expect(remove.mock.calls.map(([key]) => key).sort()).toEqual(losers);
      expect(new Set(uploaded.map((key) => key.split('/')[2])).size).toBe(2);
      expect(quota).toHaveBeenCalledTimes(1);
      expect(await db.select().from(claimMessages)).toHaveLength(1);
    } finally {
      bothMissed.resolve();
      bothUploaded.resolve();
      lookup.mockRestore();
      putSpy.mockRestore();
      remove.mockRestore();
    }
  },
);

test('one attempt cleans up while its same-operation competitor is uploaded but has not committed', async () => {
  const { send, input, storage, quota } = await attachmentSendFixture();
  const bothFirstStored = Promise.withResolvers<void>();
  const firstStored = Promise.withResolvers<void>();
  const allowWinnerCommit = Promise.withResolvers<void>();
  const put = storage.put.bind(storage);
  const namespaces: string[] = [];
  let winnerKey = '';
  const putSpy = spyOn(storage, 'put').mockImplementation(async (...args) => {
    await put(...args);
    namespaces.push(args[0]);
    firstStored.resolve();
    if (namespaces.length === 2) bothFirstStored.resolve();
    await bothFirstStored.promise;
    if (args[0] === namespaces[1]) {
      winnerKey = args[0];
      await allowWinnerCommit.promise;
    }
  });
  const remove = spyOn(storage, 'delete');
  // A stores its first image, then fails preparation of its second. B waits inside its PUT.
  const loser = Promise.allSettled([
    send({ ...input, images: [input.images[0]!, new Blob(['bad'])] }),
  ]);
  let winner: ReturnType<typeof send> | undefined;
  try {
    // Guarantee A owns the first namespace, without waiting on elapsed time.
    await firstStored.promise;
    winner = send(input);
    await bothFirstStored.promise;
    expect(await loser).toMatchObject([
      { status: 'rejected', reason: { reason: 'invalid-image' } },
    ]);
    expect(await db.select().from(claimMessages)).toEqual([]);
    expect(storage.objects.has(winnerKey)).toBe(true);
    expect(remove.mock.calls).toEqual([[namespaces[0]!]]);
    allowWinnerCommit.resolve();
    expect(await winner).toMatchObject({ ok: true, value: { created: true } });
    expect([...storage.objects.keys()]).toEqual([winnerKey]);
    expect(quota).toHaveBeenCalledTimes(1);
  } finally {
    bothFirstStored.resolve();
    allowWinnerCommit.resolve();
    await loser;
    if (winner) await winner;
    putSpy.mockRestore();
    remove.mockRestore();
  }
});
