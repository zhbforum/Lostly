export const IMAGE_ERRORS = {
  'listing-not-found': [404, 'LISTING_NOT_FOUND', 'Listing not found'],
  forbidden: [403, 'LISTING_IMAGES_FORBIDDEN', 'Only the report owner can manage photos'],
  'not-editable': [
    409,
    'LISTING_IMAGES_NOT_EDITABLE',
    'Only active reports can have their photos changed',
  ],
  limit: [409, 'LISTING_IMAGE_LIMIT_REACHED', 'A report can have at most five photos'],
  'image-not-found': [404, 'LISTING_IMAGE_NOT_FOUND', 'Photo not found'],
  'invalid-order': [
    409,
    'INVALID_IMAGE_ORDER',
    'The order must contain every current photo exactly once',
  ],
  'request-conflict': [
    409,
    'IMAGE_UPLOAD_CONFLICT',
    'This upload operation was already used for another file or a deleted photo',
  ],
  'invalid-image': [
    422,
    'VALIDATION_ERROR',
    'Choose a valid, non-animated JPEG, PNG or WebP image up to 5 MiB and 40 megapixels',
  ],
  'body-too-large': [413, 'REQUEST_TOO_LARGE', 'The upload request is too large'],
  'invalid-multipart': [400, 'INVALID_MULTIPART', 'Send exactly one file in a multipart upload'],
  busy: [429, 'RATE_LIMITED', 'Too many photo uploads. Please try again shortly'],
} as const;

export class ImageError extends Error {
  constructor(readonly reason: keyof typeof IMAGE_ERRORS) {
    super(IMAGE_ERRORS[reason][2]);
    this.name = 'ImageError';
  }
}
