import { Elysia } from 'elysia';
import { sql } from 'drizzle-orm';

import { authRoutes } from '@/auth/routes';
import { db } from '@/db';
import { corsPlugin } from '@/http/cors';
import { isCsrfProtectedRequest } from '@/http/csrf';

export const app = new Elysia()
  .use(corsPlugin)
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
  .use(authRoutes);
