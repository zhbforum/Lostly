import type { ObjectStorage } from '@/storage/object-storage';

export function logImageCleanup(event: string, objectKey: string) {
  // Log only server-controlled object keys. Never log original filenames, signed URLs,
  // credentials, request bodies or exception messages.
  console.error(JSON.stringify({ level: 'error', event, objectKey }));
}

export async function deleteImageObject(storage: ObjectStorage, objectKey: string) {
  try {
    await storage.delete(objectKey);
  } catch {
    logImageCleanup('image_cleanup_failed', objectKey);
  }
}
