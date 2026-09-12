import { Elysia, t } from 'elysia';
import { authenticationPlugin } from '@/auth/plugin';
import { SESSION_COOKIE_NAME } from '@/auth/cookie';
import { getSession } from '@/auth/service';
import { createRateLimiter } from '@/http/rate-limit';
import { listingIdParamsSchema } from '@/listings/model';
import { openApiMutationSecurity } from '@/openapi';
import type { ObjectStorage } from '@/storage/object-storage';
import { ImageError } from './errors';
import { deleteOwnedImage, orderOwnedImages } from './management';
import {
  imageErrorSchema,
  imageOrderBodySchema,
  imageUploadBodySchema,
  imageUploadHeadersSchema,
  listingImageResponseSchema,
  listingImagesResponseSchema,
} from './model';
import { parseImageUpload } from './multipart';
import { createImageUploader } from './upload';

const errors = {
  400: imageErrorSchema,
  403: imageErrorSchema,
  404: imageErrorSchema,
  409: imageErrorSchema,
  413: imageErrorSchema,
  422: imageErrorSchema,
  429: imageErrorSchema,
  503: imageErrorSchema,
};

export function createListingImageRoutes(storage: ObjectStorage) {
  const upload = createImageUploader(storage);
  const ingressRateLimit = createRateLimiter(30, 60_000);
  const requests = new Set<Request>();
  return new Elysia({ prefix: '/listings', detail: { tags: ['Listing images'] } })
    .use(authenticationPlugin)
    .onRequest(async ({ request, server, status }) => {
      if (
        request.method !== 'POST' ||
        !/\/listings\/[^/]+\/images\/?$/.test(new URL(request.url).pathname)
      )
        return;
      if (
        requests.size >= 4 ||
        ingressRateLimit(server?.requestIP(request)?.address ?? 'unknown') !== null
      ) {
        throw new ImageError('busy');
      }
      requests.add(request);
      try {
        const token = new Bun.CookieMap(request.headers.get('cookie') ?? '').get(
          SESSION_COOKIE_NAME,
        );
        // onRequest can short-circuit before route-scoped cleanup runs.
        // Reject unauthenticated uploads before reading their multipart bodies.
        if (!token || !(await getSession(token))) {
          requests.delete(request);
          return status(401, {
            error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
          });
        }
      } catch (error) {
        requests.delete(request);
        throw error;
      }
    })
    .onAfterResponse({ as: 'global' }, ({ request }) => {
      requests.delete(request);
    })
    .post(
      '/:id/images',
      async ({ auth, params, body, headers, status }) => {
        const result = await upload({
          listingId: params.id,
          ownerUserId: auth.user.id,
          requestId: headers['idempotency-key'],
          file: body.file,
        });
        return status(result.created ? 201 : 200, { image: result.image });
      },
      {
        authenticated: true,
        params: listingIdParamsSchema,
        headers: imageUploadHeadersSchema,
        // The bounded parser always returns or throws; the trailing parser declares the media
        // type for OpenAPI 1.4, which omits content types for custom parser functions.
        parse: [({ request }) => parseImageUpload(request), 'formdata'],
        body: imageUploadBodySchema,
        response: { ...errors, 200: listingImageResponseSchema, 201: listingImageResponseSchema },
        detail: {
          summary: 'Upload a report photo',
          security: openApiMutationSecurity,
          description:
            'Upload one JPEG, PNG or WebP (up to 5 MiB). Reuse Idempotency-Key only when retrying the same file. Images are normalized to WebP. A replay returns 200; a new image returns 201.',
        },
      },
    )
    .delete(
      '/:id/images/:imageId',
      async ({ auth, params, status }) => {
        await deleteOwnedImage(
          { listingId: params.id, ownerUserId: auth.user.id, imageId: params.imageId },
          storage,
        );
        return status(204, undefined);
      },
      {
        authenticated: true,
        params: t.Object({
          id: t.String({ format: 'uuid' }),
          imageId: t.String({ format: 'uuid' }),
        }),
        response: { ...errors, 204: t.Void() },
        detail: { summary: 'Delete a report photo', security: openApiMutationSecurity },
      },
    )
    .put(
      '/:id/images/order',
      ({ auth, params, body }) =>
        orderOwnedImages(
          {
            listingId: params.id,
            ownerUserId: auth.user.id,
            imageIds: body.imageIds,
          },
          storage,
        ),
      {
        authenticated: true,
        params: listingIdParamsSchema,
        body: imageOrderBodySchema,
        response: { ...errors, 200: listingImagesResponseSchema },
        detail: {
          summary: 'Replace the complete photo order',
          security: openApiMutationSecurity,
          description:
            'Send every current image ID exactly once. The last successful reorder wins. Photo changes do not modify the listing version.',
        },
      },
    );
}
