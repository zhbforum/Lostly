import { LISTING_IMAGE_CONSTRAINTS } from '@lostly/contracts/listings';
import { ApiError } from '@/shared/api/client';

export interface SelectedImage {
  id: string;
  file: File;
  status: 'selected' | 'uploading' | 'uploaded' | 'failed';
  error?: string;
}

export function validateImageSelection(files: File[], existingCount: number): string | null {
  if (files.length + existingCount > LISTING_IMAGE_CONSTRAINTS.maxCount)
    return 'Choose up to 5 photos in total.';
  if (files.some((file) => !file.size || file.size > LISTING_IMAGE_CONSTRAINTS.maxSizeBytes))
    return 'Each photo must be non-empty and no larger than 5 MiB.';
  if (
    files.some(
      (file) =>
        file.type &&
        !(LISTING_IMAGE_CONSTRAINTS.allowedContentTypes as readonly string[]).includes(file.type),
    )
  ) {
    return 'Choose JPEG, PNG or WebP photos.';
  }
  return null;
}

export function imageErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Sign in again to manage photos.';
    if (error.status === 403 || error.code === 'LISTING_IMAGES_NOT_EDITABLE')
      return 'Photos can only be changed on your own active report.';
    if (error.status === 404)
      return 'This photo or report is no longer available. Reload the report.';
    if (error.code === 'LISTING_IMAGE_LIMIT_REACHED')
      return 'This report already has 5 photos. Reload the report to see the current photos.';
    if (error.code === 'INVALID_IMAGE_ORDER')
      return 'The photos changed elsewhere. Reload the report before reordering.';
    if (error.code === 'IMAGE_UPLOAD_CONFLICT')
      return 'This upload was already used or its photo was deleted. Reload the report.';
    if (error.status === 422 || error.status === 413)
      return 'Choose a valid, non-animated JPEG, PNG or WebP up to 5 MiB and 40 megapixels.';
    if (error.status === 429) return 'Too many uploads. Wait a minute, then try again.';
  }
  return 'We could not save this photo change. Please try again.';
}
