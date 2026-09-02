import { db } from '@/db';
import { listings } from '@/db/schema';
import type { ListingKind } from '@/domain/listing';

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
    .returning({
      id: listings.id,
      createdByUserId: listings.createdByUserId,
      kind: listings.kind,
      status: listings.status,
      title: listings.title,
      description: listings.description,
      location: listings.location,
      occurredOn: listings.occurredOn,
      createdAt: listings.createdAt,
      updatedAt: listings.updatedAt,
    });

  if (!listing) {
    throw new Error('Failed to create listing');
  }

  return listing;
}
