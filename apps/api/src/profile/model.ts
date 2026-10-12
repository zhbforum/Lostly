import { t } from 'elysia';
import { PROFILE_CONSTRAINTS as limits } from '@lostly/contracts/profile';

export const profileAvatarSchema = t.Object({
  id: t.String({ format: 'uuid' }),
  url: t.String(),
  staticUrl: t.String(),
  urlExpiresAt: t.String({ format: 'date-time' }),
  animated: t.Boolean(),
});

export const publicProfileResponseSchema = t.Object({
  profile: t.Object({
    id: t.String({ format: 'uuid' }),
    displayName: t.String(),
    username: t.Nullable(t.String()),
    bio: t.String(),
    createdAt: t.String({ format: 'date-time' }),
    avatar: t.Nullable(profileAvatarSchema),
  }),
});

export const profileResponseSchema = t.Object({
  profile: t.Object({
    ...publicProfileResponseSchema.properties.profile.properties,
    nextDisplayNameChangeAt: t.Nullable(t.String({ format: 'date-time' })),
    nextUsernameChangeAt: t.Nullable(t.String({ format: 'date-time' })),
    version: t.Integer({ minimum: 1 }),
  }),
});

export const updateProfileSchema = t.Object(
  {
    displayName: t.String({
      minLength: limits.displayNameMinLength,
      maxLength: limits.displayNameMaxLength,
    }),
    bio: t.String({ maxLength: limits.bioMaxLength }),
    username: t.Optional(
      t.String({ minLength: limits.usernameMinLength, maxLength: limits.usernameMaxLength }),
    ),
    expectedVersion: t.Integer({ minimum: 1 }),
  },
  { additionalProperties: false },
);

export const usernameAvailabilitySchema = t.Object({
  username: t.String(),
  available: t.Boolean(),
  reason: t.Nullable(t.UnionEnum(['invalid', 'reserved', 'taken'])),
});

export const avatarUploadSchema = t.Object({
  file: t.File({ minSize: 1, maxSize: limits.avatarMaxBytes }),
  expectedVersion: t.Integer({ minimum: 1 }),
});

export const avatarDeleteSchema = t.Object(
  { expectedVersion: t.Integer({ minimum: 1 }) },
  { additionalProperties: false },
);
