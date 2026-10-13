import { Elysia, t } from 'elysia';
import { authErrorSchema } from '@/auth/model';
import type { ObjectStorage } from '@/storage/object-storage';
import { publicProfileResponseSchema } from './model';
import { findPublicProfile, findPublicProfileByUsername } from './queries';

export const createPublicProfileRoutes = (storage: ObjectStorage) =>
  new Elysia({ detail: { tags: ['Profile'] } })
    .get(
      '/users/:id',
      async ({ params }) => ({ profile: await findPublicProfile(params.id, storage) }),
      {
        params: t.Object({ id: t.String({ format: 'uuid' }) }),
        response: {
          200: publicProfileResponseSchema,
          404: authErrorSchema,
          422: authErrorSchema,
          503: authErrorSchema,
        },
        detail: {
          summary: 'View a public profile',
          description:
            'Available without signing in. Only username, display name, bio, registration date and avatar are public. No contact details, account role, activity, or editing metadata. Avatar objects remain private in R2 and are served via short-lived signed URLs.',
          security: [],
        },
      },
    )
    .get(
      '/u/:username',
      async ({ params }) => ({
        profile: await findPublicProfileByUsername(params.username, storage),
      }),
      {
        params: t.Object({
          username: t.String({
            minLength: 3,
            maxLength: 30,
            pattern: '^[a-zA-Z0-9][a-zA-Z0-9_]{1,28}[a-zA-Z0-9]$',
          }),
        }),
        response: {
          200: publicProfileResponseSchema,
          404: authErrorSchema,
          422: authErrorSchema,
          503: authErrorSchema,
        },
        detail: {
          summary: 'View a public profile by username',
          description:
            'Case-insensitive lookup including previous usernames. Returns the current username so clients can replace aliases with the canonical profile URL.',
          security: [],
        },
      },
    );
