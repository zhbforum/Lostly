import { Elysia, t } from 'elysia';

import { authenticationPlugin } from '@/auth/plugin';
import { claimErrorResponseSchema } from '@/claims/model';
import { listClaimActivity } from '@/claims/queries';
import { CLAIM_STATUSES } from '@/domain/claim';
import { LISTING_STATUSES } from '@/domain/listing';
import { listOwnedListings } from '@/listings/feed';
import { listListingsQuerySchema, listingListResponseSchema } from '@/listings/model';
import { openApiSessionSecurity } from '@/openapi';
import { pageInfoSchema, pageQueryProperties } from '@/pagination/model';

const invalidCursor = {
  error: {
    code: 'INVALID_CURSOR',
    message: 'Invalid activity cursor',
  },
};

export const activityRoutes = new Elysia({
  prefix: '/me',
  detail: {
    tags: ['Activity'],
  },
})
  .use(authenticationPlugin)
  .get(
    '/listings',
    async ({ auth, query, status }) => {
      const result = await listOwnedListings(auth.user.id, query);

      return result.ok ? result.value : status(400, invalidCursor);
    },
    {
      authenticated: true,
      query: listListingsQuerySchema,
      response: {
        200: listingListResponseSchema,
        400: claimErrorResponseSchema,
      },
      detail: {
        summary: 'List my reports',
        description:
          'Returns reports created by the authenticated user using filters and cursor pagination.',
        security: openApiSessionSecurity,
      },
    },
  )
  .get(
    '/claims',
    async ({ auth, query, status }) => {
      const result = await listClaimActivity(auth.user.id, query.direction ?? 'outgoing', query);

      return result.ok ? result.value : status(400, invalidCursor);
    },
    {
      authenticated: true,
      query: t.Object({
        ...pageQueryProperties,
        direction: t.Optional(t.Union([t.Literal('incoming'), t.Literal('outgoing')])),
      }),
      response: {
        400: claimErrorResponseSchema,
        200: t.Object({
          claims: t.Array(
            t.Object({
              id: t.String({ format: 'uuid' }),
              status: t.UnionEnum(CLAIM_STATUSES),
              createdAt: t.Date(),
              listing: t.Object({
                id: t.String({ format: 'uuid' }),
                title: t.String(),
                status: t.UnionEnum(LISTING_STATUSES),
              }),
            }),
          ),
          pageInfo: pageInfoSchema,
        }),
      },
      detail: {
        summary: 'List my claim activity',
        description: 'Returns incoming or outgoing claim activity for the authenticated user.',
        security: openApiSessionSecurity,
      },
    },
  );
