import { Elysia, t } from 'elysia';
import { authenticationPlugin } from '@/auth/plugin';
import { authErrorSchema } from '@/auth/model';
import { trimFields } from '@/http/normalize';
import type { ImageUploadInfrastructure } from '@/image-upload/infrastructure';
import { openApiMutationSecurity, openApiSessionSecurity } from '@/openapi';
import type { ObjectStorage } from '@/storage/object-storage';
import { ProfileError } from './errors';
import {
  avatarDeleteSchema,
  avatarUploadSchema,
  profileResponseSchema,
  updateProfileSchema,
  usernameAvailabilitySchema,
} from './model';
import { parseAvatarUpload } from './multipart';
import { findProfile, toProfile } from './queries';
import { removeAvatar, updateProfile } from './service';
import { createAvatarUploader } from './upload';
import { usernameAvailability } from './usernames';

const errors = Object.fromEntries(
  [400, 403, 404, 408, 409, 413, 422, 429, 503].map((code) => [code, authErrorSchema]),
);

export function createProfileRoutes(storage: ObjectStorage, uploads: ImageUploadInfrastructure) {
  const uploadAvatar = createAvatarUploader(storage, uploads.processing);
  return new Elysia({ prefix: '/me/profile', detail: { tags: ['Profile'] } })
    .use(authenticationPlugin)
    .onRequest(async ({ request, server, status }) => {
      if (
        request.method !== 'POST' ||
        !/^\/me\/profile\/avatar\/?$/.test(new URL(request.url).pathname)
      )
        return;
      const admission = await uploads.ingress.begin(
        request,
        server?.requestIP(request)?.address ?? 'unknown',
      );
      if (!admission.ok) {
        if (admission.reason !== 'unauthenticated') throw new ProfileError(admission.reason);
        return status(401, {
          error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
        });
      }
    })
    .onAfterResponse({ as: 'global' }, ({ request }) => uploads.ingress.finish(request))
    .get(
      '/username/:username',
      ({ auth, params }) => usernameAvailability(auth.user.id, params.username),
      {
        authenticated: true,
        params: t.Object({ username: t.String({ minLength: 1, maxLength: 128 }) }),
        response: { ...errors, 200: usernameAvailabilitySchema },
        detail: {
          summary: 'Check a profile username',
          description: 'Advisory only; uniqueness is enforced atomically when saving.',
          security: openApiSessionSecurity,
        },
      },
    )
    .get(
      '',
      async ({ auth }) => ({ profile: toProfile(await findProfile(auth.user.id), storage) }),
      {
        authenticated: true,
        response: { ...errors, 200: profileResponseSchema },
        detail: { summary: 'Get your profile', security: openApiSessionSecurity },
      },
    )
    .patch(
      '',
      async ({ auth, body }) => ({ profile: await updateProfile(auth.user.id, body, storage) }),
      {
        authenticated: true,
        transform({ body }) {
          trimFields(body, ['displayName', 'bio', 'username']);
        },
        body: updateProfileSchema,
        response: { ...errors, 200: profileResponseSchema },
        detail: {
          summary: 'Update your profile',
          description:
            'Display names can change once every seven days; usernames once every 30 days. Username is optional until chosen, case-insensitive and cannot be cleared. Historical usernames remain reserved for the same owner. Bio edits do not consume either allowance. All mutations require the current profile version.',
          security: openApiMutationSecurity,
        },
      },
    )
    .post(
      '/avatar',
      async ({ auth, body }) => ({
        profile: await uploadAvatar(auth.user.id, body.file, body.expectedVersion),
      }),
      {
        authenticated: true,
        parse: [({ request }) => parseAvatarUpload(request), 'formdata'],
        body: avatarUploadSchema,
        response: { ...errors, 200: profileResponseSchema },
        detail: {
          summary: 'Replace your avatar',
          description:
            'JPEG, PNG, WebP or GIF up to 5 MiB. Images are cropped to 256 × 256 and normalized to WebP; animation is preserved with a static alternative. Maximum 100 frames and 40 million total input pixels.',
          security: openApiMutationSecurity,
        },
      },
    )
    .delete(
      '/avatar',
      async ({ auth, body }) => ({
        profile: await removeAvatar(auth.user.id, body.expectedVersion, storage),
      }),
      {
        authenticated: true,
        body: avatarDeleteSchema,
        response: { ...errors, 200: profileResponseSchema },
        detail: { summary: 'Remove your avatar', security: openApiMutationSecurity },
      },
    );
}
