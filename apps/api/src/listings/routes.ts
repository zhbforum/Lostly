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

export const listingRoutes = new Elysia({
  prefix: '/listings',
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
    },
  );
