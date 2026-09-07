import type { Claim } from './claims';
import type { PageInfo } from './pagination';

export const LISTING_KINDS = ['lost', 'found'] as const;

export type ListingKind = (typeof LISTING_KINDS)[number];

export const LISTING_STATUSES = ['active', 'resolved', 'archived'] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_FEED_SORTS = ['newest', 'oldest', 'occurredOnDesc', 'occurredOnAsc'] as const;

export type ListingFeedSort = (typeof LISTING_FEED_SORTS)[number];

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
  version: number;
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

export interface UpdateListingInput {
  expectedVersion: number;
  title: string;
  description: string;
  location: string;
  occurredOn: string;
}

export interface ListingCapabilities {
  canClaim: boolean;
  canReviewClaims: boolean;
  canEdit: boolean;
  canResolve: boolean;
  canArchive: boolean;
}

export interface ListingDetailResponse extends ListingResponse {
  capabilities: ListingCapabilities;
  claim: Claim | null;
}

export type ListingPageInfo = PageInfo;

export interface ListingListResponse {
  listings: Listing[];
  pageInfo: ListingPageInfo;
}
