import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { listings } from '@/db/schema';
import { ImageError } from './errors';

export interface ImageOwnerInput {
  listingId: string;
  ownerUserId: string;
}

export function assertImageOwner(
  listing: { createdByUserId: string; status: string; isHidden: boolean } | null | undefined,
  ownerUserId: string,
) {
  if (!listing || listing.isHidden) throw new ImageError('listing-not-found');
  if (listing.createdByUserId !== ownerUserId) throw new ImageError('forbidden');
  return listing;
}

export function assertImagesEditable(listing: { status: string }) {
  if (listing.status !== 'active') throw new ImageError('not-editable');
}

export async function findImageOwner(input: ImageOwnerInput) {
  const [row] = await db
    .select({
      createdByUserId: listings.createdByUserId,
      status: listings.status,
      isHidden: listings.isHidden,
    })
    .from(listings)
    .where(eq(listings.id, input.listingId));
  return assertImageOwner(row, input.ownerUserId);
}
