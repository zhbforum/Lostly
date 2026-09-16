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
  canManageImages: boolean;
  canClaim: boolean;
  canReviewClaims: boolean;
  canEdit: boolean;
  canResolve: boolean;
  canArchive: boolean;
}

export interface ListingDetailResponse extends ListingResponse {
  images: ListingImage[];
  capabilities: ListingCapabilities;
  claim: Claim | null;
}

export type ListingPageInfo = PageInfo;

export interface ListingListResponse {
  listings: ListingSummary[];
  pageInfo: ListingPageInfo;
}

export const LISTING_IMAGE_CONSTRAINTS = {
  maxCount: 5,
  maxSizeBytes: 5 * 1024 * 1024,
  allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
} as const;

export type ListingImageContentType =
  (typeof LISTING_IMAGE_CONSTRAINTS.allowedContentTypes)[number];

export interface ListingImage {
  id: string;
  url: string;
  urlExpiresAt: string;
  position: number;
  width: number;
  height: number;
}

export interface ListingSummary extends Listing {
  coverImage: ListingImage | null;
}

export interface ListingImageResponse {
  image: ListingImage;
}

export interface ListingImagesResponse {
  images: ListingImage[];
}

export interface OrderListingImagesInput {
  imageIds: string[];
}
