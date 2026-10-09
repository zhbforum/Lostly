import { eq } from 'drizzle-orm';
import { LISTING_IMAGE_CONSTRAINTS } from '@lostly/contracts/listings';
import { db } from '@/db';
import { listingImages, listingImageUploads } from '@/db/listing-images';
import { lockListing } from '@/listings/locking';
import type { ObjectStorage } from '@/storage/object-storage';
import { createRateLimiter } from '@/http/rate-limit';
import {
  assertImageOwner,
  assertImagesEditable,
  findImageOwner,
  type ImageOwnerInput,
} from './authorization';
import { deleteImageObject, logImageCleanup } from '@/image-upload/cleanup';
import { InvalidImageError } from '@/image-upload/errors';
import type { ImageProcessingAdmission } from '@/image-upload/processing-admission';
import { readImageSource, prepareImage } from '@/image-upload/processing';
import { ImageError } from './errors';
import { findImages, findUpload, toListingImage } from './queries';

async function findUploadReplay(
  input: { listingId: string; requestId: string },
  sourceHash: string,
  storage: ObjectStorage,
) {
  const upload = await findUpload(input.listingId, input.requestId);
  if (!upload) return null;
  if (upload.sourceHash !== sourceHash || !upload.imageId) throw new ImageError('request-conflict');
  const [image] = await db.select().from(listingImages).where(eq(listingImages.id, upload.imageId));
  if (!image) throw new ImageError('request-conflict');
  return { image: toListingImage(image, storage), created: false } as const;
}

export function createImageUploader(storage: ObjectStorage, processing: ImageProcessingAdmission) {
  const rateLimit = createRateLimiter(20, 60_000);

  return async (input: ImageOwnerInput & { requestId: string; file: Blob }) => {
    const release = processing.tryAcquire();
    if (!release) throw new ImageError('busy');
    try {
      // Capacity rejection must not consume the listing-specific attempt quota.
      if (rateLimit(input.ownerUserId) !== null) throw new ImageError('busy');
      const owner = await findImageOwner(input);
      const { bytes, sourceHash } = await readImageSource(input.file, {
        maxBytes: LISTING_IMAGE_CONSTRAINTS.maxSizeBytes,
      });
      const previous = await findUploadReplay(input, sourceHash, storage);
      // A retry may acknowledge an earlier success after the listing was closed; it cannot mutate it.
      if (previous) return previous;
      assertImagesEditable(owner);
      if ((await findImages(input.listingId)).length >= LISTING_IMAGE_CONSTRAINTS.maxCount) {
        // A concurrent request with the same key may have committed the fifth image
        // between our first lookup and this count. Acknowledge it before rejecting new uploads.
        const replay = await findUploadReplay(input, sourceHash, storage);
        if (replay) return replay;
        throw new ImageError('limit');
      }
      const prepared = await prepareImage(bytes, {
        maxOutputBytes: LISTING_IMAGE_CONSTRAINTS.maxSizeBytes,
      });
      const imageId = Bun.randomUUIDv7();
      const objectKey = `listings/${input.listingId}/${imageId}.webp`;
      try {
        await storage.put(objectKey, prepared.data, prepared.contentType);
      } catch (error) {
        // A failed/expired PUT may still have reached storage. Record its unique key for reconciliation.
        logImageCleanup('image_upload_storage_unknown', objectKey);
        throw error;
      }

      let callbackFailed = false;
      let result;
      try {
        result = await db.transaction(async (tx) => {
          try {
            const listing = assertImageOwner(
              await lockListing(tx, input.listingId),
              input.ownerUserId,
            );
            const previous = await findUpload(input.listingId, input.requestId, tx);
            if (previous) {
              if (previous.sourceHash !== sourceHash || !previous.imageId)
                throw new ImageError('request-conflict');
              const [image] = await tx
                .select()
                .from(listingImages)
                .where(eq(listingImages.id, previous.imageId));
              if (!image) throw new ImageError('request-conflict');
              return { image, created: false };
            }
            assertImagesEditable(listing);
            const images = await findImages(input.listingId, tx);
            if (images.length >= LISTING_IMAGE_CONSTRAINTS.maxCount) throw new ImageError('limit');
            const [image] = await tx
              .insert(listingImages)
              .values({
                id: imageId,
                listingId: input.listingId,
                objectKey,
                contentType: prepared.contentType,
                sizeBytes: prepared.data.size,
                width: prepared.width,
                height: prepared.height,
                position: images.length,
              })
              .returning();
            if (!image) throw new Error('Missing inserted image');
            await tx.insert(listingImageUploads).values({
              listingId: input.listingId,
              requestId: input.requestId,
              sourceHash,
              imageId,
            });
            return { image, created: true };
          } catch (error) {
            // No COMMIT is attempted when our transaction callback fails.
            callbackFailed = true;
            throw error;
          }
        });
      } catch (error) {
        if (callbackFailed) await deleteImageObject(storage, objectKey);
        else logImageCleanup('image_upload_commit_unknown', objectKey);
        throw error;
      }
      if (!result.created) await deleteImageObject(storage, objectKey);
      // URL generation/serialization is outside compensation: the DB commit already succeeded.
      return { image: toListingImage(result.image, storage), created: result.created };
    } catch (error) {
      if (error instanceof InvalidImageError) throw new ImageError('invalid-image');
      throw error;
    } finally {
      release();
    }
  };
}
