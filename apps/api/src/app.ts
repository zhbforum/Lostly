import { sql } from 'drizzle-orm';
import { Elysia } from 'elysia';

import { authRoutes } from '@/auth/routes';
import { activityRoutes } from '@/activity/routes';
import { claimRoutes } from '@/claims/routes';
import { db } from '@/db';
import { corsPlugin } from '@/http/cors';
import { errorHandler } from '@/http/errors';
import { isCsrfProtectedRequest } from '@/http/csrf';
import { listingRoutes } from '@/listings/routes';

export const app = new Elysia()
  .use(corsPlugin)
  .use(errorHandler)
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
  .get('/', () => ({
    name: 'Lostly API',
    status: 'ok',
  }))
  .get('/health', async ({ status }) => {
    try {
      await db.execute(sql`select 1`);

      return {
        status: 'ok',
        database: 'connected',
      };
    } catch {
      return status(503, {
        status: 'error',
        database: 'unavailable',
      });
    }
  })
  .use(authRoutes)
  .use(listingRoutes)
  .use(claimRoutes)
  .use(activityRoutes);
