import { Elysia, t } from 'elysia';
import {
  adminOverview,
  adminRecords,
  moderateClaim,
  moderateListing,
  setListingVisibility,
} from './service';
import { authenticationPlugin } from '@/auth/plugin';
import { authErrorSchema, authUserSchema } from '@/auth/model';
import { CLAIM_STATUSES } from '@/domain/claim';
import { LISTING_KINDS, LISTING_STATUSES } from '@/domain/listing';
import { trimFields } from '@/http/normalize';
import { listingIdParamsSchema, listingSchema } from '@/listings/model';
import { openApiMutationSecurity, openApiSessionSecurity } from '@/openapi';
import { pageInfoSchema, pageQueryProperties } from '@/pagination/model';

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
      t.Object({ ...listingSchema.properties, isHidden: t.Boolean(), owner: person }),
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
      if (
        ((query.kind || query.visibility) && params.resource !== 'listings') ||
        (query.status &&
          (params.resource === 'users' ||
            !(params.resource === 'listings' ? [...LISTING_STATUSES] : [...CLAIM_STATUSES]).some(
              (value) => value === query.status,
            )))
      )
        return status(422, {
          error: { code: 'VALIDATION_ERROR', message: 'Filters do not apply to this resource' },
        });
      const page = await adminRecords(params.resource, query);
      return (
        page ?? status(400, { error: { code: 'INVALID_CURSOR', message: 'Invalid admin cursor' } })
      );
    },
    {
      params: t.Object({
        resource: t.Union([t.Literal('listings'), t.Literal('users'), t.Literal('claims')]),
      }),
      query: t.Object({
        ...pageQueryProperties,
        q: t.Optional(t.String({ maxLength: 100 })),
        kind: t.Optional(t.Union(LISTING_KINDS.map((value) => t.Literal(value)))),
        visibility: t.Optional(t.Union([t.Literal('visible'), t.Literal('hidden')])),
        status: t.Optional(
          t.Union([...LISTING_STATUSES, ...CLAIM_STATUSES].map((value) => t.Literal(value))),
        ),
      }),
      response: { 200: pageSchema, 400: authErrorSchema, 422: authErrorSchema },
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
    '/listings/:id/:action',
    async ({ auth, params, body, status }) => {
      const result = await setListingVisibility(params.id, auth.user.id, params.action, body);
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
      params: t.Object({
        ...listingIdParamsSchema.properties,
        action: t.Union([t.Literal('hide'), t.Literal('restore')]),
      }),
      body: archiveBody,
      transform({ body }) {
        trimFields(body, ['reason']);
      },
      response: { 204: t.Void(), 404: authErrorSchema, 409: authErrorSchema },
      detail: {
        summary: 'Hide or restore listing visibility with an audit reason',
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
