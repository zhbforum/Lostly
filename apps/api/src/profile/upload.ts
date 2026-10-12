import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { users } from '@/db/schema';
import { logImageCleanup, deleteImageObject } from '@/image-upload/cleanup';
import type { ImageProcessingAdmission } from '@/image-upload/processing-admission';
import { createRateLimiter } from '@/http/rate-limit';
import type { ObjectStorage } from '@/storage/object-storage';
import { ProfileError } from './errors';
import { prepareAvatar } from './processing';
import { avatarKeys, findProfile, profileSelection, toProfile } from './queries';
import { assertProfileVersion, deleteAvatarObjects } from './service';

export function createAvatarUploader(storage: ObjectStorage, processing: ImageProcessingAdmission) {
  const limit = createRateLimiter(10, 60_000);
  return async (userId: string, file: File, expectedVersion: number) => {
    const release = processing.tryAcquire();
    if (!release) throw new ProfileError('busy');
    try {
      if (limit(userId) !== null) throw new ProfileError('busy');
      assertProfileVersion(await findProfile(userId), expectedVersion);
      const prepared = await prepareAvatar(file);
      const avatarId = Bun.randomUUIDv7();
      const keys = avatarKeys(userId, avatarId, prepared.animated);
      const objects = prepared.animated ? [keys.image, keys.still] : [keys.image];
      let putting = keys.image;
      try {
        await storage.put(keys.image, prepared.image, 'image/webp');
        if (prepared.animated) {
          putting = keys.still;
          await storage.put(keys.still, prepared.still, 'image/webp');
        }
      } catch (error) {
        logImageCleanup('avatar_upload_storage_unknown', putting);
        if (putting !== keys.image) await deleteImageObject(storage, keys.image);
        throw error;
      }
      let callbackFailed = false;
      let result;
      try {
        result = await db.transaction(async (tx) => {
          try {
            const current = await findProfile(userId, tx);
            assertProfileVersion(current, expectedVersion);
            const [updated] = await tx
              .update(users)
              .set({
                avatarId,
                avatarAnimated: prepared.animated,
                profileVersion: current.profileVersion + 1,
                updatedAt: new Date(),
              })
              .where(eq(users.id, userId))
              .returning(profileSelection);
            return { current, updated: updated! };
          } catch (error) {
            callbackFailed = true;
            throw error;
          }
        });
      } catch (error) {
        for (const key of objects) {
          if (callbackFailed) await deleteImageObject(storage, key);
          else logImageCleanup('avatar_upload_commit_unknown', key);
        }
        throw error;
      }
      await deleteAvatarObjects(result.current, storage);
      return toProfile(result.updated, storage);
    } finally {
      release();
    }
  };
}
