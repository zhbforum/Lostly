import { t } from 'elysia';

import { LISTING_CONSTRAINTS, LISTING_KINDS, LISTING_STATUSES } from '@/domain/listing';

export const listingSchema = t.Object({
  id: t.String({
    format: 'uuid',
  }),
  kind: t.UnionEnum(LISTING_KINDS),
  status: t.UnionEnum(LISTING_STATUSES),
  title: t.String(),
  description: t.String(),
  location: t.String(),
  occurredOn: t.String({
    format: 'date',
  }),
  createdAt: t.Date(),
  updatedAt: t.Date(),
});

export const listingResponseSchema = t.Object({
  listing: listingSchema,
});

export const listingIdParamsSchema = t.Object({
  id: t.String({
    format: 'uuid',
  }),
});

export const listingNotFoundResponseSchema = t.Object({
  error: t.Object({
    code: t.Literal('LISTING_NOT_FOUND'),
    message: t.Literal('Listing not found'),
  }),
});

export const createListingBodySchema = t.Object({
  kind: t.UnionEnum(LISTING_KINDS),
  title: t.String({
    minLength: LISTING_CONSTRAINTS.titleMinLength,
    maxLength: LISTING_CONSTRAINTS.titleMaxLength,
  }),
  description: t.String({
    minLength: LISTING_CONSTRAINTS.descriptionMinLength,
    maxLength: LISTING_CONSTRAINTS.descriptionMaxLength,
  }),
  location: t.String({
    minLength: LISTING_CONSTRAINTS.locationMinLength,
    maxLength: LISTING_CONSTRAINTS.locationMaxLength,
  }),
  occurredOn: t.String({
    format: 'date',
  }),
});
