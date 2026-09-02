import { Elysia } from 'elysia';

import { authenticationPlugin } from '@/auth/plugin';
import { createListingBodySchema, listingResponseSchema } from '@/listings/model';
import { createListing } from '@/listings/service';

export const listingRoutes = new Elysia({
  prefix: '/listings',
})
  .use(authenticationPlugin)
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
        body.title = body.title.trim();
        body.description = body.description.trim();
        body.location = body.location.trim();
      },
      body: createListingBodySchema,
      response: {
        201: listingResponseSchema,
      },
    },
  );
