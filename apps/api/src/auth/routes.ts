import { Elysia } from 'elysia';

import {
  removeSessionCookie,
  SESSION_COOKIE_NAME,
  sessionCookieSchema,
  setSessionCookie,
} from '@/auth/cookie';
import { normalizeEmail } from '@/auth/email';
import {
  authErrorSchema,
  authResponseSchema,
  loginBodySchema,
  registerBodySchema,
} from '@/auth/model';
import { authenticationPlugin } from '@/auth/plugin';
import { login, logout as logoutSession, register } from '@/auth/service';
import { normalizeFields, trimFields } from '@/http/normalize';

export const authRoutes = new Elysia({
  prefix: '/auth',
})
  .use(authenticationPlugin)
  .post(
    '/register',
    async ({ body, cookie, status }) => {
      const result = await register(body);

      if (!result.ok) {
        return status(409, {
          error: {
            code: 'EMAIL_TAKEN',
            message: 'An account with this email already exists',
          },
        });
      }

      setSessionCookie(
        cookie[SESSION_COOKIE_NAME],
        result.value.sessionToken,
        result.value.sessionExpiresAt,
      );

      return status(201, {
        user: result.value.user,
      });
    },
    {
      transform({ body }) {
        normalizeFields(body, { email: normalizeEmail });
        trimFields(body, ['displayName']);
      },
      body: registerBodySchema,
      cookie: sessionCookieSchema,
      response: {
        201: authResponseSchema,
        409: authErrorSchema,
      },
    },
  )
  .post(
    '/login',
    async ({ body, cookie, status }) => {
      const result = await login(body);

      if (!result.ok) {
        return status(401, {
          error: {
            code: 'INVALID_CREDENTIALS',
            message: 'Invalid email or password',
          },
        });
      }

      setSessionCookie(
        cookie[SESSION_COOKIE_NAME],
        result.value.sessionToken,
        result.value.sessionExpiresAt,
      );

      return {
        user: result.value.user,
      };
    },
    {
      transform({ body }) {
        normalizeFields(body, { email: normalizeEmail });
      },
      body: loginBodySchema,
      cookie: sessionCookieSchema,
      response: {
        200: authResponseSchema,
        401: authErrorSchema,
      },
    },
  )
  .get(
    '/me',
    ({ auth }) => ({
      user: auth.user,
    }),
    {
      authenticated: true,
      response: {
        200: authResponseSchema,
      },
    },
  )
  .post(
    '/logout',
    async ({ cookie, status }) => {
      const sessionCookie = cookie[SESSION_COOKIE_NAME];
      const token = sessionCookie.value;

      if (token) {
        await logoutSession(token);
      }

      removeSessionCookie(sessionCookie);

      return status(204);
    },
    {
      cookie: sessionCookieSchema,
    },
  );
