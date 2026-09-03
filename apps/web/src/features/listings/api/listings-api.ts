import type { CreateListingInput, ListingResponse } from '@/features/listings/model/types';
import { apiRequest } from '@/shared/api/client';

export function createListing(input: CreateListingInput): Promise<ListingResponse> {
  return apiRequest<ListingResponse>('/listings', {
    method: 'POST',
    body: input,
  });
}

export function getListing(id: string, signal?: AbortSignal): Promise<ListingResponse> {
  return apiRequest<ListingResponse>(`/listings/${encodeURIComponent(id)}`, {
    signal,
  });
}
