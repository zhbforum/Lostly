import { expect, spyOn, test } from 'bun:test';
import { MemoryObjectStorage } from '@tests/support/memory-storage';
import { deleteImageObject } from './cleanup';

test('failed cleanup logs only the controlled key and does not expose or propagate storage errors', async () => {
  const storage = new MemoryObjectStorage();
  const key = `conversations/${crypto.randomUUID()}/${crypto.randomUUID()}/0.webp`;
  const remove = spyOn(storage, 'delete').mockRejectedValue(
    new Error('Private credentials or provider details'),
  );
  const log = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(deleteImageObject(storage, key)).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ level: 'error', event: 'image_cleanup_failed', objectKey: key }),
    );
  } finally {
    remove.mockRestore();
    log.mockRestore();
  }
});
