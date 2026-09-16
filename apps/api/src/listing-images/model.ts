import { t } from 'elysia';
import { LISTING_IMAGE_CONSTRAINTS } from '@lostly/contracts/listings';

export const listingImageSchema = t.Object({
  id: t.String({ format: 'uuid' }),
  url: t.String(),
  urlExpiresAt: t.String({ format: 'date-time' }),
  position: t.Integer({ minimum: 0 }),
  width: t.Integer({ minimum: 1 }),
  height: t.Integer({ minimum: 1 }),
});
export const listingImagesSchema = t.Array(listingImageSchema, {
  maxItems: LISTING_IMAGE_CONSTRAINTS.maxCount,
});
export const listingImageResponseSchema = t.Object({ image: listingImageSchema });
export const listingImagesResponseSchema = t.Object({ images: listingImagesSchema });
export const imageUploadBodySchema = t.Object({
  file: t.File({ minSize: 1, maxSize: LISTING_IMAGE_CONSTRAINTS.maxSizeBytes }),
});
export const imageUploadHeadersSchema = t.Object({
  'idempotency-key': t.String({ format: 'uuid' }),
});
export const imageOrderBodySchema = t.Object(
  {
    imageIds: t.Array(t.String({ format: 'uuid' }), {
      maxItems: LISTING_IMAGE_CONSTRAINTS.maxCount,
    }),
  },
  { additionalProperties: false },
);
export const imageErrorSchema = t.Object({
  error: t.Object({ code: t.String(), message: t.String() }),
});
