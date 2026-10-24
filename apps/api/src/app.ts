import { sql } from 'drizzle-orm';
import { Elysia, t } from 'elysia';

import { createAdminRoutes } from '@/admin/routes';
import { createAdminOperationsRoutes } from '@/admin/operations-routes';
import { createModerationRoutes } from '@/moderation/routes';
import { createActivityRoutes } from '@/activity/routes';
import { createAuthRoutes } from '@/auth/routes';
import { createGoogleAuthRoutes } from '@/auth/google-routes';
import { createProfileRoutes } from '@/profile/routes';
import { createPublicProfileRoutes } from '@/profile/public-routes';
import { createAuthRateLimit } from '@/auth/rate-limit';
import { claimRoutes } from '@/claims/routes';
import { createConversationRoutes } from '@/conversations/routes';
import { db } from '@/db';
import { corsPlugin } from '@/http/cors';
import { isCsrfProtectedRequest } from '@/http/csrf';
import { errorHandler } from '@/http/errors';
import { legacyBodyLimit } from '@/http/body-limit';
import { CONVERSATION_MESSAGE_REQUEST_MAX_BYTES } from '@/conversations/multipart';
import { createImageUploadInfrastructure } from '@/image-upload/infrastructure';
import { listingManagementRoutes } from '@/listings/management-routes';
import { createListingRoutes } from '@/listings/routes';
import { openApiPlugin } from '@/openapi';
import { createListingImageRoutes } from '@/listing-images/routes';
import type { ObjectStorage } from '@/storage/object-storage';
import { objectStorage } from '@/storage/r2-storage';

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

export const createApp = (
  storage: ObjectStorage = objectStorage,
  { authRateLimit = false }: { authRateLimit?: boolean } = {},
) => {
  const imageUploads = createImageUploadInfrastructure();
  // Production enables auth admission after CSRF, before any body buffering.
  return new Elysia({
    serve: { maxRequestBodySize: CONVERSATION_MESSAGE_REQUEST_MAX_BYTES },
  })
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
    .use(authRateLimit ? createAuthRateLimit() : new Elysia())
    .use(legacyBodyLimit)
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
    .use(createAuthRoutes(storage))
    .use(createGoogleAuthRoutes())
    .use(createProfileRoutes(storage, imageUploads))
    .use(createPublicProfileRoutes(storage))
    .use(createListingRoutes(storage))
    .use(listingManagementRoutes)
    .use(createListingImageRoutes(storage, imageUploads))
    .use(claimRoutes)
    .use(createActivityRoutes(storage))
    .use(createConversationRoutes(storage, imageUploads))
    .use(createAdminRoutes(storage))
    .use(createAdminOperationsRoutes(storage))
    .use(createModerationRoutes());
};

export const app = createApp();
