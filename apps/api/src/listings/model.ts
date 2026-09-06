import { t } from 'elysia';

import { claimSchema } from '@/claims/model';
import { pageInfoSchema, pageQueryProperties } from '@/pagination/model';
import {
  LISTING_CONSTRAINTS,
  LISTING_FEED_SORTS,
  LISTING_KINDS,
  LISTING_STATUSES,
} from '@/domain/listing';

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

export const listingDetailResponseSchema = t.Object({
  listing: listingSchema,
  capabilities: t.Object({
    canClaim: t.Boolean(),
    canReviewClaims: t.Boolean(),
    canEdit: t.Boolean(),
    canResolve: t.Boolean(),
    canArchive: t.Boolean(),
  }),
  claim: t.Nullable(claimSchema),
});

export const listListingsQuerySchema = t.Object({
  // UnionEnum supplies the first value as a default, even inside Optional.
  // An omitted kind must mean all kinds, not the first kind in the array.
  kind: t.Optional(t.Union(LISTING_KINDS.map((kind) => t.Literal(kind)))),
  sort: t.Optional(t.Union(LISTING_FEED_SORTS.map((sort) => t.Literal(sort)))),
  ...pageQueryProperties,
});

export const listingListResponseSchema = t.Object({
  listings: t.Array(listingSchema),
  pageInfo: pageInfoSchema,
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

export const invalidListingCursorResponseSchema = t.Object({
  error: t.Object({
    code: t.Literal('INVALID_CURSOR'),
    message: t.Literal('Invalid listing cursor'),
  }),
});

const editableListingProperties = {
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
};

export const createListingBodySchema = t.Object({
  kind: t.Union(LISTING_KINDS.map((kind) => t.Literal(kind))),
  ...editableListingProperties,
});

export const updateListingBodySchema = t.Object(editableListingProperties, {
  additionalProperties: false,
});

export const listingManagementErrorResponseSchema = t.Object({
  error: t.Object({
    code: t.UnionEnum([
      'LISTING_NOT_FOUND',
      'LISTING_UPDATE_FORBIDDEN',
      'LISTING_RESOLVE_FORBIDDEN',
      'LISTING_ARCHIVE_FORBIDDEN',
      'LISTING_NOT_EDITABLE',
      'LISTING_NOT_RESOLVABLE',
      'LISTING_ALREADY_ARCHIVED',
    ]),
    message: t.String(),
  }),
});
