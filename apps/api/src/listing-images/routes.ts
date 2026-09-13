import { Elysia, t } from 'elysia';
import { authenticationPlugin } from '@/auth/plugin';
import { listingIdParamsSchema } from '@/listings/model';
import { openApiMutationSecurity } from '@/openapi';
import type { ObjectStorage } from '@/storage/object-storage';
import { createImageUploadIngress } from './ingress';
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
  408: imageErrorSchema,
  409: imageErrorSchema,
  413: imageErrorSchema,
  422: imageErrorSchema,
  429: imageErrorSchema,
  503: imageErrorSchema,
};

export function createListingImageRoutes(
  storage: ObjectStorage,
  { bodyReadTimeoutMs }: { bodyReadTimeoutMs?: number } = {},
) {
  const upload = createImageUploader(storage);
  const ingress = createImageUploadIngress();
  return new Elysia({ prefix: '/listings', detail: { tags: ['Listing images'] } })
    .use(authenticationPlugin)
    .onRequest(async ({ request, server, status }) => {
      if (
        request.method !== 'POST' ||
        !/\/listings\/[^/]+\/images\/?$/.test(new URL(request.url).pathname)
      )
        return;
      if (!(await ingress.begin(request, server?.requestIP(request)?.address ?? 'unknown'))) {
        return status(401, {
          error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
        });
      }
    })
    .onAfterResponse({ as: 'global' }, ({ request }) => {
      ingress.finish(request);
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
        parse: [({ request }) => parseImageUpload(request, bodyReadTimeoutMs), 'formdata'],
        body: imageUploadBodySchema,
        response: { ...errors, 200: listingImageResponseSchema, 201: listingImageResponseSchema },
        detail: {
          summary: 'Upload a report photo',
          security: openApiMutationSecurity,
          description:
            'Upload one JPEG, PNG or WebP (up to 5 MiB). One concurrent upload per user; body reads have a 30-second deadline. Reuse Idempotency-Key only when retrying the same file. Images are normalized to WebP. A replay returns 200; a new image returns 201.',
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
