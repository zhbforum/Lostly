import { and, asc, eq, inArray } from 'drizzle-orm';
import type { ListingImage } from '@lostly/contracts/listings';
import { db, type DatabaseTransaction } from '@/db';
import { listingImages, listingImageUploads } from '@/db/listing-images';
import type { ObjectStorage } from '@/storage/object-storage';

type QueryConnection = typeof db | DatabaseTransaction;
export type ImageRecord = typeof listingImages.$inferSelect;
export const IMAGE_READ_TTL_SECONDS = 3600;

export function toListingImage(row: ImageRecord, storage: ObjectStorage): ListingImage {
  const signed = storage.createReadUrl(row.objectKey, IMAGE_READ_TTL_SECONDS);
  return {
    id: row.id,
    position: row.position,
    width: row.width,
    height: row.height,
    url: signed.url,
    urlExpiresAt: signed.expiresAt,
  };
}

export function findImages(listingId: string, connection: QueryConnection = db) {
  return connection
    .select()
    .from(listingImages)
    .where(eq(listingImages.listingId, listingId))
    .orderBy(asc(listingImages.position), asc(listingImages.id));
}

export async function findUpload(
  listingId: string,
  requestId: string,
  connection: QueryConnection = db,
) {
  const [row] = await connection
    .select()
    .from(listingImageUploads)
    .where(
      and(
        eq(listingImageUploads.listingId, listingId),
        eq(listingImageUploads.requestId, requestId),
      ),
    );
  return row;
}

export async function findCovers(listingIds: string[], storage: ObjectStorage) {
  if (!listingIds.length) return new Map<string, ListingImage>();
  const rows = await db
    .selectDistinctOn([listingImages.listingId])
    .from(listingImages)
    .where(inArray(listingImages.listingId, listingIds))
    .orderBy(asc(listingImages.listingId), asc(listingImages.position), asc(listingImages.id));
  return new Map(rows.map((row) => [row.listingId, toListingImage(row, storage)]));
}
