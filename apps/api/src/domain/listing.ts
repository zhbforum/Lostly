export const LISTING_KINDS = ['lost', 'found'] as const;

export type ListingKind = (typeof LISTING_KINDS)[number];

export const LISTING_STATUS = ['active', 'resolved', 'archived'] as const;

export type ListingStatus = (typeof LISTING_STATUS)[number];
