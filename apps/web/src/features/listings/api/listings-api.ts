import type {
  CreateListingInput,
  ListingDetailResponse,
  ListingFeedSort,
  ListingKind,
  ListingListResponse,
  ListingResponse,
} from '@/features/listings/model/types';
import { apiRequest } from '@/shared/api/client';

export function createListing(input: CreateListingInput): Promise<ListingResponse> {
  return apiRequest<ListingResponse>('/listings', {
    method: 'POST',
    body: input,
  });
}

export function getListing(id: string, signal?: AbortSignal): Promise<ListingDetailResponse> {
  return apiRequest<ListingDetailResponse>(`/listings/${encodeURIComponent(id)}`, {
    signal,
  });
}

export function getListings(
  input: {
    kind?: ListingKind;
    sort?: ListingFeedSort;
    cursor?: string;
  },
  signal?: AbortSignal,
): Promise<ListingListResponse> {
  const query = new URLSearchParams();

  if (input.kind) {
    query.set('kind', input.kind);
  }

  if (input.sort) {
    query.set('sort', input.sort);
  }

  if (input.cursor) {
    query.set('cursor', input.cursor);
  }

  const suffix = query.size > 0 ? `?${query.toString()}` : '';

  return apiRequest<ListingListResponse>(`/listings${suffix}`, { signal });
}
