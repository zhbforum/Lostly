import { sql } from 'drizzle-orm';
import { Elysia, t } from 'elysia';

import { activityRoutes } from '@/activity/routes';
import { authRoutes } from '@/auth/routes';
import { claimRoutes } from '@/claims/routes';
import { db } from '@/db';
import { corsPlugin } from '@/http/cors';
import { isCsrfProtectedRequest } from '@/http/csrf';
import { errorHandler } from '@/http/errors';
import { listingManagementRoutes } from '@/listings/management-routes';
import { listingRoutes } from '@/listings/routes';
import { openApiPlugin } from '@/openapi';

const apiStatusResponseSchema = t.Object({
  name: t.Literal('Lostly API'),
  status: t.Literal('ok'),
});

const healthOkResponseSchema = t.Object({
  status: t.Literal('ok'),
  database: t.Literal('connected'),
});

const healthUnavailableResponseSchema = t.Object({
  status: t.Literal('error'),
  database: t.Literal('unavailable'),
});

export const app = new Elysia()
  .use(corsPlugin)
  .use(errorHandler)
  .use(openApiPlugin)
  .onBeforeHandle(({ set }) => {
    set.headers['Cache-Control'] = 'private, no-store';
  })
  .onRequest(({ request, status }) => {
    if (!isCsrfProtectedRequest(request)) {
      return status(403, {
        error: {
          code: 'CSRF_VALIDATION_FAILED',
          message: 'CSRF protection header is required',
        },
      });
    }
  })
  .get(
    '/',
    () =>
      ({
        name: 'Lostly API',
        status: 'ok',
      }) as const,
    {
      response: {
        200: apiStatusResponseSchema,
      },
      detail: {
        tags: ['System'],
        summary: 'Get API status',
      },
    },
  )
  .get(
    '/health',
    async ({ status }) => {
      try {
        await db.execute(sql`select 1`);

        return {
          status: 'ok',
          database: 'connected',
        } as const;
      } catch {
        return status(503, {
          status: 'error',
          database: 'unavailable',
        } as const);
      }
    },
    {
      response: {
        200: healthOkResponseSchema,
        503: healthUnavailableResponseSchema,
      },
      detail: {
        tags: ['System'],
        summary: 'Check service health',
        description: 'Checks API availability and PostgreSQL connectivity.',
      },
    },
  )
  .use(authRoutes)
  .use(listingRoutes)
  .use(listingManagementRoutes)
  .use(claimRoutes)
  .use(activityRoutes);
