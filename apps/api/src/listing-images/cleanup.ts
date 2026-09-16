import type { ObjectStorage } from '@/storage/object-storage';

export function logImageCleanup(event: string, objectKey: string) {
  // Keys contain only server-generated UUIDs. Never log filenames, URLs, credentials or errors.
  console.error(JSON.stringify({ level: 'error', event, objectKey }));
}

export async function deleteImageObject(storage: ObjectStorage, objectKey: string) {
  try {
    await storage.delete(objectKey);
  } catch {
    logImageCleanup('image_cleanup_failed', objectKey);
  }
}
