import type { ListingImageResponse, ListingImagesResponse } from '@lostly/contracts/listings';
import { apiRequest } from '@/shared/api/client';

const imagePath = (id: string) => `/listings/${encodeURIComponent(id)}/images`;

export function uploadListingImage(
  listingId: string,
  file: File,
  requestId: string,
  signal?: AbortSignal,
) {
  const body = new FormData();
  body.append('file', file);
  return apiRequest<ListingImageResponse>(imagePath(listingId), {
    method: 'POST',
    headers: { 'Idempotency-Key': requestId },
    body,
    signal,
  });
}

export function deleteListingImage(listingId: string, imageId: string, signal?: AbortSignal) {
  return apiRequest<void>(`${imagePath(listingId)}/${encodeURIComponent(imageId)}`, {
    method: 'DELETE',
    signal,
  });
}

export function orderListingImages(listingId: string, imageIds: string[], signal?: AbortSignal) {
  return apiRequest<ListingImagesResponse>(`${imagePath(listingId)}/order`, {
    method: 'PUT',
    body: { imageIds },
    signal,
  });
}
