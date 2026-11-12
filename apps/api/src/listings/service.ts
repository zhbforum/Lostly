import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { listings } from '@/db/schema';
import { findClaimForClaimant } from '@/claims/queries';
import {
  canArchiveListing,
  canEditListing,
  canResolveListing,
  type ListingKind,
} from '@/domain/listing';
import { publicListingSelection } from '@/listings/selection';
import { findImages, toListingImage } from '@/listing-images/queries';
import type { ObjectStorage } from '@/storage/object-storage';
import { objectStorage } from '@/storage/r2-storage';

export { listActiveListings } from '@/listings/feed';

export interface CreateListingInput {
  createdByUserId: string;
  kind: ListingKind;
  title: string;
  description: string;
  location: string;
  occurredOn: string;
}

export async function createListing(input: CreateListingInput) {
  const [listing] = await db
    .insert(listings)
    .values({
      createdByUserId: input.createdByUserId,
      kind: input.kind,
      title: input.title,
      description: input.description,
      location: input.location,
      occurredOn: input.occurredOn,
    })
    .returning(publicListingSelection);
  if (!listing) throw new Error('Failed to create listing');
  return listing;
}

export async function findListingById(id: string) {
  const [listing] = await db
    .select(publicListingSelection)
    .from(listings)
    .where(and(eq(listings.id, id), eq(listings.isHidden, false)))
    .limit(1);
  return listing ?? null;
}

export async function findListingForViewer(
  id: string,
  viewerUserId: string,
  storage: ObjectStorage = objectStorage,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        ...publicListingSelection,
        createdByUserId: listings.createdByUserId,
      })
      .from(listings)
      .where(and(eq(listings.id, id), eq(listings.isHidden, false)))
      .limit(1)
      .for('share');
    if (!row) return null;

    const { createdByUserId, ...listing } = row;
    const isOwner = createdByUserId === viewerUserId;
    const isFound = listing.kind === 'found';
    const claim = !isOwner && isFound ? await findClaimForClaimant(id, viewerUserId) : null;
    return {
      listing,
      images: (await findImages(id, tx)).map((row) => toListingImage(row, storage)),
      capabilities: {
        canManageImages: isOwner && listing.status === 'active',
        canClaim: !isOwner && isFound && listing.status === 'active' && !claim,
        canReviewClaims: isOwner && isFound,
        canEdit: isOwner && canEditListing(listing.status),
        canResolve: isOwner && canResolveListing(listing.status),
        canArchive: isOwner && canArchiveListing(listing.status),
      },
      claim,
    };
  });
}
