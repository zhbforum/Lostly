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
import { getSession, login, logout as logoutSession, register } from '@/auth/service';

export const authRoutes = new Elysia({
  prefix: '/auth',
})
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
        body.email = normalizeEmail(body.email);
        body.displayName = body.displayName.trim();
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
        body.email = normalizeEmail(body.email);
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
    async ({ cookie, status }) => {
      const sessionCookie = cookie[SESSION_COOKIE_NAME];
      const token = sessionCookie.value;

      if (!token) {
        return status(401, {
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Authentication required',
          },
        });
      }

      const auth = await getSession(token);

      if (!auth) {
        removeSessionCookie(sessionCookie);

        return status(401, {
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Authentication required',
          },
        });
      }

      return {
        user: auth.user,
      };
    },
    {
      cookie: sessionCookieSchema,
      response: {
        200: authResponseSchema,
        401: authErrorSchema,
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
