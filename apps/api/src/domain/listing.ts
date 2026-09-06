import type { ListingStatus } from '@lostly/contracts/listings';

export {
  LISTING_CONSTRAINTS,
  LISTING_FEED_SORTS,
  LISTING_KINDS,
  LISTING_STATUSES,
} from '@lostly/contracts/listings';
export type { ListingFeedSort, ListingKind, ListingStatus } from '@lostly/contracts/listings';

export function canEditListing(status: ListingStatus): boolean {
  return status === 'active';
}

export function canResolveListing(status: ListingStatus): boolean {
  return status === 'active';
}

export function canArchiveListing(status: ListingStatus): boolean {
  return status === 'active' || status === 'resolved';
}
