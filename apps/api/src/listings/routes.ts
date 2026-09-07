import { Elysia } from 'elysia';

import { authenticationPlugin } from '@/auth/plugin';
import { trimFields } from '@/http/normalize';
import {
  createListingBodySchema,
  invalidListingCursorResponseSchema,
  listingDetailResponseSchema,
  listingIdParamsSchema,
  listingListResponseSchema,
  listingNotFoundResponseSchema,
  listingResponseSchema,
  listListingsQuerySchema,
} from '@/listings/model';
import { createListing, findListingForViewer, listActiveListings } from '@/listings/service';
import { openApiMutationSecurity, openApiSessionSecurity } from '@/openapi';

export const listingRoutes = new Elysia({
  prefix: '/listings',
  detail: {
    tags: ['Listings'],
  },
})
  .use(authenticationPlugin)
  .get(
    '/',
    async ({ query, status }) => {
      const result = await listActiveListings(query);

      if (!result.ok) {
        return status(400, {
          error: {
            code: 'INVALID_CURSOR',
            message: 'Invalid listing cursor',
          },
        });
      }

      return result.value;
    },
    {
      authenticated: true,
      query: listListingsQuerySchema,
      response: {
        200: listingListResponseSchema,
        400: invalidListingCursorResponseSchema,
      },
      detail: {
        summary: 'List active reports',
        description:
          'Returns active lost and found reports using filters, sorting, and cursor pagination.',
        security: openApiSessionSecurity,
      },
    },
  )
  .get(
    '/:id',
    async ({ auth, params, status }) => {
      const listing = await findListingForViewer(params.id, auth.user.id);

      if (!listing) {
        return status(404, {
          error: {
            code: 'LISTING_NOT_FOUND',
            message: 'Listing not found',
          },
        });
      }

      return listing;
    },
    {
      authenticated: true,
      params: listingIdParamsSchema,
      response: {
        200: listingDetailResponseSchema,
        404: listingNotFoundResponseSchema,
      },
      detail: {
        summary: 'Get report details',
        description:
          'Returns a report together with viewer-specific claim state and available capabilities.',
        security: openApiSessionSecurity,
      },
    },
  )
  .post(
    '/',
    async ({ auth, body, status }) => {
      const listing = await createListing({
        createdByUserId: auth.user.id,
        kind: body.kind,
        title: body.title,
        description: body.description,
        location: body.location,
        occurredOn: body.occurredOn,
      });

      return status(201, {
        listing,
      });
    },
    {
      authenticated: true,
      transform({ body }) {
        trimFields(body, ['title', 'description', 'location']);
      },
      body: createListingBodySchema,
      response: {
        201: listingResponseSchema,
      },
      detail: {
        summary: 'Create a report',
        description: 'Creates a new lost or found report for the authenticated user.',
        security: openApiMutationSecurity,
      },
    },
  );
