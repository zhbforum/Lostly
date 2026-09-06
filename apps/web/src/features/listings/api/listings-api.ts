import type {
  CreateListingInput,
  UpdateListingInput,
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

export function updateListing(id: string, input: UpdateListingInput): Promise<ListingResponse> {
  return apiRequest<ListingResponse>(`/listings/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  });
}

export function resolveListing(id: string): Promise<ListingResponse> {
  return apiRequest<ListingResponse>(`/listings/${encodeURIComponent(id)}/resolve`, {
    method: 'POST',
  });
}

export function archiveListing(id: string): Promise<ListingResponse> {
  return apiRequest<ListingResponse>(`/listings/${encodeURIComponent(id)}/archive`, {
    method: 'POST',
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
