import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { listingImages } from '@/db/listing-images';
import { lockListing } from '@/listings/locking';
import type { ObjectStorage } from '@/storage/object-storage';
import { assertImageOwner, assertImagesEditable, type ImageOwnerInput } from './authorization';
import { deleteImageObject } from '@/image-upload/cleanup';
import { ImageError } from './errors';
import { findImages, toListingImage } from './queries';
import { isCaseEvidence } from '@/moderation/evidence-retention';

export async function deleteOwnedImage(
  input: ImageOwnerInput & { imageId: string },
  storage: ObjectStorage,
) {
  const objectKey = await db.transaction(async (tx) => {
    const listing = assertImageOwner(await lockListing(tx, input.listingId), input.ownerUserId);
    assertImagesEditable(listing);
    const [image] = await tx
      .delete(listingImages)
      .where(and(eq(listingImages.listingId, input.listingId), eq(listingImages.id, input.imageId)))
      .returning();
    if (!image) throw new ImageError('image-not-found');
    const remaining = await findImages(input.listingId, tx);
    for (const [position, row] of remaining.entries()) {
      await tx.update(listingImages).set({ position }).where(eq(listingImages.id, row.id));
    }
    return image.objectKey;
  });
  if (!(await isCaseEvidence(objectKey))) await deleteImageObject(storage, objectKey);
}

export async function orderOwnedImages(
  input: ImageOwnerInput & { imageIds: string[] },
  storage: ObjectStorage,
) {
  const images = await db.transaction(async (tx) => {
    const listing = assertImageOwner(await lockListing(tx, input.listingId), input.ownerUserId);
    assertImagesEditable(listing);
    const current = await findImages(input.listingId, tx);
    if (
      input.imageIds.length !== current.length ||
      new Set(input.imageIds).size !== current.length ||
      current.some((image) => !input.imageIds.includes(image.id))
    )
      throw new ImageError('invalid-order');
    for (const [position, id] of input.imageIds.entries()) {
      await tx.update(listingImages).set({ position }).where(eq(listingImages.id, id));
    }
    return (await findImages(input.listingId, tx)).map((row) => toListingImage(row, storage));
  });
  return { images };
}
