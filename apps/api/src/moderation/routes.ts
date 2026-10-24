import { Elysia, t } from 'elysia';
import { CASE_CATEGORIES, MODERATION_TARGETS } from '@lostly/contracts/moderation';
import { authenticationPlugin } from '@/auth/plugin';
import { pageQuerySchema } from '@/pagination/model';
import { openApiMutationSecurity, openApiSessionSecurity } from '@/openapi';
import { trimFields } from '@/http/normalize';
import {
  createAppeal,
  createReport,
  listCases,
  listNotifications,
  markNotificationRead,
} from './cases';

export const createModerationRoutes = () =>
  new Elysia({ detail: { tags: ['Moderation'] } })
    .use(authenticationPlugin)
    .guard({ authenticated: true })
    .post('/reports', ({ auth, body }) => createReport(auth.user.id, body), {
      body: t.Object({
        targetType: t.UnionEnum(MODERATION_TARGETS),
        targetId: t.String({ format: 'uuid' }),
        category: t.UnionEnum(CASE_CATEGORIES),
        description: t.String({ minLength: 10, maxLength: 2000 }),
      }),
      transform: ({ body }) => trimFields(body, ['description']),
      detail: { summary: 'Report content you can access', security: openApiMutationSecurity },
    })
    .get(
      '/me/moderation/notifications',
      ({ auth, query }) => listNotifications(auth.user.id, query),
      {
        query: pageQuerySchema,
        detail: {
          summary: 'Read your moderation decisions and notifications',
          security: openApiSessionSecurity,
        },
      },
    )
    .post(
      '/me/moderation/notifications/:id/read',
      async ({ auth, params, status }) => {
        await markNotificationRead(auth.user.id, params.id);
        return status(204, undefined);
      },
      {
        response: { 204: t.Void() },
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        detail: { summary: 'Mark your notification as read', security: openApiMutationSecurity },
      },
    )
    .get(
      '/me/moderation/cases',
      ({ auth, query }) => listCases({ ...query, reporterId: auth.user.id }),
      {
        query: pageQuerySchema,
        detail: {
          summary: 'Read your reports and appeals without internal notes',
          security: openApiSessionSecurity,
        },
      },
    )
    .post(
      '/me/moderation/appeals',
      ({ auth, body }) => createAppeal(auth.user.id, body.eventId, body.description),
      {
        body: t.Object({
          eventId: t.String({ format: 'uuid' }),
          description: t.String({ minLength: 10, maxLength: 2000 }),
        }),
        transform: ({ body }) => trimFields(body, ['description']),
        detail: {
          summary: 'Appeal a moderation decision affecting your account or content',
          security: openApiMutationSecurity,
        },
      },
    );
