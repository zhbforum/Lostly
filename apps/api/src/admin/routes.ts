import { Elysia, t } from 'elysia';
import { adminOverview, adminRecords, moderateClaim, moderateListing } from './service';
import { authenticationPlugin } from '@/auth/plugin';
import { authErrorSchema, authUserSchema } from '@/auth/model';
import { CLAIM_STATUSES } from '@/domain/claim';
import { LISTING_STATUSES } from '@/domain/listing';
import { trimFields } from '@/http/normalize';
import { listingIdParamsSchema, listingSchema } from '@/listings/model';
import { openApiMutationSecurity, openApiSessionSecurity } from '@/openapi';
import { pageInfoSchema, pageQuerySchema } from '@/pagination/model';

const reason = t.String({ minLength: 3, maxLength: 500 });
const moderationBody = t.Object({ reason });
const archiveBody = t.Object({
  reason,
  expectedVersion: t.Integer({ minimum: 1, maximum: 2147483647 }),
});
const person = t.Object({ id: t.String({ format: 'uuid' }), displayName: t.String() });
const pageSchema = t.Object({
  items: t.Array(
    t.Union([
      t.Object({ ...listingSchema.properties, owner: person }),
      t.Object({ ...authUserSchema.properties, createdAt: t.Date() }),
      t.Object({
        id: t.String({ format: 'uuid' }),
        status: t.UnionEnum(CLAIM_STATUSES),
        createdAt: t.Date(),
        listing: t.Object({
          id: t.String({ format: 'uuid' }),
          title: t.String(),
          status: t.UnionEnum(LISTING_STATUSES),
        }),
        claimant: person,
      }),
    ]),
  ),
  pageInfo: pageInfoSchema,
});

export const adminRoutes = new Elysia({ prefix: '/admin', detail: { tags: ['Admin'] } })
  .use(authenticationPlugin)
  .guard({ authenticated: true, response: { 403: authErrorSchema } })
  .onBeforeHandle(({ auth, status }) => {
    if (auth.user.role !== 'admin')
      return status(403, {
        error: { code: 'ADMIN_REQUIRED', message: 'Administrator access required' },
      });
  })
  .get('/overview', adminOverview, {
    response: {
      200: t.Object({
        users: t.Number(),
        listings: t.Number(),
        activeListings: t.Number(),
        pendingClaims: t.Number(),
      }),
    },
    detail: { summary: 'Get moderation dashboard totals', security: openApiSessionSecurity },
  })
  .get(
    '/:resource',
    async ({ params, query, status }) => {
      const page = await adminRecords(params.resource, query);
      return (
        page ?? status(400, { error: { code: 'INVALID_CURSOR', message: 'Invalid admin cursor' } })
      );
    },
    {
      params: t.Object({
        resource: t.Union([t.Literal('listings'), t.Literal('users'), t.Literal('claims')]),
      }),
      query: pageQuerySchema,
      response: { 200: pageSchema, 400: authErrorSchema },
      detail: {
        summary: 'Browse listings, users or claim summaries',
        security: openApiSessionSecurity,
      },
    },
  )
  .post(
    '/listings/:id/archive',
    async ({ auth, params, body, status }) => {
      const result = await moderateListing(params.id, auth.user.id, body);
      if (result === 'not-found')
        return status(404, { error: { code: 'LISTING_NOT_FOUND', message: 'Listing not found' } });
      if (result === 'conflict')
        return status(409, {
          error: {
            code: 'MODERATION_CONFLICT',
            message: 'Listing changed. Refresh before moderating.',
          },
        });
      return status(204, undefined);
    },
    {
      params: listingIdParamsSchema,
      body: archiveBody,
      transform({ body }) {
        trimFields(body, ['reason']);
      },
      response: { 204: t.Void(), 404: authErrorSchema, 409: authErrorSchema },
      detail: {
        summary: 'Archive a listing with an audit reason',
        security: openApiMutationSecurity,
      },
    },
  )
  .post(
    '/claims/:id/reject',
    async ({ auth, params, body, status }) => {
      const result = await moderateClaim(params.id, auth.user.id, body);
      if (result === 'not-found')
        return status(404, { error: { code: 'CLAIM_NOT_FOUND', message: 'Claim not found' } });
      if (result === 'conflict')
        return status(409, {
          error: {
            code: 'MODERATION_CONFLICT',
            message: 'Claim can no longer be rejected. Refresh the list.',
          },
        });
      return status(204, undefined);
    },
    {
      params: listingIdParamsSchema,
      body: moderationBody,
      transform({ body }) {
        trimFields(body, ['reason']);
      },
      response: { 204: t.Void(), 404: authErrorSchema, 409: authErrorSchema },
      detail: {
        summary: 'Reject a pending claim with an audit reason',
        security: openApiMutationSecurity,
      },
    },
  );
