export const LISTING_KINDS = ['lost', 'found'] as const;

export type ListingKind = (typeof LISTING_KINDS)[number];

export const LISTING_STATUSES = ['active', 'resolved', 'archived'] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_CONSTRAINTS = {
  titleMinLength: 3,
  titleMaxLength: 120,
  descriptionMinLength: 1,
  descriptionMaxLength: 2000,
  locationMinLength: 2,
  locationMaxLength: 160,
} as const;

export interface Listing {
  id: string;
  kind: ListingKind;
  status: ListingStatus;
  title: string;
  description: string;
  location: string;
  occurredOn: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateListingInput {
  kind: ListingKind;
  title: string;
  description: string;
  location: string;
  occurredOn: string;
}

export interface ListingResponse {
  listing: Listing;
}
