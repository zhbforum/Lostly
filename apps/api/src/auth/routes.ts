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
import { openApiCsrfSecurity, openApiSessionSecurity } from '@/openapi';

export const authRoutes = new Elysia({
  prefix: '/auth',
  detail: {
    tags: ['Authentication'],
  },
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
      detail: {
        summary: 'Register an account',
        description:
          'Creates a user account and starts a new authenticated session using an HttpOnly cookie.',
        security: openApiCsrfSecurity,
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
      detail: {
        summary: 'Sign in',
        description:
          'Authenticates existing credentials and starts a new session using an HttpOnly cookie.',
        security: openApiCsrfSecurity,
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
      detail: {
        summary: 'Get current user',
        description: 'Returns the user associated with the current authenticated session.',
        security: openApiSessionSecurity,
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
      detail: {
        summary: 'Sign out',
        description:
          'Revokes the current session when present and clears the session cookie. The operation is idempotent.',
        security: openApiCsrfSecurity,
        responses: {
          204: {
            description: 'Session cleared successfully.',
          },
        },
      },
    },
  );
