import { t } from 'elysia';
import { USER_ROLES } from '@/domain/user';

export const authUserSchema = t.Object({
  id: t.String({
    format: 'uuid',
  }),
  email: t.String(),
  displayName: t.String(),
  role: t.UnionEnum(USER_ROLES),
});

export const authResponseSchema = t.Object({
  user: authUserSchema,
});

export const authErrorSchema = t.Object({
  error: t.Object({
    code: t.String(),
    message: t.String(),
  }),
});

export const registerBodySchema = t.Object({
  email: t.String({
    format: 'email',
    maxLength: 254,
  }),
  password: t.String({
    minLength: 15,
    maxLength: 128,
  }),
  displayName: t.String({
    minLength: 2,
    maxLength: 80,
  }),
});

export const loginBodySchema = t.Object({
  email: t.String({
    format: 'email',
    maxLength: 254,
  }),
  password: t.String({
    minLength: 1,
    maxLength: 128,
  }),
});
